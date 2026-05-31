
// This service handles the low-level encryption/decryption using Web Crypto API.
// Crypto operations are offloaded to a Web Worker to avoid blocking the main thread
// during bulk operations (sync, mass load). Falls back to main-thread if worker fails.
//
// The master key is stored in IndexedDB as a non-extractable CryptoKey for runtime use.
// Export/restore operations use a separate extractable import for backup purposes only.

import EncryptionWorker from './encryption.worker?worker';

const ALGO_NAME = 'AES-GCM';
const KEY_DB_NAME = 'sifl_keystore';
const KEY_STORE_NAME = 'keys';
const MASTER_KEY_ID = 'master_key_v2';

// Legacy localStorage key — used only for one-time migration
const LEGACY_KEY_STORAGE_KEY = 'sifl_encryption_key_v1';

// In-memory cache to avoid repeated IndexedDB reads per session
let cachedKey: CryptoKey | null = null;

// Cached JWK for sending to the worker (workers can't receive CryptoKey objects)
let cachedJWK: JsonWebKey | null = null;

// === Worker setup ===
let worker: Worker | null = null;
let workerReady = true;
let messageId = 0;
const pendingMessages = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

function getWorker(): Worker | null {
  if (!workerReady) return null;
  if (worker) return worker;
  try {
    worker = new EncryptionWorker();
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error } = e.data;
      const pending = pendingMessages.get(id);
      if (pending) {
        pendingMessages.delete(id);
        if (error) pending.reject(new Error(error));
        else pending.resolve(result);
      }
    };
    worker.onerror = () => {
      console.warn('[Encryption] Worker error, falling back to main thread');
      workerReady = false;
      worker = null;
      // Reject all pending
      for (const [, p] of pendingMessages) {
        p.reject(new Error('Worker died'));
      }
      pendingMessages.clear();
    };
    return worker;
  } catch {
    workerReady = false;
    return null;
  }
}

function postToWorker(type: string, data: Record<string, any>): Promise<any> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('No worker'));
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    pendingMessages.set(id, { resolve, reject });
    w.postMessage({ type, id, ...data });
  });
}

// Convert ArrayBuffer to Base64 string for storage
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

// Convert Base64 string to Uint8Array for crypto operations
const base64ToArrayBuffer = (base64: string): Uint8Array => {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
};

// Open the dedicated keystore IndexedDB
const openKeyDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Store a JWK object in IndexedDB (for backup/restore serialization)
const storeKeyJWK = async (jwk: JsonWebKey): Promise<void> => {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(KEY_STORE_NAME);
    store.put(jwk, MASTER_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// Retrieve JWK from IndexedDB
const getKeyJWK = async (): Promise<JsonWebKey | null> => {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readonly');
    const store = tx.objectStore(KEY_STORE_NAME);
    const request = store.get(MASTER_KEY_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

// Migrate legacy key from localStorage to IndexedDB (one-time)
const migrateLegacyKey = async (): Promise<JsonWebKey | null> => {
  const legacyRaw = localStorage.getItem(LEGACY_KEY_STORAGE_KEY);
  if (!legacyRaw) return null;

  try {
    const jwk = JSON.parse(legacyRaw) as JsonWebKey;
    await storeKeyJWK(jwk);
    localStorage.removeItem(LEGACY_KEY_STORAGE_KEY);
    console.log('[Encryption] Migrated key from localStorage to IndexedDB');
    return jwk;
  } catch (e) {
    console.error('[Encryption] Failed to migrate legacy key', e);
    return null;
  }
};

// Dedupes concurrent first-time key initialization. Without this, two callers
// racing before `cachedKey` is set (e.g. encrypting a batch of records via
// Promise.all) would each generate and persist a *different* master key — the
// loser's records then fail to decrypt and are silently dropped on read.
let keyInitPromise: Promise<CryptoKey> | null = null;

// Get or Create the Master Key.
// The key is imported as non-extractable so it cannot be read by scripts at runtime.
// The JWK is stored in IndexedDB for export/restore operations only.
const getMasterKey = async (): Promise<CryptoKey> => {
  if (cachedKey) return cachedKey;
  if (keyInitPromise) return keyInitPromise;
  keyInitPromise = initMasterKey();
  try {
    return await keyInitPromise;
  } finally {
    keyInitPromise = null;
  }
};

const initMasterKey = async (): Promise<CryptoKey> => {
  // Try IndexedDB first
  let jwk = await getKeyJWK();

  // Try migrating from legacy localStorage
  if (!jwk) {
    jwk = await migrateLegacyKey();
  }

  if (jwk) {
    // Import as non-extractable for runtime use
    const key = await window.crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: ALGO_NAME },
      false, // non-extractable — cannot be exported via JS at runtime
      ['encrypt', 'decrypt']
    );
    cachedKey = key;
    cachedJWK = jwk;
    return key;
  }

  // Generate new key
  const extractableKey = await window.crypto.subtle.generateKey(
    { name: ALGO_NAME, length: 256 },
    true, // extractable for initial export to IndexedDB
    ['encrypt', 'decrypt']
  );

  // Export JWK and persist in IndexedDB
  const exportedJWK = await window.crypto.subtle.exportKey('jwk', extractableKey);
  await storeKeyJWK(exportedJWK);

  // Re-import as non-extractable for runtime use
  const runtimeKey = await window.crypto.subtle.importKey(
    'jwk',
    exportedJWK,
    { name: ALGO_NAME },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );

  cachedKey = runtimeKey;
  cachedJWK = exportedJWK;
  return runtimeKey;
};

// Get the JWK for sending to the worker
const getJWK = async (): Promise<JsonWebKey> => {
  if (cachedJWK) return cachedJWK;
  await getMasterKey(); // This sets cachedJWK as a side effect
  if (!cachedJWK) {
    cachedJWK = await getKeyJWK();
  }
  return cachedJWK!;
};

export interface EncryptedPayload {
  cipherText: string; // Base64
  iv: string;         // Base64
}

// Main-thread fallback for encrypt
const encryptDataMainThread = async (data: any): Promise<EncryptedPayload> => {
  const key = await getMasterKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(JSON.stringify(data));

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: ALGO_NAME, iv },
    key,
    encodedData
  );

  return {
    cipherText: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer),
  };
};

