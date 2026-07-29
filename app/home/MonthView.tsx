'use client';

import { useMemo, useState } from 'react';
import { formatTime12h } from '@/lib/formatTime';

type SessionRow = {
  id: string;
  session_date: string;
  start_time: string;
  room: string | null;
  subjects: { name: string } | null;
};
type EventRow = { id: string; event_date: string; type: string; label: string };

// One color per real subject code, evenly spread in hue (consistent saturation/lightness
// for a cohesive feel) and anchored near the brand's crimson hue so the family reads as
// related to the site's own palette rather than a generic rainbow.
const SUBJECT_COLORS: Record<string, string> = {
  'B2B M': '#C52B4C',
  'BM': '#C5342B',
  'CB': '#C55E2B',
  'CV': '#C5872B',
  'DSDT': '#C5B12B',
  'FD': '#AEC52B',
  'FSA': '#84C52B',
  'HRM(IR)': '#5AC52B',
  'INV': '#30C52B',
  'MG': '#2BC550',
  'MoB': '#2BC579',
  'MSAIC': '#2BC5A3',
  'PA': '#2BBCC5',
  'PCG': '#2B92C5',
  'PEVC': '#2B68C5',
  'PM': '#2B3EC5',
  'PSM': '#422BC5',
  'Rev Mgmt': '#6C2BC5',
  'SCM': '#952BC5',
  'SDM': '#BF2BC5',
  'SRC': '#C52BA0',
  'TS-ADR': '#C52B76'
};
const FALLBACK_COLOR = '#8A8A8A';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthsBetween(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const months: { y: number; m: number }[] = [];
  let cur = new Date(s.getFullYear(), s.getMonth(), 1);
  while (cur <= e) {
    months.push({ y: cur.getFullYear(), m: cur.getMonth() });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return months;
}

export default function MonthView({
  sessions,
  importantEvents,
  termLabel,
  termStart,
  termEnd
}: {
  sessions: SessionRow[];
  importantEvents: EventRow[];
  termLabel: string;
  termStart: string;
  termEnd: string;
}) {
  const months = useMemo(() => monthsBetween(termStart, termEnd), [termStart, termEnd]);
  const today = new Date();
  const defaultIndex = Math.max(
    0,
    months.findIndex((mo) => mo.y === today.getFullYear() && mo.m === today.getMonth())
  );
  const [viewIndex, setViewIndex] = useState(defaultIndex === -1 ? 0 : defaultIndex);
  const [openDay, setOpenDay] = useState<string | null>(null); // 'YYYY-MM-DD'
  const [calState, setCalState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const { y, m } = months[viewIndex];
  const monthLabel = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const eventsByDate = useMemo(() => {
    const map: Record<string, { time?: string; label: string; flag?: string; room?: string | null }[]> = {};
    sessions.forEach((s) => {
      const key = s.session_date;
      (map[key] ??= []).push({
        time: formatTime12h(s.start_time),
        label: s.subjects?.name ?? 'Session',
        room: s.room
      });
    });
    importantEvents.forEach((e) => {
      const key = e.event_date;
      (map[key] ??= []).unshift({ label: e.label, flag: e.type });
    });
    return map;
  }, [sessions, importantEvents]);

  async function addToCalendar() {
    setCalState('loading');
    try {
      const res = await fetch('/api/calendar/push', { method: 'POST' });
      if (!res.ok) throw new Error();
      setCalState('success');
    } catch {
      setCalState('error');
    }
  }

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: { day: number; faint: boolean; dateKey: string }[] = [];
  for (let i = 0; i < firstDay; i++) {
    const d = new Date(y, m, 1 - (firstDay - i)).getDate();
    cells.push({ day: d, faint: true, dateKey: '' });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, faint: false, dateKey });
  }
  // Trailing filler cells (next month's leading days) — must restart from 1, not
  // continue the running cell count (that was the bug producing "34" etc. after month end).
  let trailingDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: trailingDay++, faint: true, dateKey: '' });
  }

  const isToday = (dateKey: string) => dateKey === today.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const uniqueSubjects = Array.from(new Set(sessions.map((s) => s.subjects?.name).filter(Boolean))) as string[];

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3.5">
          <h2 className="text-base">
            {monthLabel} <span className="text-inkFaint text-xs font-medium">{termLabel}</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewIndex((i) => Math.max(0, i - 1))}
              disabled={viewIndex === 0}
              className="w-9 h-9 rounded-full border border-line text-inkSoft text-base flex items-center justify-center transition hover:bg-brand-50 hover:border-brand-700 hover:text-brand-900 disabled:opacity-25 disabled:pointer-events-none"
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="text-xs text-inkFaint min-w-[74px] text-center">
              Month {viewIndex + 1} of {months.length}
            </span>
            <button
              onClick={() => setViewIndex((i) => Math.min(months.length - 1, i + 1))}
              disabled={viewIndex === months.length - 1}
              className="w-9 h-9 rounded-full border border-line text-inkSoft text-base flex items-center justify-center transition hover:bg-brand-50 hover:border-brand-700 hover:text-brand-900 disabled:opacity-25 disabled:pointer-events-none"
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex gap-3 flex-wrap text-xs text-inkSoft">
            {uniqueSubjects.map((name) => (
              <span key={name} className="inline-flex items-center gap-1.5">
                <i
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ background: SUBJECT_COLORS[name] ?? FALLBACK_COLOR }}
                />
                {name}
              </span>
            ))}
          </div>
          <button
            onClick={addToCalendar}
            disabled={calState === 'loading'}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              calState === 'success' ? 'bg-brand-800' : 'bg-brand-900 hover:bg-brand-800'
            }`}
          >
            {calState === 'loading' ? 'Adding to calendar…' : calState === 'success' ? '✓ Added to your calendar' : '📅 Add to Google Calendar'}
          </button>
        </div>
      </div>

      {calState === 'error' && (
        <p className="text-danger text-xs mb-3">
          Couldn&apos;t reach Google Calendar just now — try again in a moment.
        </p>
      )}

      <div className="grid grid-cols-7 gap-px bg-line border border-line rounded-lg overflow-hidden">
        {DOW.map((d) => (
          <div key={d} className="bg-brand-50 text-center text-[11px] font-semibold text-inkFaint uppercase py-2">
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          const events = c.dateKey ? eventsByDate[c.dateKey] ?? [] : [];
          return (
            <div
              key={i}
              onClick={() => events.length && setOpenDay(c.dateKey)}
              className={`bg-white min-h-[118px] p-1.5 relative ${c.faint ? 'opacity-40 bg-[#fbf6f5]' : ''} ${
                events.length ? 'cursor-pointer hover:bg-brand-50' : ''
              }`}
            >
              <span
                className={`text-xs inline-block ${
                  isToday(c.dateKey) ? 'bg-brand-900 text-white w-5 h-5 rounded-full flex items-center justify-center font-semibold' : 'text-inkSoft'
                }`}
              >
                {c.day}
              </span>
              {events.slice(0, 3).map((e, idx) =>
                e.flag ? (
                  <div key={idx} className="text-[10.5px] mt-0.5 px-1.5 py-0.5 rounded bg-white border border-gold-500 text-gold-600 font-semibold truncate">
                    {e.flag === 'endterm' ? '🎓' : '📝'} {e.label}
                  </div>
                ) : (
                  <div
                    key={idx}
                    title={e.room ? `Room ${e.room}` : undefined}
                    className="text-[10.5px] mt-0.5 px-1.5 py-0.5 rounded text-white truncate"
                    style={{ background: SUBJECT_COLORS[e.label] ?? FALLBACK_COLOR }}
                  >
                    {e.time} {e.label}
                  </div>
                )
              )}
              {events.length > 3 && (
                <div className="text-[10.5px] text-inkFaint px-1.5">+{events.length - 3} more</div>
              )}
            </div>
          );
        })}
      </div>

      {openDay && (
        <DayOverlay
          dateKey={openDay}
          events={eventsByDate[openDay] ?? []}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}

function DayOverlay({
  dateKey,
  events,
  onClose
}: {
  dateKey: string;
  events: { time?: string; label: string; flag?: string; room?: string | null }[];
  onClose: () => void;
}) {
  const label = new Date(dateKey).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-card p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg mb-1">{label}</h3>
        <p className="text-xs text-inkFaint mb-4">{events.length} item{events.length !== 1 ? 's' : ''}</p>
        <div className="flex flex-col gap-2">
          {events.map((e, i) =>
            e.flag ? (
              <div key={i} className="flex items-center gap-2.5 border border-gold-500 bg-gold-100 rounded-lg px-3 py-2 text-sm">
                <span>{e.flag === 'endterm' ? '🎓' : '📝'}</span>
                <span>{e.label}</span>
              </div>
            ) : (
              <div key={i} className="flex items-center gap-2.5 border border-line rounded-lg px-3 py-2 text-sm">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                  style={{ background: SUBJECT_COLORS[e.label] ?? FALLBACK_COLOR }}
                />
                <span className="font-mono text-xs text-inkFaint w-16 shrink-0">{e.time}</span>
                <span className="flex-1">{e.label}</span>
                {e.room && <span className="text-xs text-inkFaint shrink-0">Room {e.room}</span>}
              </div>
            )
          )}
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-lg border border-line py-2.5 text-sm font-semibold">
          Close
        </button>
      </div>
    </div>
  );
}
