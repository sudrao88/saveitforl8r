# M2a — Photo-library plugin spike

## Goal
Research candidate Capacitor plugins for full photo-library enumeration and write a recommendation to `docs/l8rgram-m2-spike.md`. **No app code is written in this phase.** M2b reads this report to decide.

## In scope
1. Inspect `@capacitor-community/media` source (npm + GitHub) — API surface, iOS/Android backends, EXIF/GPS fields exposed, paging support, known issues (scan the GitHub issues tab for recent breakages).
2. Inspect at least one alternative (e.g., `@capgo/capacitor-photo-album`, `capacitor-plugin-photo-library`).
3. Note fallback: writing a small custom plugin wrapping iOS `PHAsset` + Android `MediaStore.Images`.
4. Write findings to `docs/l8rgram-m2-spike.md` with the required headings (below).

## Out of scope
- Installing any plugin.
- Creating `apps/l8rgram` or any code files.
- Running anything on a device/simulator (that's a manual step recorded in `docs/l8rgram-setup-checklist.md`).

## Required headings in `docs/l8rgram-m2-spike.md`
The orchestrator's verification greps for these exact lines:
- `## Chosen plugin`
- `## API surface`
- `## Known gaps`
- `## EXIF and capture-time strategy`
- `## Recommendation`

## Required content per heading

### `## Chosen plugin`
Plugin name + version, one-paragraph justification vs alternatives.

### `## API surface`
Exact methods M2b will call, parameter shapes, return shapes. At minimum:
- Photo-library permission request (iOS + Android).
- Paginated enumeration (cursor / offset / limit, expected page size cap).
- Thumbnail vs full-resolution URI per asset.
- Per-asset metadata fields: id, uri, mimeType, width/height, **creation date**, **GPS lat/lng**, file size.

### `## Known gaps`
Honest list — anything the plugin does NOT provide that the spec needs:
- Missing EXIF for live photos, screenshots, HEIC.
- iOS-only or Android-only fields.
- iOS 14+ limited library access tier handling.
- iCloud cloud-only assets requiring download.
- Known crash/perf issues at large library sizes (10k+).

### `## EXIF and capture-time strategy`
Per spec section 4:
- Primary: native asset creation date returned by the plugin.
- Fallback: `exifr.parse` on the raw bytes (works web + native).
- Final fallback: `file.lastModified` (web only).
Document the missing-timezone assumption: "treat as device tz, normalize to epoch ms".

### `## Recommendation`
Decision: which plugin M2b installs, what shims/fallbacks layer on top, numbered list of API calls M2b will wrap in `apps/l8rgram/services/photoLibrary.ts`.

## Verification (orchestrator runs)
- File exists at `docs/l8rgram-m2-spike.md`.
- All five required headings present.

## Commit
One commit:
`feat(l8rgram): m2a-photo-library-spike — research and recommend native photo-library plugin`
