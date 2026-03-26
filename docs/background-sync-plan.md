# Background Sync Investigation & Implementation Plan

## Context

SaveItForL8R currently relies on **foreground-only** mechanisms for all sync and polling:
- Google Drive sync runs on a 5-min interval + visibility trigger (`context/SyncContext.tsx`)
- Enrichment/moment/synthesis polling uses client-side HTTP polling at 1-2s intervals with 120s timeout (`hooks/useEnrichmentPolling.ts`, `services/geminiService.ts`)
- A Background Sync API skeleton exists in `public/sw.js` (`'enrich-memory'` tag) but the handler is empty
- Periodic Background Sync is used only for morning briefing notifications (12hr, Chrome-only)

**Problem**: When the user backgrounds the app or switches tabs, all sync and polling stops. Enrichment results go undelivered, Drive sync stalls, and moments sit unprocessed until the user returns.

**Goal**: Add **silent background layers** on top of the existing foreground polling so that the **full pipeline** continues invisibly when the app isn't in the foreground:
1. **Enrichment/moment/synthesis polling** — continue polling the server for results even when backgrounded
2. **Apply enrichment to local data** — when results arrive, update the memory in IndexedDB with enrichment data
3. **Sync enriched data back to Drive** — upload the now-enriched memory to Google Drive so other devices get it
4. **Drive sync** — pull new/changed notes from Drive, push local changes

**No new user-visible notifications** — morning briefing remains the only notification. The existing polling architecture stays intact as the primary mechanism.

---

## Platform Capabilities Assessment

### 1. Web Browser (Chrome/Safari/Firefox)

| API | Chrome | Safari | Firefox | Reliability |
|-----|--------|--------|---------|-------------|
| **Background Sync API** | Yes | No | No | One-shot, fires when online. Deferred until connectivity. |
| **Periodic Background Sync** | Yes (installed PWA only) | No | No | Min interval browser-controlled. Requires engagement score. |
| **Web Push (silent)** | Yes | Yes (16.4+) | Yes | Server-initiated. Wakes service worker. Can process without showing notification. |
| **Page Visibility API** | Yes | Yes | Yes | Detect foreground/background transitions. |

**Key constraints**:
- Chrome **requires** showing a visible notification for each push event (silent processing only allowed sometimes)
- Safari 16.4+ supports Web Push but also requires visible notification
- This makes true "silent push on web" unreliable — browser may force a notification

**Web strategy**: Use Background Sync API (Chrome) for offline resilience + Periodic Background Sync for installed PWAs. For non-Chrome browsers, rely on recovery-on-open (existing behavior). Web Push is not suitable for silent background sync due to browser notification requirements.

### 2. Standalone PWA (Installed, Chrome on Android)

- **Periodic Background Sync** available with engagement score
- Can register for periodic checks at OS-determined intervals
- Combined with Background Sync API for one-shot offline recovery
- Best web-based background capability available

### 3. Native Android (Capacitor)

| Mechanism | Description | Reliability | Silent? |
|-----------|-------------|-------------|---------|
| **WorkManager** | Periodic/one-shot tasks. Survives app kill. | High | Yes — fully invisible |
| **FCM Data Message** | Server-initiated, wakes app. No visible notification required. | Very high | Yes — data messages are silent |
| **Foreground Service** | Persistent notification, runs indefinitely. | Very high | No — shows notification |

**Key insight**: **FCM data messages** (not notification messages) are truly silent on Android — they wake the app without any visible notification. Combined with **WorkManager** for periodic sync, this gives full silent background capability.

### 4. Native iOS (Capacitor)

| Mechanism | Description | Reliability | Silent? |
|-----------|-------------|-------------|---------|
| **BGAppRefreshTask** | ~30s execution, OS-scheduled | Medium | Yes — fully invisible |
| **BGProcessingTask** | Longer execution during charging | Medium-low | Yes — fully invisible |
| **Silent Push (content-available)** | Server sends silent push, app gets ~30s | High | Yes — no UI shown |
| **NSURLSession Background Transfer** | Background uploads/downloads | High | Yes — fully invisible |

