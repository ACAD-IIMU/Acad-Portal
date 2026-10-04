// ACAD calendar invites — the "brain".
//
// The idea: acad@iimu.ac.in owns one event per class, with that class's students as
// guests. Google then shows the event on every guest's calendar and keeps it in sync, so
// one change on ACAD's calendar updates everyone.
//
// This file decides WHAT needs to change. It never talks to Google itself — an Apps
// Script running inside acad@iimu.ac.in (apps-script/acad-calendar-sync.gs) asks the
// plan route for a list of operations, carries them out, and reports back through the
// ack route. Keeping Google access inside acad@'s own Apps Script means the portal never
// stores acad@'s password or tokens, and no domain-wide delegation is needed from IT.
//
// How a plan is made (a "reconcile"):
//   desired = what the timetable in Supabase says should be on the calendar now
//   ledger  = what we already put on the calendar (calendar_invite_ledger)
//   in desired, not in ledger            → create
//   in both, fingerprint differs         → update
//   in ledger, not in desired (future)   → delete, after a short grace period
// Past events are never touched.
//
// Identity: classes are keyed by their natural identity (batch, term, subject, section,
// session number), NOT by sessions.id. A numbered class keeps its key when it is
// rescheduled, so a move is an update (one "Updated" email), never cancel + re-invite.
// Unnumbered one-offs (named sessions) fall back to label + date + time.

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TERM_5 } from '@/lib/term5';
import { TERM_2 } from '@/lib/term2';

// ---------- configuration ----------

// Which term each batch is currently in — same source of truth as sync-timetable.
export const BATCH_TERMS: Record<string, string> = {
  'MBA 2025-27': TERM_5,
  'MBA 2026-28': TERM_2
};

const TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';
const PORTAL_URL = 'https://acad-student-portal.vercel.app';
const ORGANIZER_EMAIL = (process.env.ACAD_ORGANIZER_EMAIL ?? 'acad@iimu.ac.in').toLowerCase();

// Google allows at most 200 directly invited guests per event. Batch-wide events
// (Registration, holidays) are split into parts of this size; each student is a guest
// on exactly one part, so they still see it once.
const MAX_GUESTS_PER_EVENT = 190;

// Most operations handed to the Apps Script in one run (it has ~5 minutes per run).
const MAX_OPS_PER_PLAN = 150;

// A class that disappears from the timetable is only removed from calendars once it has
// been missing for this long. Protects against the brief moment during a sync when
// important_events is cleared and refilled, and against half-finished edits.
const DELETE_GRACE_MS = 8 * 60 * 1000;

const EVENT_DURATION_MINUTES: Record<string, number> = { endterm: 120, quiz: 45, other: 90 };
const LABEL_TIME_SUFFIX_RE = / — (\d{1,2}):(\d{2}) (AM|PM)$/;

// ---------- types ----------

type CalendarResource = Record<string, unknown>;

export type DesiredEvent = {
  key: string;
  eventId: string;
  batchLabel: string;
  summary: string;
  startAt: string; // ISO with +05:30
  endAt: string;
  location: string | null;
  contentHash: string;
  attendeeHash: string;
  attendeeCount: number;
  resource: CalendarResource;
};

type LedgerRow = {
  key: string;
  event_id: string;
  batch_label: string;
  content_hash: string;
  attendee_hash: string;
  start_at: string;
  end_at: string;
  location: string | null;
  missing_since: string | null;
};

export type PlanOp = {
  op: 'create' | 'update' | 'delete';
  key: string;
  eventId: string;
  batchLabel: string;
  summary: string;
  sendUpdates: 'all' | 'none';
  startAt: string;
  endAt: string;
  location: string | null;
  contentHash: string;
  attendeeHash: string;
  reason: string;
  resource?: CalendarResource; // create/update only
};

export type Settings = {
  paused: boolean;
  enabled_batches: string[];
  silent_until: string | null;
  notify_window_hours: number;
  max_changes_per_run: number;
  bulk_approved_until: string | null;
};

