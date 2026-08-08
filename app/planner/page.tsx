// app/planner/page.tsx
//
// Term planner. Unlike /home and /eap this page holds no per-student data — the
// dataset is bundled at build time from the term sheet of the timetable workbook
// (see scripts/parse_term_planner.py). Student identity is read only for the
// sidebar's batch label, so nothing here varies per user except that label.
//
// Consequence worth knowing: because the JSON is bundled, publishing a new term
// means re-running the parser AND redeploying — editing the file on the server
// alone won't do it.

import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';
import UserMenu from '@/components/UserMenu';
import PlannerClient from './PlannerClient';
import type { PlannerData } from '@/lib/plannerTypes';
import plannerJson from '@/data/termPlanner.json';

export const metadata = {
  title: 'Term Planner — ACAD Portal',
};

const data = plannerJson as unknown as PlannerData;

export default async function PlannerPage() {
  const supabase = createClient();
  const { data: student } = await supabase
    .from('students')
    .select('full_name, reg_no, batch_label')
    .single();

  const subjectCount = Object.keys(data.subject_sections).length;
  const sectionCount = Object.keys(data.courses).length;

  // The dataset ships as an empty placeholder so the build never breaks on a
  // missing file. If the parser hasn't been run for this term yet, say so
  // plainly rather than rendering an empty planner that looks broken.
  const notGenerated = data.timetable.length === 0;

  return (
    <div className="flex min-h-screen">
      <Sidebar batchLabel={student?.batch_label} />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 md:px-8 flex flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl">{data.term} Planner</h1>
            <p className="text-inkFaint text-sm">
              {notGenerated
                ? 'Timetable data has not been generated for this term yet.'
                : `${subjectCount} courses · ${sectionCount} sections. Plan your electives, catch overlaps before bidding.`}
            </p>
          </div>
          <UserMenu
            name={student?.full_name ?? 'Student'}
            regNo={student?.reg_no}
            batchLabel={student?.batch_label}
          />
        </header>

        {notGenerated ? (
          <div className="card p-6">
            <h2 className="text-base">Timetable data missing</h2>
            <p className="text-sm text-inkSoft mt-2">
              Generate <code className="font-mono text-xs">data/termPlanner.json</code> from the
              official workbook, then redeploy:
            </p>
            <pre className="mt-3 text-xs font-mono bg-cream border border-line rounded-lg p-3 overflow-x-auto">
{`pip install openpyxl
python3 scripts/parse_term_planner.py "MBA 2025-27 Batch Timetable.xlsx" --term "${data.term}"`}
            </pre>
          </div>
        ) : (
          <PlannerClient data={data} />
        )}

        <p className="text-[11px] text-inkFaint">
          Built from the official {data.term} timetable sheet. Always confirm against the
          latest circular before you bid — the sheet does get revised.
        </p>
      </main>
    </div>
  );
}
