// MBA1's (batch 2026-28) Term I — now a PAST term, not current. Term I ran
// 22 June - 26 September 2026 per the source timetable's own title; MBA1 has since
// rolled over to Term II. sync-timetable, app/home/page.tsx, and
// lib/googleCalendar.ts all switched to importing lib/term2.ts's TERM_2 instead of
// this file as part of that rollover — nothing in the app reads TERM_1 anymore.
// Kept around (not deleted) as a record of the term string and its dates, same
// reason completed terms generally aren't scrubbed from this codebase's comments.
// If this needs reviving as "the current term" meaning changes again, don't reuse
// it blindly — re-check which term is actually live first.
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
