// components/CourseWorkshopsRow.tsx
'use client';

import { useRef, useState, useTransition } from 'react';
import { requestCourseWorkshopRedress } from '@/app/eap/actions';

type Subject = {
  name: string;
  status: 'P' | 'A' | 'L' | 'S' | 'S_L' | null; // null = mandated but no attendance data yet
  redressRequested: boolean;
};

const STATUS_LABEL: Record<NonNullable<Subject['status']>, string> = {
  P: 'Present',
  A: 'Absent',
  L: 'Late',
  S: 'Smart Casuals',
  S_L: 'Absent', // S + L nets to zero credit — shown as Absent, matching how it was scored
};

const STATUS_STYLE: Record<NonNullable<Subject['status']>, string> = {
  P: 'bg-[#e2f2e8] text-[#1e7a4c]',
  A: 'bg-danger-100 text-danger',
  L: 'bg-gold-100 text-gold-600',
  S: 'bg-gold-100 text-gold-600',
  S_L: 'bg-danger-100 text-danger',
};

export default function CourseWorkshopsRow({
  value,
  max,
  didNotSubmitDer1,
  isNA,
  subjects,
}: {
  value: number | null;
  max: number;
  didNotSubmitDer1: boolean;
  isNA: boolean;
  subjects: Subject[];
}) {
  const [open, setOpen] = useState(false);
  const [modalSubject, setModalSubject] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [submittedFor, setSubmittedFor] = useState<Set<string>>(
    new Set(subjects.filter((s) => s.redressRequested).map((s) => s.name))
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPendingScore = value === null || value === undefined;

  function openModal(subjectName: string) {
    setModalSubject(subjectName);
    setReason('');
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function submitRedress() {
    if (!modalSubject) return;
    if (!reason.trim()) {
      setError('Please enter a reason.');
      return;
    }
    const proofFile = fileInputRef.current?.files?.[0];
    const formData = new FormData();
    formData.set('subjectName', modalSubject);
    formData.set('reason', reason);
    if (proofFile) formData.set('proof', proofFile);

    startTransition(async () => {
      const result = await requestCourseWorkshopRedress(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSubmittedFor((prev) => new Set(prev).add(modalSubject));
      setModalSubject(null);
    });
  }

  // Exchange-program students aren't doing Course Workshops this term at
  // all — a flat, non-expandable N/A row, not a Pending state implying
  // data is still coming.
  if (isNA) {
    return (
      <tr className="border-b border-line">
        <td className="py-2.5">Course Workshops</td>
        <td className="py-2.5 text-right">
          <span className="text-xs italic text-inkFaint">N/A — Exchange Program</span>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr
        className="border-b border-line cursor-pointer hover:bg-brand-50/40"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="py-2.5">
          <span className={`inline-block w-3.5 text-xs text-inkFaint transition-transform ${open ? 'rotate-90' : ''}`}>
            ▸
          </span>
          Course Workshops
        </td>
        <td className="py-2.5 text-right font-mono">
          {isPendingScore ? (
            <span className="text-xs font-semibold text-gold-600 bg-gold-100 px-2.5 py-1 rounded-full whitespace-nowrap">
              Pending
            </span>
          ) : (
            <>
              {value}
              <span className="font-sans text-inkFaint text-xs ml-0.5">/{max}</span>
            </>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-line">
          <td colSpan={2} className="p-0">
            <div className="bg-brand-50/50 px-3 py-3.5 pl-8">
              <p className="text-xs text-inkFaint italic mb-2.5">
                {didNotSubmitDer1
                  ? "DER Round 1 wasn't submitted, so every workshop is mandated per policy — showing all electives."
                  : 'Showing only the electives you selected in DER Round 1.'}
              </p>
              <div className="flex flex-col gap-0">
                {subjects.map((s) => {
                  const alreadySubmitted = submittedFor.has(s.name);
                  const isAbsent = s.status === 'A' || s.status === 'S_L';
                  return (
                    <div
                      key={s.name}
                      className="flex items-center justify-between gap-3 py-2 border-b border-dashed border-line last:border-none text-sm"
                    >
                      <span className="flex-1 min-w-0">{s.name}</span>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        {s.status === null ? (
                          <span className="text-xs font-semibold text-gold-600 bg-gold-100 px-2.5 py-1 rounded-full whitespace-nowrap">
                            Pending
                          </span>
                        ) : (
                          <span
                            className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${STATUS_STYLE[s.status]}`}
                          >
                            {STATUS_LABEL[s.status]}
                          </span>
                        )}
                        {isAbsent &&
                          (alreadySubmitted ? (
                            <span className="text-xs text-inkFaint border border-line rounded-full px-2.5 py-1 whitespace-nowrap">
                              Redress requested
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openModal(s.name);
                              }}
                              className="text-xs border border-line rounded-full px-2.5 py-1 hover:border-danger hover:text-danger transition whitespace-nowrap"
                            >
                              Redress
                            </button>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      )}

      {modalSubject && (
        <tr>
          <td colSpan={2} className="p-0">
            <div
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-5"
              onClick={() => setModalSubject(null)}
            >
              <div
                className="bg-white rounded-2xl p-7 max-w-[420px] w-full shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-semibold mb-1">Request redress</h3>
                <p className="text-sm text-inkSoft mb-4">{modalSubject}</p>
                <label className="block text-xs font-semibold text-inkFaint uppercase tracking-wide mb-1.5">
                  Reason
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  className="w-full border border-line rounded-lg p-3 text-sm mb-1.5 focus:outline-none focus:border-brand-700"
                  placeholder="Explain why this should be marked present..."
                />
                {error && <p className="text-xs text-danger mb-2">{error}</p>}

                <label className="block text-xs font-semibold text-inkFaint uppercase tracking-wide mb-1.5 mt-3">
                  Proof <span className="normal-case font-normal text-inkFaint">(optional)</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="w-full text-sm border border-line rounded-lg p-2 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-900"
                />
                <p className="text-xs text-inkFaint mt-1">
                  Screenshot, email, or document supporting your reason. PDF, PNG, or JPG, under 4MB.
                </p>

                <div className="flex gap-2.5 mt-4">
                  <button
                    onClick={() => setModalSubject(null)}
                    className="flex-1 py-2.5 rounded-lg border border-line text-sm font-semibold hover:bg-brand-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitRedress}
                    disabled={isPending}
                    className="flex-1 py-2.5 rounded-lg bg-brand-900 text-white text-sm font-semibold hover:bg-brand-800 transition disabled:opacity-60"
                  >
                    {isPending ? 'Submitting…' : 'Submit'}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