**Key insight**: iOS **silent push** (`content-available: 1`, no `alert`/`badge`/`sound`) is truly silent — no user notification shown. Rate-limited to ~2-3/hour by Apple. Combined with **BGAppRefreshTask** for periodic sync, this gives good silent background capability.

---

## Recommended Architecture

**Principle**: Existing foreground polling is untouched. Background layers work invisibly alongside it. No new user-facing notifications — morning briefing is the only notification.

### Layer 1: Background Sync API for Offline Resilience (Chrome/Edge)

**Purpose**: When operations fail due to offline status, queue them and retry silently when connectivity returns.

#### How it works:
1. User saves note or triggers enrichment while offline → operation fails
2. Queue the operation in IndexedDB
3. Register Background Sync: `registration.sync.register('enrich-memory')` / `'sync-drive'`
4. When connectivity returns, SW `sync` event fires → silently processes the queue
5. No notification shown — data is simply updated in IndexedDB for the app to find on next open

#### Files to create/modify:
- **`public/sw.js`** — Implement the existing empty `processEnrichQueue()`, add `'sync-drive'` handler
- **`services/backgroundSyncQueue.ts`** (new) — IndexedDB-backed queue (add/remove/peek)
- **`services/geminiService.ts`** — On enrichment submission network failure, queue to Background Sync
- **`context/SyncContext.tsx`** — On Drive sync network failure, queue changed items to Background Sync

#### Graceful degradation:
- Safari/Firefox: Operation stays in IndexedDB queue, retried on next app open via existing recovery logic
- Feature-detect: `'SyncManager' in window`

### Layer 2: Silent Push + Full Background Data Pipeline

**Purpose**: When enrichment, moment creation, or synthesis completes on the server, silently wake the app to execute the **full pipeline**: fetch result → apply enrichment to local memory → sync enriched memory back to Drive → update matched moments → sync moments to Drive. All invisible to the user.

#### Full background pipeline (triggered by silent push or background wake):

```
Server completes enrichment/moment/synthesis
  → Silent push wakes the app (native) or recovery runs on foreground return (web)
    → Step 1: Fetch result from server (/api/enrich/results, /api/create-moment/results, /api/synthesize/results)
    → Step 2: Apply result to memory in IndexedDB (update tags, summary, entities, content type, temporal context, link previews)
    → Step 3: If enrichment has matchedMomentIds → update those moments in IndexedDB (add note to cluster)
    → Step 4: Trigger Drive sync for all modified items (enriched memory + updated moments + updated syntheses)
    → Step 5: Update local sync snapshot so next foreground sync knows these items are already synced
  → When user reopens app: memory is enriched, moments updated, everything synced to Drive — instant display
```

This pipeline reuses existing logic:
- Step 1-2: Same as `useEnrichmentPolling.ts` → `applyResult()` and `useMemories.ts` update flow
- Step 3: Same as moment reconciliation in `SyncContext.tsx` download handler
- Step 4-5: Same as `SyncContext.tsx` upload flow

A new **`services/backgroundPipeline.ts`** extracts this shared logic so it's callable from both foreground hooks and background handlers.

#### How it works (Native Android — FCM Data Message):
1. Client submits enrichment → existing polling runs in foreground
2. If user backgrounds the app, foreground polling may stop (OS suspends timers)
3. Server completes enrichment, stores result in Firestore (existing behavior)
4. Server checks: has client polled for this result? If not after 30s grace period → send FCM **data message**
5. Android receives data message silently (no notification shown to user)
6. Native handler wakes the WebView briefly to run the full pipeline:
   a. Fetch enrichment result from server
   b. Apply to memory in IndexedDB (tags, summary, entities, etc.)
   c. Update matched moments if applicable
   d. Upload enriched memory + updated moments to Google Drive
   e. Update sync snapshot
7. When user reopens app, everything is already enriched and synced — no delay

#### How it works (Native iOS — Silent Push):
1. Same flow as Android, but server sends APNS silent push (`content-available: 1`, no alert/badge/sound)
2. iOS wakes app for ~30s — enough for the full pipeline
3. App runs the same pipeline: fetch → apply → sync to Drive
4. Rate-limited by Apple (~2-3/hour) — only send for actual completions

