'use client';

import { useState } from 'react';
import { formatTime12h } from '@/lib/formatTime';

type Preread = { id: string; file_name: string; drive_file_id: string };
type SessionRow = {
  id: string;
  start_time: string;
  end_time: string;
  faculty_name: string | null;
  room: string | null;
  no_preread: boolean;
  session_number: number;
  subjects: { name: string } | null;
  sections: { section_label: string | null } | null;
  prereads: Preread[] | null;
};

const MAX_OFFSET = 4; // 0 = today, 1 = tomorrow, 2 = day after tmrw, 3 = NErd, 4 = DML

function dateKeyOf(d: Date) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}
function labelOf(d: Date) {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata'
  });
}
function headingFor(offset: number) {
  if (offset === 0) return "Today's classes";
  if (offset === 1) return "Tomorrow's classes";
  if (offset === 2) return 'Day after Tomorrow';
  if (offset === 3) return "Nerds' Day";
  if (offset === 4) return 'DML';
  return '';
}
function emptyMessageFor(offset: number) {
  if (offset === 0) return 'No classes scheduled today.';
  if (offset === 1) return 'No classes scheduled tomorrow.';
  return 'No classes scheduled that day.';
}

export default function TodaysClasses({
  sessions: todaySessions,
  batchLabel,
  todayLabel,
  todayDate
}: {
  sessions: SessionRow[];
  batchLabel?: string;
  todayLabel: string;
  todayDate: string; // YYYY-MM-DD, IST — from page.tsx, same instant used for the DB query
}) {
  const [dayOffset, setDayOffset] = useState(0); // 0-4: today, tomorrow, day after tmrw, NErd, DML
  // Cache for offsets 1 and 2 only — offset 0 always comes straight from the todaySessions prop.
  const [cache, setCache] = useState<Record<number, SessionRow[] | null>>({ 1: null, 2: null });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Every future offset computed off the same IST instant page.tsx already anchored "today"
  // to — never a fresh `new Date()` here, so this can't drift a day off from what the server used.
  function dateForOffset(offset: number): Date {
    const d = new Date(`${todayDate}T00:00:00+05:30`);
    d.setDate(d.getDate() + offset);
    return d;
  }

  const sessions = dayOffset === 0 ? todaySessions : cache[dayOffset] ?? [];
  const label = dayOffset === 0 ? todayLabel : labelOf(dateForOffset(dayOffset));

  async function goToOffset(offset: number) {
    if (offset < 0 || offset > MAX_OFFSET) return;
    setDayOffset(offset);
    if (offset === 0 || cache[offset] !== null && cache[offset] !== undefined) return; // already have it
    setLoading(true);
    setLoadError(false);
    try {
      const dateKey = dateKeyOf(dateForOffset(offset));
      const res = await fetch(`/api/sessions/by-date?date=${dateKey}`);
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      setCache((prev) => ({ ...prev, [offset]: data.sessions ?? [] }));
    } catch {
      setLoadError(true);
      setCache((prev) => ({ ...prev, [offset]: [] }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base w-48 shrink-0">{headingFor(dayOffset)}</h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => goToOffset(dayOffset - 1)}
              disabled={dayOffset === 0}
              className="w-9 h-9 rounded-full border-2 border-brand-700 text-brand-900 flex items-center justify-center transition hover:bg-brand-700 hover:text-white disabled:opacity-25 disabled:pointer-events-none"
              aria-label="Previous day"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={() => goToOffset(dayOffset + 1)}
              disabled={dayOffset === MAX_OFFSET}
              className="w-9 h-9 rounded-full border-2 border-brand-700 text-brand-900 flex items-center justify-center transition hover:bg-brand-700 hover:text-white disabled:opacity-25 disabled:pointer-events-none"
              aria-label="Next day"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
        <span className="text-sm font-semibold text-gray-900">{label}</span>
      </div>

      {loading && <p className="text-sm text-inkFaint italic">Loading classes…</p>}

      {!loading && loadError && (
        <p className="text-sm text-danger italic">
          Couldn&apos;t load that day&apos;s classes just now — try again in a moment.
        </p>
      )}

      {!loading && !loadError && sessions.length === 0 && (
        <p className="text-sm text-inkFaint italic">{emptyMessageFor(dayOffset)}</p>
      )}

      {!loading &&
        !loadError &&
        sessions.map((s) => {
          return (
            <div key={s.id} className="flex gap-4 py-3 border-b border-line last:border-0">
              <div className="font-mono text-xs text-brand-700 w-32 shrink-0 pt-0.5 whitespace-nowrap">
                {formatTime12h(s.start_time)} – {formatTime12h(s.end_time)}
              </div>
              <div className="flex-1">
                <b>{s.subjects?.name}</b>
                <span className="text-inkFaint text-xs ml-1.5">S{s.session_number}</span>
                <div className="text-sm text-inkSoft">
                  {s.faculty_name} · Room {s.room ?? 'TBD'}
                  {s.sections?.section_label ? ` · Sec ${s.sections.section_label}` : ''}
                </div>
                <PrereadBadges noPreread={s.no_preread} prereads={s.prereads ?? []} />
              </div>
            </div>
          );
        })}
    </div>
  );
}

function PrereadBadges({ noPreread, prereads }: { noPreread: boolean; prereads: Preread[] }) {
  if (noPreread && prereads.length === 0) {
    return (
      <div className="mt-1.5 inline-flex text-xs italic text-inkFaint border border-dashed border-line rounded-full px-2.5 py-0.5">
        No preread for this session
      </div>
    );
  }
  if (prereads.length === 0) {
    return (
      <div className="mt-1.5 inline-flex text-xs font-semibold text-danger bg-danger-100 rounded-full px-2.5 py-0.5">
        ⚠ Preread not uploaded by SR
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {prereads.map((p) => (
        <a
          key={p.id}
          href={`/api/prereads/download/${p.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-gold-600 bg-gold-100 rounded-full px-2.5 py-0.5 hover:bg-gold-100/70"
        >
          📄 {p.file_name}
        </a>
      ))}
    </div>
  );
}
