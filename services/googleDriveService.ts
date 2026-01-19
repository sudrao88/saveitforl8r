// services/googleDriveService.ts

const G_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '825946890351-40483l56j6k403l21367468164805.apps.googleusercontent.com'; // Replace with real ID if not in env
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
}

interface SyncConfig {
  accessToken: string;
  tokenExpiry: number;
}

let syncConfig: SyncConfig | null = null;
let tokenClient: any = null;

// Initialize the Google Identity Services client
export const initializeGoogleAuth = (onSuccess: () => void) => {
  if (typeof window === 'undefined' || !(window as any).google) return;

  tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
    client_id: G_CLIENT_ID,
    scope: SCOPES,
    callback: (response: any) => {
      if (response.error !== undefined) {
        console.error('Google Auth Error:', response);
        throw (response);
      }
      
      syncConfig = {
        accessToken: response.access_token,
        tokenExpiry: Date.now() + Number(response.expires_in) * 1000,
      };
      
      // Save minimal info to local storage to "remember" the user is linked
      localStorage.setItem('gdrive_linked', 'true');
      onSuccess();
    },
  });
};

export const requestAccessToken = () => {
  if (!tokenClient) {
    console.error('Google Auth not initialized');
    return;
  }
  
  // Skip if token is valid (with 5 min buffer)
  if (syncConfig && Date.now() < syncConfig.tokenExpiry - 5 * 60 * 1000) {
    return;
  }

  // Request new token (if user authorized before, this might be silent or a popup)
  tokenClient.requestAccessToken({ prompt: '' });
};

export const isLinked = () => {
  return localStorage.getItem('gdrive_linked') === 'true';
};

export const unlinkDrive = () => {
  if (syncConfig?.accessToken) {
    (window as any).google.accounts.oauth2.revoke(syncConfig.accessToken, () => {
      console.log('Access token revoked');
    });
  }
  syncConfig = null;
  localStorage.removeItem('gdrive_linked');
};

// --- Drive API Helpers ---

const driveFetch = async (url: string, options: RequestInit = {}) => {
  if (!syncConfig?.accessToken) {
    throw new Error('No access token available');
  }

  const headers = {
    'Authorization': `Bearer ${syncConfig.accessToken}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Token expired logic could go here (trigger re-auth)
    // For now, throw so UI can handle
    localStorage.removeItem('gdrive_linked'); // Force re-link
    throw new Error('Unauthorized');
  }

  return response;
};

// --- Sync Logic ---

export const findFileByName = async (filename: string): Promise<DriveFile | null> => {
  const query = `name = '${filename}' and 'appDataFolder' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name, modifiedTime)`;

  const res = await driveFetch(url);
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    return data.files[0];
  }
  return null;
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

  const res = await driveFetch(url, {
    method,
    body: formData,
    headers: {
       // Boundary is handled automatically by fetch for FormData, 
       // but we need to NOT set Content-Type to json
    }
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Upload failed: ${err.error?.message}`);
  }

  return await res.json();
};

// Sync a single note
// Returns true if local was updated from cloud, false if cloud updated or no change
export const syncNote = async (localNote: any): Promise<{ updatedLocal: any | null }> => {
  const filename = `${localNote.id}.json`;
  const remoteFile = await findFileByName(filename);

  if (!remoteFile) {
    // Does not exist on Drive -> Upload
    console.log(`Uploading new note ${localNote.id}`);
    await uploadFile(filename, localNote);
    return { updatedLocal: null };
  }

  const remoteTime = new Date(remoteFile.modifiedTime).getTime();
  // Using timestamp from the note content itself is safer than file metadata sometimes, 
  // but drive modifiedTime is good for "last edit".
  // Let's assume localNote.timestamp is the last edit time.
  
  // Note: Drive modifiedTime is when the FILE was uploaded.
  // Ideally, the JSON content should have a `lastModified` field.
  // Fallback: If local timestamp > remoteTime (approx), we push.
  
  // Let's fetch the remote content to be sure about conflicts
  const remoteContent = await downloadFileContent(remoteFile.id);
  
  if (remoteContent.timestamp > localNote.timestamp) {
    console.log(`Remote is newer for ${localNote.id}`);
    return { updatedLocal: remoteContent };
  } else if (remoteContent.timestamp < localNote.timestamp) {
    console.log(`Local is newer for ${localNote.id}`);
    await uploadFile(filename, localNote, remoteFile.id);
    return { updatedLocal: null };
  } else {
    // Timestamps equal, content might be same. Do nothing.
    return { updatedLocal: null };
  }
};

export const deleteRemoteNote = async (noteId: string) => {
  const filename = `${noteId}.json`;
  const remoteFile = await findFileByName(filename);
  
  if (remoteFile) {
     await driveFetch(`https://www.googleapis.com/drive/v3/files/${remoteFile.id}`, {
       method: 'DELETE'
     });
  }
}

// Check for changes on server
export const listChanges = async (pageToken?: string) => {
  let url = 'https://www.googleapis.com/drive/v3/changes';
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'changes(file(id, name, modifiedTime, trashed)), newStartPageToken, nextPageToken',
  });
  
  if (pageToken) {
    params.append('pageToken', pageToken);
  } else {
    // If no token, we might want to start from now? 
    // Or if first sync, list ALL files. 
    // For "changes", we need a token.
    // Instead of changes, let's just LIST all files in appDataFolder for the initial sync
    return listAllFiles();
  }

  url += `?${params.toString()}`;
  const res = await driveFetch(url);
  return await res.json();
};

const listAllFiles = async () => {
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=trashed=false&fields=files(id, name, modifiedTime)`;
  const res = await driveFetch(url);
  const data = await res.json();
  return { files: data.files, newStartPageToken: null }; // Mock structure to match changes
};

export const getStartPageToken = async () => {
    const res = await driveFetch('https://www.googleapis.com/drive/v3/changes/startPageToken');
    const data = await res.json();
    return data.startPageToken;
}