#### How it works (Web/PWA — No silent push):
- Web browsers require visible notifications for push events → **skip push on web**
- Instead rely on: existing foreground polling (handles pipeline while tab is active), Background Sync API (offline queue), Periodic Background Sync (installed PWA)
- When user returns to tab, `visibilitychange` triggers recovery which runs the same pipeline
- For installed PWA (Chrome): Periodic Background Sync can run the pipeline on a schedule

#### Server-side grace period logic:
```
On enrichment/moment/synthesis completion:
  1. Store result in Firestore (existing)
  2. Start 30-second grace timer
  3. If client polls and retrieves result within 30s → cancel push (foreground polling handled it + ran pipeline)
  4. If 30s passes without client retrieval → look up client's push subscription
     - If native Android → send FCM data message { memoryId, type: 'enrichment-complete' }
     - If native iOS → send APNS silent push { content-available: 1, memoryId, type }
     - If web → skip (handled on next foreground visit)
```

#### Files to create/modify:
- **`server/routes/push.js`** (new) — Push subscription registration endpoint (stores device token + platform)
- **`server/lib/silentPush.js`** (new) — FCM data message / APNS silent push sender
- **`server/routes/enrich.js`** — Add grace-period logic, trigger silent push on completion
- **`server/routes/moment.js`** — Same grace-period + silent push logic
- **`server/routes/synthesize.js`** — Same pattern (if separate route exists)
- **`services/pushService.ts`** (new) — Client-side push token registration (FCM on Android, APNS on iOS)
- **`services/backgroundPipeline.ts`** (new) — Shared pipeline logic: fetch result → apply to IndexedDB → sync to Drive → update moments. Called by both foreground polling hooks and background push handlers.
- **`hooks/useEnrichmentPolling.ts`** — Refactor to delegate apply/sync steps to `backgroundPipeline.ts`
- **`context/SyncContext.tsx`** — Expose a `syncSpecificItems(memoryIds)` method for the pipeline to trigger targeted Drive uploads
- **Native Android**: Add FCM plugin (`@capacitor-firebase/messaging`), data message handler that triggers pipeline
- **Native iOS**: Configure APNS via Capacitor push plugin, silent push handler that triggers pipeline

### Layer 3: Native Background Periodic Sync + Enrichment Recovery

**Purpose**: Periodically run the full sync cycle even when the app is completely closed/killed: check for pending enrichment/moment results, apply them, and sync everything to/from Drive. Fully silent — no notifications.

#### Android — WorkManager

1. Register a `PeriodicWorkRequest` with a 12-hour interval
2. Worker wakes the WebView (or runs headless JS) to:
   a. **Check for pending enrichments/moments**: Call `/api/enrich/results` and `/api/create-moment/results` for any memories still in `processing` state in IndexedDB
   b. **Apply any completed results**: Run the background pipeline (fetch → apply → update moments)
   c. **Drive delta sync**: Compare local snapshot vs Drive file list, download new items, upload changed items (including newly enriched memories)
3. No notification shown — data is ready when user reopens app

**Implementation**:
- Custom `SyncWorker extends Worker` in `android/app/src/main/java/.../SyncWorker.java`
- Constraints: `NetworkType.CONNECTED`, `BatteryNotLow`
- Registered on app startup via Capacitor bridge call
- Token passed from web layer to native SharedPreferences on each auth refresh

#### Android — Foreground Service for Bulk Sync (User-Initiated Only)

For user-initiated "sync everything" from settings:
- Show a persistent notification with progress (this is expected by the user since they triggered it)
- "Syncing 47 memories..." with progress bar
- This is the **only** user-visible notification from background sync (aside from morning briefing)
- Use `@capawesome/capacitor-android-foreground-service` plugin

#### iOS — BGAppRefreshTask

1. Register `BGAppRefreshTask` with identifier `com.saveitforl8r.app.refresh`, targeting ~12-hour intervals (iOS decides actual timing)
2. Task gets ~30s — enough to run the same cycle as WorkManager:
   a. Check for pending enrichments/moments → apply completed results
   b. Run Drive delta sync (upload enriched memories, download new items)
