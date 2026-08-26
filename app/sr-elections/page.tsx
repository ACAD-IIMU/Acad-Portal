// app/sr-elections/page.tsx
//
// SR Elections — nomination phase only, for now. Voting comes later as a
// separate build (see the plan). Same shell pattern as EAP/Home: Sidebar
// wraps every return path, term hardcoded here same as everywhere else
// until there's a single source of truth for current_term.

const TERM = 'Term V';

import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';
import UserMenu from '@/components/UserMenu';
import NominationForm from './NominationForm';
import type { ReactNode } from 'react';

// Per-student data (own enrollments, own nomination state) — never cache/serve stale.
export const dynamic = 'force-dynamic';

function Shell({
  batchLabel,
  userMenu,
  children
}: {
  batchLabel?: string;
  userMenu?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar batchLabel={batchLabel} />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 md:px-8">
        {userMenu && <div className="flex justify-end mb-5">{userMenu}</div>}
        {children}
      </main>
    </div>
  );
}

export default async function SrElectionsPage() {
  const supabase = createClient();

  const { data: student } = await supabase.from('students').select('*').single();

  if (!student) {
    return (
      <Shell>
        <p className="text-inkFaint text-sm">
          Couldn&apos;t load your student record. Try refreshing, or contact ACAD if this persists.
        </p>
      </Shell>
    );
  }

  const userMenu = (
    <UserMenu name={student.full_name} regNo={student.reg_no} batchLabel={student.batch_label} />
  );

  const { data: existingNominations } = await supabase
    .from('sr_nominations')
    .select('subject_id, section_id, priority, submitted_at, subjects(name), sections(section_label)')
    .eq('student_id', student.id)
    .eq('term', TERM)
    .order('priority', { ascending: true });

  // Already submitted — locked-in, read-only confirmation. No edit path exists
  // at all, by design, so there's nothing else to render here.
  if (existingNominations && existingNominations.length > 0) {
    return (
      <Shell batchLabel={student.batch_label} userMenu={userMenu}>
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-2xl">SR Elections — {TERM}</h1>
            <p className="text-inkFaint text-sm">Nomination submitted. This is final.</p>
          </div>
          <div className="card p-5">
            <p className="text-sm text-inkSoft mb-3">
              You&apos;re nominated for Subject Representative in:
            </p>
            <ul className="flex flex-col gap-2">
              {existingNominations.map((n: any, i: number) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className="w-6 h-6 rounded-full bg-brand-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {n.priority}
                  </span>
                  <b>{n.subjects?.name}</b>
                  {n.sections?.section_label ? ` · Sec ${n.sections.section_label}` : ''}
                </li>
              ))}
            </ul>
            <p className="text-xs text-inkFaint mt-4">
              Submitted{' '}
              {new Date(existingNominations[0].submitted_at).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Kolkata'
              })}
              . Nominations can&apos;t be edited, withdrawn, or added to after submission.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('subject_id, section_id, subjects(name), sections(section_label)')
    .eq('student_id', student.id)
    .eq('term', TERM);

  const options = (enrollments ?? []).map((e: any) => ({
    subjectId: e.subject_id as string,
    subjectName: e.subjects?.name as string,
    sectionId: e.section_id as string | null,
    sectionLabel: e.sections?.section_label as string | null
  }));

  return (
    <Shell batchLabel={student.batch_label} userMenu={userMenu}>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl">SR Elections — {TERM}</h1>
          <p className="text-inkFaint text-sm">
            Nominate yourself as Subject Representative for up to 3 of your enrolled subjects.
          </p>
        </div>
        {options.length === 0 ? (
          <p className="text-sm text-inkFaint italic card p-5">
            No {TERM} enrollments found for you yet — check back once ACAD has loaded the term&apos;s
            enrollment data.
          </p>
        ) : (
          <NominationForm options={options} term={TERM} />
        )}
      </div>
    </Shell>
  );
}
