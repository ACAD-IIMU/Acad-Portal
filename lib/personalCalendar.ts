// Direct mode — classes written straight into each student's own MAIN Google Calendar.
//
// Why: an extra calendar (the "ACAD · …" section calendars) is hidden on Android until the
// student turns "Sync" on for it, and an invitation from acad@ shows Yes/No buttons. A
// student's main calendar always shows on every phone, with no setup at all. So the portal
// writes each student's classes into their main calendar itself, with the permission they
// already gave when they signed in to the portal (calendar.events), and keeps them in step
// with the timetable: moved / room changed → updated, removed → deleted, cancelled within
// 48 hours → kept and marked "❌ CANCELLED". No guests, so no emails and no Yes/No buttons.
//
// Safety:
//   - A student stays on the old acad@ invites until ALL their upcoming classes are in their
//     main calendar (students.personal_ready_at), so nothing ever disappears.
//   - If their Google permission stops working (revoked, or not used for 6 months), the
//     student is marked (google_tokens.events_error) and goes straight back to the invites.
//   - Students who are no longer in direct mode (pilot list changed, or direct mode switched
//     off) get their copies removed only 90 minutes later, after the invites are back.
//   - Past classes are never touched.
//   - Phone alerts are NOT sent from here — lib/calendarInvites.ts already alerts every
//     student of a changed class (this module only keeps calendars in step).
//
// Runs inside POST /api/calendar/feeds/subscribe, which the Apps Script in acad@ calls every
// 5 minutes — so no Apps Script change is needed. Each run works for ~35 seconds and picks up
// where the last one stopped.

import { google, calendar_v3 } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BATCH_TERMS,
  FEED_NOTE,
  PORTAL_URL,
  TIME_ZONE,
  buildClassEntries,
  buildFeeds,
  chunk,
  describe,
  fetchAll,
  istDateOf,
  loadBatchData,
  readSettings,
  sha1,
  type ClassEntry
} from '@/lib/calendarInvites';

const DELETE_GRACE_MS = 8 * 60 * 1000; // same grace as the section calendars
const NOTIFY_WINDOW_MS = 48 * 60 * 60 * 1000; // a cancellation this close stays visible, marked
const OFF_DELAY_MS = 90 * 60 * 1000; // wait for invites to come back before removing copies
const PARALLEL_STUDENTS = 12;

type TokenRow = {
  student_id: string;
  refresh_token: string | null;
  scope: string | null;
  updated_at: string;
  events_error: string | null;
  events_error_at: string | null;
};

type StudentRow = {
  id: string;
  reg_no: string | null;
  batch_label: string;
  personal_ready_at: string | null;
  personal_off_at: string | null;
};

export type LedgerRow = {
  student_id: string;
  origin: string;
  batch_label: string;
  event_id: string;
  content_hash: string;
  summary: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean | null;
  location: string | null;
  missing_since: string | null;
  cancelled_at: string | null;
};

type Op = {
  kind: 'create' | 'update' | 'delete' | 'cancel';
  studentId: string;
  origin: string;
  batchLabel: string;
  eventId: string;
  resource?: calendar_v3.Schema$Event;
  row?: Omit<LedgerRow, 'missing_since' | 'cancelled_at'> & { cancelled_at?: string | null };
};

// Lets the sandbox simulation swap in a fake Google client.
export type CalendarFor = (token: TokenRow) => Pick<calendar_v3.Calendar, 'events' | 'calendarList'>;

const defaultCalendarFor: CalendarFor = (token) => {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: token.refresh_token ?? undefined });
  return google.calendar({ version: 'v3', auth });
};

export const personalEventId = (studentId: string, origin: string) => `acadp${sha1(`${studentId}|${origin}`)}`;

export function eventsTokenUsable(t: TokenRow | null | undefined): boolean {
  if (!t?.refresh_token) return false;
  if (!(t.scope ?? 'calendar.events').includes('calendar.events')) return false;
  // A token that failed is retried only after the student signs in again (updated_at moves).
  if (t.events_error && t.events_error_at && Date.parse(t.events_error_at) >= Date.parse(t.updated_at)) return false;
  return true;
}

export function inDirectMode(
  settings: { personal_enabled: boolean; personal_pilot_reg_nos: string[] | null },
  regNo: string | null
): boolean {
  if (!settings.personal_enabled) return false;
  if (!settings.personal_pilot_reg_nos) return true;
  return !!regNo && settings.personal_pilot_reg_nos.includes(regNo);
}

