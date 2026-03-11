# Performance Audit — SaveItForL8R

Investigation of client and server performance bottlenecks, ranked by impact.

---

## Critical Bottlenecks

### 1. Memory Grid Renders Without Virtualization (Client)
**Files:** `App.tsx` (lines 690-707)

The main memory grid renders ALL visible memories as DOM nodes. With 100+ memories, this creates a massive DOM tree, degrading scroll performance and initial paint time.

**Fix:** Use `react-window` or `@tanstack/virtual` to virtualize the grid, only rendering items in the viewport.

---

### 2. App-Level State Causes Full-Tree Re-Renders (Client)
**Files:** `App.tsx` (lines 44-111)

`AppContent` manages 13+ state variables. Each state change (modal toggle, filter, sync update) re-renders the entire component tree. Only `MemoryCard` has `React.memo`; other components like `MomentBubble`, `ChatInterface`, `MomentSheet`, `CalendarAgendaView` are not memoized.

**Fix:** Split state into focused providers (UI state, sync state, data state) or use a fine-grained state library (Zustand/Jotai). Wrap frequently-rendered components in `React.memo`.

---

### 3. Main-Thread Encryption Blocking (Client)
**Files:** `services/encryptionService.ts` (lines 152-194)

All AES-GCM encrypt/decrypt operations run on the main thread. During bulk sync of 100+ memories, this freezes the UI for seconds.

**Fix:** Move crypto operations to a dedicated Web Worker. Batch encrypt/decrypt calls during sync.

---

### 4. Gemini API Calls Are Blocking With No Circuit Breaker (Server)
**Files:** `server/routes/enrich.js` (lines 208-368), `server/routes/query.js` (lines 120-166), `server/routes/moment.js` (lines 68-223)

All Gemini calls use `generateContent()` which blocks until full response. Timeout/retry logic is duplicated ~10 times across files. If Gemini is slow, fallback is attempted immediately (no backoff), doubling load during outages.

**Fix:**
- Extract timeout+retry into a reusable utility with exponential backoff and jitter.
- Implement a circuit breaker: if fallback fails N times in a row, pause attempts for T seconds.
- Make `GEMINI_TIMEOUT_MS` configurable via env var.

---

## High-Impact Improvements

### 5. Sequential Data Loading (Client)
**Files:** `App.tsx` (lines 216-222, 304-324)

`refreshMemories()`, `refreshMoments()`, and `refreshEvents()` are called sequentially. Sync operations in `SyncContext.tsx` also run downloads before uploads serially.

**Fix:** Use `Promise.all()` for independent loads and parallelize upload/download where safe.

---

### 6. No Lazy Loading for Routes/Modals (Client)
**Files:** `App.tsx` (top-level imports)

`ChatInterface`, `SettingsModal`, `NewMemoryPage`, and other heavy components are eagerly imported. They're not needed on initial render.

**Fix:** Use `React.lazy()` + `Suspense` for modal and secondary view components.

---

### 7. In-Memory Rate Limiting Won't Scale (Server)
**Files:** `server/routes/enrich.js` (lines 133-149), `server/routes/query.js` (lines 29-36), `server/routes/moment.js` (lines 300-316)

Rate limiters use `express-rate-limit` default in-memory store. Cloud Run instances are ephemeral and auto-scaling — rate limits don't persist across restarts or coordinate across instances.

**Fix:** Move rate limiting to nginx/Cloud Load Balancer, or use Redis-backed store for distributed limiting.

---

### 8. Token Cache Uses FIFO Eviction, Not LRU (Server)
**Files:** `server/middleware/auth.js` (lines 1-79)

When cache reaches 10,000 entries, the first-inserted key is evicted (FIFO), not the least-recently-used. This causes unnecessary re-authentication under load. Periodic cleanup iterates the entire Map every 60 seconds.

**Fix:** Use `lru-cache` npm package for proper LRU eviction with configurable TTL.

---

### 9. Index-Based List Keys (Client)
**Files:** `components/MemoryCard.tsx` (line 382), `components/ChatInterface.tsx` (line 206)

Several lists use `key={idx}`, causing unnecessary re-renders during insertions/deletions and potential state bugs.

**Fix:** Use stable IDs (e.g., item `id` or `createdAt` timestamp) as keys.

---

## Medium-Impact Improvements

### 10. Nginx Compression Not Tuned (Server)
**Files:** `nginx.conf` (lines 8-10)

Gzip is enabled but uses defaults: compression level 1 (lowest), no `gzip_min_length`, no `gzip_vary`, no Brotli.

**Fix:**
```nginx
gzip_comp_level 6;
gzip_min_length 1000;
gzip_vary on;
```

---

### 11. No Image Lazy Loading or Thumbnails (Client)
**Files:** `components/GalleryViewer.tsx`

Attachment images load eagerly as full base64 data URIs, even when off-screen. No thumbnail generation for previews.

**Fix:** Add `loading="lazy"` to `<img>` tags. Generate smaller thumbnails for list views.

---

### 12. Service Worker Precaching Is Sequential (Client)
**Files:** `public/sw.js` (lines 111-150)

`precacheAllAssets()` fetches all assets one-by-one in a waterfall. No stale-while-revalidate strategy for faster perceived updates.

**Fix:** Batch precache requests with `Promise.all()`. Use stale-while-revalidate for non-critical assets.

---

### 13. CORS Origin Check Is O(n) per Request (Server)
**Files:** `server/index.js` (lines 78-107)

`allowedOrigins` is an array checked with `.includes()` on every request.

**Fix:** Convert to a `Set` for O(1) lookups.

---

### 14. Large JSON Payloads Without Streaming (Server)
**Files:** `server/index.js` (line 110), `server/routes/query.js` (lines 54-71)

JSON body limit is 10MB. Query endpoint builds full context with all memories (potentially 500KB+) before sending to Gemini. No response streaming.

**Fix:** Reduce default limit to 5MB. Paginate memory context for queries. Consider streaming large responses.

---

### 15. Concurrency Limiter Has No Observability (Server)
**Files:** `server/lib/concurrency.js` (lines 1-44)

Queue size is hardcoded at 100. `stats()` function exists but is never called. No logging when queue nears capacity.

**Fix:** Make queue size configurable. Log at 75%/100% capacity. Export queue metrics.

---

## Quick Wins (< 30 min each)

| Fix | Time | Impact |
|-----|------|--------|
| Convert CORS array to Set | 5 min | Marginal per-request improvement |
| Add gzip tuning to nginx.conf | 10 min | Better compression ratios |
| Add `loading="lazy"` to images | 10 min | Faster initial paint |
| Replace index keys with stable IDs | 15 min | Correct React reconciliation |
| Make timeout values configurable via env | 15 min | Operational flexibility |
| Extract Gemini retry logic to utility | 30 min | DRY, easier to add circuit breaker |

## Longer-Term Investments

| Fix | Effort | Impact |
|-----|--------|--------|
| Virtualize memory grid | 2-3 hrs | Major scroll/paint improvement |
| Move encryption to Web Worker | 2-3 hrs | Eliminates UI freezes during sync |
| Split app state / add Zustand | 3-4 hrs | Eliminates unnecessary re-renders |
| Lazy load routes and modals | 1-2 hrs | Faster initial bundle load |
| Parallelize data loading | 1 hr | Faster app startup |
| Redis-backed rate limiting | 4-6 hrs | Enables horizontal scaling |
| LRU token cache | 2-3 hrs | Better cache behavior under load |
| Circuit breaker for Gemini | 3-4 hrs | Resilience during outages |
