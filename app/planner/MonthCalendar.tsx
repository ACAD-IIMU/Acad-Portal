// app/planner/MonthCalendar.tsx
//
// The planner's month view: the same layout as the home screen's calendar
// (app/home/MonthView.tsx) — one month at a time with ‹ › arrows, a Sun–Sat
// grid, coloured chips per class, a legend, and a pop-up listing everything on
// a tapped day. Phones get coloured dots instead of chips, as on home.
//
// Differences from home, all because this is a plan rather than a timetable:
//   • chips show the section code ("ADM (A)"), since the section is the choice
//     being made;
//   • overlapping classes turn red, matching the clash banner;
//   • exams (end-term, and mid-term whenever the sheet has them) show as gold
//     chips for the selected courses only;
//   • days outside the term are greyed so the term's edges are obvious.
//
// Dates are handled as plain YYYY-MM-DD strings and UTC arithmetic, so the
// grid is the same whatever timezone the viewer's browser is in.

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Clash, PlannerData, PlannerSlotKey } from '@/lib/plannerTypes';
import {
  EXAM_KIND_ICON,
  EXAM_KIND_LABEL,
  examsForSelection,
  paletteFor,
  slotLabel,
  slotStartTime,
  type ExamItem,
  type ExamKind,
  type Lookups,
} from './plannerLogic';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const CLASH = { bg: '#c1502e', soft: '#f9e6dc' };

