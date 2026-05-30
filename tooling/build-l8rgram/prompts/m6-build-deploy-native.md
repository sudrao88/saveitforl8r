# M6 — Build, deploy, native

## Goal
Workspace-aware Docker build for `l8rgram-client`, l8rgram steps in `cloudbuild.yaml`, PWA manifest/SW polish, and Capacitor android/ios projects for l8rgram.

## In scope
### Build
1. `apps/l8rgram/Dockerfile` — workspace-aware: copies root lockfile + needed workspace `package.json`s + `packages/shared` + `apps/l8rgram`, `npm ci` at root, `npm run build -w l8rgram`, then nginx-serves `apps/l8rgram/dist`.
2. `apps/l8rgram/nginx.conf` — mirrors saveitforl8r's config; adds the same security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
3. `apps/saveitforl8r/Dockerfile` — refactor to be workspace-aware too (currently single-app; now needs the root lockfile + shared package).
4. Root `.dockerignore` — ensure `node_modules`, `dist`, `**/dist`, `tooling/build-l8rgram/logs`, `tooling/build-l8rgram/state` are excluded; both Dockerfiles use the SAME root context.

### Deploy
1. `cloudbuild.yaml` — add `l8rgram-client` image build/push/deploy steps mirroring saveitforl8r's pattern. Use l8rgram-specific secrets/build-args (the env vars listed in `docs/l8rgram-spec.md` section 7).
2. Test step: `npm ci` at root + `npm test -ws --if-present`.
3. Update `docs/l8rgram-setup-checklist.md`: tick off any steps now automated; leave manual ones (OAuth client creation, scope verification, real icons).

### PWA
1. `apps/l8rgram/public/manifest.json` — final manifest: `name: l8rgram`, `short_name: l8rgram`, `start_url: /`, `scope: /`, distinct theme color, l8rgram icons. NO `share_target`.
2. `apps/l8rgram/public/sw.js` — production SW: cache-first for static assets, network-first for `/api/*`, version cache name per build.
3. l8rgram icons: generate placeholder PNGs at 192 and 512 sizes if none exist; commit them. (Final icons are a manual replacement noted in the checklist.)

### Native
1. From `apps/l8rgram`, run `npx cap add ios` and `npx cap add android` so native projects materialize at `apps/l8rgram/ios` and `apps/l8rgram/android`.
2. Install the photo-library plugin native bits: `npx cap sync`.
3. iOS `Info.plist`: add `NSPhotoLibraryUsageDescription` (and `NSPhotoLibraryAddUsageDescription` if needed) and the `l8rgram://` URL scheme.
4. Android `AndroidManifest.xml`: add `READ_MEDIA_IMAGES` (API 33+) and `READ_EXTERNAL_STORAGE` (≤ 32) permissions, plus the deep-link intent filter for `l8rgram://`.
5. Do NOT commit Pod/Gradle build artifacts (ensure `.gitignore` covers `apps/l8rgram/ios/App/Pods`, `apps/l8rgram/android/.gradle`, `apps/l8rgram/android/build`, `apps/l8rgram/android/app/build`).

## Out of scope
- App Store / Play Console submission.
- DNS / domain config for l8rgram.
- Real icon assets (placeholders + checklist note).

## Verification (orchestrator runs)
- `npm install` succeeds at the root.
- `npm run build -ws --if-present` succeeds for all workspaces.
- `npm test -ws --if-present` green across the board.
- `apps/l8rgram/ios/` and `apps/l8rgram/android/` exist as directories.
- `cloudbuild.yaml` contains a step referencing `l8rgram-client`.

## Commit
One commit:
`feat(l8rgram): m6-build-deploy-native — workspace Dockerfiles, cloudbuild l8rgram steps, PWA polish, cap add ios+android`
