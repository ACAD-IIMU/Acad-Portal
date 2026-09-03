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
    await calendar.events.insert({ calendarId: 'primary', requestBody: { id: eventId, ...eventBody } });
  } catch (err: any) {
    if (err?.code === 409) {
      // Already exists from a previous push — update instead of duplicating.
      await calendar.events.update({ calendarId: 'primary', eventId, requestBody: eventBody });
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
  // Previously this queried `sessions` directly by a hardcoded date range with no student
  // filter at all, which meant every click pushed every section's every session in that
  // window into the clicking student's calendar, not just their own.
  //
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

  // Pushed with bounded concurrency, not one session at a time — sequential awaiting was
  // the actual cause of "Failed to fetch" errors students were seeing. A typical student's
  // course load (~6 subjects, ~120 sessions for the term) sequentially takes 20-40+
  // seconds even at a fast ~200-300ms per Google Calendar API call, which blows past
  // Vercel's function timeout; the connection gets killed mid-request, and the browser
  // reports that as a generic network failure rather than a real error response. 10 at a
  // time keeps wall-clock time to a few seconds regardless of course load, while staying
  // comfortably under Google Calendar API's per-user rate limits.
  const CONCURRENCY = 10;
  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const chunk = sessions.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((s) => pushOneSession(calendar, s as unknown as SessionToPush)));
  }
}
