'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type EventRow = {
  id: string;
  event_date: string;
  type: 'quiz' | 'endterm' | 'other';
  label: string;
};

type PersonalReminder = {
  id: string;
  title: string;
  target_at: string; // ISO timestamptz
  subjects: { name: string } | null;
};

type SrAnnouncement = {
  id: string;
  title: string;
  target_at: string;
  subjects: { name: string } | null;
  sections: { section_label: string | null } | null;
};

type StudentSubject = { id: string; name: string };

function formatReminderWhen(targetAtISO: string) {
  const target = new Date(targetAtISO);
  const dateLabel = target.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata'
  });
  const timeLabel = target.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
  return `${dateLabel}, ${timeLabel}`;
}

export default function Reminders({
  events,
  todayDate,
  personalReminders,
  srAnnouncements,
  studentSubjects
}: {
  events: EventRow[];
  todayDate: string;
  personalReminders: PersonalReminder[];
  srAnnouncements: SrAnnouncement[];
  studentSubjects: StudentSubject[];
}) {
  const router = useRouter();
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Anchored to the same IST midnight page.tsx already computed — not a fresh `new Date()`
  // here, which would use the server's runtime timezone (UTC on Vercel) and could land on
  // the wrong calendar day relative to IST, same class of bug fixed elsewhere in this project.
  const todayMs = new Date(`${todayDate}T00:00:00+05:30`).getTime();

  const upcomingAcadDates = events
    .map((e) => {
      const d = new Date(`${e.event_date}T00:00:00+05:30`);
      const daysAway = Math.round((d.getTime() - todayMs) / 86400000);
      return { ...e, daysAway };
    })
    .filter((e) => e.daysAway >= 0 && e.daysAway <= 10)
    .slice(0, 5); // safety cap in case several genuinely fall within the window at once

  const combinedReminders = [
    ...personalReminders.map((r) => ({ ...r, kind: 'personal' as const })),
    ...srAnnouncements.map((r) => ({ ...r, kind: 'sr_announcement' as const }))
  ].sort((a, b) => a.target_at.localeCompare(b.target_at));

  async function handleDelete(reminderId: string) {
    setDeletingId(reminderId);
    try {
      const res = await fetch('/api/reminders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to delete');
      router.refresh();
    } catch (err: any) {
      alert(err?.message ?? 'Failed to delete reminder');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm mb-3">Reminders</h2>

      <h3 className="text-xs font-semibold text-inkFaint uppercase tracking-wide mb-2">ACAD Dates</h3>
      <div className="flex flex-col gap-2.5 mb-4">
        {upcomingAcadDates.length === 0 && (
          <p className="text-xs text-inkFaint italic">No upcoming quizzes or exams on the calendar.</p>
        )}
        {upcomingAcadDates.map((e) => {
          const icon = e.type === 'endterm' ? '🎓' : '📝';
          const when = e.daysAway === 0 ? 'today' : e.daysAway === 1 ? 'tomorrow' : `in ${e.daysAway} days`;
          const dateLabel = new Date(`${e.event_date}T00:00:00+05:30`).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            timeZone: 'Asia/Kolkata'
          });
          return (
            <ReminderItem key={e.id} icon={icon}>
              {e.label} — <b>{dateLabel}</b> ({when})
            </ReminderItem>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-inkFaint uppercase tracking-wide">Your Reminders</h3>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="text-xs font-semibold text-brand-700 hover:underline"
        >
          {showAddForm ? 'Cancel' : '+ Add reminder'}
        </button>
      </div>

      {showAddForm && (
        <AddReminderForm
          studentSubjects={studentSubjects}
          onDone={() => {
            setShowAddForm(false);
            router.refresh();
          }}
        />
      )}

      <div className="flex flex-col gap-2.5">
        {combinedReminders.length === 0 && !showAddForm && (
          <p className="text-xs text-inkFaint italic">No reminders set. Add one, or check back for SR announcements.</p>
        )}
        {combinedReminders.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-2 text-xs text-inkSoft bg-brand-50 rounded-lg px-3 py-2.5 leading-relaxed"
          >
            <span className="shrink-0">{r.kind === 'personal' ? '📌' : '📢'}</span>
            <span className="flex-1">
              {r.title}
              {r.subjects?.name && <span className="text-inkFaint"> · {r.subjects.name}</span>}
              {r.kind === 'sr_announcement' && (r as SrAnnouncement).sections?.section_label && (
                <span className="text-inkFaint"> (Sec {(r as SrAnnouncement).sections!.section_label})</span>
              )}
              {' — '}
              <b>{formatReminderWhen(r.target_at)}</b>
            </span>
            {r.kind === 'personal' && (
              <button
                onClick={() => handleDelete(r.id)}
                disabled={deletingId === r.id}
                className="shrink-0 text-inkFaint hover:text-danger disabled:opacity-40"
                aria-label="Delete reminder"
              >
                {deletingId === r.id ? '…' : '✕'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReminderItem({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs text-inkSoft bg-brand-50 rounded-lg px-3 py-2.5 leading-relaxed">
      <span className="shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function AddReminderForm({
  studentSubjects,
  onDone
}: {
  studentSubjects: StudentSubject[];
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!title.trim() || !date || !time) {
      setError('Title, date, and time are all required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Combine as IST explicitly — the rest of the app treats all dates/times as IST
      // regardless of the browser's own local timezone, same convention as everywhere
      // else in this codebase.
      const targetAt = `${date}T${time}:00+05:30`;
      const res = await fetch('/api/reminders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'personal', title: title.trim(), targetAt, subjectId: subjectId || null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save');
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save reminder');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-line rounded-lg p-3 mb-3 flex flex-col gap-2">
      <input
        type="text"
        placeholder="What's the reminder?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-xs border border-line rounded-lg px-2.5 py-1.5"
      />
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="text-xs border border-line rounded-lg px-2.5 py-1.5 flex-1"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="text-xs border border-line rounded-lg px-2.5 py-1.5 flex-1"
        />
      </div>
      {studentSubjects.length > 0 && (
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className="text-xs border border-line rounded-lg px-2.5 py-1.5"
        >
          <option value="">No subject (general reminder)</option>
          {studentSubjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-brand-900 hover:bg-brand-800 disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save reminder'}
      </button>
    </div>
  );
}
