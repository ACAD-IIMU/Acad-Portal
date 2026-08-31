// app/api/sr-elections/vote/route.ts
//
// Submits a student's SR votes for a term — one-shot, same freeze pattern as
// /api/sr-elections/nominate (see that file for why the ordering of checks
// matters). Nominee validation reads sr_nominations via the service-role
// client since RLS won't let a student read another student's nomination
// row through the anon client.

import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { voteTableForTerm } from '@/app/sr-elections/voteTable';

type Vote = { subjectId: string; sectionId: string | null; candidateStudentId: string };

export async function POST(req: Request) {
  const supabase = createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

  let body: { term?: string; votes?: Vote[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const term = body.term;
  const votes = body.votes ?? [];

  if (!term) return NextResponse.json({ error: 'Missing term' }, { status: 400 });
  if (votes.length === 0) return NextResponse.json({ error: 'No votes provided' }, { status: 400 });

  const uniqueSubjectIds = new Set(votes.map((v) => v.subjectId));
  if (uniqueSubjectIds.size !== votes.length) {
    return NextResponse.json({ error: 'Duplicate subject in your votes' }, { status: 400 });
  }

  const voteTable = voteTableForTerm(term);

  // THE FREEZE: any existing vote row for this student in this term's table
  // at all means they've already voted — reject outright, no partial/repeat
  // submissions.
  const { count: existingCount, error: existingErr } = await supabase
    .from(voteTable)
    .select('id', { count: 'exact', head: true })
    .eq('student_id', student.id);
  if (existingErr) {
    return NextResponse.json(
      { error: 'Failed to check existing votes', detail: existingErr.message },
      { status: 500 }
    );
  }
  if ((existingCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'You have already voted for this term — it cannot be changed.' },
      { status: 409 }
    );
  }

  // Every vote must be for a subject/section the student is actually
  // enrolled in, and not IMC (voting for it already happened separately).
  const { data: enrollments, error: enrollErr } = await supabase
    .from('enrollments')
    .select('subject_id, section_id, subjects(name)')
    .eq('student_id', student.id)
    .eq('term', term);
  if (enrollErr) {
    return NextResponse.json(
      { error: 'Failed to load enrollments', detail: enrollErr.message },
      { status: 500 }
    );
  }
  const enrolledKeys = new Set(
    (enrollments ?? [])
      .filter((e: any) => e.subjects?.name !== 'IMC')
      .map((e: any) => `${e.subject_id}::${e.section_id ?? 'null'}`)
  );
  for (const v of votes) {
    const key = `${v.subjectId}::${v.sectionId ?? 'null'}`;
    if (!enrolledKeys.has(key)) {
      return NextResponse.json(
        { error: 'You can only vote for subjects you are enrolled in' },
        { status: 403 }
      );
    }
  }

  // Every chosen candidate must actually be a nominee for that subject/section.
  const admin = createAdminClient();
  const subjectIds = votes.map((v) => v.subjectId);
  const { data: nominations, error: nomErr } = await admin
    .from('sr_nominations')
    .select('subject_id, section_id, student_id')
    .eq('term', term)
    .in('subject_id', subjectIds);
  if (nomErr) {
    return NextResponse.json({ error: 'Failed to load nominees', detail: nomErr.message }, { status: 500 });
  }
  const validCandidateKeys = new Set(
    (nominations ?? []).map((n: any) => `${n.subject_id}::${n.section_id ?? 'null'}::${n.student_id}`)
  );
  for (const v of votes) {
    const key = `${v.subjectId}::${v.sectionId ?? 'null'}::${v.candidateStudentId}`;
    if (!validCandidateKeys.has(key)) {
      return NextResponse.json({ error: 'Invalid candidate selection' }, { status: 400 });
    }
  }

  const rowsToInsert = votes.map((v) => ({
    student_id: student.id,
    subject_id: v.subjectId,
    section_id: v.sectionId,
    candidate_student_id: v.candidateStudentId
  }));

  const { error: insertErr } = await supabase.from(voteTable).insert(rowsToInsert);
  if (insertErr) {
    return NextResponse.json({ error: 'Failed to submit votes', detail: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, voted: rowsToInsert.length });
}
