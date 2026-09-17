import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { parseTimetableWorkbook, normalizeCode, ParsedSession, UnmappedEntry } from "@/lib/parseTimetable";
import { parseGridTimetableWorkbook } from "@/lib/parseGridTimetable";
import { extractEventsFromUnmapped } from "@/lib/parseEvents";
import { TERM_5 } from "@/lib/term5";
import { TERM_1 } from "@/lib/term1";

// Protects this endpoint from being hit by anyone but Vercel Cron / you manually.
// Vercel Cron sends this header automatically; for manual testing, pass ?secret=... instead.
function isAuthorized(req: Request): boolean {
  const url = new URL(req.url);
  const secretParam = url.searchParams.get("secret");
  const cronHeader = req.headers.get("authorization");
  return (
    secretParam === process.env.SYNC_SECRET ||
    cronHeader === `Bearer ${process.env.CRON_SECRET}`
  );
}

// Now batch-parameterized via ?batch=mba1|mba2 (defaults to mba2 -- the existing
// Vercel Cron entry hits this route with NO query string at all, so the default has
// to reproduce exactly what this route always did, unchanged, for that cron to keep
// working without also editing vercel.json's existing entry).
//
// mba1's fileId points at a NATIVE Google Sheet (confirmed directly via the
// check-mba1-drive-access.ts diagnostic — mimeType
// application/vnd.google-apps.spreadsheet), not an uploaded .xlsx like mba2's file,
// hence isNativeSheet + the files.export branch below instead of files.get.
//
// IMPORTANT, not yet resolved by this file (flagging rather than pretending
// otherwise): calling this route with ?batch=mba1 will run without error but
// currently resolve ZERO sessions, because `subjects`/`sections` rows for MBA1/
// Term I don't exist in the DB yet -- nothing has populated them. This route only
// ever *queries* those tables (see step 3 below), matching MBA2's own existing
// contract ("via the tables already populated from the enrollment import" -- a
// separate, not-yet-built process for MBA1). Safe to deploy and test now regardless:
// with nothing resolved, every session falls into `unresolvedSubjectCodes` in the
// response instead of silently going missing, which is exactly the signal needed to
// confirm subjects/sections are the next real gap, not a crash or bad data.
interface ParseResult {
  sessions: ParsedSession[];
  unmapped: UnmappedEntry[];
  skippedStrikethrough: UnmappedEntry[];
}

const BATCH_CONFIGS: Record<
  string,
  {
    fileId: string;
    term: string;
    batchLabel: string;
    isNativeSheet: boolean;
    parse: (buffer: Buffer, term: string) => Promise<ParseResult>;
  }
> = {
  mba2: {
    fileId: "1OjH92BHuiKBIqai-YTiR0Hx2DFZ2lkpM", // MBA 2025-27 Batch Timetable.xlsx
    term: TERM_5,
    batchLabel: "MBA 2025-27",
    isNativeSheet: false,
    parse: parseTimetableWorkbook,
  },
  mba1: {
    fileId: "1U-SwYxSrFhmrfggRaVtp-v3zmnH1cKAATvjzHskArps", // MBA 2026-28 Batch Timetable (native Google Sheet)
    term: TERM_1,
    batchLabel: "MBA 2026-28",
    isNativeSheet: true,
    parse: parseGridTimetableWorkbook,
  },
};

