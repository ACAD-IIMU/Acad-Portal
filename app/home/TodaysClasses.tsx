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

export default function TodaysClasses({
  sessions,
  batchLabel
}: {
  sessions: SessionRow[];
  batchLabel?: string;
}) {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base">Today&apos;s classes</h2>
        <span className="text-xs text-inkFaint">{today}{batchLabel ? ` · ${batchLabel}` : ''}</span>
      </div>

      {sessions.length === 0 && (
        <p className="text-sm text-inkFaint italic">No classes scheduled today.</p>
      )}

      {sessions.map((s) => {
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
