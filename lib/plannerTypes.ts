// lib/plannerTypes.ts
//
// Shape of the term-planner dataset produced by scripts/parse_term_planner.py
// from the "Term V" sheet of the MBA batch timetable workbook.
//
// This is deliberately a *separate* data path from the Supabase `sessions`
// table the rest of the portal reads. The planner answers a different question
// ("which section combinations are even possible?") and has to see every
// section of every course — not just the ones this student is enrolled in.

export type PlannerSlotKey = 's1' | 's2' | 's3' | 's4' | 's5' | 's6';

export interface PlannerSession {
  id: number;
  label: string;        // "9:00–10:30 am"
  slot_key: PlannerSlotKey;
}

export interface PlannerCourse {
  name: string;         // full course name, e.g. "Brand Management"
  credits: number;
  instructor: string;
}

export interface PlannerEntry {
  code: string;         // section code as printed in the sheet, e.g. "BM (A)"
  session_num: number;  // nth lecture of that course this term (not the time slot)
}

export interface PlannerDay {
  date: string;         // YYYY-MM-DD
  date_num: number;
  month: string;        // "June '26" — as written in column A
  week: string;         // "W-1"
  day: string;          // "Mon" … "Sun"
  slots: Partial<Record<PlannerSlotKey, PlannerEntry[]>>;
}

export interface PlannerData {
  term: string;                                   // "Term V"
  sessions: PlannerSession[];
  courses: Record<string, PlannerCourse>;         // section code -> course
  subject_sections: Record<string, string[]>;     // course name -> section codes
  timetable: PlannerDay[];
}

export interface Clash {
  date: string;
  day: string;
  slot: PlannerSlotKey;
  codes: string[];
}

/** Two selected sections landing in the same slot on the same day. */
export function detectClashes(data: PlannerData, codes: string[]): Clash[] {
  const set = new Set(codes);
  const out: Clash[] = [];
  for (const day of data.timetable) {
    for (const [slot, entries] of Object.entries(day.slots)) {
      const matching = (entries ?? []).filter((e) => set.has(e.code));
      if (matching.length >= 2) {
        out.push({
          date: day.date,
          day: day.day,
          slot: slot as PlannerSlotKey,
          codes: matching.map((e) => e.code),
        });
      }
    }
  }
  return out;
}
