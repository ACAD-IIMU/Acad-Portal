// Putting the ACAD section calendars into each student's own Google Calendar.
//
// acad@iimu.ac.in owns the section calendars (lib/calendarInvites.ts decides which exist;
// the Apps Script creates them and shares them read-only with the iimu.ac.in domain).
// Sharing alone does not make a calendar appear in a student's Google Calendar — it has
// to be added to their calendar LIST. That is what this file does, with the Google
// permission the student granted at portal sign-in (calendar.calendarlist), stored as a
// refresh token in google_tokens:
//
//   - runAutoSubscribe()  in the background, every 5 minutes (called by the Apps Script),
//                         for every student whose sign-in included that permission
//   - subscribeStudent()  right after a student signs in, and when they press
//                         "Add my class calendars" on Home
//
// Each calendar is added with a 15-minute pop-up reminder before every class (the phone
// buzzes from the Google Calendar app) and NO email notifications.
//
// Only additions that Google confirmed are recorded in calendar_feed_subscriptions, because
// that table is what takes a student off the old guest invites — a student must never lose
// their guest invites on the strength of a link they may not have clicked.

import { google } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BATCH_TERMS, buildFeeds, fetchAll, loadBatchData, readSettings } from '@/lib/calendarInvites';
import { CALENDARLIST_SCOPE } from '@/lib/googleScopes';

const REMINDER_MINUTES = 15;
const PARALLEL_STUDENTS = 4;

type TokenRow = {
  student_id: string;
  refresh_token: string | null;
  scope: string | null;
  updated_at: string;
  calendarlist_error: string | null;
  calendarlist_error_at: string | null;
};

type Todo = { feedKey: string; calendarId: string };

export type FeedStatus = {
  feedKey: string;
  title: string;
  ready: boolean; // the calendar exists
  added: boolean; // verified to be in the student's Google Calendar
  addUrl: string | null; // manual fallback: opens Google Calendar's "add this calendar" screen
};

export type StudentCalendarStatus = {
  enabled: boolean; // section calendars switched on for this student's batch
  feeds: FeedStatus[];
  allAdded: boolean;
  needsPermission: boolean; // must sign in again to grant calendar-list permission
  confirmed: boolean; // student confirmed the ACAD calendars show on their phone
};

const TOKEN_COLUMNS = 'student_id, refresh_token, scope, updated_at, calendarlist_error, calendarlist_error_at';

export function addUrlFor(calendarId: string): string {
  const cid = Buffer.from(calendarId, 'utf8').toString('base64').replace(/=+$/, '');
  return `https://calendar.google.com/calendar/u/0?cid=${cid}`;
}

function tokenUsable(t: TokenRow | null | undefined): boolean {
  if (!t?.refresh_token) return false;
  if (!(t.scope ?? '').includes(CALENDARLIST_SCOPE)) return false;
  // A token that already failed is only retried once the student has signed in again.
  if (t.calendarlist_error && t.calendarlist_error_at && Date.parse(t.calendarlist_error_at) >= Date.parse(t.updated_at)) {
    return false;
  }
  return true;
}

type Failure = 'already' | 'permission' | 'token' | 'notVisible' | 'other';

function classify(err: any): Failure {
  const status = err?.response?.status ?? (typeof err?.code === 'number' ? err.code : undefined);
  const data = err?.response?.data;
  const text = `${err?.message ?? ''} ${JSON.stringify(data ?? '')}`;
  if (/invalid_grant/i.test(text) || status === 401) return 'token';
  if (status === 409 || /already exists|duplicate/i.test(text)) return 'already';
  if (status === 403 && /insufficient|scope|permission/i.test(text)) return 'permission';
  if (status === 404) return 'notVisible'; // sharing can take a moment to reach the student
  return 'other';
}

