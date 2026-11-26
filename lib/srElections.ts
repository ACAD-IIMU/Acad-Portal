// lib/srElections.ts
//
// The SR election schedule for each batch, in ONE place. The page
// (app/sr-elections/page.tsx) and the nominate / vote APIs all read it, so a
// date change is a one-line edit here instead of three copies kept in sync by
// hand. The APIs are the real enforcement; the page only decides what to show.
//
// Each election runs: nominations open -> nominations close (= voting opens)
// -> voting closes -> someone tallies the votes into sr_assignments
// (supabase/sr-elections-term-vi/step4a_results.sql, then step4b_publish_winners.sql)
// and Results shows them.
//
// `previousTerm`: until nominations open, the page keeps showing that term's
// results (locked to the Results tab) instead of an empty new term. That makes
// it safe to deploy a new election long before it starts.
//
// Always compare against a fresh `new Date()` per request — never a
// module-level boolean, which a warm serverless instance could freeze across
// a cutoff.

import { TERM_2 } from '@/lib/term2';
import { TERM_5 } from '@/lib/term5';
import { TERM_6 } from '@/lib/term6';

export type SrElection = {
  term: string;
  nominationsOpenAt: Date;
  nominationsCloseAt: Date; // voting opens at the same instant
  votingCloseAt: Date;
  // subjects.name values with no SR vote (e.g. Term V's IMC, voted separately)
  excludedSubjects: string[];
  previousTerm?: string;
};

export type SrPhase = 'before' | 'nominations' | 'voting' | 'closed';

const ELECTIONS: Record<'MBA1' | 'MBA2', SrElection> = {
  // MBA1 (2026-28), Term II — already held 20–25 Sep 2026; kept so the page
  // keeps showing its closed state and results.
  MBA1: {
    term: TERM_2,
    nominationsOpenAt: new Date('2026-09-20T00:00:00+05:30'),
    nominationsCloseAt: new Date('2026-09-23T00:00:00+05:30'),
    votingCloseAt: new Date('2026-09-25T00:00:00+05:30'),
    excludedSubjects: [],
  },
  // MBA2 (2025-27), Term VI. Same rhythm as the Term II election: 2 days of
  // nominations, then 2 days of voting, each closing at midnight IST. Moved one
  // day later (from 28 Nov) to leave time to load the Capstone section list.
  // Before nominations open, all of these must exist in Supabase for 'Term VI'
  // (see supabase/sr-elections-term-vi/): subjects, sections, enrollments
  // (Capstone included), and the sr_votes_term_vi table.
  MBA2: {
    term: TERM_6,
    nominationsOpenAt: new Date('2026-11-29T00:00:00+05:30'),
    nominationsCloseAt: new Date('2026-12-01T00:00:00+05:30'),
    votingCloseAt: new Date('2026-12-03T00:00:00+05:30'),
    excludedSubjects: [],
    previousTerm: TERM_5,
  },
};

/** Which election applies to this student. Anyone not MBA1 gets MBA2's, like the rest of the portal. */
export function srElectionFor(cohort: string | null | undefined): SrElection {
  return cohort === 'MBA1' ? ELECTIONS.MBA1 : ELECTIONS.MBA2;
}

export function srPhase(election: SrElection, now: Date = new Date()): SrPhase {
  if (now < election.nominationsOpenAt) return 'before';
  if (now < election.nominationsCloseAt) return 'nominations';
  if (now < election.votingCloseAt) return 'voting';
  return 'closed';
}

/** "28 Nov, 12:00 am" in IST — for messages like "Nominations open on …". */
export function formatSrTime(d: Date): string {
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}
