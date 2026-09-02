import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TERM_5 } from '@/lib/term5';

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
  // term is taken from that assignment, not trusted from the client, currently always
  // TERM_5 (MBA2's only cohort with SR assignments live so far) but resolved this way so
  // it stays correct automatically once MBA1/Term II SR assignments exist too.
  if (!subjectId) {
    return NextResponse.json({ error: 'subjectId is required for a class announcement' }, { status: 400 });
  }

  let assignmentQuery = supabase
    .from('sr_assignments')
    .select('subject_id, section_id, term')
    .eq('student_id', student.id)
    .eq('subject_id', subjectId)
    .eq('term', TERM_5); // scoping today's only live SR-assignment term; see note above

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
