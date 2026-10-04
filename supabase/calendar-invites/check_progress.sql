-- CHECK — how is it going? Safe to run any time (read-only).
-- One row:
--   paused / silent_until  → is it on, and is it still in the silent first-load period
--   last_plan_at           → when the Apps Script last asked for work. Should be within the
--                            last ~5 minutes. If it is hours old, the Apps Script has stopped.
--   events_on_calendar     → how many events ACAD has put on calendars so far
--   done_last_hour / failed_last_hour / emailed_last_hour → recent activity

select
  s.paused,
  s.silent_until,
  s.enabled_batches,
  s.last_plan_at,
  s.last_ack_at,
  (select count(*) from calendar_invite_ledger)                                            as events_on_calendar,
  (select count(*) from calendar_invite_log where created_at > now() - interval '1 hour' and ok)      as done_last_hour,
  (select count(*) from calendar_invite_log where created_at > now() - interval '1 hour' and not ok)  as failed_last_hour,
  (select count(*) from calendar_invite_log where created_at > now() - interval '1 hour' and send_updates = 'all') as emailed_last_hour
from calendar_invite_settings s
where s.id = 1;
