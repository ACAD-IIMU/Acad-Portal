// app/planner/SmartGenerator.tsx
//
// Pick subjects (not sections) plus scheduling preferences; the generator
// enumerates every section combination, throws out the ones that clash, scores
// the survivors against the preferences and shows the best three.

'use client';

import { useMemo, useState } from 'react';
import type { PlannerData } from '@/lib/plannerTypes';
import {
  CREDIT_LIMIT,
  PREFERENCES,
  buildClashMatrix,
  comboCount,
  detectClashes,
  feasibilityFor,
  generate,
  prefMet,
  validCombosFor,
  truncate,
  type GenerationResult,
  type Lookups,
  type PrefId,
} from './plannerLogic';
import TimetableGrid from './TimetableGrid';

const BADGES = ['Best option', '2nd option', '3rd option'];

export default function SmartGenerator({
  data,
  lookups,
}: {
  data: PlannerData;
  lookups: Lookups;
}) {
  const [subjects, setSubjects] = useState<Set<string>>(new Set());
  const [prefs, setPrefs] = useState<Set<PrefId>>(new Set());
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [openPreview, setOpenPreview] = useState<number | null>(null);

  const usedCredits = useMemo(
    () => [...subjects].reduce((sum, s) => sum + lookups.creditsOf(s), 0),
    [subjects, lookups]
  );

  const pendingCombos = useMemo(
    () => (subjects.size ? comboCount(data, [...subjects]) : 0),
    [data, subjects]
  );

  // Pairwise compatibility graph — derived once per dataset, not per keystroke.
  const matrix = useMemo(() => buildClashMatrix(data), [data]);

  // Every clash-free timetable the current selection still permits. Recomputed
  // on each selection change; it's what both the disabled states and the
  // generator read from, so the picker can never lead into a dead end.
  const selectedList = useMemo(() => [...subjects], [subjects]);
  const validCombos = useMemo(
    () => validCombosFor(data, matrix, selectedList),
    [data, matrix, selectedList]
  );
  const feasibility = useMemo(
    () => feasibilityFor(data, matrix, selectedList, validCombos),
    [data, matrix, selectedList, validCombos]
  );

  function toggleSubject(subject: string) {
    setSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) {
        next.delete(subject);
      } else {
        // Hard-stop at the credit cap rather than letting a selection be built
        // that could never be registered.
        if (usedCredits + lookups.creditsOf(subject) > CREDIT_LIMIT) return prev;
        next.add(subject);
      }
      return next;
    });
    setResult(null);
  }

  function togglePref(id: PrefId) {
    setPrefs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setResult(null);
  }

  function run() {
    if (!subjects.size) return;
    setOpenPreview(null);
    setResult(generate(data, matrix, selectedList, prefs));
  }

  async function copyOption(index: number, combo: string[]) {
    const text = combo
      .map((code) => `${lookups.codeToSubject[code] ?? code} – ${code}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API is blocked outside a secure context — fall back to a
      // throwaway textarea so the button still does something useful.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  // Normalization bounds for the score bars. Seeded from the options themselves
  // rather than from 0 — the scores cluster near 1000, so folding a 0 into the
  // range would flatten every bar to roughly full width.
  const scores = result?.options.map((o) => o.score) ?? [];
  const maxScore = scores.length ? Math.max(...scores) : 0;
  const minScore = scores.length ? Math.min(...scores) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] gap-5 items-start">
      {/* ── Inputs ── */}
      <div className="flex flex-col gap-4">
        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-inkFaint uppercase tracking-wider">
              Subjects
            </h2>
            <span
              className={`text-xs font-mono font-semibold px-2 py-1 rounded-full ${
                usedCredits === 0
                  ? 'text-inkFaint bg-cream'
                  : usedCredits >= CREDIT_LIMIT
                  ? 'text-brand-800 bg-brand-50 border border-brand-100'
                  : 'text-inkSoft bg-cream'
              }`}
            >
              {usedCredits} / {CREDIT_LIMIT}
            </span>
          </div>

          <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto -mx-1 px-1">
            {lookups.subjects.map((subject) => {
              const selected = subjects.has(subject);
              const credits = lookups.creditsOf(subject);
              const wouldExceed = !selected && usedCredits + credits > CREDIT_LIMIT;

              // Every section of this subject collides with something already
              // chosen, so no clash-free timetable could include it. Blocked
              // outright rather than allowed and then silently dropped at
              // generation — that's what produced "nothing gets built".
              const { feasible, blockers } = feasibility[subject] ?? {
                feasible: true,
                blockers: [],
              };
              const clashBlocked = !selected && !feasible;
              const disabled = wouldExceed || clashBlocked;

              const reason = clashBlocked
                ? blockers.length
                  ? `Clashes with ${blockers.map((b) => truncate(b, 28)).join(', ')}`
                  : 'Clashes with your current selection'
                : wouldExceed
                ? 'Exceeds the credit limit'
                : null;

              return (
                <button
                  key={subject}
                  onClick={() => toggleSubject(subject)}
                  disabled={disabled}
                  title={reason ?? undefined}
                  className={`flex items-start gap-2 text-left p-2 rounded-lg border transition ${
                    selected
                      ? 'border-brand-700 bg-brand-50'
                      : clashBlocked
                      ? 'border-danger bg-danger-100 cursor-not-allowed'
                      : wouldExceed
                      ? 'border-line opacity-50 cursor-not-allowed'
                      : 'border-line hover:border-brand-100 hover:bg-cream'
                  }`}
                >
                  <span
                    className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center text-[10px] font-bold ${
                      selected
                        ? 'bg-brand-900 border-brand-900 text-white'
                        : clashBlocked
                        ? 'border-danger bg-white text-danger'
                        : 'border-line bg-white'
                    }`}
                  >
                    {selected ? '✓' : clashBlocked ? '!' : ''}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-[13px] font-semibold ${
                        clashBlocked ? 'text-danger' : 'text-ink'
                      }`}
                    >
                      {subject}
                    </span>
                    <span
                      className={`block text-[11px] ${
                        clashBlocked ? 'text-danger' : 'text-inkFaint'
                      }`}
                    >
                      {clashBlocked
                        ? reason
                        : `${(data.subject_sections[subject] ?? []).join(' / ')} · ${credits} cr${
                            wouldExceed ? ' · exceeds limit' : ''
                          }`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card p-4">
          <h2 className="text-xs font-semibold text-inkFaint uppercase tracking-wider mb-3">
            Preferences
          </h2>
          <div className="flex flex-col gap-1">
            {PREFERENCES.map((pref) => {
              const selected = prefs.has(pref.id);
              return (
                <button
                  key={pref.id}
                  onClick={() => togglePref(pref.id)}
                  className={`flex items-center gap-2 text-left p-2 rounded-lg border transition ${
                    selected
                      ? 'border-brand-700 bg-brand-50'
                      : 'border-line hover:border-brand-100 hover:bg-cream'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center text-[10px] font-bold ${
                      selected
                        ? 'bg-brand-900 border-brand-900 text-white'
                        : 'border-line bg-white'
                    }`}
                  >
                    {selected ? '✓' : ''}
                  </span>
                  <span className="text-[13px] text-ink">{pref.label}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={run}
            disabled={!subjects.size}
            className="mt-3 w-full text-[13px] font-semibold rounded-lg px-3 py-2.5 transition bg-brand-900 text-white hover:bg-brand-800 disabled:bg-line disabled:text-inkFaint disabled:cursor-not-allowed"
          >
            Generate timetable
          </button>

          {subjects.size > 0 && (
            <p className="mt-2 text-[11px] text-inkFaint text-center">
              {validCombos.length.toLocaleString()} clash-free timetable
              {validCombos.length === 1 ? '' : 's'} from{' '}
              {pendingCombos.toLocaleString()} combination
              {pendingCombos === 1 ? '' : 's'}
            </p>
          )}
        </section>
      </div>

      {/* ── Results ── */}
      <section className="min-w-0 flex flex-col gap-4">
        {!result && (
          <div className="card p-10 text-center">
            <div className="font-display font-semibold text-brand-950">Nothing generated yet</div>
            <p className="text-sm text-inkFaint mt-1">
              Choose your subjects and preferences, then hit Generate.
            </p>
          </div>
        )}

        {result?.tooManyCombos && (
          <div className="card p-4 border-danger bg-danger-100">
            <div className="font-display font-semibold text-danger text-sm">
              Too many combinations to check
            </div>
            <p className="text-xs text-inkSoft mt-1">
              That selection produces {result.totalCount.toLocaleString()} possibilities. Remove a
              subject or two — or fix a section manually in the Build tab — and try again.
            </p>
          </div>
        )}

        {result && !result.tooManyCombos && (
          <>
            {result.warnings.length > 0 && (
              <div className="card p-3 border-gold-500 bg-gold-100">
                <div className="font-display font-semibold text-gold-600 text-sm">
                  Some preferences can&apos;t be fully satisfied
                </div>
                <ul className="mt-1 text-xs text-inkSoft list-disc pl-4 space-y-0.5">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card p-3 text-xs text-inkSoft">
              Found <strong className="text-ink">{result.validCount}</strong> clash-free combination
              {result.validCount === 1 ? '' : 's'} out of{' '}
              <strong className="text-ink">{result.totalCount}</strong>.
              {result.validCount > 0
                ? ` Showing the top ${result.options.length}.`
                : ' No valid options.'}
            </div>

            {result.options.length === 0 && result.validCount === 0 && (
              <div className="card p-6 text-center text-sm text-inkFaint">
                Every section combination for these subjects has a scheduling clash. Try dropping
                one subject.
              </div>
            )}

            {result.options.map(({ combo, score }, index) => {
              const percent =
                maxScore === minScore
                  ? 100
                  : Math.round(((score - minScore) / (maxScore - minScore)) * 70 + 30);

              return (
                <article
                  key={combo.join('|')}
                  className={`card p-4 ${index === 0 ? 'border-brand-700' : ''}`}
                >
                  <header className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold px-2 py-1 rounded-full ${
                          index === 0
                            ? 'bg-brand-900 text-white'
                            : 'bg-cream text-inkSoft border border-line'
                        }`}
                      >
                        {BADGES[index]}
                      </span>
                      {index === 0 && (
                        <span className="text-[11px] font-semibold text-gold-600">Recommended</span>
                      )}
                    </div>
                    <button
                      onClick={() => copyOption(index, combo)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-line text-inkSoft hover:bg-cream transition"
                    >
                      {copiedIndex === index ? 'Copied' : 'Copy section list'}
                    </button>
                  </header>

                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {combo.map((code) => {
                      const subject = lookups.codeToSubject[code] ?? '';
                      const [bg, fg, accent] = lookups.colorOf(subject);
                      return (
                        <span
                          key={code}
                          className="text-[11px] font-bold px-2 py-1 rounded border-l-[3px]"
                          style={{ background: bg, color: fg, borderLeftColor: accent }}
                        >
                          {code}
                        </span>
                      );
                    })}
                  </div>

                  <div className="text-[11px] text-inkFaint leading-relaxed mb-2">
                    {combo.map((code) => (
                      <div key={code}>
                        {code} = {lookups.codeToSubject[code] ?? code}
                      </div>
                    ))}
                  </div>

                  {prefs.size > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {PREFERENCES.filter((p) => prefs.has(p.id)).map((p) => {
                        const met = prefMet(data, combo, p.id);
                        return (
                          <span
                            key={p.id}
                            className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${
                              met === true
                                ? 'bg-brand-50 text-brand-800 border-brand-100'
                                : 'bg-cream text-inkFaint border-line'
                            }`}
                          >
                            {met === true ? '✓ ' : met === false ? '~ ' : ''}
                            {p.label}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1.5 rounded-full bg-cream overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-700"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono text-inkFaint">{percent}%</span>
                  </div>

                  <button
                    onClick={() => setOpenPreview(openPreview === index ? null : index)}
                    className="mt-2 text-[11px] font-semibold text-brand-800 hover:underline"
                  >
                    {openPreview === index ? 'Hide timetable preview' : 'Show timetable preview'}
                  </button>

                  {openPreview === index && (
                    <div className="mt-3">
                      <TimetableGrid
                        data={data}
                        lookups={lookups}
                        codes={combo}
                        clashes={detectClashes(data, combo)}
                        compact
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </>
        )}
      </section>
    </div>
  );
}
