// Deterministic, idempotent album matcher.
//
// Buckets photos into albums by EXIF capturedAt ∈ [event.start − BUFFER,
// event.end + BUFFER). All-day events use [startOfLocalDay, endOfLocalDay) with
// no buffer. Photos that match no event fall into a per-device-local-day
// `untitled` bucket so every photo is reachable from the Albums tab.
//
// Pure function: same (photos, events) always produces the same albums and
// patched photo.albumIds — re-import never duplicates albums.

import type { Album, LiveCalendarEvent, Photo } from '../types';

// Bookmark: M5/M6 may surface this as a user-tunable setting.
export const BUFFER_MS = 90 * 60 * 1000;

export interface MatchOptions {
  bufferMs?: number;
}

export interface MatchResult {
  photos: Photo[];
  albums: Album[];
}

const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const endOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

const localDateKey = (ms: number): string => {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Half-open [start, end) for a single event: timed events get ±BUFFER; all-day
// events get the local day range (Google's `end` is exclusive next-day midnight,
// so half-open arithmetic already does the right thing — no extra subtraction).
const eventWindow = (e: LiveCalendarEvent, bufferMs: number): [number, number] => {
  if (e.allDay) return [e.start, e.end];
  return [e.start - bufferMs, e.end + bufferMs];
};

export function matchAlbums(
  photos: Photo[],
  events: LiveCalendarEvent[],
  opts: MatchOptions = {},
): MatchResult {
  const bufferMs = opts.bufferMs ?? BUFFER_MS;

  // Sort events by start so the iteration order is stable across runs —
  // tie-breaking by id keeps idempotency exact when two events share a start.
  const sortedEvents = [...events].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const windows = sortedEvents.map((e) => eventWindow(e, bufferMs));

  const albumMap = new Map<string, Album>();

  const ensureEventAlbum = (e: LiveCalendarEvent): Album => {
    const id = `event:${e.id}`;
    const existing = albumMap.get(id);
    if (existing) return existing;
    const album: Album = {
      id,
      title: e.title,
      source: 'event',
      eventId: e.id,
      start: e.start,
      end: e.end,
      location: e.location,
      description: e.description,
      coverPhotoId: '',
      photoIds: [],
    };
    albumMap.set(id, album);
    return album;
  };

  const ensureUntitledAlbum = (capturedAt: number): Album => {
    const key = localDateKey(capturedAt);
    const id = `untitled:${key}`;
    const existing = albumMap.get(id);
    if (existing) return existing;
    const album: Album = {
      id,
      title: `Untitled ${key}`,
      source: 'untitled',
      start: startOfLocalDay(capturedAt),
      end: endOfLocalDay(capturedAt),
      coverPhotoId: '',
      photoIds: [],
    };
    albumMap.set(id, album);
    return album;
  };

  // Match each photo against every event window (multi-membership allowed).
  // O(P*E) — typical user has ≤ a few thousand events in the photo span; for
  // larger libraries the sweep can be upgraded to a binary search later.
  const patchedPhotos: Photo[] = photos.map((p) => {
    const albumIds: string[] = [];
    for (let i = 0; i < sortedEvents.length; i++) {
      const [ws, we] = windows[i];
      if (p.capturedAt >= ws && p.capturedAt < we) {
        const album = ensureEventAlbum(sortedEvents[i]);
        album.photoIds.push(p.id);
        albumIds.push(album.id);
      }
    }
    if (albumIds.length === 0) {
      const album = ensureUntitledAlbum(p.capturedAt);
      album.photoIds.push(p.id);
      albumIds.push(album.id);
    }
    return { ...p, albumIds };
  });

  const photoById = new Map(patchedPhotos.map((p) => [p.id, p] as const));

  // Cover photo = earliest by capturedAt; photoIds sorted ascending so the
  // detail view renders in chronological order and idempotent reruns produce
  // byte-identical album records.
  const albums = Array.from(albumMap.values()).map((album) => {
    const sorted = [...album.photoIds]
      .map((pid) => photoById.get(pid)!)
      .sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id));
    return {
      ...album,
      coverPhotoId: sorted[0]?.id ?? '',
      photoIds: sorted.map((p) => p.id),
    };
  });

  return { photos: patchedPhotos, albums };
}
