import { Readable } from 'stream';
import { driveForServiceAccount, serviceAccountAccessToken, PREREAD_SERVICE_ACCOUNT } from '@/lib/googleClients';

// The Drive client is loaded only when one of these functions runs (see lib/googleClients.ts):
// importing this file costs nothing on a cold start.
function getDriveClient() {
  return driveForServiceAccount(PREREAD_SERVICE_ACCOUNT());
}

export async function getFileMetadata(fileId: string) {
  const drive = await getDriveClient();
  const { data } = await drive.files.get({ fileId, fields: 'id, name, mimeType' });
  return data;
}

export async function getPrereadFile(fileId: string) {
  const drive = await getDriveClient();

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
  const drive = await getDriveClient();
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
  const drive = await getDriveClient();
  await drive.files.delete({ fileId });
}

// EAP Course Workshop redress proof uploads. Reuses the same service account
// as prereads (it's really just "the shared Drive service account"), but
// writes into a SEPARATE folder — EAP_REDRESS_DRIVE_FOLDER_ID, not
// PREREAD_DRIVE_FOLDER_ID — so redress evidence doesn't mix with preread
// files. That folder needs to exist in Drive and be shared with the same
// service account email before this will work.
export async function uploadEapRedressProof(fileName: string, mimeType: string, buffer: Buffer) {
  const drive = await getDriveClient();
  const folderId = process.env.EAP_REDRESS_DRIVE_FOLDER_ID;

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

export async function getPrereadAccessToken(): Promise<string> {
  return serviceAccountAccessToken(PREREAD_SERVICE_ACCOUNT());
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


