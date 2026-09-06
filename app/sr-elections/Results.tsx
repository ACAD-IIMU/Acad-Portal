// app/sr-elections/Results.tsx
//
// Read-only display of the final declared SR per subject+section, straight
// from sr_assignments (the same table that grants actual SR access
// site-wide) — not re-derived from votes, so this can never drift from who
// actually has SR permissions.
//
// Card grid + search rather than a plain table: ~27 rows in a dense table is
// hard to scan, and a student's actual use case ("who's my subject's SR") is
// better served by search-and-scan than reading down a column. Avatar style
// matches UserMenu's initials-badge exactly; per-subject color matches the
// same hue-wheel formula MonthView.tsx uses for the Home calendar's subject
// dots, so a given subject reads as the same color across the whole app.

'use client';

import { useMemo, useState } from 'react';

type SrRow = {
  subjectName: string;
  sectionLabel: string | null;
  fullName: string;
  regNo: string;
  email: string;
  phone: string | null;
};

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

// Same formula as MonthView.tsx's colorForSubject: evenly-spaced hue wheel,
// anchored near the brand's crimson, so a subject's color is consistent
// between the Home calendar and this page rather than two unrelated schemes.
const HUE_ANCHOR = 347;
const COLOR_SATURATION = 64;
const COLOR_LIGHTNESS = 47;

function colorForSubject(name: string, sortedSubjects: string[]): string {
  const idx = sortedSubjects.indexOf(name);
  if (idx === -1 || sortedSubjects.length === 0) return '#8A8A8A';
  const hue = (HUE_ANCHOR + (360 / sortedSubjects.length) * idx) % 360;
  return `hsl(${hue.toFixed(1)}, ${COLOR_SATURATION}%, ${COLOR_LIGHTNESS}%)`;
}

export default function Results({ rows }: { rows: SrRow[] }) {
  const [query, setQuery] = useState('');

  const uniqueSubjects = useMemo(
    () => Array.from(new Set(rows.map((r) => r.subjectName))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.subjectName.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        r.regNo.toLowerCase().includes(q)
    );
  }, [rows, query]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-inkFaint italic card p-5">
        No SR assignments recorded yet for this term.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-inkFaint pointer-events-none"
        >
          <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M18 18l-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by subject or SR name…"
          className="w-full text-sm border border-line rounded-full pl-10 pr-4 py-2.5 focus:outline-none focus:border-brand-700"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-inkFaint italic card p-5">No matches for &quot;{query}&quot;.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((r, i) => {
            const color = colorForSubject(r.subjectName, uniqueSubjects);
            return (
              <div key={i} className="card p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  <span className="text-sm font-bold text-brand-950">{r.subjectName}</span>
                  {r.sectionLabel && (
                    <span className="text-[11px] font-semibold text-inkFaint bg-cream border border-line rounded-full px-2 py-0.5">
                      Sec {r.sectionLabel}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <span
                    className="flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-semibold shrink-0"
                    style={{ background: color }}
                  >
                    {initialsOf(r.fullName)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-950 truncate">{r.fullName}</p>
                    <p className="text-xs text-inkFaint">{r.regNo}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-1 pt-1 border-t border-line text-xs">
                  <a
                    href={`mailto:${r.email}`}
                    className="text-brand-700 hover:underline truncate"
                    title={r.email}
                  >
                    {r.email}
                  </a>
                  {r.phone && (
                    <a href={`tel:${r.phone}`} className="text-brand-700 hover:underline">
                      {r.phone}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
