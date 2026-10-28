// ACAD calendar sync — the "brain".
//
// Two ways a class can reach a student's Google Calendar:
//
// 1. SECTION CALENDARS (the current design, switched on by settings.feeds_enabled).
//    acad@iimu.ac.in owns one Google Calendar per section ("feed") — e.g. "ACAD · Operations
//    Management · Sec A (Term V)", or for MBA1, whose sections are the same class for every
//    subject, simply "ACAD · Section A (Term II)" — plus one "Batch events" calendar per
//    batch. Every student is subscribed to their own sections' calendars. Events on these
//    calendars have NO guest list, so there is no invitation email, no Accept / Decline,
//    and no RSVP reply landing in acad@'s inbox. A change on ACAD's calendar shows up on
//    every subscriber's calendar by itself. When a class starting within the next 48 hours
//    is added, moved, changes room or is cancelled, the affected section's students get a
//    PHONE NOTIFICATION (lib/pushNotify.ts) — never an email, and never the whole college.
//
// 2. OLD GUEST INVITES (the original design: one event on acad@'s own calendar per class,
//    with the students as guests). Kept only as a bridge: a student stays on the old guest
//    invites until they have ALL of their section calendars, those calendars are fully
//    filled in, AND they have confirmed on the portal that the calendars show on their phone
//    (Android's Calendar app only shows an added calendar once "Sync" is turned on for it).
//    Then they are quietly removed from the guest lists. So nobody ever loses a
//    class or sees one twice during the move. Guest invites no longer email anyone either:
//    every change is sent with notifications off, and last-minute ones alert phones.
//
// This file decides WHAT needs to change. It never talks to Google itself — an Apps Script
// inside acad@iimu.ac.in (apps-script/acad-calendar-sync.gs) asks the plan route for a list
// of operations, carries them out, and reports back through the ack route. Keeping Google
// access inside acad@'s own Apps Script means the portal never stores acad@'s password or
// tokens, and no domain-wide delegation is needed from IT.
//
// How a plan is made (a "reconcile"):
//   desired = what the timetable in Supabase says should be on the calendars now
//   ledger  = what we already put on the calendars (calendar_invite_ledger)
//   in desired, not in ledger            → create
//   in both, fingerprint differs         → update
//   in ledger, not in desired (future)   → delete after a short grace period — or, if the
//                                          class was within 48 hours, keep it on the
//                                          calendar marked "❌ CANCELLED" so it doesn't
//                                          silently vanish
// Past events are never touched.
//
// Identity: classes are keyed by their natural identity (batch, term, subject, section,
// session number), NOT by sessions.id. A numbered class keeps its key when it is
// rescheduled, so a move is an update, never cancel + re-create.
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

// How classes are grouped into section calendars, per batch.
//   'section' — one calendar per section letter for the whole term. Right for MBA1, whose
//               sections are the same group of students for every subject. Used only if
//               the enrollments really are like that (checked every run); otherwise the
//               batch automatically falls back to 'class'.
//   'class'   — one calendar per subject-section. Right for MBA2, where sections differ
//               from subject to subject.
const FEED_GROUPING: Record<string, 'section' | 'class'> = {
  'MBA 2025-27': 'class',
  'MBA 2026-28': 'section'
};

// Section calendars are shared read-only with everyone in this Google Workspace domain,
// with one sharing rule per calendar (not one per student — Google limits mass sharing).
export const SHARE_DOMAIN = 'iimu.ac.in';

const TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';
const PORTAL_URL = 'https://acad-student-portal.vercel.app';
const ORGANIZER_EMAIL = (process.env.ACAD_ORGANIZER_EMAIL ?? 'acad@iimu.ac.in').toLowerCase();

// Old guest invites: Google allows at most 200 directly invited guests per event.
// Batch-wide events are split into parts of this size.
const MAX_GUESTS_PER_EVENT = 190;

// Most operations handed to the Apps Script in one run (it has ~5 minutes per run).
const MAX_OPS_PER_PLAN = 150;

// A class that disappears from the timetable is only removed once it has been missing for
// this long. Protects against the brief moment during a sync when important_events is
// cleared and refilled, and against half-finished edits.
const DELETE_GRACE_MS = 8 * 60 * 1000;

const EVENT_DURATION_MINUTES: Record<string, number> = { endterm: 120, quiz: 45, other: 90 };
const LABEL_TIME_SUFFIX_RE = / — (\d{1,2}):(\d{2}) (AM|PM)$/;

// ---------- types ----------

type CalendarResource = Record<string, unknown>;

// A phone notification to send once the Apps Script confirms the calendar change.
export type PushNote = {
  title: string;
  body: string;
  tag: string; // same class → same tag, so a newer alert replaces an older one on the phone
  studentIds: string[];
};

export type PlanOp = {
  op: 'create' | 'update' | 'delete' | 'createCalendar';
  key: string; // event key, or the feed key for createCalendar
  eventId: string; // '' for createCalendar
  calendarId: string; // 'primary' = acad@'s own calendar (old guest invites)
  feedKey: string | null;
  batchLabel: string;
  summary: string;
  sendUpdates: 'all' | 'none';
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  contentHash: string;
  attendeeHash: string;
  origin: string | null;
  audience: string | null;
  cancel: boolean; // true = keep the event but mark it "❌ CANCELLED"
  reason: string;
  resource?: CalendarResource; // create/update/createCalendar
  shareDomain?: string; // createCalendar only
  notify: PushNote | null;
};

export type Settings = {
  paused: boolean;
  enabled_batches: string[];
  silent_until: string | null;
  notify_window_hours: number;
  max_changes_per_run: number;
  bulk_approved_until: string | null;
  feeds_enabled: boolean;
  legacy_guests_enabled: boolean;
  push_enabled: boolean;
  max_new_calendars_per_run: number;
  max_new_calendars_per_day: number;
};

const SETTING_DEFAULTS: Pick<
  Settings,
  'feeds_enabled' | 'legacy_guests_enabled' | 'push_enabled' | 'max_new_calendars_per_run' | 'max_new_calendars_per_day'
> = {
  feeds_enabled: false,
  legacy_guests_enabled: true,
  push_enabled: true,
  max_new_calendars_per_run: 3,
  max_new_calendars_per_day: 40
};

