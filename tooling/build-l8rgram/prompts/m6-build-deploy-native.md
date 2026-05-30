# M6 — Build, deploy, native

## Goal
Workspace-aware Docker build for `l8rgram-client`, l8rgram steps in `cloudbuild.yaml`, PWA manifest/SW polish, and Capacitor android/ios projects for l8rgram.

## In scope
### Build — single combined client image
Both apps ship in ONE Cloud Run service, host-routed by nginx. Saves a warm-instance baseline.

1. **Root `Dockerfile.client`** (NEW, at repo root) — multi-stage, workspace-aware:
   - Builder stage: copies root `package.json` + `package-lock.json` + all workspace `package.json`s + `packages/shared/` + `apps/saveitforl8r/` + `apps/l8rgram/`, runs `npm ci` at root, then `npm run build -w saveitforl8r && npm run build -w l8rgram`.
   - Runtime stage: `nginx:alpine`. `COPY --from=builder /repo/apps/saveitforl8r/dist /usr/share/nginx/html/saveitforl8r` and same for l8rgram → `/usr/share/nginx/html/l8rgram`. `COPY nginx.conf /etc/nginx/conf.d/default.conf`.
2. **Root `nginx.conf`** (NEW, at repo root) — two `server` blocks selecting by `server_name`:
   - `server_name saveitforl8r.com www.saveitforl8r.com;` → `root /usr/share/nginx/html/saveitforl8r;`
   - `server_name l8rgram.com www.l8rgram.com;` → `root /usr/share/nginx/html/l8rgram;`
   - Catch-all `default_server` returning 404 for any other host.
   - Each block: SPA fallback (`try_files $uri /index.html;`), the existing security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`), cache headers for `/assets/*`.
3. **DELETE** `apps/saveitforl8r/Dockerfile` and `apps/saveitforl8r/nginx.conf` (replaced by the root combined versions). Do NOT create `apps/l8rgram/Dockerfile` or `apps/l8rgram/nginx.conf`.
4. **Root `.dockerignore`** — ensure `node_modules`, `**/dist`, `tooling/build-l8rgram/logs`, `tooling/build-l8rgram/state`, `**/.env*` (except `.env*.example`) are excluded. The Dockerfile uses the repo root as build context.

### Deploy
1. `cloudbuild.yaml` — UPDATE the existing `saveitforl8r-client` step to build the new combined image from the root `Dockerfile.client`. **Do NOT add a separate `l8rgram-client` service.** Keep the service name `saveitforl8r-client` (renaming would force domain-mapping migration; not worth it). Add a comment in the file noting the service now hosts both apps.
2. Test step: `npm ci` at root + `npm test -ws --if-present`.
3. Update `docs/l8rgram-setup-checklist.md` Deployment section to reflect the merged service:
   - Replace "Create the `l8rgram-client` Cloud Run service" with: "Add a Cloud Run domain mapping for `l8rgram.com` (and `www.l8rgram.com`) pointing to the existing `saveitforl8r-client` service: `gcloud beta run domain-mappings create --service=saveitforl8r-client --domain=l8rgram.com --region=<region>`."
   - Add: "Configure DNS for l8rgram.com per the records gcloud prints (A/AAAA for apex, CNAME for www)."

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
