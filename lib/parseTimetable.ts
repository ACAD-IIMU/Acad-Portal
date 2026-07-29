import * as XLSX from "xlsx";

export interface ParsedSession {
  subjectCode: string;      // normalized (A-Z0-9 only) for matching against `subjects`
  rawCode: string;          // original text, for logging
  sectionLabel: string | null;
  sessionNumber: number;
  room: string;
  sessionDate: string;      // YYYY-MM-DD
  startTime: string;        // HH:MM (from the fixed 6-slot header)
  endTime: string;
}

export interface UnmappedEntry {
  sessionDate: string;
  slotLabel: string;        // "Session 1", "Session 2", ...
  rawText: string;
  reason: string;
}

// The 6 fixed daily slots, read once from the header row (row 3) rather than hardcoded,
// so a future time-slot change in the sheet doesn't silently break the sync.
export interface TimeSlot {
  label: string;
  startTime: string;
  endTime: string;
}

// Matches: "{code}[ (section)][ -] S{n}[(DB)] (room)"
// Non-greedy .*? for the code group deliberately allows parens inside the code itself
// (e.g. "HRM(IR)") since section markers are constrained to a single uppercase letter.
const SESSION_RE =
  /^(.*?)\s*(?:\(([A-Z])\))?\s*-\s*S(\d+)(?:\(DB\))?\s*\(([^)]+)\)\s*$/;

const NO_CLASS_MARKERS = new Set(["---", "<=>", "", "--"]);

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** True only if the text's leading word is an actual month name (>= 3 letters) — deliberately
 * excludes short week labels like "W-1"/"W-12" regardless of digit count, and is tolerant of
 * whatever quote character (straight/curly/none) separates the month name from the year. */
