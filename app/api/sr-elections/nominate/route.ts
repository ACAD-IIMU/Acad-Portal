// app/api/sr-elections/nominate/route.ts
//
// Submits a student's SR nomination for a term. Deliberately no PUT/PATCH/DELETE
// here — nomination is a one-shot action by design, not a resource you edit.
//
// Order of checks matters: auth -> shape validation -> the freeze (already
// submitted?) -> enrollment ownership (allowed to nominate for this race?) ->
// insert. Freeze is checked BEFORE enrollment validation so a student who's
// already submitted gets the "already submitted" message, not a confusing
// enrollment error, if they retry with different picks.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const MAX_PICKS = 3;

// TEMPORARY soft-launch gate — keep in sync with app/sr-elections/page.tsx.
// Remove both when ready to open nomination to everyone.
const ALLOWED_REG_NOS = ['2511140', '2511313', '2511253'];

type Pick = { subjectId: string; sectionId: string | null; priority: number };

export async function POST(req: Request) {
  const supabase = createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: student } = await supabase
    .from('students')
    .select('id, reg_no')
    .eq('auth_user_id', user.id)
    .single();
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

  if (!ALLOWED_REG_NOS.includes(student.reg_no)) {
    return NextResponse.json({ error: 'SR Elections nomination is not open yet' }, { status: 403 });
  }

  let body: { term?: string; picks?: Pick[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const term = body.term;
  const picks = body.picks ?? [];

  if (!term) {
    return NextResponse.json({ error: 'Missing term' }, { status: 400 });
  }
  if (picks.length === 0) {
    return NextResponse.json({ error: 'Select at least 1 subject' }, { status: 400 });
  }
  if (picks.length > MAX_PICKS) {
    return NextResponse.json({ error: `Max ${MAX_PICKS} subjects allowed` }, { status: 400 });
  }
  const uniqueSubjectIds = new Set(picks.map((p) => p.subjectId));
  if (uniqueSubjectIds.size !== picks.length) {
    return NextResponse.json({ error: 'Duplicate subject in your picks' }, { status: 400 });
  }

  // Priorities must be exactly {1, 2, ..., picks.length} — no gaps, no
  // duplicates, no skipping straight to 3 for a single pick.
  const sortedPriorities = picks.map((p) => p.priority).sort((a, b) => a - b);
  const expectedPriorities = picks.map((_, i) => i + 1);
  const prioritiesValid = sortedPriorities.every((v, i) => v === expectedPriorities[i]);
  if (!prioritiesValid) {
    return NextResponse.json(
      { error: `Priorities must be 1 to ${picks.length} with no gaps or duplicates` },
      { status: 400 }
    );
  }

  // THE FREEZE: any existing row for this student+term at all means they've
  // already submitted — reject outright, no partial/repeat submissions.
  // (Known gap, not fixed here: two truly simultaneous submits — e.g. a
  // double-click that beats the client's own disabled-while-submitting guard —
  // could both pass this check before either insert lands. Low-risk at this
  // scale; flagging rather than adding a lock table for it right now.)
  const { count: existingCount, error: existingErr } = await supabase
    .from('sr_nominations')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', student.id)
    .eq('term', term);
  if (existingErr) {
    return NextResponse.json(
      { error: 'Failed to check existing nominations', detail: existingErr.message },
      { status: 500 }
    );
  }
  if ((existingCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'You have already submitted your nomination for this term — it cannot be changed.' },
      { status: 409 }
    );
  }

  // Every pick must match a real enrollment — can't nominate for a subject
  // or section you're not actually enrolled in.
  const { data: enrollments, error: enrollErr } = await supabase
    .from('enrollments')
    .select('subject_id, section_id')
    .eq('student_id', student.id)
    .eq('term', term);
  if (enrollErr) {
    return NextResponse.json({ error: 'Failed to load enrollments', detail: enrollErr.message }, { status: 500 });
  }
  const enrolledKeys = new Set((enrollments ?? []).map((e) => `${e.subject_id}::${e.section_id ?? 'null'}`));
  for (const p of picks) {
    const key = `${p.subjectId}::${p.sectionId ?? 'null'}`;
    if (!enrolledKeys.has(key)) {
      return NextResponse.json(
        { error: 'You can only nominate for subjects you are enrolled in' },
        { status: 403 }
      );
    }
  }

  const rowsToInsert = picks.map((p) => ({
    student_id: student.id,
    subject_id: p.subjectId,
    section_id: p.sectionId,
    term,
    priority: p.priority
  }));

  const { error: insertErr } = await supabase.from('sr_nominations').insert(rowsToInsert);
  if (insertErr) {
    return NextResponse.json({ error: 'Failed to submit nomination', detail: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, nominated: rowsToInsert.length });
}
