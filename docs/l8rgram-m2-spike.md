# l8rgram M2 — Photo-library plugin spike

> **Phase:** m2a-photo-library-spike (research only — no app code written).
> **Consumed by:** m2b-l8rgram-skeleton, which uses this report to pick the plugin
> and wrap it in `apps/l8rgram/services/photoLibrary.ts`.
> **Date:** 2026-05-31. All version/issue facts below were checked against npm + GitHub
> on that date; re-confirm on a real device per `docs/l8rgram-setup-checklist.md`.

This spike evaluated three candidates for **full, paginated photo-library enumeration with
per-asset capture date + GPS on both iOS and Android**, the biggest risk called out in
`docs/l8rgram-spec.md` §4 / "Biggest risks" #1–2.

| Candidate | iOS enum | Android enum | Pagination | Capture date | GPS | Thumbnail vs full | Verdict |
|---|---|---|---|---|---|---|---|
| `@capacitor-community/media` | ✅ `getMedias` | ⚠️ `UNIMPLEMENTED` (see gaps) | weak (`quantity` only) | ✅ `creationDate` | ✅ `location{lat,lng,…}` | base64 `data` inline (iOS only) | **rejected as primary** |
| `@capgo/capacitor-photo-library` | ✅ `getLibrary` | ✅ `getLibrary` | ✅ `offset`/`limit` | ✅ `creationDate` | ✅ `latitude`/`longitude` | `getThumbnailUrl` / `getPhotoUrl` (webview URLs, not base64) | **chosen** |
| `capacitor-plugin-photo-library` (diiiary) | ✅ `getPhotos` | ⚠️ "incomplete, need help" | ✅ `offset`/`limit` | ✅ `createTime` | ✅ `location` | base64 `dataUrl` | rejected (Android incomplete, ~4★, unmaintained) |

---

## Chosen plugin

**`@capgo/capacitor-photo-library`** (Cap-go/capacitor-photo-library, MPL-2.0).

It is the only candidate with a **symmetric iOS + Android full-enumeration API** that also gives us
everything the spec's matching algorithm needs: `offset`/`limit` pagination (essential for 10k+
libraries), per-asset `creationDate` + `latitude`/`longitude`, and — critically — **displayable
webview URLs** via `getThumbnailUrl`/`getPhotoUrl` instead of inline base64. URL-based assets keep
memory flat across a large grid, which matters for the virtualized `GalleryScreen`.

It wins over **`@capacitor-community/media`** (the candidate named in the spec) because that plugin's
`getMedias`/`getMediaByIdentifier` are documented **iOS-only** in `src/definitions.ts`, and Android
callers still report `{"code":"UNIMPLEMENTED"}` as recently as issues #112 (Jun 2025) and #97
(Aug 2024) — despite v7.0.0 release notes mentioning an Android "gallery mode". For a cross-platform
gallery whose whole premise is enumerating the *entire* library, an iOS-only enumerator is a
non-starter. `@capacitor-community/media` also returns each iOS asset's pixels as a base64 `data`
string, which balloons memory at scale and has no real cursor (you "paginate" by asking for a larger
`quantity`).

It wins over **`capacitor-plugin-photo-library`** (diiiary) on maturity alone: that repo's README
flags Android as incomplete ("need your help"), has ~4 stars / 9 commits, no releases, and returns
base64 `dataUrl`s.

