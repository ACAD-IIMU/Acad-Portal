-- STEP 2 of 5 — Section calendars: new ledger columns and switches
-- Run in Supabase → SQL Editor after step 1. Paste the whole file and click Run.
--
-- calendar_invite_ledger gains:
--   calendar_id    which Google calendar the event lives on. NULL = the old guest-invite
--                  event on acad@'s own calendar.
--   feed_key       which section calendar it belongs to (NULL for old guest events)
--   summary        the event title (needed to mark a cancelled class "❌ CANCELLED")
--   all_day        true for all-day events (Registration, holidays)
--   origin         the timetable entry it came from — so one real change is counted once
--                  by the safety brake even though it touches several calendars
--   cancelled_at   set when a class cancelled within 48 hours was kept on the calendar
--                  as "❌ CANCELLED" instead of vanishing
--   audience       which section calendars' students an old guest event was for — used
--                  to send a phone alert if that class is cancelled at the last minute
--
-- calendar_invite_settings gains:
--   feeds_enabled              false = old behaviour, exactly as before. Step 5 turns it on.
--   legacy_guests_enabled      true  = students not yet moved to section calendars keep
--                              their old guest events (silently). Turn off once everyone
--                              is moved (control_stop_old_invites.sql).
--   push_enabled               phone notifications for last-minute changes
--   max_new_calendars_per_run  Google puts acad@ in read-only mode if it creates too many
--   max_new_calendars_per_day  calendars quickly — these keep well under that.

do $$
begin
  alter table calendar_invite_ledger add column if not exists calendar_id text;
  alter table calendar_invite_ledger add column if not exists feed_key text;
  alter table calendar_invite_ledger add column if not exists summary text;
  alter table calendar_invite_ledger add column if not exists all_day boolean not null default false;
  alter table calendar_invite_ledger add column if not exists origin text;
  alter table calendar_invite_ledger add column if not exists cancelled_at timestamptz;
  alter table calendar_invite_ledger add column if not exists audience text;
  create index if not exists calendar_invite_ledger_feed_idx on calendar_invite_ledger (feed_key);

  alter table calendar_invite_settings add column if not exists feeds_enabled boolean not null default false;
  alter table calendar_invite_settings add column if not exists legacy_guests_enabled boolean not null default true;
  alter table calendar_invite_settings add column if not exists push_enabled boolean not null default true;
  alter table calendar_invite_settings add column if not exists max_new_calendars_per_run int not null default 3;
  alter table calendar_invite_settings add column if not exists max_new_calendars_per_day int not null default 40;

  alter table calendar_invite_log add column if not exists calendar_id text;
  alter table calendar_invite_log add column if not exists pushed_to int;
end $$;
