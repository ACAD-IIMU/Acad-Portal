# Term Planner

Lets a student assemble a clash-free elective timetable before bidding — either
by picking sections manually, or by declaring preferences and letting the app
rank the valid combinations.

Ported from the standalone `termplanner-main/index.html` prototype into a native
portal route: same logic, portal styling (Tailwind tokens + `Sidebar`), and
split into components so each piece is readable on its own.

## Files

```
app/planner/
├── page.tsx            # server component — sidebar, header, loads the dataset
├── PlannerClient.tsx   # tab shell (both tabs stay mounted; state survives switching)
├── ManualBuilder.tsx   # subject/section picker + clash banner + Excel export
├── SmartGenerator.tsx  # preference picker + ranked results
├── TimetableGrid.tsx   # the date × slot grid, shared by both tabs
└── plannerLogic.ts     # pure logic: colours, scoring, combination search

lib/plannerTypes.ts     # dataset shape + detectClashes()
data/termPlanner.json   # generated dataset (see below)
scripts/parse_term_planner.py
```

Current dataset: **Term V, 13 Sep – 19 Dec 2026** — 98 calendar days (73 with
classes), 27 sections across 22 courses, 26 exam entries.

## Regenerating the data each term

The planner reads a **static** dataset, not Supabase. That's deliberate: the
`sessions` table holds *this student's* enrolled classes, but the planner has to
see every section of every course to enumerate possible combinations — including
courses the student hasn't taken.

```bash
pip install openpyxl
python3 scripts/parse_term_planner.py "MBA 2025-27 Batch Timetable.xlsx" --term "Term V"
```

This overwrites `data/termPlanner.json`. Commit it and redeploy — the page is
statically rendered, so a rebuild is what publishes the new term.

If `data/termPlanner.json` still holds the empty placeholder, `/planner` renders
a "timetable data missing" notice with this command rather than an empty grid.

### Things the parser handles that would otherwise corrupt the data

Each of these is real in the Term V sheet and was found by running the parser
against it, not anticipated in advance.

- **Tab naming is inconsistent** — `Term-IV` is hyphenated, `Term V` is spaced.
  Sheets are matched on a normalized name, and it fails loudly if nothing
  matches instead of silently falling back to the first sheet.
- **Numbers arrive as floats.** Column B dates and the credit column come back
  as `13.0` / `4.0`, not ints. An `isinstance(x, int)` check silently discards
  the entire timetable.
- **Month labels are real dates.** Term V types column A as `datetime(2026, 9,
  26)` meaning "Sep '26" — the day component is noise. Term-IV typed them as
  text. Both are accepted, and the year always comes off the value rather than a
  hardcoded month→year table (which is what needed editing every rollover).
- **The catalogue and the grid spell codes differently** — catalogue `MSAIC(A)`
  vs grid `MSAIC (A)`. Matching is on a canonical form (uppercase, whitespace
  stripped); display keeps the sheet's own casing, so `ReM`/`RuM`/`ToC` don't
  get flattened to `REM`/`RUM`/`TOC`.
- **`SLM` is `SL`.** Strategic Leadership is written `SL` for sessions 1–4 and
  `SLM` for 5–10, with continuous numbering and a single `SL End Term Exam`.
  Handled via the explicit `ALIASES` map rather than fuzzy matching — a wrong
  guess here silently corrupts clash detection.
- **Malformed session numbers.** `CME (A) - S 10` has a stray space; `ASSAM -
  17` drops the `S` entirely. The bare-number fallback only fires when the
  prefix is already a known catalogue code, so `Registration 2:00 - 5:00 pm`
  can't be misread as a class in session 5.
- **Unnumbered classes.** `IMC - COIL Interaction` (×3) and `FT&IT - Additional
  Session` occupy a slot without a session number. They're stored with
  `session_num: 0` — they must count for clash detection.
- **Exams are not sessions.** `MSW End Term Exam => 9.30 am` and friends don't
  use the six normal slots. 26 of them are collected into a separate `exams`
  array so nothing is lost silently, but they're kept out of `slots` — the UI
  doesn't render them yet.
- **Joint sections** (`MG (A) & (B) - S13`) expand into two entries so the slot
  reads as occupied for either section. None occur in Term V; kept for Term-IV.

The parser reports three things to stderr: codes scheduled but missing from the
catalogue, catalogue codes never scheduled, and cell fragments it didn't read as
classes. On Term V the first two are empty and the third is exactly the five
holidays/notices (Diwali, Dussehra, Gandhi Jayanti, Solaris, Registration).
**If that list ever contains something that looks like a class, it's a bug.**

### Known gaps in the source sheet (not parser bugs)

- **CTO** has no `S14`, and `S9` appears twice (28 Oct and 9 Nov).
- **NGO** has no `S5` or `S6`.

Verified against the raw cells — the sheet really is written that way. Neither
affects the planner: session numbers are labels, and clash detection only cares
which slots a section occupies.

## Clash detection

Two selected sections in the same slot on the same day. That's the whole rule —
`detectClashes()` in `lib/plannerTypes.ts`. Recomputed on every selection change,
so the banner appears the instant a conflict exists.

## Scoring

Each valid combination starts at 1000; preferences only move it relative to its
siblings, so the absolute score is meaningless — only the ranking matters. The
displayed percentage is the score normalized across the shown options.

| Preference | Effect |
|---|---|
| No 9:00 am class | −50 per day with a class in `s1` |
| No 6:45 pm class | −50 per day with a class in `s6` |
| Free weekends | −100 per day with a Sat/Sun class |
| Maximise gap days | +30 per fully free day |
| Evenly distributed | −3 × variance of per-weekday class counts |
| Minimise gaps | −10 per idle slot sandwiched between classes |

`checkImpossible()` runs first and flags preferences that are arithmetically
unsatisfiable — e.g. every section of a course meets only at 9 am. That's shown
as a warning; generation still proceeds.

`cartesian()` refuses to enumerate past 200,000 combinations and the UI shows a
"too many combinations" message instead of freezing the tab.

## State

Manual selections persist in `localStorage` under `acad-planner-manual`, with
subjects/sections validated against the current dataset on load — so a leftover
Term IV selection doesn't reappear as a phantom row after the term rolls over.
