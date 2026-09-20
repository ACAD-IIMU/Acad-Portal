// lib/subjectFullNames.ts
//
// subjects.name for MBA1 (batch 2026-28) stores the SHORT CODE only ('SM',
// 'OD', 'ICF', ...), not the full descriptive title -- by deliberate design:
// app/api/sync-timetable/route.ts's subjectByNormCode lookup normalize-
// matches against the timetable sheet's own cell codes, and a full title
// would never match those (confirmed decision -- see mba1_test_data.sql's
// own header comments for the same reasoning and the same mapping).
//
// This file exists purely to DISPLAY full names in the UI (SR Elections, so
// far) without changing what's actually stored in `subjects.name` -- nothing
// here is read by sync-timetable, normalizeCode(), or any other matching
// logic, so it's safe to edit freely without touching Supabase or breaking
// timetable sync.
//
// Codes are keyed by TERM as well as code, not code alone: 'SM' means
// "Statistics for Management" in Term I but "Strategic Management" in Term
// II -- the same short code, two unrelated real subjects. Source: the
// subject-legend table embedded in the MBA 2026-28 Batch Timetable workbook's
// own Term-I / Term-II tabs (Sr. / Course Title / Credits / Code /
// Instructor/s columns) -- read directly from that file, not guessed.
//
// Only covers MBA1's known Term I / Term II codes. Any other (term, code)
// pair -- including all of MBA2's, which already store full names in
// `subjects.name` and were never part of this short-code scheme -- falls
// through unchanged via subjectDisplayName()'s fallback below, so this is
// safe to call on ANY subject name from ANY cohort/term.
const FULL_NAMES: Record<string, Record<string, string>> = {
  'Term I': {
    FRA: 'Financial Reporting and Analysis',
    IGD: 'Individual and Group Dynamics',
    MM: 'Marketing Management',
    MEM: 'Microeconomics for Managers',
    SM: 'Statistics for Management',
    BE: 'Business Ethics',
    CE: 'Capstone',
    Excel: 'Excel',
    'WAC-I': 'Written Analysis for Communication – I',
    MOC: 'Managerial Oral Communication'
  },
  'Term II': {
    ICF: 'Introduction to Corporate Finance',
    SM: 'Strategic Management',
    ISPE: 'Indian Social and Political Environment',
    BL: 'Business Law',
    IDT: 'Introduction to Digital Technologies',
    OD: 'Organizational Dynamics',
    OM: 'Operations Management',
    OR: 'Operations Research',
    MBD: 'Macroeconomics for Business Decisions',
    'WAC-II': 'Written Analysis for Communication-II'
  }
};

/**
 * Returns the full descriptive subject title for a (code, term) pair if
 * known, otherwise returns `code` unchanged. Safe to call on any subject
 * name from any cohort/term -- an unrecognized code (e.g. any of MBA2's,
 * which already store full names) just passes through as-is.
 */
export function subjectDisplayName(code: string | null | undefined, term: string): string {
  if (!code) return '';
  return FULL_NAMES[term]?.[code] ?? code;
}
