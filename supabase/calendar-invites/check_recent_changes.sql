-- CHECK — the last 50 things the system did (read-only).
-- send_updates = 'all' means the students of that class were emailed; 'none' = silent.
-- start_at is shown in Indian time.

select
  created_at at time zone 'Asia/Kolkata' as done_at_ist,
  op,
  summary,
  start_at at time zone 'Asia/Kolkata'   as class_starts_ist,
  send_updates,
  ok,
  error
from calendar_invite_log
order by created_at desc
limit 50;