**Caveats to carry into M2b** (see Known gaps): Capgo plugins are MPL-2.0 (fine to vendor; the
*plugin source* is open — only Capgo's separate OTA/CI cloud service is paid), but this specific
plugin is newer and less battle-tested than `@capacitor-community/media`. We mitigate with a
documented fallback ladder (custom PHAsset/MediaStore plugin) and by isolating all plugin calls
behind `services/photoLibrary.ts` so swapping implementations is a one-file change.

---

## API surface

Exact methods M2b will call, with parameter and return shapes synced from the plugin's
`src/definitions.ts`. Names below are the plugin's; M2b maps them to the l8rgram `Photo` type in
`apps/l8rgram/types.ts`.

### Permissions (iOS + Android)

```ts
// No prompt — read current state.
checkAuthorization(): Promise<{ state: PhotoLibraryAuthorizationState }>;
// Prompt if needed.
requestAuthorization(): Promise<{ state: PhotoLibraryAuthorizationState }>;

// state ∈ 'granted' | 'limited' | 'denied' | 'notDetermined' | 'restricted'
// 'limited' == iOS 14+ partial-library tier (Android maps full grants to 'granted').
```

iOS additionally needs `NSPhotoLibraryUsageDescription` in `Info.plist`; Android needs
`READ_MEDIA_IMAGES` (API 33+) / `READ_EXTERNAL_STORAGE` (legacy) in the manifest. These are native
config steps for M2b/M6, not runtime API.

### Paginated enumeration

```ts
getLibrary(options?: GetLibraryOptions): Promise<GetLibraryResult>;

interface GetLibraryOptions {
  offset?: number;             // start index — our pagination cursor
  limit?: number;              // page size; use ~100–200 per page
  includeImages?: boolean;     // true for l8rgram
  includeVideos?: boolean;     // false in v1 (photos only)
  includeAlbumData?: boolean;  // populate asset.albumIds
  includeCloudData?: boolean;  // include iCloud / Google Photos cloud-only assets; defaults true
  useOriginalFileNames?: boolean;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  thumbnailQuality?: number;   // 0–100
  includeFullResolutionData?: boolean; // keep false — fetch full bytes lazily on demand
}

interface GetLibraryResult {
  assets: PhotoLibraryAsset[];
  // total/has-more is derived: keep calling with offset += assets.length until a short/empty page.
}
```

**Page size cap:** the plugin does not document a hard cap; treat `limit ≈ 100–200` as the working
page and loop on `offset` until a page returns fewer than `limit` items. Persist the running offset
as the `lastImportedAt`/cursor in the encrypted store (spec §4) so re-import is incremental.

### Thumbnail vs full-resolution URI

```ts
// Resized thumbnail URL for the grid (cheap, webview-displayable).
getThumbnailUrl(options: { id: string; width?: number; height?: number; quality?: number })
  : Promise<PhotoLibraryFile>;   // { url, ... }

// Full-resolution URL, fetched lazily only when a photo is opened or enriched.
getPhotoUrl(options: { id: string }): Promise<PhotoLibraryFile>;
```

`getLibrary` can also return a `thumbnail` (and optional `file`) on each asset directly when the
thumbnail* options are passed; M2b can use either the inline `thumbnail` or call `getThumbnailUrl`
per id. Prefer URLs over inline base64 to keep the virtualized grid memory-flat.

### Per-asset metadata fields

```ts
interface PhotoLibraryAsset {
  id: string;                  // -> Photo.assetId (stable handle for getPhotoUrl/getThumbnailUrl)
  fileName: string;
  type: 'image' | 'video';
  mimeType: string;            // -> Photo.mimeType
  width: number;               // -> Photo.w
  height: number;              // -> Photo.h
  duration?: number;           // videos only
  creationDate: string;        // ISO 8601 -> normalize to epoch ms -> Photo.capturedAt (MATCH KEY)
  modificationDate: string;
  latitude?: number;           // -> Photo.location.lat (may be absent)
  longitude?: number;          // -> Photo.location.lng (may be absent)
  size: number;                // file size in bytes
  albumIds?: string[];         // present when includeAlbumData=true
  thumbnail?: string;          // optional inline thumbnail when thumbnail* opts passed
  file?: string;               // optional full-res handle when includeFullResolutionData=true
}
```

### Other available methods (not required by M2b's core loop)

```ts
getAlbums(): Promise<{ albums: PhotoLibraryAlbum[] }>;   // native albums (not our event-albums)
pickMedia(options?: PickMediaOptions): Promise<PickMediaResult>; // system picker — see Known gaps (limited tier)
getPluginVersion(): Promise<{ version: string }>;
```

---

## Known gaps

Honest list of what the chosen plugin (and the photo-library problem generally) does **not** give us
for free. M2b must handle these.

1. **EXIF beyond capture date + GPS is not exposed.** `PhotoLibraryAsset` surfaces `creationDate`,
   `latitude`/`longitude`, dimensions, size — but **not** camera make/model, orientation, or the
   full EXIF block. For anything richer (and as a *fallback source for capture time itself*), M2b
   must parse raw bytes with `exifr` (see next section).
2. **GPS is frequently missing.** `latitude`/`longitude` are optional and absent for screenshots,
   downloaded/shared images, edited copies that stripped EXIF, and many HEIC/live-photo stills where
   the location lives only in a sidecar. Album matching is **time-based** (spec §4) so this only
   degrades the optional location tag, not core matching — but the UI must tolerate `location ===
   undefined`.
3. **Capture-time can be wrong/missing.** `creationDate` reflects the asset's library creation date,
   which for imported/AirDropped/screenshotted images is the *import* time, not the *capture* time.
   This directly threatens calendar matching → mitigated by the exifr fallback ladder below.
4. **iOS 14+ limited-library tier.** `requestAuthorization` can return `'limited'`. In that state
   `getLibrary` only sees the user-selected subset, so "full library" enumeration is impossible
   until the user re-grants full access (or re-runs the system selection via `pickMedia`). M2b must
   detect `state === 'limited'`, surface a "you've granted limited access" banner, and offer a
   re-prompt / settings deep-link. (`@capacitor-community/media` shares this limitation.)
5. **iCloud / Google Photos cloud-only assets.** `includeCloudData` (default `true`) lists cloud-only
   originals, but fetching their **full-resolution bytes** triggers an on-demand iCloud download that
   can be slow or fail offline. Thumbnails are usually available; full-res via `getPhotoUrl` may
   stall. M2b should fetch full bytes lazily and handle download latency/failure gracefully.
6. **Large-library performance is unproven for this plugin.** No published benchmark or open issue
   set at 10k+ for `@capgo/capacitor-photo-library` (it is newer/less-exercised than
   `@capacitor-community/media`). Mandatory device test at 10k+ before trusting it (checklist item).
   Mitigation: strict `offset`/`limit` paging, metadata + thumbnail only on first pass, lazy
   full-res.
7. **Plugin maturity / bus factor.** Newer plugin, smaller user base than `@capacitor-community/media`.
   Risk mitigated by (a) the `services/photoLibrary.ts` isolation layer and (b) the custom-plugin
   fallback documented in Recommendation step 5.
8. **No live-photo / motion handling.** Live photos surface only their still frame; the paired video
   and its metadata are not exposed. Acceptable for v1 (photos-only).
9. **Web has no photo library at all.** On the PWA/web target there is no native library to
   enumerate; the web path is a multi-select `<input type="file">` (spec §4), with capture time from
   `exifr` then `file.lastModified`. M2b's `photoLibrary.ts` must branch on `platform` (the shared
   `@l8r/shared/platform` helper) — native → plugin, web → file picker.

