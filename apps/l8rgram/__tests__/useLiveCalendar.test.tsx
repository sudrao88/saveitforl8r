import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';

// Mock platform storage (the lastSyncedAt cursor lives here).
const mem = new Map<string, string>();
vi.mock('@l8r/shared/platform', () => ({
  isNative: () => false,
  storage: {
    get: vi.fn(async (k: string) => mem.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { mem.set(k, v); }),
    remove: vi.fn(async (k: string) => { mem.delete(k); }),
  },
}));

// Mock the shared auth/ai surfaces the hook depends on.
const mockFetch = vi.fn();
vi.mock('@l8r/shared/auth', () => ({
  getAuthorizedFetch: (...args: unknown[]) => mockFetch(...args),
}));
vi.mock('@l8r/shared/ai', () => ({
  getProxyUrl: () => 'https://proxy.test',
}));

import { useLiveCalendar } from '../hooks/useLiveCalendar';
import { _resetDbHandle, getCalendarEvents } from '../services/storageService';
import type { Photo } from '../types';

const makePhoto = (id: string, capturedAt: number): Photo => ({
  id,
  assetId: id,
  uri: '',
  mimeType: 'image/jpeg',
  width: 1,
  height: 1,
  capturedAt,
  tags: [],
  albumIds: [],
  enrichmentStatus: 'pending',
});

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetDbHandle();
  mem.clear();
  mockFetch.mockReset();
});

describe('useLiveCalendar', () => {
  it('is a no-op when there are no photos', async () => {
    const { result } = renderHook(() => useLiveCalendar([]));
    await act(async () => {
      await result.current.syncNow();
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.events).toHaveLength(0);
  });

  it('follows nextPageToken and persists all events', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            { id: 'evt-1', summary: 'Lunch', start: { dateTime: '2024-06-02T12:00:00Z' }, end: { dateTime: '2024-06-02T13:00:00Z' } },
          ],
          nextPageToken: 'pg2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            { id: 'evt-2', summary: 'Hike', start: { date: '2024-06-03' }, end: { date: '2024-06-04' } },
          ],
        }),
      );

    const photos = [makePhoto('a', Date.parse('2024-06-01T00:00:00Z')), makePhoto('b', Date.parse('2024-06-05T00:00:00Z'))];
    const { result } = renderHook(() => useLiveCalendar(photos));

    await act(async () => {
      await result.current.syncNow();
    });

    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second page request must carry the pageToken.
    expect(String(mockFetch.mock.calls[1][0])).toContain('pageToken=pg2');

    // Mapped + sorted by start ascending; all-day flag derived from `date`.
    expect(result.current.events.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
    expect(result.current.events[1].allDay).toBe(true);

    // Persisted to the encrypted calendarCache.
    const cached = await getCalendarEvents();
    expect(cached.map((e) => e.id).sort()).toEqual(['evt-1', 'evt-2']);
  });

  it('throttles automatic re-sync but syncNow always bypasses it', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [] }));

    const photos = [makePhoto('a', 1000), makePhoto('b', 2000)];
    const { result, rerender } = renderHook(({ p }) => useLiveCalendar(p), {
      initialProps: { p: photos },
    });

    // Manual sync (bypasses throttle) — sets lastSyncedAt to ~now.
    await act(async () => {
      await result.current.syncNow();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Changing the photo span triggers the auto re-sync effect, but it is
    // throttled (we just synced) so no new request goes out.
    await act(async () => {
      rerender({ p: [makePhoto('a', 1000), makePhoto('c', 9999)] });
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // An explicit tap still forces a fresh sync.
    await act(async () => {
      await result.current.syncNow();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
