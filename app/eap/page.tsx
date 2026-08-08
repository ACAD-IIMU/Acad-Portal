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

// Temporary — set back to false to restore real data for everyone. While
// true, every student sees a static 0/1000 "will be updated shortly" view
// regardless of their actual data (or lack of it), skipping all DB queries
// entirely so this can't break due to any student's individual data state.
const EAP_SECTION_DISABLED = false;

import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';
import CourseWorkshopsRow from '@/components/CourseWorkshopsRow';
import UserMenu from '@/components/UserMenu';
import type { ReactNode } from 'react';

type EapPointsRow = {
  fixed: number;
  flexi_core: number | null;
  stream_workshop: number | null;
  course_workshops: number | null;
  course_workshops_na: boolean;
  der_1: number | null;
  der_2: number | null;
  mock_bid: number | null;
  forms_by_acad: number | null;
  cgpa_component: number | null;
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
  isNA?: boolean;
};

// Wraps every return path so the sidebar is always present, error/empty
// states included — matches the pattern of one shared shell per screen.
// userMenu is optional since some early-return states (not logged in, no
// student record) don't have a student to build it from.
function Shell({
  batchLabel,
  userMenu,
  children,
}: {
  batchLabel?: string;
  userMenu?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar batchLabel={batchLabel} />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 md:px-8">
        {userMenu && <div className="flex justify-end mb-5">{userMenu}</div>}
        {children}
      </main>
    </div>
  );
}

