// app/planner/plannerLogic.ts
//
// Pure logic for the term planner — colours, clash detection, combination
// scoring. Kept free of React so it can be reasoned about (and tested) on its
// own; the components below only render what these functions return.

import type {
  Clash,
  PlannerData,
  PlannerDay,
  PlannerSlotKey,
} from '@/lib/plannerTypes';
import { detectClashes } from '@/lib/plannerTypes';

export { detectClashes };

// ── CREDIT BUDGET ──────────────────────────────────────────────────────────
// The elective range a student may pick, from the "Your Term VI credits" card
// (lib/eapCredits.ts computeTerm6Electives). Until they fill it in, the cap is
// the widest Term VI can be: 64 − (24 + 18 minimum for Terms IV–V) − 2 Capstone.
export interface CreditBudget {
  min: number;
  max: number;
  personal: boolean; // false = the fallback cap, not the student's own range
}

export const FALLBACK_BUDGET: CreditBudget = { min: 0, max: 20, personal: false };

// Capstone is compulsory: both tabs keep it selected, first in the list, and
// it can't be removed. Its 2 credits are already in the budget, so it never
// counts toward the elective total. Its section can still be changed.
export function isCapstone(subject: string): boolean {
  return /capstone/i.test(subject);
}

export type PrefId =
  | 'no_9am'
  | 'no_645pm'
  | 'free_weekends'
  | 'gap_days'
  | 'even_dist'
  | 'min_gaps';

export const PREFERENCES: { id: PrefId; label: string }[] = [
  { id: 'no_9am', label: 'No 9:00 am classes' },
  { id: 'no_645pm', label: 'No 6:45 pm classes' },
  { id: 'free_weekends', label: 'Free weekends' },
  { id: 'gap_days', label: 'Maximise gap days' },
  { id: 'even_dist', label: 'Evenly distributed classes' },
  { id: 'min_gaps', label: 'Minimise gaps between classes' },
];

const WEEKEND = new Set(['Sat', 'Sun']);
export const isWeekend = (day: string) => WEEKEND.has(day);

// ── COLOURS ────────────────────────────────────────────────────────────────
// [background, text, accent]. Assigned by stable alphabetical index rather than
// first-seen order, so a subject keeps the same colour no matter which tab or
// which generated option renders it first.
const PALETTE: [string, string, string][] = [
  ['#eff6ff', '#1d4ed8', '#3b82f6'], ['#f5f3ff', '#5b21b6', '#7c3aed'],
  ['#f0fdf4', '#15803d', '#22c55e'], ['#fff7ed', '#c2410c', '#f97316'],
  ['#fdf2f8', '#9d174d', '#ec4899'], ['#f0f9ff', '#0369a1', '#38bdf8'],
  ['#fefce8', '#a16207', '#eab308'], ['#f1f5f9', '#334155', '#64748b'],
  ['#fff1f2', '#be123c', '#f43f5e'], ['#ecfdf5', '#065f46', '#10b981'],
  ['#fdf4ff', '#6b21a8', '#a855f7'], ['#fff9f0', '#78350f', '#d97706'],
  ['#f0fdfa', '#0f766e', '#14b8a6'], ['#fff5f5', '#9b1c1c', '#f87171'],
  ['#f8faff', '#1e40af', '#60a5fa'], ['#fdf6ff', '#7c2d92', '#c026d3'],
  ['#f2fdf6', '#166534', '#4ade80'], ['#fffbf0', '#92400e', '#fb923c'],
  ['#f6f8ff', '#1e3a8a', '#93c5fd'], ['#fff0fb', '#831843', '#f472b6'],
  ['#f8fff4', '#14532d', '#86efac'], ['#f0f8ff', '#1c4f7c', '#7dd3fc'],
];

export type Lookups = {
  subjects: string[];                       // sorted course names
  exams: ExamItem[];                        // every exam in the sheet, matched to section codes
  codeToSubject: Record<string, string>;
  colorOf: (subject: string) => [string, string, string];
  creditsOf: (subject: string) => number;
  electiveCreditsOf: (subject: string) => number; // 0 for Capstone (already counted)
  required: string[];                       // always selected and can't be removed (Capstone)
};

