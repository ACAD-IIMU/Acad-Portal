-- DIRECT MODE — progress (read-only)
select
  s.batch_label,
  count(*)                                                   as students,
  count(*) filter (where s.personal_ready_at is not null)    as classes_in_their_calendar,
  count(*) filter (where gt.events_error is not null)        as google_permission_broken,
  count(*) filter (where gt.student_id is null)              as never_signed_in,
  (select count(*) from calendar_personal_ledger l where l.batch_label = s.batch_label) as class_copies
from students s
left join google_tokens gt on gt.student_id = s.id
where s.batch_label in (select unnest(enabled_batches) from calendar_invite_settings where id = 1)
group by s.batch_label
order by s.batch_label;
