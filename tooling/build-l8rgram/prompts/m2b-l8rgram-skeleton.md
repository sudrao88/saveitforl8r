# M2b — l8rgram skeleton

## Goal
Stand up `apps/l8rgram` as a buildable PWA + Capacitor shell with photo-library ingestion working end-to-end against the encrypted local store. No calendar, no AI yet.

## In scope
1. Create `apps/l8rgram/` workspace skeleton.
2. Install the photo-library plugin chosen by M2a (read `docs/l8rgram-m2-spike.md` first).
3. Implement `apps/l8rgram/services/photoLibrary.ts` per the M2a recommendation.
4. Encrypted local DB (`L8rgramDB`) with `photos`, `albums` (empty), `calendarCache` (empty — populated in M3).
5. OAuth config: l8rgram-specific (calendar.readonly scope, separate client id placeholder).
6. Screens: `LoginScreen`, `GalleryScreen` (virtualized grid showing thumbnails + capturedAt).
7. PWA manifest + service worker (basic; M6 hardens).
8. Capacitor config (appId, appName, scheme); do NOT run `cap add` yet (M6 does).
9. `.env.l8rgram.example` with placeholders; add `apps/l8rgram/.env.l8rgram` to root `.gitignore`.

## Out of scope
- Live calendar sync (M3).
- Album matching (M4).
- Gemini integration (M5).
- Adding native `android/`/`ios/` projects (M6).
- Server changes.

## `apps/l8rgram/package.json`
- `"name": "l8rgram"`, `"private": true`, `"type": "module"`, `"version": "0.1.0"`
- Scripts: `dev`, `build`, `preview`, `test` (vite + vitest).
- Dependencies: react, react-dom, vite, @vitejs/plugin-react, tailwindcss, idb, exifr, the photo-library plugin from M2a, capacitor core + relevant plugins, `"@l8r/shared": "*"`.

## File scaffold
```
apps/l8rgram/
  package.json
  vite.config.ts            # mirrors saveitforl8r vite config but app-specific
  tsconfig.json             # extends ../../tsconfig.base.json, paths to @l8r/shared
  capacitor.config.ts       # appId com.l8rgram.app, scheme l8rgram://
  .env.l8rgram.example
  index.html
  index.tsx                 # calls configureGoogleAuth(...) then renders <App/>
  App.tsx                   # routes between LoginScreen / GalleryScreen based on auth
  index.css                 # @import "tailwindcss"; @import "@l8r/shared/tokens.css";
  public/
    manifest.json           # name=l8rgram, start_url=/, scope=/, separate icons
    sw.js                   # minimal cache-first SW (M6 hardens)
    icons/                  # placeholder PNGs at 192/512 (M6 replaces)
  types.ts                  # Photo, Album, LiveCalendarEvent (per spec section 4)
  services/
    photoLibrary.ts         # native enumeration + EXIF fallback chain
    storageService.ts       # L8rgramDB (photos, albums, calendarCache); uses @l8r/shared/crypto
  hooks/
    useAuth.ts              # thin wrapper around @l8r/shared/auth
    usePhotoLibrary.ts      # paginated import, dedupe by assetId, lastImportedAt cursor
  screens/
    LoginScreen.tsx         # Google sign-in button (calendar.readonly scope)
    GalleryScreen.tsx       # virtualized grid, lazy thumbnails
  components/
    PhotoTile.tsx
  __tests__/
    photoLibrary.test.ts    # EXIF fallback chain
    storageService.test.ts  # CRUD + crypto roundtrip
    usePhotoLibrary.test.tsx
```

## `apps/l8rgram/index.tsx`
```ts
import { configureGoogleAuth } from '@l8r/shared/auth';
configureGoogleAuth({
  clientId: import.meta.env.VITE_L8RGRAM_GOOGLE_CLIENT_ID,
  clientSecret: import.meta.env.VITE_L8RGRAM_GOOGLE_CLIENT_SECRET,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  hostedUrl: import.meta.env.VITE_L8RGRAM_HOSTED_URL,
  deepLinkScheme: 'l8rgram',
  storageNamespace: 'l8rgram',
  proxyUrl: import.meta.env.VITE_PROXY_URL,
});
```

## `apps/l8rgram/.env.l8rgram.example`
```
VITE_L8RGRAM_GOOGLE_CLIENT_ID=__SET_ME__
VITE_L8RGRAM_GOOGLE_CLIENT_SECRET=__SET_ME__
VITE_L8RGRAM_HOSTED_URL=__SET_ME__
VITE_PROXY_URL=https://your-proxy.run.app
```
Add `apps/l8rgram/.env.l8rgram` to the root `.gitignore`.

## `capacitor.config.ts`
- `appId: 'com.l8rgram.app'`, `appName: 'l8rgram'`, `webDir: 'dist'`, `bundledWebRuntime: false`.
- iOS scheme: `'l8rgram'`. Android intent-filter wiring deferred to M6 (when `cap add android` materializes).

## `storageService.ts` (L8rgramDB)
- IDB name: `'l8rgram:l8rgram_db'` (namespaced).
- Stores: `photos` (key: `id`), `albums` (key: `id`), `calendarCache` (key: `id`).
- Reuse `@l8r/shared/crypto` for the same AES-GCM scheme.
- Provide CRUD: `putPhotos`, `getPhotos`, `getPhotoById`, `getLastImportedAt`, `setLastImportedAt`, plus parallel ones for albums / calendarCache (the latter two are stubs hit by M3/M4).

## Photo type (per spec)
```ts
export interface Photo {
  id: string;            // uuid generated client-side
  assetId: string;       // native asset identifier (de-dupe key)
  uri: string;           // platform-specific URI for full bytes
  thumbnailUri?: string;
  mimeType: string;
  width: number;
  height: number;
  capturedAt: number;    // epoch ms (the album-matching key)
  location?: { lat: number; lng: number };
  caption?: string;      // M5
  tags: string[];        // M5
  albumIds: string[];    // M4
  enrichmentStatus: 'pending' | 'enriched' | 'failed' | 'skipped';
}
```

## Design system
All UI uses `@l8r/shared/design-system` (`btn.*`, `card.*`, `overlay.*`, `text.*`, etc.) and `@l8r/shared/tokens.css`. Per CLAUDE.md, never use raw Tailwind colors / radii / z-indices / arbitrary text sizes.

## Verification (orchestrator runs)
- `npm install` succeeds.
- `npm run build -w l8rgram` succeeds.
- `npm test -w l8rgram` passes.
- `apps/l8rgram/.env.l8rgram.example` exists.

## Commit
One commit:
`feat(l8rgram): m2b-l8rgram-skeleton — app scaffold + photo-library ingestion + encrypted local store`