// A normal, non-expandable component row (everything except Course Workshops).
function PlainRow({ row }: { row: ComponentRow }) {
  const isPending =
    row.value === null || row.value === undefined || (row.label === 'CGPA Component' && !row.max);

  return (
    <tr className="border-b border-line last:border-none">
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
}

// The full 25-elective master list for this term, from the real DER Round 1
// report (StudentWiseDemandEstimationReport) — used only when a student has
// zero DER-1 selection rows, meaning they didn't submit DER-1 at all. Per
// policy IV.4.4, that means they're mandated for every workshop, not none.
const ALL_ELECTIVES = [
  'Advanced Methods for Data Analytics',
  'Advanced Qualitative Research Methods',
  'Advanced Selling Skills and Management',
  'Advertising Management & Integrated Marketing Communication',
  'Business Applications of Artificial Intelligence',
  'Competing through Operations',
  'Contemporary Project Management',
  'Crafting Meaningful Experiences',
  'Customer Relationship Management',
  'FINTECH',
  'Financial Risk Management',
  'Foreign Trade and Indirect Tax',
  'Innovation Management',
  "Introduction to Management Consulting - A practitioner's approach to solving client problems",
  'Management Consulting',
  'Marketing Analytics',
  'Marketing for Sustainable World',
  'Merger, Acquisition & Corporate Restructuring',
  'Multi-Sectoral Analysis in Indian Context',
  'Negotiations',
  'Retail Management',
  'Rural Marketing',
  'Strategic Digital Supply Chain Management',
  'Strategic Leadership and Management',
  'Theory of Constraint',
];

export default async function EapPointsPage() {
  if (EAP_SECTION_DISABLED) {
    const staticRows: ComponentRow[] = [
      { label: 'Fixed', value: 0, max: 250 },
      { label: 'Flexi Core', value: 0, max: 150 },
      { label: 'Stream Workshop', value: 0, max: 90 },
      { label: 'Course Workshops', value: 0, max: 210 },
      { label: 'DER Round 1', value: 0, max: 50 },
      { label: 'DER Round 2', value: 0, max: 100 },
      { label: 'Mock Bidding', value: 0, max: 30 },
      { label: 'Forms by ACAD', value: 0, max: 20 },
      { label: 'CGPA Component', value: 0, max: 80 },
      { label: 'Subject Representative', value: 0, max: 20 },
      { label: 'Flexi-Core Batch Meet', value: 0, max: null, isPenalty: true },
      { label: 'EAP Batch Meet', value: 0, max: null, isPenalty: true },
      { label: 'Preliminary Yearly Survey', value: 0, max: null, isPenalty: true },
    ];

    return (
      <Shell>
        <div className="rounded-card p-8 mb-5 flex items-center justify-between gap-6 flex-wrap text-white bg-[linear-gradient(120deg,#2a0f16,#7a2331_55%,#702c4e)]">
          <div>
            <div className="font-display text-4xl font-semibold leading-none">
              0<span className="text-lg opacity-65 font-medium"> / 1000</span>
            </div>
            <div className="text-xs uppercase tracking-wide mt-1.5 text-brand-100">
              EAP Bid Points — will be updated shortly
            </div>
          </div>
        </div>

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
              {staticRows.map((row) => (
                <PlainRow key={row.label} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </Shell>
    );
  }

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
    .select('full_name, reg_no, batch_label')
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

  const userMenu = (
    <UserMenu name={student.full_name ?? 'Student'} regNo={student.reg_no} batchLabel={student.batch_label} />
  );

  const { data: pointsData } = await supabase
    .from('stg_eap_points_term5_v2')
    .select(
      'fixed, flexi_core, stream_workshop, course_workshops, course_workshops_na, der_1, der_2, mock_bid, forms_by_acad, cgpa_component, subject_representative, flexi_core_batchmeet, eap_batchmeet, pys, total'
    )
    .eq('reg_no', student.reg_no)
    .eq('term', BIDDING_TERM)
    .single();

  const points = pointsData as EapPointsRow | null;

  const [{ data: der1Selections }, { data: attendanceRows }] = await Promise.all([
    supabase
      .from('eap_der1_selections')
      .select('subject_name')
      .eq('reg_no', student.reg_no)
      .eq('term', BIDDING_TERM),
    supabase
      .from('eap_course_workshop_attendance_t5')
      .select('subject_name, status, redress_requested')
      .eq('reg_no', student.reg_no)
      .eq('term', BIDDING_TERM),
  ]);

  // Real source of truth for "mandated": actual DER-1 picks. Zero rows means
  // this student never submitted DER-1 at all — per policy IV.4.4, that
  // makes every elective mandated, not none.
  const didNotSubmitDer1 = !der1Selections || der1Selections.length === 0;
  const mandatedSubjects = didNotSubmitDer1
    ? ALL_ELECTIVES
    : der1Selections.map((s) => s.subject_name);

  const attendanceBySubject = new Map(
    (attendanceRows ?? []).map((r) => [r.subject_name, r])
  );

  const courseWorkshopSubjects = mandatedSubjects.map((name) => {
    const attendance = attendanceBySubject.get(name);
    return {
      name,
      status: (attendance?.status ?? null) as 'P' | 'A' | 'L' | 'S' | 'S_L' | 'NA' | null,
      redressRequested: attendance?.redress_requested ?? false,
    };
  });

  if (!points) {
    return (
      <Shell batchLabel={student.batch_label} userMenu={userMenu}>
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

  const topRows: ComponentRow[] = [
    { label: 'Fixed', value: points.fixed, max: 250 },
    { label: 'Flexi Core', value: points.flexi_core, max: 150 },
    { label: 'Stream Workshop', value: points.stream_workshop, max: 90 },
  ];

  const scoreRows: ComponentRow[] = [
    { label: 'DER Round 1', value: points.der_1, max: 50 },
    { label: 'DER Round 2', value: points.der_2, max: 100 },
    { label: 'Mock Bidding', value: points.mock_bid, max: 30 },
    { label: 'Forms by ACAD', value: points.forms_by_acad, max: 20 },
    { label: 'CGPA Component', value: points.cgpa_component, max: 80 },
    { label: 'Subject Representative', value: points.subject_representative, max: 20 },
  ];

  const penaltyRows: ComponentRow[] = [
    { label: 'Flexi-Core Batch Meet', value: points.flexi_core_batchmeet, max: null, isPenalty: true },
    { label: 'EAP Batch Meet', value: points.eap_batchmeet, max: null, isPenalty: true },
    { label: 'Preliminary Yearly Survey', value: points.pys, max: null, isPenalty: true },
  ];

  const rows = [
    ...topRows,
    { label: 'Course Workshops', value: points.course_workshops, max: 210, isNA: points.course_workshops_na },
    ...scoreRows,
    ...penaltyRows,
  ];

  const hasPendingComponent = rows.some(
    (r) => !r.isPenalty && !r.isNA && (r.value === null || r.value === undefined || (r.label === 'CGPA Component' && !r.max))
  );

  return (
    <Shell batchLabel={student.batch_label} userMenu={userMenu}>
      {/* Total banner */}
      <div className="rounded-card p-8 mb-5 flex items-center justify-between gap-6 flex-wrap text-white bg-[linear-gradient(120deg,#2a0f16,#7a2331_55%,#702c4e)]">
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
            {topRows.map((row) => (
              <PlainRow key={row.label} row={row} />
            ))}

            <CourseWorkshopsRow
              value={points.course_workshops}
              max={210}
              isNA={points.course_workshops_na}
              regNo={student.reg_no}
              term={BIDDING_TERM}
              batchLabel={student.batch_label}
              studentEmail={user.email ?? ''}
              subjects={courseWorkshopSubjects}
            />

            {scoreRows.map((row) => (
              <PlainRow key={row.label} row={row} />
            ))}

            <tr>
              <td colSpan={2} className="pt-4 pb-1.5 text-[11px] uppercase tracking-wide text-inkFaint font-semibold">
                Penalties
              </td>
            </tr>
            {penaltyRows.map((row) => (
              <PlainRow key={row.label} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
