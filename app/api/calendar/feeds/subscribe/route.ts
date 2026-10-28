import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { runAutoSubscribe } from '@/lib/calendarFeeds';
import { runPersonalSync } from '@/lib/personalCalendar';

// Called by the Apps Script inside acad@ after every run (every 5 minutes):
//   1. Direct mode (lib/personalCalendar.ts): keeps every direct-mode student's classes in
//      their own main Google Calendar — ~35 seconds of work per run.
//   2. Adds any missing ACAD section calendars for students NOT in direct mode who granted
//      the calendar-list permission — with whatever time is left.
// Anything not finished is picked up on the next run.
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
    const admin = createAdminClient();
    const started = Date.now();
    let direct: unknown = null;
    try {
      direct = await runPersonalSync(admin, 35_000);
    } catch (err: any) {
      console.error('direct calendar sync failed:', err?.message ?? err);
      direct = { error: err?.message ?? String(err) };
    }
    const left = 45_000 - (Date.now() - started);
    const result = left > 3_000 ? await runAutoSubscribe(admin, left) : { skipped: 'no time left this run' };
    return NextResponse.json({ ok: true, direct, ...result });
  } catch (err: any) {
    console.error('auto-subscribe failed:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

export const POST = run;
export const GET = run;
