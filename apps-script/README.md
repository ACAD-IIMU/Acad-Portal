# ACAD calendar invites — how it works and how to run it

## In one paragraph

acad@iimu.ac.in owns one Google Calendar event per class, with that class's students as
guests. Google shows the event on every guest's own calendar and keeps it in sync, so
when the timetable changes, ACAD changes **one** event and every student's calendar
follows. First load and far-off changes are silent. Only a move, room change or
cancellation of a class starting within the next 48 hours emails the affected students.

## The pieces

| Piece | Where it lives | Job |
|---|---|---|
| Timetable sync | `app/api/sync-timetable` (portal) | Reads the timetable sheet into Supabase. Daily via Vercel, every 10 min via cron-job.org |
| The brain | `lib/calendarInvites.ts` + `app/api/calendar/invites/plan` | Compares the timetable with what is already on the calendar and lists what to change |
| The hands | `apps-script/acad-calendar-sync.gs` (pasted into script.google.com **as acad@**) | Every 5 min: asks for the list, changes the calendar, reports back |
| The memory | Supabase tables `calendar_invite_ledger`, `_settings`, `_log` | What is on the calendar, the on/off switches, and an activity log |
| Old-copy cleanup | `scripts/legacy-calendar-cleanup.ts` | Removes the copies the retired "Add to Google Calendar" button made |

## Safety features

- **Starts paused.** Nothing happens until `step5_go_live.sql` is run.
- **Silent first load.** The first load for a batch never emails anyone.
- **Settle window.** The 10-minute sync skips a run if the sheet was edited in the last 3 minutes, so half-finished edits are never sent.
- **Grace period.** A class that disappears is only removed after it has been missing for 8 minutes.
- **Safety brake.** If more than 25 events would move or be cancelled at once, everything is held and acad@ is emailed. Approve with `control_approve_big_change.sql` once you've checked the sheet.
- **Empty-timetable guard.** If a batch's timetable suddenly reads as empty, nothing is removed.
- **Past classes are never touched.**
- **Emergency stop.** Run `control_pause.sql`.

## Rollout runbook (first time)

### Part 1 — Secret (Vercel)
1. In Git Bash, run `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` and copy the long code it prints. This is the secret shared by the portal and the Apps Script.
2. Go to Vercel → project → Settings → Environment Variables → Add.
   - Key: `CALENDAR_SYNC_SECRET`
   - Value: the code
   - Environments: Production and Preview
   - Save.

### Part 2 — Code
1. In Git Bash, run `git pull`.
2. Copy the new and changed files into the project.
3. Run `npx tsc --noEmit`. It should print nothing.
4. Commit and push.
5. Wait for the Vercel deployment to go green.

### Part 3 — Database (Supabase → SQL Editor)
Run `step1_ledger.sql`, `step2_settings.sql`, `step3_log.sql` and `step4_verify.sql` in that order, one file at a time. Step 4 should show `paused = true` and zero rows.

### Part 4 — Preview (browser)
Open `https://acad-student-portal.vercel.app/api/calendar/invites/plan?secret=YOUR_SECRET`. Nothing is changed by this. Check:
- `perBatch → MBA 2025-27 → creates` is roughly the number of upcoming classes plus events
- `emails` = 0
- `silent` = true
- `classesWithNoStudents` is 0 or very small

### Part 5 — Apps Script (as acad@)
1. Open a Chrome window signed in **only** to acad@iimu.ac.in. Apps Script misbehaves when several Google accounts are signed in.
2. Go to script.google.com → New project → rename it to `ACAD Calendar Sync`.
3. Delete the sample code. Paste all of `acad-calendar-sync.gs`. Save.
4. In the left bar, click Services (+) → Google Calendar API → Add.
5. Gear icon (Project Settings) → Script properties → Add script property:
   - `CALENDAR_SYNC_SECRET` = the same code as in Vercel
   - Save.
6. Back in the editor, choose `previewPlan` in the function dropdown → Run → approve the permissions. If you see "Google hasn't verified this app", click Advanced → Go to ACAD Calendar Sync. It's your own script.
7. The execution log should show the same numbers as Part 4.

### Part 6 — Remove old copies (laptop, Git Bash)
1. Dry run: `npx tsx --env-file=.env.local scripts/legacy-calendar-cleanup.ts --cohort=MBA2`
2. Apply: `npx tsx --env-file=.env.local scripts/legacy-calendar-cleanup.ts --cohort=MBA2 --apply`

### Part 7 — Go live
1. Supabase: run `step5_go_live.sql`.
2. Apps Script: choose `setupOnce` → Run. This creates the 5-minute timer.
3. Wait 10–30 minutes. Run `check_progress.sql` and watch `events_on_calendar` rise.
4. Check your own Google Calendar.

### Part 8 — Faster timetable sync (cron-job.org)
1. Create a free account at cron-job.org.
2. Create a cron job:
   - URL: `https://acad-student-portal.vercel.app/api/sync-timetable?batch=mba2&settle=180&secret=SYNC_SECRET_VALUE`
   - `SYNC_SECRET_VALUE` is the existing `SYNC_SECRET` from Vercel's environment variables.
   - Schedule: every 10 minutes.

## Later: adding MBA1 (2026-28)

1. Confirm MBA1 enrollments exist for its current term.
2. Run in Supabase: `update calendar_invite_settings set enabled_batches = array['MBA 2025-27','MBA 2026-28'], silent_until = now() + interval '3 hours' where id = 1;`
3. Clean up old copies with `--cohort=MBA1` (dry run, then `--apply`).
4. Add a second cron-job.org job with `batch=mba1`.

## Each new term

Update the term constant (`lib/term5.ts` / `lib/term2.ts`). The calendar follows automatically: new-term classes are added and nothing in the past is touched.

## Day-to-day

| Situation | What to do |
|---|---|
| "Is it running?" | `check_progress.sql`. `last_plan_at` should be within about 5 minutes |
| "Did students get told?" | `check_recent_changes.sql`. `send_updates = all` means they were emailed |
| acad@ gets "on hold" email | Check the sheet. If the change is real, run `control_approve_big_change.sql` |
| Something looks wrong | Run `control_pause.sql`, then investigate |
| acad@ password changed | Open the Apps Script and run `previewPlan` once to re-approve its permissions |
