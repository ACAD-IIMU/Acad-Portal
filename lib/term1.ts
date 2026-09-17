// This is MBA1's (batch 2026-28) current term — sibling to lib/term5.ts (MBA2's
// current term). See that file for why this is split by cohort instead of one
// generic CURRENT_TERM constant.
//
// MBA1 is on Term I now, moving to Term II next — per the source timetable's own
// title ("MBA 2026-28, Term-I timetable, 22nd June - 26th September, 2026") and
// confirmed directly, not assumed. Update the line below when that happens, same as
// TERM_5 gets updated for MBA2 each time it advances.
//
// term5.ts's comment (written before anyone had actually looked at MBA1's real
// sheet) lists 3 gaps blocking MBA1. Status, now that the sheet has actually been
// inspected and a working parser built and tested against it:
//   1. batch_label — DONE. Added to subjects/sections/sessions/important_events and
//      backfilled (see the batch_label_step*.sql migration).
//   2. sync-timetable's single-batch design — DONE, batch-parameterized. One
//      correction to the old assumption, though: the real difference from MBA2's
//      sheet isn't strikethrough format (MBA1 uses simple whole-cell styling, which
//      the existing buildStrikethroughMap already handled with zero changes) — it's
//      that MBA1's sheet is laid out as one column-BLOCK per section (5 sections ×
//      5 daily slots) rather than MBA2's one-column-per-slot with section labels
//      packed inside the cell text. See lib/parseGridTimetable.ts for the full
//      writeup, including two things worth a human sanity-check once real data is
//      visible: (a) the MOC/Excel "Cohort 1 vs Cohort 2" session-numbering scheme is
//      a considered default inferred from the sheet's own text, not confirmed by
//      whoever actually runs those two courses; (b) `subjects`/`sections` rows for
//      MBA1/Term I don't exist yet — this sync route can resolve sessions against
//      them only once something (not yet built) populates them, e.g. from the
//      subject-legend table embedded in the same sheet (Sr./Course Title/Credits/
//      Code/Instructor/s), the same way MBA2's "enrollment import" presumably did.
//   3. app/home/page.tsx cohort filtering — still open, not touched by this file.
export const TERM_1 = 'Term I';
