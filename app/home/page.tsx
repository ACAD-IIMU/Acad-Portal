import { createClient } from '@/lib/supabase/server';
import TodaysClasses from './TodaysClasses';
import Reminders from './Reminders';
import QuickLinks from './QuickLinks';
import MonthView from './MonthView';
import UserMenu from './UserMenu';

// TODO: move to a `terms` table once ACAD confirms the real term date-range source
// (flagged as an open item in the Data Requirements Log, DR-1/DR-7). Hardcoded for now
// so the month view has real boundaries to navigate within.
const CURRENT_TERM = 'Term IV';
const TERM_START = '2026-01-12';
const TERM_END = '2026-03-20';

export default async function HomePage() {
  const supabase = createClient();

  const { data: student } = await supabase.from('students').select('*').single();

  const today = new Date().toISOString().slice(0, 10);

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
        <TodaysClasses sessions={todaysSessions ?? []} batchLabel={student?.batch_label} />
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