export type BatchStats = {
  term: string;
  grouping: 'section' | 'class';
  // section calendars
  sectionCalendars: number;
  calendarsStillToCreate: number;
  sectionEvents: number;
  waitingForCalendar: number;
  studentsMoved: number;
  studentsAwaitingConfirm: number; // calendars added, but not yet confirmed visible on their phone
  studentsOnOldInvites: number;
  // old guest invites
  oldInviteEvents: number;
  oldInvitesToRemove: number;
  // this run
  creates: number;
  updates: number;
  materialUpdates: number;
  cancelledKeptVisible: number;
  deletes: number;
  waitingToDelete: number;
  emails: number;
  pushAlerts: number;
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
  calendar_id: string | null;
  feed_key: string | null;
  summary: string | null;
  all_day: boolean | null;
  origin: string | null;
  cancelled_at: string | null;
  audience: string | null;
};

// ---------- small helpers ----------

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

// Google event IDs allow only a–v and 0–9. 'acad' + 's'/'e'/'f' + hex digits all qualify,
// and the prefix can never collide with the old button's 'sess…'/'evt…' IDs.
const sessionEventId = (key: string) => `acads${sha1(key)}`;
const otherEventId = (key: string) => `acade${sha1(key)}`;
const feedEventId = (key: string) => `acadf${sha1(key)}`;

function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE }); // YYYY-MM-DD
}

function istDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
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
export async function fetchAll<T>(
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

const sortedJoin = (ids: Iterable<string>) => [...ids].sort().join(',');

// ---------- loading one batch ----------

type SessionRow = {
  subject_id: string;
  section_id: string | null;
  session_number: number | null;
  session_label: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  room: string | null;
};

type ImportantEventRow = {
  event_date: string;
  type: string;
  label: string;
  subject_id: string | null;
  location: string | null;
};

export type BatchData = {
  batchLabel: string;
  term: string;
  emailById: Map<string, string>;
  idByEmail: Map<string, string>;
  enrollments: { student_id: string; subject_id: string; section_id: string | null }[];
  subjectName: Map<string, string>;
  sectionLabel: Map<string, string | null>;
  sessions: SessionRow[];
  importantEvents: ImportantEventRow[];
};

export async function loadBatchData(
  admin: SupabaseClient,
  batchLabel: string,
  options: { withTimetable: boolean }
): Promise<BatchData> {
  const term = BATCH_TERMS[batchLabel];
  if (!term) throw new Error(`No term configured for batch "${batchLabel}" in BATCH_TERMS`);
  const today = istToday();

  const students = await fetchAll<{ id: string; email: string }>((from, to) =>
    admin.from('students').select('id, email').eq('batch_label', batchLabel).range(from, to)
  );
  const usable = students.filter((s) => s.email && s.email.toLowerCase() !== ORGANIZER_EMAIL);
  const emailById = new Map(usable.map((s) => [s.id, s.email.toLowerCase()]));
  const idByEmail = new Map(usable.map((s) => [s.email.toLowerCase(), s.id]));

  const allEnrollments = await fetchAll<{ student_id: string; subject_id: string; section_id: string | null }>(
    (from, to) =>
      admin.from('enrollments').select('student_id, subject_id, section_id').eq('term', term).range(from, to)
  );
  // Another batch can use the same term label — keep only this batch's students.
  const enrollments = allEnrollments.filter((e) => emailById.has(e.student_id));

  const subjects = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin.from('subjects').select('id, name').eq('term', term).eq('batch_label', batchLabel).range(from, to)
  );
  const sections = await fetchAll<{ id: string; section_label: string | null }>((from, to) =>
    admin.from('sections').select('id, section_label').eq('term', term).eq('batch_label', batchLabel).range(from, to)
  );

  let sessions: SessionRow[] = [];
  let importantEvents: ImportantEventRow[] = [];
  if (options.withTimetable) {
    sessions = await fetchAll<SessionRow>((from, to) =>
      admin
        .from('sessions')
        .select('subject_id, section_id, session_number, session_label, session_date, start_time, end_time, room')
        .eq('term', term)
        .eq('batch_label', batchLabel)
        .gte('session_date', today)
        .range(from, to)
    );
    importantEvents = await fetchAll<ImportantEventRow>((from, to) =>
      admin
        .from('important_events')
        .select('event_date, type, label, subject_id, location')
        .eq('term', term)
        .eq('batch_label', batchLabel)
        .gte('event_date', today)
        .range(from, to)
    );
  }

  return {
    batchLabel,
    term,
    emailById,
    idByEmail,
    enrollments,
    subjectName: new Map(subjects.map((s) => [s.id, s.name])),
    sectionLabel: new Map(sections.map((s) => [s.id, s.section_label])),
    sessions,
    importantEvents
  };
}

// ---------- section calendars ("feeds") ----------

export type Feed = {
  key: string;
  batchLabel: string;
  term: string;
  kind: 'class' | 'section' | 'batch';
  subjectId: string | null;
  sectionId: string | null;
  sectionLabel: string | null;
  title: string;
  members: Set<string>; // student ids
};

export type FeedModel = {
  grouping: 'section' | 'class';
  batchFeedKey: string;
  feeds: Map<string, Feed>;
  feedFor: (subjectId: string, sectionId: string | null) => string;
  studentFeeds: Map<string, Set<string>>; // student id → feed keys they need
};