function entryHash(c: ClassEntry): string {
  const description = describe(c.descriptionLines, FEED_NOTE);
  return sha1(JSON.stringify({ v: 1, summary: c.summary, description, location: c.location, start: c.timing.start, end: c.timing.end }));
}

function entryResource(eventId: string, c: ClassEntry): calendar_v3.Schema$Event {
  return {
    id: eventId,
    status: 'confirmed',
    summary: c.summary,
    description: describe(c.descriptionLines, FEED_NOTE),
    location: c.location ?? undefined,
    start: c.timing.start,
    end: c.timing.end,
    transparency: 'opaque',
    reminders: { useDefault: true },
    source: { title: 'ACAD Portal', url: PORTAL_URL },
    extendedProperties: { private: { acadOrigin: c.origin, acadPersonal: 'true' } }
  };
}

function cancelledResource(l: LedgerRow): calendar_v3.Schema$Event {
  const allDay = !!l.all_day;
  return {
    id: l.event_id,
    status: 'confirmed',
    summary: `❌ CANCELLED · ${l.summary ?? 'Class'}`,
    description: `This was cancelled on the official ACAD timetable.\n${PORTAL_URL}`,
    location: l.location ?? undefined,
    start: allDay ? { date: istDateOf(l.start_at) } : { dateTime: new Date(l.start_at).toISOString(), timeZone: TIME_ZONE },
    end: allDay ? { date: istDateOf(l.end_at) } : { dateTime: new Date(l.end_at).toISOString(), timeZone: TIME_ZONE },
    transparency: 'transparent',
    colorId: '11',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { acadOrigin: l.origin, acadPersonal: 'true', acadCancelled: 'true' } }
  };
}

type Failure = 'token' | 'rate' | 'notFound' | 'exists' | 'other';

function classify(err: any): Failure {
  const status = err?.response?.status ?? (typeof err?.code === 'number' ? err.code : undefined);
  const text = `${err?.message ?? ''} ${JSON.stringify(err?.response?.data ?? '')}`;
  if (/invalid_grant|unauthorized_client/i.test(text) || status === 401) return 'token';
  if (status === 403 && /insufficient|scope|forbidden for this|accessNotConfigured/i.test(text) && !/rate|quota/i.test(text)) return 'token';
  if (status === 429 || (status === 403 && /rate|quota|usageLimits/i.test(text))) return 'rate';
  if (status === 404 || status === 410) return 'notFound';
  if (status === 409 || /already exists|duplicate/i.test(text)) return 'exists';
  return 'other';
}

export type PersonalSyncResult = {
  skipped: string | null;
  students: number; // students in direct mode this run
  done: number; // calendar writes made
  failed: number;
  newlyReady: number;
  tokenProblems: number;
  feedsRemoved: number;
  left: number; // writes still waiting (picked up next run)
};

