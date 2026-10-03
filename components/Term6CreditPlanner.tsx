// components/Term6CreditPlanner.tsx
//
// Term VI credit planner on the EAP tab. Students type their own Term IV and
// Term V elective credits, tick any CIS, and say whether they were on STEP.
// Nothing is read from or written to the database: enrollments can't tell
// audited courses from credited ones, so self-entry is the reliable source.
// All rule logic lives in lib/eapCredits.ts.
//
// Layout: three numbered steps — 1 enter credits (two term cards), 2 pick the
// 60/64 target, 3 read the Term VI range.

'use client';

import { useState, type ReactNode } from 'react';
import { computeTerm6Range, CREDIT_RULES } from '@/lib/eapCredits';

type Target = 60 | 64;

function parseCredits(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

function StepHeading({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-800 text-white text-xs font-semibold">
        {n}
      </span>
      <h3 className="text-sm font-semibold text-ink">{children}</h3>
    </div>
  );
}

// The main number input: white, bordered in brand colour, large centred digits.
function CreditInput({
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
  const btn =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-cream text-xl text-brand-800 hover:bg-brand-100 hover:border-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700';
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border-2 bg-white px-2 py-2 shadow-sm transition focus-within:ring-4 ${
        invalid
          ? 'border-danger focus-within:ring-danger-100'
          : 'border-brand-700 focus-within:ring-brand-100'
      }`}
    >
      <button type="button" onClick={() => bump(-2)} aria-label={`Decrease ${label} by 2`} className={btn}>
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
        aria-invalid={invalid}
        className="flex-1 min-w-0 bg-transparent text-center font-display text-3xl font-semibold text-ink placeholder:text-inkFaint/50 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => bump(2)} aria-label={`Increase ${label} by 2`} className={btn}>
        +
      </button>
    </div>
  );
}

// Small pill-shaped checkbox, used for CIS and STEP.
function PillToggle({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-within:ring-2 focus-within:ring-brand-700 ${
        checked ? 'border-brand-700 bg-brand-700 text-white' : 'border-line bg-white text-inkSoft hover:border-brand-700'
      }`}
    >
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span aria-hidden="true">{checked ? '✓' : '+'}</span>
      {children}
    </label>
  );
}

