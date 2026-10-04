-- STEP 1 of 4 — Calendar invites: the ledger
-- Run in Supabase → SQL Editor. Paste the WHOLE file and click Run.
-- (This file is a single statement on purpose — the SQL Editor only reports the last one.)
--
-- What this table is: ACAD's memory of what it has already put on acad@iimu.ac.in's
-- calendar. One row per calendar event. Every few minutes the portal compares "what the
-- timetable says now" with this table — anything different becomes a create / update /
-- delete for the Apps Script to carry out.
--
-- No RLS policies on purpose: only the server (service role key) may read or write it.

create table if not exists calendar_invite_ledger (
  key            text primary key,          -- stable identity, e.g. 'sess:<hash>' or 'evt:<hash>#p0'
  event_id       text not null unique,      -- the Google Calendar event ID ('acads…' / 'acade…')
  batch_label    text not null,             -- e.g. 'MBA 2025-27'
  content_hash   text not null,             -- fingerprint of title/time/room/description
  attendee_hash  text not null,             -- fingerprint of the guest list
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  location       text,
  missing_since  timestamptz,               -- first time the class vanished from the timetable
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
