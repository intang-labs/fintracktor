/* Cache-first for the shell so the app opens offline. The version string is
   what makes a deploy take effect: bump it and the old cache is dropped. */
const VERSION = 'v1';
const CACHE = `fintracktor-${VERSION}`;
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/favicon.svg', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // Navigations go to the network first, so a deploy is picked up on the next
  // open rather than waiting for the cache to expire; the shell is the fallback.
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        (await caches.open(CACHE)).put('/index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) (await caches.open(CACHE)).put(request, fresh.clone());
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});