function TermCard({
  title,
  range,
  total,
  entered,
  error,
  topRight,
  children,
}: {
  title: string;
  range: string;
  total: number;
  entered: boolean;
  error: string | null;
  topRight?: ReactNode;
  children: ReactNode;
}) {
  const badge = !entered
    ? 'bg-cream text-inkFaint'
    : error
      ? 'bg-danger-100 text-danger'
      : 'bg-[#e2f2e8] text-[#1e7a4c]';
  return (
    <section
      className={`relative rounded-card border bg-white p-5 grid gap-4 ${error ? 'border-danger' : 'border-line'}`}
    >
      {topRight && <div className="absolute right-3 top-3">{topRight}</div>}
      <div className="text-center">
        <div className="font-display text-xl font-semibold text-brand-950">{title}</div>
        <div className={`mt-1.5 inline-block rounded-full px-3 py-0.5 font-mono text-xs ${badge}`}>
          {entered ? `Total ${total}` : 'Total —'} · allowed {range}
        </div>
      </div>
      {children}
      {error && <p className="text-center text-sm font-semibold text-danger">{error}</p>}
    </section>
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

  const t4Error = t4 !== null && r.term4Errors.length > 0 ? r.term4Errors[0] : null;
  const t5Error = t5 !== null && r.term5Errors.length > 0 ? r.term5Errors[0] : null;
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
    <div className="card p-5 md:p-7">
      <div className="mb-6">
        <h2 className="text-lg">Term VI credit planner</h2>
        <p className="text-sm text-inkSoft mt-1 max-w-[65ch]">
          Find out how many credits you can take in Term VI. It takes three steps and nothing you enter is saved.
        </p>
      </div>

      {/* Step 1 */}
      <StepHeading n={1}>Enter the credits you took in Terms IV and V</StepHeading>
      <div className="grid gap-4 md:grid-cols-2">
        <TermCard title="Term IV" range="24–26" total={r.term4Total} entered={t4 !== null} error={t4Error}>
          <div className="grid gap-1.5">
            <label htmlFor="planner-t4" className="text-center text-xs font-semibold uppercase tracking-wide text-inkSoft">
              Elective course credits
            </label>
            <CreditInput id="planner-t4" value={term4} onChange={setTerm4} label="Term IV credits" invalid={!!t4Error} />
          </div>
          <div className="flex justify-center">
            <PillToggle id="planner-t4-cis" checked={term4Cis} onChange={setTerm4Cis}>
              I did a CIS (4 credits)
            </PillToggle>
          </div>
        </TermCard>

        <TermCard
          title="Term V"
          range={onStep ? '18–22 · STEP up to 20' : '18–22'}
          total={r.term5Total}
          entered={t5 !== null}
          error={t5Error}
          topRight={
            <PillToggle id="planner-step" checked={onStep} onChange={setOnStep}>
              STEP
            </PillToggle>
          }
        >
          <div className="grid gap-1.5">
            <label htmlFor="planner-t5" className="text-center text-xs font-semibold uppercase tracking-wide text-inkSoft">
              {onStep ? 'Credits converted from exchange' : 'Elective course credits'}
            </label>
            <CreditInput id="planner-t5" value={term5} onChange={setTerm5} label="Term V credits" invalid={!!t5Error} />
          </div>
          <div className="flex justify-center">
            <PillToggle id="planner-t5-cis" checked={term5Cis} onChange={setTerm5Cis}>
              I did a CIS (4 credits)
            </PillToggle>
          </div>
        </TermCard>
      </div>
      <p className="mt-2.5 text-center text-xs text-inkFaint">
        Enter course credits only, then tick CIS if you did one. Tick STEP if you were on exchange in Term V.
      </p>

      {/* Step 2 */}
      <div className="mt-7">
        <StepHeading n={2}>Choose your two-year credit target</StepHeading>
        <div role="group" aria-label="Two-year credit target" className="grid grid-cols-2 gap-2.5">
          {([60, 64] as Target[]).map((t) => {
            const on = target === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setTarget(t)}
                className={`rounded-xl border-2 px-3 py-3 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${
                  on ? 'border-brand-700 bg-brand-700 text-white shadow-sm' : 'border-line bg-white text-ink hover:border-brand-700'
                }`}
              >
                <div className="font-display text-lg font-semibold">{t} credits</div>
                <div className={`text-xs ${on ? 'text-brand-100' : 'text-inkFaint'}`}>
                  {t === 60 ? 'Graduation minimum' : 'Maximum allowed'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 3 */}
      <div className="mt-7" aria-live="polite">
        <StepHeading n={3}>Your Term VI credits</StepHeading>
        <div className="rounded-card border border-line bg-cream p-5 grid gap-5">
          <div className="text-center">
            <div className={`font-display text-6xl font-bold leading-none ${ready ? 'text-brand-700' : 'text-inkFaint'}`}>
              {ready ? headline : '—'}
            </div>
            <div className="mt-2 text-sm text-inkSoft">
              {!entered
                ? 'Enter your Term IV and Term V credits above'
                : !r.valid
                  ? 'Fix the highlighted term above to see your range'
                  : target === 60
                    ? 'credits you must take in Term VI to reach 60'
                    : 'credits you can take in Term VI to reach 64'}
            </div>
            <div className="mt-1 text-xs text-inkFaint">Term VI credits include the 2-credit Capstone course.</div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 text-center">
            {[
              { k: 'Term IV + V', v: entered ? r.done : '—', sel: false },
              { k: 'Term VI minimum', v: ready ? r.term6Min : '—', sel: target === 60 },
              { k: 'Term VI maximum', v: ready ? r.term6Max : '—', sel: target === 64 },
            ].map((s) => (
              <div
                key={s.k}
                className={`rounded-lg border bg-white px-2 py-2.5 min-w-0 ${s.sel ? 'border-brand-700' : 'border-line'}`}
              >
                <div className="text-[11px] text-inkFaint">{s.k}</div>
                <div className="font-mono text-xl">{s.v}</div>
              </div>
            ))}
          </div>

          <div aria-hidden="true">
            <div className="flex h-7 rounded-lg overflow-hidden border border-line bg-white">
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
            <div className="flex flex-wrap justify-center gap-x-3.5 gap-y-1 text-xs text-inkFaint mt-1">
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 bg-plum align-[-1px]" />Term IV</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 bg-[#b5566b] align-[-1px]" />Term V</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 bg-gold-500 align-[-1px]" />CIS</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 bg-brand-700 align-[-1px]" />Term VI needed</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 border border-brand-700 bg-brand-100 align-[-1px]" />Term VI optional</span>
            </div>
          </div>

          {entered && !r.valid && (
            <div className="rounded-lg bg-danger-100 px-3.5 py-3 text-sm text-center">
              <b className="text-danger">Please correct your Term IV and Term V credits.</b>{' '}
              If your numbers are right, email acad.2025@iimu.ac.in.
            </div>
          )}
          {ready && (
            <div className="rounded-lg bg-[#e2f2e8] px-3.5 py-3 text-sm text-center">
              <b className="text-[#1e7a4c]">
                Term VI range: {r.term6Min} to {r.term6Max} credits.
              </b>{' '}
              Take at least {r.term6Min} to reach 60, and at most {r.term6Max} to stay within 64.
              {onStep && ' STEP students cannot take extra Term VI courses to make up an exchange shortfall.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
