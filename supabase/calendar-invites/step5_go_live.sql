-- STEP 5 — GO LIVE (run only when the runbook says so)
-- Turns the system on, and keeps it SILENT for the next 3 hours so the first load of
-- every class adds them to calendars without sending a single email.
-- After 3 hours, silence ends by itself and only last-minute changes send emails.

update calendar_invite_settings
set paused = false,
    silent_until = now() + interval '3 hours',
    updated_at = now()
where id = 1;
