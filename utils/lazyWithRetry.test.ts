import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// clearServiceWorkerCaches is mocked so the retry path doesn't touch the real
// Cache API. isChunkLoadError uses the real implementation.
vi.mock('./chunkErrorUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./chunkErrorUtils')>();
  return {
    ...actual,
    clearServiceWorkerCaches: vi.fn().mockResolvedValue(undefined),
  };
});

import { importWithChunkRetry, resetChunkRetryGuard } from './lazyWithRetry';
import { clearServiceWorkerCaches } from './chunkErrorUtils';

const RETRY_KEY = 'chunk_retry_refresh';

const chunkError = () =>
  new Error('Failed to fetch dynamically imported module: /assets/MomentSheet-abc123.js');

describe('importWithChunkRetry', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    reloadSpy = vi.fn();
    // jsdom marks location.reload as non-configurable; redefine for the test.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the module on success', async () => {
    const mod = { default: () => null };
    await expect(importWithChunkRetry(async () => mod)).resolves.toBe(mod);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('clears the retry guard after a successful import', async () => {
    sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    await importWithChunkRetry(async () => ({ default: () => null }));
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it('rethrows non-chunk errors without reloading', async () => {
    const err = new Error('TypeError: x is undefined');
    await expect(
      importWithChunkRetry(async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(clearServiceWorkerCaches).not.toHaveBeenCalled();
  });

  it('clears caches, records a timestamp and reloads on a chunk error', async () => {
    // never resolves (page is "reloading"), so don't await it
    importWithChunkRetry(async () => {
      throw chunkError();
    });
    // allow the rejected import + recovery microtasks to run
    await Promise.resolve();
    await Promise.resolve();

    expect(clearServiceWorkerCaches).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(Number(sessionStorage.getItem(RETRY_KEY))).toBeGreaterThan(0);
  });

  it('surfaces the error instead of looping when a reload just happened', async () => {
    // Simulate having reloaded moments ago.
    sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    const err = chunkError();
    await expect(
      importWithChunkRetry(async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(reloadSpy).not.toHaveBeenCalled();
    // Guard is cleared so a future failure can recover again.
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it('re-arms recovery once the cooldown has elapsed', async () => {
    // A reload from well in the past should not suppress a fresh recovery.
    sessionStorage.setItem(RETRY_KEY, String(Date.now() - 60_000));
    importWithChunkRetry(async () => {
      throw chunkError();
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(clearServiceWorkerCaches).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('resetChunkRetryGuard', () => {
  it('removes the retry guard key', () => {
    sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    resetChunkRetryGuard();
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });
});
