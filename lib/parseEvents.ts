import { UnmappedEntry } from "./parseTimetable";

export interface ParsedEvent {
  eventDate: string;
  type: "quiz" | "endterm" | "other";
  label: string;
  subjectCodeRaw: string | null;
}

// Stage 1: bare keyword positions only — code, number, and time are all resolved
// afterward via explicit position-tracking (see below), not via regex leftmost-match
// behavior, which turned out to depend on accidental spacing quirks in the source data.
const KEYWORD_RE = /(Quiz|Mid\s*Term\s*Exam|End\s*Term\s*Exam)/gi;

// End-of-term block shorthand: "MoB => 9.30 am", "CV & TS:ADR => 9.30 am"
const ARROW_EXAM_RE = /([A-Za-z0-9:&.()\s]+?)\s*=>\s*(\d{1,2}[.:]\d{2}\s*[ap]m)/gi;

// Other recognized one-off event types that don't have a Quiz/Exam keyword
const OTHER_EVENT_RE = /(Registration|Tutorial\s*\d*|Guest\s*Session|Additional\s*Session)/i;

function classifyType(keyword: string): "quiz" | "endterm" | "other" {
  const k = keyword.toLowerCase();
  if (k.includes("quiz")) return "quiz";
  if (k.includes("term exam")) return "endterm";
  return "other";
}

/** Strips known leftover noise from the front of a code candidate — connector words,
 * dash separators, and time/range remnants that a neighboring event's own number or
 * time-range extraction didn't fully consume. Applied in a loop since these can stack
 * (e.g. a range's closing paren followed by a dash separator). */
function stripLeadingNoise(text: string): string {
  let prev: string;
  do {
    prev = text;
    text = text
      .replace(/^\s*\)/, "") // stray closing paren left over from a time range
      .replace(/^\s*-?\s*\d{1,2}[.:]\d{2}\s*[ap]m\)?/i, "") // leftover time / range end, e.g. "-3:15pm)"
      .replace(/^\s*-{2,}/, "") // dash separators like "-------"
      .replace(/^\s*(and)\b/i, "") // connector word
      .trim();
  } while (text !== prev);
  return text;
}

function extractEventsFromText(
  rawText: string
): Array<{ subjectCodeRaw: string | null; type: "quiz" | "endterm" | "other"; label: string }> {
  const keywordMatches = [...rawText.matchAll(new RegExp(KEYWORD_RE))];

  if (keywordMatches.length > 0) {
    const events: Array<{ subjectCodeRaw: string | null; type: "quiz" | "endterm" | "other"; label: string }> = [];
    let cursor = 0; // where the next event's code search starts — advances past each event's own consumed number+time

    for (let i = 0; i < keywordMatches.length; i++) {
      const kw = keywordMatches[i];
      const keyword = kw[1].replace(/\s+/g, " ").trim();
      const keywordStart = kw.index ?? 0;
      const keywordEnd = keywordStart + kw[0].length;

      const code = stripLeadingNoise(rawText.slice(cursor, keywordStart));

      // Tightly-bound instance number right after the keyword (e.g. "Quiz-1"), guarded
      // against misreading a clock time's leading digit as a number (e.g. the "2" in
      // "Quiz - 2.30 pm" is not instance number 2).
      const afterKeyword = rawText.slice(keywordEnd);
      const numMatch = afterKeyword.match(/^\s*-\s*(\d+)(?![.:]\d)/);
      const num = numMatch ? numMatch[1] : null;
      const consumedAfterKeyword = numMatch ? numMatch[0].length : 0;

      // Time: search only up to the NEXT keyword's start (or end of string) — never past
      // it, so a time or noise word belonging to the next event can't bleed into this one.
      const nextKeywordStart = i + 1 < keywordMatches.length ? keywordMatches[i + 1].index ?? rawText.length : rawText.length;
      const windowLen = nextKeywordStart - (keywordEnd + consumedAfterKeyword);
      const window = afterKeyword.slice(consumedAfterKeyword, consumedAfterKeyword + Math.max(0, windowLen));
      const timeMatch = window.match(/(\d{1,2})[.:](\d{2})\s*([ap]m)/i);
      const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3].toUpperCase()}` : null;
      const timeEnd = timeMatch ? (timeMatch.index ?? 0) + timeMatch[0].length : 0;

      // Advance the cursor past everything just consumed for THIS event (number + its
      // first time mention) — the noise-stripper above handles anything still left over
      // from a time range's closing half or a trailing separator.
      cursor = keywordEnd + consumedAfterKeyword + timeEnd;

      const type = classifyType(keyword);
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
