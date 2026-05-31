// L8rgramDB — encrypted local store for l8rgram.
//
// Mirrors saveitforl8r's storageService approach (encrypt-on-write, decrypt-on-read
// via the shared AES-GCM crypto) but uses the `idb` promise wrapper for brevity.
// Photos stay on the device; only this metadata + thumbnail URIs are persisted.
//
// Stores (spec §4):
//   - photos        (keyPath: id)  — populated by the M2b import pipeline
//   - albums        (keyPath: id)  — empty until M4 album matching
//   - calendarCache (keyPath: id)  — empty until M3 live-calendar sync
//
// The DB name is namespaced (`l8rgram:l8rgram_db`) so it never collides with
// saveitforl8r on a shared dev origin.

import { openDB, type IDBPDatabase } from 'idb';
import { encryptData, decryptData, type EncryptedPayload } from '@l8r/shared/crypto';
import { storage } from '@l8r/shared/platform';
import type { Photo, Album, LiveCalendarEvent } from '../types';

const DB_NAME = 'l8rgram:l8rgram_db';
const DB_VERSION = 1;

export const PHOTOS_STORE = 'photos';
export const ALBUMS_STORE = 'albums';
export const CALENDAR_CACHE_STORE = 'calendarCache';

type StoreName = typeof PHOTOS_STORE | typeof ALBUMS_STORE | typeof CALENDAR_CACHE_STORE;

// The import cursor (running enumeration offset + max seen capture time) lives in
// the platform storage adapter rather than IDB so the three data stores stay
// purely content. Namespaced under `l8rgram:` like the rest of the app's keys.
const CURSOR_KEY = 'l8rgram:lastImportedAt';

// A record as stored on disk: the keyPath id in the clear, everything else
// encrypted. Keeping `id` unencrypted is required for IDB keying and is not
// sensitive (it is a client-generated uuid).
interface EncryptedRecord {
  id: string;
  encryptedData: EncryptedPayload;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

const getDB = (): Promise<IDBPDatabase> => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
          db.createObjectStore(PHOTOS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(ALBUMS_STORE)) {
          db.createObjectStore(ALBUMS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CALENDAR_CACHE_STORE)) {
          db.createObjectStore(CALENDAR_CACHE_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

// ─── Generic encrypted CRUD ─────────────────────────────────────────────────

const putEncrypted = async <T extends { id: string }>(store: StoreName, items: T[]): Promise<void> => {
  if (items.length === 0) return;
  const records: EncryptedRecord[] = await Promise.all(
    items.map(async (item) => {
      const { id, ...sensitive } = item;
      return { id, encryptedData: await encryptData(sensitive) };
    }),
  );
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all(records.map((r) => tx.store.put(r)));
  await tx.done;
};

const getAllDecrypted = async <T extends { id: string }>(store: StoreName): Promise<T[]> => {
  const db = await getDB();
  const records: EncryptedRecord[] = await db.getAll(store);
  const out: T[] = [];
  for (const record of records) {
    try {
      const data = await decryptData(record.encryptedData);
      out.push({ id: record.id, ...data } as T);
    } catch (e) {
      console.error(`[L8rgramDB] Failed to decrypt ${store} record ${record.id}`, e);
    }
  }
  return out;
};

const getOneDecrypted = async <T extends { id: string }>(store: StoreName, id: string): Promise<T | null> => {
  const db = await getDB();
  const record: EncryptedRecord | undefined = await db.get(store, id);
  if (!record) return null;
  try {
    const data = await decryptData(record.encryptedData);
    return { id: record.id, ...data } as T;
  } catch (e) {
    console.error(`[L8rgramDB] Failed to decrypt ${store} record ${id}`, e);
    return null;
  }
};

// ─── Photos ─────────────────────────────────────────────────────────────────

export const putPhotos = (photos: Photo[]): Promise<void> => putEncrypted(PHOTOS_STORE, photos);
export const getPhotos = (): Promise<Photo[]> => getAllDecrypted<Photo>(PHOTOS_STORE);
export const getPhotoById = (id: string): Promise<Photo | null> => getOneDecrypted<Photo>(PHOTOS_STORE, id);

// ─── Import cursor ──────────────────────────────────────────────────────────
// Persisted so re-import is incremental and album matching stays idempotent.

export const getLastImportedAt = async (): Promise<number | null> => {
  const raw = await storage.get(CURSOR_KEY);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
};

export const setLastImportedAt = async (value: number): Promise<void> => {
  await storage.set(CURSOR_KEY, String(value));
};

// ─── Albums (stub store — populated in M4) ──────────────────────────────────

export const putAlbums = (albums: Album[]): Promise<void> => putEncrypted(ALBUMS_STORE, albums);
export const getAlbums = (): Promise<Album[]> => getAllDecrypted<Album>(ALBUMS_STORE);
export const getAlbumById = (id: string): Promise<Album | null> => getOneDecrypted<Album>(ALBUMS_STORE, id);

// ─── Calendar cache (M3 live-calendar sync) ─────────────────────────────────

export const putCalendarEvents = (events: LiveCalendarEvent[]): Promise<void> =>
  putEncrypted(CALENDAR_CACHE_STORE, events);
export const getCalendarEvents = (): Promise<LiveCalendarEvent[]> =>
  getAllDecrypted<LiveCalendarEvent>(CALENDAR_CACHE_STORE);

// Timestamp of the last successful calendar sync. Kept in platform storage
// (alongside the import cursor) so the 5-min re-sync throttle survives reloads.
const CALENDAR_SYNCED_KEY = 'l8rgram:calendarLastSyncedAt';

export const getCalendarLastSyncedAt = async (): Promise<number | null> => {
  const raw = await storage.get(CALENDAR_SYNCED_KEY);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
};

export const setCalendarLastSyncedAt = async (value: number): Promise<void> => {
  await storage.set(CALENDAR_SYNCED_KEY, String(value));
};

// Test/maintenance helper — drop the cached singleton so a fresh DB handle is
// opened next call (used by unit tests after deleting the database).
export const _resetDbHandle = (): void => {
  dbPromise = null;
};
