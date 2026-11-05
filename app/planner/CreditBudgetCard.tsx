// app/planner/CreditBudgetCard.tsx
//
// "Your Term VI credits": the student enters the second-year credits they
// already have (Term IV + Term V, any CIS included) and whether they're taking
// a CIS this term. Capstone's 2 credits are always counted. The card then says
// how many elective credits to pick, and that range becomes the credit cap and
// target in both planner tabs. Rules live in lib/eapCredits.ts.

'use client';

import { CREDIT_RULES, type Term6Budget } from '@/lib/eapCredits';

export default function CreditBudgetCard({
  soFarRaw,
  onSoFarChange,
  term6Cis,
  onTerm6CisChange,
  budget,
}: {
  soFarRaw: string;
  onSoFarChange: (v: string) => void;
  term6Cis: boolean;
  onTerm6CisChange: (v: boolean) => void;
  budget: Term6Budget | null; // null until a number is entered
}) {
  const R = CREDIT_RULES;
  const soFar = parseInt(soFarRaw, 10);

  return (
    <section className="card p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-start gap-5">
        {/* ── Inputs ── */}
        <div className="flex-1 grid gap-3 min-w-0">
          <div>
            <h2 className="text-base">Your Term VI credits</h2>
            <p className="text-xs text-inkSoft mt-0.5 max-w-[60ch]">
              Your second year has to total {R.year.min}–{R.year.max} credits. Enter what you
              already have and the planner works out how many elective credits to take.
            </p>
          </div>

          <label className="grid gap-1">
            <span className="text-xs font-semibold text-inkSoft">
              Credits so far in the second year
              <span className="font-normal text-inkFaint"> (Term IV + Term V, any CIS included)</span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={2}
              value={soFarRaw}
              onChange={(e) => onSoFarChange(e.target.value)}
              placeholder="e.g. 44"
              aria-invalid={budget !== null && budget.errors.length > 0}
              className={`w-32 text-lg font-mono px-3 py-1.5 border-2 rounded-lg bg-white focus:outline-none ${
                budget && budget.errors.length ? 'border-danger' : 'border-line focus:border-brand-700'
              }`}
            />
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={term6Cis}
              onChange={(e) => onTerm6CisChange(e.target.checked)}
              className="w-4 h-4 accent-brand-800"
            />
            <span className="text-sm text-ink">
              I&apos;m taking a CIS in Term VI <span className="text-inkFaint">(+{R.cis} credits)</span>
            </span>
          </label>

          <div className="flex items-center gap-2.5 text-sm text-inkSoft">
            <span className="w-4 h-4 rounded bg-brand-900 text-white text-[10px] font-bold flex items-center justify-center">
              ✓
            </span>
            <span>
              Capstone Exercise{' '}
              <span className="text-inkFaint">(+{R.capstone} credits, counted for everyone)</span>
            </span>
          </div>
        </div>

        {/* ── Result ── */}
        <div
          aria-live="polite"
          className="md:w-72 rounded-card border border-line bg-cream p-4 text-center"
        >
          {budget === null ? (
            <p className="text-sm text-inkFaint py-4">
              Enter your credits so far to see how many elective credits to take.
            </p>
          ) : budget.errors.length ? (
            <p className="text-sm text-danger py-2">{budget.errors[0]}</p>
          ) : (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-inkSoft">
                Take this many elective credits
              </div>
              <div className="font-display text-5xl font-bold text-brand-700 leading-tight mt-1">
                {budget.electiveMin === budget.electiveMax
                  ? budget.electiveMax
                  : `${budget.electiveMin}–${budget.electiveMax}`}
              </div>
              <div className="text-xs text-inkFaint mt-1.5 font-mono">
                {soFar} so far + {budget.fixed} ({term6Cis ? 'Capstone + CIS' : 'Capstone'}) + electives
                = {R.year.min}–{R.year.max}
              </div>
              {budget.electiveMin === 0 && (
                <p className="text-xs text-inkSoft mt-2">
                  You already reach {R.year.min}, so electives are optional this term.
                </p>
              )}
              {budget.warnings.map((w) => (
                <p key={w} className="text-xs text-gold-600 mt-2">
                  {w}
                </p>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
