-- ACAD Student Portal — core schema for Login + Home
-- Run this in Supabase SQL Editor. Assumes RLS is on for every table by default.
--
-- Login flow assumption: ACAD pre-provisions the `students` table (reg_no, full_name,
-- cohort, batch_label, email) from the official roster BEFORE a student first signs in —
-- e.g. via a one-time CSV import or a sync job from the existing Google Sheet. On first
-- Google sign-in, the callback route matches the account's email against this table and
-- links `auth_user_id`. If no match is found, the student can't proceed (see auth/callback
-- route) — this deliberately prevents a random @iimu.ac.in account from self-provisioning
-- into the portal.

create extension if not exists "pgcrypto";

-- One row per student, linked to their Supabase auth identity.
create table students (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,     -- matched against the Google account email on first login
  reg_no text not null unique,
  full_name text not null,
  cohort text not null,          -- e.g. 'MBA1' or 'MBA2' (per the Home/EAP year-label distinction)
  batch_label text not null,     -- e.g. 'MBA 2025-27'
  created_at timestamptz not null default now()
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  term text not null              -- e.g. 'Term IV'
);

-- Sections are per-subject, not per-student. section_label is nullable —
-- a subject with no sectioning has section rows with section_label = null.
create table sections (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  term text not null,
  section_label text              -- null = subject is not sectioned
);

-- The corrected enrollment model: section lives here, scoped per (student, subject, term).
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  term text not null,
  section_id uuid references sections(id),   -- null = subject has no sectioning
  unique (student_id, subject_id, term)
);

-- One row per class meeting.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  term text not null,
  section_id uuid references sections(id),   -- must match the student's enrollment section (or null)
  session_date date not null,
  start_time time not null,
  end_time time not null,
  faculty_name text,
  room text
);

-- Preread requirement + SR-uploaded file reference, one per session.
create table prereads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions(id) on delete cascade,
  required boolean not null default true,      -- distinguishes "none required" vs "missing"
  drive_file_id text,                          -- null until SR uploads
  uploaded_by_sr uuid references students(id),
  uploaded_at timestamptz
);

-- One-off calendar events: quizzes, endterm, etc. — not part of the recurring weekly pattern.
create table important_events (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  event_date date not null,
  type text not null check (type in ('quiz','endterm','other')),
  label text not null,
  subject_id uuid references subjects(id)
);

-- Server-only: refresh tokens for pushing to each student's own Google Calendar.
-- No RLS policy is added on purpose — RLS is enabled with zero policies, so only
-- the service-role key (used server-side in the API route) can touch this table.
create table google_tokens (
  student_id uuid primary key references students(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  scope text,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table students enable row level security;
alter table subjects enable row level security;
alter table sections enable row level security;
alter table enrollments enable row level security;
alter table sessions enable row level security;
alter table prereads enable row level security;
alter table important_events enable row level security;
alter table google_tokens enable row level security; -- no policies = deny-all except service role

-- Helper: resolve the calling user's student row.
create or replace function current_student_id() returns uuid
language sql stable security definer as $$
  select id from students where auth_user_id = auth.uid();
$$;

create policy "students see own row" on students
  for select using (auth_user_id = auth.uid());

create policy "anyone authenticated reads subjects" on subjects
  for select using (auth.uid() is not null);

create policy "anyone authenticated reads sections" on sections
  for select using (auth.uid() is not null);

create policy "students see own enrollments" on enrollments
  for select using (student_id = current_student_id());

create policy "students see sessions they're enrolled in" on sessions
  for select using (
    exists (
      select 1 from enrollments e
      where e.student_id = current_student_id()
        and e.subject_id = sessions.subject_id
        and e.term = sessions.term
        and (e.section_id = sessions.section_id or (e.section_id is null and sessions.section_id is null))
    )
  );

create policy "students see prereads for their sessions" on prereads
  for select using (
    exists (
      select 1 from sessions s
      join enrollments e on e.subject_id = s.subject_id and e.term = s.term
        and (e.section_id = s.section_id or (e.section_id is null and s.section_id is null))
      where s.id = prereads.session_id
        and e.student_id = current_student_id()
    )
  );

create policy "anyone authenticated reads important events" on important_events
  for select using (auth.uid() is not null);
