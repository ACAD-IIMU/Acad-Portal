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

function dateLabel(dateStr: string) {
  return new Date(`${dateStr}T00:00:00+05:30`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

export default function SrUploadPage() {
  const [loading, setLoading] = useState(true);
  const [isSr, setIsSr] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/sr/sessions');
      const data = await res.json();
      setIsSr(data.isSr ?? false);
      setSessions(data.sessions ?? []);
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
        <h1 className="text-2xl">SR Tools — Prereads</h1>
        <p className="text-inkFaint text-sm">Upload prereads for your upcoming sessions.</p>
      </div>

      <div className="card p-4 text-sm text-inkSoft">
        <b>How this works:</b> each session below links to your subject &amp; section's own
        folder — upload your file there first (any file type), then come back, copy its
        share link from Drive (right-click the file → Share → Copy link), and paste it in.
      </div>

      {sessions.length === 0 && (
        <p className="text-sm text-inkFaint italic">No upcoming sessions found for your subject(s).</p>
      )}

      {sessions.map((s) => (
        <SessionUploadCard key={s.id} session={s} onChanged={refresh} />
      ))}
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
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');

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
            <li key={p.id} className="text-inkSoft">
              📄 {p.file_name}
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
