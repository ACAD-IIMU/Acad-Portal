import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pushScheduleToCalendar } from '@/lib/googleCalendar';

// Default Vercel function timeout is 10s on Hobby — a student with a typical Term V
// course load (~6 subjects, ~120 sessions total) sequentially pushing one Google
// Calendar API call per session easily takes 20-40+ seconds, well past that default,
// which is what was actually causing "Failed to fetch": the function gets killed
// mid-request and the connection drops, which the browser reports as a generic network
// failure rather than a real error response. 60 is the max Hobby allows without Fluid
// Compute — paired with the concurrency fix in pushScheduleToCalendar itself (the real
// fix — this alone just buys headroom, it doesn't make the underlying work faster).
export const maxDuration = 60;

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
    const result = await pushScheduleToCalendar(student.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('Calendar push failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
