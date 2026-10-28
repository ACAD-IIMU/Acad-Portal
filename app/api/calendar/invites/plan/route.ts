import { NextResponse } from 'next/server';
import { getDeadline, waitUntil } from '@vercel/functions';
import { createAdminClient } from '@/lib/supabase/server';
import { buildPlan } from '@/lib/calendarInvites';
import { runPersonalSync } from '@/lib/personalCalendar';

// Asked by the Apps Script inside acad@iimu.ac.in every 5 minutes:
// "what should I create, change or remove on the calendars?"
//
//   POST  → the real plan (Apps Script). Records that a run happened. Right after answering,
//           keeps working in the background for ~3.5 min on direct mode (students' classes in
//           their own main calendar — lib/personalCalendar.ts), so that never waits behind
//           acad@'s own invite changes.
//   GET   → a read-only preview for humans: counts and a sample, no student emails,
//           nothing written. Open in a browser:
//           https://acad-student-portal.vercel.app/api/calendar/invites/plan?secret=YOUR_SECRET
//
// Both need CALENDAR_SYNC_SECRET (Vercel → Settings → Environment Variables), sent as
// "Authorization: Bearer <secret>" or as ?secret=<secret>.

export const dynamic = 'force-dynamic';
// 300 s = the Vercel Hobby maximum with Fluid compute (enabled for this project). The plan
// itself answers in seconds; the rest is for direct mode in the background (see below).
export const maxDuration = 300;

// Direct mode stops writing after this long, so it is always finished well before acad@'s
// next run (every 5 minutes) asks for a new plan — two runs never overlap.
const DIRECT_WRITE_MS = 210_000;

function isAuthorized(req: Request): boolean {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization');
  const param = new URL(req.url).searchParams.get('secret');
  return header === `Bearer ${expected}` || param === expected;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const started = Date.now();
  try {
    const admin = createAdminClient();
    const plan = await buildPlan(admin, { preview: false });
    // Not while paused or on hold — a held change must not reach students' calendars either.
    if (!plan.paused && !plan.held) waitUntil(directInBackground(admin, started));
    return NextResponse.json(plan);
  } catch (err: any) {
    console.error('calendar plan failed:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const plan = await buildPlan(createAdminClient(), { preview: true });
    return NextResponse.json({
      note: 'Preview only — nothing was changed. Student emails are never listed here.',
      paused: plan.paused,
      held: plan.held,
      reason: plan.reason,
      totalOperationsWaiting: plan.totalOps,
      perBatch: plan.stats,
      sample: plan.ops.slice(0, 25).map((op) => ({
        action: op.op,
        title: op.summary,
        calendar: op.op === 'createCalendar' ? '(new section calendar)' : op.calendarId === 'primary' ? 'acad@ (old guest invite)' : 'section calendar',
        starts: op.op === 'createCalendar' ? null : op.startAt,
        room: op.location,
        guests: Array.isArray((op.resource as any)?.attendees) ? (op.resource as any).attendees.length : null,
        emailsStudents: op.sendUpdates === 'all',
        phoneAlerts: op.notify ? op.notify.studentIds.length : 0,
        alertText: op.notify ? `${op.notify.title} — ${op.notify.body}` : null,
        why: op.reason
      }))
    });
  } catch (err: any) {
    console.error('calendar plan preview failed:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

async function directInBackground(admin: ReturnType<typeof createAdminClient>, started: number) {
  const end = getDeadline()?.getTime() ?? started + maxDuration * 1000;
  // Leave time to save and finish cleanly, and never run into the next 5-minute run.
  const budget = Math.min(end - Date.now() - 20_000, started + DIRECT_WRITE_MS - Date.now());
  if (budget < 5_000) return;
  try {
    const result = await runPersonalSync(admin, budget);
    console.log('direct calendar sync:', JSON.stringify(result));
  } catch (err: any) {
    console.error('direct calendar sync failed:', err?.message ?? err);
  }
}
