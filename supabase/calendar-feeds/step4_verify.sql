-- STEP 4 of 5 — Check steps 1–3 worked
-- Run in Supabase → SQL Editor. Expected: one row, feeds_enabled = false,
-- legacy_guests_enabled = true, and every *_table column = true.

select
  s.feeds_enabled,
  s.legacy_guests_enabled,
  s.push_enabled,
  s.max_new_calendars_per_run,
  s.max_new_calendars_per_day,
  to_regclass('public.calendar_feeds') is not null               as feeds_table,
  to_regclass('public.calendar_feed_subscriptions') is not null  as subscriptions_table,
  to_regclass('public.push_subscriptions') is not null           as push_table,
  to_regclass('public.push_log') is not null                     as push_log_table,
  exists (
    select 1 from information_schema.columns
    where table_name = 'calendar_invite_ledger' and column_name = 'calendar_id'
  )                                                               as ledger_has_calendar_id
from calendar_invite_settings s
where s.id = 1;
