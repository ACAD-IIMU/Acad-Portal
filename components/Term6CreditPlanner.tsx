// components/Term6CreditPlanner.tsx
//
// Term VI credit planner on the EAP tab. Students type their own Term IV and
// Term V elective credits, tick any CIS, and say whether they were on STEP.
// Nothing is read from or written to the database: enrollments can't tell
// audited courses from credited ones, so self-entry is the reliable source.
// All rule logic lives in lib/eapCredits.ts.

'use client';

import { useState } from 'react';
import { computeTerm6Range, CREDIT_RULES } from '@/lib/eapCredits';

type Target = 60 | 64;

function parseCredits(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

function Stepper({
  id,
  value,
  onChange,
  label,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  invalid: boolean;
}) {
  const bump = (delta: number) => {
    const current = parseCredits(value) ?? 0;
    onChange(String(Math.max(0, current + delta)));
  };
  return (
    <div
      className={`flex rounded-lg border overflow-hidden bg-cream focus-within:ring-2 focus-within:ring-brand-700 ${
        invalid ? 'border-danger' : 'border-line'
      }`}
    >
      <button
        type="button"
        onClick={() => bump(-2)}
        aria-label={`Decrease ${label} by 2`}
        className="w-10 text-lg text-ink hover:bg-brand-50"
      >
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={40}
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 bg-transparent text-center font-mono text-lg py-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => bump(2)}
        aria-label={`Increase ${label} by 2`}
        className="w-10 text-lg text-ink hover:bg-brand-50"
      >
        +
      </button>
    </div>
  );
}

