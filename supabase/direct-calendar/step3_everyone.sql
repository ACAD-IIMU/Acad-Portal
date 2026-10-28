-- DIRECT MODE — STEP 3: everyone
-- Run once the pilot looks right on the pilot student's phone.
-- Students are moved over in the background (about 900 class copies every 5 minutes, so the
-- whole college takes a few hours). Each student keeps their old invites until ALL their
-- classes are in their calendar, so nobody misses a class. Nothing for students to do.

update calendar_invite_settings
set personal_pilot_reg_nos = null,
    updated_at = now()
where id = 1
returning personal_enabled, personal_pilot_reg_nos;
