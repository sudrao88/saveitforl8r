const CACHE_NAME = 'saveitforl8r-v6';
const SCOPE = '/';

const PRECACHE_ASSETS = [
  SCOPE,
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
  SCOPE + 'icon.svg'
];

self.addEventListener('install', (event) => {
  // Removed self.skipWaiting() to allow user to choose when to update
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching offline page');
        return cache.addAll(PRECACHE_ASSETS);
      })
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
});

self.addEventListener('fetch', (event) => {
  // Only handle requests within our scope
  // For root scope, we generally want to handle everything from same origin
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Navigation requests: Network First, fallback to Cache (App Shell)
  // This ensures that if the user reloads the page (fresh load), they always get the latest index.html from the server
  // The update prompt in the UI is a manual intervention for users who have the app open and need to update to the latest version without reloading manually first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Check if we received a valid response
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(SCOPE + 'index.html', responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
           console.log('[SW] Offline, serving cached index.html');
           return caches.match(SCOPE + 'index.html');
        })
    );
    return;
  }

  // Other requests: Cache First, fallback to Network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache new resources (js, css, images)
        // Ensure we only cache valid responses and valid types (basic = same origin)
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
});
