// Google Calendar batch requests — many calendar writes in ONE HTTP request (free-tier, Nov 2026).
//
// Why: direct mode (lib/personalCalendar.ts) writes every class into every student's own
// calendar. At a term change that is tens of thousands of writes, and each one used to be its
// own HTTPS request through the googleapis client — request building, TLS, headers, JSON parse,
// retries — all of which Vercel bills as Active CPU (4 h/month free on Hobby). A batch request
// carries up to 50 writes in one multipart/mixed body, so that per-request overhead is paid
// once per 50 writes instead of once per write. Google still counts each inner write against
// the quota as one request, so quotas don't change.
//
// Format (https://developers.google.com/workspace/calendar/api/guides/batch; batchPath from the
// Calendar discovery document is "batch/calendar/v3"):
//   POST https://www.googleapis.com/batch/calendar/v3
//   Authorization: Bearer <student access token>        ← applies to every inner call
//   Content-Type: multipart/mixed; boundary=<b>
//   each part: Content-Type: application/http, Content-ID: <iN>, then a full inner request
//   using only the path ("/calendar/v3/calendars/primary/events").
// The response is multipart/mixed too, one part per call, matched back by Content-ID
// ("response-<iN>"). Google may run the calls in any order — fine here, because one batch
// never holds two calls for the same event.

export const MAX_CALLS_PER_BATCH = 50; // Google allows 1000; 50 keeps one failed batch cheap to retry

export type BatchCall = {
  method: 'POST' | 'PUT' | 'DELETE';
  path: string; // e.g. /calendar/v3/calendars/primary/events?sendUpdates=none&fields=id
  body?: unknown;
};

export type BatchResult = {
  status: number; // HTTP status of this one call (0 = missing from the response)
  body: any; // parsed JSON body, or the raw text, or null
};

const BATCH_URL = 'https://www.googleapis.com/batch/calendar/v3';

export function buildBatchBody(calls: BatchCall[], boundary: string): string {
  const parts = calls.map((c, i) => {
    const lines = [
      `--${boundary}`,
      'Content-Type: application/http',
      `Content-ID: <i${i}>`,
      '',
      `${c.method} ${c.path} HTTP/1.1`
    ];
    if (c.body !== undefined) {
      const json = JSON.stringify(c.body);
      lines.push('Content-Type: application/json; charset=UTF-8');
      lines.push('');
      lines.push(json);
    } else {
      lines.push('');
    }
    return lines.join('\r\n');
  });
  return `${parts.join('\r\n')}\r\n--${boundary}--\r\n`;
}

/** Splits a multipart/mixed batch response back into one result per call, in call order. */
export function parseBatchResponse(text: string, boundary: string, count: number): BatchResult[] {
  const results: BatchResult[] = Array.from({ length: count }, () => ({ status: 0, body: null }));
  const chunks = text.split(`--${boundary}`);
  for (const raw of chunks) {
    const chunk = raw.replace(/^\r?\n/, '');
    if (!chunk.trim() || chunk.startsWith('--')) continue;
    // Outer part headers (Content-Type: application/http, Content-ID: <response-iN>), blank line,
    // then the inner HTTP response: status line, headers, blank line, body.
    const sep = chunk.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const outerHeaders = chunk.slice(0, sep);
    const inner = chunk.slice(sep).replace(/^\r?\n\r?\n/, '');
    const idMatch = /content-id:\s*<?response-i(\d+)>?/i.exec(outerHeaders);
    if (!idMatch) continue;
    const index = Number(idMatch[1]);
    if (!(index >= 0 && index < count)) continue;
    const statusMatch = /^HTTP\/[\d.]+\s+(\d{3})/.exec(inner);
    const status = statusMatch ? Number(statusMatch[1]) : 0;
    const innerSep = inner.search(/\r?\n\r?\n/);
    const bodyText = innerSep >= 0 ? inner.slice(innerSep).replace(/^\r?\n\r?\n/, '').trim() : '';
    let body: any = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }
    results[index] = { status, body };
  }
  return results;
}

/**
 * Sends up to MAX_CALLS_PER_BATCH calls in one request. Throws only if the batch request itself
 * fails (network, 401 on the whole batch, …) — per-call failures come back as statuses.
 */
export async function calendarBatch(accessToken: string, calls: BatchCall[]): Promise<BatchResult[]> {
  if (calls.length === 0) return [];
  if (calls.length > MAX_CALLS_PER_BATCH) throw new Error(`calendarBatch: at most ${MAX_CALLS_PER_BATCH} calls`);
  const boundary = `acad_batch_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const res = await fetch(BATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/mixed; boundary=${boundary}`
    },
    body: buildBatchBody(calls, boundary)
  });
  const text = await res.text();
  if (!res.ok) {
    const err: any = new Error(`Calendar batch request failed: ${res.status} ${text.slice(0, 300)}`);
    err.code = res.status;
    err.response = { status: res.status, data: text.slice(0, 1000) };
    throw err;
  }
  const ct = res.headers.get('content-type') ?? '';
  const m = /boundary=("?)([^";]+)\1/i.exec(ct);
  if (!m) throw new Error(`Calendar batch: no boundary in response content-type "${ct}"`);
  return parseBatchResponse(text, m[2], calls.length);
}

/** Turns one call's result into an error object shaped like a googleapis error (for classify()). */
export function batchError(r: BatchResult): any {
  const message =
    (r.body && typeof r.body === 'object' && r.body.error?.message) || (typeof r.body === 'string' ? r.body : '') || `HTTP ${r.status}`;
  const err: any = new Error(String(message).slice(0, 300));
  err.code = r.status;
  err.response = { status: r.status, data: r.body };
  return err;
}
