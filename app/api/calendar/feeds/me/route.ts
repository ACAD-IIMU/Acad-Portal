import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { confirmStudent, getStudentCalendarStatus, subscribeStudent } from '@/lib/calendarFeeds';
import { getDirectStatus } from '@/lib/personalCalendar';

// The signed-in student's own ACAD section calendars.
//   GET  → which calendars they should have, and which are already in their Google Calendar
//   POST → add the missing ones now (the "Add my class calendars" button on Home)
//   POST { action: "confirm" } → "I can see my ACAD classes on my phone": the student's old
//          guest invites are then removed on the next sync

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function currentStudentId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const { data } = await createAdminClient().from('students').select('id').eq('email', user.email).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function GET() {
  const studentId = await currentStudentId();
  if (!studentId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const admin = createAdminClient();
    const direct = await getDirectStatus(admin, studentId);
    if (direct) return NextResponse.json(direct);
    return NextResponse.json(await getStudentCalendarStatus(admin, studentId));
  } catch (err: any) {
    console.error('calendar status failed:', err?.message ?? err);
    return NextResponse.json({ error: 'Could not load your calendars' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const studentId = await currentStudentId();
  if (!studentId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const admin = createAdminClient();
  const body = await req.json().catch(() => ({}));
  if (body?.action === 'confirm') {
    try {
      const result = await confirmStudent(admin, studentId);
      const status = await getStudentCalendarStatus(admin, studentId);
      return NextResponse.json({ ...result, status }, { status: result.ok ? 200 : 400 });
    } catch (err: any) {
      console.error('calendar confirm failed:', err?.message ?? err);
      return NextResponse.json({ error: 'Could not save — try again in a minute' }, { status: 500 });
    }
  }
  try {
    const result = await subscribeStudent(admin, studentId, 'self');
    const status = await getStudentCalendarStatus(admin, studentId);
    return NextResponse.json({ ...result, status });
  } catch (err: any) {
    console.error('calendar subscribe failed:', err?.message ?? err);
    return NextResponse.json({ error: 'Could not add your calendars — try again in a minute' }, { status: 500 });
  }
}
