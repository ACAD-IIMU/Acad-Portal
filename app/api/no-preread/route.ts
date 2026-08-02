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

  const { sessionId, noPreread } = await request.json();
  if (!sessionId || typeof noPreread !== 'boolean') {
    return NextResponse.json({ error: 'sessionId and noPreread (boolean) are required' }, { status: 400 });
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('id, subject_id, section_id, term')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const { data: srCheck } = await supabase
    .from('sr_assignments')
    .select('id')
    .eq('subject_id', session.subject_id)
    .eq('term', session.term)
    .or(session.section_id ? `section_id.eq.${session.section_id}` : `section_id.is.null`)
    .eq('student_id', student.id)
    .maybeSingle();

  if (!srCheck) {
    return NextResponse.json({ error: 'You are not the assigned SR for this session' }, { status: 403 });
  }

  const { error } = await supabase.from('sessions').update({ no_preread: noPreread }).eq('id', sessionId);
  if (error) {
    return NextResponse.json({ error: 'Failed to update session', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessionId, noPreread });
}
