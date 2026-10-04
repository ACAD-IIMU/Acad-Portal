/**
 * Legacy calendar cleanup
 * -----------------------
 * The old "Add to Google Calendar" button (POST /api/calendar/push → lib/googleCalendar.ts)
 * wrote class and quiz events straight into each student's OWN primary calendar, using
 * deterministic event IDs:
 *   - classes:          "sess" + session UUID without dashes   (36 chars)
 *   - quizzes / exams:  "evt"  + important_event UUID w/o dashes (35 chars)
 *
 * Once ACAD starts sending calendar invites from acad@iimu.ac.in, anyone who clicked that
 * button would see every class twice. This script finds those legacy events and, only
 * when told to, deletes them.
 *
 * Why this asks Google instead of reading Vercel logs or the database:
 *   - Vercel Hobby keeps runtime logs for 1 hour only, and the push route never recorded
 *     who clicked anyway.
 *   - Every student who has logged in has a row in google_tokens (Calendar scope is
 *     requested at login, not at click), so having a token does NOT mean they clicked.
 *   - Scanning each calendar for the "sess…/evt…" ID pattern is the only exact answer.
 *     It also catches orphaned "evt…" events whose source rows no longer exist, because
 *     important_events is wiped and re-inserted on every sync (new UUIDs each time).
 *
 * Usage (from the repo root; Node 20+ for --env-file):
 *   npx tsx --env-file=.env.local scripts/legacy-calendar-cleanup.ts
 *       → DRY RUN for everyone: counts only, deletes nothing.
 *   npx tsx --env-file=.env.local scripts/legacy-calendar-cleanup.ts --only=you@iimu.ac.in
 *       → DRY RUN for one student (test on yourself first).
 *   npx tsx --env-file=.env.local scripts/legacy-calendar-cleanup.ts --only=you@iimu.ac.in --apply
 *       → actually deletes, for that one student.
 *   npx tsx --env-file=.env.local scripts/legacy-calendar-cleanup.ts --apply
 *       → actually deletes, for everyone.
 *   Add --include-past to also touch events dated before today (default: today onward
 *   only, so nobody loses the record of classes they already attended).
 *   Add --cohort=MBA2 (or MBA1) to limit it to one batch — use this when invites are
 *   rolled out batch by batch.
 *
 * Output: a summary in the terminal, plus cleanup-report-<mode>-<timestamp>.csv in the
 * repo root. That CSV contains student emails and is git-ignored — never commit it
 * (the repo is public).
 *
 * Order of operations: the button must already be switched off in production (this same
 * change set does that) BEFORE running --apply, or new legacy events can appear behind
 * the cleanup.
 */

import { writeFileSync } from 'node:fs';
import { google, calendar_v3 } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ---------- arguments ----------

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_PAST = args.includes('--include-past');
const ONLY_EMAIL = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.trim().toLowerCase() ?? null;
// --cohort=MBA2 or --cohort=MBA1 — only students of that year label. Used so rolling out
// invites to one batch doesn't strip the other batch's old copies before their turn.
const ONLY_COHORT = args.find((a) => a.startsWith('--cohort='))?.split('=')[1]?.trim().toUpperCase() ?? null;

