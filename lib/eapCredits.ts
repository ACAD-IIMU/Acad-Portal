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
//   - A CIS is always 4 credits, at most one per term. The guidelines say no CIS in
//     Term VI, but ACAD now allows one, so the Term Planner's budget
//     (computeTerm6Electives below) has a Term VI CIS option. The EAP card still
//     follows the guidelines.
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

// ── TERM VI ELECTIVE BUDGET (Term Planner) ─────────────────────────────────
// The student enters the second-year credits they already have (Term IV + Term V,
// CIS included) and whether they're taking a CIS in Term VI. Capstone (2) is
// counted for everyone. What's left of the 60–64 year total is the elective
// range they must pick in the planner.

export type Term6BudgetInput = {
  creditsSoFar: number;
  term6Cis: boolean;
};

export type Term6Budget = {
  fixed: number;        // Capstone + Term VI CIS, if any
  electiveMin: number;
  electiveMax: number;
  errors: string[];     // the range can't be used
  warnings: string[];   // the range is shown, but the input looks unusual
};

export function computeTerm6Electives(input: Term6BudgetInput): Term6Budget {
  const R = CREDIT_RULES;
  const fixed = R.capstone + (input.term6Cis ? R.cis : 0);
  const soFar = input.creditsSoFar;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isInteger(soFar) || soFar < 0) {
    errors.push('Enter a whole number of credits.');
  } else if (soFar % 2 !== 0) {
    errors.push('Enter an even number. Courses are 2 or 4 credits and a CIS is 4.');
  } else if (soFar + fixed > R.year.max) {
    errors.push(
      `${soFar} so far + ${fixed} in Term VI is ${soFar + fixed}, above the ${R.year.max}-credit second-year maximum.`
    );
  } else {
    const lo = R.term4.min + R.term5.min;
    const hi = R.term4.max + R.term5.max;
    if (soFar < lo || soFar > hi) {
      warnings.push(
        `Terms IV and V usually add up to ${lo}–${hi} credits. Check your number against your grade sheet.`
      );
    }
  }

  const electiveMin = Math.max(0, R.year.min - soFar - fixed);
  const electiveMax = Math.max(0, R.year.max - soFar - fixed);
  return { fixed, electiveMin, electiveMax, errors, warnings };
}
