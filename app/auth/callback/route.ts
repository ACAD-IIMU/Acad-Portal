import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  // Created outside the try block so it's always available in the catch below,
  // even if something throws before we'd otherwise reach this line.
  const supabase = createClient();

  try {
    if (!code) {
      return NextResponse.redirect(`${origin}/login?error=missing_code`);
    }

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.session || !data.user) {
      console.error('exchangeCodeForSession failed:', error?.message, error);
      const detail = encodeURIComponent(error?.message ?? 'No session/user returned');
      return NextResponse.redirect(`${origin}/login?error=exchange_failed&detail=${detail}`);
    }

    const { user, session } = data;

    if (!user.email?.endsWith('@iimu.ac.in')) {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=domain`);
    }

    const admin = createAdminClient();

    const { data: studentRow, error: studentError } = await admin
      .from('students')
      .select('id, auth_user_id')
      .eq('email', user.email)
      .maybeSingle();

    if (studentError || !studentRow) {
      console.error('Student lookup failed:', user.email, studentError);
      await supabase.auth.signOut();
      const detail = encodeURIComponent(studentError?.message ?? `No students row found for ${user.email}`);
      return NextResponse.redirect(`${origin}/login?error=not_provisioned&detail=${detail}`);
    }

    if (!studentRow.auth_user_id) {
      const { error: updateError } = await admin
        .from('students')
        .update({ auth_user_id: user.id })
        .eq('id', studentRow.id);
      if (updateError) {
        console.error('Failed to link auth_user_id:', updateError);
        await supabase.auth.signOut();
        const detail = encodeURIComponent(updateError.message);
        return NextResponse.redirect(`${origin}/login?error=link_failed&detail=${detail}`);
      }
    }

    const providerRefreshToken = (session as any).provider_refresh_token as string | undefined;
    const providerToken = (session as any).provider_token as string | undefined;

    if (providerRefreshToken) {
      const { error: tokenError } = await admin.from('google_tokens').upsert({
        student_id: studentRow.id,
        refresh_token: providerRefreshToken,
        access_token: providerToken ?? null,
        expires_at: new Date(Date.now() + 3500 * 1000).toISOString(),
        scope: 'https://www.googleapis.com/auth/calendar.events',
        updated_at: new Date().toISOString()
      });
      if (tokenError) {
        console.error('Failed to store google token (non-fatal):', tokenError);
      }
    }

    return NextResponse.redirect(`${origin}/home`);
  } catch (err: any) {
    console.error('Unhandled error in /auth/callback:', err);
    // Best-effort — if a session was established before whatever failed, don't
    // leave it dangling; if signOut itself fails, we still want the redirect below.
    try {
      await supabase.auth.signOut();
    } catch (signOutErr) {
      console.error('signOut during error handling also failed:', signOutErr);
    }
    const detail = encodeURIComponent(err?.message ?? String(err));
    return NextResponse.redirect(`${origin}/login?error=unexpected&detail=${detail}`);
  }
}