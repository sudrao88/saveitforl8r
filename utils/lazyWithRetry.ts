import { lazy, ComponentType } from 'react';
import { isChunkLoadError, clearServiceWorkerCaches } from './chunkErrorUtils';

/**
 * Wraps React.lazy() with retry logic for failed dynamic imports.
 *
 * After a new deployment, the service worker may serve a cached index.html
 * that references old hashed JS chunks which no longer exist on the server.
 * When the browser tries to import these stale chunk URLs, it gets a 404
 * and throws "Importing a module script failed."
 *
 * This wrapper catches that failure, clears all service worker caches so
 * the next navigation gets a fresh index.html, and reloads the page.
 *
 * Only chunk/module loading errors trigger the retry — syntax errors and
 * other runtime exceptions propagate immediately to the ErrorBoundary.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const hasRefreshed = sessionStorage.getItem('chunk_retry_refresh');

    try {
      return await importFn();
    } catch (error) {
      // Only attempt cache-clear + reload for chunk loading errors.
      // Syntax errors, runtime errors, etc. should propagate immediately.
      if (!isChunkLoadError(error)) {
        throw error;
      }

      // If we already refreshed once this session and it still fails,
      // let the error propagate to the ErrorBoundary.
      if (hasRefreshed) {
        sessionStorage.removeItem('chunk_retry_refresh');
        throw error;
      }

      console.warn('[lazyWithRetry] Chunk load failed, clearing caches and reloading:', error);

      // Clear all service worker caches so the next load gets fresh assets
      await clearServiceWorkerCaches();

      // Mark that we're about to refresh so we don't loop forever
      sessionStorage.setItem('chunk_retry_refresh', '1');

      // Force a full reload (bypass SW cache)
      window.location.reload();

      // Return a never-resolving promise to prevent React from rendering
      // while the page is reloading.
      return new Promise<never>(() => {});
    }
  });
}
