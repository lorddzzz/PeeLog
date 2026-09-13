// PeeLog service worker. Must sit at the repo root so its scope covers the
// whole app. Bump CACHE on every deploy that changes a precached file.
const CACHE = 'peelog-shell-v5';

const SHELL = [
  './',
  'index.html',
  'app.css',
  'js/app.js',
  'js/selftest.js',
  'js/store.js',
  'js/model.js',
  'js/ui.js',
  'js/tonight.js',
  'js/cards.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png',
  'icons/favicon-32.png',
  'assets/icons.svg',
  'assets/art/bedtime-moon.jpg',
  'assets/art/bedside-notebook.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Stale-while-revalidate: serve from cache instantly and always succeed
// offline, then refresh in the background so the next launch is current.
// A network-first shell would stall on a flaky connection at 3am, which is
// exactly when the app must open.
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });

    const network = fetch(request).then(res => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    }).catch(() => null);

    if (cached) return cached;

    const res = await network;
    if (res) return res;

    // Offline with a cold cache: a navigation still gets the shell.
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
