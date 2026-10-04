import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { parseTimetableWorkbook, normalizeCode, ParsedSession, UnmappedEntry } from "@/lib/parseTimetable";
import { parseGridTimetableWorkbook, EndTermExamEntry } from "@/lib/parseGridTimetable";
import { extractEventsFromUnmapped } from "@/lib/parseEvents";
import { TERM_5 } from "@/lib/term5";
import { TERM_2 } from "@/lib/term2";

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
// UPDATE: mba1 now targets TERM_2 ('Term II') instead of TERM_1 -- Term I ended
// 26 Sep 2026 and MBA1's live term has rolled over, per the transition this config
// was always going to need (see lib/term2.ts's header comment). Term II's
// `subjects`/`sections` rows already exist in the DB (seeded + enrollments derived
// from Term I's own enrollment rows), so this route should resolve real sessions
// against them now, not fall into `unresolvedSubjectCodes` the way the original
// Term I run did on its first-ever call. If a sync run's response still shows a
// large unresolvedSubjectCodes list, that's the signal something in that seeding
// is actually missing or mismatched -- check it there, not here.
interface ParseResult {
  sessions: ParsedSession[];
  unmapped: UnmappedEntry[];
  skippedStrikethrough: UnmappedEntry[];
  // Only ever populated by parseGridTimetableWorkbook (MBA1) -- optional so
  // parseTimetableWorkbook's (MBA2) return type, which has no such concept, still
  // satisfies this same shared interface without needing a matching empty field.
  endTermExams?: EndTermExamEntry[];
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
    // Same workbook as before -- it has always had both a "Term-I" and a "Term-II"
    // tab (confirmed via wb.SheetNames when the Term-I parser was first built).
    // parseGridTimetableWorkbook matches its target sheet by normalizing `term`
    // against every tab name (see lib/parseGridTimetable.ts's
    // normalizeSheetName/matchedSheetName logic), so switching this to TERM_2 is
    // enough on its own to make this route read the "Term-II" tab instead --
    // no parser change needed, and nothing here needs a new fileId.
    fileId: "1U-SwYxSrFhmrfggRaVtp-v3zmnH1cKAATvjzHskArps", // MBA 2026-28 Batch Timetable (native Google Sheet)
    term: TERM_2,
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

  // Optional settle window (?settle=<seconds>), used by the frequent external scheduler
  // (cron-job.org), not by the daily Vercel cron. If the sheet was edited within the
  // last <settle> seconds, the office may be mid-edit (e.g. cleared the old slot but not
  // yet typed the new one) — syncing that half-state would tell students a class was
  // cancelled when it was only moving. So skip this run; the next one picks it up once
  // the sheet has been quiet. Best-effort: if the check itself fails, sync as normal.
  const settleSeconds = Number(url.searchParams.get("settle") ?? "0");
  if (Number.isFinite(settleSeconds) && settleSeconds > 0) {
    try {
      const meta = await drive.files.get({ fileId: config.fileId, fields: "modifiedTime" });
      const modifiedAt = meta.data.modifiedTime ? Date.parse(meta.data.modifiedTime) : NaN;
      const quietForMs = Date.now() - modifiedAt;
      if (!Number.isNaN(modifiedAt) && quietForMs < settleSeconds * 1000) {
        return NextResponse.json({
          ok: true,
          skipped: "settling",
          batch: batchParam,
          sheetLastEdited: meta.data.modifiedTime,
          quietForSeconds: Math.round(quietForMs / 1000),
          settleSeconds,
        });
      }
    } catch (err: any) {
      console.warn("settle check failed, syncing anyway:", err?.message ?? err);
    }
  }

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
  const { sessions, unmapped, skippedStrikethrough, endTermExams = [] } = await config.parse(buffer, TERM);

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

