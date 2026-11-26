-- SR Elections, MBA2 Term VI — step 1: what exists so far. Read-only.
-- Run in the Supabase SQL editor; run it again after each later step.

select 'MBA2 students' as what, count(*)::text as value from public.students where cohort = 'MBA2'
union all
select 'Term VI subjects', count(*)::text from public.subjects where term = 'Term VI' and batch_label = 'MBA 2025-27'
union all
select 'Term VI sections', count(*)::text from public.sections where term = 'Term VI' and batch_label = 'MBA 2025-27'
union all
select 'Term VI enrollments', count(*)::text
  from public.enrollments e join public.students s on s.id = e.student_id
  where e.term = 'Term VI' and s.cohort = 'MBA2'
union all
select 'MBA2 students with no Term VI enrollment', count(*)::text
  from public.students s
  where s.cohort = 'MBA2'
    and not exists (select 1 from public.enrollments e where e.student_id = s.id and e.term = 'Term VI')
union all
select 'Term VI nominations', count(*)::text from public.sr_nominations where term = 'Term VI'
union all
select 'Term VI SRs published', count(*)::text from public.sr_assignments where term = 'Term VI'
union all
select 'Vote table sr_votes_term_vi',
       case when to_regclass('public.sr_votes_term_vi') is null then 'MISSING (run step 2)' else 'exists' end;
