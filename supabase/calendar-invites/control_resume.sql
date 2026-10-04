-- RESUME after an emergency stop. Normal rules apply straight away
-- (last-minute changes email students; everything else is silent).

update calendar_invite_settings
set paused = false,
    updated_at = now()
where id = 1;
