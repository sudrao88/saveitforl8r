// Production service worker for l8rgram (M6).
//
// Strategy:
//   • Static assets (hashed /assets/* + app shell) → cache-first, then network.
//   • Navigations → network-first, falling back to the cached app shell offline.
//   • /api/* (proxy: enrich-photo, query-gallery, calendar) → network-first,
//     never served stale from cache (auth + freshness matter).
//
// Cache name is versioned per build (bump VERSION on each release) so a new
// deploy evicts the previous caches in `activate`. On native (Capacitor) the
// page unregisters the SW entirely — see index.html.

const VERSION = 'l8rgram-2026-06-02';
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API calls — always go to the network; never cache (auth/freshness).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Navigations — network-first so users get the latest shell; fall back to the
  // cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/index.html').then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  // Static assets — cache-first, then populate the cache on miss. Only same-
  // origin GETs are cached (skip opaque cross-origin responses).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (url.origin === self.location.origin && res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});
