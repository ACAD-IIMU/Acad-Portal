import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getStudentCalendarStatus, subscribeStudent } from '@/lib/calendarFeeds';

// The signed-in student's own ACAD section calendars.
//   GET  → which calendars they should have, and which are already in their Google Calendar
//   POST → add the missing ones now (the "Add my class calendars" button on Home)

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
    return NextResponse.json(await getStudentCalendarStatus(createAdminClient(), studentId));
  } catch (err: any) {
    console.error('calendar status failed:', err?.message ?? err);
    return NextResponse.json({ error: 'Could not load your calendars' }, { status: 500 });
  }
}

export async function POST() {
  const studentId = await currentStudentId();
  if (!studentId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const admin = createAdminClient();
  try {
    const result = await subscribeStudent(admin, studentId, 'self');
    const status = await getStudentCalendarStatus(admin, studentId);
    return NextResponse.json({ ...result, status });
  } catch (err: any) {
    console.error('calendar subscribe failed:', err?.message ?? err);
    return NextResponse.json({ error: 'Could not add your calendars — try again in a minute' }, { status: 500 });
  }
}
