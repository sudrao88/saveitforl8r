# l8rgram — Technical Specification

> Splitting this codebase into two apps that share plumbing: **saveitforl8r** (existing) and
> **l8rgram** (new native gallery app).

## Overview

Today the repo is a single React 19 + Vite 6 + TypeScript PWA (with a Capacitor native shell)
plus an Express server proxy under `server/`, deployed as two separate Cloud Run services
(client + server). The goal is to host **two apps** from one monorepo that share the expensive,
already-decoupled plumbing:

- **saveitforl8r** — the existing "second brain" app (unchanged behavior).
- **l8rgram** — a NEW native gallery app that:
  1. reads the device's full photo library,
  2. syncs the user's **live Google Calendar** (`calendar.readonly`),
  3. auto-builds **albums by matching photo EXIF capture-time to calendar event windows**
     (± buffer), tagging each album with the event's title/time/location/description for recall,
  4. uses **Gemini** for per-photo auto-caption/tag and natural-language gallery search.

**Feasibility verdict: yes, very feasible.** Auth (OAuth+PKCE), the Gemini *client*, and the
server proxy are already provider-/app-agnostic and reusable; only `SyncContext` + the `Memory`
data model are saveitforl8r-specific and stay put. l8rgram gets its own simple data layer.

### Assumptions / decisions
- **Two OAuth client IDs** (one per app) so each has its own consent screen; the server accepts
  both audiences. Each app requests only the scopes it needs (saveitforl8r = `drive.appdata`;
  l8rgram = `calendar.readonly`).
- **l8rgram is local-only in v1** — photos stay on device; only metadata (caption/tags/location/
  album links) + thumbnails in local DB. No Drive sync (avoids the heavy SyncContext work).
- **Metadata is encrypted at rest** reusing the existing AES-GCM crypto.

## Grounding facts (verified against the codebase)
- Single root `package.json`, **no workspaces**. `server/` has its own `package.json`; both deploy
  as separate Cloud Run services in `cloudbuild.yaml`.
- The `@/* -> ./*` alias exists but has **0 usages**; all imports are shallow relative
  (`../services/x`), often with explicit `.ts` extensions (works via `moduleResolution: bundler` +
  `allowImportingTsExtensions`).
- OAuth scopes are **hardcoded** in `services/googleAuth.ts` (`drive.appdata` only). No live Google
  Calendar integration today — events are merely extracted from enriched notes.
- Server auth (`server/middleware/auth.js`) validates via Google tokeninfo, checks a **single**
  `aud === GOOGLE_CLIENT_ID`, does **not** check scopes. User id = `tokenInfo.sub`.
- No native photo-library plugin installed (only `@capacitor/filesystem`, `@capacitor/share`).
- Crypto uses a Vite worker (`./encryption.worker?worker`, `worker: { format: 'es' }`).
- Tailwind 4 tokens live in `index.css` `@theme`; class strings in `styles/design-system.ts`;
  custom ESLint rule `eslint-rules/no-raw-tailwind-colors.js`.

## 1. Monorepo layout (npm workspaces)

Move the **entire** saveitforl8r tree into `apps/saveitforl8r/` as a unit (so internal `../`
imports keep resolving), and extract only genuinely-shared files into `packages/shared/`.

```
/ (root)
  package.json            # "workspaces": ["packages/*", "apps/*", "server"]
  tsconfig.base.json      # shared compilerOptions
  eslint.config.js        # root flat config (globs -> apps/*/components, apps/*/App.tsx)
  eslint-rules/no-raw-tailwind-colors.js   # STAYS at root (dev-only shared lint rule)
  cloudbuild.yaml
  packages/shared/        # "@l8r/shared", consumed as TS source via exports map
    src/auth/   (pkce, tokenService, googleAuth)
    src/platform/ (platform.ts)
    src/ai/     (proxyService, chunkUploadService)
    src/crypto/ (encryptionService.ts + encryption.worker.ts)
    src/design-system/ (design-system.ts + tokens.css)
  apps/saveitforl8r/      # everything that exists today, moved here (incl. android/ ios/ scripts/ public/)
  apps/l8rgram/           # new app (own index.html/tsx, App.tsx, vite/capacitor config, public/)
  server/                 # joins workspace for hoisting; keeps own package.json + isolated Dockerfile
```

