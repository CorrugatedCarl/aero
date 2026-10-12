// sw.js — offline support for the Home Screen app: everything the game needs is cached on first
// launch, served from the cache afterwards and refreshed in the background (new versions show up
// on the next launch).

const CACHE = 'aero-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'ship.png',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/main.js', 'src/util.js', 'src/config.js', 'src/aero.js', 'src/terrain.js', 'src/aircraft.js',
  'src/sim.js', 'src/input.js', 'src/render.js', 'src/hud.js',
  'https://cdn.jsdelivr.net/npm/planck@1.5.0/dist/planck.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone()); // fonts arrive opaque
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