export type BatchStats = {
  term: string;
  desiredEvents: number;
  alreadyOnCalendar: number;
  creates: number;
  updates: number;
  materialUpdates: number;
  deletes: number;
  waitingToDelete: number;
  emails: number;
  silent: boolean;
  classesWithNoStudents: number;
};

export type Plan = {
  paused: boolean;
  held: boolean;
  reason: string | null;
  totalOps: number;
  ops: PlanOp[];
  stats: Record<string, BatchStats>;
};

// ---------- small helpers ----------

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

// Google event IDs allow only a–v and 0–9. 'acad' + 's'/'e' + hex digits all qualify,
// and the prefix can never collide with the old button's 'sess…'/'evt…' IDs.
const sessionEventId = (key: string) => `acads${sha1(key)}`;
const otherEventId = (key: string) => `acade${sha1(key)}`;

function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE }); // YYYY-MM-DD
}

function normTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t.slice(0, 8);
}

function istIso(date: string, time: string): string {
  return `${date}T${normTime(time)}${IST_OFFSET}`;
}

function to24Hour(h: string, m: string, meridiem: string): string {
  let hour = parseInt(h, 10) % 12;
  if (meridiem === 'PM') hour += 12;
  return `${String(hour).padStart(2, '0')}:${m}`;
}

