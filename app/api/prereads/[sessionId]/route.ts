import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPrereadFile } from '@/lib/googleDrive';

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  // Deliberately using the RLS-scoped client (not the admin client) here — the
  // "students see prereads for their sessions" policy is what actually enforces that a
  // student can only pull a file for a session they're enrolled in.
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: preread, error } = await supabase
    .from('prereads')
    .select('drive_file_id')
    .eq('session_id', params.sessionId)
    .maybeSingle();

  if (error || !preread?.drive_file_id) {
    return NextResponse.json({ error: 'Preread not found or not accessible' }, { status: 404 });
  }

  const { meta, stream } = await getPrereadFile(preread.drive_file_id);

  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': meta.mimeType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${meta.name ?? 'preread'}"`
    }
  });
}
