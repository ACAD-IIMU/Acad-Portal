-- EMERGENCY STOP — nothing more is created, changed or removed on any calendar until
-- you run control_resume.sql. Events already on calendars stay as they are.

update calendar_invite_settings
set paused = true,
    updated_at = now()
where id = 1;
