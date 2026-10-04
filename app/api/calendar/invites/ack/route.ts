import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { recordResults, type AckResult } from '@/lib/calendarInvites';

// Called by the Apps Script after it has carried out a plan: "here is what I did".
// Successful creates/updates are saved to calendar_invite_ledger, successful deletes are
// removed from it, and every attempt (success or failure) goes to calendar_invite_log.
// Anything that failed or was not attempted simply shows up again in the next plan.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return false;
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { results?: AckResult[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const results = Array.isArray(body.results) ? body.results : [];
  const valid = results.filter(
    (r) =>
      r &&
      (r.op === 'create' || r.op === 'update' || r.op === 'delete') &&
      typeof r.key === 'string' &&
      typeof r.eventId === 'string' &&
      typeof r.ok === 'boolean'
  );

  try {
    const summary = await recordResults(createAdminClient(), valid);
    return NextResponse.json({ ok: true, received: results.length, ...summary });
  } catch (err: any) {
    console.error('calendar ack failed:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