function CheckToggle({
  id,
  checked,
  onChange,
  label,
  tag,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tag?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-2.5 cursor-pointer rounded-lg border px-3 py-2.5 text-sm ${
        checked ? 'border-brand-700 bg-brand-50' : 'border-line bg-cream'
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-brand-700"
      />
      {label}
      {tag && <span className="ml-auto font-mono text-xs text-inkFaint">{tag}</span>}
    </label>
  );
}

export default function Term6CreditPlanner() {
  const [term4, setTerm4] = useState('');
  const [term5, setTerm5] = useState('');
  const [term4Cis, setTerm4Cis] = useState(false);
  const [term5Cis, setTerm5Cis] = useState(false);
  const [onStep, setOnStep] = useState(false);
  const [target, setTarget] = useState<Target>(64);

  const t4 = parseCredits(term4);
  const t5 = parseCredits(term5);
  const entered = t4 !== null && t5 !== null;

  const r = computeTerm6Range({
    term4Courses: t4 ?? 0,
    term4Cis,
    term5Courses: t5 ?? 0,
    term5Cis,
    onStep,
  });

  const showT4Error = t4 !== null && r.term4Errors.length > 0;
  const showT5Error = t5 !== null && r.term5Errors.length > 0;
  const ready = entered && r.valid;
  const headline = target === 60 ? r.term6Min : r.term6Max;

  // Bar scaled to the 64-credit maximum.
  const W = CREDIT_RULES.year.max;
  let left = W;
  const take = (n: number) => {
    const v = Math.max(0, Math.min(n, left));
    left -= v;
    return v;
  };
  const segs = [
    { w: take(t4 ?? 0), cls: 'bg-plum', label: String(t4 ?? 0) },
    { w: take(term4Cis ? 4 : 0), cls: 'bg-gold-500', label: 'CIS' },
    { w: take(t5 ?? 0), cls: 'bg-[#b5566b]', label: String(t5 ?? 0) },
    { w: take(term5Cis ? 4 : 0), cls: 'bg-gold-500', label: 'CIS' },
    { w: ready ? take(r.term6Min) : 0, cls: 'bg-brand-700', label: String(r.term6Min) },
  ];
  const optional = ready ? take(r.term6Max - r.term6Min) : 0;
  const pct = (n: number) => `${(n / W) * 100}%`;

  return (
    <div className="card p-6 mt-5">
      <div className="mb-4">
        <h2 className="text-base">Term VI credit planner</h2>
        <p className="text-sm text-inkSoft mt-1">
          Enter the elective credits you took in Terms IV and V, tick any Course of Independent Study, and choose
          your two-year target.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Term IV */}
        <fieldset className={`rounded-card border p-4 grid gap-3 ${showT4Error ? 'border-danger' : 'border-line'}`}>
          <legend className="px-1 text-sm font-semibold">
            Term IV{' '}
            <span className="font-mono font-medium text-inkFaint">
              · total {t4 === null ? '—' : r.term4Total} / 24–26
            </span>
          </legend>
          <div className="grid gap-1.5">
            <label htmlFor="planner-t4" className="text-sm font-medium">
              Elective course credits
            </label>
            <Stepper id="planner-t4" value={term4} onChange={setTerm4} label="Term IV credits" invalid={showT4Error} />
            <span className="text-xs text-inkFaint">Courses only, without CIS</span>
          </div>
          <CheckToggle id="planner-t4-cis" checked={term4Cis} onChange={setTerm4Cis} label="Did a CIS in Term IV" tag="+4" />
          {showT4Error && <p className="text-sm font-semibold text-danger">{r.term4Errors[0]}</p>}
        </fieldset>

        {/* Term V */}
        <fieldset className={`rounded-card border p-4 grid gap-3 ${showT5Error ? 'border-danger' : 'border-line'}`}>
          <legend className="px-1 text-sm font-semibold">
            Term V{' '}
            <span className="font-mono font-medium text-inkFaint">
              · total {t5 === null ? '—' : r.term5Total} / 18–22
            </span>
          </legend>
          <CheckToggle id="planner-step" checked={onStep} onChange={setOnStep} label="I was on STEP (exchange) in Term V" />
          <div className="grid gap-1.5">
            <label htmlFor="planner-t5" className="text-sm font-medium">
              {onStep ? 'Credits converted from exchange' : 'Elective course credits'}
            </label>
            <Stepper id="planner-t5" value={term5} onChange={setTerm5} label="Term V credits" invalid={showT5Error} />
            <span className="text-xs text-inkFaint">
              {onStep ? 'As per your learning agreement, up to 20' : 'Courses only, without CIS'}
            </span>
          </div>
          <CheckToggle id="planner-t5-cis" checked={term5Cis} onChange={setTerm5Cis} label="Did a CIS in Term V" tag="+4" />
          {showT5Error && <p className="text-sm font-semibold text-danger">{r.term5Errors[0]}</p>}
        </fieldset>
      </div>

      {/* Target */}
      <div className="mt-5">
        <div className="text-sm font-semibold mb-2" id="planner-target-label">
          Two-year credit target
        </div>
        <div role="group" aria-labelledby="planner-target-label" className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-cream border border-line">
          {([60, 64] as Target[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={target === t}
              onClick={() => setTarget(t)}
              className={`rounded-lg py-2.5 px-2 text-sm font-semibold grid gap-0.5 ${
                target === t ? 'bg-white shadow-sm text-brand-700' : 'text-ink'
              }`}
            >
              {t} credits
              <span className="text-xs font-normal text-inkFaint">{t === 60 ? 'Graduation minimum' : 'Maximum allowed'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      <div className="mt-6 grid gap-4" aria-live="polite">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <span className={`font-display text-6xl font-bold leading-none ${ready ? 'text-brand-700' : 'text-inkFaint'}`}>
              {ready ? headline : '—'}
            </span>
            <span className="text-sm text-inkSoft max-w-[36ch]">
              {!entered
                ? 'Enter your Term IV and Term V credits to see your Term VI range'
                : !r.valid
                  ? 'Fix the term totals above to see your Term VI range'
                  : target === 60
                    ? 'credits you must take in Term VI to reach the 60-credit minimum'
                    : 'credits you can take in Term VI to reach the 64-credit maximum'}
            </span>
          </div>
          <p className="text-xs text-inkFaint mt-2">Term VI credits include the 2-credit Capstone course.</p>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {[
            { k: 'Term IV + V', v: entered ? r.done : '—', sel: false },
            { k: 'Term VI minimum', v: ready ? r.term6Min : '—', sel: target === 60 },
            { k: 'Term VI maximum', v: ready ? r.term6Max : '—', sel: target === 64 },
          ].map((s) => (
            <div key={s.k} className={`border-t-2 pt-2 min-w-0 ${s.sel ? 'border-brand-700' : 'border-line'}`}>
              <div className="text-xs text-inkFaint">{s.k}</div>
              <div className="font-mono text-xl">{s.v}</div>
            </div>
          ))}
        </div>

        <div aria-hidden="true">
          <div className="flex h-7 rounded-lg overflow-hidden border border-line bg-cream">
            {segs.map((s, i) => (
              <div
                key={i}
                className={`${s.cls} h-full flex items-center justify-center text-white font-mono text-xs whitespace-nowrap overflow-hidden`}
                style={{ width: pct(s.w) }}
              >
                {s.w >= 3 ? s.label : ''}
              </div>
            ))}
            <div
              className="h-full flex items-center justify-center text-brand-700 font-mono text-xs bg-[repeating-linear-gradient(135deg,#f7e0e4_0_6px,transparent_6px_12px)]"
              style={{ width: pct(optional) }}
            >
              {optional >= 3 ? `+${optional}` : ''}
            </div>
          </div>
          <div className="relative h-4 font-mono text-[11px] text-inkFaint mt-1">
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2" style={{ left: pct(60) }}>
              60
            </span>
            <span className="absolute right-0">64</span>
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-inkFaint mt-1">
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 bg-plum align-[-1px]" />Term IV</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 bg-[#b5566b] align-[-1px]" />Term V</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 bg-gold-500 align-[-1px]" />CIS</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 bg-brand-700 align-[-1px]" />Term VI needed</span>
            <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 border border-brand-700 bg-brand-100 align-[-1px]" />Term VI optional</span>
          </div>
        </div>

        {entered && !r.valid && (
          <div className="rounded-lg bg-danger-100 px-3.5 py-3 text-sm">
            <b className="text-danger">Please correct your Term IV and Term V credits.</b>{' '}
            If your numbers are right, email acad.2025@iimu.ac.in.
          </div>
        )}
        {ready && (
          <div className="rounded-lg bg-[#e2f2e8] px-3.5 py-3 text-sm">
            <b className="text-[#1e7a4c]">
              Term VI range: {r.term6Min} to {r.term6Max} credits.
            </b>{' '}
            Take at least {r.term6Min} credits to reach 60, and at most {r.term6Max} to stay within 64.
            {onStep && ' STEP students cannot take extra Term VI courses to make up an exchange shortfall.'}
          </div>
        )}
      </div>
    </div>
  );
}
