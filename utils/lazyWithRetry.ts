import { lazy, ComponentType } from 'react';

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
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const hasRefreshed = sessionStorage.getItem('chunk_retry_refresh');

    try {
      return await importFn();
    } catch (error) {
      // If we already refreshed once this session and it still fails,
      // let the error propagate to the ErrorBoundary.
      if (hasRefreshed) {
        sessionStorage.removeItem('chunk_retry_refresh');
        throw error;
      }

      console.warn('[lazyWithRetry] Dynamic import failed, clearing caches and reloading:', error);

      // Clear all service worker caches so the next load gets fresh assets
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

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