---

## EXIF and capture-time strategy

Capture time (`Photo.capturedAt`, epoch ms) is the album-matching key, so it must be resolved
robustly. Per spec §4, M2b resolves it with a **three-tier fallback ladder**, taking the first that
yields a usable value:

1. **Primary — native asset creation date.** Use `PhotoLibraryAsset.creationDate` (ISO 8601) from
   `getLibrary`. Fast, no byte read. Trust it unless it looks like an import artifact (see below).
2. **Fallback — `exifr.parse` on the raw bytes (web *and* native).** When `creationDate` is missing,
   or to override a suspicious import-time value, fetch the bytes (native: `getPhotoUrl` → fetch;
   web: the `File`/`Blob`) and call:

   ```ts
   import exifr from 'exifr';
   const tags = await exifr.parse(input, { pick: ['DateTimeOriginal', 'GPSLatitude', 'GPSLongitude'] });
   // input: File | Blob | ArrayBuffer | Uint8Array | <img> | url — all accepted by exifr.
   // tags.DateTimeOriginal -> Date; exifr also returns latitude/longitude (DMS auto-converted to decimal).
   ```

   `exifr` works in the browser and on native (it operates on bytes, not DOM), and can read only the
   needed segments for speed. Use `DateTimeOriginal` (true capture time) in preference to the
   plugin's `creationDate` when both exist and disagree.
3. **Final fallback — `file.lastModified` (web only).** When neither `creationDate` nor EXIF
   `DateTimeOriginal` is available on the web path, use the `File.lastModified` timestamp. On native
   there is no equivalent final fallback beyond the plugin's `creationDate`/`modificationDate`.

