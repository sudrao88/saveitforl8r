import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockPostProxy = vi.fn();
vi.mock('@l8r/shared/ai', () => ({
  postProxy: (...args: unknown[]) => mockPostProxy(...args),
}));

import { useGallerySearch } from '../hooks/useGallerySearch';
import type { Album, Photo } from '../types';

const photo = (id: string, overrides: Partial<Photo> = {}): Photo => ({
  id,
  assetId: id,
  uri: '',
  mimeType: 'image/jpeg',
  width: 1,
  height: 1,
  capturedAt: 1000,
  tags: [],
  albumIds: [],
  enrichmentStatus: 'enriched',
  ...overrides,
});

const PHOTOS: Photo[] = [
  photo('p1', { caption: 'ocean waves', tags: ['sea'], albumIds: ['event:e1'] }),
  photo('p2', { caption: 'sandcastle', tags: ['beach'] }),
  photo('p3', { caption: 'office desk', tags: ['work'] }),
];

const ALBUMS: Album[] = [
  { id: 'event:e1', title: 'Beach Trip', source: 'event', start: 0, end: 1, coverPhotoId: 'p1', photoIds: ['p1'] },
];

beforeEach(() => {
  mockPostProxy.mockReset();
});

describe('useGallerySearch', () => {
  it('posts a context block and resolves ids to photos in order', async () => {
    mockPostProxy.mockResolvedValue({ photoIds: ['p2', 'p1'], reasoning: 'beach matches' });

    const { result } = renderHook(() => useGallerySearch(PHOTOS, ALBUMS));

    await act(async () => { await result.current.search('beach'); });

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.results.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(result.current.reasoning).toBe('beach matches');

    // The request carried the per-photo contexts incl. resolved album titles.
    const body = mockPostProxy.mock.calls[0][1] as {
      query: string;
      photoContexts: Array<{ id: string; albumTitles: string[] }>;
    };
    expect(body.query).toBe('beach');
    expect(body.photoContexts).toHaveLength(3);
    expect(body.photoContexts.find((c) => c.id === 'p1')?.albumTitles).toEqual(['Beach Trip']);
  });

  it('drops returned ids that are not in the photo set', async () => {
    mockPostProxy.mockResolvedValue({ photoIds: ['p1', 'ghost'] });

    const { result } = renderHook(() => useGallerySearch(PHOTOS, ALBUMS));
    await act(async () => { await result.current.search('x'); });

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.results.map((p) => p.id)).toEqual(['p1']);
  });

  it('is a no-op for an empty query', async () => {
    const { result } = renderHook(() => useGallerySearch(PHOTOS, ALBUMS));
    await act(async () => { await result.current.search('   '); });
    expect(mockPostProxy).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('surfaces an error when the request fails', async () => {
    mockPostProxy.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useGallerySearch(PHOTOS, ALBUMS));
    await act(async () => { await result.current.search('beach'); });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('boom');
  });

  it('clear() resets results and query', async () => {
    mockPostProxy.mockResolvedValue({ photoIds: ['p1'] });
    const { result } = renderHook(() => useGallerySearch(PHOTOS, ALBUMS));

    await act(async () => { await result.current.search('beach'); });
    await waitFor(() => expect(result.current.results).toHaveLength(1));

    act(() => { result.current.clear(); });
    expect(result.current.results).toHaveLength(0);
    expect(result.current.query).toBe('');
    expect(result.current.status).toBe('idle');
  });
});