type ClassItem = {
  type: 'class';
  slot: PlannerSlotKey;
  time: string;
  code: string;
  subject: string;
  sessionNum: number;
  clash: boolean;
};
type ExamChip = { type: 'exam'; slot: string; time: string; label: string; kind: ExamKind };
type DayItem = ClassItem | ExamChip;

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function monthsBetween(start: string, end: string) {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const months: { y: number; m: number }[] = [];
  let y = sy;
  let m = sm - 1;
  while (y < ey || (y === ey && m <= em - 1)) {
    months.push({ y, m });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return months;
}

export default function MonthCalendar({
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
  const termStart = data.timetable[0]?.date ?? '';
  const termEnd = data.timetable[data.timetable.length - 1]?.date ?? '';
  const months = useMemo(
    () => (termStart && termEnd ? monthsBetween(termStart, termEnd) : []),
    [termStart, termEnd]
  );

  // Open on this month if the term is under way, otherwise the term's first month.
  const [viewIndex, setViewIndex] = useState(0);
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [ty, tm] = today.split('-').map(Number);
    const i = months.findIndex((mo) => mo.y === ty && mo.m === tm - 1);
    if (i >= 0) setViewIndex(i);
  }, [months]);

  const [openDay, setOpenDay] = useState<string | null>(null);

  const selected = useMemo(() => new Set(codes), [codes]);

  // date -> everything on that day: exams first (as on home), then classes by slot.
  const itemsByDate = useMemo(() => {
    const clashCells = new Set(clashes.map((c) => `${c.date}|${c.slot}`));
    const clashCodes = new Set(clashes.flatMap((c) => c.codes));
    const map: Record<string, DayItem[]> = {};

    for (const e of examsForSelection(lookups.exams, codes) as (ExamItem & { label: string })[]) {
      (map[e.date] ??= []).push({ type: 'exam', slot: e.slot, time: e.time, label: e.label, kind: e.kind });
    }
    for (const day of data.timetable) {
      for (const session of data.sessions) {
        for (const entry of day.slots[session.slot_key] ?? []) {
          if (!selected.has(entry.code)) continue;
          (map[day.date] ??= []).push({
            type: 'class',
            slot: session.slot_key,
            time: slotStartTime(data, session.slot_key),
            code: entry.code,
            subject: lookups.codeToSubject[entry.code] ?? entry.code,
            sessionNum: entry.session_num,
            clash: clashCells.has(`${day.date}|${session.slot_key}`) && clashCodes.has(entry.code),
          });
        }
      }
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) =>
        a.type !== b.type ? (a.type === 'exam' ? -1 : 1) : a.slot.localeCompare(b.slot)
      );
    }
    return map;
  }, [data, lookups, codes, clashes, selected]);

  const palette = useMemo(() => paletteFor(lookups, codes), [lookups, codes]);

  // Legend: the selected courses, in the same order as the subject picker.
  const legend = useMemo(() => {
    const picked = new Set(codes.map((c) => lookups.codeToSubject[c]).filter(Boolean));
    return lookups.subjects.filter((s) => picked.has(s));
  }, [codes, lookups]);

  if (!selected.size) {
    return (
      <div className="py-16 text-center">
        <div className="font-display font-semibold text-brand-950">No subjects selected</div>
        <p className="text-sm text-inkFaint mt-1">Add subjects from the panel to see your term laid out.</p>
      </div>
    );
  }
  if (!months.length) return null;

  const { y, m } = months[viewIndex];
  const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const daysInPrev = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells: { day: number; dateKey: string; filler: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ day: daysInPrev - i, dateKey: '', filler: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, dateKey: isoOf(y, m, d), filler: false });
  let trailing = 1;
  while (cells.length % 7 !== 0) cells.push({ day: trailing++, dateKey: '', filler: true });

  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const colorOf = (subject: string) => palette(subject)[1];
  const chipLimit = 3;

  return (
    <div>
      <div className="flex items-center gap-3.5 flex-wrap mb-3">
        <h2 className={compact ? 'text-sm' : 'text-base'}>
          {MONTH_NAMES[m]} {y} <span className="text-inkFaint text-xs font-medium">{data.term}</span>
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

      <div className="flex gap-x-3 gap-y-1.5 flex-wrap text-xs text-inkSoft mb-4">
        {legend.map((name) => (
          <span key={name} className="inline-flex items-center gap-1.5">
            <i className="w-2 h-2 rounded-full inline-block" style={{ background: colorOf(name) }} />
            {name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2 h-2 rounded-full inline-block border-[1.5px] border-gold-500 bg-white" />
          Exam
        </span>
        {clashes.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-danger font-semibold">
            <i className="w-2 h-2 rounded-full inline-block" style={{ background: CLASH.bg }} />
            Overlap
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-px bg-line border border-line rounded-lg overflow-hidden">
        {DOW.map((d) => (
          <div key={d} className="bg-brand-50 text-center text-[11px] font-semibold text-inkFaint uppercase py-2">
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          const items = c.dateKey ? itemsByDate[c.dateKey] ?? [] : [];
          const outOfTerm = !c.filler && (c.dateKey < termStart || c.dateKey > termEnd);
          const dayHasClash = items.some((it) => it.type === 'class' && it.clash);
          return (
            <div
              key={i}
              onClick={() => items.length && setOpenDay(c.dateKey)}
              title={outOfTerm ? `Outside ${data.term}` : undefined}
              className={`min-h-[64px] ${compact ? 'sm:min-h-[96px]' : 'sm:min-h-[118px]'} p-1 sm:p-1.5 relative ${
                c.filler ? 'opacity-40 bg-[#fbf6f5]' : outOfTerm ? 'bg-[#fbf6f5]' : 'bg-white'
              } ${items.length ? 'cursor-pointer hover:bg-brand-50' : ''} ${
                dayHasClash ? 'ring-1 ring-inset ring-danger' : ''
              }`}
            >
              <span
                className={`text-xs inline-block ${
                  c.dateKey === todayIso
                    ? 'bg-brand-900 text-white w-5 h-5 rounded-full flex items-center justify-center font-semibold'
                    : outOfTerm
                      ? 'text-line'
                      : 'text-inkSoft'
                }`}
              >
                {c.day}
              </span>

              {/* Phones: one dot per item — a ~45px cell can't fit a readable chip. */}
              {items.length > 0 && (
                <div className="sm:hidden mt-1 flex flex-wrap gap-[3px]">
                  {items.slice(0, 6).map((it, idx) => (
                    <i
                      key={idx}
                      className={`w-[7px] h-[7px] rounded-full inline-block ${
                        it.type === 'exam' ? 'border-[1.5px] border-gold-500 bg-white' : ''
                      }`}
                      style={
                        it.type === 'exam'
                          ? undefined
                          : { background: it.clash ? CLASH.bg : colorOf(it.subject) }
                      }
                    />
                  ))}
                  {items.length > 6 && <span className="text-[9px] leading-[7px] text-inkFaint">+</span>}
                </div>
              )}

              <div className="hidden sm:block">
                {items.slice(0, chipLimit).map((it, idx) =>
                  it.type === 'exam' ? (
                    <div
                      key={idx}
                      title={`${it.label} exam · ${it.time}`}
                      className="mt-0.5 px-1.5 py-0.5 rounded bg-white border border-gold-500 text-gold-600 leading-tight"
                    >
                      <div className="flex items-baseline gap-1 text-[10.5px] font-semibold">
                        <span className="truncate">
                          {EXAM_KIND_ICON[it.kind]} {it.label.replace(/ (End Term|Mid Term|Exam)$/, '')}
                        </span>
                        <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wide">
                          {it.kind === 'exam' ? 'Exam' : EXAM_KIND_LABEL[it.kind].split(' ')[0]}
                        </span>
                      </div>
                      <div className="text-[9.5px] truncate">{it.time}</div>
                    </div>
                  ) : (
                    <div
                      key={idx}
                      title={`${it.code} — ${it.subject}${it.sessionNum ? ` · S${it.sessionNum}` : ''}${
                        it.clash ? ' · overlaps another class' : ''
                      }`}
                      className="mt-0.5 px-1.5 py-0.5 rounded text-white leading-tight"
                      style={{ background: it.clash ? CLASH.bg : colorOf(it.subject) }}
                    >
                      <div className="flex items-baseline gap-1 text-[10.5px] font-semibold">
                        <span className="truncate">
                          {it.clash ? '⚠ ' : ''}
                          {it.code}
                        </span>
                        {it.sessionNum ? <span className="ml-auto shrink-0 opacity-80 font-medium">S{it.sessionNum}</span> : null}
                      </div>
                      <div className="text-[9.5px] opacity-90 truncate">{it.time}</div>
                    </div>
                  )
                )}
                {items.length > chipLimit && (
                  <div className="text-[10.5px] text-inkFaint px-1.5">+{items.length - chipLimit} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {openDay && (
        <DayOverlay
          data={data}
          dateKey={openDay}
          items={itemsByDate[openDay] ?? []}
          colorOf={colorOf}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}

function DayOverlay({
  data,
  dateKey,
  items,
  colorOf,
  onClose,
}: {
  data: PlannerData;
  dateKey: string;
  items: DayItem[];
  colorOf: (subject: string) => string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [yy, mm, dd] = dateKey.split('-').map(Number);
  const label = new Date(Date.UTC(yy, mm - 1, dd)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const classCount = items.filter((it) => it.type === 'class').length;
  const examCount = items.length - classCount;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-card p-5 sm:p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg mb-1">{label}</h3>
        <p className="text-xs text-inkFaint mb-4">
          {classCount} class{classCount !== 1 ? 'es' : ''}
          {examCount ? ` · ${examCount} exam${examCount !== 1 ? 's' : ''}` : ''}
        </p>
        <div className="flex flex-col gap-2">
          {items.map((it, i) =>
            it.type === 'exam' ? (
              <div
                key={i}
                className="flex items-center gap-2.5 border border-gold-500 bg-gold-100 rounded-lg px-3 py-2 text-sm"
              >
                <span>{EXAM_KIND_ICON[it.kind]}</span>
                <span className="flex-1">{it.label} exam</span>
                <span className="text-xs text-inkFaint shrink-0">{it.time}</span>
              </div>
            ) : (
              <div
                key={i}
                className={`flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border rounded-lg px-3 py-2 text-sm ${
                  it.clash ? '' : 'border-line'
                }`}
                style={it.clash ? { borderColor: CLASH.bg, background: CLASH.soft } : undefined}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                  style={{ background: it.clash ? CLASH.bg : colorOf(it.subject) }}
                />
                <span className="font-mono text-xs text-inkFaint w-[92px] shrink-0">
                  {slotLabel(data, it.slot)}
                </span>
                <span className="flex-1 min-w-0">
                  {it.subject}
                  <span className="text-inkFaint">
                    {' '}
                    · {it.code}
                    {it.sessionNum ? ` · S${it.sessionNum}` : ''}
                  </span>
                  {it.clash && <span className="block text-[11px] font-semibold text-danger">Overlaps another class</span>}
                </span>
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