export async function runPersonalSync(
  admin: SupabaseClient,
  budgetMs: number,
  calendarFor: CalendarFor = defaultCalendarFor
): Promise<PersonalSyncResult> {
  const deadline = Date.now() + budgetMs;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const result: PersonalSyncResult = { skipped: null, students: 0, done: 0, failed: 0, newlyReady: 0, tokenProblems: 0, feedsRemoved: 0, left: 0 };

  const settings = await readSettings(admin);

  let ledgerProbe: { error: { message: string } | null; count: number | null };
  try {
    ledgerProbe = (await admin.from('calendar_personal_ledger').select('student_id', { count: 'exact', head: true })) as any;
  } catch (e: any) {
    ledgerProbe = { error: { message: String(e?.message ?? e) }, count: null };
  }
  if (ledgerProbe.error) return { ...result, skipped: 'calendar_personal_ledger missing — run step7_direct.sql' };
  if (!settings.personal_enabled && !ledgerProbe.count) return { ...result, skipped: 'direct mode is off' };

  const tokens = await fetchAll<TokenRow>((from, to) =>
    admin.from('google_tokens').select('student_id, refresh_token, scope, updated_at, events_error, events_error_at').range(from, to)
  );
  const tokenById = new Map(tokens.map((t) => [t.student_id, t]));

  const ops: Op[] = [];
  const pendingCreates = new Map<string, number>(); // student → creates still needed
  const studentRows = new Map<string, StudentRow>();
  const ledgerUpdates: Record<string, unknown>[] = []; // missing_since bookkeeping
  const hasCopies = new Set<string>(); // students with at least one copy already made

  for (const batchLabel of settings.enabled_batches) {
    if (!BATCH_TERMS[batchLabel]) continue;
    const students = await fetchAll<StudentRow>((from, to) =>
      admin
        .from('students')
        .select('id, reg_no, batch_label, personal_ready_at, personal_off_at')
        .eq('batch_label', batchLabel)
        .range(from, to)
    );
    for (const st of students) studentRows.set(st.id, st);

    const eligible = new Set(
      students
        .filter((st) => inDirectMode(settings, st.reg_no) && eventsTokenUsable(tokenById.get(st.id)))
        .map((st) => st.id)
    );

    const ledger = await fetchAll<LedgerRow>((from, to) =>
      admin.from('calendar_personal_ledger').select('*').eq('batch_label', batchLabel).range(from, to)
    );
    for (const l of ledger) hasCopies.add(l.student_id);
    if (eligible.size === 0 && ledger.length === 0) continue;

    // What each eligible student should have.
    const desired = new Map<string, { studentId: string; entry: ClassEntry; hash: string }>();
    if (eligible.size > 0) {
      const data = await loadBatchData(admin, batchLabel, { withTimetable: true });
      const model = buildFeeds(data);
      const { entries } = buildClassEntries(data, model);
      for (const c of entries) {
        const hash = entryHash(c);
        for (const email of c.guestEmails) {
          const id = data.idByEmail.get(email);
          if (id && eligible.has(id)) desired.set(`${id}|${c.origin}`, { studentId: id, entry: c, hash });
        }
      }
    }
    result.students += eligible.size;

    const ledgerByKey = new Map(ledger.map((l) => [`${l.student_id}|${l.origin}`, l]));

    for (const [key, d] of desired) {
      const l = ledgerByKey.get(key);
      const eventId = personalEventId(d.studentId, d.entry.origin);
      const row = {
        student_id: d.studentId, origin: d.entry.origin, batch_label: batchLabel, event_id: eventId, content_hash: d.hash,
        summary: d.entry.summary, start_at: d.entry.timing.startAt, end_at: d.entry.timing.endAt,
        all_day: d.entry.timing.allDay, location: d.entry.location
      };
      if (!l) {
        ops.push({ kind: 'create', studentId: d.studentId, origin: d.entry.origin, batchLabel, eventId, resource: entryResource(eventId, d.entry), row });
        pendingCreates.set(d.studentId, (pendingCreates.get(d.studentId) ?? 0) + 1);
        continue;
      }
      if (l.missing_since) ledgerUpdates.push({ ...l, missing_since: null });
      if (Date.parse(l.start_at) < now) continue; // never touch a class that has started
      if (l.cancelled_at || l.content_hash !== d.hash) {
        ops.push({ kind: 'update', studentId: d.studentId, origin: d.entry.origin, batchLabel, eventId, resource: entryResource(eventId, d.entry), row: { ...row, cancelled_at: null } });
      }
    }

    for (const l of ledger) {
      if (desired.has(`${l.student_id}|${l.origin}`)) continue;
      if (Date.parse(l.start_at) < now) continue; // past — leave it
      const stillEligible = eligible.has(l.student_id);
      if (!stillEligible) {
        // Left direct mode: remove copies only once the invites have had time to come back.
        const st = studentRows.get(l.student_id);
        const offAt = st?.personal_off_at ? Date.parse(st.personal_off_at) : null;
        const tokenOk = eventsTokenUsable(tokenById.get(l.student_id));
        if (tokenOk && offAt !== null && now - offAt >= OFF_DELAY_MS) {
          ops.push({ kind: 'delete', studentId: l.student_id, origin: l.origin, batchLabel, eventId: l.event_id });
        }
        continue;
      }
      if (l.cancelled_at) continue; // already shown as cancelled
      // Class gone from this student's timetable.
      if (!l.missing_since) {
        ledgerUpdates.push({ ...l, missing_since: nowIso });
        continue;
      }
      if (now - Date.parse(l.missing_since) < DELETE_GRACE_MS) continue;
      if (Date.parse(l.start_at) - now <= NOTIFY_WINDOW_MS) {
        ops.push({ kind: 'cancel', studentId: l.student_id, origin: l.origin, batchLabel, eventId: l.event_id, resource: cancelledResource(l), row: { ...l } });
      } else {
        ops.push({ kind: 'delete', studentId: l.student_id, origin: l.origin, batchLabel, eventId: l.event_id });
      }
    }

    // Students who just left direct mode: stamp personal_off_at (and stop counting as ready),
    // so the invites come back first.
    for (const st of students) {
      const inMode = eligible.has(st.id);
      if (!inMode && st.personal_ready_at) {
        await admin.from('students').update({ personal_ready_at: null, personal_off_at: nowIso }).eq('id', st.id);
        st.personal_ready_at = null;
        st.personal_off_at = nowIso;
      } else if (inMode && st.personal_off_at) {
        await admin.from('students').update({ personal_off_at: null }).eq('id', st.id);
        st.personal_off_at = null;
      }
    }
  }

  for (const rows of chunk(ledgerUpdates, 200)) {
    await admin.from('calendar_personal_ledger').upsert(rows, { onConflict: 'student_id,origin' });
  }

  // Work order: removals and changes first (they matter for students already relying on
  // their main calendar), then each student's creates together so students finish one by one.
  const rank = { cancel: 0, delete: 1, update: 2, create: 3 } as const;
  ops.sort((a, b) =>
    rank[a.kind] - rank[b.kind] ||
    (a.kind === 'create' ? a.studentId.localeCompare(b.studentId) : 0) ||
    Date.parse(a.row?.start_at ?? '0') - Date.parse(b.row?.start_at ?? '0')
  );
  const capped = ops.slice(0, settings.personal_max_ops_per_run);
  result.left = ops.length - capped.length;

  // Group by student; students run in parallel, each student's writes one after another.
  const byStudent = new Map<string, Op[]>();
  for (const op of capped) {
    if (!byStudent.has(op.studentId)) byStudent.set(op.studentId, []);
    byStudent.get(op.studentId)!.push(op);
  }
  const queue = [...byStudent.entries()];
  const ledgerUpserts: Record<string, unknown>[] = [];
  const ledgerDeletes: { student_id: string; origin: string }[] = [];
  const createdCount = new Map<string, number>();
  const tokenBroken = new Set<string>();
  let rateLimited = false;

  const runStudent = async (studentId: string, list: Op[]) => {
    const token = tokenById.get(studentId);
    if (!token) return;
    const cal = calendarFor(token);
    for (const op of list) {
      if (Date.now() > deadline || rateLimited) {
        result.left++;
        continue;
      }
      try {
        if (op.kind === 'create') {
          try {
            await cal.events.insert({ calendarId: 'primary', sendUpdates: 'none', requestBody: op.resource! });
          } catch (e) {
            if (classify(e) !== 'exists') throw e;
            // Same ID was used before (e.g. the class was removed and came back): revive it.
            await cal.events.update({ calendarId: 'primary', eventId: op.eventId, sendUpdates: 'none', requestBody: op.resource! });
          }
          createdCount.set(studentId, (createdCount.get(studentId) ?? 0) + 1);
          ledgerUpserts.push({ ...op.row!, missing_since: null, cancelled_at: null, updated_at: new Date().toISOString() });
        } else if (op.kind === 'update' || op.kind === 'cancel') {
          try {
            await cal.events.update({ calendarId: 'primary', eventId: op.eventId, sendUpdates: 'none', requestBody: op.resource! });
          } catch (e) {
            if (classify(e) !== 'notFound') throw e;
            await cal.events.insert({ calendarId: 'primary', sendUpdates: 'none', requestBody: op.resource! }); // student deleted it
          }
          ledgerUpserts.push({
            ...op.row!,
            missing_since: null,
            cancelled_at: op.kind === 'cancel' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
          });
        } else {
          try {
            await cal.events.delete({ calendarId: 'primary', eventId: op.eventId, sendUpdates: 'none' });
          } catch (e) {
            if (classify(e) !== 'notFound') throw e; // already gone = done
          }
          ledgerDeletes.push({ student_id: studentId, origin: op.origin });
        }
        result.done++;
      } catch (e: any) {
        const kind = classify(e);
        result.failed++;
        if (kind === 'token') {
          tokenBroken.add(studentId);
          result.left += list.length - list.indexOf(op) - 1;
          return; // every other write for this student would fail the same way
        }
        if (kind === 'rate') rateLimited = true;
        console.error('direct calendar write failed:', op.kind, studentId, String(e?.message ?? e).slice(0, 200));
      }
    }
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: PARALLEL_STUDENTS }, async () => {
      while (next < queue.length) {
        const [studentId, list] = queue[next++];
        await runStudent(studentId, list);
      }
    })
  );

  for (const rows of chunk(ledgerUpserts, 200)) {
    const { error } = await admin.from('calendar_personal_ledger').upsert(rows, { onConflict: 'student_id,origin' });
    if (error) throw new Error(`calendar_personal_ledger upsert: ${error.message}`);
  }
  for (const d of ledgerDeletes) {
    await admin.from('calendar_personal_ledger').delete().eq('student_id', d.student_id).eq('origin', d.origin);
  }

  // Broken permission → back to the invites straight away.
  for (const studentId of tokenBroken) {
    await admin.from('google_tokens').update({ events_error: 'token', events_error_at: nowIso }).eq('student_id', studentId);
    await admin.from('students').update({ personal_ready_at: null }).eq('id', studentId);
    result.tokenProblems++;
  }

  // Ready = every upcoming class is now in their main calendar.
  const newlyReady: string[] = [];
  for (const [studentId, st] of studentRows) {
    if (st.personal_ready_at || tokenBroken.has(studentId)) continue;
    if (!inDirectMode(settings, st.reg_no) || !eventsTokenUsable(tokenById.get(studentId))) continue;
    const needed = pendingCreates.get(studentId) ?? 0;
    const made = createdCount.get(studentId) ?? 0;
    const hasAnyClass = needed > 0 || hasCopies.has(studentId);
    if (hasAnyClass && made >= needed) newlyReady.push(studentId);
  }
  for (const ids of chunk(newlyReady, 100)) {
    await admin.from('students').update({ personal_ready_at: nowIso, personal_off_at: null }).in('id', ids);
    // Their permission works again (they signed in again) — clear the old problem flag.
    await admin.from('google_tokens').update({ events_error: null, events_error_at: null }).in('student_id', ids);
  }
  result.newlyReady = newlyReady.length;

  // Students now fully in direct mode don't need the ACAD section calendars any more —
  // take those out of their calendar list so they don't see classes twice.
  if (Date.now() < deadline) {
    result.feedsRemoved = await removeSectionCalendars(admin, tokenById, studentRows, settings, deadline, calendarFor, newlyReady);
  }
  return result;
}