async function addCalendars(
  admin: SupabaseClient,
  token: TokenRow,
  todo: Todo[],
  method: 'auto' | 'self'
): Promise<{ added: number; problem: Failure | null; error: string | null }> {
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: token.refresh_token });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const added: Todo[] = [];
  let problem: Failure | null = null;
  let error: string | null = null;

  for (const t of todo) {
    try {
      await calendar.calendarList.insert({
        requestBody: {
          id: t.calendarId,
          selected: true,
          hidden: false,
          defaultReminders: [{ method: 'popup', minutes: REMINDER_MINUTES }]
        }
      });
      added.push(t);
    } catch (err: any) {
      const kind = classify(err);
      if (kind === 'already') {
        added.push(t);
        continue;
      }
      error = String(err?.message ?? err).slice(0, 300);
      if (kind === 'permission' || kind === 'token') {
        problem = kind;
        break; // every other calendar would fail the same way
      }
      problem = problem ?? kind;
    }
  }

  const nowIso = new Date().toISOString();
  if (added.length > 0) {
    const rows = added.map((t) => ({
      student_id: token.student_id,
      feed_key: t.feedKey,
      calendar_id: t.calendarId,
      method,
      subscribed_at: nowIso
    }));
    const { error: upsertError } = await admin
      .from('calendar_feed_subscriptions')
      .upsert(rows, { onConflict: 'student_id,feed_key' });
    if (upsertError) throw new Error(`calendar_feed_subscriptions upsert: ${upsertError.message}`);
  }

  if (problem === 'permission' || problem === 'token') {
    await admin
      .from('google_tokens')
      .update({ calendarlist_error: problem, calendarlist_error_at: nowIso })
      .eq('student_id', token.student_id);
  } else if (added.length > 0 && token.calendarlist_error) {
    await admin
      .from('google_tokens')
      .update({ calendarlist_error: null, calendarlist_error_at: null })
      .eq('student_id', token.student_id);
  }

  return { added: added.length, problem, error };
}

