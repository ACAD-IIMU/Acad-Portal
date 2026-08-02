import { google } from 'googleapis';
import { Readable } from 'stream';

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.PREREAD_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.PREREAD_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    // Full drive scope (not drive.readonly) — this same account both uploads (SR) and
    // downloads (students) prereads, and is only ever shared access to the one folder
    // it was explicitly given, so scope breadth beyond that isn't a real exposure.
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  return google.drive({ version: 'v3', auth });
}

export async function getFileMetadata(fileId: string) {
  const drive = getDriveClient();
  const { data } = await drive.files.get({ fileId, fields: 'id, name, mimeType' });
  return data;
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

export async function uploadPrereadFile(fileName: string, mimeType: string, buffer: Buffer) {
  const drive = getDriveClient();
  const folderId = process.env.PREREAD_DRIVE_FOLDER_ID;

  const { data } = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: folderId ? [folderId] : undefined
    },
    media: {
      mimeType,
      body: Readable.from(buffer)
    },
    fields: 'id, name'
  });

  if (!data.id) throw new Error('Drive upload did not return a file id');
  return { fileId: data.id, fileName: data.name ?? fileName };
}

export async function deletePrereadFile(fileId: string) {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

export async function getPrereadAccessToken(): Promise<string> {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.PREREAD_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.PREREAD_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain access token');
  return token;
}

export async function initiateResumableUpload(fileName: string, mimeType: string): Promise<string> {
  const accessToken = await getPrereadAccessToken();
  const folderId = process.env.PREREAD_DRIVE_FOLDER_ID;

  // Raw REST call (not the googleapis library's drive.files.create) — this step only needs
  // to hand back a session URL. The actual file bytes never touch our server: the BROWSER
  // uploads directly to this URL, which is what bypasses Vercel's 4.5MB function limit
  // regardless of how large the real file is.
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType
    },
    body: JSON.stringify({
      name: fileName,
      parents: folderId ? [folderId] : undefined
    })
  });

  if (!res.ok) {
    throw new Error(`Failed to initiate resumable upload: ${res.status} ${await res.text()}`);
  }

  const uploadUrl = res.headers.get('Location');
  if (!uploadUrl) throw new Error('Drive did not return an upload session URL');
  return uploadUrl;
}