export function buildFeeds(data: BatchData): FeedModel {
  const { batchLabel, term } = data;
  const keyOf = (...parts: string[]) => `feed:${sha1([batchLabel, term, ...parts].join('|'))}`;
  const batchFeedKey = keyOf('batch');

  const enrolled = new Set<string>();
  const bySubjectSection = new Map<string, Set<string>>();
  for (const e of data.enrollments) {
    enrolled.add(e.student_id);
    const k = `${e.subject_id}::${e.section_id ?? 'null'}`;
    if (!bySubjectSection.has(k)) bySubjectSection.set(k, new Set());
    bySubjectSection.get(k)!.add(e.student_id);
  }
  const allEnrolled = sortedJoin(enrolled);

  // 'section' grouping is only correct if, for every section letter, every subject's
  // section with that letter has exactly the same students. Checked every run.
  let grouping = FEED_GROUPING[batchLabel] ?? 'class';
  if (grouping === 'section') {
    const membersByLabel = new Map<string, string>();
    let ok = true;
    for (const [k, members] of bySubjectSection) {
      const sectionId = k.split('::')[1];
      const label = sectionId === 'null' ? null : data.sectionLabel.get(sectionId) ?? null;
      if (!label) continue;
      const joined = sortedJoin(members);
      const seen = membersByLabel.get(label);
      if (seen === undefined) membersByLabel.set(label, joined);
      else if (seen !== joined) {
        ok = false;
        break;
      }
    }
    if (!ok || membersByLabel.size === 0) grouping = 'class';
  }

  const memo = new Map<string, string>();
  const meta = new Map<string, Omit<Feed, 'members'>>();
  const feedFor = (subjectId: string, sectionId: string | null): string => {
    const memoKey = `${subjectId}::${sectionId ?? 'null'}`;
    const cached = memo.get(memoKey);
    if (cached) return cached;
    const label = sectionId ? data.sectionLabel.get(sectionId) ?? null : null;
    const subject = data.subjectName.get(subjectId) ?? 'Class';
    let key: string;
    if (grouping === 'section' && sectionId && label) {
      key = keyOf('section', label);
      if (!meta.has(key)) {
        meta.set(key, { key, batchLabel, term, kind: 'section', subjectId: null, sectionId: null, sectionLabel: label,
          title: `ACAD · Section ${label} (${term})` });
      }
    } else if (!sectionId && sortedJoin(bySubjectSection.get(memoKey) ?? []) === allEnrolled) {
      key = batchFeedKey; // an unsectioned subject the whole batch takes
    } else {
      key = keyOf('class', subjectId, sectionId ?? 'null');
      if (!meta.has(key)) {
        meta.set(key, { key, batchLabel, term, kind: 'class', subjectId, sectionId, sectionLabel: label,
          title: `ACAD · ${subject}${label ? ` · Sec ${label}` : ''} (${term})` });
      }
    }
    memo.set(memoKey, key);
    return key;
  };

  meta.set(batchFeedKey, { key: batchFeedKey, batchLabel, term, kind: 'batch', subjectId: null, sectionId: null,
    sectionLabel: null, title: `ACAD · Batch events (${term})` });

  const feeds = new Map<string, Feed>();
  const studentFeeds = new Map<string, Set<string>>();
  const addMember = (feedKey: string, studentId: string) => {
    if (!feeds.has(feedKey)) feeds.set(feedKey, { ...meta.get(feedKey)!, members: new Set() });
    feeds.get(feedKey)!.members.add(studentId);
    if (!studentFeeds.has(studentId)) studentFeeds.set(studentId, new Set());
    studentFeeds.get(studentId)!.add(feedKey);
  };
  for (const studentId of enrolled) addMember(batchFeedKey, studentId);
  for (const e of data.enrollments) addMember(feedFor(e.subject_id, e.section_id), e.student_id);

  return { grouping, batchFeedKey, feeds, feedFor, studentFeeds };
}

// ---------- what a class / event looks like on the calendar ----------

type Timing = {
  start: Record<string, string>;
  end: Record<string, string>;
  startAt: string; // ISO with +05:30
  endAt: string;
  allDay: boolean;
};

type ClassEntry = {
  origin: string; // stable identity of the timetable entry (shared by every calendar copy)
  summary: string;
  descriptionLines: string[];
  location: string | null;
  timing: Timing;
  feedKeys: string[]; // which section calendars it belongs on
  guestEmails: string[]; // for old guest invites
  idFor: (key: string) => string; // old guest-invite event IDs
};

function sessionTiming(s: SessionRow): Timing {
  return {
    start: { dateTime: `${s.session_date}T${normTime(s.start_time)}`, timeZone: TIME_ZONE },
    end: { dateTime: `${s.session_date}T${normTime(s.end_time)}`, timeZone: TIME_ZONE },
    startAt: istIso(s.session_date, s.start_time),
    endAt: istIso(s.session_date, s.end_time),
    allDay: false
  };
}

function eventTiming(e: ImportantEventRow): { summary: string; timing: Timing } {
  const timeMatch = e.label.match(LABEL_TIME_SUFFIX_RE);
  if (timeMatch) {
    const [, h, m, meridiem] = timeMatch;
    const startTime = to24Hour(h, m, meridiem);
    const finish = addMinutes(e.event_date, startTime, EVENT_DURATION_MINUTES[e.type] ?? 90);
    return {
      summary: e.label.replace(LABEL_TIME_SUFFIX_RE, ''),
      timing: {
        start: { dateTime: `${e.event_date}T${startTime}:00`, timeZone: TIME_ZONE },
        end: { dateTime: `${finish.date}T${finish.time}:00`, timeZone: TIME_ZONE },
        startAt: istIso(e.event_date, startTime),
        endAt: istIso(finish.date, finish.time),
        allDay: false
      }
    };
  }
  // No time in the sheet → all-day event. Google's all-day end date is exclusive.
  return {
    summary: e.label,
    timing: {
      start: { date: e.event_date },
      end: { date: nextDay(e.event_date) },
      startAt: istIso(e.event_date, '00:00'),
      endAt: istIso(nextDay(e.event_date), '00:00'),
      allDay: true
    }
  };
}

