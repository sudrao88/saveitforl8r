// auth/tokenService.ts
import { storage, isNative } from '../platform/platform';

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

// --- Storage namespacing -----------------------------------------------------
// Two PWAs (saveitforl8r + l8rgram) can share an origin during dev, so token
// keys and the IndexedDB token DB are prefixed `${namespace}:`. The namespace is
// set once at startup by configureGoogleAuth(). When unset, keys are unprefixed
// (back-compatible with the pre-M1 single-app behavior).
let prefix = '';

export const setStorageNamespace = (namespace?: string): void => {
  prefix = namespace ? `${namespace}:` : '';
};

const nsKey = (key: string): string => `${prefix}${key}`;
const dbName = (): string => `${prefix}auth_db`;

const STORE_NAME = 'tokens';

const openDB = (name: string): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
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
      await storage.set(nsKey('access_token'), accessToken);
      await storage.set(nsKey('expires_at'), expiresAt.toString());
      if (refreshToken) {
          await storage.set(nsKey('refresh_token'), refreshToken);
      }
  } else {
      // Keep existing IndexedDB implementation for Web to avoid regression/migration issues for now
      const db = await openDB(dbName());
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
      const val = await storage.get(nsKey(key));
      if (key === 'expires_at' && val) return parseInt(val, 10);
      return val;
  } else {
      const db = await openDB(dbName());
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
      await storage.remove(nsKey('access_token'));
      await storage.remove(nsKey('expires_at'));
      await storage.remove(nsKey('refresh_token'));
  } else {
      const db = await openDB(dbName());
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
  }
};

// --- One-time legacy storage migration --------------------------------------
// saveitforl8r used unprefixed keys (`access_token`, `refresh_token`,
// `gdrive_linked`) and an `auth_db` IndexedDB before M1 introduced namespacing.
// Migrate them once into the namespaced equivalents so logged-in users survive
// the upgrade. Crash-safe: the new value is written before the old is deleted,
// and an already-migrated key is never re-copied (idempotent).
const ADAPTER_KEYS = ['access_token', 'expires_at', 'refresh_token', 'gdrive_linked'];

export const migrateLegacyTokenStorage = async (namespace?: string): Promise<void> => {
  if (!namespace) return;
  const p = `${namespace}:`;

  // 1. Storage-adapter keys. On native these hold the tokens; on web they hold
  //    only `gdrive_linked` (tokens live in IndexedDB, handled in step 2). A
  //    missing old key is simply skipped.
  for (const key of ADAPTER_KEYS) {
    const newKey = `${p}${key}`;
    if ((await storage.get(newKey)) != null) continue; // already migrated
    const old = await storage.get(key);
    if (old != null) {
      await storage.set(newKey, old); // write new BEFORE deleting old (crash-safe)
      await storage.remove(key);
    }
  }

  // 2. Web token DB: rename `auth_db` -> `${namespace}:auth_db` (best-effort).
  if (!isNative() && typeof indexedDB !== 'undefined') {
    try {
      await migrateAuthDb(`${p}auth_db`);
    } catch (e) {
      console.error('[Auth] auth_db migration failed', e);
    }
  }
};

const readAllTokens = (db: IDBDatabase): Promise<Record<string, any>> => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const out: Record<string, any> = {};
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as IDBValidKey[];
      const vals = valsReq.result as any[];
      keys.forEach((k, i) => { out[String(k)] = vals[i]; });
      resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  });
};

const writeAllTokens = (db: IDBDatabase, entries: Record<string, any>): Promise<void> => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const [k, v] of Object.entries(entries)) store.put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const deleteDatabase = (name: string): Promise<void> => {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // best-effort
    req.onblocked = () => resolve();
  });
};

const migrateAuthDb = async (newName: string): Promise<void> => {
  if (newName === 'auth_db') return;

  // If the namespaced DB already holds tokens, migration already ran.
  const dest = await openDB(newName);
  const existing = await readAllTokens(dest);
  if (Object.keys(existing).length > 0) {
    dest.close();
    return;
  }

  const oldDb = await openDB('auth_db');
  const entries = await readAllTokens(oldDb);
  oldDb.close();

  if (Object.keys(entries).length === 0) {
    dest.close();
    return; // nothing to migrate
  }

  await writeAllTokens(dest, entries); // write new BEFORE deleting old (crash-safe)
  dest.close();
  await deleteDatabase('auth_db');
};
