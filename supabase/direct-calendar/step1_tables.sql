-- DIRECT MODE — STEP 1: tables and switches
-- Run in Supabase → SQL Editor. Paste the whole file and click Run. Changes nothing visible:
-- direct mode starts switched OFF.
--
-- Direct mode = the portal writes each student's classes straight into their own MAIN Google
-- Calendar (with the permission they gave at portal sign-in), instead of section calendars or
-- invites. Works on Android with no "Sync" step and needs nothing from students.
--
--   calendar_personal_ledger   one row per class copy in a student's calendar
--   students.personal_ready_at all of the student's upcoming classes are in their calendar
--                              → they come off the old acad@ invites
--   students.personal_off_at   student left direct mode → copies removed 90 min later
--   google_tokens.events_error the student's Google permission stopped working → back to invites

do $$
begin
  create table if not exists calendar_personal_ledger (
    student_id     uuid not null references students(id) on delete cascade,
    origin         text not null,            -- the timetable entry (same id as the acad@ events)
    batch_label    text not null,
    event_id       text not null,            -- 'acadp…' event id in the student's calendar
    content_hash   text not null,
    summary        text,
    start_at       timestamptz not null,
    end_at         timestamptz not null,
    all_day        boolean not null default false,
    location       text,
    missing_since  timestamptz,
    cancelled_at   timestamptz,
    updated_at     timestamptz not null default now(),
    primary key (student_id, origin)
  );
  create index if not exists calendar_personal_ledger_batch_idx on calendar_personal_ledger (batch_label);
  alter table calendar_personal_ledger enable row level security;

  alter table students add column if not exists personal_ready_at timestamptz;
  alter table students add column if not exists personal_off_at timestamptz;
  alter table google_tokens add column if not exists events_error text;
  alter table google_tokens add column if not exists events_error_at timestamptz;

  alter table calendar_invite_settings add column if not exists personal_enabled boolean not null default false;
  alter table calendar_invite_settings add column if not exists personal_pilot_reg_nos text[];
  alter table calendar_invite_settings add column if not exists personal_max_ops_per_run int not null default 900;
end $$;
