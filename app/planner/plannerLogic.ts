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

export const CREDIT_LIMIT = 22;

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
  codeToSubject: Record<string, string>;
  colorOf: (subject: string) => [string, string, string];
  creditsOf: (subject: string) => number;
};

export function buildLookups(data: PlannerData): Lookups {
  const subjects = Object.keys(data.subject_sections).sort();

  const colorIndex: Record<string, number> = {};
  subjects.forEach((s, i) => (colorIndex[s] = i % PALETTE.length));

  const codeToSubject: Record<string, string> = {};
  for (const [subject, codes] of Object.entries(data.subject_sections)) {
    codes.forEach((c) => (codeToSubject[c] = subject));
  }

  return {
    subjects,
    codeToSubject,
    colorOf: (subject) => PALETTE[colorIndex[subject] ?? 0],
    creditsOf: (subject) => {
      const first = data.subject_sections[subject]?.[0];
      return (first && data.courses[first]?.credits) || 0;
    },
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

export function slotLabel(data: PlannerData, slot: string): string {
  return data.sessions.find((s) => s.slot_key === slot)?.label ?? slot;
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
    const byDow: Record<string, number> = {};
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
