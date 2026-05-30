# M4 — Album matching

## Goal
Build a deterministic, idempotent matcher that buckets photos into albums by EXIF `capturedAt ∈ [event.start − BUFFER, event.end + BUFFER]`. Surface albums in the UI.

## In scope
1. `apps/l8rgram/services/albumMatcher.ts` — pure function: `(photos, events, opts) => { photos: Photo[], albums: Album[] }`. Multi-membership allowed. Albums keyed by `eventId` (idempotent on re-import).
2. `apps/l8rgram/hooks/useAlbumMatching.ts` — runs the matcher whenever `photos` or `calendarCache` change; persists results to the `albums` store and patches `photo.albumIds`.
3. "Untitled <date>" bucket for photos with no matching event (one bucket per device-local day).
4. Screens: `AlbumsScreen` (grid of album covers with event title + date + photo count), `AlbumDetailScreen` (event title/time/location/description header, then photo grid).
5. Bottom nav (or top tab) in `App.tsx` toggling between Gallery and Albums.
6. Unit tests covering: in-window match, buffer-edge match (just inside / just outside ±BUFFER), overlapping events (multi-membership), no match (Untitled bucket), idempotency (re-run produces identical album set), all-day events.

## Out of scope
- Gemini enrichment (M5).
- Search (M5).
- Calendar push notifications.

## Matcher spec
- `const BUFFER_MS = 90 * 60 * 1000;` (90 min — bookmark this constant; M5/M6 may surface it as a setting later).
- Sort `events` by `start` once; for each photo, binary-search candidate events whose `[start-BUFFER, end+BUFFER]` window contains `capturedAt`.
- Album id = `event:${eventId}`.
- Untitled bucket id = `untitled:${YYYY-MM-DD}` (device local tz).
- Album `coverPhotoId` = first photo by `capturedAt`.
- All-day events: treat as `[startOfDay, endOfDay]` in device local tz, no buffer.

## Album type
```ts
export interface Album {
  id: string;
  title: string;
  source: 'event' | 'untitled';
  eventId?: string;
  start?: number;
  end?: number;
  location?: string;
  description?: string;
  coverPhotoId: string;
  photoIds: string[];
}
```

## Design system
All UI uses `@l8r/shared/design-system`. `AlbumDetailScreen` header uses `text.heading` / `text.subheading` / `text.caption`. Grid tiles use `card.interactive`. Bottom nav uses tokens for `--z-sticky` and the appropriate radius. NEVER raw Tailwind values.

## Verification (orchestrator runs)
- `npm test -w l8rgram` green (new matcher + UI tests).
- `npm run build -w l8rgram` green.

## Commit
One commit:
`feat(l8rgram): m4-album-matching — deterministic event-window matcher + Albums UI`
