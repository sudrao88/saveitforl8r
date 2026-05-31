# l8rgram setup checklist

Run after `tooling/build-l8rgram/run.sh` completes.

## GCP / OAuth
- [ ] Create a second OAuth 2.0 Web client in the GCP console.
- [ ] Add the l8rgram production origin to authorized JavaScript origins.
- [ ] Add the l8rgram deep-link scheme to authorized redirect URIs.
- [ ] Submit `https://www.googleapis.com/auth/calendar.readonly` for Google verification (sensitive scope).

## Environment
- [ ] Fill `apps/l8rgram/.env.l8rgram` with real `VITE_L8RGRAM_GOOGLE_CLIENT_ID` and `VITE_L8RGRAM_GOOGLE_CLIENT_SECRET`.
- [ ] Set Cloud Run server env `GOOGLE_ALLOWED_AUDIENCES=<saveitforl8r-id>,<l8rgram-id>`.
- [ ] Append l8rgram's deployed origin to the server's `ALLOWED_ORIGINS`.

## Deployment (single combined Cloud Run service hosts both apps)
- [ ] Verify `cloudbuild.yaml`'s `saveitforl8r-client` step builds the combined client image from the root `Dockerfile.client` (updated in M6).
- [ ] Add a Cloud Run domain mapping for `l8rgram.com` to the existing `saveitforl8r-client` service: `gcloud beta run domain-mappings create --service=saveitforl8r-client --domain=l8rgram.com --region=<region>` (repeat for `www.l8rgram.com`).
- [ ] Add the DNS records gcloud prints to your DNS provider (A/AAAA for apex, CNAME for www).
- [ ] Run `npx cap sync` from `apps/l8rgram` on each native target.

## Validation
- [ ] Confirm the M2 spike findings against a real device (see `docs/l8rgram-m2-spike.md`). The spike chose `@capgo/capacitor-photo-library` over the spec's `@capacitor-community/media` candidate — verify on device: (a) full enumeration on **both iOS and Android** (the rejected plugin's `getMedias` is iOS-only), (b) acceptable perf/no-crash on a **10k+ library** (unproven for this plugin), (c) iOS 14+ **limited-access** tier handling, (d) iCloud cloud-only full-res download. If any fails, drop to the fallback ladder in the spike's Recommendation.
- [ ] Re-test saveitforl8r end-to-end after deploy (login persistence across the storage namespacing migration in M1).
- [ ] Replace placeholder l8rgram icons under `apps/l8rgram/public/icons/` with real artwork.
