// app/planner/PlannerClient.tsx
//
// Tab shell around the two planning modes, with the Term VI credit card above
// them. Everything below this point is client-side: the dataset is a static
// import, so no round trips are needed while the student experiments with
// selections.

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PlannerData } from '@/lib/plannerTypes';
import { computeTerm6Electives } from '@/lib/eapCredits';
import { FALLBACK_BUDGET, buildLookups, type CreditBudget } from './plannerLogic';
import CreditBudgetCard from './CreditBudgetCard';
import ManualBuilder from './ManualBuilder';
import SmartGenerator from './SmartGenerator';
import type { CalendarView } from './PlannerCalendar';

type Tab = 'manual' | 'smart';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'smart', label: 'Generate for me', hint: 'Set preferences and get ranked options' },
  { id: 'manual', label: 'Build my own', hint: 'Pick sections yourself and watch for overlaps' },
];

const CREDITS_KEY = 'acad-planner-credits';
const VIEW_KEY = 'acad-planner-view';

export default function PlannerClient({ data }: { data: PlannerData }) {
  const [tab, setTab] = useState<Tab>('smart');
  const lookups = useMemo(() => buildLookups(data), [data]);

  // ── Credit budget inputs, remembered on this device ──
  const [soFarRaw, setSoFarRaw] = useState('');
  const [term6Cis, setTerm6Cis] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Month (default) or List — shared by both tabs, remembered on this device.
  const [view, setView] = useState<CalendarView>('month');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === 'list' || saved === 'month') setView(saved);
    } catch {
      // storage unavailable: stay on the month view
    }
  }, []);
  function changeView(v: CalendarView) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // not worth failing over
    }
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CREDITS_KEY) ?? 'null');
      if (saved && typeof saved.soFar === 'string') setSoFarRaw(saved.soFar);
      if (saved && typeof saved.term6Cis === 'boolean') setTerm6Cis(saved.term6Cis);
    } catch {
      // unavailable or corrupt storage just means starting blank
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(CREDITS_KEY, JSON.stringify({ soFar: soFarRaw, term6Cis }));
    } catch {
      // not worth failing over
    }
  }, [soFarRaw, term6Cis, hydrated]);

  const term6 = useMemo(() => {
    if (soFarRaw.trim() === '') return null;
    return computeTerm6Electives({ creditsSoFar: Number(soFarRaw), term6Cis });
  }, [soFarRaw, term6Cis]);

  const budget: CreditBudget =
    term6 && term6.errors.length === 0
      ? { min: term6.electiveMin, max: term6.electiveMax, personal: true }
      : FALLBACK_BUDGET;

  return (
    <div className="flex flex-col gap-5">
      <CreditBudgetCard
        soFarRaw={soFarRaw}
        onSoFarChange={setSoFarRaw}
        term6Cis={term6Cis}
        onTerm6CisChange={setTerm6Cis}
        budget={term6}
      />

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
        <ManualBuilder data={data} lookups={lookups} budget={budget} view={view} onViewChange={changeView} />
      </div>
      <div className={tab === 'smart' ? '' : 'hidden'}>
        <SmartGenerator data={data} lookups={lookups} budget={budget} view={view} onViewChange={changeView} />
      </div>
    </div>
  );
}
