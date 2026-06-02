// l8rgram data model (spec §4). Photos stay on-device in v1; only this metadata
// (+ thumbnails) is persisted, encrypted at rest via @l8r/shared/crypto.

export type EnrichmentStatus = 'pending' | 'enriched' | 'failed' | 'skipped';

export interface Photo {
  id: string;            // uuid generated client-side
  assetId: string;       // native asset identifier (de-dupe key)
  uri: string;           // platform-specific URI for full bytes (lazy; may be empty until opened)
  thumbnailUri?: string;
  mimeType: string;
  width: number;
  height: number;
  capturedAt: number;    // epoch ms (the album-matching key — M4)
  location?: { lat: number; lng: number };
  caption?: string;      // M5
  tags: string[];        // M5
  albumIds: string[];    // M4
  enrichmentStatus: EnrichmentStatus;
}

// Albums are built deterministically in M4 by matching photo capture times to
// calendar event windows. Photos with no matching event fall into per-day
// `untitled` buckets so every photo is reachable from the Albums tab.
export type AlbumSource = 'event' | 'untitled';

export interface Album {
  id: string;                // `event:${eventId}` or `untitled:${YYYY-MM-DD}` (idempotency key)
  title: string;
  source: AlbumSource;
  eventId?: string;          // present when source === 'event'
  start: number;             // epoch ms (event window start, or local startOfDay for untitled)
  end: number;               // epoch ms (event window end,   or local endOfDay   for untitled)
  location?: string;
  description?: string;
  coverPhotoId: string;      // first photo by capturedAt; never empty (album exists ⇒ ≥1 photo)
  photoIds: string[];
}

// A live Google Calendar event fetched in M3 via the server proxy, cached
// (encrypted) in calendarCache for offline album rebuild.
export interface LiveCalendarEvent {
  id: string;
  title: string;
  start: number;             // epoch ms
  end: number;               // epoch ms
  location?: string;
  description?: string;
  calendarId?: string;
  allDay?: boolean;
}