// Everything on the timetable from today on, once, with who it is for.
function buildClassEntries(data: BatchData, model: FeedModel): { entries: ClassEntry[]; classesWithNoStudents: number } {
  const { batchLabel, term } = data;
  const now = Date.now();
  const entries: ClassEntry[] = [];
  let classesWithNoStudents = 0;

  const emailsBySubjectSection = new Map<string, string[]>();
  const enrollmentsBySubject = new Map<string, { student_id: string; section_id: string | null }[]>();
  const enrolledEmails = new Set<string>();
  for (const e of data.enrollments) {
    const email = data.emailById.get(e.student_id)!;
    enrolledEmails.add(email);
    const k = `${e.subject_id}::${e.section_id ?? 'null'}`;
    if (!emailsBySubjectSection.has(k)) emailsBySubjectSection.set(k, []);
    emailsBySubjectSection.get(k)!.push(email);
    if (!enrollmentsBySubject.has(e.subject_id)) enrollmentsBySubject.set(e.subject_id, []);
    enrollmentsBySubject.get(e.subject_id)!.push(e);
  }

  for (const s of data.sessions) {
    const timing = sessionTiming(s);
    if (Date.parse(timing.endAt) <= now) continue; // already over

    const emails = emailsBySubjectSection.get(`${s.subject_id}::${s.section_id ?? 'null'}`) ?? [];
    if (emails.length === 0) {
      classesWithNoStudents++;
      continue;
    }

    const identity =
      s.session_number !== null && s.session_number !== undefined
        ? `n${s.session_number}`
        : `l${s.session_label ?? ''}|${s.session_date}|${normTime(s.start_time)}`;
    const origin = `sess:${sha1(`${batchLabel}|${term}|${s.subject_id}|${s.section_id ?? 'null'}|${identity}`)}`;

    const name = data.subjectName.get(s.subject_id) ?? 'Class';
    const suffix = s.session_label
      ? ` · ${s.session_label}`
      : s.session_number !== null && s.session_number !== undefined
        ? ` · Session ${s.session_number}`
        : '';
    const section = s.section_id ? data.sectionLabel.get(s.section_id) : null;
    entries.push({
      origin,
      summary: `${name}${suffix}`,
      descriptionLines: [section ? `Section ${section}` : null, s.room ? `Room ${s.room}` : null].filter(
        (l): l is string => l !== null
      ),
      location: s.room,
      timing,
      feedKeys: [model.feedFor(s.subject_id, s.section_id)],
      guestEmails: emails,
      idFor: sessionEventId
    });
  }

  for (const e of data.importantEvents) {
    let emails: string[];
    let feedKeys: string[];
    if (e.subject_id) {
      const ens = enrollmentsBySubject.get(e.subject_id) ?? [];
      emails = ens.map((en) => data.emailById.get(en.student_id)!);
      feedKeys = [...new Set(ens.map((en) => model.feedFor(e.subject_id!, en.section_id)))];
    } else {
      emails = [...enrolledEmails];
      feedKeys = [model.batchFeedKey];
    }
    if (emails.length === 0) {
      classesWithNoStudents++;
      continue;
    }

    const { summary, timing } = eventTiming(e);
    if (Date.parse(timing.endAt) <= now) continue;
    entries.push({
      origin: `evt:${sha1(`${batchLabel}|${term}|${e.event_date}|${e.type}|${e.label}|${e.subject_id ?? 'null'}`)}`,
      summary,
      descriptionLines: e.location ? [`Venue: ${e.location}`] : [],
      location: e.location,
      timing,
      feedKeys,
      guestEmails: emails,
      idFor: otherEventId
    });
  }

  return { entries, classesWithNoStudents };
}

const FEED_NOTE =
  'From the official ACAD timetable. This updates by itself if the class is moved, changes room or is cancelled.';
const GUEST_NOTE =
  'Added by ACAD from the official timetable. This invite updates by itself if the class is moved, ' +
  'cancelled or changes room — please keep it (don’t decline or delete it).';

// Same layout as before this change, so existing guest events don't all look "changed".
const describe = (lines: string[], note: string) => [...lines, '', note, PORTAL_URL].join('\n');

// --- section-calendar events ---

type DesiredFeedEvent = {
  key: string;
  eventId: string;
  feedKey: string;
  calendarId: string;
  summary: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  contentHash: string;
  origin: string;
  resource: CalendarResource;
};

function buildDesiredFeedEvents(
  entries: ClassEntry[],
  calendarIdByFeed: Map<string, string>
): { events: Map<string, DesiredFeedEvent>; waitingForCalendar: Set<string> } {
  const events = new Map<string, DesiredFeedEvent>();
  const waitingForCalendar = new Set<string>();
  for (const c of entries) {
    const description = describe(c.descriptionLines, FEED_NOTE);
    const contentHash = sha1(JSON.stringify({ summary: c.summary, description, location: c.location, start: c.timing.start, end: c.timing.end }));
    for (const feedKey of c.feedKeys) {
      const calendarId = calendarIdByFeed.get(feedKey);
      if (!calendarId) {
        waitingForCalendar.add(feedKey);
        continue;
      }
      const key = `f:${sha1(`${feedKey}|${c.origin}`)}`;
      const eventId = feedEventId(key);
      events.set(key, {
        key,
        eventId,
        feedKey,
        calendarId,
        summary: c.summary,
        startAt: c.timing.startAt,
        endAt: c.timing.endAt,
        allDay: c.timing.allDay,
        location: c.location,
        contentHash,
        origin: c.origin,
        resource: {
          id: eventId,
          status: 'confirmed',
          summary: c.summary,
          description,
          location: c.location ?? undefined,
          start: c.timing.start,
          end: c.timing.end,
          transparency: 'opaque',
          reminders: { useDefault: true }, // each student's own default (set to a 15-min popup when subscribed)
          extendedProperties: { private: { acadKey: key, acadOrigin: c.origin } }
        }
      });
    }
  }
  return { events, waitingForCalendar };
}

// --- old guest-invite events ---

type DesiredGuestEvent = {
  key: string;
  eventId: string;
  summary: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  contentHash: string;
  attendeeHash: string;
  origin: string;
  audience: string;
  guestEmails: string[];
  resource: CalendarResource;
};

function buildDesiredGuestEvents(
  entries: ClassEntry[],
  includeEmail: (email: string) => boolean
): { events: Map<string, DesiredGuestEvent>; keysForEveryone: Set<string> } {
  const events = new Map<string, DesiredGuestEvent>();
  const keysForEveryone = new Set<string>(); // keys that would exist if nobody had moved yet
  for (const c of entries) {
    const description = describe(c.descriptionLines, GUEST_NOTE);
    const contentHash = sha1(JSON.stringify({ summary: c.summary, description, location: c.location, start: c.timing.start, end: c.timing.end }));
    const partKey = (i: number) => (i === 0 ? c.origin : `${c.origin}#p${i}`);

    chunk([...c.guestEmails].sort(), MAX_GUESTS_PER_EVENT).forEach((_, i) => keysForEveryone.add(partKey(i)));

    const remaining = c.guestEmails.filter(includeEmail).sort();
    // Part 0 keeps the plain key, so an event that grows past 190 guests keeps its
    // existing calendar event and only gains a second part.
    chunk(remaining, MAX_GUESTS_PER_EVENT).forEach((part, i) => {
      const key = partKey(i);
      const eventId = c.idFor(key);
      events.set(key, {
        key,
        eventId,
        summary: c.summary,
        startAt: c.timing.startAt,
        endAt: c.timing.endAt,
        allDay: c.timing.allDay,
        location: c.location,
        contentHash,
        attendeeHash: sha1(part.join(',')),
        origin: c.origin,
        audience: c.feedKeys.join(','),
        guestEmails: part,
        resource: {
          id: eventId,
          status: 'confirmed',
          summary: c.summary,
          description,
          location: c.location ?? undefined,
          start: c.timing.start,
          end: c.timing.end,
          attendees: part.map((email) => ({ email })),
          guestsCanSeeOtherGuests: false,
          guestsCanModify: false,
          guestsCanInviteOthers: false,
          extendedProperties: { private: { acadKey: key } }
        }
      });
    });
  }
  return { events, keysForEveryone };
}

