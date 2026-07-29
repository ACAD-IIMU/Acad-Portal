import { UnmappedEntry } from "./parseTimetable";

export interface ParsedEvent {
  eventDate: string;
  type: "quiz" | "endterm" | "other";
  label: string;
  subjectCodeRaw: string | null;
}

// Recognizes Quiz / Mid Term Exam / End Term Exam mentions, possibly several in one string
// with no separator (e.g. "MoB Mid Term Exam and HRM(IR) End Term Exam => 3.30 pm").
const EVENT_RE =
  /([A-Za-z0-9:&.()]+(?:\s[A-Za-z0-9:&.()]+)*?)\s+(Quiz|Mid\s*Term\s*Exam|End\s*Term\s*Exam)\s*-?\s*(\d+)?/gi;

// End-of-term block shorthand: "MoB => 9.30 am", "CV & TS:ADR => 9.30 am"
const ARROW_EXAM_RE = /([A-Za-z0-9:&.()\s]+?)\s*=>\s*(\d{1,2}[.:]\d{2}\s*[ap]m)/gi;

// Other recognized one-off event types that don't have a Quiz/Exam keyword
const OTHER_EVENT_RE = /(Registration|Tutorial\s*\d*|Guest\s*Session|Additional\s*Session)/i;

function classifyType(keyword: string): "quiz" | "endterm" | "other" {
  const k = keyword.toLowerCase();
  if (k.includes("quiz")) return "quiz";
  // Both Mid Term and End Term map to 'endterm' — the schema only distinguishes
  // quiz/endterm/other, and both are significant proctored exams (vs. a quiz), so this
  // is the closer bucket. The label text itself still says "Mid Term" vs "End Term".
  if (k.includes("term exam")) return "endterm";
  return "other";
}

function extractEventsFromText(
  rawText: string
): Array<{ subjectCodeRaw: string | null; type: "quiz" | "endterm" | "other"; label: string }> {
  const events: Array<{ subjectCodeRaw: string | null; type: "quiz" | "endterm" | "other"; label: string }> = [];

  // Pass 1: Quiz / Mid Term Exam / End Term Exam, possibly multiple per string
  let m: RegExpExecArray | null;
  const re1 = new RegExp(EVENT_RE);
  while ((m = re1.exec(rawText)) !== null) {
    const code = m[1].trim();
    const keyword = m[2].replace(/\s+/g, " ").trim();
    const num = m[3];
    const type = classifyType(keyword);
    // Only Quiz labels get a trailing number (Quiz 1, Quiz 2...) — for Mid/End Term Exam
    // matches, the captured digit is just the leading digit of the time ("9.30 am"), not a
    // real instance number, so it must NOT be appended there.
    const label = type === "quiz" && num ? `${code} Quiz ${num}` : `${code} ${keyword}`;
    events.push({ subjectCodeRaw: code, type, label: label.trim() });
  }
  if (events.length > 0) return events;

  // Pass 2: end-of-term arrow shorthand, e.g. "MoB => 9.30 am", possibly multiple codes via "&"
  const re2 = new RegExp(ARROW_EXAM_RE);
  while ((m = re2.exec(rawText)) !== null) {
    const codes = m[1]
      .trim()
      .split(/\s*&\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    for (const code of codes) {
      events.push({ subjectCodeRaw: code, type: "endterm", label: `${code} End Term Exam` });
    }
  }
  if (events.length > 0) return events;

  // Pass 3: one-off named events — Registration needs no subject; Tutorial/Guest Session take
  // just the clean leading code (stop at the first paren, so "CB (A) (B) - S13" -> "CB", not
  // a mangled code dragging the section/session notation along).
  const otherMatch = rawText.match(OTHER_EVENT_RE);
  if (otherMatch) {
    const prefixRaw = rawText.slice(0, otherMatch.index).trim();
    const subjectCode = prefixRaw ? prefixRaw.split("(")[0].trim() : null;
    const eventName = otherMatch[1].replace(/\s+/g, " ").trim();
    const label = subjectCode ? `${subjectCode} ${eventName}` : eventName;
    events.push({ subjectCodeRaw: subjectCode || null, type: "other", label });
    return events;
  }

  return []; // genuinely not an event — e.g. the MG double-period notation, a stray timestamp fragment
}

/**
 * Splits the sync's `unmapped` list into real calendar events (quizzes, exams, tutorials,
 * registration, guest sessions) versus text that genuinely isn't an event at all — like the
 * MG joint-period notation that just failed to match the session pattern. Only the latter
 * stays "unmapped" for manual review; everything classified here is ready to insert into
 * `important_events`.
 */
export function extractEventsFromUnmapped(unmapped: UnmappedEntry[]): {
  events: ParsedEvent[];
  stillUnmapped: UnmappedEntry[];
} {
  const events: ParsedEvent[] = [];
  const stillUnmapped: UnmappedEntry[] = [];

  for (const entry of unmapped) {
    if (!entry.sessionDate) {
      // No resolvable date (e.g. the old month/year failures) — can't create an event without one.
      stillUnmapped.push(entry);
      continue;
    }
    const extracted = extractEventsFromText(entry.rawText);
    if (extracted.length === 0) {
      stillUnmapped.push(entry);
    } else {
      for (const e of extracted) {
        events.push({
          eventDate: entry.sessionDate,
          type: e.type,
          label: e.label,
          subjectCodeRaw: e.subjectCodeRaw
        });
      }
    }
  }

  return { events, stillUnmapped };
}