const unknownArgs = args.filter(
  (a) => a !== '--apply' && a !== '--include-past' && !a.startsWith('--only=') && !a.startsWith('--cohort=')
);
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(', ')}`);
  console.error('Valid: --apply, --include-past, --only=<email>, --cohort=MBA1|MBA2');
  process.exit(1);
}
if (ONLY_COHORT && ONLY_COHORT !== 'MBA1' && ONLY_COHORT !== 'MBA2') {
  console.error(`--cohort must be MBA1 or MBA2 (got "${ONLY_COHORT}")`);
  process.exit(1);
}

// ---------- environment ----------

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET'
] as const;
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`Missing environment variable(s): ${missingEnv.join(', ')}`);
  console.error('Run with: npx tsx --env-file=.env.local scripts/legacy-calendar-cleanup.ts');
  process.exit(1);
}

// ---------- constants ----------

// Exactly the two shapes lib/googleCalendar.ts produced — nothing else in a student's
// calendar can match (a lowercase prefix followed by exactly 32 lowercase hex chars).
const LEGACY_EVENT_ID = /^(sess|evt)[0-9a-f]{32}$/;

// The portal did not exist before batch 2025-27 joined, so nothing older can be ours.
// Used only with --include-past, to keep the scan bounded.
const EARLIEST_POSSIBLE = '2025-06-01T00:00:00+05:30';

const DELETE_CONCURRENCY = 5;
const CHUNK_PAUSE_MS = 150;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

// ---------- helpers ----------

type Status = 'clean' | 'found' | 'deleted' | 'partly_deleted' | 'token_dead' | 'error';

type ReportRow = {
  email: string;
  name: string;
  cohort: string;
  status: Status;
  legacyFound: number;
  deleted: number;
  sample: string;
  error: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errStatus(err: any): number | undefined {
  return err?.code ?? err?.status ?? err?.response?.status;
}

function isRateLimit(err: any): boolean {
  const status = errStatus(err);
  if (status === 429) return true;
  if (status !== 403) return false;
  const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason ?? '';
  return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
}

// A revoked or expired refresh token surfaces as "invalid_grant" when the client tries
// to swap it for an access token. Common if the OAuth app is in "Testing" mode (7-day
// expiry) or the student removed the app's access from their Google account.
function isDeadToken(err: any): boolean {
  const text = String(err?.response?.data?.error ?? err?.message ?? '');
  return /invalid_grant/i.test(text) || errStatus(err) === 401;
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimit(err) || attempt >= MAX_RETRIES) throw err;
      await sleep(BASE_DELAY_MS * 2 ** attempt + Math.random() * 250);
    }
  }
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function describe(e: calendar_v3.Schema$Event): string {
  const when = e.start?.dateTime?.slice(0, 16) ?? e.start?.date ?? '?';
  return `${when} ${e.summary ?? '(untitled)'}`;
}

async function listLegacyEvents(calendar: calendar_v3.Calendar): Promise<calendar_v3.Schema$Event[]> {
  const timeMin = INCLUDE_PAST ? new Date(EARLIEST_POSSIBLE).toISOString() : new Date().toISOString();
  const found: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withBackoff(() =>
      calendar.events.list({
        calendarId: 'primary',
        timeMin,
        maxResults: 2500,
        showDeleted: false,
        pageToken,
        fields: 'nextPageToken,items(id,summary,start)'
      })
    );
    for (const e of res.data.items ?? []) {
      if (e.id && LEGACY_EVENT_ID.test(e.id)) found.push(e);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return found;
}

async function deleteEvents(calendar: calendar_v3.Calendar, events: calendar_v3.Schema$Event[]) {
  let deleted = 0;
  const failures: string[] = [];
  for (let i = 0; i < events.length; i += DELETE_CONCURRENCY) {
    const chunk = events.slice(i, i + DELETE_CONCURRENCY);
    await Promise.all(
      chunk.map(async (e) => {
        try {
          await withBackoff(() =>
            calendar.events.delete({ calendarId: 'primary', eventId: e.id!, sendUpdates: 'none' })
          );
          deleted++;
        } catch (err: any) {
          const status = errStatus(err);
          // 404/410 = already gone (the student deleted it themselves) — that's success.
          if (status === 404 || status === 410) {
            deleted++;
          } else {
            failures.push(`${e.id}: ${err?.message ?? status}`);
          }
        }
      })
    );
    if (i + DELETE_CONCURRENCY < events.length) await sleep(CHUNK_PAUSE_MS);
  }
  return { deleted, failures };
}

// ---------- main ----------

async function main() {
  const mode = APPLY ? 'APPLY (deleting)' : 'DRY RUN (counting only)';
  console.log(`\nLegacy calendar cleanup — ${mode}`);
  console.log(`Window: ${INCLUDE_PAST ? 'all dates since June 2025' : 'today onward'}`);
  if (ONLY_EMAIL) console.log(`Only: ${ONLY_EMAIL}`);
  if (ONLY_COHORT) console.log(`Only cohort: ${ONLY_COHORT}`);
  console.log('');

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data, error } = await supabase
    .from('google_tokens')
    .select('student_id, refresh_token, students(email, full_name, cohort)')
    .range(0, 4999);
  if (error) {
    console.error('Could not read google_tokens:', error.message);
    process.exit(1);
  }

  type TokenRow = {
    student_id: string;
    refresh_token: string;
    students: { email: string; full_name: string; cohort: string } | null;
  };
  let rows = (data ?? []) as unknown as TokenRow[];
  if (ONLY_EMAIL) rows = rows.filter((r) => r.students?.email?.toLowerCase() === ONLY_EMAIL);
  if (ONLY_COHORT) rows = rows.filter((r) => r.students?.cohort?.toUpperCase() === ONLY_COHORT);

  if (rows.length === 0) {
    console.log(ONLY_EMAIL ? `No stored Google token for ${ONLY_EMAIL}.` : 'No stored Google tokens at all.');
    return;
  }
  console.log(`Students with a stored Google token: ${rows.length}\n`);

  const report: ReportRow[] = [];

  for (const [index, row] of rows.entries()) {
    const email = row.students?.email ?? `(student ${row.student_id})`;
    const base: ReportRow = {
      email,
      name: row.students?.full_name ?? '',
      cohort: row.students?.cohort ?? '',
      status: 'clean',
      legacyFound: 0,
      deleted: 0,
      sample: '',
      error: ''
    };

    const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: row.refresh_token });
    const calendar = google.calendar({ version: 'v3', auth: oauth });

    try {
      const legacy = await listLegacyEvents(calendar);
      base.legacyFound = legacy.length;
      base.sample = legacy.slice(0, 2).map(describe).join(' | ');

      if (legacy.length === 0) {
        base.status = 'clean';
      } else if (!APPLY) {
        base.status = 'found';
      } else {
        const { deleted, failures } = await deleteEvents(calendar, legacy);
        base.deleted = deleted;
        base.status = failures.length === 0 ? 'deleted' : 'partly_deleted';
        base.error = failures.slice(0, 3).join(' ; ');
      }
    } catch (err: any) {
      base.status = isDeadToken(err) ? 'token_dead' : 'error';
      base.error = String(err?.response?.data?.error ?? err?.message ?? err);
    }

    report.push(base);
    const progress = `[${index + 1}/${rows.length}]`;
    const detail =
      base.status === 'found' || base.status === 'deleted' || base.status === 'partly_deleted'
        ? ` legacy=${base.legacyFound}${APPLY ? ` deleted=${base.deleted}` : ''}`
        : '';
    console.log(`${progress} ${email} → ${base.status}${detail}`);
  }

  // ---------- summary ----------
  const count = (s: Status) => report.filter((r) => r.status === s).length;
  const withLegacy = report.filter((r) => r.legacyFound > 0);
  const totalLegacy = report.reduce((sum, r) => sum + r.legacyFound, 0);
  const totalDeleted = report.reduce((sum, r) => sum + r.deleted, 0);

  console.log('\n──────── Summary ────────');
  console.log(`Calendars scanned:               ${report.length}`);
  console.log(`Students who used the button:    ${withLegacy.length}   (have ≥1 legacy event in the window)`);
  console.log(`Legacy events found:             ${totalLegacy}`);
  if (APPLY) console.log(`Legacy events deleted:           ${totalDeleted}`);
  console.log(`Clean calendars:                 ${count('clean')}`);
  console.log(`Dead tokens (can't check):       ${count('token_dead')}`);
  console.log(`Other errors:                    ${count('error') + count('partly_deleted')}`);
  for (const cohort of [...new Set(withLegacy.map((r) => r.cohort))].sort()) {
    console.log(`  ${cohort || '(no cohort)'}: ${withLegacy.filter((r) => r.cohort === cohort).length} students`);
  }

  const header = ['email', 'name', 'cohort', 'status', 'legacy_found', 'deleted', 'sample', 'error'];
  const lines = [header.join(',')].concat(
    report.map((r) =>
      [r.email, r.name, r.cohort, r.status, r.legacyFound, r.deleted, r.sample, r.error].map(csvCell).join(',')
    )
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = `cleanup-report-${APPLY ? 'apply' : 'dryrun'}-${stamp}.csv`;
  writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`\nReport written: ${file}  (contains emails — do not commit)\n`);
}

main().catch((err) => {
  console.error('Fatal:', err?.message ?? err);
  process.exit(1);
});
