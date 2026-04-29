// public/sw.js
const CACHE_NAME = 'saveitforl8r-v85'; // Increment version to force update
const STATIC_CACHE = 'saveitforl8r-static-v1';
const SCOPE = '/';

// Minimum number of static assets cached before considering app ready for offline use.
// A typical build produces ~15-20 hashed assets (JS chunks, CSS, fonts, images).
// 5 is a conservative floor ensuring critical bundles (main JS, vendor JS, CSS, etc.) are present.
const MIN_ASSETS_FOR_CACHE_READY = 5;

// Network timeout for fetch requests (milliseconds).
// On "lie-fi" (connected but unusable network), fetch() hangs indefinitely.
// After this timeout, the SW falls back to cache or returns an offline response,
// so the user can start using the app immediately.
const NETWORK_TIMEOUT_MS = 3000;

// Critical assets that MUST be cached for offline use
const PRECACHE_ASSETS = [
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
  SCOPE + 'icon.svg',
  SCOPE + 'version.json',
  SCOPE + 'splash.css',
  SCOPE + 'logo-full.svg',
  SCOPE + 'fonts/ShantellSans-Variable.woff2'
];

// Track if we're running in a native app context.
// Default false — client-side code sets this via SET_NATIVE_CONTEXT message
// using Capacitor.isNativePlatform() which is the authoritative source.
let nativeAppContext = false;

// Fetch with a timeout. Rejects with a TimeoutError if the network doesn't respond
// within the specified duration. This prevents "lie-fi" from hanging the app.
function fetchWithTimeout(request, timeoutMs = NETWORK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException('Network timeout', 'TimeoutError'));
    }, timeoutMs);

    fetch(request, { signal: controller.signal })
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

// Extract JS/CSS asset URLs from HTML to ensure they're cached before updating the shell.
function extractAssetUrls(html) {
  const urls = [];
  const pattern = /(?:src|href)=["'](\/assets\/[^"']+|\/[^"']+\.(?:js|css))["']/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    urls.push(match[1]);
  }
  return [...new Set(urls)];
}

self.addEventListener('install', (event) => {
  // Never auto-skipWaiting. The new SW waits until:
  // 1. The user explicitly clicks "Update" (sends SKIP_WAITING message), or
  // 2. All tabs using the old SW are closed and a new navigation occurs.
  // This prevents interrupting the user mid-session with a forced reload.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching critical assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(async () => {
        // After precaching index.html, also pre-fetch the JS/CSS bundles it references.
        // This prevents a gap where the new SW has a cached index.html referencing
        // new hashed bundles that aren't in STATIC_CACHE yet.
        try {
          const dynamicCache = await caches.open(CACHE_NAME);
          const indexResponse = await dynamicCache.match(SCOPE + 'index.html');
          if (!indexResponse) return;

          const html = await indexResponse.text();
          const assetUrls = extractAssetUrls(html);
          if (assetUrls.length === 0) return;

          const staticCache = await caches.open(STATIC_CACHE);
          const results = await Promise.allSettled(
            assetUrls.map(async (url) => {
              const existing = await staticCache.match(url);
              if (existing) return; // Already cached
              const resp = await fetchWithTimeout(url);
              if (resp.ok) await staticCache.put(url, resp);
            })
          );
          const fetched = results.filter(r => r.status === 'fulfilled').length;
          console.log(`[SW] Install: pre-fetched ${fetched}/${assetUrls.length} referenced assets`);
        } catch (err) {
          // Non-fatal: assets will be fetched on first navigation
          console.warn('[SW] Install: asset pre-fetch failed (non-fatal):', err);
        }
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Keep the static cache for hashed assets, clean up old dynamic caches
          if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  // Allow client-side code to inform the SW of native app context
  // using Capacitor.isNativePlatform() as the authoritative source.
  if (event.data && event.data.type === 'SET_NATIVE_CONTEXT') {
    nativeAppContext = !!event.data.isNative;
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    if (event.ports[0]) {
      event.ports[0].postMessage({
          type: 'VERSION',
          version: CACHE_NAME
      });
    }
  }

  // Precache all assets on demand for offline native app support
  if (event.data && event.data.type === 'PRECACHE_ALL') {
    event.waitUntil(
      precacheAllAssets().then(() => {
        if (event.ports[0]) {
          event.ports[0].postMessage({ type: 'PRECACHE_COMPLETE' });
        }
      })
    );
  }

  // Get cache status for UI display
  if (event.data && event.data.type === 'GET_CACHE_STATUS') {
    event.waitUntil(
      getCacheStatus().then((status) => {
        if (event.ports[0]) {
          event.ports[0].postMessage({ type: 'CACHE_STATUS', ...status });
        }
      })
    );
  }
});

