// lib/parseGridTimetable.ts
//
// Parser for MBA1's timetable shape. Confirmed by actually downloading and inspecting
// the real MBA1 Term-I sheet (exported from Google Sheets) before writing this — not
// guessed from the old route comment, which turned out to be wrong about WHY the two
// sheets need separate parsers. That comment said the difference was strikethrough
// format (cell-level vs rich-text runs). It isn't, really:
//
//   - Strikethrough: MBA1's sheet uses plain whole-cell styling (confirmed directly
//     against the raw XML — every struck cell is a shared-string with no rich-text
//     runs at all, its strike coming purely from the cell's own font style). That's
//     exactly the case buildStrikethroughMap()'s existing styleIndexStruck() fallback
//     already handles. No changes needed there — imported unchanged below.
//
//   - The REAL difference is the grid layout itself:
//       MBA2: one column per daily TIME SLOT (6 of them). A single cell can hold
//             several sections' classes at once, distinguished by "(A)"/"(B)" labels
//             *inside* the cell text, e.g. "MG (A) & (B) - S13(DB) (CR-8B-18)".
//       MBA1: one BLOCK of 5 columns per SECTION (5 sections: A-E), each block's 5
//             sub-columns being that section's own 5 daily time slots. The column
//             position itself tells you the section — cell text is just
//             "{code} {number}" (e.g. "FRA 1"), no "(A)"/"(B)" needed at all. Room is
//             fixed per section for the whole term (given once in the section's
//             header cell, e.g. "SECTION A, CLASSROOM 3A-01"), not per-class.
//     Forcing MBA1's cells through MBA2's "{code} (section) - S{n} (room)" regex
//     pipeline would never match anything — the grammar is genuinely different, not
//     a variant of the same one.
//
// Also confirmed directly against the real file (not assumed):
//   - No "/"-separated concurrent classes anywhere in MBA1's grid (MBA2 uses this for
//     e.g. two classes stacked in one slot) — so, unlike MBA2, this parser treats
//     each cell as exactly one entry. The one "/" match in the whole sheet is the
//     unrelated legend-table header text "Instructor/s".
//   - Two subjects (MOC, Excel) are frequently written with NO session number at all
//     in the early weeks (just "MOC", "Excel", "Excel - LAB") — these get a stable,
//     synthetic number derived from date + section + slot position, the same
//     technique lib/parseTimetable.ts already uses for MBA2's own named/unnumbered
//     one-off sessions (see SPECIAL_SESSION_NUMBER_BASE there). Also present: an
//     explicit "Cohort" split for these same two subjects later in the term (e.g.
//     "MOC Cohort -2 S - 6", "Excel cohort - 2 S - 6 LAB (CR-3A-01)") — handled by
//     encoding the cohort number into session_number (see COHORT_NUMBER_MULTIPLIER
//     below) so cohort 1 and cohort 2 meetings never collide even when they share a
//     nominal "S - N". FLAGGED: this cohort-numbering scheme is a considered default,
//     not a confirmed-correct one — worth a sanity check once real MOC/Excel rows are
//     visible in the DB, since I inferred the cohort-1/cohort-2 split from the sheet's
//     own text rather than from anyone who actually runs this course confirming it.
//   - The sheet also contains a subject legend table (Sr./Course Title/Credits/Code/
//     Instructor/s) starting after the last real class day — this parser stops before
//     it (see the "fully blank row" stop condition below), and does NOT attempt to
//     read it. That table is a good source for populating `subjects`/`sections` for
//     MBA1/Term I, but doing so is separate, not-yet-built work — this file only
//     produces sessions/events from the date grid, same contract as
//     parseTimetableWorkbook. sync-timetable/route.ts already assumes subjects/
//     sections exist before it runs; that assumption isn't satisfied for MBA1 yet.
//
// Reuses, unchanged (zero risk to the working MBA2 pipeline — nothing in
// parseTimetable.ts or strikethroughMap.ts was edited to build this):
//   - buildStrikethroughMap from strikethroughMap.ts
//   - normalizeCode / normalizeSheetName from parseTimetable.ts (already exported)
//   - ParsedSession / UnmappedEntry types from parseTimetable.ts (already exported)
// A few small pure helpers (month-label parsing, time-range parsing) are duplicated
// here rather than imported — same call parseEvents.ts already made for
// normalizeSheetName ("to avoid a circular import"); here it's to avoid any edit at
// all to the working MBA2 file, not just circularity.

