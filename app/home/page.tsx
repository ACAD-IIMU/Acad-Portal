import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';
import TodaysClasses from './TodaysClasses';
import Reminders from './Reminders';
import QuickLinks from './QuickLinks';
import ClassCalendarCard from './ClassCalendarCard';
import MonthView from './MonthView';
import { TERM_5 } from '@/lib/term5';
import { TERM_2 } from '@/lib/term2';

// This page is per-student personalized (enrollments, own sessions, own events) — it must
// never be statically cached or served stale to a different logged-in user.
export const dynamic = 'force-dynamic';
import UserMenu from '@/components/UserMenu';

// Fallback only — used if no sessions are VISIBLE yet for this student's term (either
// the sync genuinely hasn't run, or the "students see sessions they're enrolled in"
// RLS policy hides every row because `enrollments` doesn't exist yet for that term).
// Split per cohort so a student at least sees their own real term window while
// sessions are still pending, instead of silently inheriting the other cohort's dates.
//
// MBA1's row is now Term II's window, per the "Term-II" tab's own title in the
// MBA 2026-28 Batch Timetable sheet: "MBA 2026-28, Term-II timetable, 11th
// October – 3rd January, 2026". Read as 11 Oct 2026 – 3 Jan 2027 (the single
// "2026" in that title applies to the start date only, same convention as a
// title normally drops a repeated year) — a term can't end before it starts, so
// 3 Jan 2026 isn't a valid reading. If that's wrong, this is the one line to fix.
const FALLBACK_TERM_RANGES: Record<'MBA1' | 'MBA2', { start: string; end: string }> = {
  MBA1: { start: '2026-10-11', end: '2027-01-03' },
  MBA2: { start: '2026-06-07', end: '2026-08-28' },
};

export default async function HomePage() {
  const supabase = createClient();

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

  // Free-tier fix (Nov 2026): the queries below used to run one after another (nine round
  // trips to Supabase, ~6–7 s per Home load on Vercel). They now run in three parallel
  // rounds — each round only waits for what it actually depends on. Same queries, same
  // results; RLS still scopes every one of them to the signed-in student.

  // Round 1 — nothing here depends on who the student is beyond RLS.
  const [{ data: student }, { data: todaysSessions }, { data: personalReminders }, { data: srAnnouncements }] =
    await Promise.all([
      supabase.from('students').select('*').single(),
      supabase
        .from('sessions')
        .select('*, subjects(name), sections(section_label), prereads(*)')
        .eq('session_date', today)
        .order('start_time'),
      // Personal reminders (this student's own) and SR class announcements (anything an SR
      // has posted for a subject+section this student is enrolled in — RLS does the actual
      // scoping, matching the same enrollment join `sessions` already uses). Both upcoming only.
      supabase
        .from('reminders')
        .select('id, title, target_at, subjects(name)')
        .eq('type', 'personal')
        .gte('target_at', now.toISOString())
        .order('target_at'),
      supabase
        .from('reminders')
        .select('id, title, target_at, subjects(name), sections(section_label)')
        .eq('type', 'sr_announcement')
        .gte('target_at', now.toISOString())
        .order('target_at')
    ]);

  // Which cohort is this student in RIGHT NOW — resolves which of the two current-term
  // constants applies. `cohort` is the rotating 'MBA1'/'MBA2' label (flips once a year);
  // `batch_label` is the stable 'MBA 2026-28' one, already a column on `students`.
  // Defaults to TERM_5/MBA2 behavior for anyone not explicitly MBA1.
  const isMba1 = student?.cohort === 'MBA1';
  const studentTerm = isMba1 ? TERM_2 : TERM_5;
  const studentBatchLabel = student?.batch_label;

  // Round 2 — needs the student's id / term / batch.
  const [{ count: srCount }, { data: earliestSession }, { data: latestSession }, { data: allTermEvents }, { data: enrolledSubjects }] =
    await Promise.all([
      supabase
        .from('sr_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', student?.id ?? ''),
      supabase
        .from('sessions')
        .select('session_date')
        .eq('term', studentTerm)
        .eq('batch_label', studentBatchLabel)
        .order('session_date', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('sessions')
        .select('session_date')
        .eq('term', studentTerm)
        .eq('batch_label', studentBatchLabel)
        .order('session_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Needed BEFORE the term window is computed, because the window has to span these too
      // — see below. Also reused for MonthView and (filtered) for the upcoming-events list.
      supabase
        .from('important_events')
        .select('*, subjects(name)')
        .eq('term', studentTerm)
        .eq('batch_label', studentBatchLabel)
        .order('event_date'),
      // This student's own enrolled subjects for their own current term — populates the
      // optional subject dropdown when adding a personal reminder.
      supabase
        .from('enrollments')
        .select('subject_id, subjects(name)')
        .eq('student_id', student?.id ?? '')
        .eq('term', studentTerm)
    ]);
  const isSr = (srCount ?? 0) > 0;

  // Upcoming events = this term's events from today on. Same filter the separate query used
  // to apply (term, batch, event_date >= today, ordered by date) — taken from allTermEvents
  // instead of asking the database a second time.
  const upcomingEvents = (allTermEvents ?? []).filter((e) => (e.event_date as string) >= today);

  // The term window spans sessions AND events, not sessions alone. End-term exams are
  // important_events, not sessions — Term II's run into January while the last actual
  // CLASS is in December, so a sessions-only window ended the calendar at 31 Dec and the
  // exams simply had no month to be drawn in. Same reasoning at the start of the term
  // (a Registration day can precede the first class), so both ends take the wider value.
  const eventDates = (allTermEvents ?? []).map((e) => e.event_date as string).filter(Boolean);
  const firstEventDate = eventDates.length > 0 ? eventDates[0] : null; // query is ordered by event_date
  const lastEventDate = eventDates.length > 0 ? eventDates[eventDates.length - 1] : null;

  const minDate = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b);
  const maxDate = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);

  const TERM_START =
    minDate(earliestSession?.session_date ?? null, firstEventDate) ??
    FALLBACK_TERM_RANGES[isMba1 ? 'MBA1' : 'MBA2'].start;
  const TERM_END =
    maxDate(latestSession?.session_date ?? null, lastEventDate) ??
    FALLBACK_TERM_RANGES[isMba1 ? 'MBA1' : 'MBA2'].end;

  // Round 3 — needs the term window.
  const { data: termSessions } = await supabase
    .from('sessions')
    .select('*, subjects(name), sections(section_label)')
    .gte('session_date', TERM_START)
    .lte('session_date', TERM_END)
    .order('session_date')
    .order('start_time');

  const studentSubjects = (enrolledSubjects ?? [])
    .map((e) => ({ id: e.subject_id, name: (e.subjects as any)?.name as string | undefined }))
    .filter((s): s is { id: string; name: string } => !!s.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar batchLabel={student?.batch_label} cohort={student?.cohort} />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-5 md:px-8 md:py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl">Welcome, {student?.full_name?.split(' ')[0] ?? 'there'}</h1>
          <p className="text-inkFaint text-sm">Here&apos;s what&apos;s on today.</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isSr && (
            <a
              href="/sr"
              className="flex items-center gap-1.5 whitespace-nowrap text-sm font-bold text-white bg-gold-600 rounded-full px-3 sm:px-4 py-2 shadow-sm hover:bg-gold-500 transition"
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
          <ClassCalendarCard />
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
        termLabel={studentTerm}
        termStart={TERM_START}
        termEnd={TERM_END}
        importantEvents={allTermEvents ?? []}
      />
      </main>
    </div>
  );
}
