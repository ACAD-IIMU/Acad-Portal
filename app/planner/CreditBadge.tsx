// app/planner/CreditBadge.tsx
//
// Elective credits picked so far against the student's Term VI range, shared by
// both planner tabs. Capstone isn't in `credits`: it's already in the budget.

import type { CreditBudget } from './plannerLogic';

export function CreditBadge({ credits, budget }: { credits: number; budget: CreditBudget }) {
  const short = budget.personal && credits < budget.min;
  const full = credits >= budget.max;
  const range = budget.personal && budget.min !== budget.max ? `${budget.min}–${budget.max}` : `${budget.max}`;

  return (
    <span
      className={`text-xs font-mono font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
        credits === 0
          ? 'text-inkFaint bg-cream'
          : short
          ? 'text-gold-600 bg-gold-100'
          : full
          ? 'text-danger bg-danger-100'
          : 'text-brand-800 bg-brand-50 border border-brand-100'
      }`}
    >
      {credits} / {range} cr
    </span>
  );
}

export function CreditHint({ credits, budget }: { credits: number; budget: CreditBudget }) {
  if (!budget.personal) {
    return (
      <p className="text-[11px] text-inkFaint mb-2">
        Fill in &ldquo;Your Term VI credits&rdquo; above to see your own range. Until then electives are
        capped at {budget.max}.
      </p>
    );
  }
  if (credits > budget.max) {
    return (
      <p className="text-[11px] text-danger mb-2">
        {credits - budget.max} credits over your maximum of {budget.max}. Remove a course.
      </p>
    );
  }
  if (credits < budget.min) {
    return (
      <p className="text-[11px] text-gold-600 mb-2">
        Add {budget.min - credits} more elective credit{budget.min - credits === 1 ? '' : 's'} to reach your
        minimum.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-inkSoft mb-2">
      {credits === budget.max
        ? 'You’ve reached your maximum.'
        : `Within your range. Up to ${budget.max - credits} more credits allowed.`}
    </p>
  );
}
