// app/planner/PlannerClient.tsx
//
// Tab shell around the two planning modes. Everything below this point is
// client-side: the dataset is a static import, so no round trips are needed
// while the student experiments with selections.

'use client';

import { useMemo, useState } from 'react';
import type { PlannerData } from '@/lib/plannerTypes';
import { buildLookups } from './plannerLogic';
import ManualBuilder from './ManualBuilder';
import SmartGenerator from './SmartGenerator';

type Tab = 'manual' | 'smart';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'manual', label: 'Build my own', hint: 'Pick sections yourself and watch for overlaps' },
  { id: 'smart', label: 'Generate for me', hint: 'Set preferences and get ranked options' },
];

export default function PlannerClient({ data }: { data: PlannerData }) {
  const [tab, setTab] = useState<Tab>('manual');
  const lookups = useMemo(() => buildLookups(data), [data]);

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            title={t.hint}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition ${
              tab === t.id
                ? 'border-brand-700 text-brand-800'
                : 'border-transparent text-inkFaint hover:text-inkSoft'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Both trees stay mounted so switching tabs doesn't discard a selection
          or a generated result the student is still comparing against. */}
      <div className={tab === 'manual' ? '' : 'hidden'}>
        <ManualBuilder data={data} lookups={lookups} />
      </div>
      <div className={tab === 'smart' ? '' : 'hidden'}>
        <SmartGenerator data={data} lookups={lookups} />
      </div>
    </div>
  );
}
