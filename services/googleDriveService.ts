// services/googleDriveService.ts
import { getAuthorizedFetch, getValidToken, initiateLogin, handleAuthCallback } from './googleAuth';
import { clearTokens } from './tokenService';

// CLIENT_ID is managed in googleAuth.ts — no longer duplicated here

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
  trashed?: boolean;
}

// Max parallel requests. Stays well within Drive API quota (~10 QPS sustained)
// while dramatically reducing wall-clock time vs sequential requests.
const BATCH_CONCURRENCY = 6;

export const loginToDrive = initiateLogin;
export const processAuthCallback = handleAuthCallback;

export const isLinked = () => {
  return localStorage.getItem('gdrive_linked') === 'true';
};

export const unlinkDrive = async () => {
  await clearTokens();
  localStorage.removeItem('gdrive_linked');
  localStorage.removeItem('gdrive_email');
};

const driveFetch = async (url: string, options: RequestInit = {}) => {
  try {
      const response = await getAuthorizedFetch(url, options);
      if (!response.ok) {
         const errorText = await response.text();
         console.error(`Drive API Error (${response.status}):`, errorText);
         if (response.status === 401) {
            throw new Error('Unauthorized');
         }
         throw new Error(`Drive API Failed: ${errorText}`);
      }
      return response;
  } catch (e) {
      console.error("Drive fetch error", e);
      throw e;
  }
};

// --- Operations ---

export const findFileByName = async (filename: string): Promise<DriveFile | null> => {
  const query = `name = '${filename}' and 'appDataFolder' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id, name, modifiedTime)`;
  const res = await driveFetch(url);
  const data = await res.json();
  return data.files?.[0] || null;
};

export const downloadFileContent = async (fileId: string) => {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(url);
  return await res.json();
};

export const uploadFile = async (filename: string, content: any, existingFileId?: string) => {
  const metadata = {
    name: filename,
    parents: !existingFileId ? ['appDataFolder'] : undefined,
    mimeType: 'application/json'
  };

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append('file', new Blob([JSON.stringify(content)], { type: 'application/json' }));

  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  let method = 'POST';

  if (existingFileId) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`;
    method = 'PATCH';
  }

  const token = await getValidToken();
  const res = await fetch(url, {
    method,
    body: formData,
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${await res.text()}`);
  }

  return await res.json();
};

export const listAllFiles = async (): Promise<DriveFile[]> => {
    let allFiles: DriveFile[] = [];
    let pageToken: string | undefined = undefined;

    do {
        let url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1000&q=trashed=false&fields=nextPageToken,files(id, name, modifiedTime)`;
        if (pageToken) url += `&pageToken=${pageToken}`;

        const res = await driveFetch(url);
        const data = await res.json();

        if (data.files) {
            allFiles = allFiles.concat(data.files);
        }
        pageToken = data.nextPageToken;
    } while (pageToken);

    return allFiles;
};

// Delete a Drive file directly by its Drive file ID (no extra lookup needed
// when the caller already has the ID from a listing).
export const deleteFileById = async (fileId: string) => {
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
};

// Delete a remote note by its application note ID (looks up the file first).
export const deleteRemoteNote = async (noteId: string) => {
    const file = await findFileByName(`${noteId}.json`);
    if (file) {
        await deleteFileById(file.id);
    }
};

// Download multiple files in parallel with a concurrency limit.
// Returns a map of fileId → parsed JSON content, plus a list of failed fileIds.
export const downloadMultipleFiles = async (
    fileIds: string[]
): Promise<{ contents: Map<string, any>; failures: string[] }> => {
    const contents = new Map<string, any>();
    const failures: string[] = [];
    if (fileIds.length === 0) return { contents, failures };

    for (let i = 0; i < fileIds.length; i += BATCH_CONCURRENCY) {
        const batch = fileIds.slice(i, i + BATCH_CONCURRENCY);
        const results = await Promise.all(
            batch.map(async (fileId) => {
                try {
                    const content = await downloadFileContent(fileId);
                    return { fileId, content, ok: true as const };
                } catch (e) {
                    console.error(`[Drive] Download failed for ${fileId}:`, e);
                    return { fileId, content: null, ok: false as const };
                }
            })
        );
        for (const r of results) {
            if (r.ok) contents.set(r.fileId, r.content);
            else failures.push(r.fileId);
        }
    }
    return { contents, failures };
};

// Upload multiple files in parallel with a concurrency limit.
// Returns a list of filenames that failed.
export const uploadMultipleFiles = async (
    items: Array<{ filename: string; content: any; existingFileId?: string }>
): Promise<{ failures: string[] }> => {
    const failures: string[] = [];
    if (items.length === 0) return { failures };

    for (let i = 0; i < items.length; i += BATCH_CONCURRENCY) {
        const batch = items.slice(i, i + BATCH_CONCURRENCY);
        const results = await Promise.all(
            batch.map(async (item) => {
                try {
                    await uploadFile(item.filename, item.content, item.existingFileId);
                    return { filename: item.filename, ok: true as const };
                } catch (e) {
                    console.error(`[Drive] Upload failed for ${item.filename}:`, e);
                    return { filename: item.filename, ok: false as const };
                }
            })
        );
        for (const r of results) {
            if (!r.ok) failures.push(r.filename);
        }
    }
    return { failures };
};

export const initializeGoogleAuth = (cb?: () => void) => { if(cb) cb(); };
export const getAccessToken = getValidToken;