// Pure calendar arithmetic on Y-M-D + H:M (no timezone involved), as in lib/googleCalendar.ts.
function addMinutes(dateStr: string, timeStr: string, minutes: number): { date: string; time: string } {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  let total = h * 60 + mi + minutes;
  let dayOffset = 0;
  while (total >= 24 * 60) {
    total -= 24 * 60;
    dayOffset += 1;
  }
  const rolled = new Date(Date.UTC(y, mo - 1, d + dayOffset));
  const date = `${rolled.getUTCFullYear()}-${String(rolled.getUTCMonth() + 1).padStart(2, '0')}-${String(rolled.getUTCDate()).padStart(2, '0')}`;
  return { date, time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` };
}

function nextDay(dateStr: string): string {
  return addMinutes(dateStr, '00:00', 24 * 60).date;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Supabase returns at most 1000 rows per request — page through everything.
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

const GUEST_NOTE =
  'Added by ACAD from the official timetable. This invite updates by itself if the class is moved, ' +
  'cancelled or changes room — please keep it (don’t decline or delete it).';

function baseResource(
  eventId: string,
  key: string,
  summary: string,
  description: string,
  location: string | null,
  start: Record<string, string>,
  end: Record<string, string>,
  emails: string[]
): CalendarResource {
  return {
    id: eventId,
    status: 'confirmed',
    summary,
    description,
    location: location ?? undefined,
    start,
    end,
    attendees: emails.map((email) => ({ email })),
    guestsCanSeeOtherGuests: false,
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    extendedProperties: { private: { acadKey: key } }
  };
}

function finalize(
  key: string,
  eventId: string,
  batchLabel: string,
  summary: string,
  description: string,
  location: string | null,
  start: Record<string, string>,
  end: Record<string, string>,
  startAt: string,
  endAt: string,
  emails: string[]
): DesiredEvent {
  const sorted = [...emails].sort();
  return {
    key,
    eventId,
    batchLabel,
    summary,
    startAt,
    endAt,
    location,
    contentHash: sha1(JSON.stringify({ summary, description, location, start, end })),
    attendeeHash: sha1(sorted.join(',')),
    attendeeCount: sorted.length,
    resource: baseResource(eventId, key, summary, description, location, start, end, sorted)
  };
}

// ---------- desired state ----------

export async function buildDesiredEvents(
  admin: SupabaseClient,
  batchLabel: string
): Promise<{ events: Map<string, DesiredEvent>; classesWithNoStudents: number }> {
  const term = BATCH_TERMS[batchLabel];
  if (!term) throw new Error(`No term configured for batch "${batchLabel}" in BATCH_TERMS`);

  const today = istToday();
  const now = Date.now();

  const students = await fetchAll<{ id: string; email: string }>((from, to) =>
    admin.from('students').select('id, email').eq('batch_label', batchLabel).range(from, to)
  );
  const emailById = new Map(
    students
      .filter((s) => s.email && s.email.toLowerCase() !== ORGANIZER_EMAIL)
      .map((s) => [s.id, s.email.toLowerCase()])
  );

  const enrollments = await fetchAll<{ student_id: string; subject_id: string; section_id: string | null }>(
    (from, to) =>
      admin.from('enrollments').select('student_id, subject_id, section_id').eq('term', term).range(from, to)
  );
  const bySubjectSection = new Map<string, Set<string>>();
  const bySubject = new Map<string, Set<string>>();
  const enrolledStudents = new Set<string>();
  for (const e of enrollments) {
    const email = emailById.get(e.student_id);
    if (!email) continue; // another batch's enrollment for the same term label
    enrolledStudents.add(email);
    const k = `${e.subject_id}::${e.section_id ?? 'null'}`;
    if (!bySubjectSection.has(k)) bySubjectSection.set(k, new Set());
    bySubjectSection.get(k)!.add(email);
    if (!bySubject.has(e.subject_id)) bySubject.set(e.subject_id, new Set());
    bySubject.get(e.subject_id)!.add(email);
  }

  const subjects = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin.from('subjects').select('id, name').eq('term', term).eq('batch_label', batchLabel).range(from, to)
  );
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  const sections = await fetchAll<{ id: string; section_label: string | null }>((from, to) =>
    admin.from('sections').select('id, section_label').eq('term', term).eq('batch_label', batchLabel).range(from, to)
  );
  const sectionLabel = new Map(sections.map((s) => [s.id, s.section_label]));

  const sessions = await fetchAll<{
    subject_id: string;
    section_id: string | null;
    session_number: number | null;
    session_label: string | null;
    session_date: string;
    start_time: string;
    end_time: string;
    room: string | null;
  }>((from, to) =>
    admin
      .from('sessions')
      .select('subject_id, section_id, session_number, session_label, session_date, start_time, end_time, room')
      .eq('term', term)
      .eq('batch_label', batchLabel)
      .gte('session_date', today)
      .range(from, to)
  );

  const events = new Map<string, DesiredEvent>();
  let classesWithNoStudents = 0;

  for (const s of sessions) {
    const startAt = istIso(s.session_date, s.start_time);
    const endAt = istIso(s.session_date, s.end_time);
    if (Date.parse(endAt) <= now) continue; // already over

    const emails = [...(bySubjectSection.get(`${s.subject_id}::${s.section_id ?? 'null'}`) ?? [])];
    if (emails.length === 0) {
      classesWithNoStudents++;
      continue;
    }

    const identity =
      s.session_number !== null && s.session_number !== undefined
        ? `n${s.session_number}`
        : `l${s.session_label ?? ''}|${s.session_date}|${normTime(s.start_time)}`;
    const baseKey = `sess:${sha1(`${batchLabel}|${term}|${s.subject_id}|${s.section_id ?? 'null'}|${identity}`)}`;

    const name = subjectName.get(s.subject_id) ?? 'Class';
    const suffix = s.session_label
      ? ` · ${s.session_label}`
      : s.session_number !== null && s.session_number !== undefined
        ? ` · Session ${s.session_number}`
        : '';
    const summary = `${name}${suffix}`;
    const section = s.section_id ? sectionLabel.get(s.section_id) : null;
    const description = [section ? `Section ${section}` : null, s.room ? `Room ${s.room}` : null, '', GUEST_NOTE, PORTAL_URL]
      .filter((line) => line !== null)
      .join('\n');
    const start = { dateTime: `${s.session_date}T${normTime(s.start_time)}`, timeZone: TIME_ZONE };
    const end = { dateTime: `${s.session_date}T${normTime(s.end_time)}`, timeZone: TIME_ZONE };

    addWithGuestSplit(events, baseKey, sessionEventId, batchLabel, summary, description, s.room, start, end, startAt, endAt, emails);
  }

  const importantEvents = await fetchAll<{
    event_date: string;
    type: string;
    label: string;
    subject_id: string | null;
    location: string | null;
  }>((from, to) =>
    admin
      .from('important_events')
      .select('event_date, type, label, subject_id, location')
      .eq('term', term)
      .eq('batch_label', batchLabel)
      .gte('event_date', today)
      .range(from, to)
  );

  for (const e of importantEvents) {
    const emails = e.subject_id ? [...(bySubject.get(e.subject_id) ?? [])] : [...enrolledStudents];
    if (emails.length === 0) {
      classesWithNoStudents++;
      continue;
    }

    const baseKey = `evt:${sha1(`${batchLabel}|${term}|${e.event_date}|${e.type}|${e.label}|${e.subject_id ?? 'null'}`)}`;
    const timeMatch = e.label.match(LABEL_TIME_SUFFIX_RE);
    let summary: string;
    let start: Record<string, string>;
    let end: Record<string, string>;
    let startAt: string;
    let endAt: string;

    if (timeMatch) {
      const [, h, m, meridiem] = timeMatch;
      const startTime = to24Hour(h, m, meridiem);
      const finish = addMinutes(e.event_date, startTime, EVENT_DURATION_MINUTES[e.type] ?? 90);
      summary = e.label.replace(LABEL_TIME_SUFFIX_RE, '');
      start = { dateTime: `${e.event_date}T${startTime}:00`, timeZone: TIME_ZONE };
      end = { dateTime: `${finish.date}T${finish.time}:00`, timeZone: TIME_ZONE };
      startAt = istIso(e.event_date, startTime);
      endAt = istIso(finish.date, finish.time);
    } else {
      // No time in the sheet → all-day event. Google's all-day end date is exclusive.
      summary = e.label;
      start = { date: e.event_date };
      end = { date: nextDay(e.event_date) };
      startAt = istIso(e.event_date, '00:00');
      endAt = istIso(nextDay(e.event_date), '00:00');
    }
    if (Date.parse(endAt) <= now) continue;

    const description = [e.location ? `Venue: ${e.location}` : null, '', GUEST_NOTE, PORTAL_URL]
      .filter((line) => line !== null)
      .join('\n');
    addWithGuestSplit(events, baseKey, otherEventId, batchLabel, summary, description, e.location, start, end, startAt, endAt, emails);
  }

  return { events, classesWithNoStudents };
}

function addWithGuestSplit(
  events: Map<string, DesiredEvent>,
  baseKey: string,
  idFor: (key: string) => string,
  batchLabel: string,
  summary: string,
  description: string,
  location: string | null,
  start: Record<string, string>,
  end: Record<string, string>,
  startAt: string,
  endAt: string,
  emails: string[]
) {
  const sorted = [...emails].sort();
  const parts = chunk(sorted, MAX_GUESTS_PER_EVENT);
  parts.forEach((part, i) => {
    // Part 0 keeps the plain key, so an event that grows past 190 guests keeps its
    // existing calendar event and only gains a second part.
    const key = i === 0 ? baseKey : `${baseKey}#p${i}`;
    events.set(key, finalize(key, idFor(key), batchLabel, summary, description, location, start, end, startAt, endAt, part));
  });
}

