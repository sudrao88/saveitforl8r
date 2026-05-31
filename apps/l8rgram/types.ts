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
// calendar event windows. Empty store until then.
export type AlbumSource = 'calendar' | 'manual' | 'auto';

export interface Album {
  id: string;
  title: string;
  source: AlbumSource;
  eventId?: string;          // calendar event id when source === 'calendar' (idempotency key)
  start: number;             // epoch ms
  end: number;               // epoch ms
  location?: string;
  description?: string;
  coverPhotoId?: string;
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