async function removeSectionCalendars(
  admin: SupabaseClient,
  tokenById: Map<string, TokenRow>,
  studentRows: Map<string, StudentRow>,
  settings: { personal_enabled: boolean; personal_pilot_reg_nos: string[] | null },
  deadline: number,
  calendarFor: CalendarFor,
  newlyReady: string[]
): Promise<number> {
  const subs = await fetchAll<{ student_id: string; feed_key: string; calendar_id: string }>((from, to) =>
    admin.from('calendar_feed_subscriptions').select('student_id, feed_key, calendar_id').range(from, to)
  );
  const ready = new Set(newlyReady);
  for (const [id, st] of studentRows) if (st.personal_ready_at) ready.add(id);
  let removed = 0;
  for (const s of subs) {
    if (Date.now() > deadline) break;
    const st = studentRows.get(s.student_id);
    if (!st || !ready.has(s.student_id) || !inDirectMode(settings, st.reg_no)) continue;
    const token = tokenById.get(s.student_id);
    if (!token?.refresh_token) continue;
    try {
      await calendarFor(token).calendarList.delete({ calendarId: s.calendar_id });
    } catch (e) {
      const kind = classify(e);
      if (kind !== 'notFound' && kind !== 'token') continue; // try again next run
    }
    await admin.from('calendar_feed_subscriptions').delete().eq('student_id', s.student_id).eq('feed_key', s.feed_key);
    removed++;
  }
  return removed;
}

// For the Home card.
export async function getDirectStatus(
  admin: SupabaseClient,
  studentId: string
): Promise<{ mode: 'direct'; ready: boolean; needsPermission: boolean } | null> {
  const settings = await readSettings(admin);
  if (!settings.personal_enabled) return null;
  const { data: st, error } = await admin
    .from('students')
    .select('reg_no, batch_label, personal_ready_at')
    .eq('id', studentId)
    .maybeSingle();
  if (error || !st) return null;
  const row = st as { reg_no: string | null; batch_label: string; personal_ready_at: string | null };
  if (!settings.enabled_batches.includes(row.batch_label) || !inDirectMode(settings, row.reg_no)) return null;
  const { data: token } = await admin
    .from('google_tokens')
    .select('student_id, refresh_token, scope, updated_at, events_error, events_error_at')
    .eq('student_id', studentId)
    .maybeSingle();
  const usable = eventsTokenUsable(token as TokenRow | null);
  return { mode: 'direct', ready: usable && !!row.personal_ready_at, needsPermission: !usable };
}