function isMonthLabel(text: string): boolean {
  const m = text.match(/^([A-Za-z]{3,})/);
  if (!m) return false;
  return MONTH_NAMES[m[1].slice(0, 3).toLowerCase()] !== undefined;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Splits a cell's text into individual class entries (cells can hold several "/"-separated concurrent classes). */
function splitCellEntries(cellText: string): string[] {
  return cellText
    .split(/[\/\n]/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

function parseTimeRangeLabel(headerText: string): { startTime: string; endTime: string } | null {
  // e.g. "Session 1    9.00-10.30 am" -> extract "9.00-10.30 am"
  const m = headerText.match(/(\d{1,2}[.:]\d{2})\s*-\s*(\d{1,2}[.:]\d{2})\s*([ap]m)/i);
  if (!m) return null;
  const to24 = (t: string, meridiem: string) => {
    let [h, min] = t.replace(",", ".").split(/[.:]/).map(Number);
    const isPM = /pm/i.test(meridiem);
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  };
  return { startTime: to24(m[1], m[3]), endTime: to24(m[2], m[3]) };
}

export function parseTimetableWorkbook(buffer: Buffer): {
  sessions: ParsedSession[];
  unmapped: UnmappedEntry[];
  skippedStrikethrough: UnmappedEntry[];
} {
  // cellStyles + cellHTML needed to inspect strikethrough runs on individual cells
  const wb = XLSX.read(buffer, { type: "buffer", cellStyles: true, cellHTML: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws["!ref"]!);

  // Row 3 (0-indexed row 2) holds the 6 session headers in columns D-I (0-indexed 3-8)
  const slots: TimeSlot[] = [];
  for (let col = 3; col <= 8; col++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 2, c: col })];
    const text = (cell?.v ?? "").toString();
    const times = parseTimeRangeLabel(text);
    slots.push({
      label: `Session ${col - 2}`,
      startTime: times?.startTime ?? "00:00",
      endTime: times?.endTime ?? "00:00",
    });
  }

  const sessions: ParsedSession[] = [];
  const unmapped: UnmappedEntry[] = [];
  const skippedStrikethrough: UnmappedEntry[] = [];

  let currentMonthYear = ""; // column A is merged/blank on most rows — carry forward
  let currentYear = new Date().getFullYear();

  for (let row = 3; row <= range.e.r; row++) {
    const monthCell = ws[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (monthCell?.v) {
      const candidate = monthCell.v.toString().trim();
      // Column A mixes two label types: real month markers ("June '26", possibly with a
      // curly quote depending on how it was typed) and week markers ("W-1", "W-2", ...).
      // Checking against the actual month-name list (rather than matching a specific quote
      // character) avoids both false negatives (curly vs straight quote) and false positives
      // (a week label like "W-10"/"W-12" that happens to have 2 digits).
      if (isMonthLabel(candidate)) {
        currentMonthYear = candidate;
      }
    }

    const dateCell = ws[XLSX.utils.encode_cell({ r: row, c: 1 })];
    if (!dateCell?.v) continue; // blank date row — skip (covers the stray continuation rows like 54/71/89+)

    const dayNum = parseInt(dateCell.v.toString(), 10);
    if (isNaN(dayNum)) continue;

    const sessionDate = resolveDate(currentMonthYear, dayNum, currentYear);
    if (!sessionDate) {
      unmapped.push({
        sessionDate: "",
        slotLabel: "(date resolution)",
        rawText: `${currentMonthYear} / day ${dayNum}`,
        reason: "Could not resolve month/year for this row — check manually",
      });
      continue;
    }

    for (let col = 3; col <= 8; col++) {
      const cellAddr = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellAddr];
      if (!cell?.v) continue;
      const slot = slots[col - 3];
      const cellText = cell.v.toString();

      for (const entryText of splitCellEntries(cellText)) {
        if (NO_CLASS_MARKERS.has(entryText)) continue;

        // Strikethrough check: SheetJS exposes rich-text runs on cell.r when present.
        // A cancelled entry (struck through in the sheet) should not become a real session.
        if (isEntryStruckThrough(cell, entryText)) {
          skippedStrikethrough.push({
            sessionDate,
            slotLabel: slot.label,
            rawText: entryText,
            reason: "Struck through in source sheet — treated as cancelled, not imported",
          });
          continue;
        }

        const m = entryText.match(SESSION_RE);
        if (!m) {
          unmapped.push({
            sessionDate,
            slotLabel: slot.label,
            rawText: entryText,
            reason: "Did not match the standard '{code} (section) - Sn (room)' pattern — likely an exam/quiz/tutorial/one-off. Route manually to important_events or review.",
          });
          continue;
        }

        const [, rawCode, section, snStr, room] = m;
        sessions.push({
          subjectCode: normalizeCode(rawCode),
          rawCode: rawCode.trim(),
          sectionLabel: section ?? null,
          sessionNumber: parseInt(snStr, 10),
          room: room.trim(),
          sessionDate,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      }
    }
  }

  return { sessions, unmapped, skippedStrikethrough };
}

/** Best-effort strikethrough detection on a cell's rich-text runs matching the given entry text. */
function isEntryStruckThrough(cell: XLSX.CellObject, entryText: string): boolean {
  const runs = (cell as any).r as Array<{ t: string; s?: { strike?: boolean } }> | undefined;
  if (!runs) return false; // no rich-text run info available — can't tell, so don't block a real class on a guess
  for (const run of runs) {
    if (run.t && entryText.includes(run.t.trim()) && run.s?.strike) {
      return true;
    }
  }
  return false;
}

function resolveDate(monthYearLabel: string, day: number, fallbackYear: number): string | null {
  // e.g. "June '26" (or "June '26" with a curly quote, or no quote at all) — [^0-9]*
  // deliberately doesn't care what character (if any) sits between name and digits.
  const m = monthYearLabel.match(/([A-Za-z]{3,})[^0-9]*(\d{2,4})/);
  if (!m) return null;
  const monthNames: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthKey = m[1].slice(0, 3).toLowerCase();
  const month = monthNames[monthKey];
  if (!month) return null;
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
