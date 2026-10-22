import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { pushConfigured, sendTestPush } from '@/lib/pushNotify';

// Turns phone notifications ("class alerts") on or off for the signed-in student's
// current browser / phone.
//   POST   { subscription: PushSubscriptionJSON }  → saves it and sends a confirmation
//   DELETE { endpoint }                            → removes it

export const dynamic = 'force-dynamic';

async function currentStudentId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const { data } = await createAdminClient().from('students').select('id').eq('email', user.email).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function POST(req: Request) {
  const studentId = await currentStudentId();
  if (!studentId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: 'Alerts are not set up on the portal yet' }, { status: 503 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const sub = body?.subscription;
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : null;
  const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : null;
  const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : null;
  if (!endpoint || !p256dh || !auth || !endpoint.startsWith('https://')) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from('push_subscriptions')
    .upsert(
      {
        student_id: studentId,
        endpoint,
        p256dh,
        auth,
        user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300),
        failure_count: 0
      },
      { onConflict: 'endpoint' }
    );
  if (error) {
    console.error('push subscribe failed:', error.message);
    return NextResponse.json({ error: 'Could not save — try again' }, { status: 500 });
  }

  let confirmed = false;
  try {
    confirmed = await sendTestPush(endpoint, { p256dh, auth });
  } catch (err: any) {
    console.error('confirmation push failed:', err?.statusCode ?? '', err?.message ?? err);
  }
  return NextResponse.json({ ok: true, confirmed });
}

export async function DELETE(req: Request) {
  const studentId = await currentStudentId();
  if (!studentId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await createAdminClient().from('push_subscriptions').delete().eq('endpoint', endpoint).eq('student_id', studentId);
  return NextResponse.json({ ok: true });
}
