import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid or missing date (expected YYYY-MM-DD)' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // Same RLS-scoped client as the Home page's own server-side fetch — a student only
  // ever gets back sessions their own row is allowed to see under the existing policies.
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('*, subjects(name), sections(section_label), prereads(*)')
    .eq('session_date', date)
    .order('start_time');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: sessions ?? [] });
}
