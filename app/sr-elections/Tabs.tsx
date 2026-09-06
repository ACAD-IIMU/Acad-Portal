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
  results
}: {
  nomination: ReactNode;
  voting: ReactNode;
  results: ReactNode;
}) {
  const [active, setActive] = useState<Tab>('results');

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
