-- STEP 6 — "I can see my ACAD classes on my phone"
-- Run in Supabase → SQL Editor BEFORE merging the Android fix. Paste the whole file and Run.
--
-- Why: Android's Google Calendar app does not sync a newly added calendar until the student
-- turns "Sync" on for it in the app's settings. So a student whose section calendars were
-- added could still see nothing on their phone — and once they were moved off the old guest
-- invites, their classes disappeared from their phone entirely.
--
-- From now on a student only comes off the old guest invites after tapping
-- "✓ I can see my ACAD classes on my phone" on the portal Home page, which stamps this column.
-- Students already moved (but not confirmed) are quietly put back on the guest invites by the
-- next syncs, with no emails, so their phones show their classes again.

alter table students add column if not exists calendar_confirmed_at timestamptz;
