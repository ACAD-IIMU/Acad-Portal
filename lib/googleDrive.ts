import { google } from 'googleapis';

function getDriveClient() {
  // GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY is the full service-account JSON key file,
  // base64-encoded, stored as a single-line env var (see .env.local.example).
  const keyJson = Buffer.from(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY ?? '', 'base64').toString('utf-8');
  const credentials = JSON.parse(keyJson);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({ version: 'v3', auth });
}

export async function getPrereadFile(fileId: string) {
  const drive = getDriveClient();

  const { data: meta } = await drive.files.get({
    fileId,
    fields: 'name, mimeType, size'
  });

  const { data: stream } = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return { meta, stream };
}
