-- STEP 1 of 1 — Egress fix: let the calendar sync skip runs when nothing has changed.
-- Run in Supabase → SQL Editor BEFORE merging the egress-fix code. Paste the whole file
-- and click Run. Safe to run more than once. Changes no data.
--
-- Why: every Apps Script run (and the background calendar-list pass) used to download the
-- whole batch — enrollments, students, sections, sessions and two ledgers of 16,000+ rows —
-- even when nothing had changed. That was ~2 GB/day of Supabase egress.
--
-- calendar_sync_fingerprint() hashes everything the calendar sync reads, INSIDE Postgres,
-- and returns one short string. Only that string leaves the database (a few bytes). If it
-- matches the fingerprint of the last run that found nothing to do, the run is skipped.
-- A full check still happens at least every quiet_full_check_hours (default 3) as a
-- safety net, and never while a vanished class is waiting out its grace period.
--
-- Deliberately left OUT of the fingerprint: bookkeeping the sync writes on every run
-- (updated_at stamps, last_plan_at, ids that change on delete-and-reinsert, access tokens).
-- Anything else that changes simply causes one full run — the safe direction.
--
-- To switch the skipping off without a deploy:
--   update calendar_invite_settings set quiet_skip_enabled = false where id = 1;

do $$
begin
  alter table calendar_invite_settings add column if not exists quiet_skip_enabled     boolean not null default true;
  alter table calendar_invite_settings add column if not exists quiet_full_check_hours int     not null default 3;
  alter table calendar_invite_settings add column if not exists quiet_plan_fp          text;
  alter table calendar_invite_settings add column if not exists quiet_plan_at          timestamptz;
  alter table calendar_invite_settings add column if not exists quiet_feeds_fp         text;
  alter table calendar_invite_settings add column if not exists quiet_feeds_at         timestamptz;
  alter table calendar_invite_settings add column if not exists quiet_note             text;
  alter table calendar_invite_settings add column if not exists quiet_skipped_runs     int not null default 0;
end $$;

create or replace function public.calendar_sync_fingerprint()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with parts(k, h) as (
    select 'settings', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select (to_jsonb(s) - array[
        'last_plan_at','last_ack_at','updated_at',
        'quiet_plan_fp','quiet_plan_at','quiet_feeds_fp','quiet_feeds_at','quiet_note','quiet_skipped_runs'
      ])::text x from calendar_invite_settings s) q
    union all
    select 'sessions', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select (to_jsonb(t) - array['id','created_at','updated_at','synced_at'])::text x from sessions t) q
    union all
    select 'events', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select (to_jsonb(t) - array['id','created_at','updated_at','synced_at'])::text x from important_events t) q
    union all
    select 'enrollments', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select (to_jsonb(t) - array['id','created_at','updated_at'])::text x from enrollments t) q
    union all
    select 'subjects', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select (to_jsonb(t) - array['created_at','updated_at'])::text x from subjects t) q
    union all
    select 'sections', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select (to_jsonb(t) - array['created_at','updated_at'])::text x from sections t) q
    union all
    select 'students', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select concat_ws('~', s.id, s.email, s.reg_no, s.batch_label,
                       s.personal_ready_at, s.personal_off_at, s.calendar_confirmed_at) x
      from students s) q
    union all
    -- Only what decides whether a token can be used — not the token values, which change at
    -- every sign-in without changing anything the sync would do.
    select 'tokens', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select concat_ws('~', g.student_id, g.refresh_token is not null, g.scope,
                       (g.events_error is not null and g.events_error_at >= g.updated_at),
                       (g.calendarlist_error is not null and g.calendarlist_error_at >= g.updated_at)) x
      from google_tokens g) q
    union all
    select 'feeds', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select concat_ws('~', f.key, f.batch_label, f.term, f.calendar_id, f.calendar_created_at, f.filled_at) x
      from calendar_feeds f) q
    union all
    select 'subscriptions', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select concat_ws('~', c.student_id, c.feed_key, c.calendar_id) x from calendar_feed_subscriptions c) q
    union all
    select 'invite_ledger', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select (to_jsonb(l) - array['created_at','updated_at'])::text x from calendar_invite_ledger l) q
    union all
    select 'personal_ledger', md5(coalesce(string_agg(x, '' order by x), '')) from (
      select (to_jsonb(l) - array['updated_at'])::text x from calendar_personal_ledger l) q
  )
  select jsonb_build_object(
    'fingerprint', (select md5(string_agg(k || ':' || h, '|' order by k)) from parts),
    -- Upcoming classes that vanished from the timetable and are waiting out their grace
    -- period: these turn into cancellations on a later run, so never skip while any exist.
    'pending',
      (select count(*) from calendar_invite_ledger   where missing_since is not null and start_at >= now()) +
      (select count(*) from calendar_personal_ledger where missing_since is not null and start_at >= now())
  );
$fn$;

revoke all on function public.calendar_sync_fingerprint() from public, anon, authenticated;
grant execute on function public.calendar_sync_fingerprint() to service_role;

-- Check: should return one row like {"pending": 0, "fingerprint": "3f2a…"}
select public.calendar_sync_fingerprint();
