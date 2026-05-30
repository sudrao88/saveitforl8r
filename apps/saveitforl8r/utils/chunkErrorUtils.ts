/**
 * Shared utilities for detecting and recovering from stale chunk / module
 * import failures caused by service worker cache mismatches after deployment.
 */

/**
 * Returns true if the error looks like a failed dynamic import due to
 * stale cached assets (e.g. old hashed chunk URLs that no longer exist).
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('is not a valid javascript mime type')
  );
}

/**
 * Best-effort clearing of all service worker caches.
 * Silently swallows errors so callers can proceed with a reload regardless.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Cache API may be unavailable (e.g. opaque origin, private browsing) —
    // proceed without clearing; the reload alone may still help.
  }
}