// "❌ CANCELLED" version of an event, so a class cancelled at the last minute stays visible.
function cancelledResource(l: LedgerRow): CalendarResource {
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
    extendedProperties: { private: { acadKey: l.key, acadCancelled: 'true' } }
  };
}

// ---------- phone-notification wording ----------

function whenText(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) return d.toLocaleDateString('en-IN', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });
  return d.toLocaleString('en-IN', {
    timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function placeText(location: string | null): string {
  if (!location) return '';
  return /^[A-Za-z]?\d+[A-Za-z]?$/.test(location.trim()) ? `Room ${location.trim()}` : location.trim();
}

type NoteKind = 'new' | 'changed' | 'cancelled' | 'restored';

function noteFor(
  kind: NoteKind,
  origin: string,
  summary: string,
  allDay: boolean,
  now: { startAt: string; location: string | null },
  before?: { startAt: string; location: string | null }
): Omit<PushNote, 'studentIds'> {
  const tag = `acad-${sha1(origin).slice(0, 16)}`;
  const place = placeText(now.location);
  const when = whenText(now.startAt, allDay);
  if (kind === 'new') return { tag, title: `New: ${summary}`, body: [when, place].filter(Boolean).join(' · ') };
  if (kind === 'cancelled') return { tag, title: `Cancelled: ${summary}`, body: `Was ${when}` };
  if (kind === 'restored') return { tag, title: `Back on: ${summary}`, body: [when, place].filter(Boolean).join(' · ') };
  const moved = before && Date.parse(before.startAt) !== Date.parse(now.startAt);
  const roomChanged = before && (before.location ?? '') !== (now.location ?? '');
  if (moved) {
    return {
      tag,
      title: `Moved: ${summary}`,
      body: `${whenText(before!.startAt, allDay)} → ${when}${place ? ` · ${place}` : ''}`
    };
  }
  if (roomChanged) return { tag, title: `Room change: ${summary}`, body: `Now in ${place || 'a new room'} · ${when}` };
  return { tag, title: `Changed: ${summary}`, body: [when, place].filter(Boolean).join(' · ') };
}

// Students who confirmed on the portal that the ACAD calendars show on their phone.
// Tolerates the column not existing yet (supabase/calendar-feeds/step6_confirm.sql), in which
// case nobody counts as confirmed and everyone simply keeps their guest invites.
export async function confirmedStudents(admin: SupabaseClient, batchLabel: string): Promise<Set<string>> {
  const rows: { id: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('students')
      .select('id')
      .eq('batch_label', batchLabel)
      .not('calendar_confirmed_at', 'is', null)
      .range(from, from + 999);
    if (error) {
      console.warn('calendar_confirmed_at not readable (run step6_confirm.sql):', error.message);
      return new Set();
    }
    rows.push(...((data ?? []) as { id: string }[]));
    if (!data || data.length < 1000) break;
  }
  return new Set(rows.map((r) => r.id));
}

// ---------- settings ----------

export async function readSettings(admin: SupabaseClient): Promise<Settings> {
  const { data, error } = await admin.from('calendar_invite_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(`calendar_invite_settings: ${error.message}`);
  if (!data) throw new Error('calendar_invite_settings has no row — run supabase/calendar-invites/step2_settings.sql');
  const row = data as Partial<Settings>;
  return {
    ...SETTING_DEFAULTS,
    ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
    silent_until: row.silent_until ?? null,
    bulk_approved_until: row.bulk_approved_until ?? null
  } as Settings;
}

// ---------- the plan ----------

const emptyStats = (term: string, grouping: 'section' | 'class'): BatchStats => ({
  term, grouping, sectionCalendars: 0, calendarsStillToCreate: 0, sectionEvents: 0, waitingForCalendar: 0,
  studentsMoved: 0, studentsAwaitingConfirm: 0, studentsOnOldInvites: 0, oldInviteEvents: 0, oldInvitesToRemove: 0, creates: 0, updates: 0,
  materialUpdates: 0, cancelledKeptVisible: 0, deletes: 0, waitingToDelete: 0, emails: 0, pushAlerts: 0, silent: false,
  classesWithNoStudents: 0
});

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
  const feedsOn = settings.feeds_enabled;

  // Google puts an account into read-only mode if it creates too many calendars in a
  // short time — so new section calendars are made a few at a time.
  let calendarBudget = 0;
  if (feedsOn) {
    const { count } = await admin
      .from('calendar_feeds')
      .select('key', { count: 'exact', head: true })
      .gte('calendar_created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());
    calendarBudget = Math.max(0, Math.min(settings.max_new_calendars_per_run, settings.max_new_calendars_per_day - (count ?? 0)));
  }

  const allOps: PlanOp[] = [];
  const stats: Record<string, BatchStats> = {};
  const markMissing: string[] = [];
  const clearMissing: string[] = [];
  const materialOrigins = new Set<string>(); // one real timetable change counts once for the safety brake
  const feedRows: Record<string, unknown>[] = [];
  const newlyFilled: string[] = [];
  let heldReason: string | null = null;

  for (const batchLabel of settings.enabled_batches) {
    const data = await loadBatchData(admin, batchLabel, { withTimetable: true });
    const model = buildFeeds(data);
    const { entries, classesWithNoStudents } = buildClassEntries(data, model);
    const s = emptyStats(data.term, model.grouping);
    s.classesWithNoStudents = classesWithNoStudents;

    const ledger = await fetchAll<LedgerRow>((from, to) =>
      admin.from('calendar_invite_ledger').select('*').eq('batch_label', batchLabel).range(from, to)
    );
    const feedLedger = ledger.filter((r) => r.calendar_id !== null);
    const guestLedger = ledger.filter((r) => r.calendar_id === null);

    const push = (op: PlanOp) => {
      allOps.push(op);
      if (op.sendUpdates === 'all') s.emails++;
    };
    // Phone alerts are filled in once we know who has moved to section calendars.
    const feedNotes: { op: PlanOp; feedKeys: string[] }[] = [];
    const base = { batchLabel, attendeeHash: '', audience: null, cancel: false, notify: null } as const;

    // ===== 1. section calendars =====
    const moved = new Set<string>(); // student ids fully on section calendars
    if (feedsOn) {
      const existing = await fetchAll<{ key: string; calendar_id: string | null; filled_at: string | null }>((from, to) =>
        admin.from('calendar_feeds').select('key, calendar_id, filled_at').eq('batch_label', batchLabel).eq('term', data.term).range(from, to)
      );
      const calendarIdByFeed = new Map(
        existing.filter((r) => r.calendar_id).map((r) => [r.key, r.calendar_id as string])
      );
      const filledBefore = new Set(existing.filter((r) => r.filled_at).map((r) => r.key));

      for (const f of model.feeds.values()) {
        feedRows.push({
          key: f.key, batch_label: f.batchLabel, term: f.term, kind: f.kind, subject_id: f.subjectId,
          section_id: f.sectionId, section_label: f.sectionLabel, title: f.title, updated_at: nowIso
        });
      }
      s.sectionCalendars = model.feeds.size;

      // Calendars still to create: the batch calendar first, then the biggest sections.
      const toCreate = [...model.feeds.values()]
        .filter((f) => !calendarIdByFeed.has(f.key))
        .sort((a, b) => (a.kind === 'batch' ? -1 : b.kind === 'batch' ? 1 : b.members.size - a.members.size));
      s.calendarsStillToCreate = toCreate.length;
      for (const f of toCreate) {
        if (calendarBudget <= 0) break;
        calendarBudget--;
        push({
          ...base, op: 'createCalendar', key: f.key, eventId: '', calendarId: '', feedKey: f.key, summary: f.title,
          sendUpdates: 'none', startAt: nowIso, endAt: nowIso, allDay: false, location: null, contentHash: '',
          origin: null, reason: 'new section calendar', shareDomain: SHARE_DOMAIN,
          resource: {
            summary: f.title,
            description: `Official ACAD timetable for ${f.kind === 'batch' ? `the whole of ${batchLabel}` : f.title.replace(/^ACAD · /, '')}. ` +
              `Updated automatically from the ACAD portal — do not edit.\n${PORTAL_URL}\n[${f.key}]`,
            timeZone: TIME_ZONE
          }
        });
      }

      const { events: desired, waitingForCalendar } = buildDesiredFeedEvents(entries, calendarIdByFeed);
      s.sectionEvents = desired.size;
      s.waitingForCalendar = waitingForCalendar.size;
      const ledgerByKey = new Map(feedLedger.map((r) => [r.key, r]));
      const feedsWithEvents = new Set(feedLedger.map((r) => r.feed_key));
      // Feeds that still have classes waiting to be put on them for the first time.
      const stillFilling = new Set<string>(waitingForCalendar);

      for (const d of desired.values()) {
        const l = ledgerByKey.get(d.key);
        // A brand-new calendar is filled silently; after that, new classes within 48h alert.
        const silent = globallySilent || !feedsWithEvents.has(d.feedKey);
        const common = {
          ...base, key: d.key, eventId: d.eventId, calendarId: d.calendarId, feedKey: d.feedKey, summary: d.summary,
          sendUpdates: 'none' as const, startAt: d.startAt, endAt: d.endAt, allDay: d.allDay, location: d.location,
          contentHash: d.contentHash, origin: d.origin, resource: d.resource
        };

        if (!l || l.calendar_id !== d.calendarId) {
          s.creates++;
          stillFilling.add(d.feedKey);
          const op: PlanOp = { ...common, op: 'create', reason: 'new on the timetable' };
          if (!l && !silent && within(d.startAt)) {
            op.notify = { ...noteFor('new', d.origin, d.summary, d.allDay, d), studentIds: [] };
            feedNotes.push({ op, feedKeys: [d.feedKey] });
          }
          push(op);
          continue;
        }
        if (l.missing_since) clearMissing.push(l.key);
        if (Date.parse(l.start_at) < now) continue; // never touch a class that has already started

        if (l.cancelled_at) {
          // Cancelled earlier, now back on the timetable.
          s.updates++;
          s.materialUpdates++;
          materialOrigins.add(d.origin);
          const op: PlanOp = { ...common, op: 'update', reason: 'back on the timetable' };
          if (!globallySilent && within(d.startAt)) {
            op.notify = { ...noteFor('restored', d.origin, d.summary, d.allDay, d), studentIds: [] };
            feedNotes.push({ op, feedKeys: [d.feedKey] });
          }
          push(op);
          continue;
        }
        if (l.content_hash === d.contentHash) continue;

        const material =
          Date.parse(l.start_at) !== Date.parse(d.startAt) ||
          Date.parse(l.end_at) !== Date.parse(d.endAt) ||
          (l.location ?? '') !== (d.location ?? '');
        s.updates++;
        const op: PlanOp = { ...common, op: 'update', reason: material ? 'time or room changed' : 'details changed' };
        if (material) {
          s.materialUpdates++;
          materialOrigins.add(d.origin);
          if (!globallySilent && (within(d.startAt) || within(l.start_at))) {
            op.notify = {
              ...noteFor('changed', d.origin, d.summary, d.allDay, d, { startAt: l.start_at, location: l.location }),
              studentIds: []
            };
            feedNotes.push({ op, feedKeys: [d.feedKey] });
          }
        }
        push(op);
      }

      for (const l of feedLedger) {
        if (desired.has(l.key)) continue;
        if (l.feed_key && waitingForCalendar.has(l.feed_key)) continue; // calendar being replaced — leave it
        if (Date.parse(l.start_at) < now) continue; // past — leave it alone
        if (l.cancelled_at) continue; // already shown as cancelled
        if (!l.missing_since) {
          markMissing.push(l.key);
          s.waitingToDelete++;
          continue;
        }
        if (now - Date.parse(l.missing_since) < DELETE_GRACE_MS) {
          s.waitingToDelete++;
          continue;
        }
        materialOrigins.add(l.origin ?? l.key);
        const common = {
          ...base, key: l.key, eventId: l.event_id, calendarId: l.calendar_id as string, feedKey: l.feed_key,
          summary: l.summary ?? '(removed from timetable)', sendUpdates: 'none' as const, startAt: l.start_at,
          endAt: l.end_at, allDay: !!l.all_day, location: l.location, origin: l.origin
        };
        if (!globallySilent && within(l.start_at)) {
          // Last-minute cancellation: keep it on the calendar, clearly marked, and alert.
          s.cancelledKeptVisible++;
          const op: PlanOp = {
            ...common, op: 'update', cancel: true, contentHash: 'cancelled', reason: 'cancelled (kept visible, marked)',
            resource: cancelledResource(l),
            notify: { ...noteFor('cancelled', l.origin ?? l.key, l.summary ?? 'Class', !!l.all_day, { startAt: l.start_at, location: l.location }), studentIds: [] }
          };
          if (l.feed_key) feedNotes.push({ op, feedKeys: [l.feed_key] });
          push(op);
        } else {
          s.deletes++;
          push({ ...common, op: 'delete', contentHash: l.content_hash, reason: 'no longer on the timetable' });
        }
      }

      // Who can come off the old guest invites: every one of their section calendars
      // exists, is fully filled in, and is verified to be in their Google Calendar.
      // Once a calendar has been completely filled it stays "ready" for good, so a later
      // timetable change never puts students back on the old guest invites.
      const readyFeeds = new Set(
        [...model.feeds.keys()].filter((k) => calendarIdByFeed.has(k) && (filledBefore.has(k) || !stillFilling.has(k)))
      );
      newlyFilled.push(...[...readyFeeds].filter((k) => !filledBefore.has(k)));
      const subs = await fetchAll<{ student_id: string; feed_key: string }>((from, to) =>
        admin
          .from('calendar_feed_subscriptions')
          .select('student_id, feed_key, calendar_feeds!inner(batch_label, term)')
          .eq('calendar_feeds.batch_label', batchLabel)
          .eq('calendar_feeds.term', data.term)
          .range(from, to)
      );
      const subscribed = new Map<string, Set<string>>();
      for (const r of subs) {
        if (!subscribed.has(r.student_id)) subscribed.set(r.student_id, new Set());
        subscribed.get(r.student_id)!.add(r.feed_key);
      }
      // Android's Google Calendar app does not sync a newly added calendar until the student
      // turns "Sync" on for it in the app's settings, so "added to their list" is not the same
      // as "visible on their phone". A student therefore only comes off the old guest invites
      // once they have also confirmed on the portal that they can see the ACAD calendars on
      // their phone. Until then they keep both (the invites are what their phone shows).
      const confirmed = await confirmedStudents(admin, batchLabel);
      for (const [studentId, needed] of model.studentFeeds) {
        const has = subscribed.get(studentId);
        if (!(has && [...needed].every((k) => readyFeeds.has(k) && has.has(k)))) continue;
        if (confirmed.has(studentId)) moved.add(studentId);
        else s.studentsAwaitingConfirm++;
      }
      s.studentsMoved = moved.size;
      s.studentsOnOldInvites = model.studentFeeds.size - moved.size;
    }

    // Section-calendar alerts go to that calendar's students who have moved over. Students
    // still on the old guest invites are alerted through the guest-invite change below, so
    // nobody is alerted twice.
    for (const { op, feedKeys } of feedNotes) {
      const ids = new Set<string>();
      for (const k of feedKeys) for (const id of model.feeds.get(k)?.members ?? []) if (moved.has(id)) ids.add(id);
      if (op.notify) op.notify.studentIds = [...ids];
    }

    // ===== 2. old guest invites =====
    const guestsStayOn = !feedsOn || settings.legacy_guests_enabled;
    const includeEmail = (email: string) => {
      if (!guestsStayOn) return false;
      const id = data.idByEmail.get(email);
      return !(id && moved.has(id));
    };
    const { events: desiredGuests, keysForEveryone } = buildDesiredGuestEvents(entries, includeEmail);
    const guestLedgerByKey = new Map(guestLedger.map((r) => [r.key, r]));
    // Classes already on a section calendar. A guest invite created for one of these is a
    // student being put back on the invites (not a new class), so it must not say "New".
    const onSectionCalendar = new Set(feedLedger.map((r) => r.origin).filter((o): o is string => !!o));
    s.oldInviteEvents = guestLedger.filter((r) => Date.parse(r.start_at) >= now).length;
    // First load for a batch (nothing on the calendar yet) is always silent.
    const guestSilent = globallySilent || ledger.length === 0;
    // Class changes never email anyone (no "Updated invitation" / "Cancelled event" mails,
    // which is also what used to trigger the RSVP replies to acad@). Last-minute changes
    // alert phones instead.
    const pushIf = (yes: boolean) => yes && !guestSilent;
    const idsOf = (emails: string[]) => emails.map((e) => data.idByEmail.get(e)).filter((x): x is string => !!x);
    const unmovedMembersOf = (audience: string | null) => {
      const ids = new Set<string>();
      for (const k of (audience ?? '').split(',').filter(Boolean)) {
        for (const id of model.feeds.get(k)?.members ?? []) if (!moved.has(id)) ids.add(id);
      }
      return [...ids];
    };

    for (const d of desiredGuests.values()) {
      const l = guestLedgerByKey.get(d.key);
      const common = {
        ...base, key: d.key, eventId: d.eventId, calendarId: 'primary', feedKey: null, summary: d.summary,
        startAt: d.startAt, endAt: d.endAt, allDay: d.allDay, location: d.location, contentHash: d.contentHash,
        attendeeHash: d.attendeeHash, origin: d.origin, audience: d.audience, resource: d.resource
      };
      if (!l) {
        s.creates++;
        const isNewClass = !onSectionCalendar.has(d.origin);
        const op: PlanOp = { ...common, op: 'create', sendUpdates: 'none', reason: isNewClass ? 'new on the timetable' : 'students back on invites' };
        if (isNewClass && pushIf(within(d.startAt))) op.notify = { ...noteFor('new', d.origin, d.summary, d.allDay, d), studentIds: idsOf(d.guestEmails) };
        push(op);
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
        materialOrigins.add(d.origin);
      }
      const reasons = [material ? 'time or room changed' : contentChanged ? 'details changed' : null, guestsChanged ? 'guest list changed' : null]
        .filter(Boolean)
        .join(', ');
      const alert = material && (within(d.startAt) || within(l.start_at));
      const op: PlanOp = { ...common, op: 'update', sendUpdates: 'none', reason: reasons };
      if (pushIf(alert)) {
        op.notify = {
          ...noteFor('changed', d.origin, d.summary, d.allDay, d, { startAt: l.start_at, location: l.location }),
          studentIds: idsOf(d.guestEmails)
        };
      }
      push(op);
    }

    for (const l of guestLedger) {
      if (desiredGuests.has(l.key)) continue;
      if (Date.parse(l.start_at) < now) continue; // past — leave it alone
      const common = {
        ...base, key: l.key, eventId: l.event_id, calendarId: 'primary', feedKey: null,
        startAt: l.start_at, endAt: l.end_at, allDay: !!l.all_day, location: l.location, contentHash: l.content_hash,
        attendeeHash: l.attendee_hash, origin: l.origin, audience: l.audience
      };

      if (keysForEveryone.has(l.key)) {
        // Still on the timetable — everyone on this invite has moved to section calendars
        // (or old invites were switched off). Remove it quietly, straight away.
        s.oldInvitesToRemove++;
        push({ ...common, op: 'delete', summary: l.summary ?? '(moved to section calendars)', sendUpdates: 'none',
          reason: 'everyone on it now has section calendars' });
        continue;
      }

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
      materialOrigins.add(l.origin ?? l.key);
      // An extra guest part ('#p1', '#p2'…) disappearing just means the guest list got
      // shorter — those students are already on another part — so that one is silent.
      const isExtraPart = l.key.includes('#p');
      const alert = !isExtraPart && within(l.start_at);
      const op: PlanOp = { ...common, op: 'delete', summary: l.summary ?? '(removed from timetable)',
        sendUpdates: 'none', reason: 'no longer on the timetable' };
      if (pushIf(alert)) {
        const ids = unmovedMembersOf(l.audience);
        if (ids.length > 0) {
          op.notify = {
            ...noteFor('cancelled', l.origin ?? l.key, l.summary ?? 'A class', !!l.all_day, { startAt: l.start_at, location: l.location }),
            studentIds: ids
          };
        }
      }
      push(op);
    }

    // A batch whose timetable suddenly reads as empty is almost certainly a sync problem,
    // not a real mass cancellation.
    if (entries.length === 0 && ledger.some((r) => Date.parse(r.start_at) >= now && !r.cancelled_at)) {
      heldReason = `The timetable for ${batchLabel} currently has no upcoming classes, but the calendar does. ` +
        'This usually means a sync or parsing problem, so nothing was removed.';
    }

    if (!settings.push_enabled) for (const op of allOps) op.notify = null;
    for (const op of allOps) if (op.notify && op.notify.studentIds.length === 0) op.notify = null;
    s.pushAlerts = allOps.filter((op) => op.batchLabel === batchLabel && op.notify).length;
    s.silent = globallySilent;
    stats[batchLabel] = s;
  }

  if (!options.preview) {
    for (const rows of chunk(feedRows, 200)) {
      const { error } = await admin.from('calendar_feeds').upsert(rows, { onConflict: 'key' });
      if (error) throw new Error(`calendar_feeds upsert: ${error.message}`);
    }
    for (const keys of chunk(newlyFilled, 100)) {
      await admin.from('calendar_feeds').update({ filled_at: nowIso }).in('key', keys);
    }
    for (const keys of chunk(markMissing, 100)) {
      await admin.from('calendar_invite_ledger').update({ missing_since: nowIso }).in('key', keys);
    }
    for (const keys of chunk(clearMissing, 100)) {
      await admin.from('calendar_invite_ledger').update({ missing_since: null }).in('key', keys);
    }
  }

  if (!heldReason && materialOrigins.size > settings.max_changes_per_run && !bulkApproved) {
    heldReason =
      `${materialOrigins.size} classes would be moved or cancelled in one go (limit ${settings.max_changes_per_run}). ` +
      'Check the timetable sheet. If the change is real, approve it in Supabase with ' +
      "update calendar_invite_settings set bulk_approved_until = now() + interval '1 hour' where id = 1;";
  }

  // Order: new calendars first, then removals, then changes, then new classes —
  // soonest first within each.
  const rank = { createCalendar: 0, delete: 1, update: 2, create: 3 } as const;
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

export type AckResult = PlanOp & { ok: boolean; error?: string | null; createdCalendarId?: string | null };

export async function recordResults(admin: SupabaseClient, results: AckResult[]) {
  const nowIso = new Date().toISOString();
  const succeeded = results.filter((r) => r.ok);

  for (const r of succeeded.filter((x) => x.op === 'createCalendar' && x.createdCalendarId)) {
    const { error } = await admin
      .from('calendar_feeds')
      .update({ calendar_id: r.createdCalendarId, calendar_created_at: nowIso, updated_at: nowIso })
      .eq('key', r.key);
    if (error) throw new Error(`calendar_feeds update: ${error.message}`);
  }

  const upserts = succeeded
    .filter((r) => r.op === 'create' || r.op === 'update')
    .map((r) => ({
      key: r.key,
      event_id: r.eventId,
      batch_label: r.batchLabel,
      content_hash: r.contentHash,
      attendee_hash: r.attendeeHash ?? '',
      start_at: r.startAt,
      end_at: r.endAt,
      location: r.location,
      missing_since: null,
      calendar_id: !r.calendarId || r.calendarId === 'primary' ? null : r.calendarId,
      feed_key: r.feedKey ?? null,
      summary: r.cancel ? (r.summary ?? null) : r.summary,
      all_day: !!r.allDay,
      origin: r.origin ?? null,
      audience: r.audience ?? null,
      cancelled_at: r.cancel ? nowIso : null,
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
    event_id: r.eventId || r.createdCalendarId || '',
    batch_label: r.batchLabel,
    summary: r.summary,
    start_at: r.op === 'createCalendar' ? null : r.startAt,
    send_updates: r.sendUpdates,
    calendar_id: r.op === 'createCalendar' ? r.createdCalendarId ?? null : r.calendarId === 'primary' ? null : r.calendarId,
    pushed_to: r.ok && r.notify ? r.notify.studentIds.length : 0,
    ok: r.ok,
    error: r.error ? String(r.error).slice(0, 500) : null
  }));
  for (const rows of chunk(logRows, 200)) {
    const { error } = await admin.from('calendar_invite_log').insert(rows);
    if (error) throw new Error(`log insert: ${error.message}`);
  }

  await admin.from('calendar_invite_settings').update({ last_ack_at: nowIso }).eq('id', 1);
  return {
    saved: upserts.length,
    removed: deletedKeys.length,
    calendarsCreated: succeeded.filter((r) => r.op === 'createCalendar').length,
    failed: results.length - succeeded.length
  };
}
