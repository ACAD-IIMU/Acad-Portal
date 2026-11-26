-- SR Elections, MBA2 Term VI — step 3b: check the imported allotment. Read-only.
--
-- One row per problem. "info" rows are worth a look but don't block loading;
-- every other row must be fixed (in the CSV, or with ACAD) before step 3c.
-- Re-import and re-run until only info rows (or nothing) remain.

with codes(code, sectioned) as (values
  ('ADM', true), ('BECON', true), ('BSBAS', false), ('B&M: D2C', true), ('BFC', false),
  ('CE', true), ('DWV', false), ('DPM', false), ('ERPS', false), ('FIS', true),
  ('FTM', false), ('GTA', true), ('HF', false), ('ICA', false), ('IMS', false),
  ('LWDE:IS', false), ('LGS', false), ('M&S', false), ('MA', false), ('MPBS', false),
  ('SF', false)),
a as (
  select trim(reg_no) as reg_no, lower(trim(email)) as email, course_code,
         nullif(upper(trim(section)), '') as section,
         upper(regexp_replace(course_code, '[^A-Za-z0-9]', '', 'g')) as course_key
  from public.stg_term6_allotment
),
problems as (
  -- No such MBA2 student, by roll number or email.
  select 'unknown student' as problem, coalesce(a.reg_no, '') || ' / ' || coalesce(a.email, '') as detail
  from a
  where not exists (
    select 1 from public.students s
    where s.cohort = 'MBA2' and (s.reg_no = a.reg_no or lower(s.email) = a.email))

  union all
  -- Roll number and email belong to two different students.
  select 'roll no and email disagree', a.reg_no || ' / ' || a.email
  from a
  join public.students r on r.cohort = 'MBA2' and r.reg_no = a.reg_no
  join public.students e on e.cohort = 'MBA2' and lower(e.email) = a.email
  where r.id <> e.id

  union all
  select 'unknown course code', a.course_code
  from a
  where not exists (
    select 1 from codes c where upper(regexp_replace(c.code, '[^A-Za-z0-9]', '', 'g')) = a.course_key)

  union all
  select case when c.sectioned then 'section missing' else 'section on a one-section course' end,
         coalesce(a.reg_no, a.email) || ' ' || a.course_code || ' ' || coalesce(a.section, '(none)')
  from a
  join codes c on upper(regexp_replace(c.code, '[^A-Za-z0-9]', '', 'g')) = a.course_key
  where (c.sectioned and a.section is null) or (not c.sectioned and a.section is not null)

  union all
  select 'listed twice for one course', coalesce(a.reg_no, a.email) || ' ' || min(a.course_code)
  from a
  group by coalesce(a.reg_no, a.email), a.course_key
  having count(*) > 1

  union all
  -- Info only: in the portal but not in the allotment (exchange, or missing from ACAD's list).
  select 'info: MBA2 student not in allotment', s.reg_no || ' ' || s.full_name
  from public.students s
  where s.cohort = 'MBA2'
    and not exists (select 1 from a where a.reg_no = s.reg_no or a.email = lower(s.email))
)
select problem, detail from problems
union all
select 'rows imported', count(*)::text from public.stg_term6_allotment
order by 1, 2;
