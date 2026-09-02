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

  const { reminderId } = await request.json();
  if (!reminderId) return NextResponse.json({ error: 'reminderId is required' }, { status: 400 });

  const { data: reminder } = await supabase
    .from('reminders')
    .select('id, created_by')
    .eq('id', reminderId)
    .maybeSingle();

  if (!reminder) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
  if (reminder.created_by !== student.id) {
    return NextResponse.json({ error: 'You can only delete your own reminders' }, { status: 403 });
  }

  const { error } = await supabase.from('reminders').delete().eq('id', reminderId);
  if (error) return NextResponse.json({ error: 'Failed to delete', detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
