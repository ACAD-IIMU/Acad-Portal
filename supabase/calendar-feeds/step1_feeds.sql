-- STEP 1 of 5 — Section calendars: the feed tables
-- Run in Supabase → SQL Editor. Paste the WHOLE file and click Run.
-- (One statement block on purpose — the SQL Editor only reports the last statement.)
--
-- What this is: instead of inviting every student as a GUEST on every class (which is
-- what caused the invitation emails and the "Accepted / Declined" flood in acad@'s inbox),
-- acad@iimu.ac.in now owns one Google Calendar per section ("feed"). Students are
-- subscribed to their own sections' calendars. A subscribed calendar has no guest list,
-- so there is nothing to accept, decline or reply to — and no email is ever sent.
--
--   calendar_feeds                 one row per section calendar (and one "batch events"
--                                  calendar per batch). calendar_id is filled in by the
--                                  Apps Script once it has created the calendar.
--   calendar_feed_subscriptions    which student has which calendar in their Google
--                                  Calendar list (only rows the portal verified with Google).
--
-- No RLS policies on purpose: only the server (service role key) reads or writes these.

do $$
begin
  create table if not exists calendar_feeds (
    key                  text primary key,            -- 'feed:<hash>'
    batch_label          text not null,               -- 'MBA 2025-27'
    term                 text not null,               -- 'Term V'
    kind                 text not null check (kind in ('class', 'section', 'batch')),
    subject_id           uuid,                        -- kind = 'class' only
    section_id           uuid,                        -- kind = 'class' only (null = unsectioned subject)
    section_label        text,                        -- kind = 'section' / 'class'
    title                text not null,               -- name shown in students' Google Calendar
    calendar_id          text unique,                 -- Google calendar ID, null until created
    calendar_created_at  timestamptz,
    filled_at            timestamptz,                 -- first time every class was on it
    created_at          timestamptz not null default now(),
    updated_at           timestamptz not null default now()
  );
  create index if not exists calendar_feeds_batch_idx on calendar_feeds (batch_label, term);

  create table if not exists calendar_feed_subscriptions (
    student_id     uuid not null references students(id) on delete cascade,
    feed_key       text not null references calendar_feeds(key) on delete cascade,
    calendar_id    text not null,
    method         text not null default 'auto',     -- 'auto' (background) | 'self' (student clicked)
    subscribed_at  timestamptz not null default now(),
    primary key (student_id, feed_key)
  );
  create index if not exists calendar_feed_subscriptions_feed_idx on calendar_feed_subscriptions (feed_key);

  -- Why a student could not be subscribed automatically (token revoked, permission not
  -- granted…). Retried automatically once the student signs in again.
  alter table google_tokens add column if not exists calendarlist_error text;
  alter table google_tokens add column if not exists calendarlist_error_at timestamptz;

  alter table calendar_feeds enable row level security;
  alter table calendar_feed_subscriptions enable row level security;
end $$;
