# M3 — Live Google Calendar

## Goal
Wire l8rgram up to the user's live Google Calendar. Add the server route + middleware, then the client hook that fetches events across imported photos' time range and caches them locally.

## In scope
### Server
1. `server/middleware/auth.js` — replace the single-id `aud` check with a `GOOGLE_ALLOWED_AUDIENCES` allowlist (comma-separated env var). Back-compat: if unset, fall back to `[GOOGLE_CLIENT_ID]`.
2. New `server/middleware/requireScope.js` — `requireScope(scope)` middleware reading scopes from the cached `tokenInfo`. Apply ONLY to `/api/calendar/*`. Leave `/api/enrich` and `/api/query` scope-agnostic.
3. Cache `tokenInfo.scope` alongside the existing token cache (5-min TTL) so `requireScope` doesn't add a network call per request.
4. New `server/routes/calendar.js` — `GET /api/calendar/events?timeMin=&timeMax=&pageToken=` forwarding to `https://www.googleapis.com/calendar/v3/calendars/primary/events` using the user's own `req.accessToken`. `singleEvents=true&orderBy=startTime`. Paginate via `nextPageToken`.
5. New `validateCalendarQuery` in `server/middleware/validation.js`: ISO timestamps, max 1-year span, optional `pageToken`.
6. Per-user limiter for calendar route (~30/min).
7. Mount in `server/index.js`.
8. Server tests for: audience allowlist (single, multi, reject), scope check (allow, 403 missing), validator (good, bad timestamps, oversized span), and the route (mock upstream).

### Client (l8rgram)
1. `apps/l8rgram/hooks/useLiveCalendar.ts` — computes the span `min(capturedAt)…max(capturedAt)` from imported photos, calls `/api/calendar/events`, follows `nextPageToken`, persists events to encrypted `calendarCache` keyed by `event.id`. Returns `{ events, isSyncing, lastSyncedAt, syncNow() }`. Throttles re-sync to once per 5 min unless `syncNow()` is invoked.
2. Simple "Sync calendar" action on the GalleryScreen header to trigger the initial fetch.
3. Hook test covering: empty photos → no-op; multi-page response → all events persisted; throttle.

## Out of scope
- Album matching (M4).
- Gemini.
- saveitforl8r changes.

## Audience allowlist details
- Parse `GOOGLE_ALLOWED_AUDIENCES` once at module load (Set for O(1) lookup).
- Reject when `tokenInfo.aud` not in the set. Log the rejected audience (info level, no PII) to aid debugging.

## `requireScope` middleware
```js
// server/middleware/requireScope.js
export const requireScope = (scope) => (req, res, next) => {
  const scopes = (req.tokenInfo?.scope || '').split(/\s+/);
  if (!scopes.includes(scope)) {
    return res.status(403).json({ error: 'insufficient_scope', required: scope });
  }
  next();
};
```

## `routes/calendar.js`
- `GET /api/calendar/events`
- Required query: `timeMin`, `timeMax` (RFC3339). Optional: `pageToken`.
- Forwards to Google Calendar API; returns upstream JSON unchanged on 200 or wrapped error otherwise.
- On 401 from Google, return 401 `{ error: 'reauth_required' }` so the client can re-prompt.

## Verification (orchestrator runs)
- `npm test -w saveitforl8r` still green.
- `npm run build -w l8rgram` green.
- `npm test -w l8rgram` green (new hook tests).
- `cd server && npm test` green (new route + middleware tests).

## Commit
One commit:
`feat(l8rgram): m3-live-calendar — server route + scope middleware + multi-audience + client sync hook`