// ---------- settings ----------

export async function readSettings(admin: SupabaseClient): Promise<Settings> {
  const { data, error } = await admin
    .from('calendar_invite_settings')
    .select('paused, enabled_batches, silent_until, notify_window_hours, max_changes_per_run, bulk_approved_until')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(`calendar_invite_settings: ${error.message}`);
  if (!data) throw new Error('calendar_invite_settings has no row — run supabase/calendar-invites/step2_settings.sql');
  return data as Settings;
}

// ---------- the plan ----------

export async function buildPlan(admin: SupabaseClient, options: { preview: boolean }): Promise<Plan> {
  const settings = await readSettings(admin);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (!options.preview) {
    await admin.from('calendar_invite_settings').update({ last_plan_at: nowIso }).eq('id', 1);
  }
  if (settings.paused && !options.preview) {
    return { paused: true, held: false, reason: 'Paused in calendar_invite_settings', totalOps: 0, ops: [], stats: {} };
  }

  const windowMs = settings.notify_window_hours * 60 * 60 * 1000;
  const within = (iso: string) => {
    const t = Date.parse(iso);
    return t >= now && t <= now + windowMs;
  };
  const globallySilent = settings.silent_until !== null && Date.parse(settings.silent_until) > now;
  const bulkApproved = settings.bulk_approved_until !== null && Date.parse(settings.bulk_approved_until) > now;

  const allOps: PlanOp[] = [];
  const stats: Record<string, BatchStats> = {};
  const markMissing: string[] = [];
  const clearMissing: string[] = [];
  let materialChanges = 0;
  let heldReason: string | null = null;

  for (const batchLabel of settings.enabled_batches) {
    const term = BATCH_TERMS[batchLabel];
    const { events: desired, classesWithNoStudents } = await buildDesiredEvents(admin, batchLabel);
    const ledger = await fetchAll<LedgerRow>((from, to) =>
      admin
        .from('calendar_invite_ledger')
        .select('key, event_id, batch_label, content_hash, attendee_hash, start_at, end_at, location, missing_since')
        .eq('batch_label', batchLabel)
        .range(from, to)
    );
    const ledgerByKey = new Map(ledger.map((r) => [r.key, r]));

    // First load for a batch (nothing on the calendar yet) is always silent.
    const silent = globallySilent || ledger.length === 0;
    const s: BatchStats = {
      term,
      desiredEvents: desired.size,
      alreadyOnCalendar: ledger.length,
      creates: 0,
      updates: 0,
      materialUpdates: 0,
      deletes: 0,
      waitingToDelete: 0,
      emails: 0,
      silent,
      classesWithNoStudents
    };

    const notify = (yes: boolean): 'all' | 'none' => (yes && !silent ? 'all' : 'none');
    const push = (op: PlanOp) => {
      allOps.push(op);
      if (op.sendUpdates === 'all') s.emails++;
    };

    for (const d of desired.values()) {
      const l = ledgerByKey.get(d.key);
      if (!l) {
        s.creates++;
        push({ op: 'create', key: d.key, eventId: d.eventId, batchLabel, summary: d.summary, sendUpdates: notify(within(d.startAt)),
          startAt: d.startAt, endAt: d.endAt, location: d.location, contentHash: d.contentHash, attendeeHash: d.attendeeHash,
          reason: 'new on the timetable', resource: d.resource });
        continue;
      }
      if (l.missing_since) clearMissing.push(l.key);
      if (Date.parse(l.start_at) < now) continue; // never touch a class that has already started

      const contentChanged = l.content_hash !== d.contentHash;
      const guestsChanged = l.attendee_hash !== d.attendeeHash;
      if (!contentChanged && !guestsChanged) continue;

      const material =
        Date.parse(l.start_at) !== Date.parse(d.startAt) ||
        Date.parse(l.end_at) !== Date.parse(d.endAt) ||
        (l.location ?? '') !== (d.location ?? '');
      s.updates++;
      if (material) {
        s.materialUpdates++;
        materialChanges++;
      }
      const reasons = [material ? 'time or room changed' : contentChanged ? 'details changed' : null, guestsChanged ? 'guest list changed' : null]
        .filter(Boolean)
        .join(', ');
      push({ op: 'update', key: d.key, eventId: d.eventId, batchLabel, summary: d.summary,
        sendUpdates: notify(material && (within(d.startAt) || within(l.start_at))),
        startAt: d.startAt, endAt: d.endAt, location: d.location, contentHash: d.contentHash, attendeeHash: d.attendeeHash,
        reason: reasons, resource: d.resource });
    }

    for (const l of ledger) {
      if (desired.has(l.key)) continue;
      if (Date.parse(l.start_at) < now) continue; // past — leave it alone
      if (!l.missing_since) {
        markMissing.push(l.key);
        s.waitingToDelete++;
        continue;
      }
      if (now - Date.parse(l.missing_since) < DELETE_GRACE_MS) {
        s.waitingToDelete++;
        continue;
      }
      s.deletes++;
      materialChanges++;
      // An extra guest part ('#p1', '#p2'…) disappearing just means the guest list got
      // shorter — those students are already on another part — so that one is silent.
      const isExtraPart = l.key.includes('#p');
      push({ op: 'delete', key: l.key, eventId: l.event_id, batchLabel, summary: '(removed from timetable)',
        sendUpdates: notify(!isExtraPart && within(l.start_at)), startAt: l.start_at, endAt: l.end_at, location: l.location,
        contentHash: l.content_hash, attendeeHash: l.attendee_hash, reason: 'no longer on the timetable' });
    }

    // A batch whose timetable suddenly reads as empty is almost certainly a sync problem,
    // not a real mass cancellation.
    if (desired.size === 0 && ledger.some((r) => Date.parse(r.start_at) >= now)) {
      heldReason = `The timetable for ${batchLabel} currently has no upcoming classes, but the calendar does. ` +
        'This usually means a sync or parsing problem, so nothing was removed.';
    }
    stats[batchLabel] = s;
  }

  if (!options.preview) {
    for (const keys of chunk(markMissing, 100)) {
      await admin.from('calendar_invite_ledger').update({ missing_since: nowIso }).in('key', keys);
    }
    for (const keys of chunk(clearMissing, 100)) {
      await admin.from('calendar_invite_ledger').update({ missing_since: null }).in('key', keys);
    }
  }

  if (!heldReason && materialChanges > settings.max_changes_per_run && !bulkApproved) {
    heldReason =
      `${materialChanges} calendar events would be moved or cancelled in one go (limit ${settings.max_changes_per_run}). ` +
      'Check the timetable sheet. If the change is real, approve it in Supabase with ' +
      "update calendar_invite_settings set bulk_approved_until = now() + interval '1 hour' where id = 1;";
  }

  // Order: removals first, then changes, then new classes — soonest first within each.
  const rank = { delete: 0, update: 1, create: 2 } as const;
  allOps.sort((a, b) => rank[a.op] - rank[b.op] || Date.parse(a.startAt) - Date.parse(b.startAt));

  const held = heldReason !== null;
  return {
    paused: settings.paused,
    held,
    reason: heldReason ?? (settings.paused ? 'Paused (preview only)' : null),
    totalOps: allOps.length,
    ops: held ? [] : allOps.slice(0, MAX_OPS_PER_PLAN),
    stats
  };
}

