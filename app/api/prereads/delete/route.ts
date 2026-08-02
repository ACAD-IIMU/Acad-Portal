import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deletePrereadFile } from '@/lib/googleDrive';

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: student } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

  const { prereadId } = await request.json();
  if (!prereadId) return NextResponse.json({ error: 'prereadId is required' }, { status: 400 });

  const { data: preread } = await supabase
    .from('prereads')
    .select('id, drive_file_id, session_id, sessions(subject_id, section_id, term)')
    .eq('id', prereadId)
    .maybeSingle();

  if (!preread) return NextResponse.json({ error: 'Preread not found' }, { status: 404 });

  const session = (preread as any).sessions;
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

  const { error: deleteErr } = await supabase.from('prereads').delete().eq('id', prereadId);
  if (deleteErr) {
    return NextResponse.json({ error: 'Failed to delete record', detail: deleteErr.message }, { status: 500 });
  }

  // Best-effort — the DB record is already gone (the part that matters for students), so
  // don't fail the whole request if Drive cleanup itself has an issue (e.g. already deleted).
  try {
    await deletePrereadFile(preread.drive_file_id);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}
