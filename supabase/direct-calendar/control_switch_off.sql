-- DIRECT MODE — switch OFF (undo)
-- Everyone goes back to the acad@ invites; 90 minutes later the copies in students' own
-- calendars are removed. No emails.

update calendar_invite_settings
set personal_enabled = false,
    updated_at = now()
where id = 1
returning personal_enabled;
