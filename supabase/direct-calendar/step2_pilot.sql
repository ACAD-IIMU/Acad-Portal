-- DIRECT MODE — STEP 2: pilot on one student (Thilak, 2511140)
-- Run ONLY after the code is merged and live on Vercel.
-- Within ~10 minutes his upcoming classes appear in his main Google Calendar; a few minutes
-- later his old acad@ invites and ACAD section calendars are removed, quietly.
-- To add more pilot students, add their roll numbers to the array.

update calendar_invite_settings
set personal_enabled = true,
    personal_pilot_reg_nos = array['2511140'],
    updated_at = now()
where id = 1
returning personal_enabled, personal_pilot_reg_nos;
