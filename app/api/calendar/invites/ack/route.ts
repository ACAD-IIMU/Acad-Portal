import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { recordResults, type AckResult, type PushNote } from '@/lib/calendarInvites';
import { sendPushNotes } from '@/lib/pushNotify';

// Called by the Apps Script after it has carried out a plan: "here is what I did".
// Successful creates/updates are saved to calendar_invite_ledger, successful deletes are
// removed from it, new section calendars get their Google calendar ID recorded, and every
// attempt (success or failure) goes to calendar_invite_log. Anything that failed or was
// not attempted simply shows up again in the next plan.
//
// Then — only for changes Google confirmed — the phone notifications go out (class within
// 48 hours added / moved / room changed / cancelled, to that class's students only).

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OPS = new Set(['create', 'update', 'delete', 'createCalendar']);

function isAuthorized(req: Request): boolean {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return false;
  return req.headers.get('authorization') === `Bearer ${expected}`;
}

function validNote(n: unknown): n is PushNote {
  const x = n as PushNote;
  return !!x && typeof x.title === 'string' && typeof x.body === 'string' && typeof x.tag === 'string' &&
    Array.isArray(x.studentIds) && x.studentIds.every((id) => typeof id === 'string');
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
    (r) => r && OPS.has(r.op) && typeof r.key === 'string' && typeof r.eventId === 'string' && typeof r.ok === 'boolean'
  );

  const admin = createAdminClient();
  let summary: Awaited<ReturnType<typeof recordResults>>;
  try {
    summary = await recordResults(admin, valid);
  } catch (err: any) {
    console.error('calendar ack failed:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }

  // Phone alerts never fail the ack — the calendar itself is already right.
  let push: Record<string, unknown> = {};
  try {
    const notes = valid.filter((r) => r.ok && validNote(r.notify)).map((r) => r.notify as PushNote);
    push = await sendPushNotes(admin, notes);
  } catch (err: any) {
    console.error('push notifications failed:', err?.message ?? err);
    push = { error: err?.message ?? String(err) };
  }

  return NextResponse.json({ ok: true, received: results.length, ...summary, push });
}
