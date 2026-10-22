// Phone notifications (Web Push) for last-minute timetable changes.
//
// Sent only for a class starting within the next 48 hours that is added, moved, changes
// room or is cancelled — and only to that class's own students, never the whole college.
// A student gets at most ONE notification per sync run: several changes are combined.
//
// Needs three Vercel environment variables (see apps-script/README.md):
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:acad@iimu.ac.in)
// Without them nothing is sent and nothing breaks.

import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushNote } from '@/lib/calendarInvites';

const PARALLEL_SENDS = 25;
const TTL_SECONDS = 6 * 60 * 60; // a phone that's off for longer than this doesn't need a stale alert
const MAX_FAILURES = 5; // drop a device after this many failed deliveries in a row

type Message = { title: string; body: string; tag: string; url: string };
type SubscriptionRow = { id: number; student_id: string; endpoint: string; p256dh: string; auth: string; failure_count: number };

let configured: boolean | null = null;
export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:acad@iimu.ac.in', publicKey, privateKey);
  configured = true;
  return true;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// One message per student, combining everything that changed for them in this run.
function combine(notes: PushNote[]): Map<string, Message> {
  const byStudent = new Map<string, PushNote[]>();
  for (const n of notes) {
    for (const id of n.studentIds) {
      if (!byStudent.has(id)) byStudent.set(id, []);
      const list = byStudent.get(id)!;
      if (!list.some((x) => x.tag === n.tag)) list.push(n);
    }
  }
  const out = new Map<string, Message>();
  for (const [id, list] of byStudent) {
    if (list.length === 1) {
      out.set(id, { title: list[0].title, body: list[0].body, tag: list[0].tag, url: '/home' });
    } else {
      out.set(id, {
        title: `${list.length} timetable changes`,
        body: list.slice(0, 3).map((n) => n.title).join(' · ') + (list.length > 3 ? ` · +${list.length - 3} more` : ''),
        tag: 'acad-multi',
        url: '/home'
      });
    }
  }
  return out;
}

async function sendToDevices(
  admin: SupabaseClient,
  rows: SubscriptionRow[],
  messageFor: (studentId: string) => Message | undefined
): Promise<Map<string, { devices: number; delivered: number; error: string | null }>> {
  const result = new Map<string, { devices: number; delivered: number; error: string | null }>();
  const gone: number[] = [];
  const failed: SubscriptionRow[] = [];
  const delivered: number[] = [];

  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      const message = messageFor(row.student_id);
      if (!message) continue;
      const r = result.get(row.student_id) ?? { devices: 0, delivered: 0, error: null };
      r.devices++;
      result.set(row.student_id, r);
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(message),
          { TTL: TTL_SECONDS, urgency: 'high' }
        );
        r.delivered++;
        delivered.push(row.id);
      } catch (err: any) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) gone.push(row.id); // the browser unsubscribed
        else failed.push(row);
        r.error = `${status ?? ''} ${String(err?.body ?? err?.message ?? err)}`.trim().slice(0, 300);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_SENDS }, worker));

  const nowIso = new Date().toISOString();
  for (const ids of chunk(gone, 200)) await admin.from('push_subscriptions').delete().in('id', ids);
  for (const ids of chunk(delivered, 200)) {
    await admin.from('push_subscriptions').update({ last_success_at: nowIso, failure_count: 0 }).in('id', ids);
  }
  for (const row of failed) {
    if (row.failure_count + 1 >= MAX_FAILURES) await admin.from('push_subscriptions').delete().eq('id', row.id);
    else await admin.from('push_subscriptions').update({ failure_count: row.failure_count + 1 }).eq('id', row.id);
  }
  return result;
}

async function devicesOf(admin: SupabaseClient, studentIds: string[]): Promise<SubscriptionRow[]> {
  const rows: SubscriptionRow[] = [];
  for (const ids of chunk(studentIds, 200)) {
    const { data, error } = await admin
      .from('push_subscriptions')
      .select('id, student_id, endpoint, p256dh, auth, failure_count')
      .in('student_id', ids);
    if (error) throw new Error(`push_subscriptions: ${error.message}`);
    rows.push(...((data ?? []) as SubscriptionRow[]));
  }
  return rows;
}

// Called by the ack route once the Apps Script has confirmed the calendar changes.
export async function sendPushNotes(admin: SupabaseClient, notes: PushNote[]) {
  if (notes.length === 0) return { students: 0, devices: 0, delivered: 0 };
  if (!pushConfigured()) return { students: 0, devices: 0, delivered: 0, skipped: 'VAPID keys not set' };

  const messages = combine(notes);
  const rows = await devicesOf(admin, [...messages.keys()]);
  const outcome = await sendToDevices(admin, rows, (id) => messages.get(id));

  const logRows = [...messages.entries()].map(([studentId, m]) => {
    const o = outcome.get(studentId);
    return {
      student_id: studentId,
      title: m.title,
      body: m.body,
      devices: o?.devices ?? 0,
      delivered: o?.delivered ?? 0,
      error: o ? o.error : 'no device with alerts turned on'
    };
  });
  for (const batch of chunk(logRows, 200)) await admin.from('push_log').insert(batch);

  let devices = 0;
  let delivered = 0;
  for (const o of outcome.values()) {
    devices += o.devices;
    delivered += o.delivered;
  }
  return { students: messages.size, devices, delivered };
}

// "Alerts are on" confirmation, sent to the one device that just turned them on.
export async function sendTestPush(endpoint: string, keys: { p256dh: string; auth: string }) {
  if (!pushConfigured()) return false;
  await webpush.sendNotification(
    { endpoint, keys },
    JSON.stringify({
      title: 'Class alerts are on',
      body: 'You’ll get a notification here if a class in the next 48 hours is moved, changes room or is cancelled.',
      tag: 'acad-welcome',
      url: '/home'
    }),
    { TTL: 60 * 60, urgency: 'normal' }
  );
  return true;
}
