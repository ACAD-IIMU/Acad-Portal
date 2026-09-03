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
}