import * as XLSX from "xlsx";
import { buildStrikethroughMap, CellStrikeInfo } from "./strikethroughMap";
import { normalizeCode, normalizeSheetName, ParsedSession, UnmappedEntry } from "./parseTimetable";

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Duplicated from parseTimetable.ts (see file header for why). */
function isMonthLabel(text: string): boolean {
  const m = text.match(/^([A-Za-z]{3,})/);
  if (!m) return false;
  return MONTH_NAMES[m[1].slice(0, 3).toLowerCase()] !== undefined;
}

/** Duplicated from parseTimetable.ts (see file header for why). */
function parseMonthYearLabel(label: string): { month: number; year: number } | null {
  const m = label.match(/([A-Za-z]{3,})[^0-9]*(\d{2,4})/);
  if (!m) return null;
  const monthKey = m[1].slice(0, 3).toLowerCase();
  const month = MONTH_NAMES[monthKey];
  if (!month) return null;
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  return { month, year };
}

/** Duplicated from parseTimetable.ts (see file header for why). Parses e.g.
 * "8:30 -\n10:00 am" -> {startTime:"08:30", endTime:"10:00"}. Handles the same
 * crosses-noon single-meridiem case ("10:15 -\n11:45 am" meaning AM-to-AM is fine,
 * but a range like "11:45 - 1:15 pm" means AM-to-PM despite one trailing "pm"). */