// Feed keys and calendar IDs for one batch's current term, plus who has which.
async function batchFeedState(admin: SupabaseClient, batchLabel: string) {
  const data = await loadBatchData(admin, batchLabel, { withTimetable: false });
  const model = buildFeeds(data);
  const rows = await fetchAll<{ key: string; title: string; calendar_id: string | null }>((from, to) =>
    admin.from('calendar_feeds').select('key, title, calendar_id').eq('batch_label', batchLabel).eq('term', data.term).range(from, to)
  );
  const feedRow = new Map(rows.map((r) => [r.key, r]));
  const subs = await fetchAll<{ student_id: string; feed_key: string }>((from, to) =>
    admin
      .from('calendar_feed_subscriptions')
      .select('student_id, feed_key, calendar_feeds!inner(batch_label, term)')
      .eq('calendar_feeds.batch_label', batchLabel)
      .eq('calendar_feeds.term', data.term)
      .range(from, to)
  );
  const subscribed = new Map<string, Set<string>>();
  for (const s of subs) {
    if (!subscribed.has(s.student_id)) subscribed.set(s.student_id, new Set());
    subscribed.get(s.student_id)!.add(s.feed_key);
  }
  const statusFor = (studentId: string): FeedStatus[] =>
    [...(model.studentFeeds.get(studentId) ?? [])]
      .map((k) => {
        const row = feedRow.get(k);
        const calendarId = row?.calendar_id ?? null;
        return {
          feedKey: k,
          title: row?.title ?? model.feeds.get(k)?.title ?? 'ACAD calendar',
          ready: !!calendarId,
          added: subscribed.get(studentId)?.has(k) ?? false,
          addUrl: calendarId ? addUrlFor(calendarId) : null
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  const todoFor = (studentId: string): Todo[] =>
    statusFor(studentId)
      .filter((f) => f.ready && !f.added)
      .map((f) => ({ feedKey: f.feedKey, calendarId: feedRow.get(f.feedKey)!.calendar_id as string }));
  return { model, statusFor, todoFor };
}

async function studentBatch(admin: SupabaseClient, studentId: string): Promise<string | null> {
  const { data } = await admin.from('students').select('batch_label').eq('id', studentId).maybeSingle();
  return (data?.batch_label as string | undefined) ?? null;
}

export async function getStudentCalendarStatus(admin: SupabaseClient, studentId: string): Promise<StudentCalendarStatus> {
  const settings = await readSettings(admin);
  const batchLabel = await studentBatch(admin, studentId);
  if (!settings.feeds_enabled || !batchLabel || !BATCH_TERMS[batchLabel] || !settings.enabled_batches.includes(batchLabel)) {
    return { enabled: false, feeds: [], allAdded: false, needsPermission: false, confirmed: false };
  }
  const state = await batchFeedState(admin, batchLabel);
  const feeds = state.statusFor(studentId);
  const { data: token } = await admin.from('google_tokens').select(TOKEN_COLUMNS).eq('student_id', studentId).maybeSingle();
  const readyFeeds = feeds.filter((f) => f.ready);
  return {
    enabled: readyFeeds.length > 0,
    feeds,
    allAdded: readyFeeds.length > 0 && readyFeeds.every((f) => f.added),
    needsPermission: !tokenUsable(token as TokenRow | null),
    confirmed: await isConfirmed(admin, studentId)
  };
}

// Whether the student said the ACAD calendars show on their phone. False (not an error) if
// the column doesn't exist yet.
async function isConfirmed(admin: SupabaseClient, studentId: string): Promise<boolean> {
  const { data, error } = await admin.from('students').select('calendar_confirmed_at').eq('id', studentId).maybeSingle();
  if (error) return false;
  return !!(data as { calendar_confirmed_at?: string | null } | null)?.calendar_confirmed_at;
}

// "I can see my ACAD classes on my phone" — after this the student's old guest invites are
// removed (quietly) on the next sync, so they don't see every class twice.
export async function confirmStudent(admin: SupabaseClient, studentId: string): Promise<{ ok: boolean; error: string | null }> {
  const status = await getStudentCalendarStatus(admin, studentId);
  if (!status.allAdded) return { ok: false, error: 'Add your class calendars first' };
  const { error } = await admin
    .from('students')
    .update({ calendar_confirmed_at: new Date().toISOString() })
    .eq('id', studentId);
  if (error) {
    console.error('confirm failed:', error.message);
    return { ok: false, error: 'Could not save — try again in a minute' };
  }
  return { ok: true, error: null };
}

export async function subscribeStudent(
  admin: SupabaseClient,
  studentId: string,
  method: 'auto' | 'self'
): Promise<{ added: number; needsPermission: boolean; error: string | null }> {
  const settings = await readSettings(admin);
  const batchLabel = await studentBatch(admin, studentId);
  if (!settings.feeds_enabled || !batchLabel || !BATCH_TERMS[batchLabel] || !settings.enabled_batches.includes(batchLabel)) {
    return { added: 0, needsPermission: false, error: null };
  }
  const { data: token } = await admin.from('google_tokens').select(TOKEN_COLUMNS).eq('student_id', studentId).maybeSingle();
  if (!tokenUsable(token as TokenRow | null)) return { added: 0, needsPermission: true, error: null };

  const state = await batchFeedState(admin, batchLabel);
  const todo = state.todoFor(studentId);
  if (todo.length === 0) return { added: 0, needsPermission: false, error: null };
  const result = await addCalendars(admin, token as TokenRow, todo, method);
  return {
    added: result.added,
    needsPermission: result.problem === 'permission' || result.problem === 'token',
    error: result.error
  };
}

// Background pass: add missing section calendars for everyone who granted the permission.
export async function runAutoSubscribe(admin: SupabaseClient, budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  const settings = await readSettings(admin);
  if (!settings.feeds_enabled) return { skipped: 'feeds_enabled is off', students: 0, added: 0, needPermission: 0, left: 0 };

  const tokens = await fetchAll<TokenRow>((from, to) =>
    admin.from('google_tokens').select(TOKEN_COLUMNS).ilike('scope', '%calendar.calendarlist%').range(from, to)
  );
  const tokenById = new Map(tokens.filter((t) => tokenUsable(t)).map((t) => [t.student_id, t]));

  const queue: { token: TokenRow; todo: Todo[] }[] = [];
  for (const batchLabel of settings.enabled_batches) {
    if (!BATCH_TERMS[batchLabel]) continue;
    const state = await batchFeedState(admin, batchLabel);
    for (const studentId of state.model.studentFeeds.keys()) {
      const token = tokenById.get(studentId);
      if (!token) continue;
      const todo = state.todoFor(studentId);
      if (todo.length > 0) queue.push({ token, todo });
    }
  }

  let students = 0;
  let added = 0;
  let needPermission = 0;
  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() < deadline) {
      const job = queue[next++];
      try {
        const r = await addCalendars(admin, job.token, job.todo, 'auto');
        students++;
        added += r.added;
        if (r.problem === 'permission' || r.problem === 'token') needPermission++;
      } catch (err: any) {
        console.error('auto-subscribe failed for a student:', err?.message ?? err);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_STUDENTS }, worker));
  return { skipped: null, students, added, needPermission, left: Math.max(0, queue.length - next) };
}
