// Skip calendar-sync runs when nothing has changed — the egress fix (Nov 2026).
//
// Every Apps Script run used to download the whole batch (enrollments, students, sections,
// sessions, and two ledgers of 16,000+ rows) even when the timetable hadn't moved. That
// was ~2 GB/day of Supabase egress and pushed the project over the Free plan.
//
// Now each run first asks Postgres for calendar_sync_fingerprint() — a hash of everything
// the sync reads, computed inside the database, so only a few bytes leave it
// (supabase/egress/step1_quiet_check.sql). A run is skipped only when ALL of these hold:
//   - skipping is switched on (calendar_invite_settings.quiet_skip_enabled)
//   - the fingerprint equals the one saved by the last run that found nothing to do
//   - that run was less than quiet_full_check_hours ago (safety net, default 3 h)
//   - no upcoming class is waiting out its "vanished from the timetable" grace period
//
// The saved fingerprint is the one taken at the START of the clean run, so a change that
// lands while a run is in progress is never mistaken for already-handled.
//
// Fails open: if the SQL step hasn't been run, or anything here errors, the run simply goes
// ahead in full exactly as before.

import type { SupabaseClient } from '@supabase/supabase-js';

export type GateKind = 'plan' | 'feeds';

export type Gate = {
  skip: boolean;
  fingerprint: string | null; // null = gate unavailable; never mark a run quiet with it
  reason: string;
};

type QuietRow = {
  quiet_skip_enabled: boolean | null;
  quiet_full_check_hours: number | null;
  quiet_plan_fp: string | null;
  quiet_plan_at: string | null;
  quiet_feeds_fp: string | null;
  quiet_feeds_at: string | null;
  quiet_skipped_runs: number | null;
};

const COLUMNS =
  'quiet_skip_enabled, quiet_full_check_hours, quiet_plan_fp, quiet_plan_at, quiet_feeds_fp, quiet_feeds_at, quiet_skipped_runs';

export async function openGate(admin: SupabaseClient, kind: GateKind): Promise<Gate> {
  try {
    const [{ data: row, error: rowError }, { data: fp, error: fpError }] = await Promise.all([
      admin.from('calendar_invite_settings').select(COLUMNS).eq('id', 1).maybeSingle(),
      admin.rpc('calendar_sync_fingerprint')
    ]);
    if (rowError || fpError || !row || !fp) {
      return { skip: false, fingerprint: null, reason: 'quiet check unavailable (run supabase/egress/step1_quiet_check.sql)' };
    }
    const q = row as unknown as QuietRow;
    const { fingerprint, pending } = fp as { fingerprint: string | null; pending: number | null };
    if (!fingerprint) return { skip: false, fingerprint: null, reason: 'no fingerprint' };

    const savedFp = kind === 'plan' ? q.quiet_plan_fp : q.quiet_feeds_fp;
    const savedAt = kind === 'plan' ? q.quiet_plan_at : q.quiet_feeds_at;
    const maxAgeMs = Math.max(1, q.quiet_full_check_hours ?? 3) * 60 * 60 * 1000;

    if (q.quiet_skip_enabled === false) return { skip: false, fingerprint, reason: 'skipping switched off' };
    if ((pending ?? 0) > 0) return { skip: false, fingerprint, reason: `${pending} vanished class(es) in grace period` };
    if (!savedFp || !savedAt) return { skip: false, fingerprint, reason: 'no quiet run recorded yet' };
    if (savedFp !== fingerprint) return { skip: false, fingerprint, reason: 'something changed' };
    if (Date.now() - Date.parse(savedAt) >= maxAgeMs) return { skip: false, fingerprint, reason: 'periodic full check' };

    // Counter only, so you can see in Supabase that skipping is happening. Best-effort.
    await admin
      .from('calendar_invite_settings')
      .update({ quiet_skipped_runs: (q.quiet_skipped_runs ?? 0) + 1 })
      .eq('id', 1);
    return { skip: true, fingerprint, reason: 'no changes since the last full check' };
  } catch (err: any) {
    console.warn('quiet check failed, running in full:', err?.message ?? err);
    return { skip: false, fingerprint: null, reason: 'quiet check failed' };
  }
}

// After a full run: save the start-of-run fingerprint if the run found nothing to do
// (fingerprint given), or clear it so the next run is full again (fingerprint null).
export async function closeGate(
  admin: SupabaseClient,
  kind: GateKind,
  fingerprint: string | null,
  note: string
): Promise<void> {
  const update =
    kind === 'plan'
      ? { quiet_plan_fp: fingerprint, quiet_plan_at: fingerprint ? new Date().toISOString() : null }
      : { quiet_feeds_fp: fingerprint, quiet_feeds_at: fingerprint ? new Date().toISOString() : null };
  try {
    const { error } = await admin
      .from('calendar_invite_settings')
      .update({ ...update, quiet_note: `${kind}: ${note}`.slice(0, 500) })
      .eq('id', 1);
    if (error) console.warn('quiet state not saved:', error.message);
  } catch (err: any) {
    console.warn('quiet state not saved:', err?.message ?? err);
  }
}