// Known abbreviations used in the sheet(s) that don't normalize-match the full
// subject name. Kept shared across batches for now -- harmless for whichever batch
// doesn't trigger a given alias, and MBA1's own set (if any turn out to be needed)
// isn't known yet since only Term I has been inspected so far.
const EVENT_CODE_ALIASES: Record<string, string> = {
  REV: "REVMGMT" // "ReV" alone, used in MBA2's end-of-term exam block, for "Rev Mgmt"
};

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const batchParam = url.searchParams.get("batch") ?? "mba2";
  const config = BATCH_CONFIGS[batchParam];
  if (!config) {
    return NextResponse.json(
      { error: `Unknown batch "${batchParam}". Valid values: ${Object.keys(BATCH_CONFIGS).join(", ")}` },
      { status: 400 }
    );
  }
  const TERM = config.term;
  const BATCH_LABEL = config.batchLabel;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, // matches the var name already set in this project
    process.env.SUPABASE_SERVICE_ROLE_KEY! // service role — RLS doesn't apply, this runs server-side only
  );

  // 1) Auth as the service account and pull the raw file bytes from Drive.
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });

  let buffer: Buffer;
  try {
    if (config.isNativeSheet) {
      // Native Google Sheets can't be downloaded via files.get -- Drive rejects that
      // with "This file cannot be downloaded directly. Please use Export instead."
      // Confirmed directly for mba1's file before writing this branch, not assumed.
      const fileRes = await drive.files.export(
        {
          fileId: config.fileId,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        { responseType: "arraybuffer" }
      );
      buffer = Buffer.from(fileRes.data as ArrayBuffer);
    } else {
      const fileRes = await drive.files.get(
        { fileId: config.fileId, alt: "media" },
        { responseType: "arraybuffer" }
      );
      buffer = Buffer.from(fileRes.data as ArrayBuffer);
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to download timetable from Drive", detail: err.message },
      { status: 502 }
    );
  }

  // 2) Parse it -- MBA2 uses the existing per-slot-column parser; MBA1 uses the
  //    section-block-column parser (see lib/parseGridTimetable.ts for why they're
  //    genuinely different grammars, not a config-swap of the same one).
  const { sessions, unmapped, skippedStrikethrough } = await config.parse(buffer, TERM);

  // 3) Resolve subject_id / section_id via the tables already populated from the
  //    enrollment import. Now scoped by batch_label as well as term -- this is the
  //    exact reason that column was added (see the batch_label_step*.sql migration):
  //    without it, the moment MBA1 and some future batch ever share a term label,
  //    this lookup would silently match the wrong batch's subject rows.
  const { data: subjects, error: subjErr } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("term", TERM)
    .eq("batch_label", BATCH_LABEL);
  if (subjErr) {
    return NextResponse.json({ error: "Failed to load subjects", detail: subjErr.message }, { status: 500 });
  }
  const subjectByNormCode = new Map(subjects.map((s) => [normalizeCode(s.name), s.id]));

  const { data: sections, error: secErr } = await supabase
    .from("sections")
    .select("id, subject_id, section_label")
    .eq("term", TERM)
    .eq("batch_label", BATCH_LABEL);
  if (secErr) {
    return NextResponse.json({ error: "Failed to load sections", detail: secErr.message }, { status: 500 });
  }
  const sectionByKey = new Map(
    sections.map((s) => [`${s.subject_id}::${s.section_label}`, s.id])
  );

  const rowsToInsert: Array<{
    subject_id: string;
    term: string;
    batch_label: string;
    section_id: string | null;
    session_number: number;
    session_date: string;
    start_time: string;
    end_time: string;
    room: string | null;
    session_label: string | null;
  }> = [];
  const unresolvedSubjects: string[] = [];

  for (const s of sessions) {
    const subjectId = subjectByNormCode.get(s.subjectCode);
    if (!subjectId) {
      unresolvedSubjects.push(`${s.rawCode} (normalized: ${s.subjectCode})`);
      continue;
    }
    const sectionId = s.sectionLabel
      ? sectionByKey.get(`${subjectId}::${s.sectionLabel}`) ?? null
      : null;

    rowsToInsert.push({
      subject_id: subjectId,
      term: TERM,
      batch_label: BATCH_LABEL,
      section_id: sectionId,
      session_number: s.sessionNumber,
      session_date: s.sessionDate,
      start_time: s.startTime,
      end_time: s.endTime,
      room: s.room,
      // Null for every normal numbered class; set for MBA2's named one-offs (e.g.
      // "COIL Interaction") and for MBA1's unnumbered/Cohort entries (e.g. "MOC",
      // "Excel Cohort 2, Session 6 (LAB)") -- see lib/parseGridTimetable.ts.
      session_label: s.sessionLabel,
    });
  }

  // 4) Atomic upsert: matches each row against its stable natural key (subject, section,
  //    term, session_number) — updates in place if that class already existed (keeping its
  //    id stable, so anything attached to it like a future preread stays attached), inserts
  //    if genuinely new, and removes anything no longer present in this sync's data. All in
  //    one Postgres function call, so a failure partway through can't leave sessions half-
  //    deleted the way the old separate delete-then-insert calls could.
  //
  //    NOT YET CONFIRMED (flagging rather than assuming): whether sync_sessions_for_term
  //    (a Postgres function, not tracked in this repo -- same as other ad-hoc DB
  //    objects) itself scopes its delete/match logic by batch_label as well as term,
  //    now that the column exists. It isn't a problem THIS year (mba1's "Term I" and
  //    mba2's "Term V" don't collide), but is worth checking -- and updating if
  //    needed -- before relying on this for a second full academic cycle.
  const { data: syncResult, error: syncErr } = await supabase.rpc("sync_sessions_for_term", {
    target_term: TERM,
    target_batch_label: BATCH_LABEL,
    rows: rowsToInsert,
  });
  if (syncErr) {
    return NextResponse.json({ error: "Failed to sync sessions", detail: syncErr.message }, { status: 500 });
  }
  const { upserted_count: upsertedCount, deleted_count: deletedCount } = syncResult[0];

  // 5) Classify whatever didn't match a session pattern: quizzes, exams, tutorials, guest
  //    sessions, registration all get pulled out here; anything left over genuinely isn't
  //    an event (e.g. the MG joint-period notation) and stays in the final unmapped list.
  const { events, stillUnmapped } = extractEventsFromUnmapped(unmapped);

  const eventRowsToInsert: Array<{
    term: string;
    batch_label: string;
    event_date: string;
    type: "quiz" | "endterm" | "other";
    label: string;
    subject_id: string | null;
  }> = events.map((e) => ({
    term: TERM,
    batch_label: BATCH_LABEL,
    event_date: e.eventDate,
    type: e.type,
    label: e.label,
    // Reuses the same subject map already built for sessions above — no extra query needed.
    // Null is fine here (e.g. "Registration" has no subject); the column allows it.
    subject_id: e.subjectCodeRaw
      ? subjectByNormCode.get(normalizeCode(e.subjectCodeRaw)) ??
        subjectByNormCode.get(EVENT_CODE_ALIASES[normalizeCode(e.subjectCodeRaw)] ?? "") ??
        null
      : null
  }));

  // Guard against exactly what just happened: a parse that comes back with zero events
  // (wrong sheet, corrupted source data, etc.) should never wipe existing real events —
  // leaving one cycle's data stale is far safer than deleting real quiz/exam reminders
  // with nothing to replace them. Only touch important_events if there's something to
  // actually replace it with. Scoped by batch_label now too, so a stale mba1 sync can
  // never wipe mba2's events (or vice versa) even if they ever shared a term label.
  if (eventRowsToInsert.length > 0) {
    const { error: deleteEventsErr } = await supabase
      .from("important_events")
      .delete()
      .eq("term", TERM)
      .eq("batch_label", BATCH_LABEL);
    if (deleteEventsErr) {
      return NextResponse.json(
        { error: "Failed to clear old important_events", detail: deleteEventsErr.message },
        { status: 500 }
      );
    }

    const { error: insertEventsErr } = await supabase.from("important_events").insert(eventRowsToInsert);
    if (insertEventsErr) {
      return NextResponse.json(
        { error: "Failed to insert important_events", detail: insertEventsErr.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    batch: batchParam,
    term: TERM,
    sessionsProcessed: rowsToInsert.length,
    sessionsUpsertedOrUnchanged: upsertedCount,
    sessionsRemoved: deletedCount,
    unresolvedSubjectCodes: [...new Set(unresolvedSubjects)],
    skippedStrikethrough: skippedStrikethrough.length,
    eventsInserted: eventRowsToInsert.length,
    unmapped: stillUnmapped.length,
    unmappedSample: stillUnmapped.slice(0, 30), // full list would be large; sample + counts for a quick read
    syncedAt: new Date().toISOString(),
  });
}
