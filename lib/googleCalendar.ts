import { google, calendar_v3 } from 'googleapis';
import { createAdminClient } from '@/lib/supabase/server';
import { TERM_5 } from '@/lib/term5';

type SessionToPush = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  room: string | null;
  subjects: { name: string } | null;
};

type ImportantEventToPush = {
  id: string;
  event_date: string;
  type: 'quiz' | 'endterm' | 'other';
  label: string;
};

// Matches the exact suffix parseEvents.ts appends when a time was found in the source
// sheet (`label += " — " + time`, time always formatted as e.g. "9:30 AM" — see
// lib/parseEvents.ts). "Registration"/"Tutorial"/other non-subject events never get this
// suffix at all (OTHER_EVENT_RE's branch never appends a time), which is exactly why
// those fall through to the all-day path below rather than needing separate handling.
const LABEL_TIME_SUFFIX_RE = / — (\d{1,2}):(\d{2}) (AM|PM)$/;

const EVENT_DURATION_MINUTES: Record<ImportantEventToPush['type'], number> = {
  endterm: 120,
  quiz: 45,
  other: 60 // rarely reached — "other" events essentially never carry a parsed time
};

function to24Hour(h: string, m: string, meridiem: string): string {
  let hour = parseInt(h, 10) % 12;
  if (meridiem === 'PM') hour += 12;
  return `${String(hour).padStart(2, '0')}:${m}`;
}

// Adds minutes to a date+time pair, correctly rolling over into the next calendar day if
// needed (a very long exam starting late at night, say). Uses Date.UTC/getUTC* purely as
// a calendar-day calculator (month lengths, leap years) — never attaching any real time-
// of-day or IST offset to it, which matters here: anchoring at IST midnight the way
// lib/parseTimetable.ts does would put that instant in the PREVIOUS day in UTC terms
// (IST is ahead of UTC), so reading the date back via toISOString() would silently
// recover the wrong calendar day even with zero rollover. Pure Y-M-D arithmetic sidesteps
// that entirely.
function addMinutes(dateStr: string, timeStr: string, minutesToAdd: number): { date: string; time: string } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [h, m] = timeStr.split(':').map(Number);
  let totalMinutes = h * 60 + m + minutesToAdd;
  let dayOffset = 0;
  while (totalMinutes >= 24 * 60) {
    totalMinutes -= 24 * 60;
    dayOffset += 1;
  }
  const newHour = Math.floor(totalMinutes / 60);
  const newMinute = totalMinutes % 60;
  const rolled = new Date(Date.UTC(year, month - 1, day + dayOffset));
  const newDate = `${rolled.getUTCFullYear()}-${String(rolled.getUTCMonth() + 1).padStart(2, '0')}-${String(rolled.getUTCDate()).padStart(2, '0')}`;
  return { date: newDate, time: `${String(newHour).padStart(2, '0')}:${String(newMinute).padStart(2, '0')}` };
}

// Google's Calendar API returns this specifically for bursts — "the maximum request rate
// per calendar or per authenticated user" (their own wording), a distinct, tighter limit
// from the aggregate per-minute quota. Sending several inserts in the exact same instant
// (as a Promise.all chunk does) is exactly the shape that trips it, even when total
// volume is nowhere near the real per-minute cap. Detected defensively across a few
// possible error shapes since the googleapis client's error structure isn't fully stable
// across versions — falling back to matching the message text if the structured fields
// aren't where expected.
function isRateLimitError(err: any): boolean {
  const status = err?.code ?? err?.status ?? err?.response?.status;
  if (status === 429) return true;
  if (status !== 403) return false;
  const reason =
    err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason ?? '';
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return true;
  const message = String(err?.message ?? err?.response?.data?.error?.message ?? '');
  return /rate limit/i.test(message);
}

// Google's own prescribed fix for rateLimitExceeded/userRateLimitExceeded is exponential
// backoff — this is that, with jitter so that several chunk-members hitting the limit at
// the same instant don't all retry at exactly the same instant again and immediately
// re-trigger it.
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function pushOneSession(calendar: calendar_v3.Calendar, s: SessionToPush) {
  // Calendar event IDs must be lowercase base32hex (a-v, 0-9), no dashes — a session's
  // UUID hex characters (0-9a-f) already satisfy that once dashes are stripped.
  const eventId = `sess${s.id.replace(/-/g, '')}`.slice(0, 1024);
  const subjectName = s.subjects?.name ?? 'Class';
  const startDateTime = `${s.session_date}T${s.start_time}`;
  const endDateTime = `${s.session_date}T${s.end_time}`;

  const eventBody = {
    summary: subjectName,
    location: s.room ?? undefined,
    start: { dateTime: startDateTime, timeZone: 'Asia/Kolkata' },
    end: { dateTime: endDateTime, timeZone: 'Asia/Kolkata' }
  };

  try {
    await withBackoff(() =>
      calendar.events.insert({ calendarId: 'primary', requestBody: { id: eventId, ...eventBody } })
    );
  } catch (err: any) {
    if (err?.code === 409) {
      // Already exists from a previous push — update instead of duplicating.
      await withBackoff(() => calendar.events.update({ calendarId: 'primary', eventId, requestBody: eventBody }));
    } else {
      throw err;
    }
  }
}

