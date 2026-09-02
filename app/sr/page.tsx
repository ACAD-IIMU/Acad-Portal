'use client';

import { useEffect, useState } from 'react';
import { formatTime12h } from '@/lib/formatTime';

type Preread = { id: string; file_name: string; drive_file_id: string; uploaded_at: string };
type SessionRow = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  room: string | null;
  session_number: number;
  no_preread: boolean;
  subjects: { name: string } | null;
  sections: { section_label: string | null } | null;
  prereads: Preread[] | null;
  driveFolderLink: string | null;
};
type AssignmentOption = {
  subjectId: string;
  subjectName: string;
  sectionId: string | null;
  sectionLabel: string | null;
};
type Announcement = {
  id: string;
  title: string;
  target_at: string;
  subject_id: string;
  section_id: string | null;
  subjects: { name: string } | null;
  sections: { section_label: string | null } | null;
};

function dateLabel(dateStr: string) {
  return new Date(`${dateStr}T00:00:00+05:30`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata'
  });
}

function formatReminderWhen(targetAtISO: string) {
  const target = new Date(targetAtISO);
  const dLabel = target.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const tLabel = target.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
  return `${dLabel}, ${tLabel}`;
}

export default function SrUploadPage() {
  const [loading, setLoading] = useState(true);
  const [isSr, setIsSr] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [assignmentOptions, setAssignmentOptions] = useState<AssignmentOption[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/sr/sessions');
      const data = await res.json();
      setIsSr(data.isSr ?? false);
      setSessions(data.sessions ?? []);
      setAssignmentOptions(data.assignmentOptions ?? []);
      setAnnouncements(data.announcements ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (loading) {
    return <main className="max-w-3xl mx-auto px-4 py-10 text-inkFaint text-sm italic">Loading…</main>;
  }

  if (!isSr) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10">
        <p className="text-inkFaint text-sm">
          This page is only for Subject Representatives. You&apos;re not currently assigned as an SR
          for any subject.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl">SR Tools</h1>
        <p className="text-inkFaint text-sm">Upload prereads and post announcements for your subject(s).</p>
      </div>

      <div>
        <h2 className="text-base mb-2">Class Announcements</h2>
        <ClassAnnouncements
          assignmentOptions={assignmentOptions}
          announcements={announcements}
          onChanged={refresh}
        />
      </div>

      <div>
        <h2 className="text-base mb-2">Prereads</h2>
        <div className="card p-4 text-sm text-inkSoft mb-3">
          <b>How this works:</b> each session below links to your subject &amp; section's own
          folder — upload your file there first (any file type), then come back, copy its
          share link from Drive (right-click the file → Share → Copy link), and paste it in.
        </div>

        {sessions.length === 0 && (
          <p className="text-sm text-inkFaint italic">No upcoming sessions found for your subject(s).</p>
        )}

        <div className="flex flex-col gap-3">
          {sessions.map((s) => (
            <SessionUploadCard key={s.id} session={s} onChanged={refresh} />
          ))}
        </div>
      </div>
    </main>
  );
}

function SessionUploadCard({ session, onChanged }: { session: SessionRow; onChanged: () => void }) {
  const [driveLink, setDriveLink] = useState('');
  const [applyToNext, setApplyToNext] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [togglingNoPreread, setTogglingNoPreread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const hasFiles = (session.prereads?.length ?? 0) > 0;

  async function handleSaveLink() {
    if (!driveLink.trim()) return;
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/prereads/finalize-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          driveLink: driveLink.trim(),
          applyToNextSession: applyToNext
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`${data.error ?? 'Failed to save'}${data.detail ? ' — ' + data.detail : ''}`);

      setSuccessMsg(
        data.appliedToNextSession
          ? `Saved "${data.fileName}" — applied to this session and the next one.`
          : `Saved "${data.fileName}".`
      );
      setDriveLink('');
      setApplyToNext(false);
      onChanged();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save');
    } finally {
      setUploading(false);
    }
  }

  async function toggleNoPreread(value: boolean) {
    setTogglingNoPreread(true);
    setError(null);
    try {
      const res = await fetch('/api/prereads/mark-no-preread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, noPreread: value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to update');
      onChanged();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update');
    } finally {
      setTogglingNoPreread(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <b>{session.subjects?.name}</b>
          {session.sections?.section_label ? ` · Sec ${session.sections.section_label}` : ''}
          <span className="text-inkFaint text-xs ml-2">S{session.session_number}</span>
        </div>
        <span className="text-xs text-inkFaint">
          {dateLabel(session.session_date)} · {formatTime12h(session.start_time)}
          {session.room ? ` · Room ${session.room}` : ''}
        </span>
      </div>

      {session.driveFolderLink ? (
        <a
          href={session.driveFolderLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand-900 underline font-semibold inline-block mb-2"
        >
          📁 Open your {session.subjects?.name} folder
        </a>
      ) : (
        <p className="text-xs italic text-inkFaint mb-2">
          No folder link set for this subject/section yet — ask ACAD for the correct folder.
        </p>
      )}

      {hasFiles && (
        <ul className="text-sm mb-2 flex flex-col gap-1">
          {session.prereads!.map((p) => (
            <li key={p.id} className="text-inkSoft flex items-center gap-2">
              📄 {p.file_name}
              <RemoveButton prereadId={p.id} onRemoved={onChanged} />
            </li>
          ))}
        </ul>
      )}

      {session.no_preread && !hasFiles && (
        <p className="text-xs italic text-inkFaint mb-2">Marked as no preread for this session.</p>
      )}

      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      {successMsg && <p className="text-xs text-brand-700 mb-2">{successMsg}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Paste Drive share link here"
          value={driveLink}
          onChange={(e) => setDriveLink(e.target.value)}
          className="text-xs border border-line rounded-lg px-2.5 py-1.5 flex-1 min-w-[220px]"
        />
        <button
          onClick={handleSaveLink}
          disabled={!driveLink.trim() || uploading}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-brand-900 hover:bg-brand-800 disabled:opacity-40"
        >
          {uploading ? 'Saving…' : 'Save'}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-inkSoft">
          <input
            type="checkbox"
            checked={applyToNext}
            onChange={(e) => setApplyToNext(e.target.checked)}
          />
          Also apply to next session
        </label>

        <div className="ml-auto">
          <button
            onClick={() => toggleNoPreread(!session.no_preread)}
            disabled={togglingNoPreread}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-line text-inkSoft hover:bg-brand-50 disabled:opacity-40"
          >
            {session.no_preread ? 'Undo "no preread"' : 'Mark as no preread'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RemoveButton({ prereadId, onRemoved }: { prereadId: string; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    if (!confirm('Remove this file? This cannot be undone.')) return;
    setRemoving(true);
    try {
      const res = await fetch('/api/prereads/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prereadId })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to remove');
      }
      onRemoved();
    } catch (err: any) {
      alert(err.message ?? 'Failed to remove');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <button
      onClick={handleRemove}
      disabled={removing}
      className="text-xs text-danger hover:underline disabled:opacity-40"
    >
      {removing ? 'Removing…' : '✕ Remove'}
    </button>
  );
}

function ClassAnnouncements({
  assignmentOptions,
  announcements,
  onChanged
}: {
  assignmentOptions: AssignmentOption[];
  announcements: Announcement[];
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  // Keyed as "subjectId::sectionId" (sectionId 'null' string for no-section) so a single
  // <select> can represent both fields at once — mirrors the same composite-key pattern
  // used elsewhere in this codebase for subject+section matching.
  const [assignmentKey, setAssignmentKey] = useState(
    assignmentOptions[0] ? `${assignmentOptions[0].subjectId}::${assignmentOptions[0].sectionId ?? 'null'}` : ''
  );
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePost() {
    if (!title.trim() || !date || !time || !assignmentKey) {
      setError('Title, date, time, and a subject are all required.');
      return;
    }
    const [subjectId, sectionIdRaw] = assignmentKey.split('::');
    const sectionId = sectionIdRaw === 'null' ? null : sectionIdRaw;

    setSaving(true);
    setError(null);
    try {
      const targetAt = `${date}T${time}:00+05:30`;
      const res = await fetch('/api/reminders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'sr_announcement', title: title.trim(), targetAt, subjectId, sectionId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to post');
      setTitle('');
      setDate('');
      setTime('');
      setShowForm(false);
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to post announcement');
    } finally {
      setSaving(false);
    }
  }

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
      onChanged();
    } catch (err: any) {
      alert(err?.message ?? 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-inkSoft">
          Visible to every student enrolled in the subject+section you post to — same as their
          class sessions.
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs font-semibold text-brand-700 hover:underline shrink-0 ml-3"
        >
          {showForm ? 'Cancel' : '+ Post announcement'}
        </button>
      </div>

      {showForm && (
        <div className="border border-line rounded-lg p-3 mb-3 flex flex-col gap-2">
          <input
            type="text"
            placeholder="Announcement text"
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
          {assignmentOptions.length > 1 && (
            <select
              value={assignmentKey}
              onChange={(e) => setAssignmentKey(e.target.value)}
              className="text-xs border border-line rounded-lg px-2.5 py-1.5"
            >
              {assignmentOptions.map((a) => {
                const key = `${a.subjectId}::${a.sectionId ?? 'null'}`;
                return (
                  <option key={key} value={key}>
                    {a.subjectName}
                    {a.sectionLabel ? ` (Sec ${a.sectionLabel})` : ''}
                  </option>
                );
              })}
            </select>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            onClick={handlePost}
            disabled={saving}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-brand-900 hover:bg-brand-800 disabled:opacity-40"
          >
            {saving ? 'Posting…' : 'Post'}
          </button>
        </div>
      )}

      {announcements.length === 0 ? (
        <p className="text-xs text-inkFaint italic">No announcements posted yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {announcements.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-2 text-xs text-inkSoft bg-brand-50 rounded-lg px-3 py-2.5 leading-relaxed"
            >
              <span className="shrink-0">📢</span>
              <span className="flex-1">
                {a.title}
                {a.subjects?.name && <span className="text-inkFaint"> · {a.subjects.name}</span>}
                {a.sections?.section_label && <span className="text-inkFaint"> (Sec {a.sections.section_label})</span>}
                {' — '}
                <b>{formatReminderWhen(a.target_at)}</b>
              </span>
              <button
                onClick={() => handleDelete(a.id)}
                disabled={deletingId === a.id}
                className="shrink-0 text-inkFaint hover:text-danger disabled:opacity-40"
                aria-label="Delete announcement"
              >
                {deletingId === a.id ? '…' : '✕'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
