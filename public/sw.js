const CACHE_NAME = 'saveitforl8r-v6';
const SCOPE = '/';

const PRECACHE_ASSETS = [
  SCOPE,
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

    // Filter out empty files (sometimes sent by Android even if no file selected)
    const validFiles = mediaFiles.filter(f => f.size > 0);

    const shareData = {
      title,
      text,
      url,
      timestamp: Date.now(),
      files: validFiles // We'll store the File objects (Blobs) directly
    };

    await saveShareData(shareData);

    // Redirect to the app with a query param indicating a share occurred
    return Response.redirect('/?share-target=true', 303);
  } catch (err) {
    console.error('[SW] Share target error:', err);
    // Fallback to home if something fails
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

  // Navigation requests: Network First, fallback to Cache (App Shell)
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
