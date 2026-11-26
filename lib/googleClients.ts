// Google API clients — light and loaded only when actually needed (Nov 2026 CPU fix).
//
// Why this file exists: Vercel bills Fluid "Active CPU", and on the Hobby plan only 4 CPU-hours
// a month are free. The full `googleapis` package costs ~0.5 s of CPU just to LOAD (it pulls in
// every Google API there is), and our machine routes (timetable sync, the acad@ calendar plan,
// feeds/subscribe) start cold almost every run — so most of their CPU went on loading a library
// that a skipped run never even used.
//
// Now:
//   - only the two APIs we use are installed (@googleapis/calendar, @googleapis/drive),
//     ~70 ms each to load instead of ~500 ms;
//   - they are imported here with `await import(...)`, i.e. only when a function below is
//     actually called. A run that skips (nothing changed) or a page that only reads the
//     database never loads them at all.
//
// Everything else in the app should get its Google clients from here, never by importing the
// Google packages at the top of a file (a top-level import loads them on every cold start).
// `import type { ... }` is fine anywhere — types disappear at build time.

import type { calendar_v3 } from '@googleapis/calendar';
import type { drive_v3 } from '@googleapis/drive';

export type { calendar_v3, drive_v3 };

/** Calendar client acting as a student (their stored refresh token, portal OAuth app). */
export async function calendarForRefreshToken(refreshToken: string | null | undefined): Promise<calendar_v3.Calendar> {
  const { calendar, auth } = await import('@googleapis/calendar');
  const oauth2Client = new auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: refreshToken ?? undefined });
  return calendar({ version: 'v3', auth: oauth2Client });
}

type ServiceAccount = { email: string | undefined; privateKey: string | undefined; scopes: string[] };

// A service account signs its own tokens (JWT) — no key file, no extra lookups.
async function serviceAccountAuth(sa: ServiceAccount) {
  const { auth } = await import('@googleapis/drive');
  return new auth.JWT({
    email: sa.email,
    // Vercel stores the key with literal "\n" — turn them back into real line breaks.
    key: sa.privateKey?.replace(/\\n/g, '\n'),
    scopes: sa.scopes
  });
}

/** Drive client acting as a service account. */
export async function driveForServiceAccount(sa: ServiceAccount): Promise<drive_v3.Drive> {
  const [{ drive }, jwt] = await Promise.all([import('@googleapis/drive'), serviceAccountAuth(sa)]);
  return drive({ version: 'v3', auth: jwt });
}

/** A bare OAuth access token for a service account (for raw REST calls). */
export async function serviceAccountAccessToken(sa: ServiceAccount): Promise<string> {
  const jwt = await serviceAccountAuth(sa);
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error('Failed to obtain access token');
  return token;
}

// The two service accounts the portal uses.
export const TIMETABLE_SERVICE_ACCOUNT = (): ServiceAccount => ({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/drive.readonly']
});

export const PREREAD_SERVICE_ACCOUNT = (): ServiceAccount => ({
  email: process.env.PREREAD_SERVICE_ACCOUNT_EMAIL,
  privateKey: process.env.PREREAD_SERVICE_ACCOUNT_PRIVATE_KEY,
  // Full drive scope (not drive.readonly) — this same account both uploads (SR) and
  // downloads (students) prereads, and is only ever shared access to the one folder
  // it was explicitly given, so scope breadth beyond that isn't a real exposure.
  scopes: ['https://www.googleapis.com/auth/drive']
});

/** A bare access token acting as a student (for raw REST calls such as Calendar batch requests). */
export async function accessTokenForRefreshToken(refreshToken: string | null | undefined): Promise<string> {
  const { auth } = await import('@googleapis/calendar');
  const oauth2Client = new auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: refreshToken ?? undefined });
  const { token } = await oauth2Client.getAccessToken();
  if (!token) throw new Error('invalid_grant: no access token returned for this student');
  return token;
}
