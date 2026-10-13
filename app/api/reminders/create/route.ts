import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: student } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

  const { type, title, targetAt, subjectId, sectionId } = await request.json();

  if (type !== 'personal' && type !== 'sr_announcement') {
    return NextResponse.json({ error: 'type must be "personal" or "sr_announcement"' }, { status: 400 });
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (!targetAt || isNaN(new Date(targetAt).getTime())) {
    return NextResponse.json({ error: 'targetAt must be a valid date/time' }, { status: 400 });
  }

  if (type === 'personal') {
    const { error } = await supabase.from('reminders').insert({
      created_by: student.id,
      type: 'personal',
      title: title.trim(),
      target_at: targetAt,
      subject_id: subjectId || null
    });

    if (error) return NextResponse.json({ error: 'Failed to create reminder', detail: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // sr_announcement — must correspond to an actual SR assignment for this student. The
  // term is taken from that assignment (see `term: assignment.term` on the insert below),
  // never trusted from the client.
  //
  // This deliberately does NOT filter by term. It used to pin .eq('term', TERM_5) on the
  // grounds that MBA2/Term V was the only cohort with live SR assignments -- which stopped
  // being true the moment MBA1's Term II SR election closed, and silently 403'd every
  // Term II SR ("You are not the assigned SR for that subject/section") even though their
  // assignment existed and was correct.
  //
  // A term filter was never load-bearing anyway: `subjects` rows are per-term, so a
  // subject_id already implies exactly one term, and student + subject + section is
  // therefore unique on its own. Re-adding a hardcoded term here would just reintroduce
  // the same bug for whichever cohort comes next.
  if (!subjectId) {
    return NextResponse.json({ error: 'subjectId is required for a class announcement' }, { status: 400 });
  }

  let assignmentQuery = supabase
    .from('sr_assignments')
    .select('subject_id, section_id, term')
    .eq('student_id', student.id)
    .eq('subject_id', subjectId);

  assignmentQuery = sectionId ? assignmentQuery.eq('section_id', sectionId) : assignmentQuery.is('section_id', null);

  const { data: assignment } = await assignmentQuery.maybeSingle();

  if (!assignment) {
    return NextResponse.json(
      { error: 'You are not the assigned SR for that subject/section' },
      { status: 403 }
    );
  }

  const { error } = await supabase.from('reminders').insert({
    created_by: student.id,
    type: 'sr_announcement',
    title: title.trim(),
    target_at: targetAt,
    subject_id: assignment.subject_id,
    section_id: assignment.section_id,
    term: assignment.term
  });

  if (error) return NextResponse.json({ error: 'Failed to create announcement', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
