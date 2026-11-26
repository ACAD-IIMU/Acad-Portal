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
// Covers MBA1's Term I / Term II codes and MBA2's Term VI codes. Any other
// (term, code) pair -- e.g. MBA2's Term IV/V rows -- falls through unchanged
// via subjectDisplayName()'s fallback below, so this is safe to call on ANY
// subject name from ANY cohort/term.
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
    // Key is 'WAC', not 'WAC-II' — confirmed directly against the Term-II
    // timetable sheet's own session cells, which write the bare code "WAC"
    // (no "-II" suffix), unlike Term I's sheet which does write "WAC-I".
    // subjects.name for this row was corrected to match (see the Supabase
    // migration run alongside this edit) — keeping this file's key out of
    // sync with that rename would silently stop showing the full title again.
    WAC: 'Written Analysis for Communication-II'
  },
  // MBA2 (2025-27) Term VI — from the Term VI tab's course catalogue
  // (data/termPlanner.json). subjects.name for Term VI stores these codes,
  // like MBA1's terms, so timetable sync can match them.
  'Term VI': {
    ADM: 'Advanced Digital Marketing',
    BECON: 'Behavioral Economics',
    BSBAS: 'Building Successful Brand Architecture & Systems',
    'B&M: D2C': 'Building and Managing D2C Brands',
    BFC: 'Business Forecasting',
    CE: 'Capstone Exercise',
    DWV: 'Data Warehousing & Visualization',
    DPM: 'Digital Product Management',
    ERPS: 'ERP Systems: Technology Planning & Implementation',
    FIS: 'Fixed Income Securities',
    FTM: 'Forex and Treasury Management',
    GTA: 'Game Theory Applications',
    HF: 'Hedge Funds - History, Strategies and Market Practices',
    ICA: 'Industry & Competitor Analysis',
    IMS: 'International Marketing Strategy',
    'LWDE:IS': 'Leadership Wisdom for Decision Excellence: Insights from Scriptures',
    LGS: 'Logistics and Supply Chain Analytics',
    'M&S': 'Marketing & Society',
    MA: 'Marketing Analytics',
    MPBS: 'Multi-sided Platform Business Strategy',
    SF: 'Sustainable Finance'
  }
};

// Same loose match as timetable sync's normalizeCode() (lib/parseTimetable.ts,
// not imported here because it pulls in the xlsx parser): case, spaces and
// punctuation ignored, so 'B&M:D2C' finds 'B&M: D2C'.
const loose = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Returns the full descriptive subject title for a (code, term) pair if
 * known, otherwise returns `code` unchanged. Safe to call on any subject
 * name from any cohort/term -- an unrecognized code (e.g. any of MBA2's,
 * which already store full names) just passes through as-is.
 */
export function subjectDisplayName(code: string | null | undefined, term: string): string {
  if (!code) return '';
  const names = FULL_NAMES[term];
  if (!names) return code;
  if (names[code]) return names[code];
  const key = loose(code);
  const hit = Object.keys(names).find((k) => loose(k) === key);
  return hit ? names[hit] : code;
}