### Handling the alias / relative-import hazard
1. **Drop the unused `@/*` alias** (0 hits).
2. `git mv` the saveitforl8r tree as a unit — directory structure preserved, so `../` imports still
   resolve; **no edits inside the moved tree** except files that become shared.
3. For shared-extracted files only, rewrite their importers to `@l8r/shared/...` (bounded set, e.g.
   `geminiService.ts` -> `./proxyService` becomes `@l8r/shared/ai`; `googleDriveService.ts` ->
   `./googleAuth`, `./tokenService`).
4. Add `@l8r/shared` to each app's tsconfig `paths` + vite `resolve.alias`. Set each app's Tailwind
   content globs to include `packages/shared/src/**` (avoid purge), and keep `worker:{format:'es'}`.

## 2. Shared package (`packages/shared`)

| Source today | Shared location | Notes |
|---|---|---|
| `services/pkce.ts` | `src/auth/pkce.ts` | pure |
| `services/tokenService.ts` | `src/auth/tokenService.ts` | **namespace storage keys per app** |
| `services/googleAuth.ts` | `src/auth/googleAuth.ts` | **parametrize config + scopes** |
| `services/platform.ts` | `src/platform/platform.ts` | Capacitor abstraction |
| `services/proxyService.ts` | `src/ai/proxyService.ts` | proxy HTTP client |
| `services/chunkUploadService.ts` | `src/ai/chunkUploadService.ts` | chunked upload to `/api/upload` |
| `services/encryptionService.ts` + `encryption.worker.ts` | `src/crypto/` | keep `?worker` import |
| `styles/design-system.ts` | `src/design-system/design-system.ts` | class strings |
| `index.css` `@theme` blocks | `src/design-system/tokens.css` | both apps `@import` it |

**Stays in saveitforl8r:** `geminiService.ts`, `storageService.ts`, `googleDriveService.ts`,
`context/`, `components/`, `App.tsx`, feature `hooks/use*`, `types.ts` (Memory model).

**Generalize OAuth config** (the key refactor) — `googleAuth.ts` gets a startup config:

```ts
export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];          // saveitforl8r: ['.../drive.appdata']; l8rgram: ['.../calendar.readonly']
  hostedUrl: string;         // per-app bouncer redirect target
  deepLinkScheme: string;    // com.saveitforl8r.app | com.l8rgram.app
  storageNamespace?: string; // prefixes token keys + IDB names to isolate apps
  proxyUrl: string;
}
export function configureGoogleAuth(cfg: GoogleAuthConfig): void;
```

- saveitforl8r keeps today's values exactly. l8rgram passes `calendar.readonly`, its own client id,
  domain, and scheme.
- **Namespace token/IDB storage** (`access_token`, `refresh_token`, `gdrive_linked`, `auth_db`) so
  two PWAs don't collide; add a one-time read-migration of saveitforl8r's old unprefixed keys.
- Consume shared as **TS source** via an `exports` map (`.`, `./auth`, `./ai`, `./crypto`,
  `./platform`, `./design-system`, `./tokens.css`) — no build step, fast dev loop.
- **tokens.css**: extract `@theme` (default + `[data-theme=light]`) into shared; each app does
  `@import "tailwindcss"; @import "@l8r/shared/tokens.css";` then app overrides (l8rgram can rebrand
  `--color-accent`).

## 3. Server changes (keep ONE server)

- **Calendar route** — new `server/routes/calendar.js`: `GET /api/calendar/events?timeMin&timeMax`
  -> `authenticateRequest` then forward to Google Calendar API using the **user's own**
  `req.accessToken` (no Gemini key). Use `singleEvents=true&orderBy=startTime`, page via
  `nextPageToken`. Add a per-user limiter (~30/min) + `validateCalendarQuery`. Mount in
  `server/index.js`.
