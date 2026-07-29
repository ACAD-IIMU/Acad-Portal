'use client';

import { useState } from 'react';

type SessionRow = {
  id: string;
  start_time: string;
  end_time: string;
  faculty_name: string | null;
  room: string | null;
  subjects: { name: string } | null;
  sections: { section_label: string | null } | null;
  prereads: { required: boolean; drive_file_id: string | null }[] | null;
};

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
  const [dayOffset, setDayOffset] = useState<0 | 1>(0); // 0 = today, 1 = tomorrow
  const [tomorrowSessions, setTomorrowSessions] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Tomorrow, computed off the same IST instant page.tsx already anchored "today" to —
  // not a fresh `new Date()` here, so this can't drift a day off from what the server used.
  const tomorrowDateObj = new Date(`${todayDate}T00:00:00+05:30`);
  tomorrowDateObj.setDate(tomorrowDateObj.getDate() + 1);
  const tomorrowDateKey = dateKeyOf(tomorrowDateObj);
  const tomorrowLabel = labelOf(tomorrowDateObj);

  const sessions = dayOffset === 0 ? todaySessions : tomorrowSessions ?? [];
  const label = dayOffset === 0 ? todayLabel : tomorrowLabel;

  async function showTomorrow() {
    setDayOffset(1);
    if (tomorrowSessions !== null) return; // already fetched once this visit — don't refetch
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/sessions/by-date?date=${tomorrowDateKey}`);
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      setTomorrowSessions(data.sessions ?? []);
    } catch {
      setLoadError(true);
      setTomorrowSessions([]);
    } finally {
      setLoading(false);
    }
  }

  function showToday() {
    setDayOffset(0);
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base">{dayOffset === 0 ? "Today's classes" : "Tomorrow's classes"}</h2>
          <button
            onClick={showToday}
            disabled={dayOffset === 0}
            className="w-6.5 h-6.5 rounded-full border border-line disabled:opacity-30 text-sm"
            aria-label="Back to today"
          >
            ‹
          </button>
          <button
            onClick={showTomorrow}
            disabled={dayOffset === 1}
            className="w-6.5 h-6.5 rounded-full border border-line disabled:opacity-30 text-sm"
            aria-label="Show tomorrow's classes"
          >
            ›
          </button>
        </div>
        <span className="text-xs text-inkFaint">
          {label}
          {batchLabel ? ` · ${batchLabel}` : ''}
        </span>
      </div>

      {loading && <p className="text-sm text-inkFaint italic">Loading tomorrow&apos;s classes…</p>}

      {!loading && loadError && (
        <p className="text-sm text-danger italic">
          Couldn&apos;t load tomorrow&apos;s classes just now — try again in a moment.
        </p>
      )}

      {!loading && !loadError && sessions.length === 0 && (
        <p className="text-sm text-inkFaint italic">
          {dayOffset === 0 ? 'No classes scheduled today.' : 'No classes scheduled tomorrow.'}
        </p>
      )}

      {!loading &&
        !loadError &&
        sessions.map((s) => {
          const preread = s.prereads?.[0];
          return (
            <div key={s.id} className="flex gap-4 py-3 border-b border-line last:border-0">
              <div className="font-mono text-xs text-brand-700 w-20 shrink-0 pt-0.5">
                {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
              </div>
              <div className="flex-1">
                <b>{s.subjects?.name}</b>
                <div className="text-sm text-inkSoft">
                  {s.faculty_name} · Room {s.room}
                  {s.sections?.section_label ? ` · Sec ${s.sections.section_label}` : ''}
                </div>
                <PrereadBadge preread={preread} sessionId={s.id} />
              </div>
            </div>
          );
        })}
    </div>
  );
}

function PrereadBadge({
  preread,
  sessionId
}: {
  preread?: { required: boolean; drive_file_id: string | null };
  sessionId: string;
}) {
  if (!preread || !preread.required) {
    return (
      <div className="mt-1.5 inline-flex text-xs italic text-inkFaint border border-dashed border-line rounded-full px-2.5 py-0.5">
        No preread for this session
      </div>
    );
  }
  if (!preread.drive_file_id) {
    return (
      <div className="mt-1.5 inline-flex text-xs font-semibold text-danger bg-danger-100 rounded-full px-2.5 py-0.5">
        ⚠ Preread not uploaded by SR
      </div>
    );
  }
  return (
    <a
      href={`/api/prereads/${sessionId}`}
      className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-gold-600 bg-gold-100 rounded-full px-2.5 py-0.5 hover:bg-gold-100/70"
    >
      📄 Download preread
    </a>
  );
}
