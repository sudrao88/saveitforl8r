// services/googleDriveService.ts

const G_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '267358862238-5lur0dimfrek6ep3uv8dlj48q7dlh40l.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata email profile';

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
  trashed?: boolean;
}

interface SyncConfig {
  accessToken: string;
  tokenExpiry: number;
}

let syncConfig: SyncConfig | null = null;
let tokenClient: any = null;

let tokenRequestPromise: Promise<string> | null = null;
let tokenResolve: ((token: string) => void) | null = null;
let tokenReject: ((reason: any) => void) | null = null;

const STORAGE_KEY_TOKEN = 'gdrive_token_data';

const saveSyncConfig = (config: SyncConfig) => {
    localStorage.setItem(STORAGE_KEY_TOKEN, JSON.stringify(config));
    syncConfig = config;
};

const loadSyncConfig = () => {
    const stored = localStorage.getItem(STORAGE_KEY_TOKEN);
    if (stored) {
        try {
            const config = JSON.parse(stored);
            // Basic validity check
            if (config.accessToken && config.tokenExpiry) {
                syncConfig = config;
            }
        } catch (e) {
            console.warn("Failed to parse stored token", e);
        }
    }
};

const waitForGoogle = (): Promise<void> => {
    return new Promise((resolve) => {
        if ((window as any).google) return resolve();
        console.log("[Auth] Waiting for window.google...");
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if ((window as any).google) {
                clearInterval(interval);
                console.log("[Auth] window.google found.");
                resolve();
            }
            if (attempts > 50) { // 5 seconds
                console.warn("[Auth] Waiting for Google script timed out (5s).");
                clearInterval(interval);
                resolve();
            }
        }, 100);
    });
};

const fetchAndSaveUserEmail = async (token: string) => {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            if (data.email) {
                localStorage.setItem('gdrive_email', data.email);
            }
        }
    } catch (e) {
        console.warn("[Auth] Failed to fetch user info for hint", e);
    }
};

export const initializeGoogleAuth = async (onSuccess?: () => void) => {
  if (typeof window === 'undefined') return;
  
  // Try loading stored token immediately
  if (!syncConfig) loadSyncConfig();

  await waitForGoogle();
  
  if (!(window as any).google) {
      console.error("[Auth] Google Identity Services script failed to load.");
      return;
  }

  if (tokenClient) {
      if (onSuccess) onSuccess();
      return;
  }

  try {
      tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: G_CLIENT_ID,
        scope: SCOPES,
        login_hint: localStorage.getItem('gdrive_email') || undefined,
        callback: (response: any) => {
          if (response.error !== undefined) {
            console.error('Google Auth Error:', response);
            if (tokenReject) {
                tokenReject(response);
                tokenReject = null;
                tokenRequestPromise = null;
            }
            return;
          }
          
          const newConfig = {
            accessToken: response.access_token,
            tokenExpiry: Date.now() + Number(response.expires_in) * 1000,
          };
          
          saveSyncConfig(newConfig);
          localStorage.setItem('gdrive_linked', 'true');
          
          fetchAndSaveUserEmail(response.access_token);
          
          if (tokenResolve) {
              tokenResolve(response.access_token);
              tokenResolve = null;
              tokenReject = null;
              tokenRequestPromise = null;
          }
          
          if (onSuccess) onSuccess();
        },
      });
      console.log("[Auth] Token Client initialized.");
  } catch (err) {
      console.error("[Auth] Failed to initialize token client:", err);
  }
};

export const loginToDrive = async () => {
    if (!tokenClient) await initializeGoogleAuth();
    if (!tokenClient) return;
    
    if (tokenRequestPromise) return tokenRequestPromise;

    tokenRequestPromise = new Promise((resolve, reject) => {
        tokenResolve = resolve;
        tokenReject = reject;
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
    
    return tokenRequestPromise;
}

export const getAccessToken = async (): Promise<string> => {
    // 1. Check in-memory or stored config BEFORE initializing client
    // This allows sync on load to work even if script is slow/blocked, provided we have a valid token.
    if (!syncConfig) loadSyncConfig();
    
    if (syncConfig && Date.now() < syncConfig.tokenExpiry - 60 * 1000) { 
        // console.log("[Auth] Using valid stored token.");
        return syncConfig.accessToken;
    }

    // 2. If no valid token, we MUST initialize client to request one
    if (!tokenClient) await initializeGoogleAuth();
    if (!tokenClient) throw new Error("Google Auth not initialized");

    if (tokenRequestPromise) {
        return tokenRequestPromise;
    }

    console.log("[Auth] Requesting new Access Token (Silent)...");
    tokenRequestPromise = new Promise((resolve, reject) => {
        tokenResolve = resolve;
        tokenReject = reject;
    });

    const hint = localStorage.getItem('gdrive_email');
    tokenClient.requestAccessToken({ 
        prompt: '',
        login_hint: hint || undefined
    });

    return tokenRequestPromise as Promise<string>;
};

export const isLinked = () => {
  return localStorage.getItem('gdrive_linked') === 'true';
};

export const unlinkDrive = () => {
  if (syncConfig?.accessToken) {
    try {
        (window as any).google.accounts.oauth2.revoke(syncConfig.accessToken, () => {
            console.log('Access token revoked');
        });
    } catch (e) {
        console.warn('Revocation failed', e);
    }
  }
  syncConfig = null;
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem('gdrive_linked');
  localStorage.removeItem('gdrive_email'); 
};

const driveFetch = async (url: string, options: RequestInit = {}) => {
  const token = await getAccessToken();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
     const errorText = await response.text();
     // console.error(`Drive API Error (${response.status}):`, errorText);
     
     if (response.status === 401) {
        // Token invalid/expired. Clear it so next retry gets a new one.
        syncConfig = null;
        localStorage.removeItem(STORAGE_KEY_TOKEN);
        throw new Error('Unauthorized: ' + errorText);
     }
     
     if (response.status === 403 && errorText.includes('insufficientScopes')) {
         console.error("Insufficient Scopes detected. User needs to re-auth.");
         throw new Error('InsufficientScopes');
     }
     
     throw new Error(`Drive API Failed: ${errorText}`);
  }

  return response;
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

  const token = await getAccessToken();
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
        
        // console.log(`[Sync] Listing files from Drive... PageToken: ${!!pageToken}`);
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

export const requestAccessToken = getAccessToken; 
