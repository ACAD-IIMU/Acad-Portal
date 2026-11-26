// app/sr-elections/page.tsx
//
// SR Elections — nomination + voting + results, cohort-aware. Same shell
// pattern as EAP/Home: Sidebar wraps every return path.
//
// Which term and which phase (nominations / voting / closed) come from the
// per-batch schedule in lib/srElections.ts — the term being elected FOR, which
// is usually the batch's NEXT term, since a rep has to be in place from day
// one. Before a new election opens, the page keeps showing the previous
// term's results (Results tab only), so a new schedule can be deployed early.
// `batch_label` isn't the right key here — that's stable for the batch's
// whole life, while "current/next term" rotates each year.
//
// Cross-cohort isolation: sr_nominations and sr_assignments are scoped by
// `term` alone (no batch_label column). That's safe today because MBA1's
// 'Term II' and MBA2's 'Term V' can never string-match — the same reasoning
// lib/term5.ts and the sync-timetable route already rely on. If two batches
// ever share a term label at the same time (e.g. both on 'Term III' one day),
// sr_nominations/sr_assignments will need a batch_label column added, same as
// subjects/sections/sessions already got in the batch_label_step*.sql
// migration. Not urgent — flagging so it's on the record.
//
// Voting-table split: voteTableForTerm() returns a per-term PHYSICAL table
// (sr_votes_term_v, sr_votes_term_ii, ...). It has to be created in Supabase
// before that term's voting opens (Term VI: supabase/sr-elections-term-vi/
// step2_vote_table.sql). Until then the page still loads; only an actual vote
// submit would 500.

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { formatSrTime, srElectionFor, srPhase } from '@/lib/srElections';
import { subjectDisplayName } from '@/lib/subjectFullNames';
import Sidebar from '@/components/Sidebar';
import UserMenu from '@/components/UserMenu';
import NominationForm from './NominationForm';
import VotingForm from './VotingForm';
import SrElectionsTabs from './Tabs';
import LaunchBanner from './LaunchBanner';
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
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar batchLabel={batchLabel} cohort={cohort} />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5 md:px-8 md:py-8">
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

  // The viewer's batch decides the election (lib/srElections.ts). Every DB
  // read below scopes by TERM, which is the actual isolation between cohorts:
  // sr_nominations / sr_assignments have no batch_label column, so an MBA1
  // student only ever sees Term II rows and an MBA2 student Term V/VI rows.
  // Evaluated fresh on every request, never at module load.
  const election = srElectionFor(student.cohort);
  const phase = srPhase(election);

  // Before a new election opens, keep showing the previous term's SRs.
  const showingPrevious = phase === 'before' && Boolean(election.previousTerm);
  const TERM = showingPrevious ? election.previousTerm! : election.term;

  const nominationsOpenForViewer = phase === 'nominations';
  const votingOpenForViewer = phase === 'voting';
  const resultsReady = showingPrevious || phase === 'closed';

  let nominationContent: ReactNode;

  // Not open: say which side of the window we're on, so a student who already
  // nominated never reads "hasn't started" as their submission having vanished.
  if (!nominationsOpenForViewer) {
    nominationContent = (
      <p className="text-sm text-inkFaint italic card p-5">
        {phase === 'before'
          ? `Nominations open on ${formatSrTime(election.nominationsOpenAt)}.`
          : phase === 'voting'
          ? 'Nominations are closed. Voting is now open — head to the Voting tab.'
          : 'Nominations and voting have closed — check the Results tab.'}
      </p>
    );
  } else {
    const { data: existingNominations } = await supabase
      .from('sr_nominations')
      .select('subject_id, section_id, priority, submitted_at, subjects(name), sections(section_label)')
      .eq('student_id', student.id)
      .eq('term', TERM)
      .order('priority', { ascending: true });

    // Already submitted — locked-in, read-only confirmation. No edit path exists
    // at all, by design, so there's nothing else to render here.
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
                  <b>{subjectDisplayName(n.subjects?.name, TERM)}</b>
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
        subjectName: subjectDisplayName(e.subjects?.name, TERM),
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
  }

  const notice = (text: string) => (
    <p className="text-sm text-inkFaint italic card p-5">{text}</p>
  );

  const votingContent = votingOpenForViewer
    ? <VotingForm term={TERM} />
    : phase === 'closed'
    ? notice('Voting closed. Results will be posted soon.')
    : notice(`Voting opens on ${formatSrTime(election.nominationsCloseAt)}, once nominations close.`);

  // Results: read from sr_assignments directly (not re-derived from votes) — this is
  // the exact table that grants real SR access site-wide, so the list shown here can
  // never drift from who actually has SR permissions. Uses the admin client
  // deliberately: this is public-within-the-portal information (which student
  // represents which subject+section), not scoped to the viewer's own data the way
  // every other query on this page is, so the regular per-request client — which
  // would only ever see rows RLS allows for the logged-in student — isn't the right
  // tool here.
  //
  // Skipped entirely while resultsReady is false — assignments only exist once
  // votes are tallied, after voting closes, so there's nothing to query yet.
  let resultsContent: ReactNode;
  if (!resultsReady) {
    resultsContent = notice(
      `Results are posted after voting closes on ${formatSrTime(election.votingCloseAt)}.`
    );
  } else {
    const admin = createAdminClient();
    const { data: srAssignments } = await admin
      .from('sr_assignments')
      .select('subject_id, section_id, subjects(name), sections(section_label), students(full_name, reg_no, email, phone)')
      .eq('term', TERM);

    // Scope Results to the viewer's OWN classes: for every subject the viewer
    // is enrolled in this term, show the SR of the exact section they sit in.
    //
    // Match on (subject_id, section_id) PAIRS — never on one section label.
    // An earlier version (8bdee35, 26 Sep 2026) read a single enrollment row
    // and kept only assignments whose section_label equalled it, on the
    // assumption that a student is in the same section for every subject in a
    // term. That holds for MBA1 in Terms I–II, but NOT for MBA2 from Term III
    // on, where sections vary per subject (and electives). For MBA2/Term V it
    // hid every subject the viewer takes in a different section, and showed
    // Sec-X SRs for subjects the viewer doesn't take at all. `.limit(1)` with
    // no order also made which label won effectively arbitrary.
    //
    // Null-safe on section: if either the assignment or the enrollment has no
    // section (unsectioned elective), match on subject alone.
    //
    // Read via the regular (RLS-bound) `supabase` client, not `admin` — this
    // is the viewer's own enrollment data.
    //
    // If the viewer has no enrollments for this term at all (data not loaded
    // yet), fall back to showing everything rather than silently nothing.
    const { data: viewerEnrollments } = await supabase
      .from('enrollments')
      .select('subject_id, section_id')
      .eq('student_id', student.id)
      .eq('term', TERM);

    const enrolled = (viewerEnrollments ?? []) as { subject_id: string; section_id: string | null }[];
    const isViewersClass = (subjectId: string, sectionId: string | null) =>
      enrolled.some(
        (e) =>
          e.subject_id === subjectId &&
          (e.section_id == null || sectionId == null || e.section_id === sectionId)
      );

    const resultsRows = (srAssignments ?? [])
      .filter((r: any) => enrolled.length === 0 || isViewersClass(r.subject_id, r.section_id ?? null))
      .map((r: any) => ({
        subjectName: subjectDisplayName(r.subjects?.name, TERM) || '—',
        sectionLabel: r.sections?.section_label ?? null,
        fullName: r.students?.full_name ?? '—',
        regNo: r.students?.reg_no ?? '—',
        email: r.students?.email ?? '—',
        phone: r.students?.phone ?? null
      }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName) || (a.sectionLabel ?? '').localeCompare(b.sectionLabel ?? ''));

    resultsContent = <Results rows={resultsRows} />;
  }

  return (
    <Shell batchLabel={student.batch_label} cohort={student.cohort} userMenu={userMenu}>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl">SR Elections — {TERM}</h1>
          {!showingPrevious && (
            <p className="text-inkFaint text-sm mt-1">
              Nominations {formatSrTime(election.nominationsOpenAt)} – {formatSrTime(election.nominationsCloseAt)}
              {' · '}Voting until {formatSrTime(election.votingCloseAt)}
            </p>
          )}
        </div>
        {showingPrevious && (
          <LaunchBanner id={election.term}>
            <p className="font-display text-base font-semibold text-brand-900">Now or never (literally).</p>
            <p className="mt-1">
              {election.term} SR nominations open on{' '}
              <b className="text-ink">{formatSrTime(election.nominationsOpenAt)}</b> — the last SR
              election of your MBA. Until then, here are the {TERM} SRs who held the fort.
            </p>
          </LaunchBanner>
        )}
        <SrElectionsTabs
          nomination={nominationContent}
          voting={votingContent}
          results={resultsContent}
          // Before the new election opens, only the previous term's Results
          // are shown — there's nothing to nominate or vote for yet.
          resultsOnly={showingPrevious}
          // Land on the tab a student can act on in each phase.
          initialTab={phase === 'voting' ? 'voting' : phase === 'closed' ? 'results' : 'nomination'}
        />
      </div>
    </Shell>
  );
}