- **Multi-audience** — replace the single `aud === GOOGLE_CLIENT_ID` check in `auth.js` with a
  comma-separated `GOOGLE_ALLOWED_AUDIENCES` allowlist (back-compatible).
- **Scope check** — add a `requireScope('.../calendar.readonly')` middleware applied **only** to
  `/api/calendar/*` (tokeninfo returns `scope`; cache it). Leave `/api/enrich` & `/api/query`
  scope-agnostic so both apps reuse them unchanged.
- **l8rgram-specific Gemini endpoints** — `/api/enrich-photo` (caption+tags schema) and
  `/api/query-gallery` (NL search schema), reusing the auth/limiter/concurrency/Firestore-polling
  scaffolding from `routes/enrich.js` & `routes/query.js`, with photo/album-shaped validators +
  schemas (new Firestore collections, e.g. `photo-enrichment-results`, keyed by `userId`).
- Shared & unchanged for both apps: `/api/enrich`, `/api/query`, `/api/upload`.

## 4. l8rgram app architecture (`apps/l8rgram`)

- **Types** (`types.ts`): `Photo { id, assetId, uri, mimeType, w/h, capturedAt (EXIF, the match
  key), location?, caption?, tags[], albumIds[], enrichmentStatus }`; `Album { id, title, source,
  eventId, start/end, location?, description?, coverPhotoId, photoIds[] }`; `LiveCalendarEvent`.
- **Photo-library ingestion (SPIKE — biggest risk)**: candidate plugin `@capacitor-community/media`
  (`getMedias()` — verify it returns asset path + creation date + GPS on iOS PHPhotoLibrary &
  Android MediaStore). `@capacitor/camera` is single-pick only (insufficient). Fallback: small
  custom plugin wrapping PHAsset/MediaStore. Enumerate **paginated** (libraries can be 10k+),
  metadata + thumbnail only, lazy-load full bytes on demand; keep a `lastImportedAt` cursor.
- **EXIF timestamp (RISK)**: prefer native asset creation date; fall back to `exifr.parse` of bytes;
  web uses `exifr` then `file.lastModified`. Normalize to epoch ms; document the missing-timezone
  ("treat as device tz") assumption.
- **Calendar fetch** (`hooks/useLiveCalendar.ts`): after calendar-scope login, GET
  `/api/calendar/events` spanning imported photos' `capturedAt` range; cache events in encrypted
  local store for offline album rebuild.
- **Album matching (deterministic, not Gemini)**: sort events by start; for each photo, find events
  whose `[start-BUFFER, end+BUFFER]` (BUFFER ~90 min) contains `capturedAt` (sweep/binary search);
  multi-membership allowed; albums keyed by `eventId` -> **idempotent on re-import**. Unmatched
  photos left unalbumed or bucketed "Untitled <date>".
- **Gemini**: per-photo caption+tags via `/api/enrich-photo` (inline if small, else shared
  `chunkUploadService` -> `fileUri`), poll Firestore like `fetchPendingEnrichments`. NL search
  builds a light per-photo context block and POSTs `/api/query-gallery`.
- **Local storage**: new `storageService.ts` modeled on saveitforl8r's (DB `L8rgramDB`: `photos`,
  `albums`, `calendarCache`), reusing shared crypto; auth storage namespaced `l8rgram`.
- **Screens**: `LoginScreen`, `GalleryScreen` (virtualized grid), `AlbumsScreen`,
  `AlbumDetailScreen` (event-context header), `PhotoViewer`, `SearchScreen`. Hooks:
  `usePhotoLibrary`, `useLiveCalendar`, `useAlbumMatching`, `usePhotoEnrichment`, `useGallerySearch`.

## 5. Build & deploy

- Per-app `vite.config.ts` + `index.html` + `index.tsx`; both keep `worker:{format:'es'}`, add
  `@l8r/shared` alias, extend Tailwind globs to `packages/shared/src`; per-app `VITE_*` defines.
- **Docker**: workspace-aware client Dockerfiles (copy root lockfile + needed workspace
  `package.json`s + `packages/shared` + the app, `npm ci` at root, `npm run build -w <app>`, serve
  `apps/<app>/dist` via nginx). Server keeps its isolated Dockerfile.
