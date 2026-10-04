-- STEP 4 of 4 — Calendar invites: check steps 1–3 worked
-- Run in Supabase → SQL Editor. Expected result: ONE row showing
--   paused = true, enabled_batches = {MBA 2025-27}, notify_window_hours = 48,
--   ledger_rows = 0, log_rows = 0.
-- If you get an error that a table does not exist, re-run the step that creates it.

select
  s.paused,
  s.enabled_batches,
  s.notify_window_hours,
  s.max_changes_per_run,
  (select count(*) from calendar_invite_ledger) as ledger_rows,
  (select count(*) from calendar_invite_log)    as log_rows
from calendar_invite_settings s
where s.id = 1;