async function pushOneImportantEvent(calendar: calendar_v3.Calendar, e: ImportantEventToPush) {
  // Distinct prefix from sessions/reminders — an important_events UUID could otherwise
  // theoretically collide hex-for-hex with a session or reminder UUID once dashes are
  // stripped, however unlikely; keeping every pushed-thing's id namespace separate rules
  // that out entirely rather than relying on it being improbable.
  const eventId = `evt${e.id.replace(/-/g, '')}`.slice(0, 1024);

  const timeMatch = e.label.match(LABEL_TIME_SUFFIX_RE);
  let eventBody: calendar_v3.Schema$Event;

  if (timeMatch) {
    // A real time was parsed from the source sheet — strip the "— 9:30 AM" suffix from
    // the title (it becomes the event's actual start time instead) and build a proper
    // timed block. Duration is a reasonable default per type, not a real end time —
    // important_events has no end-time column, only a single point pulled from the
    // sheet's text.
    const [, h, m, meridiem] = timeMatch;
    const startTime = to24Hour(h, m, meridiem);
    const { date: endDate, time: endTime } = addMinutes(e.event_date, startTime, EVENT_DURATION_MINUTES[e.type]);

    eventBody = {
      summary: e.label.replace(LABEL_TIME_SUFFIX_RE, ''),
      start: { dateTime: `${e.event_date}T${startTime}:00`, timeZone: 'Asia/Kolkata' },
      end: { dateTime: `${endDate}T${endTime}:00`, timeZone: 'Asia/Kolkata' }
    };
  } else {
    // No time available (this is the normal case for Registration, Tutorial, and other
    // non-subject-specific events — see OTHER_EVENT_RE's comment above) — an all-day
    // event on the known date is still far more useful than not appearing at all, which
    // was the actual gap being fixed here.
    eventBody = {
      summary: e.label,
      start: { date: e.event_date },
      end: { date: e.event_date }
    };
  }

  try {
    await withBackoff(() =>
      calendar.events.insert({ calendarId: 'primary', requestBody: { id: eventId, ...eventBody } })
    );
  } catch (err: any) {
    if (err?.code === 409) {
      await withBackoff(() => calendar.events.update({ calendarId: 'primary', eventId, requestBody: eventBody }));
    } else {
      throw err;
    }
  }
}

export async function pushScheduleToCalendar(studentId: string) {
  // Hardcoded to TERM_5 (MBA2) below — an MBA1 student calling this today would just
  // find zero enrollments for Term V and get nothing pushed (harmless, not broken), but
  // this function doesn't yet know how to push MBA1's own current term. Needs the same
  // batch-parameterization as sync-timetable/route.ts before MBA1 students can use it.
  const admin = createAdminClient();

  const { data: tokenRow } = await admin
    .from('google_tokens')
    .select('refresh_token')
    .eq('student_id', studentId)
    .maybeSingle();

  if (!tokenRow?.refresh_token) {
    throw new Error('No Google refresh token on file — student needs to sign in again to grant Calendar access.');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: tokenRow.refresh_token });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // This function uses the admin (service-role) client, which bypasses RLS — so unlike
  // every other query in the app, the enrollment scoping normally handled automatically
  // by the "students see sessions they're enrolled in" RLS policy does NOT apply here.
  // Fix: replicate the RLS policy's join explicitly — fetch this student's own enrollments
  // for TERM_5, then keep only sessions matching (subject_id, section_id) from that
  // set, same null-safe section match the policy uses (a subject with no sectioning has
  // section_id = null on both sides).
  const { data: enrollments } = await admin
    .from('enrollments')
    .select('subject_id, section_id')
    .eq('student_id', studentId)
    .eq('term', TERM_5);

  if (!enrollments || enrollments.length === 0) {
    return; // Not enrolled in anything this term — nothing to push.
  }

  const enrolledKeys = new Set(
    enrollments.map((e) => `${e.subject_id}::${e.section_id ?? 'null'}`)
  );

  const { data: allTermSessions } = await admin
    .from('sessions')
    .select('id, session_date, start_time, end_time, room, subject_id, section_id, subjects(name)')
    .eq('term', TERM_5);

  const sessions = (allTermSessions ?? []).filter((s) =>
    enrolledKeys.has(`${s.subject_id}::${s.section_id ?? 'null'}`)
  );

  // Bounded concurrency AND paced between chunks — concurrency alone (the previous fix)
  // solved the timeout, but firing 10 inserts in the exact same instant is itself the
  // burst pattern that trips Google's rate limiter, separately from the timeout problem.
  // Lower concurrency + a short pause between chunks smooths the burst; withBackoff above
  // is the safety net for whatever still slips through.
  const CONCURRENCY = 5;
  const CHUNK_PAUSE_MS = 150;
  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const chunk = sessions.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((s) => pushOneSession(calendar, s as unknown as SessionToPush)));
    if (i + CONCURRENCY < sessions.length) {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
    }
  }

  // Registration, quizzes, endterm exams — these live in `important_events`, not
  // `sessions`, and were never included in the push at all until now (the actual gap:
  // students saw these on the Home page calendar but never in their own Google Calendar
  // no matter how many times they clicked "Add to Google Calendar"). Same visibility rule
  // as the important_events RLS policy: events with no subject (Registration, Tutorial —
  // genuinely apply to everyone) go out to every student regardless of enrollment;
  // subject-linked events (quizzes, endterm exams) are scoped to this student's own
  // enrolled subjects. No section_id on this table — an exam applies to every section of
  // a subject together, so subject_id alone is enough, unlike the session match above.
  const enrolledSubjectIds = new Set(enrollments.map((e) => e.subject_id));

  const { data: allTermEvents } = await admin
    .from('important_events')
    .select('id, event_date, type, label, subject_id')
    .eq('term', TERM_5);

  const eventsToPush = (allTermEvents ?? []).filter(
    (e) => e.subject_id === null || enrolledSubjectIds.has(e.subject_id)
  ) as unknown as ImportantEventToPush[];

  for (let i = 0; i < eventsToPush.length; i += CONCURRENCY) {
    const chunk = eventsToPush.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((e) => pushOneImportantEvent(calendar, e)));
    if (i + CONCURRENCY < eventsToPush.length) {
      await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
    }
  }
}
