# ACAD calendar — how it works and how to run it

## In one paragraph

acad@iimu.ac.in owns one Google Calendar per section ("section calendars"), for example
`ACAD · Operations Management · Sec A (Term V)`, or for MBA1, whose sections are the same
class in every subject, simply `ACAD · Section A (Term II)` — plus one `Batch events`
calendar per batch. Each student is subscribed to their own sections' calendars. These
events have **no guest list**, so there are no invitation emails, no Accept / Decline, and
no RSVP replies flooding acad@'s inbox. When the timetable changes, ACAD changes one event
and every subscribed student's calendar follows. A class starting within the next 48 hours
that is added, moved, changes room or is cancelled sends a **phone notification to that
section's students only** — never an email, never the whole college. A last-minute
cancellation stays on the calendar as `❌ CANCELLED · …` instead of silently vanishing.
Every student also gets a 15-minute pop-up reminder before each class from the Google
Calendar app.

## The pieces

| Piece | Where it lives | Job |
|---|---|---|
| Timetable sync | `app/api/sync-timetable` (portal) | Reads the timetable sheet into Supabase. Daily via Vercel, every 10 min via cron-job.org |
| The brain | `lib/calendarInvites.ts` + `app/api/calendar/invites/plan` | Compares the timetable with what is on the calendars and lists what to change |
| The hands | `apps-script/acad-calendar-sync.gs` (pasted into script.google.com **as acad@**) | Every 5 min: creates section calendars, changes events, reports back |
| Subscribing students | `lib/calendarFeeds.ts` + `app/api/calendar/feeds/*` | Adds each student's section calendars to their own Google Calendar |
| Phone alerts | `lib/pushNotify.ts`, `public/sw.js`, `app/api/push/subscribe` | Web Push notifications for last-minute changes |
| Home card | `app/home/ClassCalendarCard.tsx` | "Class calendar & alerts": shows it worked, or one tap to finish |
| The memory | Supabase: `calendar_invite_ledger`, `_settings`, `_log`, `calendar_feeds`, `calendar_feed_subscriptions`, `push_subscriptions`, `push_log` | What is on the calendars, who has what, the switches, activity logs |

## How students get their calendars

- **Automatically.** Sign-in now also asks Google for permission to add calendars to the
  student's calendar list (`calendar.calendarlist` — it cannot read or change their own
  events). Right after sign-in, and every 5 minutes in the background, the portal adds any
  missing section calendars.
- **Students who haven't signed in since this release** see a "📅 Allow & add my class
  calendars" button on Home — one tap, one Google screen, done.
- **Phone alerts** need one tap per device ("🔔 Turn on class alerts" on Home), because the
  browser must ask the student. On iPhone the portal must first be added to the home screen
  (Share → Add to Home Screen) — the card explains this.

## Direct mode (current design): classes straight into each student's main calendar

Students found the section-calendar setup (Sync on Android, confirm button) a burden. In
direct mode the portal writes each student's classes **straight into their own main Google
Calendar**, using the Google permission they already gave when they signed in to the portal.
The main calendar shows on every phone with no setup, so **students do nothing**.

- Code: `lib/personalCalendar.ts`, run every 5 minutes in the background of
  `/api/calendar/invites/plan` — the first thing the Apps Script calls each run — so it never
  waits behind acad@'s own invite changes (no Apps Script change). ~3.5 min per run, 40 students
  at a time; each student's finished writes are saved immediately. Google's limits (600
  calls/min per student, 10,000/min per project) leave plenty of room.
- A student keeps the old acad@ invites until every upcoming class is in their calendar
  (`students.personal_ready_at`), then the invites and any ACAD section calendars are removed.
- No guests → no emails, no Yes/No buttons. Phone alerts still come from the main sync.
- Permission broken (revoked / unused 6 months) → automatically back on invites until they
  sign in again. Students who never signed in to the portal stay on invites.
- SQL: `supabase/direct-calendar/step1_tables.sql` (before merging), `step2_pilot.sql`
  (Thilak only), `step3_everyone.sql`, `check_progress.sql`, `control_switch_off.sql` (undo).

## Android: added calendars need "Sync" turned on

Adding a calendar to a student's Google account (what the portal does) makes it appear on the
web and in the iPhone Google Calendar app straight away. **Android's Google Calendar app does
not sync a newly added calendar until "Sync" is turned on for it** (app → ☰ → Settings → the
@iimu.ac.in account → each "ACAD · …" calendar → Sync). Google offers no API to switch this on.
So after the calendars are added, the Home card shows phone-specific steps and a button
"✓ I can see my ACAD classes on my phone" (stamps `students.calendar_confirmed_at`).
Only then is the student taken off the old guest invites.

## The move from old guest invites (automatic, nobody loses a class)

Old guest-invite events on acad@'s own calendar stay in place for every student until that
student has **all** of their section calendars, those calendars are fully filled in, and the
student has confirmed on Home that they can see them on their phone.
Then the student is quietly removed from the guest lists (no email). An old guest event is
deleted, silently, once nobody is left on it. From the moment this code is live, **no class
change emails anyone** — guest invites included. Students still on old guest invites get the
same phone alerts.

