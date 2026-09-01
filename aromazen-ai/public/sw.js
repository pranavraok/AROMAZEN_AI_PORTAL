const CACHE_NAME = 'aromazen-ai-v5';
const OFFLINE_URL = '/login';

const PRECACHE_ASSETS = [
  '/',
  '/login',
  '/workspace',
  '/manifest.json?v=5',
  '/aromazen-icon-192-v4.png',
  '/aromazen-icon-512-v4.png',
  '/aromazen-icon-maskable-512-v4.png',
  '/apple-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        // Fallback to offline page for navigation requests
        if (event.request.mode === 'navigate') {
          const offlineResponse = await caches.match(OFFLINE_URL);
          if (offlineResponse) return offlineResponse;
        }
        return new Response('Offline', { status: 503 });
      }
    })()
  );
});
