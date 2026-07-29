import * as XLSX from "xlsx";
import { buildStrikethroughMap, CellStrikeInfo } from "./strikethroughMap";

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

// Same core pattern as before, but NOT anchored to start/end — used with matchAll so a
// single chunk can yield zero, one, or several matches back-to-back (handles entries
// stacked without a real separator), and a soft line-wrap between the "- Sn" part and
// the "(room)" part (now normalized to a space) no longer breaks a normal single entry.
const SESSION_RE_GLOBAL =
  /(.*?)\s*(?:\(([A-Z])\))?\s*-\s*S(\d+)(?:\(DB\))?\s*\(([^)]+)\)/g;

// Joint-section pattern: e.g. "MG (A) & (B) - S13(DB) (CR-8B-18)" — both sections attend
// the same physical session together (seen recurring for MG roughly every 3-4 weeks).
// One match here becomes TWO session rows (one per section), same time/room/session number.
const JOINT_SECTION_RE =
  /(.*?)\s*\(([A-Z])\)\s*&\s*\(([A-Z])\)\s*-\s*S(\d+)(?:\(DB\))?\s*\(([^)]+)\)/g;

interface RawMatch {
  rawCode: string;
  section: string | null;
  sessionNumber: number;
  room: string;
}

function scanWithGlobalRegex(
  chunk: string,
  regex: RegExp,
  toMatches: (m: RegExpExecArray) => RawMatch[]
): { matches: RawMatch[]; leftover: string[] } {
  const matches: RawMatch[] = [];
  const leftover: string[] = [];
  let lastEnd = 0;
  const re = new RegExp(regex); // fresh instance — avoids shared lastIndex bugs across calls
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const between = chunk.slice(lastEnd, m.index).trim();
    if (between) leftover.push(between);
    matches.push(...toMatches(m));
    lastEnd = re.lastIndex;
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width matches
  }
  const tail = chunk.slice(lastEnd).trim();
  if (tail) leftover.push(tail);
  return { matches, leftover };
}

function extractSessionsFromChunk(chunk: string): { matches: RawMatch[]; leftover: string[] } {
  // Stage 1: joint-section pattern first, since it's a strict superset shape of the normal
  // one and would otherwise get mis-consumed by the single-section scan (the "&" and second
  // section would just get swallowed into a garbled rawCode instead of recognized as intentional).
  const stage1 = scanWithGlobalRegex(chunk, JOINT_SECTION_RE, (m) => {
    const [, rawCode, sec1, sec2, snStr, room] = m;
    const sessionNumber = parseInt(snStr, 10);
    return [
      { rawCode: rawCode.trim(), section: sec1, sessionNumber, room: room.trim() },
      { rawCode: rawCode.trim(), section: sec2, sessionNumber, room: room.trim() },
    ];
  });

  // Stage 2: normal single-section pattern, run on whatever stage 1 didn't claim.
  const matches = [...stage1.matches];
  const leftover: string[] = [];
  for (const piece of stage1.leftover) {
    const stage2 = scanWithGlobalRegex(piece, SESSION_RE_GLOBAL, (m) => [
      {
        rawCode: m[1].trim(),
        section: m[2] ?? null,
        sessionNumber: parseInt(m[3], 10),
        room: m[4].trim(),
      },
    ]);
    matches.push(...stage2.matches);
    leftover.push(...stage2.leftover);
  }

  return { matches, leftover };
}

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
/** Splits a cell's text on '/' — the sheet's one intentional separator between concurrent
 * classes. Newlines are deliberately NOT split on here (see extractSessionsFromChunk for why)
 * — they're normalized to spaces instead, since they're often just a soft line-wrap. */
function splitCellEntries(cellText: string): string[] {
  return cellText
    .split("/")
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

export async function parseTimetableWorkbook(buffer: Buffer): Promise<{
  sessions: ParsedSession[];
  unmapped: UnmappedEntry[];
  skippedStrikethrough: UnmappedEntry[];
}> {
  // cellStyles + cellHTML needed to inspect strikethrough runs on individual cells
  const wb = XLSX.read(buffer, { type: "buffer", cellStyles: true, cellHTML: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws["!ref"]!);

  // Verified separately (see strikethroughMap.ts) — xlsx/exceljs cannot reliably tell struck
  // text apart from normal text within a single cell, so this reads the raw file XML directly.
  const strikeMap = await buildStrikethroughMap(buffer);

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
      const rawCellText = cell.v.toString();

      const strikeInfo: CellStrikeInfo | undefined = strikeMap.get(cellAddr);
      let cellText: string;

      if (strikeInfo?.fullyStruck) {
        // Whole cell cancelled — log once and skip entirely, no session/event matching at all.
        skippedStrikethrough.push({
          sessionDate,
          slotLabel: slot.label,
          rawText: rawCellText,
          reason: "Struck through in source sheet — treated as cancelled, not imported",
        });
        continue;
      } else if (strikeInfo?.runs) {
        // Mixed cell: some runs struck (cancelled), some not. Strip the struck runs out
        // BEFORE splitting/matching, so a cancelled class doesn't get imported and doesn't
        // garble whatever quiz/tutorial/exam text sits next to it in the same cell.
        const keptParts: string[] = [];
        for (const run of strikeInfo.runs) {
          if (run.struck) {
            if (run.text.trim()) {
              skippedStrikethrough.push({
                sessionDate,
                slotLabel: slot.label,
                rawText: run.text.trim(),
                reason: "Struck through in source sheet — treated as cancelled, not imported",
              });
            }
          } else {
            keptParts.push(run.text);
          }
        }
        cellText = keptParts.join(" ");
      } else {
        cellText = rawCellText;
      }

      for (const entryText of splitCellEntries(cellText)) {
        if (NO_CLASS_MARKERS.has(entryText)) continue;

        const { matches, leftover } = extractSessionsFromChunk(entryText);

        for (const match of matches) {
          sessions.push({
            subjectCode: normalizeCode(match.rawCode),
            rawCode: match.rawCode,
            sectionLabel: match.section,
            sessionNumber: match.sessionNumber,
            room: match.room,
            sessionDate,
            startTime: slot.startTime,
            endTime: slot.endTime,
          });
        }

        for (const stray of leftover) {
          unmapped.push({
            sessionDate,
            slotLabel: slot.label,
            rawText: stray,
            reason: "Did not match the standard '{code} (section) - Sn (room)' pattern — likely an exam/quiz/tutorial/one-off. Route manually to important_events or review.",
          });
        }
      }
    }
  }

  return { sessions, unmapped, skippedStrikethrough };
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
