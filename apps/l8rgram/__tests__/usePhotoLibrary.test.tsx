import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';

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

// Replace the photo-library facade entirely so the native plugin import never
// runs in jsdom. The hook only consumes `ensurePermission` and `enumerateAll`.
vi.mock('../services/photoLibrary', () => ({
  ensurePermission: vi.fn(async () => ({ state: 'granted' as const, limited: false })),
  enumerateAll: vi.fn(),
}));

import { usePhotoLibrary } from '../hooks/usePhotoLibrary';
import { _resetDbHandle } from '../services/storageService';
import { enumerateAll, ensurePermission } from '../services/photoLibrary';

const mockedEnumerate = vi.mocked(enumerateAll);
const mockedEnsure = vi.mocked(ensurePermission);

const makePhoto = (assetId: string, capturedAt: number) => ({
  id: assetId,
  assetId,
  uri: '',
  mimeType: 'image/jpeg',
  width: 1,
  height: 1,
  capturedAt,
  tags: [],
  albumIds: [],
  enrichmentStatus: 'pending' as const,
});

const yieldOnePage = (photos: ReturnType<typeof makePhoto>[]) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (async function* () {
    yield { offset: photos.length, photos };
  })() as any;

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetDbHandle();
  mockedEnsure.mockResolvedValue({ state: 'granted', limited: false });
  mockedEnumerate.mockReset();
});

describe('usePhotoLibrary', () => {
  it('imports a page of photos and persists them', async () => {
    mockedEnumerate.mockReturnValueOnce(
      yieldOnePage([makePhoto('asset-a', 100), makePhoto('asset-b', 200)]),
    );

    const { result } = renderHook(() => usePhotoLibrary());
    await act(async () => {
      await result.current.importLibrary();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.photos).toHaveLength(2);
    expect(result.current.photos.map((p) => p.assetId).sort()).toEqual([
      'asset-a',
      'asset-b',
    ]);
    // Sorted by capturedAt desc — newer first.
    expect(result.current.photos[0].assetId).toBe('asset-b');
  });

  it('dedupes by assetId on re-import (idempotent)', async () => {
    const pageA = [makePhoto('asset-a', 100), makePhoto('asset-b', 200)];
    mockedEnumerate.mockReturnValueOnce(yieldOnePage(pageA));

    const { result } = renderHook(() => usePhotoLibrary());
    await act(async () => {
      await result.current.importLibrary();
    });
    await waitFor(() => expect(result.current.photos).toHaveLength(2));

    // Re-run with the same assetIds — generator returns the same page.
    mockedEnumerate.mockReturnValueOnce(yieldOnePage(pageA));
    await act(async () => {
      await result.current.importLibrary();
    });

    expect(result.current.photos).toHaveLength(2);
  });

  it('surfaces an error when permission is denied', async () => {
    mockedEnsure.mockResolvedValueOnce({ state: 'denied', limited: false });

    const { result } = renderHook(() => usePhotoLibrary());
    await act(async () => {
      await result.current.importLibrary();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/denied/i);
    expect(mockedEnumerate).not.toHaveBeenCalled();
  });
});
