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
  // Order of this array IS the priority — index 0 = priority 1, etc.
  // First tap on an option appends it to the end (next free priority);
  // tapping a selected option again removes it, and everything after it
  // shifts up automatically since priority is just "position in this array."
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function toggle(subjectId: string) {
    setSelectedIds((prev) => {
      if (prev.includes(subjectId)) return prev.filter((id) => id !== subjectId);
      if (prev.length >= MAX_PICKS) return prev; // button is disabled in this state anyway
      return [...prev, subjectId];
    });
  }

  function move(subjectId: string, direction: -1 | 1) {
    setSelectedIds((prev) => {
      const idx = prev.indexOf(subjectId);
      const swapWith = idx + direction;
      if (idx === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedIds.length === 0) return;

    const picked = selectedIds.map((id, i) => {
      const opt = options.find((o) => o.subjectId === id)!;
      return { ...opt, priority: i + 1 };
    });
    const summary = picked
      .map((p) => `${p.priority}. ${p.subjectName}${p.sectionLabel ? ` (Sec ${p.sectionLabel})` : ''}`)
      .join('\n');

    const confirmed = window.confirm(
      `Your priority order:\n\n${summary}\n\nThis is FINAL — you cannot edit, reorder, or withdraw after this. Submit?`
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
          picks: picked.map((p) => ({
            subjectId: p.subjectId,
            sectionId: p.sectionId,
            priority: p.priority
          }))
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
        Refresh the page to see your confirmed priority order.
      </div>
    );
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      <p className="text-xs text-inkFaint">
        Tap up to {MAX_PICKS}, in the order you want them — first tap = priority 1. Use the arrows to
        reorder before submitting. Selected: {selectedIds.length}/{MAX_PICKS}.
      </p>

      <ul className="flex flex-col gap-2">
        {options.map((o) => {
          const priorityIdx = selectedIds.indexOf(o.subjectId);
          const checked = priorityIdx !== -1;
          const disabled = !checked && selectedIds.length >= MAX_PICKS;
          return (
            <li key={o.subjectId}>
              <div
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition ${
                  checked ? 'border-brand-700 bg-brand-50' : 'border-line'
                } ${disabled ? 'opacity-40' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => !disabled && toggle(o.subjectId)}
                  disabled={disabled}
                  className={`flex items-center gap-3 flex-1 text-left min-w-0 ${
                    disabled ? 'cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  {checked ? (
                    <span className="w-7 h-7 rounded-full bg-brand-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {priorityIdx + 1}
                    </span>
                  ) : (
                    <span className="w-7 h-7 rounded-full border border-line flex-shrink-0" />
                  )}
                  <span className="min-w-0">
                    <b>{o.subjectName}</b>
                    {o.sectionLabel ? ` · Sec ${o.sectionLabel}` : ''}
                  </span>
                </button>

                {checked && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => move(o.subjectId, -1)}
                      disabled={priorityIdx === 0}
                      aria-label="Move up in priority"
                      className="w-8 h-8 rounded-md border border-line flex items-center justify-center text-inkSoft text-sm disabled:opacity-30 hover:bg-white active:scale-95 transition"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => move(o.subjectId, 1)}
                      disabled={priorityIdx === selectedIds.length - 1}
                      aria-label="Move down in priority"
                      className="w-8 h-8 rounded-md border border-line flex items-center justify-center text-inkSoft text-sm disabled:opacity-30 hover:bg-white active:scale-95 transition"
                    >
                      ▼
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={selectedIds.length === 0 || submitting}
        className="self-start rounded-lg px-4 py-2 text-sm font-semibold text-white bg-brand-900 hover:bg-brand-800 disabled:opacity-40"
      >
        {submitting ? 'Submitting…' : 'Submit Nomination'}
      </button>
    </div>
  );
}