- **cloudbuild.yaml**: add build/push/deploy for `l8rgram-client` service (mirroring saveitforl8r,
  l8rgram secrets/build-args). Server stays single; set `GOOGLE_ALLOWED_AUDIENCES` (both client ids)
  and append l8rgram's origin to `ALLOWED_ORIGINS`. Test step: `npm ci` at root + `-ws --if-present`.
- **Capacitor per app**: distinct `appId`/`appName`/deep-link scheme; move existing `android`/`ios`
  under `apps/saveitforl8r/`; `cap add` for l8rgram + the photo-library plugin (l8rgram deps only).
- **PWA per app**: own `manifest.json` (distinct name/icons/`start_url`/scope) and `sw.js`; l8rgram
  drops `share_target`.

## 6. Phased rollout (walking skeleton first)

| Milestone | Scope |
|---|---|
| **M0 — Workspace scaffold** | Add workspaces + `tsconfig.base.json`; `git mv` saveitforl8r into `apps/saveitforl8r/`; drop `@/*`. No behavior change. |
| **M1 — Extract `@l8r/shared`** | Move auth/platform/ai/crypto/design-system; rewrite bounded importers; parametrize googleAuth config + namespace storage (+migration). |
| **M2 — l8rgram skeleton** | New app + own OAuth client; minimal scope; photo-library SPIKE (enumerate + thumbnails + metadata) -> encrypted store. No calendar/AI. |
| **M3 — Live calendar** | Add `calendar.readonly`; server `/api/calendar/events` + `requireScope` + `GOOGLE_ALLOWED_AUDIENCES`; `useLiveCalendar`. |
| **M4 — Album matching** | Time-window matcher; albums keyed by eventId; Albums + AlbumDetail UI. |
| **M5 — Gemini** | `/api/enrich-photo` + `/api/query-gallery` + client caption/tag + NL search pipeline. |
| **M6 — Build/deploy + native** | Workspace Dockerfiles, cloudbuild l8rgram steps, origins, PWA manifest/SW, `cap add` android/ios. |

### Biggest risks
1. **Native photo-library plugin** — full enumeration + reliable EXIF capture date across iOS/Android
   (spike early; budget for a custom plugin).
2. **EXIF web vs native** — missing/inconsistent timestamps/timezones degrade matching.
3. **Google verification of `calendar.readonly`** (sensitive scope) — may require consent-screen
   review; start early, use test users meanwhile.
4. **Dual-PWA collisions** — namespace token/IDB storage, SW scopes, appIds, schemes.
5. **Server audience allowlist** — a mis-set value silently 403s an app; add explicit logging.

## Critical files to touch
- `services/googleAuth.ts` — scope/config generalization (heart of shared auth)
- `server/middleware/auth.js` — multi-audience allowlist + per-route scope check
- `server/index.js` + new `server/routes/calendar.js` — mount calendar + photo endpoints
- `vite.config.ts` — template for per-app configs (worker, alias, Tailwind globs)
- `cloudbuild.yaml` — l8rgram client image/service, audiences, origins, secrets
- New tree: `packages/shared/**`, `apps/l8rgram/**`

## Verification (per phase)
- **M0/M1**: `npm run build/test -w saveitforl8r` green; manual smoke (login, save, enrich, query,
  Drive sync); confirm logged-in users survive key namespacing; diff dist asset list vs pre-move.
- **M2**: on device, grant permission, enumerate a known library, confirm grid + `capturedAt` match
  device dates; web multi-pick path.
- **M3**: login w/ calendar scope; `/api/calendar/events` for a known week matches Google Calendar
  UI; assert 403 when scope missing or audience not allowlisted.
- **M4**: seed photos+events with known times; assert bucketing incl. buffer edges/overlaps; re-run
  import -> no duplicate albums.
- **M5**: enrich a known image -> caption/tags persisted; NL search returns relevant ids; verify
  large-image chunked-upload path.
- **M6**: staging Cloud Run; load both PWAs; install both on one device -> independent auth/storage;
  native login bounce completes.
