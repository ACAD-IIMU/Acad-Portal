'use client';

import { useMemo, useState } from 'react';
import { formatTime12h } from '@/lib/formatTime';
import AddToCalendarButton from './AddToCalendarButton';

type SessionRow = {
  id: string;
  session_date: string;
  start_time: string;
  room: string | null;
  session_number: number;
  subjects: { name: string } | null;
};
type EventRow = { id: string; event_date: string; type: string; label: string };

// One color per real subject, generated on the fly rather than hardcoded by name — the
// previous version was a static table keyed to Term IV's exact subject names ('B2B M',
// 'BM', 'Rev Mgmt', 'TS-ADR', ...), so the moment the term changed to Term V's entirely
// different subject list, almost every subject fell through to FALLBACK_COLOR and every
// chip rendered the same flat gray. Same bug class as CURRENT_TERM being hardcoded: a
// per-term fact baked in as if permanent. This generates an evenly-spaced hue wheel sized
// to however many subjects actually exist in the sessions passed in, anchored at the same
// hue (~347°, near the brand's crimson) and using the same saturation/lightness (64%/47%)
// as the old hand-picked palette, so the visual style is unchanged — only the source of
// which subject gets which slot is now dynamic instead of a name lookup that goes stale
// every term.
const HUE_ANCHOR = 347;
const COLOR_SATURATION = 64;
const COLOR_LIGHTNESS = 47;
const FALLBACK_COLOR = '#8A8A8A';

function colorForSubject(name: string, sortedSubjects: string[]): string {
  const idx = sortedSubjects.indexOf(name);
  if (idx === -1 || sortedSubjects.length === 0) return FALLBACK_COLOR;
  const hue = (HUE_ANCHOR + (360 / sortedSubjects.length) * idx) % 360;
  return `hsl(${hue.toFixed(1)}, ${COLOR_SATURATION}%, ${COLOR_LIGHTNESS}%)`;
}

function iconForFlag(flag: string) {
  if (flag === 'endterm') return '🎓';
  if (flag === 'quiz') return '📝';
  return '📅'; // 'other' — holidays, registration, tutorials, guest sessions
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Parses date-only strings (e.g. "2026-09-14") anchored to IST midnight, then reads
// year/month back via the UTC getters — NOT the local getters (.getFullYear()/.getMonth()
// on their own would report whatever the viewer's own browser timezone says that instant
// is, which is exactly the bug class fixed throughout this file: a viewer whose system
// timezone sits behind IST could see this resolve to the wrong month around a boundary.
// Reading the anchored instant with UTC getters sidesteps the browser's local timezone
// entirely, so this is correct regardless of who's viewing it from where.
function istYearMonth(dateOnly: string): { y: number; m: number } {
  const d = new Date(`${dateOnly}T00:00:00+05:30`);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

function monthsBetween(start: string, end: string) {
  const { y: startY, m: startM } = istYearMonth(start);
  const { y: endY, m: endM } = istYearMonth(end);
  const months: { y: number; m: number }[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ y, m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
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
  // IST calendar date as 'YYYY-MM-DD', computed once and reused for both "which month
  // should default open" and "which day cell is today" below — never local getters on a
  // bare `new Date()`, which would follow the viewer's own browser timezone instead of IST.
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [todayY, todayMDisplay] = todayIso.split('-').map(Number);
  const todayM = todayMDisplay - 1; // 0-indexed to match `months`
  const defaultIndex = Math.max(
    0,
    months.findIndex((mo) => mo.y === todayY && mo.m === todayM)
  );
  const [viewIndex, setViewIndex] = useState(defaultIndex);
  const [openDay, setOpenDay] = useState<string | null>(null); // 'YYYY-MM-DD'

  const { y, m } = months[viewIndex];
  const monthLabel = `${MONTH_NAMES[m]} ${y}`;

  const eventsByDate = useMemo(() => {
    const map: Record<string, { time?: string; label: string; flag?: string; room?: string | null; sessionNumber?: number }[]> = {};
    sessions.forEach((s) => {
      const key = s.session_date;
      (map[key] ??= []).push({
        time: formatTime12h(s.start_time),
        label: s.subjects?.name ?? 'Session',
        room: s.room,
        sessionNumber: s.session_number
      });
    });
    importantEvents.forEach((e) => {
      const key = e.event_date;
      (map[key] ??= []).unshift({ label: e.label, flag: e.type });
    });
    return map;
  }, [sessions, importantEvents]);

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

  const isToday = (dateKey: string) => dateKey === todayIso;
  // Sorted (not insertion-order) so the same subject always lands on the same color
  // regardless of which session happens to be encountered first while scanning dates —
  // otherwise the legend and the day chips could disagree, or the same subject could
  // shift color between page loads if query ordering ever changed.
  const uniqueSubjects = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.subjects?.name).filter(Boolean))).sort() as string[],
    [sessions]
  );

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
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
        <AddToCalendarButton />
      </div>
      <div className="flex gap-3 flex-wrap text-xs text-inkSoft mb-4">
        {uniqueSubjects.map((name) => (
          <span key={name} className="inline-flex items-center gap-1.5">
            <i
              className="w-2 h-2 rounded-full inline-block"
              style={{ background: colorForSubject(name, uniqueSubjects) }}
            />
            {name}
          </span>
        ))}
      </div>

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
                    {iconForFlag(e.flag)} {e.label}
                  </div>
                ) : (
                  <div
                    key={idx}
                    title={e.room ? `Room ${e.room}` : undefined}
                    className="text-[10.5px] mt-0.5 px-1.5 py-0.5 rounded text-white truncate"
                    style={{ background: colorForSubject(e.label, uniqueSubjects) }}
                  >
                    {e.time} {e.label}{e.sessionNumber ? ` S${e.sessionNumber}` : ''}
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
          subjectColors={uniqueSubjects}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}

function DayOverlay({
  dateKey,
  events,
  subjectColors,
  onClose
}: {
  dateKey: string;
  events: { time?: string; label: string; flag?: string; room?: string | null; sessionNumber?: number }[];
  subjectColors: string[];
  onClose: () => void;
}) {
  const label = new Date(`${dateKey}T00:00:00+05:30`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata'
  });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-card p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg mb-1">{label}</h3>
        <p className="text-xs text-inkFaint mb-4">{events.length} item{events.length !== 1 ? 's' : ''}</p>
        <div className="flex flex-col gap-2">
          {events.map((e, i) =>
            e.flag ? (
              <div key={i} className="flex items-center gap-2.5 border border-gold-500 bg-gold-100 rounded-lg px-3 py-2 text-sm">
                <span>{iconForFlag(e.flag!)}</span>
                <span>{e.label}</span>
              </div>
            ) : (
              <div key={i} className="flex items-center gap-2.5 border border-line rounded-lg px-3 py-2 text-sm">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                  style={{ background: colorForSubject(e.label, subjectColors) }}
                />
                <span className="font-mono text-xs text-inkFaint w-16 shrink-0">{e.time}</span>
                <span className="flex-1">
                  {e.label}
                  {e.sessionNumber ? <span className="text-inkFaint"> S{e.sessionNumber}</span> : ''}
                </span>
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
