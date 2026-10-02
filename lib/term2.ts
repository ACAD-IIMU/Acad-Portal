// This is MBA1's (batch 2026-28) NEXT term — Term II, which MBA1 moves into once
// Term I ends (26 September 2026, per the source timetable's own title: "MBA
// 2026-28, Term-I timetable, 22nd June - 26th September, 2026"). Sibling to
// lib/term1.ts (MBA1's current, still-live term) and lib/term5.ts (MBA2's current
// term). See lib/term5.ts for why "current term" is split per cohort instead of
// one generic CURRENT_TERM constant — this file extends that same idea one step
// further: for MBA1, "the term about to start" and "the term live right now" are
// two different values needed by two different callers.
//
// Why this exists, and why it's a NEXT term rather than a current one: SR
// Elections has to run BEFORE the term it's electing for starts, so students
// have a representative from day one — you can't elect a Term II rep once
// Term II is already underway. This mirrors the existing pattern in
// app/eap/page.tsx, which deliberately does NOT import lib/term1.ts or
// lib/term5.ts — it tracks "the term being bid for" (current term + 1, the EAP
// N+1 rule) as its own local constant instead. TERM_2 makes that same
// "term we're preparing for" concept explicit and shared, since SR Elections
// needs it too and a second caller shouldn't have to redefine the EAP file's
// inline logic.
//
// UPDATE — Term I ended 26 Sep 2026 and MBA1's live calendar/timetable data has
// rolled over to Term II. sync-timetable (app/api/sync-timetable/route.ts),
// app/home/page.tsx, and lib/googleCalendar.ts now all import TERM_2 from here
// instead of lib/term1.ts's TERM_1 — so this file has quietly become MBA1's
// CURRENT term, not just the "next term" it started out as. app/sr-elections/
// page.tsx also still imports TERM_2, for a different, now-historical reason:
// it ran the Term II SR election while Term II was still ahead of MBA1. That
// election has since closed and sr_assignments is populated, so SR Elections'
// read of TERM_2 and the Home/sync-timetable/googleCalendar reads of TERM_2
// now coincide (both mean "Term II") rather than deliberately differing the
// way TERM_2-vs-TERM_1 used to.
//
// Known gap, carried over from before this file's meaning shifted:
// subjects/sections/enrollments for MBA1/Term II are now seeded in Supabase
// (derived from Term I's own enrollment rows), and sr_votes_term_ii was created
// manually, mirroring sr_votes_term_v — both already done for this cycle, but
// noted here since the vote table is an ad-hoc DB object this repo's
// migrations don't track.
//
// NEXT transition, not yet started: once MBA1 needs to elect Term III's SRs
// (ahead of Term II actually ending), create lib/term3.ts the same way this
// file was created from lib/term1.ts, and point app/sr-elections/page.tsx at
// TERM_3 instead of TERM_2 — at which point TERM_2 here goes back to meaning
// only "MBA1's current term" with no election-related reader left.
export const TERM_2 = 'Term II';
