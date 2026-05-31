// photoLibrary.ts — the single isolation layer over photo-library ingestion.
//
// Per the M2a spike (`docs/l8rgram-m2-spike.md`) the chosen backend is
// `@capgo/capacitor-photo-library` (symmetric iOS + Android enumeration with
// offset/limit paging, per-asset creationDate + GPS, and webview-displayable
// thumbnail/full URLs). EXIF capture-time is resolved with a three-tier fallback
// ladder using `exifr`. Every plugin call lives here so swapping the backend
// (the spike's fallback ladder) is a one-file change.

import { PhotoLibrary, type PhotoLibraryAsset, type PhotoLibraryAuthorizationState } from '@capgo/capacitor-photo-library';
import exifr from 'exifr';
import { v4 as uuidv4 } from 'uuid';
import { isNative } from '@l8r/shared/platform';
import type { Photo } from '../types';

const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 320;

// Default enumeration page size. The plugin documents no hard cap; the spike
// recommends 100–200 and looping on offset until a short/empty page.
export const DEFAULT_PAGE_SIZE = 150;

// Normalized, UI-facing permission state. The plugin reports `authorized`;
// Android maps full grants to it. `limited` is the iOS 14+ partial-library tier.
export type PermissionState = 'granted' | 'limited' | 'denied';

export interface PermissionResult {
  state: PermissionState;
  // True on the iOS 14+ limited tier — the UI should surface a re-grant banner
  // because `enumerateAll` will only see the user-selected subset.
  limited: boolean;
}

const normalizeAuthState = (state: PhotoLibraryAuthorizationState): PermissionState => {
  switch (state) {
    case 'authorized':
      return 'granted';
    case 'limited':
      return 'limited';
    default:
      // 'denied' | 'notDetermined' (after a request, notDetermined ≈ denied)
      return 'denied';
  }
};

/**
 * Check current authorization and request it if not yet decided. Returns a
 * normalized state plus a `limited` flag for the limited-access shim.
 */
export const ensurePermission = async (): Promise<PermissionResult> => {
  // Web has no native photo library / permission model — the file picker path
  // (pickFromFileInput) governs access there.
  if (!isNative()) {
    return { state: 'granted', limited: false };
  }

  let { state } = await PhotoLibrary.checkAuthorization();
  if (state === 'notDetermined') {
    ({ state } = await PhotoLibrary.requestAuthorization());
  }
  const normalized = normalizeAuthState(state);
  return { state: normalized, limited: normalized === 'limited' };
};

// ─── Capture-time resolution (spec §4 / spike ladder) ───────────────────────

// EXIF DateTimeOriginal carries no timezone (wall-clock local time). We treat it
// as the device's current timezone and normalize to epoch ms — the same
// convention the M3 calendar windows use, so matching stays internally
// consistent. `exifr` already returns a Date built in local time.
const toEpochMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

// Fast, byte-free capture time used during enumeration (no full-res fetch).
const captureTimeFromAsset = (asset: Pick<PhotoLibraryAsset, 'creationDate' | 'modificationDate'>): number => {
  return toEpochMs(asset.creationDate) ?? toEpochMs(asset.modificationDate) ?? Date.now();
};

/**
 * The three-tier capture-time fallback ladder (spike "EXIF and capture-time
 * strategy"). When raw bytes/`File` are available, the EXIF `DateTimeOriginal`
 * (the true capture time) is preferred over the plugin's library `creationDate`,
 * which can be an import artifact. Always returns epoch ms.
 *
 * 1. EXIF `DateTimeOriginal` (when bytes/File provided)
 * 2. Native asset `creationDate`
 * 3. Web `File.lastModified`
 * 4. Native `modificationDate` (last resort before "now")
 */
export const resolveCaptureTime = async (
  asset: Pick<PhotoLibraryAsset, 'creationDate' | 'modificationDate'> | null,
  source?: File | Blob | ArrayBuffer | Uint8Array,
): Promise<number> => {
  // 1. EXIF — most accurate true capture time.
  if (source !== undefined) {
    try {
      const tags = await exifr.parse(source, { pick: ['DateTimeOriginal'] });
      const exifMs = toEpochMs(tags?.DateTimeOriginal);
      if (exifMs != null) return exifMs;
    } catch {
      // Unreadable / no EXIF — fall through to the next tier.
    }
  }

  // 2. Native asset creation date.
  const creationMs = toEpochMs(asset?.creationDate);
  if (creationMs != null) return creationMs;

  // 3. Web File.lastModified.
  if (typeof File !== 'undefined' && source instanceof File) {
    return source.lastModified;
  }

  // 4. Native modification date, then current time as the final fallback.
  return toEpochMs(asset?.modificationDate) ?? Date.now();
};