// ---------- recording results ----------

export type AckResult = PlanOp & { ok: boolean; error?: string | null };

export async function recordResults(admin: SupabaseClient, results: AckResult[]) {
  const nowIso = new Date().toISOString();
  const succeeded = results.filter((r) => r.ok);

  const upserts = succeeded
    .filter((r) => r.op === 'create' || r.op === 'update')
    .map((r) => ({
      key: r.key,
      event_id: r.eventId,
      batch_label: r.batchLabel,
      content_hash: r.contentHash,
      attendee_hash: r.attendeeHash,
      start_at: r.startAt,
      end_at: r.endAt,
      location: r.location,
      missing_since: null,
      updated_at: nowIso
    }));
  for (const rows of chunk(upserts, 200)) {
    const { error } = await admin.from('calendar_invite_ledger').upsert(rows, { onConflict: 'key' });
    if (error) throw new Error(`ledger upsert: ${error.message}`);
  }

  const deletedKeys = succeeded.filter((r) => r.op === 'delete').map((r) => r.key);
  for (const keys of chunk(deletedKeys, 100)) {
    const { error } = await admin.from('calendar_invite_ledger').delete().in('key', keys);
    if (error) throw new Error(`ledger delete: ${error.message}`);
  }

  const logRows = results.map((r) => ({
    op: r.op,
    key: r.key,
    event_id: r.eventId,
    batch_label: r.batchLabel,
    summary: r.summary,
    start_at: r.startAt,
    send_updates: r.sendUpdates,
    ok: r.ok,
    error: r.error ? String(r.error).slice(0, 500) : null
  }));
  for (const rows of chunk(logRows, 200)) {
    const { error } = await admin.from('calendar_invite_log').insert(rows);
    if (error) throw new Error(`log insert: ${error.message}`);
  }

  await admin.from('calendar_invite_settings').update({ last_ack_at: nowIso }).eq('id', 1);
  return { saved: upserts.length, removed: deletedKeys.length, failed: results.length - succeeded.length };
}
