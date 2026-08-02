import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFileMetadata } from '@/lib/googleDrive';

function extractDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  // "https://drive.google.com/file/d/FILE_ID/view?usp=sharing"
  let m = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // "https://drive.google.com/open?id=FILE_ID"
  m = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // just a bare file ID pasted directly
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: student } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

  const { sessionId, driveLink, applyToNextSession } = await request.json();
  if (!sessionId || !driveLink) {
    return NextResponse.json({ error: 'sessionId and driveLink are required' }, { status: 400 });
  }

  const fileId = extractDriveFileId(driveLink);
  if (!fileId) {
    return NextResponse.json({ error: "Couldn't recognize that as a Drive link — paste the full share link, or just the file ID." }, { status: 400 });
  }

  // Re-verify SR status.
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

  // Confirm the file is real and accessible (this only needs READ access, which the service
  // account does have on the shared folder — the earlier storage-quota error was specifically
  // about WRITING/creating files, not reading existing ones), and grab its real name.
  let fileName: string;
  try {
    const meta = await getFileMetadata(fileId);
    fileName = meta.name ?? 'Untitled';
  } catch (err: any) {
    return NextResponse.json(
      { error: "Couldn't access that file — make sure it's uploaded inside the shared prereads folder, and the link is correct." },
      { status: 400 }
    );
  }

  const rowsToInsert = [{ session_id: sessionId, drive_file_id: fileId, file_name: fileName, uploaded_by_sr: student.id }];

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
      rowsToInsert.push({ session_id: nextSession.id, drive_file_id: fileId, file_name: fileName, uploaded_by_sr: student.id });
      appliedToNextSession = true;
    }
  }

  const { error: insertErr } = await supabase.from('prereads').insert(rowsToInsert);
  if (insertErr) {
    return NextResponse.json({ error: 'Failed to save record', detail: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fileName, appliedToNextSession });
}