// Main-thread fallback for decrypt
const decryptDataMainThread = async (payload: EncryptedPayload): Promise<any> => {
  const key = await getMasterKey();
  const iv = base64ToArrayBuffer(payload.iv);
  const encryptedData = base64ToArrayBuffer(payload.cipherText);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: ALGO_NAME, iv },
    key,
    encryptedData
  );

  const decodedString = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decodedString);
};

// Encrypt any JSON-serializable data (worker-first, main-thread fallback)
export const encryptData = async (data: any): Promise<EncryptedPayload> => {
  try {
    const jwk = await getJWK();
    return await postToWorker('encrypt', { jwk, data });
  } catch {
    return encryptDataMainThread(data);
  }
};

// Decrypt data back to original object (worker-first, main-thread fallback)
export const decryptData = async (payload: EncryptedPayload): Promise<any> => {
  try {
    const jwk = await getJWK();
    return await postToWorker('decrypt', { jwk, payload });
  } catch {
    try {
      return await decryptDataMainThread(payload);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }
};

// Batch decrypt multiple payloads in the worker for bulk operations (e.g. getMemories)
export const decryptBatch = async (
  payloads: { id: string; cipherText: string; iv: string }[]
): Promise<{ id: string; data?: any; error?: string }[]> => {
  try {
    const jwk = await getJWK();
    return await postToWorker('decryptBatch', { jwk, payloads });
  } catch {
    // Fallback: decrypt individually on main thread
    return Promise.all(
      payloads.map(async (p) => {
        try {
          const data = await decryptDataMainThread({ cipherText: p.cipherText, iv: p.iv });
          return { id: p.id, data };
        } catch (e: any) {
          return { id: p.id, error: e.message };
        }
      })
    );
  }
};

// === Key Management Features ===

// Ensures a key exists, then returns its JWK JSON string for backup.
// Reads the JWK from IndexedDB (not from the non-extractable runtime key).
export const exportEncryptionKey = async (): Promise<string> => {
    await getMasterKey(); // Ensure key is generated/migrated
    const jwk = await getKeyJWK();
    return jwk ? JSON.stringify(jwk) : '';
};

// Restores a key from a JSON string.
// WARNING: This overwrites the existing key. Data encrypted with the old key will be unreadable.
export const restoreEncryptionKey = async (keyJSON: string): Promise<boolean> => {
    try {
        const parsed = JSON.parse(keyJSON);
        // Basic validation that it looks like a JWK
        if (!parsed.kty || !parsed.k || parsed.alg !== 'A256GCM') return false;

        await storeKeyJWK(parsed);
        // Invalidate cached key so next operation picks up the new one
        cachedKey = null;
        cachedJWK = null;
        // Tell worker to clear its cached key too
        postToWorker('clearKey', {}).catch(() => { /* ignore — worker may not be available */ });
        return true;
    } catch (e) {
        console.error('Invalid key format', e);
        return false;
    }
};

// Clear the in-memory cached key (useful for testing)
export const _clearCachedKey = () => { cachedKey = null; cachedJWK = null; keyInitPromise = null; };
