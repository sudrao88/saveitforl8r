// public/sw.js
const CACHE_NAME = 'saveitforl8r-v24'; // Increment version to force update
const STATIC_CACHE = 'saveitforl8r-static-v1';
const SCOPE = '/';

// Minimum number of static assets cached before considering app ready for offline use.
// A typical build produces ~15-20 hashed assets (JS chunks, CSS, fonts, images).
// 5 is a conservative floor ensuring critical bundles (main JS, vendor JS, CSS, etc.) are present.
const MIN_ASSETS_FOR_CACHE_READY = 5;

// Critical assets that MUST be cached for offline use
const PRECACHE_ASSETS = [
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
  SCOPE + 'icon.svg',
  SCOPE + 'version.json'
];

// Track if we're running in a native app context.
// Default false — client-side code sets this via SET_NATIVE_CONTEXT message
// using Capacitor.isNativePlatform() which is the authoritative source.
let nativeAppContext = false;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching critical assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        // In native app context, don't auto-skip - let user control updates
        // In web context, skip waiting for seamless updates
        if (!nativeAppContext) {
          return self.skipWaiting();
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
    event.ports[0].postMessage({
        type: 'VERSION',
        version: CACHE_NAME
    });
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
});

// Mock function to process queue - in a real PWA this would read from IndexedDB
// and call the API. Since the actual enrichment logic is in the React app (Gemini Service),
// we can't easily move it all to SW without duplicating a lot of code/dependencies.
// However, standard browser behavior will keep the Promise in createMemory alive 
// for a short while even if backgrounded. True background execution requires 
// Background Sync API + moving logic here, which is complex for this architecture.
async function processEnrichQueue() {
   console.log('[SW] Background sync triggered (placeholder)');
   // Real implementation would require moving geminiService logic here
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
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(SCOPE + 'index.html', responseToCache);
          });
          return networkResponse;
        })
        .catch((err) => {
           console.log('[SW] Network fetch failed, falling back to cache:', err);
           return caches.match(SCOPE + 'index.html');
        })
    );
    return;
  }

  // Static assets (JS/CSS bundles with hashed filenames) - cache-first strategy
  // Use STATIC_CACHE for long-term storage since these files are immutable
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            // Use STATIC_CACHE for hashed assets (they never change)
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(err => {
         console.log('[SW] Fetch failed for SWR:', err);
      });

      return cachedResponse || fetchPromise;
    })
  );
});
