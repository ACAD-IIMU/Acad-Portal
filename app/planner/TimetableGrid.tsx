// app/planner/TimetableGrid.tsx
//
// The date × session-slot grid, shared by the manual builder (full term) and the
// smart generator's per-option preview (`compact`, which hides empty days).

'use client';

import type React from 'react';
import type { Clash, PlannerData } from '@/lib/plannerTypes';
import { formatDate, isWeekend, type Lookups } from './plannerLogic';

export default function TimetableGrid({
  data,
  lookups,
  codes,
  clashes,
  compact = false,
}: {
  data: PlannerData;
  lookups: Lookups;
  codes: string[];
  clashes: Clash[];
  compact?: boolean;
}) {
  const selected = new Set(codes);

  if (!selected.size) {
    return (
      <div className="py-16 text-center">
        <div className="font-display font-semibold text-brand-950">No subjects selected</div>
        <p className="text-sm text-inkFaint mt-1">Add subjects from the panel to see your term laid out.</p>
      </div>
    );
  }

  // Keyed on "date|slot" so a cell can ask "am I a clash?" in constant time.
  const clashCells = new Set(clashes.map((c) => `${c.date}|${c.slot}`));
  const clashCodes = new Set(clashes.flatMap((c) => c.codes));

  const days = compact
    ? data.timetable.filter((d) =>
        Object.values(d.slots).some((es) => (es ?? []).some((e) => selected.has(e.code)))
      )
    : data.timetable;

  if (!days.length) {
    return (
      <div className="py-10 text-center text-sm text-inkFaint">
        None of the selected sections have scheduled classes this term.
      </div>
    );
  }

  let previousWeek: string | null = null;

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-collapse text-[11px] min-w-[680px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white text-left font-semibold text-inkFaint uppercase tracking-wider text-[10px] px-2 py-2 border-b border-line">
              Date
            </th>
            {data.sessions.map((s) => (
              <th
                key={s.slot_key}
                className="text-left font-semibold text-inkFaint uppercase tracking-wide text-[10px] px-2 py-2 border-b border-line whitespace-nowrap"
              >
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            // A week banner is emitted ahead of the first day of each week, so a
            // single source day can produce two rows.
            const rows: React.ReactNode[] = [];

            if (day.week && day.week !== previousWeek) {
              previousWeek = day.week;
              rows.push(
                <tr key={`wk-${day.date}`} className="bg-brand-50">
                  <th
                    colSpan={data.sessions.length + 1}
                    className="text-left font-display font-semibold text-brand-800 text-[11px] px-2 py-1.5 border-y border-line"
                  >
                    {day.week}
                    {day.month ? ` · ${day.month}` : ''}
                  </th>
                </tr>
              );
            }

            rows.push(
              <tr key={day.date} className={isWeekend(day.day) ? 'bg-cream' : ''}>
                <td
                  className={`sticky left-0 z-10 px-2 py-1.5 border-b border-line align-top ${
                    isWeekend(day.day) ? 'bg-cream' : 'bg-white'
                  }`}
                >
                  <div className="font-semibold text-ink">{day.day}</div>
                  <div className="text-inkFaint text-[10px]">{formatDate(day.date)}</div>
                </td>

                {data.sessions.map((session) => {
                  const entries = (day.slots[session.slot_key] ?? []).filter((e) =>
                    selected.has(e.code)
                  );
                  const cellClashes = clashCells.has(`${day.date}|${session.slot_key}`);

                  return (
                    <td
                      key={session.slot_key}
                      className="px-1.5 py-1.5 border-b border-line align-top"
                    >
                      {entries.length === 0 ? (
                        <span className="text-line select-none">·</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {entries.map((entry, i) => {
                            const subject = lookups.codeToSubject[entry.code] ?? '';
                            const [bg, fg, accent] = lookups.colorOf(subject);
                            const isClash = cellClashes && clashCodes.has(entry.code);

                            return (
                              <div
                                key={`${entry.code}-${i}`}
                                title={`${entry.code}${subject ? ` — ${subject}` : ''} · S${entry.session_num}`}
                                className="rounded px-1.5 py-1 font-semibold border-l-[3px] whitespace-nowrap"
                                style={
                                  isClash
                                    ? {
                                        background: '#f9e6dc',
                                        color: '#c1502e',
                                        borderLeftColor: '#c1502e',
                                      }
                                    : { background: bg, color: fg, borderLeftColor: accent }
                                }
                              >
                                {entry.code}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );

            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}
