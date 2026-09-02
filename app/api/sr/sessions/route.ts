import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: student } = await supabase.from('students').select('id').eq('auth_user_id', user.id).single();
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

  const { data: assignments } = await supabase
    .from('sr_assignments')
    .select('subject_id, section_id, term, drive_folder_link, subjects(name), sections(section_label)')
    .eq('student_id', student.id);

  if (!assignments || assignments.length === 0) {
    return NextResponse.json({ isSr: false, sessions: [] });
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // One query per SR'd subject+section — assignments list is small (a handful per student
  // at most), so this stays simple rather than building one complex OR-chain query.
  const allSessions: any[] = [];
  for (const a of assignments) {
    let query = supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time, room, session_number, no_preread, subjects(name), sections(section_label), prereads(id, file_name, drive_file_id, uploaded_at)')
      .eq('subject_id', a.subject_id)
      .eq('term', a.term)
      .gte('session_date', today)
      .order('session_date');

    query = a.section_id ? query.eq('section_id', a.section_id) : query.is('section_id', null);

    const { data: sessions } = await query;
    if (sessions) {
      // Each session carries its OWN subject+section's specific folder link — not one
      // generic link for everyone, matching that an SR is only ever assigned to one
      // subject+section per term.
      allSessions.push(...sessions.map((s) => ({ ...s, driveFolderLink: a.drive_folder_link })));
    }
  }

  allSessions.sort((x, y) => x.session_date.localeCompare(y.session_date));

  // For the "post a class announcement" form on the SR Tools page — which of their
  // subject+section assignments can they post to, named for a dropdown. Reuses the
  // subjects(name)/sections(section_label) already joined above — no extra query needed.
  const assignmentOptions = assignments.map((a) => ({
    subjectId: a.subject_id,
    subjectName: (a.subjects as any)?.name ?? 'Subject',
    sectionId: a.section_id,
    sectionLabel: (a.sections as any)?.section_label ?? null
  }));

  // Announcements this SR has already posted (any subject+section they're assigned to),
  // so the page can list them with a delete option.
  const { data: announcements } = await supabase
    .from('reminders')
    .select('id, title, target_at, subject_id, section_id, subjects(name), sections(section_label)')
    .eq('type', 'sr_announcement')
    .eq('created_by', student.id)
    .order('target_at');

  return NextResponse.json({
    isSr: true,
    sessions: allSessions,
    assignmentOptions,
    announcements: announcements ?? []
  });
}
