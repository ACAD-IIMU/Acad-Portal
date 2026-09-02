import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';
import TodaysClasses from './TodaysClasses';
import Reminders from './Reminders';
import QuickLinks from './QuickLinks';
import MonthView from './MonthView';
import { TERM_5 } from '@/lib/term5';

// This page is per-student personalized (enrollments, own sessions, own events) — it must
// never be statically cached or served stale to a different logged-in user.
export const dynamic = 'force-dynamic';
import UserMenu from '@/components/UserMenu';

// Fallback only — used if no sessions exist yet for the term (e.g. before the timetable
// sync has run). Once real sessions exist, the actual range below always wins.
const FALLBACK_TERM_START = '2026-06-07';
const FALLBACK_TERM_END = '2026-08-28';

export default async function HomePage() {
  const supabase = createClient();

  const { data: student } = await supabase.from('students').select('*').single();

  const { count: srCount } = await supabase
    .from('sr_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', student?.id ?? '');
  const isSr = (srCount ?? 0) > 0;

  // Computed once, explicitly in IST — the server's own runtime timezone (UTC on
  // Vercel) is irrelevant here. Using the same instant formatted two ways: one
  // machine-readable (YYYY-MM-DD, for the DB query) and one for display, so both
  // are guaranteed to agree with each other and with India's actual calendar day.
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  const todayLabel = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata'
  });

  const { data: earliestSession } = await supabase
    .from('sessions')
    .select('session_date')
    .eq('term', TERM_5)
    .order('session_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: latestSession } = await supabase
    .from('sessions')
    .select('session_date')
    .eq('term', TERM_5)
    .order('session_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const TERM_START = earliestSession?.session_date ?? FALLBACK_TERM_START;
  const TERM_END = latestSession?.session_date ?? FALLBACK_TERM_END;

  const { data: todaysSessions } = await supabase
    .from('sessions')
    .select('*, subjects(name), sections(section_label), prereads(*)')
    .eq('session_date', today)
    .order('start_time');

  const { data: termSessions } = await supabase
    .from('sessions')
    .select('*, subjects(name), sections(section_label)')
    .gte('session_date', TERM_START)
    .lte('session_date', TERM_END)
    .order('session_date')
    .order('start_time');

  const { data: upcomingEvents } = await supabase
    .from('important_events')
    .select('*, subjects(name)')
    .eq('term', TERM_5)
    .gte('event_date', today)
    .order('event_date');

  const { data: allTermEvents } = await supabase
    .from('important_events')
    .select('*, subjects(name)')
    .eq('term', TERM_5)
    .order('event_date');

  // New: personal reminders (this student's own) and SR class announcements (anything
  // an SR has posted for a subject+section this student is enrolled in — RLS does the
  // actual scoping here, matching the same enrollment join `sessions` already uses, so
  // this can never show a different set of subjects than the student's real timetable
  // would). Both filtered to upcoming only, same "gte now" pattern as upcomingEvents
  // above rather than showing reminders that have already passed.
  const { data: personalReminders } = await supabase
    .from('reminders')
    .select('id, title, target_at, subjects(name)')
    .eq('type', 'personal')
    .gte('target_at', now.toISOString())
    .order('target_at');

  const { data: srAnnouncements } = await supabase
    .from('reminders')
    .select('id, title, target_at, subjects(name), sections(section_label)')
    .eq('type', 'sr_announcement')
    .gte('target_at', now.toISOString())
    .order('target_at');

  // This student's own enrolled subjects for TERM_5 — populates the optional subject
  // dropdown when adding a personal reminder ("Corp Val assignment due" etc).
  const { data: enrolledSubjects } = await supabase
    .from('enrollments')
    .select('subject_id, subjects(name)')
    .eq('student_id', student?.id ?? '')
    .eq('term', TERM_5);
  const studentSubjects = (enrolledSubjects ?? [])
    .map((e) => ({ id: e.subject_id, name: (e.subjects as any)?.name as string | undefined }))
    .filter((s): s is { id: string; name: string } => !!s.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex min-h-screen">
      <Sidebar batchLabel={student?.batch_label} />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 md:px-8 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl">Welcome, {student?.full_name?.split(' ')[0] ?? 'there'}</h1>
          <p className="text-inkFaint text-sm">Here&apos;s what&apos;s on today.</p>
        </div>
        <div className="flex items-center gap-3">
          {isSr && (
            <a
              href="/sr"
              className="flex items-center gap-1.5 text-sm font-bold text-white bg-gold-600 rounded-full px-4 py-2 shadow-sm hover:bg-gold-500 transition"
            >
              📄 SR Tools
            </a>
          )}
          <UserMenu
            name={student?.full_name ?? 'Student'}
            regNo={student?.reg_no}
            batchLabel={student?.batch_label}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
        <TodaysClasses
          sessions={todaysSessions ?? []}
          batchLabel={student?.batch_label}
          todayLabel={todayLabel}
          todayDate={today}
        />
        <div className="flex flex-col gap-5">
          <QuickLinks />
          <Reminders
            events={upcomingEvents ?? []}
            todayDate={today}
            personalReminders={(personalReminders ?? []) as any}
            srAnnouncements={(srAnnouncements ?? []) as any}
            studentSubjects={studentSubjects}
          />
        </div>
      </div>

      <MonthView
        sessions={termSessions ?? []}
        termLabel={TERM_5}
        termStart={TERM_START}
        termEnd={TERM_END}
        importantEvents={allTermEvents ?? []}
      />
      </main>
    </div>
  );
}
