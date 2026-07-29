import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { parseTimetableWorkbook, normalizeCode } from "@/lib/parseTimetable";

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

const FILE_ID = "1OjH92BHuiKBIqai-YTiR0Hx2DFZ2lkpM"; // MBA 2025-27 Batch Timetable.xlsx
const TERM = "Term IV";

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const fileRes = await drive.files.get(
      { fileId: FILE_ID, alt: "media" },
      { responseType: "arraybuffer" }
    );
    buffer = Buffer.from(fileRes.data as ArrayBuffer);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to download timetable from Drive", detail: err.message },
      { status: 502 }
    );
  }

  // 2) Parse it.
  const { sessions, unmapped, skippedStrikethrough } = parseTimetableWorkbook(buffer);

  // 3) Resolve subject_id / section_id via the tables already populated from the enrollment import.
  const { data: subjects, error: subjErr } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("term", TERM);
  if (subjErr) {
    return NextResponse.json({ error: "Failed to load subjects", detail: subjErr.message }, { status: 500 });
  }
  const subjectByNormCode = new Map(subjects.map((s) => [normalizeCode(s.name), s.id]));

  const { data: sections, error: secErr } = await supabase
    .from("sections")
    .select("id, subject_id, section_label")
    .eq("term", TERM);
  if (secErr) {
    return NextResponse.json({ error: "Failed to load sections", detail: secErr.message }, { status: 500 });
  }
  const sectionByKey = new Map(
    sections.map((s) => [`${s.subject_id}::${s.section_label}`, s.id])
  );

  const rowsToInsert: Array<{
    subject_id: string;
    term: string;
    section_id: string | null;
    session_date: string;
    start_time: string;
    end_time: string;
    room: string | null;
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
      section_id: sectionId,
      session_date: s.sessionDate,
      start_time: s.startTime,
      end_time: s.endTime,
      room: s.room,
    });
  }

  // 4) Full-replace strategy: the sheet is the source of truth, sessions is a read cache of it.
  //    Simpler and safer than trying to diff/merge given reschedules already observed in this data.
  const { error: deleteErr } = await supabase.from("sessions").delete().eq("term", TERM);
  if (deleteErr) {
    return NextResponse.json({ error: "Failed to clear old sessions", detail: deleteErr.message }, { status: 500 });
  }

  const { error: insertErr } = await supabase.from("sessions").insert(rowsToInsert);
  if (insertErr) {
    return NextResponse.json({ error: "Failed to insert new sessions", detail: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    inserted: rowsToInsert.length,
    unresolvedSubjectCodes: [...new Set(unresolvedSubjects)],
    skippedStrikethrough: skippedStrikethrough.length,
    unmapped: unmapped.length,
    unmappedSample: unmapped.slice(0, 30), // full list would be large; sample + counts for a quick read
    syncedAt: new Date().toISOString(),
  });
}