export function buildLookups(data: PlannerData): Lookups {
  // Required courses first, then alphabetical.
  const subjects = Object.keys(data.subject_sections).sort(
    (a, b) => Number(isCapstone(b)) - Number(isCapstone(a)) || (a < b ? -1 : a > b ? 1 : 0)
  );

  const colorIndex: Record<string, number> = {};
  subjects.forEach((s, i) => (colorIndex[s] = i % PALETTE.length));

  const codeToSubject: Record<string, string> = {};
  for (const [subject, codes] of Object.entries(data.subject_sections)) {
    codes.forEach((c) => (codeToSubject[c] = subject));
  }

  const creditsOf = (subject: string) => {
    const first = data.subject_sections[subject]?.[0];
    return (first && data.courses[first]?.credits) || 0;
  };

  return {
    subjects,
    codeToSubject,
    colorOf: (subject) => PALETTE[colorIndex[subject] ?? 0],
    creditsOf,
    electiveCreditsOf: (subject) => (isCapstone(subject) ? 0 : creditsOf(subject)),
    required: subjects.filter(isCapstone),
    exams: buildExams(data),
  };
}

// ── FORMATTING ─────────────────────────────────────────────────────────────
const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string): string {
  const [, m, d] = iso.split('-');
  const month = MONTH_ABBR[parseInt(m, 10)];
  return month ? `${parseInt(d, 10)} ${month}` : iso;
}

// ── SELECTION COLOURS ──────────────────────────────────────────────────────
// Colours for the courses in one timetable, spread evenly over the colour wheel
// by how many there are — the home calendar's approach. Spreading over all 21
// courses instead let a student's six picks land on neighbouring hues (four
// greens in one test), which made the month view hard to read.
//
// Hues stay inside 40°–320°: the red band is kept for overlaps (and the ACAD
// crimson), so a red chip only ever means a clash. Alternate courses are a shade
// darker/lighter so neighbours on the wheel still separate.
export type ColorOf = (subject: string) => [string, string, string];

const GREY: [string, string, string] = ['#f1f5f9', '#334155', '#64748b'];

export function paletteFor(lookups: Lookups, codes: string[]): ColorOf {
  const picked = new Set(codes.map((c) => lookups.codeToSubject[c]).filter(Boolean));
  const ordered = lookups.subjects.filter((s) => picked.has(s));
  const n = ordered.length;
  const map: Record<string, [string, string, string]> = {};
  ordered.forEach((subject, i) => {
    const hue = Math.round(40 + ((i + 0.5) * 280) / Math.max(n, 1));
    const dark = i % 2 === 0;
    map[subject] = [
      `hsl(${hue} 70% 96%)`,
      `hsl(${hue} ${dark ? 65 : 55}% ${dark ? 30 : 40}%)`,
      `hsl(${hue} 65% 52%)`,
    ];
  });
  return (subject) => map[subject] ?? GREY;
}

export function slotLabel(data: PlannerData, slot: string): string {
  return data.sessions.find((s) => s.slot_key === slot)?.label ?? slot;
}

/** Start of a slot as a 12-hour time, "9:00–10:30 am" -> "9:00 AM",
 *  "12:30–2:00 pm" -> "12:30 PM", "3:00–4:30 pm" -> "3:00 PM". The label only
 *  carries the meridiem of the end time, so the start's is inferred from the
 *  hour: classes run 9 am – 8:15 pm, so 9–11 is morning and 12–8 is afternoon. */
