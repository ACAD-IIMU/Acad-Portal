import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { runAutoSubscribe } from '@/lib/calendarFeeds';

// Called by the Apps Script inside acad@ at the end of every run (every 5 minutes): adds any
// missing ACAD section calendars for students NOT in direct mode who granted the calendar-list
// permission. Anything not finished is picked up on the next run.
//
// Direct mode (classes straight into students' main calendars) no longer runs here — it runs
// in the background of /api/calendar/invites/plan, at the START of each run, so it never waits
// behind acad@'s own invite changes.
//
// Needs CALENDAR_SYNC_SECRET as "Authorization: Bearer <secret>" (or ?secret= for a
// manual test in the browser with GET).

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization');
  const param = new URL(req.url).searchParams.get('secret');
  return header === `Bearer ${expected}` || param === expected;
}

async function run(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await runAutoSubscribe(createAdminClient(), 45_000);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('auto-subscribe failed:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

export const POST = run;
export const GET = run;
