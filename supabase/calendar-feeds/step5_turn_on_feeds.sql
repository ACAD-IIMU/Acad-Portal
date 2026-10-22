-- STEP 5 of 5 — Turn on section calendars
-- Run in Supabase → SQL Editor ONLY after the new code is deployed on Vercel and the
-- updated Apps Script is pasted into acad@ (see apps-script/README.md).
--
-- What happens next, automatically, every 5 minutes:
--   1. acad@ creates the section calendars, a few per run (3 per run, 40 per day max).
--   2. Each calendar is filled with its classes — silently.
--   3. Students are added to their own sections' calendars (students who signed in after
--      this release — everyone else gets an "Add my class calendars" button on Home).
--   4. Once a student has ALL their section calendars, they are quietly taken off the
--      old guest invites, so nobody ever sees a class twice or loses one.
-- From this moment no class change emails anyone: last-minute changes go out as phone
-- notifications to that section only.

update calendar_invite_settings
set feeds_enabled = true,
    updated_at = now()
where id = 1;
