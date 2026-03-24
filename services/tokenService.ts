// services/tokenService.ts
import { storage, isNative } from './platform';

// For web, we keep IndexedDB logic or we can migrate everything to storage adapter.
// The storage adapter uses Preferences on Native and LocalStorage on Web.
// HOWEVER, refresh tokens are sensitive.
// On Web, LocalStorage is vulnerable to XSS. IndexedDB is slightly better but not perfect.
// On Native, Capacitor Preferences uses SharedPreferences/UserDefaults which is better, 
// but for high security we should use @capacitor/secure-storage-plugin (not installed yet).
// Given the requirements, we'll stick to the platform adapter which abstracts this.
// But for WEB, the previous implementation used IndexedDB.
// To keep "single codebase", let's standardise on the `storage` adapter which uses `localStorage` on web.
// This is a trade-off. If we want to keep IndexedDB for Web, we need a conditional.

const DB_NAME = 'auth_db';
const STORE_NAME = 'tokens';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const storeTokens = async (accessToken: string, expiresAt: number, refreshToken?: string) => {
  if (isNative()) {
      await storage.set('access_token', accessToken);
      await storage.set('expires_at', expiresAt.toString());
      if (refreshToken) {
          await storage.set('refresh_token', refreshToken);
      }
  } else {
      // Keep existing IndexedDB implementation for Web to avoid regression/migration issues for now
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(accessToken, 'access_token');
        store.put(expiresAt, 'expires_at');
        if (refreshToken) {
          store.put(refreshToken, 'refresh_token');
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
  }
};

export const getStoredToken = async (key: string): Promise<any> => {
  if (isNative()) {
      const val = await storage.get(key);
      if (key === 'expires_at' && val) return parseInt(val, 10);
      return val;
  } else {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
  }
};

export const clearTokens = async () => {
  if (isNative()) {
      await storage.remove('access_token');
      await storage.remove('expires_at');
      await storage.remove('refresh_token');
  } else {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
  }
};
