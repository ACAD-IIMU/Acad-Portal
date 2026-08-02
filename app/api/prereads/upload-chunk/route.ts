import { NextResponse, type NextRequest } from 'next/server';

// Relays ONE chunk to Google's resumable upload session. The browser never talks to
// Google directly (that's what caused the CORS failure) — it only ever talks to this
// same-origin route, which forwards each piece server-to-server.
export async function PUT(request: NextRequest) {
  const uploadUrl = request.headers.get('x-upload-url');
  const contentRange = request.headers.get('content-range');

  if (!uploadUrl || !contentRange) {
    return NextResponse.json({ error: 'x-upload-url and content-range headers are required' }, { status: 400 });
  }

  const chunk = await request.arrayBuffer();

  const googleRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Range': contentRange,
      'Content-Length': String(chunk.byteLength)
    },
    body: chunk
  });

  // 308 = Google has this chunk, send the next one (upload not complete yet).
  // 200/201 = this was the final chunk, upload is complete — body has the file metadata.
  const bodyText = await googleRes.text();
  return new NextResponse(bodyText, {
    status: googleRes.status,
    headers: { 'Content-Type': 'application/json' }
  });
}
