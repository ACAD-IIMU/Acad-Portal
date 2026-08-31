// app/api/sr-elections/voting-state/route.ts
//
// Returns either the student's already-locked votes (with candidate names)
// or the list of subjects they can vote in with each subject's nominees.
// Needs the service-role client for two reads that plain RLS won't allow a
// student to make directly: another student's full_name (candidates), and
// nominations rows belonging to other students. Enrollments/own-votes are
// still read through the anon client since RLS already permits those.

import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { voteTableForTerm } from '@/app/sr-elections/voteTable';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const term = searchParams.get('term');
  if (!term) return NextResponse.json({ error: 'Missing term' }, { status: 400 });

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

  const admin = createAdminClient();
  const voteTable = voteTableForTerm(term);

  const { data: existingVotes, error: votesErr } = await admin
    .from(voteTable)
    .select('subject_id, section_id, candidate_student_id, subjects(name), sections(section_label)')
    .eq('student_id', student.id);
  if (votesErr) {
    return NextResponse.json({ error: 'Failed to load votes', detail: votesErr.message }, { status: 500 });
  }

  if (existingVotes && existingVotes.length > 0) {
    const candidateIds = Array.from(new Set(existingVotes.map((v: any) => v.candidate_student_id)));
    const { data: candidates } = await admin.from('students').select('id, full_name').in('id', candidateIds);
    const nameById = new Map((candidates ?? []).map((c: any) => [c.id, c.full_name]));

    return NextResponse.json({
      locked: true,
      votes: existingVotes.map((v: any) => ({
        subjectName: v.subjects?.name,
        sectionLabel: v.sections?.section_label ?? null,
        candidateName: nameById.get(v.candidate_student_id) ?? 'Unknown'
      }))
    });
  }

  const { data: enrollments, error: enrollErr } = await supabase
    .from('enrollments')
    .select('subject_id, section_id, subjects(name), sections(section_label)')
    .eq('student_id', student.id)
    .eq('term', term);
  if (enrollErr) {
    return NextResponse.json({ error: 'Failed to load enrollments', detail: enrollErr.message }, { status: 500 });
  }

  const votingEnrollments = (enrollments ?? []).filter((e: any) => e.subjects?.name !== 'IMC');
  const subjectIds = Array.from(new Set(votingEnrollments.map((e: any) => e.subject_id)));

  const { data: nominations } = subjectIds.length
    ? await admin
        .from('sr_nominations')
        .select('subject_id, section_id, student_id, students(full_name)')
        .eq('term', term)
        .in('subject_id', subjectIds)
    : { data: [] as any[] };

  const subjects = votingEnrollments.map((e: any) => {
    const candidates = (nominations ?? [])
      .filter(
        (n: any) => n.subject_id === e.subject_id && (n.section_id ?? null) === (e.section_id ?? null)
      )
      .map((n: any) => ({ id: n.student_id, name: n.students?.full_name ?? 'Unknown' }));
    return {
      subjectId: e.subject_id,
      subjectName: e.subjects?.name,
      sectionId: e.section_id,
      sectionLabel: e.sections?.section_label ?? null,
      candidates
    };
  });

  return NextResponse.json({ locked: false, subjects });
}
