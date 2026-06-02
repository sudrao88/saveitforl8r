import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';

// Platform storage (storageService imports it at module load).
const mem = new Map<string, string>();
vi.mock('@l8r/shared/platform', () => ({
  isNative: () => false,
  storage: {
    get: vi.fn(async (k: string) => mem.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { mem.set(k, v); }),
    remove: vi.fn(async (k: string) => { mem.delete(k); }),
  },
}));

// Shared AI surface the hook depends on.
const mockPostProxy = vi.fn();
const mockUpload = vi.fn();
vi.mock('@l8r/shared/ai', () => ({
  postProxy: (...args: unknown[]) => mockPostProxy(...args),
  uploadFileChunked: (...args: unknown[]) => mockUpload(...args),
  LARGE_PAYLOAD_THRESHOLD: 1_200_000,
}));

import { usePhotoEnrichment } from '../hooks/usePhotoEnrichment';
import { _resetDbHandle, putPhotos, getPhotoById } from '../services/storageService';
import type { Photo } from '../types';

const makePhoto = (id: string, overrides: Partial<Photo> = {}): Photo => ({
  id,
  assetId: id,
  uri: `blob:${id}`,
  thumbnailUri: `blob:${id}-thumb`,
  mimeType: 'image/jpeg',
  width: 100,
  height: 100,
  capturedAt: 1000,
  tags: [],
  albumIds: [],
  enrichmentStatus: 'pending',
  ...overrides,
});

// global.fetch resolves a photo's bytes — return a blob of the given size.
const stubFetchBlob = (byteLength: number) => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob([new Uint8Array(byteLength)], { type: 'image/jpeg' }),
  })) as unknown as typeof fetch;
};

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetDbHandle();
  mem.clear();
  mockPostProxy.mockReset();
  mockUpload.mockReset();
  stubFetchBlob(16);
});

describe('usePhotoEnrichment', () => {
  it('enriches a pending photo inline and writes caption + tags back', async () => {
    const photo = makePhoto('p1');
    await putPhotos([photo]);

    mockPostProxy.mockImplementation(async (path: string) => {
      if (path === '/api/enrich-photo') return { status: 'accepted' };
      return { results: { p1: { status: 'completed', data: { caption: 'A cat naps.', tags: ['cat', 'nap'] } } } };
    });

    const { result } = renderHook(() => usePhotoEnrichment([photo]));

    await waitFor(() => expect(result.current.enrichedById.get('p1')?.enrichmentStatus).toBe('enriched'));

    const patch = result.current.enrichedById.get('p1');
    expect(patch?.caption).toBe('A cat naps.');
    expect(patch?.tags).toEqual(['cat', 'nap']);

    // The submit carried inline base64 (no chunked upload for a tiny image).
    const submit = mockPostProxy.mock.calls.find((c) => c[0] === '/api/enrich-photo');
    expect(submit?.[1]).toMatchObject({ jobId: 'p1' });
    expect((submit?.[1] as { image: { data?: string } }).image.data).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();

    // Persisted to the encrypted store.
    const stored = await getPhotoById('p1');
    expect(stored?.caption).toBe('A cat naps.');
    expect(stored?.enrichmentStatus).toBe('enriched');
  });

  it('uses the chunked-upload path for a large image', async () => {
    stubFetchBlob(1_000_000); // ~1.33M base64 chars > LARGE_PAYLOAD_THRESHOLD
    const photo = makePhoto('big');
    await putPhotos([photo]);

    mockUpload.mockResolvedValue({
      fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/x',
      geminiFileName: 'files/x',
    });
    mockPostProxy.mockImplementation(async (path: string) => {
      if (path === '/api/enrich-photo') return { status: 'accepted' };
      return { results: { big: { status: 'completed', data: { caption: 'Wide vista.', tags: ['view'] } } } };
    });

    const { result } = renderHook(() => usePhotoEnrichment([photo]));

    await waitFor(() => expect(result.current.enrichedById.get('big')?.enrichmentStatus).toBe('enriched'));

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const submit = mockPostProxy.mock.calls.find((c) => c[0] === '/api/enrich-photo');
    expect((submit?.[1] as { image: { fileUri?: string } }).image.fileUri).toContain('files/x');
  });

  it('marks a photo failed when the server reports failure', async () => {
    const photo = makePhoto('p2');
    await putPhotos([photo]);

    mockPostProxy.mockImplementation(async (path: string) => {
      if (path === '/api/enrich-photo') return { status: 'accepted' };
      return { results: { p2: { status: 'failed' } } };
    });

    const { result } = renderHook(() => usePhotoEnrichment([photo]));

    await waitFor(() => expect(result.current.enrichedById.get('p2')?.enrichmentStatus).toBe('failed'));
  });

  it('skips photos that are already enriched', async () => {
    const photo = makePhoto('done', { enrichmentStatus: 'enriched', caption: 'cached' });
    renderHook(() => usePhotoEnrichment([photo]));
    // Give any stray async work a tick to (not) run.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockPostProxy).not.toHaveBeenCalled();
  });
});
