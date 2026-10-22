-- STEP 3 of 5 — Phone notifications (Web Push)
-- Run in Supabase → SQL Editor after step 2. Paste the whole file and click Run.
--
--   push_subscriptions   one row per phone/browser a student turned "class alerts" on for
--   push_log             one row per student notified — what you check when someone says
--                        "I was never told my class moved"
--
-- No RLS policies on purpose: only the server (service role key) reads or writes these.

do $$
begin
  create table if not exists push_subscriptions (
    id               bigserial primary key,
    student_id       uuid not null references students(id) on delete cascade,
    endpoint         text not null unique,
    p256dh           text not null,
    auth             text not null,
    user_agent       text,
    created_at       timestamptz not null default now(),
    last_success_at  timestamptz,
    failure_count    int not null default 0
  );
  create index if not exists push_subscriptions_student_idx on push_subscriptions (student_id);

  create table if not exists push_log (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    student_id  uuid,
    title       text,
    body        text,
    devices     int not null default 0,
    delivered   int not null default 0,
    error       text
  );
  create index if not exists push_log_created_at_idx on push_log (created_at desc);

  alter table push_subscriptions enable row level security;
  alter table push_log enable row level security;
end $$;
