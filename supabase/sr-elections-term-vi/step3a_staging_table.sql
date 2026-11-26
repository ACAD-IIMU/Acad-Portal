-- SR Elections, MBA2 Term VI — step 3a: a table to import the allotment into.
--
-- After running this: Table Editor -> stg_term6_allotment -> Insert ->
-- Import data from CSV -> choose term6_allotment.csv (made from ACAD's
-- "List for creating Group Email id" workbook: one row per student per course).
--
-- Columns:
--   reg_no       roll number (7 digits, e.g. 25xxxxx)
--   email        IIMU email; used to match the student if reg_no doesn't
--   course_code  as in the timetable: ADM, BECON, B&M: D2C, LWDE:IS, ...
--   section      A or B for courses with sections; empty for one-section courses
--
-- Re-importing? Empty it first:  truncate public.stg_term6_allotment;

create table if not exists public.stg_term6_allotment (
  reg_no text,
  email text,
  course_code text not null,
  section text
);

-- No policies: only the SQL editor / service role can read it.
alter table public.stg_term6_allotment enable row level security;
