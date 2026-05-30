import { describe, it, expect, beforeEach, vi } from 'vitest';

// Back the platform storage adapter with an in-memory map and force native mode
// so migrateLegacyTokenStorage exercises the storage-adapter path (the web path
// uses IndexedDB, which jsdom does not provide). This mirrors the on-device
// migration where access/refresh tokens live in Capacitor Preferences.
const store = new Map<string, string>();

vi.mock('../../platform/platform', () => ({
  isNative: () => true,
  storage: {
    get: async (k: string) => (store.has(k) ? store.get(k)! : null),
    set: async (k: string, v: string) => { store.set(k, v); },
    remove: async (k: string) => { store.delete(k); },
    clear: async () => { store.clear(); },
  },
}));

import { migrateLegacyTokenStorage } from '../tokenService';

const NS = 'saveitforl8r';
const p = (k: string) => `${NS}:${k}`;

describe('migrateLegacyTokenStorage', () => {
  beforeEach(() => {
    store.clear();
  });

  it('is a no-op when no namespace is given', async () => {
    store.set('access_token', 'AT');
    await migrateLegacyTokenStorage(undefined);
    // Old key untouched, nothing namespaced created.
    expect(store.get('access_token')).toBe('AT');
    expect([...store.keys()].some((k) => k.startsWith(`${NS}:`))).toBe(false);
  });

  it('is a no-op on a fresh install (no legacy keys)', async () => {
    await migrateLegacyTokenStorage(NS);
    expect(store.size).toBe(0);
  });

  it('migrates legacy unprefixed keys to the namespace, deleting the originals', async () => {
    store.set('access_token', 'AT');
    store.set('expires_at', '1700000000000');
    store.set('refresh_token', 'RT');
    store.set('gdrive_linked', 'true');

    await migrateLegacyTokenStorage(NS);

    // New namespaced keys carry the values.
    expect(store.get(p('access_token'))).toBe('AT');
    expect(store.get(p('expires_at'))).toBe('1700000000000');
    expect(store.get(p('refresh_token'))).toBe('RT');
    expect(store.get(p('gdrive_linked'))).toBe('true');

    // Originals are removed.
    expect(store.has('access_token')).toBe(false);
    expect(store.has('expires_at')).toBe(false);
    expect(store.has('refresh_token')).toBe(false);
    expect(store.has('gdrive_linked')).toBe(false);
  });

  it('is idempotent when already migrated', async () => {
    store.set(p('access_token'), 'AT');
    store.set(p('refresh_token'), 'RT');

    await migrateLegacyTokenStorage(NS);

    expect(store.get(p('access_token'))).toBe('AT');
    expect(store.get(p('refresh_token'))).toBe('RT');
    // No stray legacy keys conjured.
    expect(store.has('access_token')).toBe(false);
    expect(store.has('refresh_token')).toBe(false);
  });

  it('does not re-copy or delete when a partial migration left both keys present', async () => {
    // Crash between write-new and delete-old: both the new and the old exist.
    store.set('access_token', 'OLD');
    store.set(p('access_token'), 'NEW');

    await migrateLegacyTokenStorage(NS);

    // New value preserved (not overwritten by the stale old one)...
    expect(store.get(p('access_token'))).toBe('NEW');
    // ...and skipping the delete of the leftover old key is acceptable.
    expect(store.get('access_token')).toBe('OLD');
  });
});
