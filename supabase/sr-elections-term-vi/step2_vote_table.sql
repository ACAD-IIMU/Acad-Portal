-- SR Elections, MBA2 Term VI — step 2: create sr_votes_term_vi.
-- Must exist before voting opens (see lib/srElections.ts), or every vote fails.
-- Safe to run more than once.

-- Same columns, defaults, constraints and indexes as the Term V table.
create table if not exists public.sr_votes_term_vi (like public.sr_votes_term_v including all);

-- LIKE doesn't copy foreign keys, so add them.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sr_votes_term_vi_student_fk') then
    alter table public.sr_votes_term_vi
      add constraint sr_votes_term_vi_student_fk foreign key (student_id) references public.students(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sr_votes_term_vi_candidate_fk') then
    alter table public.sr_votes_term_vi
      add constraint sr_votes_term_vi_candidate_fk foreign key (candidate_student_id) references public.students(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sr_votes_term_vi_subject_fk') then
    alter table public.sr_votes_term_vi
      add constraint sr_votes_term_vi_subject_fk foreign key (subject_id) references public.subjects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sr_votes_term_vi_section_fk') then
    alter table public.sr_votes_term_vi
      add constraint sr_votes_term_vi_section_fk foreign key (section_id) references public.sections(id);
  end if;
end $$;

-- Students may read and insert only their own votes, like the Term V table.
alter table public.sr_votes_term_vi enable row level security;

drop policy if exists "select own votes" on public.sr_votes_term_vi;
create policy "select own votes" on public.sr_votes_term_vi
  for select to authenticated
  using (student_id = (select public.current_student_id()));

drop policy if exists "insert own votes" on public.sr_votes_term_vi;
create policy "insert own votes" on public.sr_votes_term_vi
  for insert to authenticated
  with check (student_id = (select public.current_student_id()));

-- Check: should list the two policies above.
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'sr_votes_term_vi';
