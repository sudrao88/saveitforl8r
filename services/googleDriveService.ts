// services/googleDriveService.ts
import { getAuthorizedFetch, getValidToken, initiateLogin, handleAuthCallback } from './googleAuth';
import { clearTokens } from './tokenService';

const G_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '267358862238-5lur0dimfrek6ep3uv8dlj48q7dlh40l.apps.googleusercontent.com';

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
  trashed?: boolean;
}

// Re-export auth functions for UI consumption
export const loginToDrive = initiateLogin;
export const processAuthCallback = handleAuthCallback;

export const isLinked = () => {
  return localStorage.getItem('gdrive_linked') === 'true';
};

export const unlinkDrive = async () => {
  await clearTokens();
  localStorage.removeItem('gdrive_linked');
};

// Use the new authorized fetch
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

  // Get raw token for manual fetch (Multipart handling)
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
        let url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=trashed=false&fields=nextPageToken,files(id, name, modifiedTime)`;
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

export const deleteRemoteNote = async (noteId: string) => {
    const file = await findFileByName(`${noteId}.json`);
    if (file) {
        await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, { method: 'DELETE' });
    }
};

// Dummy init for compatibility with existing code structure (Auth handled via redirect now)
export const initializeGoogleAuth = (cb?: () => void) => { if(cb) cb(); };
export const getAccessToken = getValidToken;
