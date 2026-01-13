const CACHE_NAME = 'saveitforl8r-v1';
const SCOPE = '/';

const PRECACHE_ASSETS = [
  SCOPE,
  SCOPE + 'index.html',
  SCOPE + 'manifest.json',
  SCOPE + 'icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
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

self.addEventListener('fetch', (event) => {
  // Only handle requests within our scope
  // For root scope, we generally want to handle everything from same origin
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Navigation requests: return index.html (App Shell)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(SCOPE + 'index.html').then((response) => {
        return response || fetch(event.request).catch(() => {
           return caches.match(SCOPE + 'index.html');
        });
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
