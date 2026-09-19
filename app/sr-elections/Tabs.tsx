// app/sr-elections/Tabs.tsx
//
// Client-only tab switcher between Nomination, Voting, and Results. The tab
// contents themselves are server-rendered JSX passed in as props from
// page.tsx — this component only owns which one is currently visible.

'use client';

import { useState, type ReactNode } from 'react';

type Tab = 'nomination' | 'voting' | 'results';

const TABS: { id: Tab; label: string }[] = [
  { id: 'nomination', label: 'Nomination' },
  { id: 'voting', label: 'Voting' },
  { id: 'results', label: 'Results' }
];

export default function SrElectionsTabs({
  nomination,
  voting,
  results,
  showVotingAndResults = true
}: {
  nomination: ReactNode;
  voting: ReactNode;
  results: ReactNode;
  // When false, Voting/Results aren't rendered at all (not just hidden behind
  // a disabled tab) — page.tsx passes this for a batch+term where those
  // features have no real data behind them yet (e.g. MBA1/Term II — see the
  // comment where this is passed in page.tsx).
  showVotingAndResults?: boolean;
}) {
  // BUGFIX: this was hardcoded to 'results', so every visitor — including
  // someone who'd never nominated yet — landed on the Results tab first
  // instead of Nomination, the only tab a new visitor can actually act on.
  const [active, setActive] = useState<Tab>('nomination');

  if (!showVotingAndResults) {
    return <div className="flex flex-col gap-5">{nomination}</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="inline-flex w-fit rounded-full border border-line bg-cream p-1 gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            aria-selected={active === tab.id}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${
              active === tab.id
                ? 'bg-brand-700 text-white'
                : 'text-inkFaint hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'nomination' ? nomination : active === 'voting' ? voting : results}
    </div>
  );
}