// Precache function for native apps - downloads all assets for full offline support
async function precacheAllAssets() {
  console.log('[SW] Starting full precache for offline support');

  try {
    const cache = await caches.open(STATIC_CACHE);

    // Fetch the index.html to find all asset references
    const indexResponse = await fetch('/index.html', { cache: 'no-store' });
    const html = await indexResponse.text();

    // Cache the fresh index.html
    await caches.open(CACHE_NAME).then(c =>
      c.put('/index.html', new Response(html, {
        headers: { 'Content-Type': 'text/html' }
      }))
    );

    // Extract asset URLs from the HTML (JS, CSS, fonts, images)
    const assetPatterns = [
      /(?:src|href)=["']([^"']+\.(?:js|css|woff2?|ttf|png|svg|jpg|jpeg|webp|ico))["']/gi,
      /url\(["']?([^"')]+\.(?:woff2?|ttf|png|svg|jpg|jpeg|webp))["']?\)/gi
    ];

    const assets = new Set();

    for (const pattern of assetPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const asset = match[1];
        if (asset.startsWith('/') || asset.startsWith('http')) {
          // Keep full URLs for external assets (CDN etc.) so they can be fetched correctly.
          // Only convert relative paths to absolute; leave absolute URLs as-is.
          assets.add(asset);
        }
      }
    }

    // Also try to fetch the Vite manifest if it exists
    try {
      const manifestResponse = await fetch('/.vite/manifest.json');
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        Object.values(manifest).forEach(entry => {
          if (entry.file) assets.add('/' + entry.file);
          if (entry.css) entry.css.forEach(css => assets.add('/' + css));
        });
      }
    } catch (e) {
      // Manifest may not exist in all builds
    }

    // Cache all discovered assets
    const results = await Promise.allSettled(
      Array.from(assets).map(async (asset) => {
        try {
          // Skip already cached assets
          const existing = await cache.match(asset);
          if (existing) return { asset, status: 'cached' };

          const response = await fetch(asset, { cache: 'no-store' });
          if (response.ok) {
            await cache.put(asset, response);
            return { asset, status: 'downloaded' };
          }
          return { asset, status: 'failed', error: response.status };
        } catch (e) {
          return { asset, status: 'failed', error: e.message };
        }
      })
    );

    const downloaded = results.filter(r => r.value?.status === 'downloaded').length;
    const cached = results.filter(r => r.value?.status === 'cached').length;
    const failed = results.filter(r => r.value?.status === 'failed').length;

    console.log(`[SW] Precache complete: ${downloaded} downloaded, ${cached} already cached, ${failed} failed`);

    return { downloaded, cached, failed, total: assets.size };
  } catch (e) {
    console.error('[SW] Precache error:', e);
    throw e;
  }
}

