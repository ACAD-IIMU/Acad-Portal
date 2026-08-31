// app/sr-elections/VotingForm.tsx
//
// Fetches its own data from /api/sr-elections/voting-state on mount rather
// than being fed props from the server component, because building the
// candidate list requires reading other students' nominations/names — RLS
// (correctly) blocks that for a plain anon client, so it has to go through
// a route handler that uses the service-role client. See that route for
// the actual query logic.

'use client';

import { useEffect, useState } from 'react';

type Candidate = { id: string; name: string };

type SubjectVote = {
  subjectId: string;
  subjectName: string;
  sectionId: string | null;
  sectionLabel: string | null;
  candidates: Candidate[];
};

type LockedVote = {
  subjectName: string;
  sectionLabel: string | null;
  candidateName: string;
};

type VotingState =
  | { locked: true; votes: LockedVote[] }
  | { locked: false; subjects: SubjectVote[] };

export default function VotingForm({ term }: { term: string }) {
  const [state, setState] = useState<VotingState | 'loading' | 'error'>('loading');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/sr-elections/voting-state?term=${encodeURIComponent(term)}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data: VotingState) => setState(data))
      .catch(() => setState('error'));
  }, [term]);

  if (state === 'loading') {
    return <p className="text-sm text-inkFaint italic card p-5">Loading…</p>;
  }
  if (state === 'error') {
    return (
      <p className="text-sm text-inkFaint italic card p-5">
        Couldn&apos;t load voting data. Try refreshing.
      </p>
    );
  }

  if (state.locked) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-inkFaint text-sm">Votes submitted. This is final.</p>
        <div className="card p-5">
          <ul className="flex flex-col gap-2">
            {state.votes.map((v, i) => (
              <li key={i} className="text-sm">
                <b>{v.subjectName}</b>
                {v.sectionLabel ? ` · Sec ${v.sectionLabel}` : ''}
                {' → '}
                {v.candidateName}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card p-5 text-sm text-inkSoft">
        <p className="font-semibold text-brand-900 mb-1">Votes submitted.</p>
        Refresh the page to see your confirmed votes.
      </div>
    );
  }

  const subjects = state.subjects;
  const votable = subjects.filter((s) => s.candidates.length > 0);
  const allSelected = votable.length > 0 && votable.every((s) => selections[s.subjectId]);

  async function handleSubmit() {
    if (!allSelected) return;
    const confirmed = window.confirm('Submit your votes? This is final and cannot be changed.');
    if (!confirmed) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/sr-elections/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term,
          votes: votable.map((s) => ({
            subjectId: s.subjectId,
            sectionId: s.sectionId,
            candidateStudentId: selections[s.subjectId]
          }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to submit votes');
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? 'Failed to submit votes');
    } finally {
      setSubmitting(false);
    }
  }

  if (subjects.length === 0) {
    return (
      <p className="text-sm text-inkFaint italic card p-5">
        No {term} enrollments found for you yet — check back once ACAD has loaded the term&apos;s
        enrollment data.
      </p>
    );
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      <p className="text-xs text-inkFaint">
        Select one candidate for each subject below, then submit. This is final — votes can&apos;t
        be changed after submission.
      </p>

      <ul className="flex flex-col gap-3">
        {subjects.map((s) => (
          <li key={`${s.subjectId}::${s.sectionId ?? 'null'}`} className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">
              {s.subjectName}
              {s.sectionLabel ? ` · Sec ${s.sectionLabel}` : ''}
            </label>
            {s.candidates.length === 0 ? (
              <p className="text-xs text-inkFaint italic">No nominees for this subject.</p>
            ) : (
              <select
                value={selections[s.subjectId] ?? ''}
                onChange={(e) => setSelections((prev) => ({ ...prev, [s.subjectId]: e.target.value }))}
                className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="" disabled>
                  Select a candidate
                </option>
                {s.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!allSelected || submitting}
        className="self-start rounded-lg px-4 py-2 text-sm font-semibold text-white bg-brand-900 hover:bg-brand-800 disabled:opacity-40"
      >
        {submitting ? 'Submitting…' : 'Submit Votes'}
      </button>
    </div>
  );
}
