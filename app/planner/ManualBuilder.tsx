// app/planner/ManualBuilder.tsx
//
// Pick subjects, pick a section for each, see the term grid update live and any
// overlap flagged the moment it appears. Selections persist in localStorage so
// a refresh (or navigating away to check something) doesn't lose the work.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlannerData } from '@/lib/plannerTypes';
import {
  detectClashes,
  formatDate,
  slotLabel,
  truncate,
  type Lookups,
} from './plannerLogic';
import TimetableGrid from './TimetableGrid';

const STORAGE_KEY = 'acad-planner-manual';

export default function ManualBuilder({
  data,
  lookups,
}: {
  data: PlannerData;
  lookups: Lookups;
}) {
  // subject name -> chosen section code
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Restore once on mount, dropping any subject/section that no longer exists —
  // otherwise a saved Term IV selection would resurface as a phantom row here.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, string>;
        const valid: Record<string, string> = {};
        for (const [subject, code] of Object.entries(saved)) {
          if (data.subject_sections[subject]?.includes(code)) valid[subject] = code;
        }
        setSelections(valid);
      }
    } catch {
      // corrupt or unavailable storage is not worth failing the page over
    }
    setHydrated(true);
  }, [data]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
  }, [selections, hydrated]);

  // Close the suggestion list on any outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const chosenSubjects = Object.keys(selections).sort();
  const codes = useMemo(() => Object.values(selections).filter(Boolean), [selections]);
  const clashes = useMemo(() => detectClashes(data, codes), [data, codes]);
  const clashCodes = useMemo(
    () => new Set(clashes.flatMap((c) => c.codes)),
    [clashes]
  );

  const credits = chosenSubjects.reduce(
    (sum, subject) => sum + (data.courses[selections[subject]]?.credits ?? 0),
    0
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lookups.subjects.filter(
      (s) =>
        !q ||
        s.toLowerCase().includes(q) ||
        (data.subject_sections[s] ?? []).some((c) => c.toLowerCase().includes(q))
    );
  }, [query, lookups.subjects, data]);

  function addSubject(subject: string) {
    if (selections[subject]) return;
    setSelections((prev) => ({ ...prev, [subject]: data.subject_sections[subject][0] }));
    setQuery('');
    setDropdownOpen(false);
  }

  function removeSubject(subject: string) {
    setSelections((prev) => {
      const next = { ...prev };
      delete next[subject];
      return next;
    });
  }

  async function exportToExcel() {
    if (!codes.length) return;
    // Loaded on demand — the xlsx bundle is large and most visits never export.
    const XLSX = await import('xlsx');

    const rows: (string | number)[][] = [
      ['Date', 'Day', ...data.sessions.map((s) => s.label)],
    ];
    let previousWeek: string | null = null;
    for (const day of data.timetable) {
      if (day.week && day.week !== previousWeek) {
        previousWeek = day.week;
        rows.push([`${day.week} — ${day.month}`, '', '', '', '', '', '', '']);
      }
      rows.push([
        formatDate(day.date),
        day.day,
        ...data.sessions.map((s) =>
          (day.slots[s.slot_key] ?? [])
            .filter((e) => codes.includes(e.code))
            .map((e) => e.code)
            .join(', ')
        ),
      ]);
    }

    const grid = XLSX.utils.aoa_to_sheet(rows);
    grid['!cols'] = [{ wch: 10 }, { wch: 6 }, ...data.sessions.map(() => ({ wch: 18 }))];

    const subjectRows = [
      ['Subject', 'Section', 'Credits', 'Instructor'],
      ...chosenSubjects.map((subject) => {
        const code = selections[subject];
        const course = data.courses[code];
        return [subject, code, course?.credits ?? '', course?.instructor ?? ''];
      }),
    ];
    const summary = XLSX.utils.aoa_to_sheet(subjectRows);
    summary['!cols'] = [{ wch: 42 }, { wch: 12 }, { wch: 9 }, { wch: 50 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, grid, 'Timetable');
    XLSX.utils.book_append_sheet(wb, summary, 'Subjects');
    XLSX.writeFile(wb, `${data.term.replace(/\s+/g, '')}_Timetable.xlsx`);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
      {/* ── Selection panel ── */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-inkFaint uppercase tracking-wider">
            Your subjects
          </h2>
          <span
            className={`text-xs font-mono font-semibold px-2 py-1 rounded-full ${
              credits === 0
                ? 'text-inkFaint bg-cream'
                : 'text-brand-800 bg-brand-50 border border-brand-100'
            }`}
          >
            {credits} credit{credits === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {chosenSubjects.length === 0 && (
            <p className="text-xs text-inkFaint text-center py-3">No subjects added yet</p>
          )}

          {chosenSubjects.map((subject) => {
            const sections = data.subject_sections[subject];
            const selected = selections[subject];
            const hasClash = clashCodes.has(selected);
            const [bg, fg, accent] = lookups.colorOf(subject);

            return (
              <div
                key={subject}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition ${
                  hasClash ? 'border-danger bg-danger-100' : 'border-line bg-cream'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: accent }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink truncate">
                    {truncate(subject, 30)}
                  </div>
                  <div className="text-[11px] text-inkFaint truncate">
                    {sections.join(' / ')}
                  </div>
                </div>

                {sections.length > 1 ? (
                  <select
                    value={selected}
                    onChange={(e) =>
                      setSelections((prev) => ({ ...prev, [subject]: e.target.value }))
                    }
                    aria-label={`Section for ${subject}`}
                    className="text-xs font-semibold border border-line rounded-md px-1.5 py-1 bg-white text-inkSoft focus:outline-none focus:border-brand-700"
                  >
                    {sections.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className="text-[11px] font-bold px-2 py-1 rounded"
                    style={{ background: bg, color: fg }}
                  >
                    {sections[0]}
                  </span>
                )}

                <button
                  onClick={() => removeSubject(subject)}
                  aria-label={`Remove ${subject}`}
                  className="w-7 h-7 rounded-full text-inkFaint hover:text-danger hover:bg-danger-100 transition flex items-center justify-center flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Search / add ── */}
        <div ref={searchRef} className="relative mt-3">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            placeholder="Search subjects or section codes…"
            className="w-full text-[13px] px-3 py-2 border border-line rounded-lg bg-white focus:outline-none focus:border-brand-700"
          />

          {dropdownOpen && (
            <div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-line rounded-lg shadow-lg">
              {suggestions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-inkFaint">No matches</div>
              ) : (
                suggestions.map((subject) => {
                  const added = Boolean(selections[subject]);
                  return (
                    <button
                      key={subject}
                      disabled={added}
                      onClick={() => addSubject(subject)}
                      className={`w-full text-left px-3 py-2 text-[13px] border-b border-line last:border-none transition ${
                        added
                          ? 'text-inkFaint cursor-not-allowed'
                          : 'hover:bg-brand-50 text-ink'
                      }`}
                    >
                      <span className="font-semibold">{subject}</span>
                      <span className="text-inkFaint text-[11px] ml-1.5">
                        {(data.subject_sections[subject] ?? []).join(', ')}
                      </span>
                      {added && <span className="text-inkFaint text-[11px] ml-1">· added</span>}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <button
          onClick={exportToExcel}
          disabled={!codes.length}
          className="mt-3 w-full text-[13px] font-semibold rounded-lg px-3 py-2 transition bg-brand-900 text-white hover:bg-brand-800 disabled:bg-line disabled:text-inkFaint disabled:cursor-not-allowed"
        >
          Download as Excel
        </button>
      </section>

      {/* ── Grid ── */}
      <section className="card p-4 min-w-0">
        {clashes.length > 0 && (
          <div className="mb-4 rounded-lg border border-danger bg-danger-100 p-3">
            <div className="font-display font-semibold text-danger text-sm">
              Overlap (can&apos;t proceed with current selection)
            </div>
            <ul className="mt-1.5 text-xs text-inkSoft list-disc pl-4 space-y-0.5 max-h-40 overflow-y-auto">
              {clashes.map((c, i) => (
                <li key={`${c.date}-${c.slot}-${i}`}>
                  {formatDate(c.date)} {c.day} — {slotLabel(data, c.slot)}:{' '}
                  {c.codes
                    .map((code) => `${code} (${truncate(lookups.codeToSubject[code] ?? code, 20)})`)
                    .join(' vs ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        <TimetableGrid data={data} lookups={lookups} codes={codes} clashes={clashes} />
      </section>
    </div>
  );
}
