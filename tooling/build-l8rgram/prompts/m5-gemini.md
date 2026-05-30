# M5 — Gemini photo enrichment + gallery search

## Goal
Per-photo auto-caption + tag via `/api/enrich-photo`. Natural-language gallery search via `/api/query-gallery`. Reuse the existing enrich/query scaffolding shape (auth + limiter + concurrency + Firestore polling) with photo/album payload shapes.

## In scope
### Server
1. `server/routes/enrichPhoto.js` — POST `/api/enrich-photo` accepting one image (inline ≤ 1.2 MB base64 OR `fileUri` from `/api/upload`). Output schema: `{ caption: string, tags: string[] }`. Writes result to Firestore collection `photo-enrichment-results`, keyed by `userId:jobId`.
2. `server/routes/queryGallery.js` — POST `/api/query-gallery` accepting `{ query: string, photoContexts: Array<{ id, caption, tags, capturedAt, albumTitles[] }> }`. Output schema: `{ photoIds: string[], reasoning?: string }`. Writes to `gallery-query-results`.
3. New validators in `server/middleware/validation.js`: `validateEnrichPhoto`, `validateQueryGallery`. Enforce attachment size caps consistent with existing limits (see CLAUDE.md: 1.2 MB inline threshold, 52 MB per-file cap).
4. Per-user limiters: `/api/enrich-photo` 30/min, `/api/query-gallery` 10/min.
5. Mount in `server/index.js`.
6. Tests for both routes + validators.

### Client (l8rgram)
1. `apps/l8rgram/hooks/usePhotoEnrichment.ts` — picks photos with `enrichmentStatus === 'pending'`, decides inline vs `@l8r/shared/ai/chunkUploadService` based on size, POSTs `/api/enrich-photo`, polls Firestore (reuse the saveitforl8r `fetchPendingEnrichments` pattern adapted to the new collection), writes `caption` + `tags` back to `photos`, sets `enrichmentStatus = 'enriched'`. Batched + throttled (e.g., max 4 concurrent, max 30/min).
2. `apps/l8rgram/hooks/useGallerySearch.ts` — builds a context block from the user's photos, POSTs `/api/query-gallery`, returns matching photo ids.
3. `apps/l8rgram/screens/SearchScreen.tsx` — search input → `useGallerySearch` → result grid (same tile component as GalleryScreen).
4. Add SearchScreen to the bottom nav (third tab after Gallery + Albums).
5. Auto-enrich newly-imported photos in the background; respect throttle.

## Out of scope
- Native (M6).
- Deploy config (M6).
- saveitforl8r changes.

## Notes
- Reuse `@l8r/shared/ai/chunkUploadService` — do not duplicate.
- Use Gemini's `systemInstruction` to separate prompt from user content (prompt-injection mitigation per CLAUDE.md).
- Tags: lower-case, short (≤ 2 words), max 8 per photo.
- Caption: 1–2 sentences, neutral tone, no leading "Photo of …" filler.

## Verification (orchestrator runs)
- `npm test -w l8rgram` green.
- `npm run build -w l8rgram` green.
- `cd server && npm test` green.

## Commit
One commit:
`feat(l8rgram): m5-gemini — enrich-photo + query-gallery routes and client hooks`
