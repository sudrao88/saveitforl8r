import { lazy, ComponentType } from 'react';
import { isChunkLoadError, clearServiceWorkerCaches } from './chunkErrorUtils';

// sessionStorage key recording the timestamp of the last chunk-failure reload.
const RETRY_KEY = 'chunk_retry_refresh';

// How long after a recovery reload we consider a repeat chunk failure to be
// "the reload didn't help" rather than a fresh, recoverable failure. Within
// this window we surface the error to the ErrorBoundary instead of reloading
// again (prevents an infinite reload loop). Once the window elapses, recovery
// re-arms so a *later* deployment can be recovered from automatically.
const RETRY_COOLDOWN_MS = 10_000;

function readLastRetry(): number {
  try {
    return Number(sessionStorage.getItem(RETRY_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setLastRetry(ts: number): void {
  try {
    sessionStorage.setItem(RETRY_KEY, String(ts));
  } catch {
    // sessionStorage may be unavailable (e.g. privacy mode) — proceed without it.
  }
}

function clearLastRetry(): void {
  try {
    sessionStorage.removeItem(RETRY_KEY);
  } catch {
    // ignore
  }
}

/**
 * Resets the chunk-retry guard. Call this when the user explicitly triggers a
 * reload (e.g. the ErrorBoundary "Reload App" button) so the next load gets a
 * fresh recovery budget instead of being condemned to the error screen.
 */
export function resetChunkRetryGuard(): void {
  clearLastRetry();
}

/**
 * Attempts a dynamic import, recovering from stale-chunk failures.
 *
 * After a new deployment, the service worker may serve a cached index.html
 * that references old hashed JS chunks which no longer exist on the server.
 * Importing those stale URLs throws "Failed to fetch dynamically imported
 * module" / "Importing a module script failed."
 *
 * On such a failure we clear the SW caches and reload once so the next load
 * fetches a fresh index.html + chunks. The retry is rate-limited (not a
 * permanent one-shot fuse): if the import still fails immediately after a
 * reload we surface the error rather than looping, but a success — or simply
 * the passage of time — re-arms recovery so future deployments self-heal too.
 *
 * Only chunk/module loading errors trigger recovery; other errors propagate.
 */
export async function importWithChunkRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): Promise<{ default: T }> {
  try {
    const module = await importFn();
    // Success: clear the guard so a later deploy can recover again. Without
    // this the guard would stay set for the whole session after one reload,
    // sending every subsequent chunk hiccup straight to the ErrorBoundary.
    clearLastRetry();
    return module;
  } catch (error) {
    // Only attempt cache-clear + reload for chunk loading errors.
    // Syntax errors, runtime errors, etc. should propagate immediately.
    if (!isChunkLoadError(error)) {
      throw error;
    }

    const lastRetry = readLastRetry();
    const now = Date.now();

    // If we reloaded very recently and the chunk STILL fails, the reload didn't
    // help (e.g. the asset is genuinely missing). Surface to the ErrorBoundary
    // instead of reloading forever.
    if (lastRetry && now - lastRetry < RETRY_COOLDOWN_MS) {
      clearLastRetry();
      throw error;
    }

    console.warn('[lazyWithRetry] Chunk load failed, clearing caches and reloading:', error);

    // Clear all service worker caches so the next load gets fresh assets.
    await clearServiceWorkerCaches();

    // Record the reload time so an immediate repeat failure stops the loop.
    setLastRetry(now);

    // Force a full reload (bypass SW cache).
    window.location.reload();

    // Return a never-resolving promise to prevent React from rendering
    // while the page is reloading.
    return new Promise<never>(() => {});
  }
}

/**
 * Wraps React.lazy() with the chunk-retry recovery described in
 * {@link importWithChunkRetry}.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() => importWithChunkRetry(importFn));
}
