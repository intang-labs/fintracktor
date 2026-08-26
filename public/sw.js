/* Offline support for a site with no build step.
   Bump VERSION to drop every cached response from an older release. */
const VERSION = 'v2';
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

const shellKey = request => (request.mode === 'navigate' ? '/index.html' : request);

/* The network decides what the code is; the cache is the offline fallback. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const key = shellKey(request);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(key, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(key)) || Response.error();
  }
}

/* Only for responses that cannot go stale in a way that matters. */
async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok) (await caches.open(CACHE)).put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Icons change only by changing name, so the cache is safe to trust.
  // Everything else is markup, code or styling, and serving a cached copy of
  // those pins an installed app to whatever shipped first: new HTML would run
  // against old JavaScript, which is how the Add/Total switch arrived dead.
  e.respondWith(url.pathname.startsWith('/icons/') ? cacheFirst(request) : networkFirst(request));
});
