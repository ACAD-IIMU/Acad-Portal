import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { buildPlan } from '@/lib/calendarInvites';

// Asked by the Apps Script inside acad@iimu.ac.in every 5 minutes:
// "what should I create, change or remove on the calendar?"
//
//   POST  → the real plan (Apps Script). Records that a run happened.
//   GET   → a read-only preview for humans: counts and a sample, no student emails,
//           nothing written. Open in a browser:
//           https://acad-student-portal.vercel.app/api/calendar/invites/plan?secret=YOUR_SECRET
//
// Both need CALENDAR_SYNC_SECRET (Vercel → Settings → Environment Variables), sent as
// "Authorization: Bearer <secret>" or as ?secret=<secret>.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const expected = process.env.CALENDAR_SYNC_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization');
  const param = new URL(req.url).searchParams.get('secret');
  return header === `Bearer ${expected}` || param === expected;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const plan = await buildPlan(createAdminClient(), { preview: false });
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
      note: 'Preview only — nothing was changed. Emails are never listed here.',
      paused: plan.paused,
      held: plan.held,
      reason: plan.reason,
      totalOperationsWaiting: plan.totalOps,
      perBatch: plan.stats,
      sample: plan.ops.slice(0, 25).map((op) => ({
        action: op.op,
        title: op.summary,
        starts: op.startAt,
        room: op.location,
        guests: Array.isArray((op.resource as any)?.attendees) ? (op.resource as any).attendees.length : null,
        emailsStudents: op.sendUpdates === 'all',
        why: op.reason
      }))
    });
  } catch (err: any) {
    console.error('calendar plan preview failed:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
