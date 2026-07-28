import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pushScheduleToCalendar } from '@/lib/googleCalendar';

export async function POST() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { data: student } = await supabase.from('students').select('id').single();
  if (!student) {
    return NextResponse.json({ error: 'Student record not found' }, { status: 404 });
  }

  try {
    await pushScheduleToCalendar(student.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Calendar push failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
