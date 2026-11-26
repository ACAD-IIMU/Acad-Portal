// MBA2's (batch 2025-27) NEXT term — Term VI, 20 Dec 2026 – 6 Mar 2027.
//
// Same role lib/term2.ts once played for MBA1: SR Elections must run before the
// term it elects for, so app/sr-elections reads this (through lib/srElections.ts)
// while Home, timetable sync and calendars still read lib/term5.ts. When MBA2
// rolls over to Term VI, point those callers here too.
export const TERM_6 = 'Term VI';
