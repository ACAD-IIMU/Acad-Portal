-- Free-tier optimisation, step 1 (Nov 2026): database tidy-up.
-- Safe to run with any version of the portal code — it changes no data and no behaviour,
-- only how fast the database answers and who may call two internal functions.
--
-- 1. Access rules (RLS): ask "who is signed in?" once per query instead of once per row.
--    Wrapping auth.uid() / current_student_id() in (select …) lets Postgres work it out once.
--    Every rule below keeps exactly the same meaning.
-- 2. One duplicate preread rule removed (it was identical to the one kept).
-- 3. Indexes on the 20 foreign keys Supabase flagged.
-- 4. Two internal functions: fixed search_path; logged-out visitors can no longer call
--    get_my_credits / rls_auto_enable through the API.
-- 5. Full calendar safety check every 12 h instead of every 3 h (lib/syncGate.ts).

-- 1. Access rules -------------------------------------------------------------------------

alter policy "students see own row" on public.students
  using (auth_user_id = (select auth.uid()));

alter policy "anyone authenticated reads subjects" on public.subjects
  using ((select auth.uid()) is not null);
alter policy "anyone authenticated reads sections" on public.sections
  using ((select auth.uid()) is not null);
alter policy "authenticated users read sr_assignments" on public.sr_assignments
  using ((select auth.uid()) is not null);

alter policy "students see own eap points" on public.stg_eap_points_term5_v2
  using (reg_no = (select s.reg_no from public.students s where s.auth_user_id = (select auth.uid())));
alter policy "students see own eap points" on public.stg_eap_points_term6
  using (reg_no = (select s.reg_no from public.students s where s.auth_user_id = (select auth.uid())));
alter policy "students see own course workshop attendance" on public.eap_course_workshop_attendance_t5
  using (reg_no = (select s.reg_no from public.students s where s.auth_user_id = (select auth.uid())));
alter policy "students see own eap points" on public.eap_course_workshop_attendance_t6
  using (reg_no = (select s.reg_no from public.students s where s.auth_user_id = (select auth.uid())));

alter policy "students see own votes" on public.sr_votes_term_ii
  using (student_id = (select s.id from public.students s where s.auth_user_id = (select auth.uid())));
alter policy "students insert own votes" on public.sr_votes_term_ii
  with check (student_id = (select s.id from public.students s where s.auth_user_id = (select auth.uid())));
alter policy "select own votes" on public.sr_votes_term_v
  using (student_id in (select s.id from public.students s where s.auth_user_id = (select auth.uid())));
alter policy "insert own votes" on public.sr_votes_term_v
  with check (student_id in (select s.id from public.students s where s.auth_user_id = (select auth.uid())));

alter policy "students see own enrollments" on public.enrollments
  using (student_id = (select public.current_student_id()));

alter policy "students see sessions they're enrolled in" on public.sessions
  using (exists (
    select 1 from public.enrollments e
    where e.student_id = (select public.current_student_id())
      and e.subject_id = sessions.subject_id
      and e.term = sessions.term
      and (e.section_id = sessions.section_id or (e.section_id is null and sessions.section_id is null))
  ));

alter policy "SR can update sessions for their own subject" on public.sessions
  using (exists (
    select 1 from public.sr_assignments sr
    where sr.subject_id = sessions.subject_id
      and sr.term = sessions.term
      and (sr.section_id = sessions.section_id or (sr.section_id is null and sessions.section_id is null))
      and sr.student_id = (select public.current_student_id())
  ))
  with check (exists (
    select 1 from public.sr_assignments sr
    where sr.subject_id = sessions.subject_id
      and sr.term = sessions.term
      and (sr.section_id = sessions.section_id or (sr.section_id is null and sessions.section_id is null))
      and sr.student_id = (select public.current_student_id())
  ));

alter policy "students see events for their own subjects" on public.important_events
  using (subject_id is null or exists (
    select 1 from public.enrollments e
    where e.student_id = (select public.current_student_id())
      and e.subject_id = important_events.subject_id
      and e.term = important_events.term
  ));

alter policy "students see prereads for their enrolled sessions" on public.prereads
  using (exists (
    select 1 from public.sessions s
    join public.enrollments e
      on e.subject_id = s.subject_id and e.term = s.term
     and (e.section_id = s.section_id or (e.section_id is null and s.section_id is null))
    where s.id = prereads.session_id
      and e.student_id = (select public.current_student_id())
  ));

alter policy "only the assigned SR can upload prereads" on public.prereads
  with check (exists (
    select 1 from public.sessions s
    join public.sr_assignments sr
      on sr.subject_id = s.subject_id and sr.term = s.term
     and (sr.section_id = s.section_id or (sr.section_id is null and s.section_id is null))
    where s.id = prereads.session_id
      and sr.student_id = (select public.current_student_id())
  ));