function parseTimeRangeLabel(headerText: string): { startTime: string; endTime: string } | null {
  const m = headerText.match(/(\d{1,2}[.:]\d{2})\s*-\s*(\d{1,2}[.:]\d{2})\s*([ap]m)/i);
  if (!m) return null;
  const toMinutes = (t: string, isPM: boolean) => {
    let [h, min] = t.replace(",", ".").split(/[.:]/).map(Number);
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return h * 60 + min;
  };
  const toHHMM = (totalMin: number) =>
    `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;

  const rangeIsPM = /pm/i.test(m[3]);
  const endMin = toMinutes(m[2], rangeIsPM);
  let startMin = toMinutes(m[1], rangeIsPM);
  if (startMin > endMin) {
    startMin = toMinutes(m[1], !rangeIsPM);
  }
  return { startTime: toHHMM(startMin), endTime: toHHMM(endMin) };
}

interface SectionGroup {
  label: string;       // e.g. "A"
  room: string | null; // e.g. "3A-01", from the header; null if unparseable
  startCol: number;     // 0-indexed, inclusive
  endCol: number;       // 0-indexed, inclusive
  slotTimes: Array<{ startTime: string; endTime: string }>; // one per column in the group
}

const NO_CLASS_MARKERS = new Set(["--", "---", ""]);

// Two subjects (MOC, Excel) recur across the term with no session number attached at
// all (see file header). Numbered the same way lib/parseTimetable.ts numbers its own
// named-but-unnumbered special sessions: derived purely from date + position, so a
// re-sync always reproduces the same number (stable identity for any attached
// preread), and starting far above any real session number so it can never collide
// with one. Distinct base from parseTimetable.ts's own 900000 — different table
// scope (MBA1 vs MBA2), kept distinct so the two are never confusable if ever
// compared side by side.
const UNNUMBERED_SESSION_BASE = 800000;

function unnumberedSessionNumber(sessionDate: string, sectionLabel: string, colIndexInGroup: number): number {
  const [, month, day] = sessionDate.split("-").map(Number);
  const sectionOrdinal = sectionLabel.toUpperCase().charCodeAt(0) - 64; // A=1, B=2, ...
  return UNNUMBERED_SESSION_BASE + month * 100000 + day * 1000 + sectionOrdinal * 10 + colIndexInGroup;
}

/** True only when EVERY column from 0 to lastCol is empty on this row -- confirmed
 * directly against the real file to be the actual, unique signal for "the date grid
 * has ended, the subject-legend table starts after this" (exactly one such row
 * exists, right before "Sr." / "Course Title"). Deliberately NOT "columns A-C are
 * blank" -- that pattern is COMMON mid-grid too (see isContinuationRow below) and
 * checking only A-C was an earlier bug in this file: it stopped the whole parse at
 * the very first such row (day 18 of the term), silently dropping everything after
 * it, including real strikethrough cancellations that only ever showed up later in
 * the term. */
function isRowCompletelyBlank(ws: XLSX.WorkSheet, row: number, lastCol: number): boolean {
  for (let col = 0; col <= lastCol; col++) {
    const v = ws[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
    if (v !== undefined && v !== null && v !== "") return false;
  }
  return true;
}

// Encodes an explicit "Cohort N" into the stored session_number so cohort 1's and
// cohort 2's meetings never collide even when the sheet gives them the same nominal
// "S - N" — e.g. "Excel cohort - 2 S - 6" -> 2 * 1000 + 6 = 2006. FLAGGED (see file
// header): this scheme is a considered default, not confirmed against how the course
// is actually run — worth a sanity check once real rows are visible.
const COHORT_NUMBER_MULTIPLIER = 1000;

const COHORT_RE =
  /^(.*?)\s*cohort\s*-?\s*(\d+)\s*S\s*-?\s*(\d+)\s*(LAB)?\s*(?:\(([^)]+)\))?$/i;

// Matches "FRA 1", "SM-1", "IGD 11" -- a bare subject code directly followed by its
// own real session number, optionally separated by a hyphen (Term-I tab uses a space,
// Term-II uses a hyphen -- both need to match without treating "-" as part of the code).
const NUMBERED_RE = /^([A-Za-z][A-Za-z]*)\s*-?\s*(\d+)\s*$/;

// End-Term exam week (confirmed directly: MBA1's Term I, roughly Sept 21-27) labels
// each exam day with the subject's FULL course title instead of any code or keyword
// at all -- e.g. "Financial Reporting and Analysis" sitting alone in Section A's
// first column, with every other section's column blank that day (it isn't really
// Section-A-specific, it's a whole-day note that happens to be written in that cell).
// Confirmed against the legend table embedded in this same sheet (rows 111-129).
// Hardcoded here rather than re-parsed from the legend at runtime -- a real option,
// just more code than this one narrow, confirmed case justifies right now. If a
// future term's legend renames a course, this map needs a matching manual update.
const EXAM_WEEK_FULL_TITLE_TO_CODE: Record<string, string> = {
  'financial reporting and analysis': 'FRA',
  'statistics for management': 'SM',
  'business ethics': 'BE',
  'individual and group dynamics': 'IGD',
  'microeconomics for managers': 'MEM',
  'marketing management': 'MM',
};

export interface EndTermExamEntry {
  subjectCode: string | null; // null for Capstone -- it isn't one of the 9 taught subjects
  eventDate: string;
  label: string; // pre-formatted, including the " — H:MM AM/PM" suffix when a time was found (see LABEL_TIME_SUFFIX_RE in lib/googleCalendar.ts) -- untimed (all-day) when not
}

// Loosely matches a time mention anywhere in a cell's text, e.g. "10 AM Onwards" or
// "1:30 PM onwards" -- only ONE exam day (Sept 21) and Capstone actually state a time
// anywhere in the row; the other 5 exam days don't, and are deliberately left as
// all-day events rather than guessing they share Sept 21's stated time.
const LOOSE_TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?/;
function extractLooseTime(text: string): string | null {
  const m = text.match(LOOSE_TIME_RE);
  if (!m) return null;
  const hour = m[1];
  const minute = m[2] ?? '00';
  const meridiem = m[3].toUpperCase() === 'A' ? 'AM' : 'PM';
  return `${hour}:${minute} ${meridiem}`;
}

// Matches a bare subject code with NO number at all, optionally with a trailing
// "- LAB" marker (e.g. "MOC", "Excel", "Excel - LAB"). The code itself is checked
// against an EXPLICIT allowlist below, not accepted on pattern shape alone -- a
// generic "any bare word" rule was tried first and confirmed (against the real file)
// to also swallow single-word holiday names like "Muharram", creating a fake session
// instead of routing it to the holiday/event classifier where it belongs. Same
// reasoning as parseTimetable.ts's own SPECIAL_SESSION_NAMES allowlist.
const BARE_CODE_RE = /^([A-Za-z]+)(?:\s*-\s*(LAB))?$/i;
const UNNUMBERED_SUBJECT_CODES = new Set(["MOC", "EXCEL"]); // confirmed directly -- the only two subjects seen bare anywhere in the real sheet

/** Finds the row (within the first maxScanRow rows) whose first three columns read
 * "Month"/"Date"/"Day" -- same signal parseTimetable.ts's findHeaderRow uses, not
 * imported from there (see file header) so this file makes zero edits to that
 * working, already-relied-on function. On MBA1's sheet, the SECTION header cells
 * live on this SAME row (columns D onward), unlike MBA2 where slot times get their
 * own separate row below the Month/Date/Day header -- see findSectionGroups below,
 * which reads columns from this exact row. */
function findGridHeaderRow(ws: XLSX.WorkSheet, maxScanRow: number): number {
  for (let r = 0; r <= maxScanRow; r++) {
    const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
    const b = ws[XLSX.utils.encode_cell({ r, c: 1 })]?.v;
    const c = ws[XLSX.utils.encode_cell({ r, c: 2 })]?.v;
    if (
      String(a ?? "").trim().toLowerCase() === "month" &&
      String(b ?? "").trim().toLowerCase() === "date" &&
      String(c ?? "").trim().toLowerCase() === "day"
    ) {
      return r;
    }
  }
  throw new Error(`Could not find header row ("Month"/"Date"/"Day") in the first ${maxScanRow + 1} rows.`);
}

/** Scans the header row from column 3 onward for "SECTION X, ... CLASSROOM ..." cells,
 * each marking the start of that section's column block. Group width is derived from
 * the gap to the next section header (or the end of the used range) rather than
 * hardcoded to 5, so a future term adding/removing a slot doesn't silently misread
 * columns the way a hardcoded width would. Per-column slot times come from the row
 * two below the header (the "Session \ntimings" row) -- read once per group and
 * cross-checked against every other group; a mismatch (a section secretly running a
 * different daily schedule) throws rather than silently using the first group's times
 * for everyone, matching this codebase's established fail-loud approach. */
function findSectionGroups(ws: XLSX.WorkSheet, headerRow: number, lastUsedCol: number): SectionGroup[] {
  const timingRow = headerRow + 2;
  const headerCells: Array<{ col: number; label: string; room: string | null }> = [];

  for (let col = 3; col <= lastUsedCol; col++) {
    const raw = ws[XLSX.utils.encode_cell({ r: headerRow, c: col })]?.v;
    if (!raw) continue;
    const text = raw.toString();
    const m = text.match(/SECTION\s+([A-Z])/i);
    if (!m) continue;
    const roomMatch = text.match(/CLASSROOM\s+([\w-]+)/i);
    headerCells.push({ col, label: m[1].toUpperCase(), room: roomMatch ? roomMatch[1] : null });
  }

  if (headerCells.length === 0) {
    throw new Error(`No "SECTION X" header cells found on row ${headerRow + 1} (columns D onward).`);
  }

  const groups: SectionGroup[] = [];
  let referenceSlotTimes: Array<{ startTime: string; endTime: string }> | null = null;

  for (let i = 0; i < headerCells.length; i++) {
    const startCol = headerCells[i].col;
    const endCol = i + 1 < headerCells.length ? headerCells[i + 1].col - 1 : lastUsedCol;

    const slotTimes: Array<{ startTime: string; endTime: string }> = [];
    for (let col = startCol; col <= endCol; col++) {
      const text = (ws[XLSX.utils.encode_cell({ r: timingRow, c: col })]?.v ?? "").toString();
      const parsed = parseTimeRangeLabel(text);
      slotTimes.push(parsed ?? { startTime: "00:00", endTime: "00:00" });
    }

    if (referenceSlotTimes === null) {
      referenceSlotTimes = slotTimes;
    } else if (JSON.stringify(slotTimes) !== JSON.stringify(referenceSlotTimes)) {
      throw new Error(
        `Section ${headerCells[i].label}'s daily slot times (row ${timingRow + 1}, cols ${startCol}-${endCol}) ` +
        `don't match Section ${headerCells[0].label}'s. Sections running genuinely different daily schedules ` +
        `need this function updated to handle it per-section rather than assuming one schedule for everyone.`
      );
    }

    groups.push({
      label: headerCells[i].label,
      room: headerCells[i].room,
      startCol,
      endCol,
      slotTimes,
    });
  }

  return groups;
}

