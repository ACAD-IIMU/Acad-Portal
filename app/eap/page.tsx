// app/eap/page.tsx
//
// Matches your real stack: sync createClient() from lib/supabase/server.ts,
// students joined via auth_user_id, term stored as text ('Term IV'/'Term V'),
// styled with the same Tailwind tokens (brand/gold/plum/ink/line/danger) and
// the existing .card class as TodaysClasses.tsx / UserMenu.tsx. Sidebar wraps
// every return path so it's always visible, even on error/empty states.
//
// Update these two each term — same hardcoding pattern Home uses for
// TERM_START/TERM_END, since there's no current_term column anywhere yet.
const CURRENT_TERM = 'Term IV';
const BIDDING_TERM = 'Term V'; // the term being bid FOR — one ahead of CURRENT_TERM

import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';
import type { ReactNode } from 'react';

type EapPointsRow = {
  fixed: number;
  flexi_core: number | null;
  stream_workshop: number | null;
  course_workshops: number | null;
  der_1: number | null;
  der_2: number | null;
  mock_bid: number | null;
  forms_by_acad: number | null;
  cgpa_component: number | null;
  cgpa_max: number | null;
  subject_representative: number | null;
  flexi_core_batchmeet: number;
  eap_batchmeet: number;
  pys: number;
  total: number;
};

type ComponentRow = {
  label: string;
  value: number | null | undefined;
  max: number | null | undefined;
  isPenalty?: boolean;
};

// Wraps every return path so the sidebar is always present, error/empty
// states included — matches the pattern of one shared shell per screen.
function Shell({ batchLabel, children }: { batchLabel?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar batchLabel={batchLabel} />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}

export default async function EapPointsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middleware.ts already gates unauthenticated requests before this page
  // loads, so `user` should always be present here — this is just a safe
  // fallback, not the primary auth check.
  if (!user) {
    return (
      <Shell>
        <div className="card p-6">
          <p className="text-sm text-inkSoft">Please log in to view your EAP points.</p>
        </div>
      </Shell>
    );
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('reg_no, batch_label')
    .eq('auth_user_id', user.id)
    .single();

  if (studentError || !student) {
    return (
      <Shell>
        <div className="card p-6">
          <p className="text-sm text-inkSoft">
            We couldn&apos;t find your student record. If this looks wrong, contact ACAD.
          </p>
        </div>
      </Shell>
    );
  }

  const { data: pointsData } = await supabase
    .from('eap_points')
    .select(
      'fixed, flexi_core, stream_workshop, course_workshops, der_1, der_2, mock_bid, forms_by_acad, cgpa_component, cgpa_max, subject_representative, flexi_core_batchmeet, eap_batchmeet, pys, total'
    )
    .eq('reg_no', student.reg_no)
    .eq('term', BIDDING_TERM)
    .single();

  const points = pointsData as EapPointsRow | null;

  if (!points) {
    return (
      <Shell batchLabel={student.batch_label}>
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base">EAP Bid Points</h2>
          </div>
          <p className="text-sm text-inkSoft">
            {BIDDING_TERM} EAP points haven&apos;t been published yet. Check back once ACAD
            releases them.
          </p>
        </div>
      </Shell>
    );
  }

  const rows: ComponentRow[] = [
    { label: 'Fixed', value: points.fixed, max: 250 },
    { label: 'Flexi Core', value: points.flexi_core, max: 150 },
    { label: 'Stream Workshop', value: points.stream_workshop, max: 90 },
    { label: 'Course Workshops', value: points.course_workshops, max: 210 },
    { label: 'DER Round 1', value: points.der_1, max: 50 },
    { label: 'DER Round 2', value: points.der_2, max: 100 },
    { label: 'Mock Bidding', value: points.mock_bid, max: 30 },
    { label: 'Forms by ACAD', value: points.forms_by_acad, max: 20 },
    { label: 'CGPA Component', value: points.cgpa_component, max: points.cgpa_max },
    { label: 'Subject Representative', value: points.subject_representative, max: 20 },
    { label: 'Flexi-Core Batch Meet', value: points.flexi_core_batchmeet, max: null, isPenalty: true },
    { label: 'EAP Batch Meet', value: points.eap_batchmeet, max: null, isPenalty: true },
    { label: 'Preliminary Yearly Survey', value: points.pys, max: null, isPenalty: true },
  ];

  const hasPendingComponent = rows.some(
    (r) => !r.isPenalty && (r.value === null || r.value === undefined || (r.label === 'CGPA Component' && !r.max))
  );

  return (
    <Shell batchLabel={student.batch_label}>
      {/* Total banner */}
      <div
        className="rounded-card p-8 mb-5 flex items-center justify-between gap-6 flex-wrap text-white"
        style={{
          background:
            'linear-gradient(120deg, theme(colors.brand.950), theme(colors.brand.800) 55%, theme(colors.plum))',
        }}
      >
        <div>
          <div className="font-display text-4xl font-semibold leading-none">
            {points.total}
            <span className="text-lg opacity-65 font-medium"> / 1000</span>
          </div>
          <div className="text-xs uppercase tracking-wide mt-1.5 text-brand-100">
            EAP Bid Points{hasPendingComponent && ' (partial — updates as ACAD publishes more)'}
          </div>
        </div>
        <div className="flex items-center gap-3.5 flex-wrap">
          <div className="text-xs text-brand-100">
            {student.batch_label} · Reg. {student.reg_no}
          </div>
          <a
            href="https://registro-iimu-bidding.edtex.in/#/login"
            target="_blank"
            rel="noopener"
            className="text-xs font-semibold text-white bg-white/10 border border-white/40 rounded-full px-4 py-2 hover:bg-white/20 hover:border-white transition whitespace-nowrap"
          >
            Go to Bidding Portal ↗
          </a>
        </div>
      </div>

      {/* Component breakdown */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-base">Component breakdown</h2>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="text-left text-xs uppercase tracking-wide text-inkFaint font-semibold pb-2.5 border-b border-line">
                Component
              </th>
              <th className="text-right text-xs uppercase tracking-wide text-inkFaint font-semibold pb-2.5 border-b border-line">
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isPending =
                row.value === null ||
                row.value === undefined ||
                (row.label === 'CGPA Component' && !row.max);

              return (
                <tr key={row.label} className="border-b border-line last:border-none">
                  <td className="py-2.5">{row.label}</td>
                  <td className="py-2.5 text-right font-mono">
                    {isPending ? (
                      <span className="text-xs font-semibold text-gold-600 bg-gold-100 px-2.5 py-1 rounded-full whitespace-nowrap">
                        Pending
                      </span>
                    ) : row.isPenalty ? (
                      row.value === 0 ? (
                        '0'
                      ) : (
                        <span className="text-danger">{row.value}</span>
                      )
                    ) : (
                      <>
                        {row.value}
                        <span className="font-sans text-inkFaint text-xs ml-0.5">/{row.max}</span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
