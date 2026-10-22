-- How far along is the move to section calendars?
-- Run any time in Supabase → SQL Editor. Changes nothing.
--
--   calendars_created / calendars_total   section calendars acad@ has made so far
--   students_subscribed                   students with at least one section calendar
--   students_with_alerts                  students who turned on phone alerts
--   old_guest_events_left                 old guest-invite events still on acad@'s calendar
--   last_plan_at                          should be within ~5 minutes

select
  (select count(*) from calendar_feeds where calendar_id is not null)                 as calendars_created,
  (select count(*) from calendar_feeds)                                                as calendars_total,
  (select count(distinct student_id) from calendar_feed_subscriptions)                 as students_subscribed,
  (select count(distinct student_id) from push_subscriptions)                          as students_with_alerts,
  (select count(*) from calendar_invite_ledger where calendar_id is null
     and start_at > now())                                                             as old_guest_events_left,
  (select count(*) from google_tokens where scope like '%calendar.calendarlist%')      as students_with_new_permission,
  (select last_plan_at from calendar_invite_settings where id = 1)                     as last_plan_at;
