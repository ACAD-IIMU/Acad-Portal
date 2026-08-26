'use client';

import { useState } from 'react';

type Option = {
  subjectId: string;
  subjectName: string;
  sectionId: string | null;
  sectionLabel: string | null;
};

const MAX_PICKS = 3;

export default function NominationForm({ options, term }: { options: Option[]; term: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function toggle(subjectId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) {
        next.delete(subjectId);
      } else {
        if (next.size >= MAX_PICKS) return prev; // checkbox is disabled in this state anyway
        next.add(subjectId);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) return;

    const picked = options.filter((o) => selected.has(o.subjectId));
    const names = picked
      .map((p) => p.subjectName + (p.sectionLabel ? ` (Sec ${p.sectionLabel})` : ''))
      .join(', ');

    const confirmed = window.confirm(
      `You're nominating yourself for: ${names}.\n\nThis is FINAL — you cannot edit, add more, or withdraw after this. Submit?`
    );
    if (!confirmed) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/sr-elections/nominate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term,
          picks: picked.map((p) => ({ subjectId: p.subjectId, sectionId: p.sectionId }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to submit nomination');
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? 'Failed to submit nomination');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="card p-5 text-sm text-inkSoft">
        <p className="font-semibold text-brand-900 mb-1">Nomination submitted.</p>
        Refresh the page to see your confirmed picks.
      </div>
    );
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      <p className="text-xs text-inkFaint">
        Pick up to {MAX_PICKS}. Selected: {selected.size}/{MAX_PICKS}.
      </p>

      <ul className="flex flex-col gap-2">
        {options.map((o) => {
          const checked = selected.has(o.subjectId);
          const disabled = !checked && selected.size >= MAX_PICKS;
          return (
            <li key={o.subjectId}>
              <label
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition ${
                  checked ? 'border-brand-700 bg-brand-50' : 'border-line'
                } ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-brand-50/50'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(o.subjectId)}
                  className="w-4 h-4"
                />
                <span>
                  <b>{o.subjectName}</b>
                  {o.sectionLabel ? ` · Sec ${o.sectionLabel}` : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={selected.size === 0 || submitting}
        className="self-start rounded-lg px-4 py-2 text-sm font-semibold text-white bg-brand-900 hover:bg-brand-800 disabled:opacity-40"
      >
        {submitting ? 'Submitting…' : `Submit Nomination${selected.size > 1 ? 's' : ''}`}
      </button>
    </div>
  );
}
