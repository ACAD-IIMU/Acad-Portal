import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  const { user, session } = data;

  if (!user.email?.endsWith('@iimu.ac.in')) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  // Everything below needs to bypass RLS (linking a pre-provisioned row, writing a token
  // table with no policies) — that's exactly what the service-role admin client is for.
  const admin = createAdminClient();

  const { data: studentRow, error: studentError } = await admin
    .from('students')
    .select('id, auth_user_id')
    .eq('email', user.email)
    .maybeSingle();

  if (studentError || !studentRow) {
    // No pre-provisioned roster row for this email — ACAD needs to add them first.
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_provisioned`);
  }

  if (!studentRow.auth_user_id) {
    await admin.from('students').update({ auth_user_id: user.id }).eq('id', studentRow.id);
  }

  // Supabase only returns provider_token/provider_refresh_token right after the exchange —
  // capture and store it now, it won't be retrievable from a later getSession() call.
  const providerRefreshToken = (session as any).provider_refresh_token as string | undefined;
  const providerToken = (session as any).provider_token as string | undefined;

  if (providerRefreshToken) {
    await admin.from('google_tokens').upsert({
      student_id: studentRow.id,
      refresh_token: providerRefreshToken,
      access_token: providerToken ?? null,
      expires_at: new Date(Date.now() + 3500 * 1000).toISOString(),
      scope: 'https://www.googleapis.com/auth/calendar.events',
      updated_at: new Date().toISOString()
    });
  }
  // If providerRefreshToken is undefined, this usually means the student had already
  // granted consent before and Google didn't re-issue one — the queryParams `prompt:
  // 'consent'` on the login button is what forces a fresh one every time to avoid this.

  return NextResponse.redirect(`${origin}/home`);
}
