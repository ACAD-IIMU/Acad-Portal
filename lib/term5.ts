// This is MBA2's (batch 2025-27) current term — Home month view, the timetable sync
// job, and the Google Calendar push for that cohort all read this one value.
//
// Named `term5`, not `currentTerm`, on purpose: "the current term" isn't a single
// app-wide fact. MBA1 and MBA2 are two different batches concurrently enrolled at all
// times (MBA1 = whoever's in Terms I-III, MBA2 = whoever's in Terms IV-VI), each
// sitting in its own term at any given moment. Right now that's MBA2 (2025-27) on
// Term V and MBA1 (2026-28) on Term II — a generic "CURRENT_TERM" constant would have
// silently meant "MBA2's term" while looking like it meant "the term", which is exactly
// how the sync job and Home page ended up hardcoded to a single batch with no cohort
// concept at all. `lib/term2.ts` (MBA1's current term) is the sibling file for that —
// add it the same way when MBA1's Term II calendar work starts.
//
// Update the line below each time MBA2 advances to a new term, until the
// admin-configurable "current term per cohort" setting (flagged in
// Data-Requirements-Log / Requirements Open Question 4) replaces this constant.
//
// IMPORTANT — this file alone does NOT make the app multi-cohort-aware. It only
// renames what was previously `lib/currentTerm.ts` so the naming stops implying a
// single global term. The actual gaps that block MBA1/Term II from working correctly
// are still open and unrelated to this rename:
//   1. `subjects`/`sections`/`sessions`/`important_events` have no `batch_label` column
//      — still scoped by `term` text alone, so MBA1 and MBA2 rows collide the moment
//      they ever share a term label (they don't yet, but will eventually).
//   2. `app/api/sync-timetable/route.ts` is single-batch by design — one hardcoded
//      FILE_ID, one TERM, no way to sync a second cohort's workbook. MBA1's sheet also
//      uses a different strikethrough format (cell-level, not the OOXML rich-text runs
//      MBA2's file needs), so the parser branches too, not just the input file.
//   3. `app/home/page.tsx` has zero cohort filtering — it queries sessions by term
//      alone, with no student-cohort join. An MBA1 student logging in today would see
//      MBA2's schedule, not their own.
// All three need solving before `lib/term2.ts` can actually serve MBA1 students —
// this file just stops the naming from getting in the way of that work.
//
// Note: `app/eap/page.tsx` intentionally does NOT import this. EAP tracks the term a
// student is *bidding for* (current term + 1, per the EAP N+1 rule) as its own local
// constant — a related but distinct concept, decoupled deliberately.
export const TERM_5 = 'Term V';
