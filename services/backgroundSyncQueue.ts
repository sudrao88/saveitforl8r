/**
 * IndexedDB-backed queue for Background Sync operations.
 * Stores pending operations that failed due to network issues
 * and should be retried when connectivity returns via the
 * Background Sync API (Chrome/Edge) or on next app open (other browsers).
 */

const DB_NAME = 'saveitforl8r-bg-sync';
const STORE_NAME = 'operations';
const DB_VERSION = 1;

export interface BackgroundSyncOperation {
  id?: number;
  type: 'enrich' | 'sync-drive';
  payload: Record<string, unknown>;
  createdAt: number;
}

/**
 * Opens (or creates) the background sync IndexedDB.
 */
export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Adds an operation to the queue and registers Background Sync if available.
 */
export const enqueue = async (op: Omit<BackgroundSyncOperation, 'id' | 'createdAt'>): Promise<void> => {
  try {
    const db = await openDB();
    const operation: BackgroundSyncOperation = {
      ...op,
      createdAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.add(operation);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();

    // Register Background Sync with the appropriate tag
    const tag = op.type === 'enrich' ? 'enrich-memory' : 'sync-drive';
    await registerBackgroundSync(tag);
  } catch (err) {
    console.error('[BackgroundSyncQueue] Failed to enqueue operation:', err);
  }
};

/**
 * Removes and returns the oldest operation from the queue.
 */
export const dequeue = async (): Promise<BackgroundSyncOperation | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const result = await new Promise<BackgroundSyncOperation | null>((resolve, reject) => {
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          const value = cursor.value as BackgroundSyncOperation;
          cursor.delete();
          resolve(value);
        } else {
          resolve(null);
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });

    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    db.close();
    return result;
  } catch (err) {
    console.error('[BackgroundSyncQueue] Failed to dequeue operation:', err);
    return null;
  }
};

/**
 * Returns all pending operations without removing them.
 */
export const peekAll = async (): Promise<BackgroundSyncOperation[]> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const result = await new Promise<BackgroundSyncOperation[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return result;
  } catch (err) {
    console.error('[BackgroundSyncQueue] Failed to peek operations:', err);
    return [];
  }
};

/**
 * Removes a specific operation by id.
 */
export const remove = async (id: number): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (err) {
    console.error('[BackgroundSyncQueue] Failed to remove operation:', err);
  }
};

/**
 * Removes all operations from the queue.
 */
export const clear = async (): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (err) {
    console.error('[BackgroundSyncQueue] Failed to clear operations:', err);
  }
};

/**
 * Registers a Background Sync event with the service worker.
 * Feature-detects SyncManager — silently no-ops if not available.
 */
export const registerBackgroundSync = async (tag: string): Promise<void> => {
  try {
    if (!('SyncManager' in window)) return;
    if (!('serviceWorker' in navigator)) return;

    const registration = await navigator.serviceWorker.ready;
    // SyncManager is not in all TypeScript lib types, so cast as needed
    await (registration as any).sync.register(tag);
    console.log(`[BackgroundSyncQueue] Registered sync tag: ${tag}`);
  } catch (err) {
    // Background Sync registration is best-effort
    console.warn('[BackgroundSyncQueue] Failed to register sync:', err);
  }
};