3. Schedule next refresh at end of each task
4. Completely silent — no UI

#### iOS — BGProcessingTask for Heavy Sync

- For large sync operations during charging + Wi-Fi
- Gets several minutes of execution time
- Silent — no notifications

#### Files to create/modify:
- **`android/.../SyncWorker.java`** (new) — WorkManager periodic sync worker
- **`android/.../ForegroundSyncService.java`** (new) — Foreground service for user-initiated bulk sync
- **`services/nativeBackgroundSync.ts`** (new) — Capacitor bridge for registering WorkManager tasks and BGTasks
- **`capacitor.config.ts`** — Add background task plugin config
- **`ios/App/App/AppDelegate.swift`** — Register `BGAppRefreshTask` and `BGProcessingTask` identifiers
- **`ios/App/App/BackgroundSyncTask.swift`** (new) — Swift implementation for background sync

### Layer 4: Visibility-Aware Sync Scheduling

**Purpose**: Adapt sync frequency based on foreground/background state without removing any existing mechanisms.

#### How it works:
1. `document.visibilitychange` detects background/foreground transitions
2. **Foreground**: All existing polling and sync runs exactly as today (unchanged)
3. **Background (web)**: Extend Drive sync interval from 5-min to 15-min (saves battery); enrichment polling continues for its full 120s timeout if an enrichment is in progress
4. **Return to foreground**: Immediately trigger a sync check + recovery for any pending enrichments/moments
5. **Background (native)**: OS may suspend JS timers; WorkManager/BGTask takes over seamlessly

#### Files to modify:
- **`context/SyncContext.tsx`** — Add `visibilitychange` listener to adjust `PERIODIC_SYNC_INTERVAL_MS` when backgrounded; trigger immediate sync on return to foreground
- **`hooks/useEnrichmentPolling.ts`** — No changes needed (already has timeout-based lifecycle)

### Layer 5: Periodic Background Sync for Installed PWA (Chrome)

**Purpose**: For users who install the PWA, register periodic background sync to silently run the full cycle (enrichment recovery + Drive sync) even when no tabs are open.

#### How it works:
1. On PWA install, register: `registration.periodicSync.register('full-sync', { minInterval: 12 * 60 * 60 * 1000 })`
2. Chrome decides actual timing (could be less frequent based on engagement)
3. SW `periodicsync` event fires → run the same cycle:
   a. Check for pending enrichments/moments in IndexedDB → poll server for results → apply completed ones
   b. Perform Drive delta sync (upload enriched memories + download new items)
4. Completely silent — no notification shown

#### Files to modify:
- **`public/sw.js`** — Add `'drive-sync'` handler in existing `periodicsync` event listener
- **`services/pushService.ts`** or **`hooks/useServiceWorker.ts`** — Register periodic sync on PWA install

---

## Implementation Phases

### Phase 1: Background Sync API + Offline Queue (Low effort, immediate value)
1. Create `services/backgroundSyncQueue.ts` — IndexedDB-backed operation queue
2. Implement `processEnrichQueue()` in `sw.js` (flesh out existing skeleton)
3. Add `'sync-drive'` handler in sw.js sync event
4. Wire `geminiService.ts` to queue enrichment on network failure + register Background Sync
5. Wire `SyncContext.tsx` to queue Drive ops on failure + register Background Sync
6. Feature-detect `SyncManager` for graceful degradation

### Phase 2: Visibility-Aware Scheduling
1. Add `visibilitychange` listener to `SyncContext.tsx`
2. Extend sync interval when backgrounded (5min → 15min)
3. Trigger immediate sync + recovery on return to foreground
4. Add Periodic Background Sync registration for installed PWA (`'drive-sync'` tag)

### Phase 3: Silent Push Infrastructure (Server + Native)
1. Create `server/routes/push.js` — device token registration endpoint
2. Create `server/lib/silentPush.js` — FCM data message + APNS silent push sender
3. Add grace-period logic to `enrich.js` and `moment.js` — send silent push if result not polled within 30s
4. Add `@capacitor-firebase/messaging` to Android project
5. Configure APNS in iOS project
6. Create `services/pushService.ts` — register device token on app startup (native only)
7. Implement FCM data message handler (Android) — silently fetches + stores result
8. Implement silent push handler (iOS) — calls existing recovery logic

