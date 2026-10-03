// lib/eapCredits.ts
//
// Term VI credit range for the EAP tab's credit planner
// (components/Term6CreditPlanner.tsx). Pure functions only, no I/O.
//
// Source: Program Guidelines 2026-27, Section 2.4 and Appendices 3 and 5.
//   - Term IV must total 24-26 credits, including any CIS.
//   - Term V must total 18-22 credits, including any CIS.
//   - STEP (exchange) students get at most 20 converted credits for Term V.
//   - The second year must total 60-64 credits. Term VI has no fixed minimum;
//     its range is whatever keeps the year between 60 and 64.
//   - A CIS is always 4 credits, at most one per term. Students can't take a CIS in Term VI.
//   - Every elective is 2 or 4 credits, so course credits must be even.
//   - The Term VI range includes the 2-credit Capstone course.

export const CREDIT_RULES = {
  term4: { min: 24, max: 26 },
  term5: { min: 18, max: 22 },
  stepTerm5Max: 20,
  year: { min: 60, max: 64 },
  cis: 4,
  capstone: 2,
} as const;

export type CreditInput = {
  term4Courses: number;
  term4Cis: boolean;
  term5Courses: number; // for STEP students: credits converted from the exchange term
  term5Cis: boolean;
  onStep: boolean;
};

export type CreditResult = {
  term4Total: number;
  term5Total: number;
  done: number;
  term4Errors: string[];
  term5Errors: string[];
  valid: boolean;
  term6Min: number; // only meaningful when valid
  term6Max: number; // only meaningful when valid
};

export function computeTerm6Range(input: CreditInput): CreditResult {
  const R = CREDIT_RULES;
  const term4Total = input.term4Courses + (input.term4Cis ? R.cis : 0);
  const term5Total = input.term5Courses + (input.term5Cis ? R.cis : 0);
  const done = term4Total + term5Total;

  const term4Errors: string[] = [];
  if (input.term4Courses % 2 !== 0) {
    term4Errors.push('Enter an even number. Courses are 2 or 4 credits.');
  } else if (term4Total < R.term4.min || term4Total > R.term4.max) {
    term4Errors.push(`Term IV must total ${R.term4.min}–${R.term4.max} including CIS. Yours is ${term4Total}.`);
  }

  const term5Errors: string[] = [];
  if (input.term5Courses % 2 !== 0) {
    term5Errors.push('Enter an even number. Courses are 2 or 4 credits.');
  } else if (input.onStep && input.term5Courses > R.stepTerm5Max) {
    term5Errors.push(`Exchange credit is capped at ${R.stepTerm5Max}.`);
  } else if (term5Total < R.term5.min || term5Total > R.term5.max) {
    term5Errors.push(`Term V must total ${R.term5.min}–${R.term5.max} including CIS. Yours is ${term5Total}.`);
  }

  const valid = term4Errors.length === 0 && term5Errors.length === 0;
  return {
    term4Total,
    term5Total,
    done,
    term4Errors,
    term5Errors,
    valid,
    term6Min: Math.max(0, R.year.min - done),
    term6Max: Math.max(0, R.year.max - done),
  };
}
