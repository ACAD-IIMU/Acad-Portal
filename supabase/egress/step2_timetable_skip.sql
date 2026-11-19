-- STEP 2 — CPU fix: let the hourly timetable sync skip when the sheet hasn't changed.
-- Run in Supabase → SQL Editor BEFORE (or right after) deploying the cpu-fix code.
-- Paste the whole file and click Run. Safe to run more than once. Changes no existing data.
--
-- Why: cron-job.org calls /api/sync-timetable every hour for each batch. Every call used to
-- download the workbook from Drive, parse it and rewrite sessions + important_events even when
-- nothing had changed — ~2 s of Vercel Active CPU per call (Hobby includes only 4 h a month).
--
-- This table remembers, per batch, which version of the Drive file was last synced in full.
-- The route compares that with Drive's current version and skips when they match. If this
-- table is missing, the route just syncs in full every time (exactly the old behaviour).
--
-- To force one full sync without a deploy, either open
--   https://acad-student-portal.vercel.app/api/sync-timetable?batch=mba2&force=1&secret=YOUR_SYNC_SECRET
-- or clear the remembered version:
--   delete from timetable_sync_state where batch = 'mba2';

create table if not exists public.timetable_sync_state (
  batch            text primary key,        -- 'mba1' / 'mba2' (the ?batch= value)
  file_fingerprint text not null,           -- Drive version | modifiedTime | md5 | term | batch | deployed commit
  synced_at        timestamptz not null default now()
);

-- Only the server (service role) touches this table; students never need it.
alter table public.timetable_sync_state enable row level security;
revoke all on table public.timetable_sync_state from anon, authenticated;

-- Check: should return the two columns with no rows yet (rows appear after the next full sync).
select * from public.timetable_sync_state;