// Get cache status for display in UI
async function getCacheStatus() {
  try {
    const dynamicCache = await caches.open(CACHE_NAME);
    const staticCache = await caches.open(STATIC_CACHE);

    const dynamicKeys = await dynamicCache.keys();
    const staticKeys = await staticCache.keys();

    // Estimate total cache size
    let totalSize = 0;
    for (const request of [...dynamicKeys, ...staticKeys]) {
      const response = await caches.match(request);
      if (response) {
        const blob = await response.clone().blob();
        totalSize += blob.size;
      }
    }

    return {
      dynamicCacheCount: dynamicKeys.length,
      staticCacheCount: staticKeys.length,
      totalCacheCount: dynamicKeys.length + staticKeys.length,
      estimatedSize: totalSize,
      ready: staticKeys.length > MIN_ASSETS_FOR_CACHE_READY
    };
  } catch (e) {
    return { ready: false, error: e.message };
  }
}

function saveShareData(data) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('saveitforl8r-share', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('shares')) {
        db.createObjectStore('shares', { autoIncrement: true });
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('shares', 'readwrite');
      const store = tx.objectStore('shares');
      store.put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const mediaFiles = formData.getAll('media');

    const validFiles = mediaFiles.filter(f => f.size > 0);

    const shareData = {
      title,
      text,
      url,
      timestamp: Date.now(),
      files: validFiles
    };

    await saveShareData(shareData);

    return Response.redirect('/?share-target=true', 303);
  } catch (err) {
    console.error('[SW] Share target error:', err);
    return Response.redirect('/', 303);
  }
}

// Background Sync Logic
self.addEventListener('sync', (event) => {
  if (event.tag === 'enrich-memory') {
    event.waitUntil(processEnrichQueue());
  }
  if (event.tag === 'sync-drive') {
    event.waitUntil(processDriveSyncQueue());
  }
});

// ─── Background Sync IndexedDB Helpers ───────────────────────────────
// These operate on the 'saveitforl8r-bg-sync' DB (separate from SaveItForL8rDB).

function openBgSyncDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('saveitforl8r-bg-sync', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('operations')) {
        db.createObjectStore('operations', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllOperations(db, type) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('operations', 'readonly');
      const store = tx.objectStore('operations');
      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result || [];
        resolve(all.filter(op => op.type === type));
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

function removeOperation(db, id) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('operations', 'readwrite');
      const store = tx.objectStore('operations');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function processEnrichQueue() {
  console.log('[SW] Background Sync: processing enrich queue');
  try {
    const db = await openBgSyncDB();
    const operations = await getAllOperations(db, 'enrich');

    if (operations.length === 0) {
      console.log('[SW] Background Sync: no enrich operations pending');
      db.close();
      return;
    }

    let processed = 0;
    for (const op of operations) {
      try {
        const { path, body, token } = op.payload;
        if (!path || !body) {
          console.warn('[SW] Background Sync: skipping malformed enrich operation', op.id);
          await removeOperation(db, op.id);
          processed++;
          continue;
        }

        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(path, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (response.ok) {
          await removeOperation(db, op.id);
          processed++;
        } else {
          console.warn(`[SW] Background Sync: enrich request failed with status ${response.status}`);
          // Leave in queue for retry on non-2xx
        }
      } catch (err) {
        console.warn('[SW] Background Sync: enrich fetch failed, will retry later:', err.message);
        // Leave in queue — Background Sync will retry
      }
    }

    console.log(`[SW] Background Sync: processed ${processed}/${operations.length} enrich operations`);
    db.close();
  } catch (err) {
    console.error('[SW] Background Sync: failed to process enrich queue:', err);
    throw err; // Re-throw so the browser knows to retry the sync event
  }
}

async function processDriveSyncQueue() {
  console.log('[SW] Background Sync: processing drive sync queue');
  try {
    const db = await openBgSyncDB();
    const operations = await getAllOperations(db, 'sync-drive');

    if (operations.length === 0) {
      console.log('[SW] Background Sync: no drive sync operations pending');
      db.close();
      return;
    }

    // Drive uploads require Google OAuth tokens and the full Drive API,
    // which are only available in the foreground app context. Notify any
    // active clients so they can drain the queue with proper auth.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      for (const client of clients) {
        client.postMessage({
          type: 'DRIVE_SYNC_PENDING',
          count: operations.length,
        });
      }
      console.log(`[SW] Background Sync: notified ${clients.length} client(s) of ${operations.length} pending drive sync operations`);
    } else {
      console.log(`[SW] Background Sync: ${operations.length} drive sync operations pending, waiting for foreground`);
      // Throw to signal the browser to retry the sync event later
      throw new Error('No active clients to process drive sync');
    }

    db.close();
  } catch (err) {
    console.error('[SW] Background Sync: failed to process drive sync queue:', err);
  }
}

async function handleFullSync() {
  try {
    // Check if any client tabs are open — if so, let the app handle it
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
    if (clients.length > 0) {
      console.log('[SW] Periodic full-sync: active tab found, deferring to app');
      return;
    }

    // Open the main app IndexedDB to check for pending enrichments
    const db = await openNotificationDB();
    if (!db) {
      console.log('[SW] Periodic full-sync: could not open DB');
      return;
    }

    const memories = await getAllFromStore(db, 'memories');
    db.close();

    const pendingCount = memories.filter(m => m.isPending === true).length;
    const totalCount = memories.length;

    if (pendingCount > 0) {
      // SW cannot easily obtain auth tokens for re-enrichment.
      // Log for diagnostics; the app will handle recovery on next open.
      console.log(`[SW] Periodic full-sync: found ${pendingCount} pending enrichments — app will recover on next open`);
    }

    console.log(`[SW] Periodic full-sync: found ${pendingCount} pending enrichments, ${totalCount} total memories`);
  } catch (err) {
    console.error('[SW] Periodic full-sync error:', err);
  }
}


self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/share-target/' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  if (event.request.mode === 'navigate') {
    // Cache-first for navigation: serve cached shell instantly, revalidate in background.
    // This ensures the app launches immediately on slow/offline networks.
    // Always fetch the canonical app shell URL to prevent cache poisoning —
    // arbitrary navigation URLs must never overwrite the cached index.html.
    const shellUrl = SCOPE + 'index.html';

    // Defer background revalidation by 3 seconds so it doesn't compete
    // with the app's JS/CSS chunk downloads during initial page load.
    // The cached shell is still served instantly via event.respondWith below.
    const backgroundRevalidation = new Promise(resolve => setTimeout(resolve, 3000))
      .then(() => fetchWithTimeout(shellUrl))
      .then(async (networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          // Before caching new HTML, ensure its referenced assets are also cached.
          // Otherwise, an offline reload would serve an HTML shell referencing
          // uncached JS/CSS bundles — causing a white screen.
          const html = await networkResponse.clone().text();
          const assetUrls = extractAssetUrls(html);

          // Check which assets are missing from cache (parallel for performance)
          const staticCache = await caches.open(STATIC_CACHE);
          const cacheChecks = await Promise.all(
            assetUrls.map(async (url) => ({ url, cached: !!(await staticCache.match(url)) }))
          );
          const missingAssets = cacheChecks.filter(c => !c.cached).map(c => c.url);

          if (missingAssets.length > 0) {
            console.log(`[SW] New index.html references ${missingAssets.length} uncached assets, pre-fetching...`);
            const results = await Promise.allSettled(
              missingAssets.map(async (assetUrl) => {
                const resp = await fetchWithTimeout(assetUrl);
                if (resp.ok) {
                  await staticCache.put(assetUrl, resp);
                  return 'ok';
                }
                throw new Error(`${resp.status}`);
              })
            );
            const failed = results.filter(r => r.status === 'rejected').length;
            if (failed > 0) {
              console.warn(`[SW] ${failed} assets failed to pre-fetch, keeping old cached index.html`);
              return; // Don't update index.html if critical assets are missing
            }
          }

          return caches.open(CACHE_NAME).then((cache) => {
            return cache.put(shellUrl, networkResponse.clone());
          });
        }
      })
      .catch((err) => {
        console.log('[SW] Background revalidation failed:', err);
      });

    // Keep SW alive until background revalidation completes
    event.waitUntil(backgroundRevalidation);

    event.respondWith(
      caches.match(shellUrl).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        // No cache yet (first install) — must wait for network
        return backgroundRevalidation.then(() => {
          return caches.match(shellUrl);
        }).then((response) => {
          return response || new Response('Offline — please connect to the internet for initial setup.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
    );
    return;
  }

  // Static assets (JS/CSS bundles with hashed filenames) - cache-first strategy
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetchWithTimeout(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch((err) => {
          console.error('[SW] Asset fetch failed (offline?):', event.request.url, err);
          // Use the correct MIME type so the browser treats the response
          // as a valid module/stylesheet instead of rejecting it outright
          // with "Importing a module script failed".
          // Parse the pathname to ignore query parameters (e.g. ?v=123).
          const pathname = new URL(event.request.url).pathname;
          const contentType = pathname.endsWith('.css')
            ? 'text/css'
            : (pathname.endsWith('.js') || pathname.endsWith('.mjs'))
              ? 'application/javascript'
              : 'text/plain';
          return new Response('/* offline — asset unavailable */', {
            status: 503,
            headers: { 'Content-Type': contentType }
          });
        });
      })
    );
    return;
  }

  // Font files - cache-first (immutable content, self-hosted)
  if (url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            const cachePromise = caches.open(STATIC_CACHE).then((cache) => {
              return cache.put(event.request, responseToCache);
            });
            event.waitUntil(cachePromise);
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetchWithTimeout(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(err => {
         console.log('[SW] Fetch failed for SWR:', err);
         // If we have a cached version, it was already returned above.
         // If not, return a proper offline response instead of undefined.
         return cachedResponse || new Response('', {
           status: 503,
           headers: { 'Content-Type': 'text/plain' }
         });
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// ─── Periodic Sync: Morning Briefing (PWA, Chrome only) ─────────────
// Best-effort daily notification check. Chrome controls actual timing.
// Falls back to on-open check in notificationService.ts for other browsers.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'morning-briefing-check') {
    event.waitUntil(handleMorningBriefingCheck());
  }
  if (event.tag === 'full-sync') {
    event.waitUntil(handleFullSync());
  }
});

async function handleMorningBriefingCheck() {
  try {
    // Check if any client (tab) is currently open — if so, let the app handle it
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
    if (clients.length > 0) return;

    // Open IndexedDB to check for today's events and todos
    const db = await openNotificationDB();
    if (!db) return;

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Check calendar events
    const events = await getAllFromStore(db, 'calendarEvents');
    const todayEvents = events.filter(e => {
      if (e.isDeleted || e.status === 'cancelled') return false;
      const dateKey = (e.occurrenceDate || e.startDate || '').slice(0, 10);
      return dateKey === todayKey;
    });

    // Check todo items
    const todos = await getAllFromStore(db, 'todoItems');
    const todayTodos = todos.filter(item => {
      if (item.isDeleted || item.isCompleted || item.isDismissed) return false;
      if (item.deadline) return item.deadline.slice(0, 10) === todayKey;
      return true; // No deadline counts for today
    });

    db.close();

    if (todayEvents.length === 0 && todayTodos.length === 0) return;

    const parts = [];
    if (todayEvents.length > 0) parts.push(`${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''}`);
    if (todayTodos.length > 0) parts.push(`${todayTodos.length} task${todayTodos.length !== 1 ? 's' : ''}`);
    const body = `You have ${parts.join(' and ')} today`;

    await self.registration.showNotification("Good morning! Here's your day", {
      body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: 'morning-briefing', // Replaces existing notification with same tag
    });
  } catch (err) {
    console.error('[SW] Morning briefing check error:', err);
  }
}

function openNotificationDB() {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open('SaveItForL8rDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

// Handle notification click in SW context (PWA)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route;
  const targetUrl = route ? `/?route=${encodeURIComponent(route)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window and navigate if available
      for (const client of clientList) {
        if ('focus' in client) {
          if (route && 'navigate' in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open new window with route
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
