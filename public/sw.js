const CACHE_NAME = 'saveitforl8r-v11';
const SCOPE = '/';

const PRECACHE_ASSETS = [
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
  SCOPE + 'icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching offline page');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting()) // Activate immediately to take control
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  // Respond to version check
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ 
        type: 'VERSION', 
        version: CACHE_NAME 
    });
  }
});

// Helper to save shared data to IndexedDB
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

    // Filter out empty files
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Share Target POST request
  if (url.pathname === '/share-target/' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Only handle requests within our scope
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // 1. Navigation requests (HTML): Stale-While-Revalidate (App Shell Pattern)
  // We always serve 'index.html' from cache, while updating it in the background.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(SCOPE + 'index.html').then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            // Check if valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // Clone ONCE for the cache
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME).then((cache) => {
              // Always update the canonical 'index.html' cache entry.
              // We do NOT cache the specific request URL (like /settings) because 
              // in an SPA, all routes serve the same index.html content.
              // This prevents cache bloat and "Response body already used" errors.
              cache.put(SCOPE + 'index.html', responseToCache);
            });
            
            return networkResponse;
          })
          .catch((err) => {
             console.log('[SW] Network fetch failed:', err);
             // CRITICAL: If we have no cached response, we must throw the error 
             // so the browser can handle the failure (e.g. show offline page/error).
             if (!cachedResponse) {
                 throw err;
             }
             // If we have a cached response, we swallow the error and return nothing 
             // (respondWith will use the cachedResponse).
          });

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 2. Hashed Assets (JS/CSS/Images with hash): Cache First
  // Vite assets in 'assets/' folder are hashed and immutable.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. Mutable Static Assets (manifest, icons, etc.): Stale-While-Revalidate
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
