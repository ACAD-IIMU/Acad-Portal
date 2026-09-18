// app/sr-elections/page.tsx
//
// SR Elections — nomination + voting + results, cohort-aware. Same shell
// pattern as EAP/Home: Sidebar wraps every return path.
//
// The term is resolved per-student from `cohort` (Term I for MBA1, Term V for
// MBA2), matching the same pattern app/home/page.tsx and lib/googleCalendar.ts
// already use. `batch_label` isn't the right key here — that's stable for the
// batch's whole life, while "current term" rotates each year.
//
// Cross-cohort isolation: sr_nominations and sr_assignments are scoped by
// `term` alone (no batch_label column). That's safe today because MBA1's
// 'Term I' and MBA2's 'Term V' can never string-match — the same reasoning
// lib/term5.ts and the sync-timetable route already rely on. If two batches
// ever share a term label at the same time (e.g. both on 'Term III' one day),
// sr_nominations/sr_assignments will need a batch_label column added, same as
// subjects/sections/sessions already got in the batch_label_step*.sql
// migration. Not urgent — flagging so it's on the record.
//
// Voting-table split: voteTableForTerm() returns a per-term PHYSICAL table
// (sr_votes_term_v, sr_votes_term_i, ...). Someone has to create
// sr_votes_term_i in Supabase before MBA1's voting phase opens, mirroring
// sr_votes_term_v — this is the existing per-term operational step, just
// applied to a second cohort's term for the first time. Until then the page
// still loads fine for MBA1 (nomination + empty voting/results state); only
// an actual vote submit would 500.

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { TERM_1 } from '@/lib/term1';
import { TERM_5 } from '@/lib/term5';
import Sidebar from '@/components/Sidebar';
import UserMenu from '@/components/UserMenu';
import NominationForm from './NominationForm';
import VotingForm from './VotingForm';
import SrElectionsTabs from './Tabs';
import Results from './Results';
import type { ReactNode } from 'react';

// Per-student data (own enrollments, own nomination state) — never cache/serve stale.
export const dynamic = 'force-dynamic';

function Shell({
  batchLabel,
  cohort,
  userMenu,
  children
}: {
  batchLabel?: string;
  cohort?: string;
  userMenu?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar batchLabel={batchLabel} cohort={cohort} />
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

  // Which cohort this student is in decides which current-term constant applies.
  // Every DB read below scopes by this TERM, which is the actual isolation
  // between cohorts: an MBA1 student's sr_nominations / enrollments /
  // sr_assignments queries only ever return Term I rows, and an MBA2 student's
  // only ever return Term V rows, even though those tables have no batch_label
  // column of their own. This is the same reason the earlier hard block for
  // MBA1 could safely be removed — the "MBA1 student saw MBA2's SR roster"
  // exposure came from the previous TERM constant being hardcoded to 'Term V'
  // for everyone, not from anything the admin-client srAssignments query does
  // wrong on its own; now that TERM tracks the viewer's cohort, the same query
  // returns exactly and only that cohort's roster.
  const TERM = student.cohort === 'MBA1' ? TERM_1 : TERM_5;

  const { data: existingNominations } = await supabase
    .from('sr_nominations')
    .select('subject_id, section_id, priority, submitted_at, subjects(name), sections(section_label)')
    .eq('student_id', student.id)
    .eq('term', TERM)
    .order('priority', { ascending: true });

  // Already submitted — locked-in, read-only confirmation. No edit path exists
  // at all, by design, so there's nothing else to render here.
  let nominationContent: ReactNode;

  if (existingNominations && existingNominations.length > 0) {
    nominationContent = (
      <div className="flex flex-col gap-3">
        <p className="text-inkFaint text-sm">Nomination submitted. This is final.</p>
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
    );
  } else {
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

    nominationContent = (
      <div className="flex flex-col gap-3">
        <p className="text-inkFaint text-sm">
          Nominate yourself as Subject Representative for up to 3 of your enrolled subjects.
        </p>
        {options.length === 0 ? (
          <p className="text-sm text-inkFaint italic card p-5">
            No {TERM} enrollments found for you yet — check back once ACAD has loaded the term&apos;s
            enrollment data.
          </p>
        ) : (
          <NominationForm options={options} term={TERM} />
        )}
      </div>
    );
  }

  const votingContent = <VotingForm term={TERM} />;

  // Results: read from sr_assignments directly (not re-derived from votes) — this is
  // the exact table that grants real SR access site-wide, so the list shown here can
  // never drift from who actually has SR permissions. Uses the admin client
  // deliberately: this is public-within-the-portal information (which student
  // represents which subject+section), not scoped to the viewer's own data the way
  // every other query on this page is, so the regular per-request client — which
  // would only ever see rows RLS allows for the logged-in student — isn't the right
  // tool here.
  const admin = createAdminClient();
  const { data: srAssignments } = await admin
    .from('sr_assignments')
    .select('subjects(name), sections(section_label), students(full_name, reg_no, email, phone)')
    .eq('term', TERM);

  const resultsRows = (srAssignments ?? [])
    .map((r: any) => ({
      subjectName: r.subjects?.name ?? '—',
      sectionLabel: r.sections?.section_label ?? null,
      fullName: r.students?.full_name ?? '—',
      regNo: r.students?.reg_no ?? '—',
      email: r.students?.email ?? '—',
      phone: r.students?.phone ?? null
    }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName) || (a.sectionLabel ?? '').localeCompare(b.sectionLabel ?? ''));

  const resultsContent = <Results rows={resultsRows} />;

  return (
    <Shell batchLabel={student.batch_label} cohort={student.cohort} userMenu={userMenu}>
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl">SR Elections — {TERM}</h1>
        <SrElectionsTabs nomination={nominationContent} voting={votingContent} results={resultsContent} />
      </div>
    </Shell>
  );
}
