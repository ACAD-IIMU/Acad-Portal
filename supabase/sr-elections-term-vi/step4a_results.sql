-- SR Elections, MBA2 Term VI — step 4a: after voting closes, the results for
-- ACAD to review. Read-only.
--
-- A race = one course + section. Every nominee is listed, including ones with
-- 0 votes. Races nobody was nominated for are listed with "(no nominees)".

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
  select t.*,
         rank() over (partition by subject_id, section_id order by votes desc) as place,
         count(*) over (partition by subject_id, section_id) as candidates_in_race
  from tally t
),
firsts as (
  select subject_id, section_id, count(*) as tied_for_first
  from ranked where place = 1
  group by 1, 2
),
races as (
  select distinct e.subject_id, e.section_id
  from public.enrollments e
  join public.subjects sub on sub.id = e.subject_id
  where e.term = 'Term VI' and sub.batch_label = 'MBA 2025-27'
)
select sub.name as course,
       sec.section_label as section,
       st.full_name as candidate,
       st.reg_no,
       r.votes,
       r.place,
       case
         when r.place = 1 and f.tied_for_first > 1 then 'TIE — ACAD decides'
         when r.place = 1 and r.candidates_in_race = 1 then 'WINS (unopposed)'
         when r.place = 1 then 'WINS'
       end as outcome
from ranked r
join firsts f on f.subject_id = r.subject_id and f.section_id is not distinct from r.section_id
join public.subjects sub on sub.id = r.subject_id
left join public.sections sec on sec.id = r.section_id
join public.students st on st.id = r.student_id

union all

select sub.name, sec.section_label, '(no nominees)', null, null, null, 'NO SR unless ACAD appoints one'
from races rc
join public.subjects sub on sub.id = rc.subject_id
left join public.sections sec on sec.id = rc.section_id
where not exists (
  select 1 from candidates c
  where c.subject_id = rc.subject_id and c.section_id is not distinct from rc.section_id)

order by 1, 2, 6 nulls last, 3;
