-- Remove ALL remaining old guest invites (silently).
-- Run ONLY when check_coverage.sql shows almost every student subscribed.
-- Students who still have not added their section calendars will no longer see classes
-- in Google Calendar (they still see everything on the portal's Home page).
-- Nobody is emailed: the removals are sent with notifications switched off.

update calendar_invite_settings
set legacy_guests_enabled = false,
    updated_at = now()
where id = 1;
