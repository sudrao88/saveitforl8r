import { describe, it, expect } from 'vitest';
import { matchAlbums, BUFFER_MS } from '../services/albumMatcher';
import type { LiveCalendarEvent, Photo } from '../types';

// Anchor every test at a fixed local time so the "untitled" day key is stable
// regardless of the machine clock. 2024-06-02 12:00 local.
const baseDate = new Date(2024, 5, 2, 12, 0, 0, 0);
const BASE = baseDate.getTime();

const photo = (id: string, capturedAt: number, overrides: Partial<Photo> = {}): Photo => ({
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
  ...overrides,
});

const event = (
  id: string,
  start: number,
  end: number,
  overrides: Partial<LiveCalendarEvent> = {},
): LiveCalendarEvent => ({
  id,
  title: `Event ${id}`,
  start,
  end,
  ...overrides,
});

describe('matchAlbums', () => {
  it('matches a photo inside the event window', () => {
    const events = [event('e1', BASE, BASE + 60 * 60 * 1000)];
    const photos = [photo('p1', BASE + 10 * 60 * 1000)];

    const { albums, photos: out } = matchAlbums(photos, events);

    expect(albums).toHaveLength(1);
    expect(albums[0].id).toBe('event:e1');
    expect(albums[0].source).toBe('event');
    expect(albums[0].photoIds).toEqual(['p1']);
    expect(out[0].albumIds).toEqual(['event:e1']);
  });

  it('includes the lower buffer edge and excludes a tick past the upper edge', () => {
    const start = BASE;
    const end = BASE + 60 * 60 * 1000;
    const events = [event('e1', start, end)];

    // Just inside the lower edge (= start − BUFFER, inclusive)
    const justInsideLower = photo('inside-lo', start - BUFFER_MS);
    // Just outside the lower edge (= start − BUFFER − 1ms)
    const justOutsideLower = photo('outside-lo', start - BUFFER_MS - 1);
    // Just inside the upper edge (= end + BUFFER − 1ms, exclusive end)
    const justInsideUpper = photo('inside-hi', end + BUFFER_MS - 1);
    // Just outside the upper edge (= end + BUFFER, exclusive end)
    const justOutsideUpper = photo('outside-hi', end + BUFFER_MS);

    const { albums } = matchAlbums(
      [justInsideLower, justOutsideLower, justInsideUpper, justOutsideUpper],
      events,
    );

    const eventAlbum = albums.find((a) => a.id === 'event:e1');
    expect(eventAlbum?.photoIds.sort()).toEqual(['inside-hi', 'inside-lo']);

    // Both outside-edge photos fall through to untitled buckets.
    const untitled = albums.filter((a) => a.source === 'untitled');
    const allUntitledPhotos = untitled.flatMap((a) => a.photoIds).sort();
    expect(allUntitledPhotos).toEqual(['outside-hi', 'outside-lo']);
  });

  it('assigns a photo to overlapping events (multi-membership)', () => {
    const events = [
      event('e1', BASE, BASE + 2 * 60 * 60 * 1000),       // 12:00 – 14:00
      event('e2', BASE + 60 * 60 * 1000, BASE + 3 * 60 * 60 * 1000), // 13:00 – 15:00
    ];
    const p = photo('p1', BASE + 90 * 60 * 1000); // 13:30 — inside both

    const { photos: out, albums } = matchAlbums([p], events);

    expect(out[0].albumIds.sort()).toEqual(['event:e1', 'event:e2']);
    const ids = albums.map((a) => a.id).sort();
    expect(ids).toEqual(['event:e1', 'event:e2']);
    expect(albums.find((a) => a.id === 'event:e1')?.photoIds).toEqual(['p1']);
    expect(albums.find((a) => a.id === 'event:e2')?.photoIds).toEqual(['p1']);
  });

  it('buckets unmatched photos into per-local-day Untitled albums', () => {
    const events = [event('e1', BASE, BASE + 60 * 60 * 1000)];
    // A day later, far outside any event window.
    const oneDayLater = new Date(baseDate);
    oneDayLater.setDate(oneDayLater.getDate() + 1);
    const p1 = photo('p1', oneDayLater.getTime());

    const { photos: out, albums } = matchAlbums([p1], events);

    const dayKey = `${oneDayLater.getFullYear()}-${String(oneDayLater.getMonth() + 1).padStart(2, '0')}-${String(oneDayLater.getDate()).padStart(2, '0')}`;
    expect(out[0].albumIds).toEqual([`untitled:${dayKey}`]);
    const untitled = albums.find((a) => a.id === `untitled:${dayKey}`);
    expect(untitled).toBeDefined();
    expect(untitled?.source).toBe('untitled');
    expect(untitled?.coverPhotoId).toBe('p1');
  });

  it('is idempotent — running twice produces the same album set', () => {
    const events = [
      event('e1', BASE, BASE + 60 * 60 * 1000),
      event('e2', BASE + 5 * 60 * 60 * 1000, BASE + 6 * 60 * 60 * 1000),
    ];
    const photos = [
      photo('p1', BASE + 10 * 60 * 1000),
      photo('p2', BASE + 5 * 60 * 60 * 1000 + 10 * 60 * 1000),
      photo('p3', BASE - 10 * 24 * 60 * 60 * 1000), // way outside → untitled
    ];

    const first = matchAlbums(photos, events);
    // Feed the patched photos back through the matcher (mimics the re-run path
    // where `photos` carry their previous albumIds — the matcher must overwrite
    // them, not append).
    const second = matchAlbums(first.photos, events);

    expect(second.albums).toEqual(first.albums);
    expect(second.photos.map((p) => p.albumIds)).toEqual(first.photos.map((p) => p.albumIds));
  });

  it('treats all-day events as [start, end) with no buffer', () => {
    // Google's all-day events: start = day midnight local, end = next-day midnight local.
    const dayStart = new Date(2024, 5, 2, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(2024, 5, 3, 0, 0, 0, 0).getTime();
    const allDay = event('allday', dayStart, dayEnd, { allDay: true, title: 'Hike day' });

    const onDay = photo('on-day', new Date(2024, 5, 2, 15, 0, 0).getTime());
    const earlyMorning = photo('early', dayStart); // exactly at start → match
    const justBefore = photo('before', dayStart - 1); // 1ms before → no match (no buffer)
    const justAfter = photo('after', dayEnd); // exactly at end → no match (half-open)

    const { photos: out, albums } = matchAlbums(
      [onDay, earlyMorning, justBefore, justAfter],
      [allDay],
    );

    const eventAlbum = albums.find((a) => a.id === 'event:allday');
    expect(eventAlbum?.photoIds.sort()).toEqual(['early', 'on-day']);
    // Outside-day photos go to untitled buckets.
    expect(out.find((p) => p.id === 'before')?.albumIds[0]).toMatch(/^untitled:/);
    expect(out.find((p) => p.id === 'after')?.albumIds[0]).toMatch(/^untitled:/);
  });

  it('sets coverPhotoId to the earliest photo by capturedAt', () => {
    const events = [event('e1', BASE, BASE + 3 * 60 * 60 * 1000)];
    const photos = [
      photo('late', BASE + 2 * 60 * 60 * 1000),
      photo('early', BASE + 10 * 60 * 1000),
      photo('middle', BASE + 60 * 60 * 1000),
    ];

    const { albums } = matchAlbums(photos, events);
    const album = albums[0];

    expect(album.coverPhotoId).toBe('early');
    expect(album.photoIds).toEqual(['early', 'middle', 'late']);
  });
});
