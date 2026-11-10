// app/planner/PlannerCalendar.tsx
//
// What both tabs render under their controls: the timetable as a month
// calendar (default — same layout as the home screen) or as the day-by-day
// list, with a small Month / List switch. The choice is shared by both tabs
// and remembered on this device (PlannerClient owns it).

'use client';

import type { Clash, PlannerData } from '@/lib/plannerTypes';
import type { Lookups } from './plannerLogic';
import MonthCalendar from './MonthCalendar';
import TimetableGrid from './TimetableGrid';

export type CalendarView = 'month' | 'list';

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'list', label: 'List' },
];

export default function PlannerCalendar({
  data,
  lookups,
  codes,
  clashes,
  view,
  onViewChange,
  compact = false,
}: {
  data: PlannerData;
  lookups: Lookups;
  codes: string[];
  clashes: Clash[];
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {codes.length > 0 && (
        <div className="flex justify-end">
          <div role="tablist" aria-label="Timetable view" className="inline-flex rounded-lg border border-line p-0.5 bg-cream">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => onViewChange(v.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                  view === v.id ? 'bg-white text-brand-800 shadow-sm' : 'text-inkFaint hover:text-inkSoft'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'month' ? (
        <MonthCalendar data={data} lookups={lookups} codes={codes} clashes={clashes} compact={compact} />
      ) : (
        <TimetableGrid data={data} lookups={lookups} codes={codes} clashes={clashes} compact={compact} />
      )}
    </div>
  );
}