  // 3b) De-duplicate against the SAME natural key sync_sessions_for_term upserts on
  //     (subject, section, term, session_number). Postgres refuses an ON CONFLICT DO
  //     UPDATE whose input batch contains that key twice -- "command cannot affect row a
  //     second time" -- and rejects the WHOLE call, so a single duplicated cell in the
  //     source sheet takes down the entire sync rather than just itself. That is exactly
  //     what happened once a multi-line cell started yielding a real class (see
  //     lib/parseGridTimetable.ts): a session the sheet states twice became two rows.
  //
  //     Rows with a NULL session_number are deliberately NOT de-duplicated: Postgres
  //     treats NULLs as distinct in a unique index by default, so they cannot collide
  //     with each other, and collapsing them here would silently drop legitimately
  //     repeated named one-offs (MOC, "Excel Cohort 2", ...) that carry no number.
  //
  //     Duplicates are REPORTED, not silently swallowed -- a collision is usually a real
  //     quirk in the sheet worth a human look (the same class written into two slots),
  //     and the previous behavior of failing loudly at least made it visible. This keeps
  //     it visible while letting the other ~640 sessions through.
  const seenSessionKeys = new Set<string>();
  const duplicateSessions: string[] = [];
  const dedupedRowsToInsert = rowsToInsert.filter((r) => {
    if (r.session_number === null || r.session_number === undefined) return true;
    const key = `${r.subject_id}::${r.section_id ?? ""}::${r.session_number}`;
    if (seenSessionKeys.has(key)) {
      duplicateSessions.push(`session ${r.session_number} on ${r.session_date} (subject ${r.subject_id}, section ${r.section_id ?? "none"})`);
      return false;
    }
    seenSessionKeys.add(key);
    return true;
  });

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
    rows: dedupedRowsToInsert,
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
    location: string | null;
  }> = events.map((e) => ({
    term: TERM,
    batch_label: BATCH_LABEL,
    event_date: e.eventDate,
    type: e.type,
    label: e.label,
    // Venue, when the source cell states one -- only Guest Session / Tutorial /
    // Additional Session cells ever do (see lib/parseEvents.ts's Pass 3). Null for
    // everything else, which is exactly what the column allows.
    location: e.location ?? null,
    // Reuses the same subject map already built for sessions above — no extra query needed.
    // Null is fine here (e.g. "Registration" has no subject); the column allows it.
    subject_id: e.subjectCodeRaw
      ? subjectByNormCode.get(normalizeCode(e.subjectCodeRaw)) ??
        subjectByNormCode.get(EVENT_CODE_ALIASES[normalizeCode(e.subjectCodeRaw)] ?? "") ??
        null
      : null
  }));

  // MBA1-only: End-Term exam week entries (see lib/parseGridTimetable.ts) never go
  // through extractEventsFromUnmapped above -- they're identified by matching a
  // subject's full course title, not a Quiz/Exam keyword, so they need their own,
  // separate mapping into the same row shape. Capstone's subjectCode is null by
  // design (it isn't one of the 9 taught subjects), which subjectByNormCode.get
  // already handles the same way a subject-less Registration/Tutorial event does.
  eventRowsToInsert.push(
    ...endTermExams.map((e) => ({
      term: TERM,
      batch_label: BATCH_LABEL,
      event_date: e.eventDate,
      type: "endterm" as const,
      label: e.label,
      subject_id: e.subjectCode ? subjectByNormCode.get(normalizeCode(e.subjectCode)) ?? null : null,
      // Exam-week blocks state a start time (carried into the label) but never a venue.
      location: null
    }))
  );

  // De-duplicate: important_events has no section_id column (unlike `sessions`), so a
  // Quiz/Tutorial that genuinely runs separately per section (confirmed directly --
  // e.g. MBA1's "SM Tutorial 2" appears 5 times in one day's row, once per section,
  // each at a slightly different time) would otherwise become 5 near-identical rows
  // that every student sees all of, with no column to filter down to just their own
  // section. Collapsing to one reminder per (date, label, type, subject) is a
  // deliberate simplification given that schema gap, not an accident: a student is
  // better served by one "SM Tutorial 2 today" reminder than five, and the specific
  // per-section time difference isn't something a section-less table can correctly
  // convey per-student anyway.
  const seenEventKeys = new Set<string>();
  const dedupedEventRows = eventRowsToInsert.filter((e) => {
    const key = `${e.event_date}::${e.label}::${e.type}::${e.subject_id ?? ""}`;
    if (seenEventKeys.has(key)) return false;
    seenEventKeys.add(key);
    return true;
  });

  // Guard against exactly what just happened: a parse that comes back with zero events
  // (wrong sheet, corrupted source data, etc.) should never wipe existing real events —
  // leaving one cycle's data stale is far safer than deleting real quiz/exam reminders
  // with nothing to replace them. Only touch important_events if there's something to
  // actually replace it with. Scoped by batch_label now too, so a stale mba1 sync can
  // never wipe mba2's events (or vice versa) even if they ever shared a term label.
  if (dedupedEventRows.length > 0) {
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

    const { error: insertEventsErr } = await supabase.from("important_events").insert(dedupedEventRows);
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
    sessionsProcessed: dedupedRowsToInsert.length,
    // Non-zero means the sheet states the same (subject, section, session number) more
    // than once. Not fatal any more, but worth reading -- see the de-dup block above.
    duplicateSessionsDropped: duplicateSessions.length,
    duplicateSessionsSample: duplicateSessions.slice(0, 20),
    sessionsUpsertedOrUnchanged: upsertedCount,
    sessionsRemoved: deletedCount,
    unresolvedSubjectCodes: [...new Set(unresolvedSubjects)],
    skippedStrikethrough: skippedStrikethrough.length,
    eventsInserted: dedupedEventRows.length,
    unmapped: stillUnmapped.length,
    unmappedSample: stillUnmapped.slice(0, 30), // full list would be large; sample + counts for a quick read
    syncedAt: new Date().toISOString(),
  });
}
