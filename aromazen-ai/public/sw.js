const CACHE_NAME = 'aromazen-ai-v7';

const PRECACHE_ASSETS = [
  '/manifest.json?v=7',
  '/aromazen-icon-192-v5.png',
  '/aromazen-icon-512-v5.png',
  '/aromazen-icon-maskable-512-v5.png',
  '/apple-icon-v5.png',
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
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated pages, API data, RSC payloads, or route responses.
  // Installed iOS apps must always receive the current deployment and account data.
  const isStaticAsset = url.pathname.startsWith('/_next/static/')
    || /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) return cachedResponse;
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok && networkResponse.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  })());
});