### Phase 4: Native Periodic Background Sync
1. Create `SyncWorker.java` — WorkManager periodic Drive sync (Android)
2. Create `nativeBackgroundSync.ts` — Capacitor bridge for background task registration
3. Register `BGAppRefreshTask` in `AppDelegate.swift` (iOS)
4. Create `BackgroundSyncTask.swift` — iOS background sync
5. Add `BGProcessingTask` for heavy sync during charging (iOS)
6. Add foreground service for user-initiated bulk sync (Android)

---

## Key Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `public/sw.js` | Modify | Implement `processEnrichQueue()`, add `'sync-drive'` Background Sync handler, add `'drive-sync'` Periodic Background Sync handler |
| `services/backgroundSyncQueue.ts` | Create | IndexedDB-backed queue for offline operations |
| `services/geminiService.ts` | Modify | Queue enrichment to Background Sync on network failure |
| `context/SyncContext.tsx` | Modify | Visibility-aware interval, Background Sync on failure, immediate recovery on foreground return |
| `server/routes/push.js` | Create | Device token registration endpoint |
| `server/lib/silentPush.js` | Create | FCM data message / APNS silent push sender |
| `server/routes/enrich.js` | Modify | Grace-period silent push on enrichment completion |
| `server/routes/moment.js` | Modify | Grace-period silent push on moment/synthesis completion |
| `services/pushService.ts` | Create | Native-only device token registration |
| `capacitor.config.ts` | Modify | Add FCM + background task plugin config |
| `android/.../SyncWorker.java` | Create | WorkManager periodic sync worker |
| `android/.../ForegroundSyncService.java` | Create | User-initiated bulk sync foreground service |
| `services/nativeBackgroundSync.ts` | Create | Capacitor bridge for WorkManager / BGTask |
| `ios/.../AppDelegate.swift` | Modify | Register BGAppRefreshTask / BGProcessingTask |
| `ios/.../BackgroundSyncTask.swift` | Create | iOS background sync implementation |

---

## Verification Plan

1. **Background Sync API**: Save note while offline → go online → verify enrichment submission completes via SW sync event (check IndexedDB for result)
2. **Visibility scheduling**: Background tab → verify Drive sync interval extends → return to foreground → verify immediate sync triggers
3. **Periodic Background Sync (PWA)**: Install PWA → close all tabs → verify Drive sync runs (check IndexedDB timestamps)
4. **FCM silent push (Android)**: Submit enrichment → background app → wait 30s+ → reopen → verify result is already in IndexedDB (no notification was shown)
5. **Silent push (iOS)**: Submit enrichment → lock device → wait → reopen → verify result is stored
6. **WorkManager (Android)**: Kill app → wait 12+ hours (or force-trigger via adb for testing) → reopen → verify Drive sync occurred in background
7. **BGAppRefreshTask (iOS)**: Background app → check console logs for background execution
8. **Foreground polling unaffected**: Verify all current polling works identically — enrichment, moment, synthesis, Drive sync — with all background layers enabled
9. **No unexpected notifications**: Verify that no user-visible notifications are shown from any background sync activity (only morning briefing)

---

## Accepted Trade-offs

- **FCM/APNS require Firebase project setup** — adds infrastructure dependency for native silent push
- **iOS silent push rate-limited** — Apple limits to ~2-3/hour; enrichments completing rapidly may queue
- **WorkManager runs every 12 hours** — conservative to save battery; silent push handles time-sensitive completions between cycles
- **Background Sync API is Chrome-only** — Safari/Firefox fall back to existing recovery-on-open
- **Periodic Background Sync timing is OS-controlled** — Chrome decides actual frequency based on engagement score
- **Web has no true silent push** — browsers require visible notification for push events; web relies on Background Sync API + recovery-on-open instead
- **Grace period adds 30s latency for background delivery** — acceptable since foreground polling (1-2s) handles the fast path; silent push is only for when the user has already left
- **Auth token in SharedPreferences (Android) / Keychain (iOS)** — needed for background sync to call Drive API; must be stored securely with encryption
