// Service worker: versioned app-shell precache + stale-while-revalidate for data JSON
// (chapters, dictionary, … the user has opened stay readable offline).
// Bump VERSION whenever any shell file changes; old shell caches are deleted on activate.
const VERSION = '0.3.1-1';
const SHELL_CACHE = `il-shell-${VERSION}`;
const DATA_CACHE = 'il-data-v1'; // keep in sync with js/sw-names.js
// Caches of the removed whole-Bible download (設定 › 離線下載, ≤ 0.2.x): deleted on activate.
const OLD_PACK_CACHES = /^il-packs-/;

const SHELL = [
  './',
  'index.html',
  'config.js',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js', 'js/data.js', 'js/books.js', 'js/ref.js', 'js/morph.js', 'js/reader.js', 'js/sheet.js',
  'js/spring.js', 'js/wordcard.js', 'js/picker.js', 'js/home.js', 'js/search.js', 'js/search-sources.js', 'js/search-worker.js', 'js/normalize.js', 'js/views.js', 'js/settings.js',
  'js/notes.js', 'js/notesview.js', 'js/editor.js', 'js/syntax.js', 'js/util.js', 'js/sw-names.js', 'js/version.js',
  'fonts/ILGreek-Regular.woff2', 'fonts/ILGreek-Bold.woff2', 'fonts/ILHebrew-Regular.woff2', 'fonts/LICENSE',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];
const SHELL_URLS = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL.map(p => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if ((k.startsWith('il-shell-') && k !== SHELL_CACHE) || OLD_PACK_CACHES.test(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // navigations → cached shell (index.html), network fallback
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(SHELL_CACHE);
      return (await c.match('index.html')) || fetch(req);
    })());
    return;
  }
  const clean = url.origin + url.pathname;
  if (SHELL_URLS.has(clean)) {
    e.respondWith(caches.open(SHELL_CACHE).then(c => c.match(clean)).then(r => r || fetch(req)));
    return;
  }
  // data (chapters, dict, index, manifest, search text) → stale-while-revalidate
  if (url.pathname.endsWith('.json') || url.pathname.endsWith('.txt')) {
    e.respondWith(staleWhileRevalidate(e, req));
  }
});

async function staleWhileRevalidate(e, req) {
  const cache = await caches.open(DATA_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    e.waitUntil(net.catch(() => {}));
    return hit;
  }
  return net;
}
