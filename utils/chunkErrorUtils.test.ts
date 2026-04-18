import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isChunkLoadError, clearServiceWorkerCaches } from './chunkErrorUtils';

describe('isChunkLoadError', () => {
  it('returns false for non-Error values', () => {
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError('loading chunk failed')).toBe(false);
    expect(isChunkLoadError({ message: 'loading chunk' })).toBe(false);
  });

  it('matches "Failed to fetch dynamically imported module"', () => {
    expect(
      isChunkLoadError(
        new Error('Failed to fetch dynamically imported module: /assets/foo.js'),
      ),
    ).toBe(true);
  });

  it('matches "importing a module script failed"', () => {
    expect(
      isChunkLoadError(new Error('Importing a module script failed.')),
    ).toBe(true);
  });

  it('matches "Loading chunk <id> failed"', () => {
    expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true);
  });

  it('matches "Loading CSS chunk" errors', () => {
    expect(
      isChunkLoadError(new Error('Loading CSS chunk 3 failed.')),
    ).toBe(true);
  });

  it('matches the MIME type mismatch error from stale chunks', () => {
    expect(
      isChunkLoadError(
        new Error(
          "text/html is not a valid JavaScript MIME type for an import",
        ),
      ),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isChunkLoadError(new Error('LOADING CHUNK 1 FAILED'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
    expect(isChunkLoadError(new Error('TypeError: x is undefined'))).toBe(false);
    expect(isChunkLoadError(new Error(''))).toBe(false);
  });
});

describe('clearServiceWorkerCaches', () => {
  const originalCaches = (globalThis as unknown as { caches?: CacheStorage }).caches;

  beforeEach(() => {
    // Ensure a clean slate each test
    delete (globalThis as unknown as { caches?: CacheStorage }).caches;
  });

  afterEach(() => {
    if (originalCaches) {
      (globalThis as unknown as { caches: CacheStorage }).caches = originalCaches;
    } else {
      delete (globalThis as unknown as { caches?: CacheStorage }).caches;
    }
  });

  it('iterates all keys and deletes each one when caches API is available', async () => {
    const keys = vi.fn().mockResolvedValue(['v1', 'v2', 'v3']);
    const del = vi.fn().mockResolvedValue(true);
    (globalThis as unknown as { caches: Partial<CacheStorage> }).caches = {
      keys,
      delete: del,
    };

    await clearServiceWorkerCaches();

    expect(keys).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(3);
    expect(del).toHaveBeenNthCalledWith(1, 'v1');
    expect(del).toHaveBeenNthCalledWith(2, 'v2');
    expect(del).toHaveBeenNthCalledWith(3, 'v3');
  });

  it('resolves quietly when the caches API is unavailable', async () => {
    // No caches on window — just make sure it doesn't throw
    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined();
  });

  it('swallows errors from caches.keys()', async () => {
    (globalThis as unknown as { caches: Partial<CacheStorage> }).caches = {
      keys: vi.fn().mockRejectedValue(new Error('boom')),
      delete: vi.fn(),
    };
    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined();
  });

  it('swallows errors from caches.delete()', async () => {
    (globalThis as unknown as { caches: Partial<CacheStorage> }).caches = {
      keys: vi.fn().mockResolvedValue(['v1']),
      delete: vi.fn().mockRejectedValue(new Error('denied')),
    };
    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined();
  });
});
