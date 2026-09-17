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
// single global term. Status of the 3 gaps that block MBA1 from working correctly —
// UPDATED after actually inspecting MBA1's real sheet and building against it (see
// lib/term1.ts and lib/parseGridTimetable.ts for the full detail; two things below
// turned out different from what was originally assumed here):
//   1. batch_label — DONE. Added to subjects/sections/sessions/important_events and
//      backfilled.
//   2. sync-timetable's single-batch design — DONE, batch-parameterized (?batch=
//      mba1|mba2). CORRECTION to what this comment used to say: the real difference
//      from MBA2's sheet isn't strikethrough format (MBA1 uses plain whole-cell
//      styling, which the existing buildStrikethroughMap already handled with zero
//      changes) — it's that MBA1's sheet is laid out as one column-BLOCK per section
//      instead of MBA2's one-column-per-slot-with-section-labels-inside-the-cell-
//      text, hence a genuinely separate parser (lib/parseGridTimetable.ts), not a
//      branch inside this one.
//   3. `app/home/page.tsx` has zero cohort filtering — still open, not touched yet.
// lib/term1.ts is MBA1's equivalent of this file.
//
// Note: `app/eap/page.tsx` intentionally does NOT import this. EAP tracks the term a
// student is *bidding for* (current term + 1, per the EAP N+1 rule) as its own local
// constant — a related but distinct concept, decoupled deliberately.
export const TERM_5 = 'Term V';
