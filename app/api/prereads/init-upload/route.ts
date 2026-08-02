import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { initiateResumableUpload } from '@/lib/googleDrive';

async function verifySr(supabase: any, studentId: string, sessionId: string) {
  const { data: session } = await supabase
    .from('sessions')
    .select('id, subject_id, section_id, term, session_number')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return { ok: false as const, error: 'Session not found', status: 404 };

  const { data: srCheck } = await supabase
    .from('sr_assignments')
    .select('id')
    .eq('subject_id', session.subject_id)
    .eq('term', session.term)
    .or(session.section_id ? `section_id.eq.${session.section_id}` : `section_id.is.null`)
    .eq('student_id', studentId)
    .maybeSingle();

  if (!srCheck) return { ok: false as const, error: 'You are not the assigned SR for this session', status: 403 };
  return { ok: true as const, session };
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: student } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

  const { sessionId, fileName, mimeType } = await request.json();
  if (!sessionId || !fileName) {
    return NextResponse.json({ error: 'sessionId and fileName are required' }, { status: 400 });
  }

  const check = await verifySr(supabase, student.id, sessionId);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    const uploadUrl = await initiateResumableUpload(fileName, mimeType || 'application/octet-stream');
    return NextResponse.json({ ok: true, uploadUrl });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to start upload session', detail: err.message }, { status: 502 });
  }
}
