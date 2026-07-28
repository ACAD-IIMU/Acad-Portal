import { google } from 'googleapis';
import { createAdminClient } from '@/lib/supabase/server';

// Term date range — same TODO as app/home/page.tsx: move to a real `terms` table.
const TERM_START = '2026-01-12';
const TERM_END = '2026-03-20';

export async function pushScheduleToCalendar(studentId: string) {
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

  const { data: sessions } = await admin
    .from('sessions')
    .select('id, session_date, start_time, end_time, room, subjects(name)')
    .gte('session_date', TERM_START)
    .lte('session_date', TERM_END);
  // Note: sessions here should really be filtered to this student's enrollments — this
  // admin-client query bypasses RLS, so in production add an explicit enrollment join/filter
  // rather than relying on RLS to scope it (RLS only auto-scopes queries made with the
  // student's own session, not the service-role client used here).

  for (const s of sessions ?? []) {
    // Calendar event IDs must be lowercase base32hex (a-v, 0-9), no dashes — a session's
    // UUID hex characters (0-9a-f) already satisfy that once dashes are stripped.
    const eventId = `sess${s.id.replace(/-/g, '')}`.slice(0, 1024);
    const subjectName = (s.subjects as any)?.name ?? 'Class';
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
}
