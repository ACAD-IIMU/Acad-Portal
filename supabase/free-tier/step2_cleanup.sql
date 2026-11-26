-- Free-tier optimisation, step 2 (Nov 2026): daily clean-up inside the database.
--
-- RUN ONLY AFTER the free-tier-optimize code is live on Vercel. The old code downloads past
-- classes from calendar_personal_ledger and, if their rows were missing, would try to create
-- those past classes again in every student's calendar. The new code never creates a class
-- that has already started (lib/personalCalendar.ts), so old rows can safely go.
--
-- What it does, every night at 3:00 AM IST (21:30 UTC), with pg_cron (free on every plan):
--   - calendar_personal_ledger: deletes rows for classes that started more than 7 days ago
--     (these were ~half the table and grew every day; the sync never reads them now)
--   - calendar_invite_log, push_log: deletes entries older than 30 days (write-only logs)
-- Nothing leaves the database, so this costs no egress.

-- Switch for batched Google Calendar writes (lib/calendarBatch.ts). Off until watched on a run.
alter table public.calendar_invite_settings
  add column if not exists personal_batch_writes boolean not null default false;

create extension if not exists pg_cron;

create or replace function public.acad_daily_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger int;
  v_invite_log int;
  v_push_log int;
begin
  delete from calendar_personal_ledger where start_at < now() - interval '7 days';
  get diagnostics v_ledger = row_count;
  delete from calendar_invite_log where created_at < now() - interval '30 days';
  get diagnostics v_invite_log = row_count;
  delete from push_log where created_at < now() - interval '30 days';
  get diagnostics v_push_log = row_count;
  return jsonb_build_object('ledger', v_ledger, 'invite_log', v_invite_log, 'push_log', v_push_log);
end;
$$;

revoke execute on function public.acad_daily_cleanup() from public, anon, authenticated;

select cron.schedule('acad-daily-cleanup', '30 21 * * *', $$select public.acad_daily_cleanup()$$);

-- Check it:   select * from cron.job;
--             select * from cron.job_run_details order by start_time desc limit 5;
-- Stop it:    select cron.unschedule('acad-daily-cleanup');
