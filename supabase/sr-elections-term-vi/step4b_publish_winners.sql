-- SR Elections, MBA2 Term VI — step 4b: publish the clear winners from step 4a
-- to sr_assignments, which is what the portal's Results tab and SR tools read.
--
-- Ties are skipped: add those by hand once ACAD decides, e.g.
--   insert into public.sr_assignments (term, subject_id, section_id, student_id)
--   values ('Term VI', '<subject id>', '<section id or null>', '<student id>');
-- Safe to re-run: never overwrites a race that already has an SR.
-- The result is the SRs now published for Term VI.

with candidates as (
  select distinct n.subject_id, n.section_id, n.student_id
  from public.sr_nominations n
  where n.term = 'Term VI'
),
tally as (
  select c.*,
         (select count(*) from public.sr_votes_term_vi v
           where v.subject_id = c.subject_id
             and v.section_id is not distinct from c.section_id
             and v.candidate_student_id = c.student_id) as votes
  from candidates c
),
ranked as (
  select t.*, rank() over (partition by subject_id, section_id order by votes desc) as place
  from tally t
),
winners as (
  select r.subject_id, r.section_id, r.student_id
  from ranked r
  where r.place = 1
    and (select count(*) from ranked r2
          where r2.subject_id = r.subject_id
            and r2.section_id is not distinct from r.section_id
            and r2.place = 1) = 1
)
insert into public.sr_assignments (term, subject_id, section_id, student_id)
select 'Term VI', w.subject_id, w.section_id, w.student_id
from winners w
where not exists (
  select 1 from public.sr_assignments a
  where a.term = 'Term VI' and a.subject_id = w.subject_id
    and a.section_id is not distinct from w.section_id);

select sub.name as course, sec.section_label as section, st.full_name as sr, st.reg_no
from public.sr_assignments a
join public.subjects sub on sub.id = a.subject_id
left join public.sections sec on sec.id = a.section_id
join public.students st on st.id = a.student_id
where a.term = 'Term VI'
order by 1, 2;
