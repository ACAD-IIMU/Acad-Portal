-- STEP 2 of 4 — Calendar invites: the control panel (one row)
-- Run in Supabase → SQL Editor after step 1. Paste the whole file and click Run.
-- Runs as one statement block that creates the table AND its single row.
--
-- This one row is how you steer the system without touching code:
--   paused               true  = nothing happens. Starts paused on purpose.
--   enabled_batches      which batches get invites. Starts with MBA2 (2025-27) only.
--   silent_until         while this time is in the future, NO emails are sent at all
--                        (used for the first load, so nobody gets 100 invitation emails).
--   notify_window_hours  a change/cancellation of a class starting within this many
--                        hours sends an email; anything further away updates silently.
--   max_changes_per_run  safety brake: if one timetable sync would move/cancel more
--                        classes than this, everything is held until a human approves.
--   bulk_approved_until  set this a little into the future to approve a held big change.

do $$
begin
  create table if not exists calendar_invite_settings (
    id                   int primary key default 1 check (id = 1),
    paused               boolean not null default true,
    enabled_batches      text[] not null default array['MBA 2025-27'],
    silent_until         timestamptz,
    notify_window_hours  int not null default 48,
    max_changes_per_run  int not null default 25,
    bulk_approved_until  timestamptz,
    last_plan_at         timestamptz,
    last_ack_at          timestamptz,
    updated_at           timestamptz not null default now()
  );
  insert into calendar_invite_settings (id) values (1) on conflict (id) do nothing;
  alter table calendar_invite_settings enable row level security;
  alter table calendar_invite_ledger enable row level security;
end $$;
