import { UnmappedEntry } from "./parseTimetable";

export interface ParsedEvent {
  eventDate: string;
  type: "quiz" | "endterm" | "other";
  label: string;
  subjectCodeRaw: string | null;
}

// Stage 1: just find WHERE each event keyword occurs (code + keyword only — number and
// time are extracted separately per match below, since a single mega-regex made it too easy
// for a trailing time's leading digit to get misread as a quiz instance number).
const KEYWORD_RE =
  /([A-Za-z0-9:&.()]+(?:\s[A-Za-z0-9:&.()]+)*?)\s+(Quiz|Mid\s*Term\s*Exam|End\s*Term\s*Exam)/gi;

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

/** Extracts, from the text between one event keyword and the next (or end of string): a real
 * instance number if present, and the first clock time if present — each scoped only to this
 * one event, so a combined string with several quizzes/exams doesn't cross-contaminate. */
function extractNumberAndTime(tailSlice: string): { num: string | null; time: string | null } {
  // A real instance number sits right after the keyword via a hyphen (spacing on either side
  // varies in the source — "Quiz-1" and "Quiz - 1" both occur) but must NOT be immediately
  // followed by a decimal point or colon + digit, which would mean it's actually the leading
  // digit of a clock time (e.g. the "2" in "Quiz - 2.30 pm" is not instance number 2).
  const numMatch = tailSlice.match(/^\s*-\s*(\d+)(?![.:]\d)/);
  const num = numMatch ? numMatch[1] : null;

  const timeMatch = tailSlice.match(/(\d{1,2})[.:](\d{2})\s*([ap]m)/i);
  const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3].toUpperCase()}` : null;

  return { num, time };
}

function extractEventsFromText(
  rawText: string
): Array<{ subjectCodeRaw: string | null; type: "quiz" | "endterm" | "other"; label: string }> {
  const keywordMatches = [...rawText.matchAll(new RegExp(KEYWORD_RE))];

  if (keywordMatches.length > 0) {
    const events: Array<{ subjectCodeRaw: string | null; type: "quiz" | "endterm" | "other"; label: string }> = [];
    for (let i = 0; i < keywordMatches.length; i++) {
      const m = keywordMatches[i];
      const code = m[1].trim();
      const keyword = m[2].replace(/\s+/g, " ").trim();
      const type = classifyType(keyword);
      const matchEnd = (m.index ?? 0) + m[0].length;
      const nextStart = i + 1 < keywordMatches.length ? keywordMatches[i + 1].index ?? rawText.length : rawText.length;
      const tailSlice = rawText.slice(matchEnd, nextStart);

      const { num, time } = extractNumberAndTime(tailSlice);
      let label = type === "quiz" && num ? `${code} Quiz ${num}` : `${code} ${keyword}`;
      if (time) label += ` — ${time}`;
      events.push({ subjectCodeRaw: code, type, label: label.trim() });
    }
    return events;
  }

  // Pass 2: end-of-term arrow shorthand, e.g. "MoB => 9.30 am", possibly multiple codes via "&"
  const events2: Array<{ subjectCodeRaw: string | null; type: "quiz" | "endterm" | "other"; label: string }> = [];
  let m: RegExpExecArray | null;
  const re2 = new RegExp(ARROW_EXAM_RE);
  while ((m = re2.exec(rawText)) !== null) {
    const codes = m[1]
      .trim()
      .split(/\s*&\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    for (const code of codes) {
      events2.push({ subjectCodeRaw: code, type: "endterm", label: `${code} End Term Exam` });
    }
  }
  if (events2.length > 0) return events2;

  // Pass 3: one-off named events — Registration needs no subject; Tutorial/Guest Session take
  // just the clean leading code (stop at the first paren, so "CB (A) (B) - S13" -> "CB", not
  // a mangled code dragging the section/session notation along).
  const otherMatch = rawText.match(OTHER_EVENT_RE);
  if (otherMatch) {
    const prefixRaw = rawText.slice(0, otherMatch.index).trim();
    const subjectCode = prefixRaw ? prefixRaw.split("(")[0].trim() : null;
    const eventName = otherMatch[1].replace(/\s+/g, " ").trim();
    const label = subjectCode ? `${subjectCode} ${eventName}` : eventName;
    return [{ subjectCodeRaw: subjectCode || null, type: "other", label }];
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
