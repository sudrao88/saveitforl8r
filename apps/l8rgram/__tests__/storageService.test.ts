import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// Stub the platform storage adapter so cursor helpers don't try to reach
// Capacitor Preferences (absent in jsdom). Keeps tests hermetic.
vi.mock('@l8r/shared/platform', () => {
  const mem = new Map<string, string>();
  return {
    isNative: () => false,
    storage: {
      get: vi.fn(async (k: string) => mem.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        mem.set(k, v);
      }),
      remove: vi.fn(async (k: string) => {
        mem.delete(k);
      }),
    },
  };
});

import {
  putPhotos,
  getPhotos,
  getPhotoById,
  putAlbums,
  getAlbums,
  putCalendarEvents,
  getCalendarEvents,
  getLastImportedAt,
  setLastImportedAt,
  _resetDbHandle,
} from '../services/storageService';
import type { Photo, Album, LiveCalendarEvent } from '../types';

const samplePhoto = (id: string, overrides: Partial<Photo> = {}): Photo => ({
  id,
  assetId: `asset-${id}`,
  uri: '',
  mimeType: 'image/jpeg',
  width: 100,
  height: 100,
  capturedAt: 1700000000000,
  tags: [],
  albumIds: [],
  enrichmentStatus: 'pending',
  ...overrides,
});

beforeEach(() => {
  // Fresh in-memory IDB per test so the encrypted store + crypto keystore
  // don't leak across cases.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetDbHandle();
});

describe('L8rgramDB storageService', () => {
  it('round-trips photos through encryption', async () => {
    const p = samplePhoto('p1', { caption: 'hello' });
    await putPhotos([p]);

    const all = await getPhotos();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'p1', caption: 'hello', assetId: 'asset-p1' });

    const one = await getPhotoById('p1');
    expect(one?.caption).toBe('hello');
  });

  it('returns null for a missing photo id', async () => {
    expect(await getPhotoById('missing')).toBeNull();
  });

  it('round-trips albums and calendar events', async () => {
    const a: Album = {
      id: 'a1',
      title: 'Brunch',
      source: 'calendar',
      eventId: 'evt-1',
      start: 1,
      end: 2,
      photoIds: ['p1'],
    };
    await putAlbums([a]);
    const albums = await getAlbums();
    expect(albums[0].title).toBe('Brunch');

    const evt: LiveCalendarEvent = { id: 'evt-1', title: 'Brunch', start: 1, end: 2 };
    await putCalendarEvents([evt]);
    const events = await getCalendarEvents();
    expect(events[0].title).toBe('Brunch');
  });

  it('persists and reads back the import cursor', async () => {
    expect(await getLastImportedAt()).toBeNull();
    await setLastImportedAt(1700000000000);
    expect(await getLastImportedAt()).toBe(1700000000000);
  });

  it('no-ops on empty put', async () => {
    await putPhotos([]);
    expect(await getPhotos()).toHaveLength(0);
  });
});