// ─── Asset → Photo mapping ──────────────────────────────────────────────────

const assetToPhoto = (asset: PhotoLibraryAsset): Photo => {
  const hasLocation = typeof asset.latitude === 'number' && typeof asset.longitude === 'number';
  return {
    id: uuidv4(),
    assetId: asset.id,
    // Full-res URI is fetched lazily on demand (getFullImage); the inline
    // `file` is only present when includeFullResolutionData is set (we keep it off).
    uri: asset.file?.webPath ?? '',
    thumbnailUri: asset.thumbnail?.webPath,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    capturedAt: captureTimeFromAsset(asset),
    location: hasLocation ? { lat: asset.latitude as number, lng: asset.longitude as number } : undefined,
    tags: [],
    albumIds: [],
    enrichmentStatus: 'pending',
  };
};

// ─── Enumeration ────────────────────────────────────────────────────────────

/**
 * Enumerate a single page of the library starting at `offset`. Returns mapped
 * `Photo`s plus the raw result's `hasMore` flag so callers can drive paging.
 */
export const enumeratePage = async (
  offset: number,
  limit: number = DEFAULT_PAGE_SIZE,
): Promise<{ photos: Photo[]; hasMore: boolean }> => {
  const result = await PhotoLibrary.getLibrary({
    offset,
    limit,
    includeImages: true,
    includeVideos: false, // photos only in v1
    includeCloudData: true,
    thumbnailWidth: THUMB_WIDTH,
    thumbnailHeight: THUMB_HEIGHT,
    includeFullResolutionData: false, // lazy — fetch full bytes only on demand
  });
  const photos = result.assets.map(assetToPhoto);
  // Trust the plugin's `hasMore` when present; otherwise derive from page size.
  const hasMore = typeof result.hasMore === 'boolean' ? result.hasMore : result.assets.length >= limit;
  return { photos, hasMore };
};

/**
 * Async generator that yields successive pages of mapped `Photo`s, looping on
 * the offset cursor until the library is exhausted. The caller streams each page
 * into the encrypted store and updates progress.
 */
export async function* enumerateAll(
  startOffset = 0,
  limit: number = DEFAULT_PAGE_SIZE,
): AsyncGenerator<{ photos: Photo[]; offset: number }> {
  let offset = startOffset;
  // Guard against a misbehaving plugin that never reports hasMore=false: stop on
  // an empty page regardless.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { photos, hasMore } = await enumeratePage(offset, limit);
    if (photos.length === 0) return;
    offset += photos.length;
    yield { photos, offset };
    if (!hasMore) return;
  }
}

// ─── Lazy thumbnail / full-resolution URLs ──────────────────────────────────

export const getThumbnail = async (
  assetId: string,
  width: number = THUMB_WIDTH,
  height: number = THUMB_HEIGHT,
): Promise<string> => {
  const file = await PhotoLibrary.getThumbnailUrl({ id: assetId, width, height });
  return file.webPath;
};

/**
 * Full-resolution displayable URL, fetched lazily (viewer + future Gemini
 * enrichment). For iCloud / Google Photos cloud-only assets this can trigger an
 * on-demand download that may stall or fail offline — callers handle that.
 */
export const getFullImage = async (assetId: string): Promise<string> => {
  const file = await PhotoLibrary.getPhotoUrl({ id: assetId });
  return file.webPath;
};

// ─── Web fallback: multi-select file input ──────────────────────────────────

/**
 * Web path (spec §4): there is no native library to enumerate, so the user picks
 * files via `<input type="file" multiple>`. Capture time uses the EXIF ladder
 * (`exifr` → `file.lastModified`). Object URLs back both the thumbnail and full
 * image; the caller is responsible for revoking them when done.
 */
export const pickFromFileInput = async (files: FileList | File[]): Promise<Photo[]> => {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
  return Promise.all(
    list.map(async (file) => {
      const capturedAt = await resolveCaptureTime(null, file);
      const objectUrl = URL.createObjectURL(file);
      return {
        id: uuidv4(),
        // No stable native asset id on web — derive a dedupe key from intrinsic
        // file properties so re-picking the same file is idempotent.
        assetId: `web:${file.name}:${file.size}:${file.lastModified}`,
        uri: objectUrl,
        thumbnailUri: objectUrl,
        mimeType: file.type,
        width: 0, // intrinsic dimensions resolved lazily by the viewer
        height: 0,
        capturedAt,
        tags: [],
        albumIds: [],
        enrichmentStatus: 'pending',
      } satisfies Photo;
    }),
  );
};