alter policy "SR can delete their own uploaded prereads" on public.prereads
  using (uploaded_by_sr = (select public.current_student_id()) and exists (
    select 1 from public.sessions s
    join public.sr_assignments sr
      on sr.subject_id = s.subject_id and sr.term = s.term
     and (sr.section_id = s.section_id or (sr.section_id is null and s.section_id is null))
    where s.id = prereads.session_id
      and sr.student_id = (select public.current_student_id())
  ));

alter policy "creators delete their own reminders" on public.reminders
  using (created_by = (select public.current_student_id()));
alter policy "students see own personal reminders" on public.reminders
  using (type = 'personal' and created_by = (select public.current_student_id()));
alter policy "students insert own personal reminders" on public.reminders
  with check (type = 'personal' and created_by = (select public.current_student_id()));
alter policy "students see sr announcements for their enrollment" on public.reminders
  using (type = 'sr_announcement' and exists (
    select 1 from public.enrollments e
    where e.student_id = (select public.current_student_id())
      and e.subject_id = reminders.subject_id
      and e.term = reminders.term
      and (e.section_id = reminders.section_id or (e.section_id is null and reminders.section_id is null))
  ));
alter policy "srs insert announcements for their assignment" on public.reminders
  with check (type = 'sr_announcement' and created_by = (select public.current_student_id()) and exists (
    select 1 from public.sr_assignments sa
    where sa.student_id = (select public.current_student_id())
      and sa.subject_id = reminders.subject_id
      and sa.term = reminders.term
      and (sa.section_id = reminders.section_id or (sa.section_id is null and reminders.section_id is null))
  ));

alter policy "students insert own nominations" on public.sr_nominations
  with check (student_id = (select public.current_student_id()));
alter policy "students see own nominations" on public.sr_nominations
  using (student_id = (select public.current_student_id()));

alter policy "students see own eap points" on public.eap_points
  using (reg_no = (select s.reg_no from public.students s where s.id = (select public.current_student_id())));
alter policy "students see own DER-1 selections" on public.eap_der1_selections
  using (reg_no = (select s.reg_no from public.students s where s.id = (select public.current_student_id())));

-- 2. Duplicate rule (identical to "students see prereads for their enrolled sessions") -----

drop policy if exists "students see prereads for their sessions" on public.prereads;

-- 3. Foreign-key indexes -------------------------------------------------------------------

create index if not exists enrollments_section_id_idx on public.enrollments (section_id);
create index if not exists enrollments_subject_id_idx on public.enrollments (subject_id);
create index if not exists important_events_subject_id_idx on public.important_events (subject_id);
create index if not exists prereads_session_id_idx on public.prereads (session_id);
create index if not exists prereads_uploaded_by_sr_idx on public.prereads (uploaded_by_sr);
create index if not exists reminders_created_by_idx on public.reminders (created_by);
create index if not exists reminders_section_id_idx on public.reminders (section_id);
create index if not exists reminders_subject_id_idx on public.reminders (subject_id);
create index if not exists sections_subject_id_idx on public.sections (subject_id);
create index if not exists sessions_section_id_idx on public.sessions (section_id);
create index if not exists sr_assignments_section_id_idx on public.sr_assignments (section_id);
create index if not exists sr_assignments_student_id_idx on public.sr_assignments (student_id);
create index if not exists sr_nominations_section_id_idx on public.sr_nominations (section_id);
create index if not exists sr_nominations_subject_id_idx on public.sr_nominations (subject_id);
create index if not exists sr_votes_term_ii_candidate_idx on public.sr_votes_term_ii (candidate_student_id);
create index if not exists sr_votes_term_ii_section_id_idx on public.sr_votes_term_ii (section_id);
create index if not exists sr_votes_term_ii_subject_id_idx on public.sr_votes_term_ii (subject_id);
create index if not exists sr_votes_term_v_candidate_idx on public.sr_votes_term_v (candidate_student_id);
create index if not exists sr_votes_term_v_section_id_idx on public.sr_votes_term_v (section_id);
create index if not exists sr_votes_term_v_subject_id_idx on public.sr_votes_term_v (subject_id);

-- 4. Internal functions ---------------------------------------------------------------------

alter function public.current_student_id() set search_path = public;
alter function public.sync_sessions_for_term(text, text, jsonb) set search_path = public;
-- current_student_id stays callable by everyone: the access rules above run it for every
-- query, signed in or not (it simply returns nothing for a logged-out visitor).
revoke execute on function public.get_my_credits() from anon, public;
grant execute on function public.get_my_credits() to authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;

-- 5. Full calendar safety check every 12 h (was 3 h) ---------------------------------------

update public.calendar_invite_settings set quiet_full_check_hours = 12 where id = 1;
