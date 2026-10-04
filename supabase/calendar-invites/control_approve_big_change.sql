-- APPROVE A HELD BIG CHANGE
-- If acad@ gets an email "ACAD calendar sync is on hold", the timetable sync would move or
-- cancel more classes at once than the safety limit allows. FIRST look at the timetable
-- sheet and confirm the change is real (not someone sorting rows, deleting a tab, etc.).
-- If it is real, run this. It allows big changes for the next 1 hour only.

update calendar_invite_settings
set bulk_approved_until = now() + interval '1 hour',
    updated_at = now()
where id = 1;
