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
// IMPORTANT — this file does NOT mean MBA1's calendar, timetable sync, or Home
// page should switch to Term II yet. Term I is still the live, current term
// through 26 Sep 2026 — sync-timetable, app/home/page.tsx, and
// lib/googleCalendar.ts all correctly keep reading lib/term1.ts's TERM_1 for
// that. Only app/sr-elections/page.tsx reads TERM_2, and only for MBA1 —
// intentionally, since it's electing for the term ahead, not showing the term
// happening now.
//
// Known gap as of adding this file: subjects/sections/enrollments for
// MBA1/Term II do not exist in Supabase yet (Term I's own data was only
// recently populated, and Term II can't be seeded with real section/enrollment
// data until ACAD finalizes it for the new term). Until then, SR Elections'
// Nomination tab will show its "no enrollments yet" empty state for MBA1
// students — same gap Term I itself had before it was populated, now shifted
// one term forward. Also: voteTableForTerm('Term II') resolves to the physical
// table `sr_votes_term_ii` — that table does not exist in Supabase yet either
// and needs to be created (mirroring sr_votes_term_v) before MBA1's voting
// phase opens, same as Term I's own gaps had to be closed one by one before
// its data went live.
export const TERM_2 = 'Term II';
