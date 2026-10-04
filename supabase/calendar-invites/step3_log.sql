-- STEP 3 of 4 — Calendar invites: the activity log
-- Run in Supabase → SQL Editor after step 2. Paste the whole file and click Run.
--
-- Every create / update / delete the Apps Script carries out is written here, with
-- whether it emailed students. This is what you check when someone says
-- "I never got told my class moved".

do $$
begin
  create table if not exists calendar_invite_log (
    id            bigserial primary key,
    created_at    timestamptz not null default now(),
    op            text not null,          -- 'create' | 'update' | 'delete'
    key           text not null,
    event_id      text not null,
    batch_label   text,
    summary       text,
    start_at      timestamptz,
    send_updates  text,                   -- 'all' = students were emailed, 'none' = silent
    ok            boolean not null,
    error         text
  );
  create index if not exists calendar_invite_log_created_at_idx on calendar_invite_log (created_at desc);
  alter table calendar_invite_log enable row level security;
end $$;
