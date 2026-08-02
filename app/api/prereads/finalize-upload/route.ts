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

  const { sessionId, driveFileId, fileName, applyToNextSession } = await request.json();
  if (!sessionId || !driveFileId || !fileName) {
    return NextResponse.json({ error: 'sessionId, driveFileId, and fileName are required' }, { status: 400 });
  }

  // Re-verify SR status here too, not just at init — a client could otherwise call this
  // route directly with a fabricated driveFileId to spoof a preread record. The prereads
  // table's own RLS insert policy enforces this same check again as a third layer.
  const { data: session } = await supabase
    .from('sessions')
    .select('id, subject_id, section_id, term, session_number')
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

  const rowsToInsert = [{ session_id: sessionId, drive_file_id: driveFileId, file_name: fileName, uploaded_by_sr: student.id }];

  let appliedToNextSession = false;
  if (applyToNextSession) {
    const { data: nextSession } = await supabase
      .from('sessions')
      .select('id')
      .eq('subject_id', session.subject_id)
      .eq('term', session.term)
      .eq('session_number', session.session_number + 1)
      .or(session.section_id ? `section_id.eq.${session.section_id}` : `section_id.is.null`)
      .maybeSingle();

    if (nextSession) {
      rowsToInsert.push({ session_id: nextSession.id, drive_file_id: driveFileId, file_name: fileName, uploaded_by_sr: student.id });
      appliedToNextSession = true;
    }
  }

  const { error: insertErr } = await supabase.from('prereads').insert(rowsToInsert);
  if (insertErr) {
    return NextResponse.json({ error: 'Uploaded to Drive but failed to save record', detail: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, appliedToNextSession });
}
