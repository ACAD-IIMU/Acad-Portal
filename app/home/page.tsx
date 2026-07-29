import { createClient } from '@/lib/supabase/server';
import TodaysClasses from './TodaysClasses';
import Reminders from './Reminders';
import QuickLinks from './QuickLinks';
import MonthView from './MonthView';
import UserMenu from './UserMenu';

const CURRENT_TERM = 'Term IV';
// Fallback only — used if no sessions exist yet for the term (e.g. before the timetable
// sync has run). Once real sessions exist, the actual range below always wins.
const FALLBACK_TERM_START = '2026-06-07';
const FALLBACK_TERM_END = '2026-08-28';

export default async function HomePage() {
  const supabase = createClient();

  const { data: student } = await supabase.from('students').select('*').single();

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
    .eq('term', CURRENT_TERM)
    .order('session_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: latestSession } = await supabase
    .from('sessions')
    .select('session_date')
    .eq('term', CURRENT_TERM)
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
    .order('session_date');

  const { data: importantEvents } = await supabase
    .from('important_events')
    .select('*, subjects(name)')
    .eq('term', CURRENT_TERM)
    .gte('event_date', today)
    .order('event_date');

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl">Welcome, {student?.full_name?.split(' ')[0] ?? 'there'}</h1>
          <p className="text-inkFaint text-sm">Here&apos;s what&apos;s on today.</p>
        </div>
        <UserMenu
          name={student?.full_name ?? 'Student'}
          regNo={student?.reg_no}
          batchLabel={student?.batch_label}
        />
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
          <Reminders events={importantEvents ?? []} />
        </div>
      </div>

      <MonthView
        sessions={termSessions ?? []}
        termLabel={CURRENT_TERM}
        termStart={TERM_START}
        termEnd={TERM_END}
        importantEvents={importantEvents ?? []}
      />
    </main>
  );
}
