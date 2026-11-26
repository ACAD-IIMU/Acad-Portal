-- SR Elections, MBA2 Term VI — step 3c: load Term VI subjects, sections and
-- enrollments from the checked allotment (only after step 3b shows no problems).
--
-- Run the whole file at once: the editor runs it as one transaction, so if
-- any statement fails, nothing is saved. Safe to re-run: it adds missing rows
-- and updates sections, and never deletes anything.
-- The result is the number of students per course and section; compare it
-- with ACAD's list.

create temp table t6 as
with codes(code) as (values
  ('ADM'), ('BECON'), ('BSBAS'), ('B&M: D2C'), ('BFC'), ('CE'), ('DWV'), ('DPM'), ('ERPS'),
  ('FIS'), ('FTM'), ('GTA'), ('HF'), ('ICA'), ('IMS'), ('LWDE:IS'), ('LGS'), ('M&S'), ('MA'),
  ('MPBS'), ('SF'))
select distinct s.id as student_id,
       c.code,
       nullif(upper(trim(a.section)), '') as section_label
from public.stg_term6_allotment a
-- roll number first, email as the fallback
join public.students s
  on s.cohort = 'MBA2'
 and s.id = coalesce(
       (select x.id from public.students x where x.cohort = 'MBA2' and x.reg_no = trim(a.reg_no)),
       (select x.id from public.students x where x.cohort = 'MBA2' and lower(x.email) = lower(trim(a.email))))
join codes c
  on upper(regexp_replace(c.code, '[^A-Za-z0-9]', '', 'g'))
   = upper(regexp_replace(a.course_code, '[^A-Za-z0-9]', '', 'g'));

-- Subjects: name = the timetable code (lib/subjectFullNames.ts shows the full title).
insert into public.subjects (name, term, batch_label)
select distinct t.code, 'Term VI', 'MBA 2025-27'
from t6 t
where not exists (
  select 1 from public.subjects x
  where x.term = 'Term VI' and x.batch_label = 'MBA 2025-27' and x.name = t.code);

-- Sections: only for courses with sections. One-section courses use
-- section_id = null, which is what timetable sync writes on their sessions too.
insert into public.sections (subject_id, term, section_label, batch_label)
select distinct sub.id, 'Term VI', t.section_label, 'MBA 2025-27'
from t6 t
join public.subjects sub on sub.term = 'Term VI' and sub.batch_label = 'MBA 2025-27' and sub.name = t.code
where t.section_label is not null
  and not exists (
    select 1 from public.sections x
    where x.subject_id = sub.id and x.term = 'Term VI' and x.section_label = t.section_label);

-- Enrollments: one per student per course.
insert into public.enrollments (student_id, subject_id, term, section_id)
select t.student_id, sub.id, 'Term VI', sec.id
from t6 t
join public.subjects sub on sub.term = 'Term VI' and sub.batch_label = 'MBA 2025-27' and sub.name = t.code
left join public.sections sec on sec.subject_id = sub.id and sec.term = 'Term VI' and sec.section_label = t.section_label
on conflict (student_id, subject_id, term) do update set section_id = excluded.section_id;

drop table t6;

-- Students per course and section.
select sub.name as course, sec.section_label as section, count(*) as students
from public.enrollments e
join public.subjects sub on sub.id = e.subject_id
left join public.sections sec on sec.id = e.section_id
where e.term = 'Term VI' and sub.batch_label = 'MBA 2025-27'
group by 1, 2
order by 1, 2;