**Missing-timezone assumption (document explicitly).** EXIF `DateTimeOriginal` carries **no timezone**
(it is wall-clock local time). We **treat such timestamps as the device's current timezone and
normalize to epoch ms** for storage and matching. This is the same convention applied to the live
calendar event windows, so matching stays internally consistent even though absolute UTC may be off
for photos taken in a different timezone than the device is currently in. Plugin `creationDate` ISO
strings that *do* carry an offset are honored as-is. All `capturedAt` values are stored as **epoch
ms** regardless of source.

---

## Recommendation

**Decision:** M2b installs **`@capgo/capacitor-photo-library`** as the photo-library backend
(`apps/l8rgram` deps only, not the root) and **`exifr`** for byte-level EXIF fallback. Keep
`@capacitor-community/media` as the documented secondary, and a custom PHAsset/MediaStore plugin as
the last-resort fallback.

**Shims / fallbacks layered on top:**
- **Platform branch:** native → plugin `getLibrary`; web → `<input type="file" multiple>`. Decided
  via the shared `@l8r/shared/platform` helper.
- **Capture-time ladder:** plugin `creationDate` → `exifr` `DateTimeOriginal` → `file.lastModified`
  (web), normalized to epoch ms under the device-timezone assumption above.
- **Limited-access shim:** detect `state === 'limited'`, show a re-grant banner, offer `pickMedia` /
  settings deep-link.
- **Lazy full-res:** first pass stores metadata + thumbnail URL only; full bytes fetched on demand
  (`getPhotoUrl`) for viewer + Gemini enrichment, with iCloud-download error handling.
- **Incremental cursor:** persist the running `offset` (and max seen `creationDate`) as
  `lastImportedAt` so re-import is incremental and album matching stays idempotent.

**API calls M2b will wrap in `apps/l8rgram/services/photoLibrary.ts`:**
1. `ensurePermission()` → `checkAuthorization()`, and `requestAuthorization()` if not yet granted;
   returns a normalized `'granted' | 'limited' | 'denied'` plus a `limited` flag for the UI.
2. `enumeratePage(offset, limit)` → `getLibrary({ offset, limit, includeImages: true,
   includeVideos: false, includeCloudData: true, thumbnailWidth, thumbnailHeight })`; maps each
   `PhotoLibraryAsset` → l8rgram `Photo` (`assetId=id`, `w/h`, `mimeType`, `capturedAt` via the
   ladder, `location` from `latitude`/`longitude` when present, `size`).
3. `enumerateAll()` → loop `enumeratePage` with `offset += page.length` until a short/empty page;
   yields pages so the caller can stream into the encrypted store and update progress.
4. `getThumbnail(assetId, w, h)` → `getThumbnailUrl({ id, width, height, quality })` for the grid.
5. `getFullImage(assetId)` → `getPhotoUrl({ id })` (lazy) for the viewer and for Gemini enrichment
   bytes; handles iCloud-download latency/failure.
6. `resolveCaptureTime(asset, bytesOrFile?)` → the three-tier ladder using `exifr.parse(...)`.
7. *(web only)* `pickFromFileInput(files)` → maps selected `File`s, capture time via `exifr` then
   `file.lastModified`.

**Fallback ladder if the chosen plugin proves unworkable on a real 10k+ library (checklist
validation):**
- **Tier 1:** stay on `@capgo/capacitor-photo-library` (default).
- **Tier 2:** if Android enumeration or large-library perf fails, evaluate
  `@capacitor-community/media` for the iOS path only (its `getMedias` is solid on iOS) paired with a
  thin Android `MediaStore.Images` shim.
- **Tier 3:** write the small **custom Capacitor plugin** wrapping iOS `PHAsset` (PhotoKit, with
  `PHFetchOptions` paging + `PHAsset.creationDate`/`location`) and Android
  `MediaStore.Images` (`ContentResolver` cursor over
  `DATE_TAKEN`/`LATITUDE`/`LONGITUDE`/`WIDTH`/`HEIGHT`). This gives us full control over paging,
  capture date, and GPS, at the cost of native maintenance. Budgeted in spec "Biggest risks" #1.
  Because all calls live behind `services/photoLibrary.ts`, swapping tiers is a single-file change.