## Safety features

- **Calendars are created slowly.** At most 3 per run and 40 per day, well under the point
  where Google would put acad@ into read-only mode.
- **Filling a new calendar is silent.** Alerts only start once a calendar is in use.
- **Settle window.** The 10-minute sync skips a run if the sheet was edited in the last 3 minutes.
- **Grace period.** A class that disappears is only removed after it has been missing for 8 minutes.
- **Safety brake.** If more than 25 classes would move or be cancelled at once, everything is
  held and acad@ is emailed. Approve with `supabase/calendar-invites/control_approve_big_change.sql`.
- **Empty-timetable guard.** If a batch's timetable suddenly reads as empty, nothing is removed.
- **Past classes are never touched.**
- **Emergency stop.** `supabase/calendar-invites/control_pause.sql`.

## Rollout runbook — section calendars + phone alerts

Do these in order. Steps marked **(you)** need a person; everything else is automatic.

### 1. Stop the RSVP flood today (you, 1 minute)
Signed in as acad@: Google Calendar → ⚙ Settings → under "Settings for my calendars" click
acad@'s own calendar → "Other notifications" → **Event responses → None**.

### 2. Phone-alert keys (you, Vercel)
1. In Git Bash in the project folder: `npx web-push generate-vapid-keys`
2. Vercel → project → Settings → Environment Variables → add, for Production and Preview:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = the Public Key
   - `VAPID_PRIVATE_KEY` = the Private Key
   - `VAPID_SUBJECT` = `mailto:acad@iimu.ac.in`

### 3. Google permission (you, Google Cloud Console)
Project `acad-student-portal` → Google Auth Platform → **Data access** → Add or remove scopes →
add `https://www.googleapis.com/auth/calendar.calendarlist` → Update → Save. (The app is
Internal, so no Google verification is needed.)

### 4. Database (you, Supabase → SQL Editor) — BEFORE the code goes live
Run `supabase/calendar-feeds/step1_feeds.sql`, `step2_ledger_settings.sql`, `step3_push.sql`,
then `step4_verify.sql`, one file at a time. Step 4 should show `feeds_enabled = false` and
every table column `true`.

### 5. Code (you, Git Bash)
Copy the files in, then one line at a time: `git pull`, `npm install`, `npx tsc --noEmit`
(prints nothing), `git add -A`, `git commit -m "Section calendars and phone alerts instead of invite emails"`,
`git push`. Wait for the Vercel deployment to go green.

### 6. Apps Script (you, as acad@)
1. Chrome window signed in **only** to acad@iimu.ac.in → script.google.com → `ACAD Calendar Sync`.
2. Select all of the code, paste the new `apps-script/acad-calendar-sync.gs` over it, Save.
3. Choose `previewPlan` → Run (approve permissions if asked). The log should show the plan.
   The existing 5-minute timer keeps running; no need to run `setupOnce` again.

### 7. Preview (browser)
Open `https://acad-student-portal.vercel.app/api/calendar/invites/plan?secret=YOUR_CALENDAR_SYNC_SECRET`.
Nothing changes. `emailsStudents` is `false` everywhere.

### 8. Go live (you, Supabase)
Run `supabase/calendar-feeds/step5_turn_on_feeds.sql`. Then watch
`supabase/calendar-feeds/check_coverage.sql`: `calendars_created` climbs by about 3 every 5
minutes, then `students_subscribed` climbs as students are added.

### 9. Later — remove the last old invites (you, when coverage is near 100%)
Run `supabase/calendar-feeds/control_stop_old_invites.sql`.

### If acad@ gets "ACAD calendar sync: … change(s) failed" mentioning sharing
The Workspace admin has blocked sharing secondary calendars inside the domain. Ask IIMU IT
to allow internal calendar sharing ("Share all information") for iimu.ac.in.

## Faster timetable sync (cron-job.org) — already set up
- URL: `https://acad-student-portal.vercel.app/api/sync-timetable?batch=mba2&settle=180&secret=SYNC_SECRET_VALUE`
- Schedule: every 10 minutes. A second job with `batch=mba1`.

## Each new term
Update the term constant (`lib/term5.ts` / `lib/term2.ts`). New-term section calendars are
created and students subscribed automatically; nothing in the past is touched.

## Day-to-day

| Situation | What to do |
|---|---|
| "Is it running?" | `check_coverage.sql` — `last_plan_at` within about 5 minutes |
| "Did students get told?" | `push_log` (newest first) — who was alerted and on how many devices |
| A student says their calendar is missing | Ask them to open Home and tap the calendar button |
| acad@ gets "on hold" email | Check the sheet. If the change is real, run `control_approve_big_change.sql` |
| Something looks wrong | `control_pause.sql`, then investigate |
| acad@ password changed | Open the Apps Script and run `previewPlan` once to re-approve |
