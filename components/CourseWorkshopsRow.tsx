// components/CourseWorkshopsRow.tsx
//
// Redress is a mailto: link, not an in-app form — see app/eap/page.tsx for
// why. That means there's no server round-trip and no way to know whether a
// student actually sent the email or just closed the tab, so this component
// has no "already requested" state anymore: the button is always just a link.

'use client';

import { useState } from 'react';

type Subject = {
  name: string;
  status: 'P' | 'A' | 'L' | 'S' | 'S_L' | null; // null = mandated but no attendance data yet
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

function buildRedressMailto(subjectName: string, regNo: string, term: string, batchLabel: string) {
  const year = batchLabel.match(/\d{4}/)?.[0] ?? '';
  const to = year ? `acad.${year}@iimu.ac.in` : '';

  const subject = `EAP Redress — ${term} — ${subjectName} — ${regNo}`;

  const body = [
    'Hi ACAD,',
    '',
    "I'd like to request a redress for the Course Workshop session below.",
    '',
    `Reg. No.: ${regNo}`,
    `Subject: ${subjectName}`,
    `Term: ${term}`,
    '',
    'Reason:',
    '[please describe why you were marked absent]',
    '',
    '',
    'Please attach your proof (screenshot, email, etc.) to this email before sending — a request without proof attached will not be considered.',
    '',
    'Thanks',
  ].join('\n');

  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function CourseWorkshopsRow({
  value,
  max,
  didNotSubmitDer1,
  isNA,
  regNo,
  term,
  batchLabel,
  subjects,
}: {
  value: number | null;
  max: number;
  didNotSubmitDer1: boolean;
  isNA: boolean;
  regNo: string;
  term: string;
  batchLabel: string;
  subjects: Subject[];
}) {
  const [open, setOpen] = useState(false);

  const isPendingScore = value === null || value === undefined;

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
                        {isAbsent && (
                          <a
                            href={buildRedressMailto(s.name, regNo, term, batchLabel)}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs border border-line rounded-full px-2.5 py-1 hover:border-danger hover:text-danger transition whitespace-nowrap"
                          >
                            Redress
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
