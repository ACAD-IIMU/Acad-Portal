// app/sr-elections/Results.tsx
//
// Read-only display of the final declared SR per subject+section, straight
// from sr_assignments (the same table that grants actual SR access
// site-wide) — not re-derived from votes, so this can never drift from who
// actually has SR permissions.

type SrRow = {
  subjectName: string;
  sectionLabel: string | null;
  fullName: string;
  regNo: string;
  email: string;
  phone: string | null;
};

export default function Results({ rows }: { rows: SrRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-inkFaint italic card p-5">
        No SR assignments recorded yet for this term.
      </p>
    );
  }

  return (
    <div className="card p-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-inkFaint uppercase tracking-wide border-b border-line">
            <th className="py-2 pr-3">Subject</th>
            <th className="py-2 pr-3">Section</th>
            <th className="py-2 pr-3">Elected SR</th>
            <th className="py-2 pr-3">Reg No</th>
            <th className="py-2 pr-3">Email</th>
            <th className="py-2 pr-3">Contact No.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              <td className="py-2 pr-3 font-semibold">{r.subjectName}</td>
              <td className="py-2 pr-3 text-inkFaint">{r.sectionLabel ?? '—'}</td>
              <td className="py-2 pr-3">{r.fullName}</td>
              <td className="py-2 pr-3 text-inkFaint">{r.regNo}</td>
              <td className="py-2 pr-3 text-inkFaint">{r.email}</td>
              <td className="py-2 pr-3 text-inkFaint">{r.phone ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