export function slotStartTime(data: PlannerData, slot: string): string {
  const m = slotLabel(data, slot).match(/^(\d{1,2})[.:](\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h}:${m[2]} ${h >= 9 && h <= 11 ? 'AM' : 'PM'}`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ── SMART GENERATOR ────────────────────────────────────────────────────────

/** Cartesian product, guarded so a wide selection can't hang the browser. */
export function cartesian<T>(arrays: T[][], cap = 200_000): T[][] {
  const size = arrays.reduce((n, a) => n * a.length, 1);
  if (size > cap) return [];
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

/** Total combinations a selection implies — used to warn before enumerating. */
export function comboCount(data: PlannerData, subjects: string[]): number {
  return subjects.reduce(
    (n, s) => n * (data.subject_sections[s]?.length || 1),
    1
  );
}

function daysWithClasses(data: PlannerData, codes: Set<string>) {
  const out: { day: PlannerDay; slots: number[] }[] = [];
  for (const day of data.timetable) {
    const slots: number[] = [];
    for (const [slot, entries] of Object.entries(day.slots)) {
      if ((entries ?? []).some((e) => codes.has(e.code))) {
        slots.push(parseInt(slot[1], 10));
      }
    }
    if (slots.length) out.push({ day, slots });
  }
  return out;
}

/**
 * Every combination starts at 1000; preferences only ever move it relative to
 * its siblings, so the absolute number is meaningless — only the ranking is.
 */
export function scoreCombo(
  data: PlannerData,
  combo: string[],
  prefs: Set<PrefId>
): number {
  const codes = new Set(combo);
  const PENALTY = -50;
  const REWARD = 30;
  let score = 1000;

  const active = daysWithClasses(data, codes);
  const activeDates = new Set(active.map((a) => a.day.date));

  for (const { day, slots } of active) {
    if (prefs.has('no_9am') && slots.includes(1)) score += PENALTY;
    if (prefs.has('no_645pm') && slots.includes(6)) score += PENALTY;
    if (prefs.has('free_weekends') && isWeekend(day.day)) score += PENALTY * 2;
  }

  if (prefs.has('gap_days')) {
    for (const day of data.timetable) {
      if (!activeDates.has(day.date)) score += REWARD;
    }
  }

  if (prefs.has('even_dist')) {
    // Every day of the week the term has counts, including ones with no class
    // for this combo. Counting only busy days made a timetable piled onto two
    // weekdays look perfectly even.
    const byDow: Record<string, number> = {};
    for (const day of data.timetable) byDow[day.day] = 0;
    for (const { day, slots } of active) {
      byDow[day.day] = (byDow[day.day] ?? 0) + slots.length;
    }
    const vals = Object.values(byDow);
    if (vals.length > 1) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance =
        vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      score -= variance * 3;
    }
  }

  if (prefs.has('min_gaps')) {
    for (const { slots } of active) {
      if (slots.length < 2) continue;
      const uniq = [...new Set(slots)].sort((a, b) => a - b);
      const span = uniq[uniq.length - 1] - uniq[0];
      score -= (span - (uniq.length - 1)) * 10; // idle slots sandwiched between classes
    }
  }

  return score;
}

/** Does this section ever appear anywhere outside the given slot? */
function hasAlternativeToSlot(
  data: PlannerData,
  code: string,
  avoid: PlannerSlotKey
): boolean {
  return data.timetable.some((day) =>
    Object.entries(day.slots).some(
      ([slot, entries]) =>
        slot !== avoid && (entries ?? []).some((e) => e.code === code)
    )
  );
}

/**
 * Flags preferences that are arithmetically unsatisfiable for a given subject
 * — e.g. every one of its sections meets *only* at 9 am. Reported as a warning
 * rather than an error: generation still runs, the preference just can't win.
 */
export function checkImpossible(
  data: PlannerData,
  subjects: string[],
  prefs: Set<PrefId>
): string[] {
  const warnings: string[] = [];

  for (const subject of subjects) {
    const sections = data.subject_sections[subject] ?? [];
    if (!sections.length) continue;

    if (prefs.has('no_9am') &&
        sections.every((c) => !hasAlternativeToSlot(data, c, 's1'))) {
      warnings.push(`Cannot satisfy "No 9:00 am classes" — ${subject} only ever meets at 9:00 am`);
    }

    if (prefs.has('no_645pm') &&
        sections.every((c) => !hasAlternativeToSlot(data, c, 's6'))) {
      warnings.push(`Cannot satisfy "No 6:45 pm classes" — ${subject} only ever meets at 6:45 pm`);
    }

    if (prefs.has('free_weekends')) {
      const hasWeekday = sections.some((code) =>
        data.timetable.some(
          (d) =>
            !isWeekend(d.day) &&
            Object.values(d.slots).some((es) => (es ?? []).some((e) => e.code === code))
        )
      );
      if (!hasWeekday) {
        warnings.push(`Cannot satisfy "Free weekends" — ${subject} is only scheduled on weekends`);
      }
    }
  }

  return warnings;
}

/** Whether a finished combination actually honours a given preference. */
export function prefMet(
  data: PlannerData,
  combo: string[],
  pref: PrefId
): boolean | null {
  const codes = new Set(combo);
  const inSlot = (slot: PlannerSlotKey) =>
    data.timetable.some((d) => (d.slots[slot] ?? []).some((e) => codes.has(e.code)));

  if (pref === 'no_9am') return !inSlot('s1');
  if (pref === 'no_645pm') return !inSlot('s6');
  if (pref === 'free_weekends') {
    return !data.timetable.some(
      (d) =>
        isWeekend(d.day) &&
        Object.values(d.slots).some((es) => (es ?? []).some((e) => codes.has(e.code)))
    );
  }
  return null; // the remaining prefs are gradual, not pass/fail
}

/**
 * For a pass/fail preference a combination misses: how many days break it and
 * which sections cause that. Null when the preference is met or is gradual.
 */
export function prefShortfall(
  data: PlannerData,
  combo: string[],
  pref: PrefId
): { days: number; codes: string[] } | null {
  const codes = new Set(combo);
  const culprits = new Set<string>();
  let days = 0;

  for (const day of data.timetable) {
    let hit = false;
    for (const [slot, entries] of Object.entries(day.slots)) {
      const counts =
        pref === 'no_9am' ? slot === 's1'
        : pref === 'no_645pm' ? slot === 's6'
        : pref === 'free_weekends' ? isWeekend(day.day)
        : false;
      if (!counts) continue;
      for (const e of entries ?? []) {
        if (codes.has(e.code)) {
          culprits.add(e.code);
          hit = true;
        }
      }
    }
    if (hit) days++;
  }

  return days ? { days, codes: combo.filter((c) => culprits.has(c)) } : null;
}

export const SHORTFALL_TEXT: Partial<Record<PrefId, (days: number) => string>> = {
  no_9am: (n) => `${n} day${n === 1 ? '' : 's'} still ${n === 1 ? 'has' : 'have'} a 9:00 am class`,
  no_645pm: (n) => `${n} day${n === 1 ? '' : 's'} still ${n === 1 ? 'has' : 'have'} a 6:45 pm class`,
  free_weekends: (n) => `${n} weekend day${n === 1 ? '' : 's'} still ${n === 1 ? 'has' : 'have'} classes`,
};

// ── FEASIBILITY ────────────────────────────────────────────────────────────
// A clash is inherently pairwise: two sections clash iff they share a slot on
// some day, and a combination is clash-free iff every pair in it is. So the
// whole search collapses to a compatibility graph computed once per dataset,
// instead of re-scanning the 98-day timetable for every candidate combination.

export type ClashMatrix = Map<string, Set<string>>;

export function buildClashMatrix(data: PlannerData): ClashMatrix {
  const matrix: ClashMatrix = new Map();
  const link = (a: string, b: string) => {
    if (!matrix.has(a)) matrix.set(a, new Set());
    matrix.get(a)!.add(b);
  };

  for (const day of data.timetable) {
    for (const entries of Object.values(day.slots)) {
      const codes = [...new Set((entries ?? []).map((e) => e.code))];
      for (let i = 0; i < codes.length; i++) {
        for (let j = i + 1; j < codes.length; j++) {
          link(codes[i], codes[j]);
          link(codes[j], codes[i]);
        }
      }
    }
  }
  return matrix;
}

const compatible = (matrix: ClashMatrix, section: string, combo: string[]) =>
  !combo.some((code) => matrix.get(section)?.has(code));

/**
 * Every clash-free way to pick one section per subject, built incrementally so
 * infeasible branches die early rather than being enumerated and then filtered.
 */
export function validCombosFor(
  data: PlannerData,
  matrix: ClashMatrix,
  subjects: string[],
  cap = 50_000
): string[][] {
  let combos: string[][] = [[]];
  for (const subject of subjects) {
    const sections = data.subject_sections[subject] ?? [];
    const next: string[][] = [];
    for (const combo of combos) {
      for (const section of sections) {
        if (compatible(matrix, section, combo)) next.push([...combo, section]);
      }
    }
    if (next.length > cap) return next.slice(0, cap);
    combos = next;
    if (!combos.length) return []; // nothing downstream can rescue this
  }
  return combos;
}

export interface SubjectFeasibility {
  feasible: boolean;
  /** Selected subjects this one cannot coexist with, named where identifiable. */
  blockers: string[];
}

/**
 * For each subject, can it still be added to the current selection and leave at
 * least one clash-free timetable? Drives the disabled state in the picker, so a
 * student never assembles a selection that can't produce anything.
 */
export function feasibilityFor(
  data: PlannerData,
  matrix: ClashMatrix,
  selected: string[],
  validCombos: string[][]
): Record<string, SubjectFeasibility> {
  const out: Record<string, SubjectFeasibility> = {};

  for (const subject of Object.keys(data.subject_sections)) {
    if (selected.includes(subject)) {
      out[subject] = { feasible: true, blockers: [] };
      continue;
    }

    const sections = data.subject_sections[subject] ?? [];
    const feasible = validCombos.some((combo) =>
      sections.some((section) => compatible(matrix, section, combo))
    );

    if (feasible) {
      out[subject] = { feasible: true, blockers: [] };
      continue;
    }

    // Name the culprit where it's a clean one-to-one conflict. If no single
    // selected subject explains it, the clash only emerges from the combination
    // — reported as an empty list so the UI can word it differently.
    const blockers = selected.filter((other) => {
      const otherSections = data.subject_sections[other] ?? [];
      return !sections.some((section) =>
        otherSections.some((o) => compatible(matrix, section, [o]))
      );
    });

    out[subject] = { feasible: false, blockers };
  }

  return out;
}

export interface GeneratedOption {
  combo: string[];
  score: number;
}

export interface GenerationResult {
  options: GeneratedOption[];
  validCount: number;
  totalCount: number;
  warnings: string[];
  tooManyCombos: boolean;
}

export function generate(
  data: PlannerData,
  matrix: ClashMatrix,
  subjects: string[],
  prefs: Set<PrefId>,
  topN = 3
): GenerationResult {
  const warnings = checkImpossible(data, subjects, prefs);
  const total = comboCount(data, subjects);

  if (total > 200_000) {
    return { options: [], validCount: 0, totalCount: total, warnings, tooManyCombos: true };
  }

  // The picker already prevents an infeasible selection from being assembled,
  // so this is normally non-empty. Preferences never filter — they only score,
  // which is what lets a timetable still be built when a preference can't be
  // met (e.g. a subject that only ever meets at 9 am).
  const valid = validCombosFor(data, matrix, subjects);
  const options = valid
    .map((combo) => ({ combo, score: scoreCombo(data, combo, prefs) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return {
    options,
    validCount: valid.length,
    totalCount: total,
    warnings,
    tooManyCombos: false,
  };
}

export type { Clash, PlannerData };


// ── EXAMS ──────────────────────────────────────────────────────────────────
// The sheet writes exams as free text in the grid: "MA End Term Exam => 2.30 pm",
// "ERPS / FTM End Term Exam => 2.30 pm", "GTA (A) & (B) End Term Exam", and
// "LWDE: IS End Term Exam". Each is read into the section codes it applies to,
// so the calendar shows a student only the exams for the courses they picked.
//
// Mid-terms use the same path: Term VI's sheet has none, but the moment one is
// written as "<code> Mid Term Exam => <time>" (or Mid-Term / Midterm) and the
// parser is re-run, it shows up here with no further change.

export type ExamKind = 'endterm' | 'midterm' | 'exam';

export interface ExamItem {
  date: string;
  slot: string;
  kind: ExamKind;
  time: string;       // "2:30 PM" — from the text, else the slot's start
  codes: string[];    // section codes this exam is for
  text: string;       // as written in the sheet
}

export const EXAM_KIND_LABEL: Record<ExamKind, string> = {
  endterm: 'End Term',
  midterm: 'Mid Term',
  exam: 'Exam',
};

export const EXAM_KIND_ICON: Record<ExamKind, string> = {
  endterm: '🎓',
  midterm: '📝',
  exam: '📅',
};

const canonCode = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const baseOf = (code: string) => code.replace(/\s*\([^)]*\)\s*$/, '').trim();

export function buildExams(data: PlannerData): ExamItem[] {
  const byCode: Record<string, string> = {};
  const byBase: Record<string, string[]> = {};
  for (const code of Object.keys(data.courses)) {
    byCode[canonCode(code)] = code;
    (byBase[canonCode(baseOf(code))] ??= []).push(code);
  }

  const out: ExamItem[] = [];
  for (const exam of data.exams ?? []) {
    const [head, tail = ''] = exam.text.split('=>');
    const kindMatch = head.match(/\b(end|mid)[\s-]*term\b/i);
    const kind: ExamKind = !kindMatch ? 'exam' : /^mid/i.test(kindMatch[1]) ? 'midterm' : 'endterm';

    // Everything before "End Term" / "Mid Term" / "Exam" is the course list.
    const cut = kindMatch ? kindMatch.index! : head.search(/\bexams?\b/i);
    let prefix = (cut >= 0 ? head.slice(0, cut) : head).replace(/[\s:–-]+$/, '');
    // Occasionally the course comes after the label: "Mid Term Exam: BFC".
    if (!prefix && cut >= 0) {
      prefix = head
        .slice(cut)
        .replace(/^\s*((end|mid)[\s-]*terms?\s*)?(exams?)?\s*(tbd)?[\s:–-]*/i, '')
        .trim();
    }

    const codes: string[] = [];
    let previousBase = '';
    // "/" and "," always separate courses; "&" only with spaces round it, since
    // "B&M: D2C" and "M&S" are single codes.
    for (const raw of prefix.split(/\s*[\/,]\s*|\s+&\s+/)) {
      const part = raw.trim();
      if (!part) continue;
      // "GTA (A) & (B)": a bare "(B)" belongs to the course before it.
      const sectionOnly = part.match(/^\(([^)]+)\)$/);
      const candidate = sectionOnly && previousBase ? `${previousBase} (${sectionOnly[1]})` : part;
      const key = canonCode(candidate);
      if (byCode[key]) {
        codes.push(byCode[key]);
        previousBase = baseOf(byCode[key]);
      } else if (byBase[key]) {
        // "ADM End Term Exam" with ADM (A) and ADM (B) in the catalogue: both sections sit it.
        codes.push(...byBase[key]);
        previousBase = baseOf(byBase[key][0]);
      }
    }
    // An exam that matches no course is never shown — showing it to everyone
    // would put another course's exam on every student's calendar.
    if (!codes.length) continue;

    const t = tail.match(/(\d{1,2})[.:](\d{2})\s*([ap])\.?\s*m/i);
    const time = t
      ? `${Number(t[1])}:${t[2]} ${t[3].toUpperCase()}M`
      : slotStartTime(data, exam.slot);

    out.push({ date: exam.date, slot: exam.slot, kind, time, codes: [...new Set(codes)], text: exam.text });
  }
  return out;
}

/** Exams for the selected sections, labelled with the selected course codes
 *  only ("FTM End Term", not "ERPS / FTM End Term", for a student without ERPS). */
export function examsForSelection(
  exams: ExamItem[],
  codes: string[]
): (ExamItem & { label: string })[] {
  const selected = new Set(codes);
  return exams.flatMap((e) => {
    const mine = e.codes.filter((c) => selected.has(c));
    if (!mine.length) return [];
    const bases = [...new Set(mine.map(baseOf))].join(' & ');
    return [{ ...e, label: `${bases} ${EXAM_KIND_LABEL[e.kind]}` }];
  });
}