export async function parseGridTimetableWorkbook(buffer: Buffer, targetTerm: string): Promise<{
  sessions: ParsedSession[];
  unmapped: UnmappedEntry[];
  skippedStrikethrough: UnmappedEntry[];
  endTermExams: EndTermExamEntry[];
}> {
  const wb = XLSX.read(buffer, { type: "buffer", cellStyles: true, cellHTML: true, cellDates: true });

  const normalizedTarget = normalizeSheetName(targetTerm);
  const matchedSheetName = wb.SheetNames.find((n) => normalizeSheetName(n) === normalizedTarget);
  if (!matchedSheetName) {
    throw new Error(
      `No sheet matching term "${targetTerm}" found. Available sheets: ${wb.SheetNames.join(", ")}`
    );
  }
  const ws = wb.Sheets[matchedSheetName];
  const range = XLSX.utils.decode_range(ws["!ref"]!);

  const strikeMap = await buildStrikethroughMap(buffer, targetTerm);

  const headerRow = findGridHeaderRow(ws, 10);
  const groups = findSectionGroups(ws, headerRow, range.e.c);
  const dataStartRow = headerRow + 3; // header row, "Session Number" row, "Session timings" row, then data

  const sessions: ParsedSession[] = [];
  const unmapped: UnmappedEntry[] = [];
  const skippedStrikethrough: UnmappedEntry[] = [];
  const endTermExams: EndTermExamEntry[] = [];

  let currentResolvedMonth: number | null = null;
  let currentResolvedYear: number | null = null;
  // Carries the last resolved date across "continuation" rows -- this sheet packs a
  // day's row-pair using a vertical merge on columns A-C (Month/Date/Day) but NOT on
  // the later section columns, exactly like MBA2's sheet: a merged cell's value only
  // lives in its top-left anchor, so the second row of the pair reads back genuinely
  // blank in A-C even though it still holds its own real, independent class further
  // right (confirmed directly: e.g. row 31 has blank A/B/C but a real "Reserved by
  // CDPO" entry in column H). Confirmed via isRowCompletelyBlank above that this is
  // different from the one true end-of-grid row, which is blank across EVERY column.
  let lastSessionDate: string | null = null;

  for (let row = dataStartRow; row <= range.e.r; row++) {
    if (isRowCompletelyBlank(ws, row, range.e.c)) break; // the real end of the date grid

    const monthCell = ws[XLSX.utils.encode_cell({ r: row, c: 0 })];
    const dateCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];

    if (monthCell?.v !== undefined && monthCell?.v !== null && monthCell?.v !== "") {
      if (monthCell.v instanceof Date) {
        currentResolvedMonth = monthCell.v.getUTCMonth() + 1;
        currentResolvedYear = monthCell.v.getUTCFullYear();
      } else {
        const candidate = monthCell.v.toString().trim();
        if (isMonthLabel(candidate)) {
          const parsed = parseMonthYearLabel(candidate);
          if (parsed) {
            currentResolvedMonth = parsed.month;
            currentResolvedYear = parsed.year;
          }
        }
      }
    }

    let sessionDate: string;
    if (dateCell?.v) {
      const dayNum = parseInt(dateCell.v.toString(), 10);
      if (isNaN(dayNum)) continue;
      if (currentResolvedMonth === null || currentResolvedYear === null) {
        unmapped.push({
          sessionDate: "",
          slotLabel: "(date resolution)",
          rawText: `day ${dayNum} — no month resolved yet for this row`,
          reason: "Could not resolve month/year for this row — check manually",
        });
        continue;
      }
      sessionDate = `${currentResolvedYear}-${String(currentResolvedMonth).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      lastSessionDate = sessionDate;
    } else {
      // Blank date cell on a row that ISN'T the end-of-grid boundary -- a
      // continuation row (see comment above). Carry the last resolved date forward
      // and keep scanning this row's section columns for real content.
      if (!lastSessionDate) continue; // no prior date to carry forward -- nothing safe to attribute this row to
      sessionDate = lastSessionDate;
    }

    // End-Term exam week check -- see EXAM_WEEK_FULL_TITLE_TO_CODE above. The whole-
    // day note always sits in the very first section's first slot column; checked
    // once per row here, before the normal per-cell loop, rather than letting that
    // cell fall through to it and land as a generic unmapped entry (which is what
    // was happening before this was added -- confirmed directly, not theoretical).
    const firstCellAddr = XLSX.utils.encode_cell({ r: row, c: groups[0].startCol });
    const firstCellRaw = ws[firstCellAddr]?.v;
    const firstCellText = firstCellRaw ? firstCellRaw.toString().replace(/\s+/g, ' ').trim() : '';
    const firstCellLower = firstCellText.toLowerCase();
    const examCode = EXAM_WEEK_FULL_TITLE_TO_CODE[firstCellLower];
    const isCapstone = firstCellLower.startsWith('capstone');

    if (examCode || isCapstone) {
      // A time mention can appear either in this same cell (Capstone: "Capstone Exam
      // (1:30 PM onwards)") or elsewhere in the row (Sept 21's separate "End-term
      // Examination, 10 AM Onwards" annotation, in a different section's column) --
      // checked across the whole row's used columns either way. Left untimed (all-
      // day) when no time is found anywhere in the row, rather than assuming every
      // exam day shares whichever day's time happened to be stated.
      let looseTime: string | null = extractLooseTime(firstCellText);
      if (!looseTime) {
        for (let col = 0; col <= range.e.c && !looseTime; col++) {
          const text = ws[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
          if (text) looseTime = extractLooseTime(text.toString());
        }
      }
      const baseLabel = isCapstone ? 'Capstone Exam' : `${examCode} End-Term Exam`;
      endTermExams.push({
        subjectCode: isCapstone ? null : examCode,
        eventDate: sessionDate,
        label: looseTime ? `${baseLabel} — ${looseTime}` : baseLabel,
      });
      continue; // whole row handled -- every other cell is confirmed blank on these rows
    }

    for (const group of groups) {
      for (let col = group.startCol; col <= group.endCol; col++) {
        const colIndexInGroup = col - group.startCol; // 0-indexed slot position within this section's day
        const cellAddr = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = ws[cellAddr];
        if (!cell?.v) continue;

        const rawCellText = cell.v.toString();
        const strikeInfo: CellStrikeInfo | undefined = strikeMap.get(cellAddr);
        const slotLabel = `Section ${group.label} · Slot ${colIndexInGroup + 1}`;

        if (strikeInfo?.fullyStruck) {
          skippedStrikethrough.push({
            sessionDate,
            slotLabel,
            rawText: rawCellText,
            reason: "Struck through in source sheet — treated as cancelled, not imported",
          });
          continue;
        }
        // MBA1's sheet was confirmed to have no rich-text runs at all (see file
        // header) -- a mixed-run cell isn't expected here, but if one ever appears,
        // fall back to the raw text rather than silently dropping the cell.
        const cellText = rawCellText.replace(/\s+/g, " ").trim();

        if (NO_CLASS_MARKERS.has(cellText)) continue;

        const slot = group.slotTimes[colIndexInGroup];

        const cohortMatch = cellText.match(COHORT_RE);
        if (cohortMatch) {
          const [, rawCode, cohortNumStr, sessionNumStr, labMarker, roomOverride] = cohortMatch;
          const subjectCode = normalizeCode(rawCode);
          const cohortNum = parseInt(cohortNumStr, 10);
          const sheetSessionNum = parseInt(sessionNumStr, 10);
          sessions.push({
            subjectCode,
            rawCode: rawCode.trim(),
            sectionLabel: group.label,
            sessionNumber: cohortNum * COHORT_NUMBER_MULTIPLIER + sheetSessionNum,
            room: roomOverride?.trim() || group.room,
            sessionDate,
            startTime: slot.startTime,
            endTime: slot.endTime,
            sessionLabel: `${rawCode.trim()} Cohort ${cohortNum}, Session ${sheetSessionNum}${labMarker ? " (LAB)" : ""}`,
          });
          continue;
        }

        const numberedMatch = cellText.match(NUMBERED_RE);
        if (numberedMatch) {
          const [, rawCode, sessionNumStr] = numberedMatch;
          sessions.push({
            subjectCode: normalizeCode(rawCode),
            rawCode: rawCode.trim(),
            sectionLabel: group.label,
            sessionNumber: parseInt(sessionNumStr, 10),
            room: group.room,
            sessionDate,
            startTime: slot.startTime,
            endTime: slot.endTime,
            sessionLabel: null,
          });
          continue;
        }

        const bareMatch = cellText.match(BARE_CODE_RE);
        if (bareMatch && UNNUMBERED_SUBJECT_CODES.has(normalizeCode(bareMatch[1]))) {
          const [, rawCode, labMarker] = bareMatch;
          sessions.push({
            subjectCode: normalizeCode(rawCode),
            rawCode: rawCode.trim(),
            sectionLabel: group.label,
            sessionNumber: unnumberedSessionNumber(sessionDate, group.label, colIndexInGroup),
            room: group.room,
            sessionDate,
            startTime: slot.startTime,
            endTime: slot.endTime,
            sessionLabel: labMarker ? `${rawCode.trim()} - LAB` : rawCode.trim(),
          });
          continue;
        }

        // Anything else -- Quiz/Tutorial/Briefing/Master Class/holiday/administrative
        // text -- isn't a class at all. Routed to `unmapped`, same as MBA2's parser;
        // extractEventsFromUnmapped (lib/parseEvents.ts, unchanged) picks up whatever
        // it already recognizes (Quiz, Tutorial, Additional Session, named holidays)
        // downstream in the sync route. Anything it doesn't recognize either (e.g.
        // "Briefing Session", "Master Class", "Paper Showing" -- none of these are in
        // parseEvents.ts's keyword lists yet) stays visible in the sync's own
        // `unmapped` response for manual review, not silently lost.
        unmapped.push({
          sessionDate,
          slotLabel,
          rawText: rawCellText,
          reason: "Did not match a known class-code pattern ('{code} {n}', a Cohort entry, or a bare unnumbered code) — likely an exam/quiz/tutorial/briefing/holiday one-off. Routed through the event classifier next.",
        });
      }
    }
  }

  return { sessions, unmapped, skippedStrikethrough, endTermExams };
}
