// Service worker: versioned app-shell precache + stale-while-revalidate for data JSON
// (chapters, dictionary, … the user has opened stay readable offline) + cache-first for the
// search index (sidx/…?v=<hash>: immutable per build; only files a search fetched are kept).
// Bump VERSION whenever any shell file changes; old shell caches are deleted on activate.
const VERSION = '0.5.4-1';
const SHELL_CACHE = `il-shell-${VERSION}`;
const DATA_CACHE = 'il-data-v1'; // keep in sync with js/sw-names.js
// Pronunciation engine (tts/*): not precached; the app stores it here when the user agrees to download
// (js/speech.js). Served cache-first; kept across shell updates, dropped only when the engine version changes
// (activate deletes every other il-tts-*, e.g. il-tts-v1 of the earlier engine).
const TTS_CACHE = 'il-tts-v2'; // keep in sync with js/tts-info.js (tools/build-tts.mjs)
const SIDX_PREFIX = 'il-sidx-'; // + index hash; caches of other hashes are dropped when a new one is used
// Caches of the removed whole-Bible download (設定 › 離線下載, ≤ 0.2.x): deleted on activate.
const OLD_PACK_CACHES = /^il-packs-/;

const SHELL = [
  './',
  'index.html',
  'config.js',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js', 'js/data.js', 'js/books.js', 'js/ref.js', 'js/morph.js', 'js/reader.js', 'js/sheet.js',
  'js/spring.js', 'js/wordcard.js', 'js/picker.js', 'js/home.js', 'js/search.js', 'js/search-sources.js', 'js/search-worker.js', 'js/search-index.js', 'js/normalize.js', 'js/views.js', 'js/settings.js',
  'js/notes.js', 'js/notesview.js', 'js/editor.js', 'js/syntax.js', 'js/util.js', 'js/sw-names.js', 'js/version.js', 'js/icons.js', 'js/tour.js', 'js/primer.js', 'js/primer-data.js', 'js/editions.js',
  'js/zh.js', 'js/zh/t2s.json', 'js/zh/s2t.json',
  'js/speech.js', 'js/speech-text.js', 'js/shot.js', 'js/tts-info.js', 'js/tts-model.js', 'js/tts-worker.js',
  'fonts/ILGreek-Regular.woff2', 'fonts/ILGreek-Bold.woff2', 'fonts/ILHebrew-Regular.woff2', 'fonts/LICENSE',
  'icons/in-christ.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.svg', 'icons/favicon-32.png',
];
const SHELL_URLS = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));
const TTS_BASE = new URL('tts/', self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL.map(p => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if ((k.startsWith('il-shell-') && k !== SHELL_CACHE) || (k.startsWith('il-tts-') && k !== TTS_CACHE) || OLD_PACK_CACHES.test(k)) await caches.delete(k);
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
  if (url.href.startsWith(TTS_BASE)) {
    e.respondWith(caches.open(TTS_CACHE).then(c => c.match(clean)).then(r => r || fetch(req)));
    return;
  }
  if (SHELL_URLS.has(clean)) {
    e.respondWith(caches.open(SHELL_CACHE).then(c => c.match(clean)).then(r => r || fetch(req)));
    return;
  }
  // 今日晨興聖言經文（每天更新）→ network-first，離線用快取
  if (url.pathname.endsWith('/morning-revival.json')) {
    e.respondWith(networkFirst(e, req));
    return;
  }
  // search index (immutable for a given ?v=hash) → cache-first
  const hash = url.searchParams.get('v');
  if (hash && /^[0-9a-f]{6,40}$/.test(hash) && url.pathname.includes('/sidx/')) {
    e.respondWith(cacheFirst(e, req, SIDX_PREFIX + hash));
    return;
  }
  // data (chapters, dict, index, manifest, search text) → stale-while-revalidate
  if (url.pathname.endsWith('.json') || url.pathname.endsWith('.txt')) {
    e.respondWith(staleWhileRevalidate(e, req));
  }
});

async function networkFirst(e, req) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

let sidxCurrent = '';
async function cacheFirst(e, req, name) {
  if (name !== sidxCurrent) { // a new index build: forget the files of older ones
    sidxCurrent = name;
    e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(SIDX_PREFIX) && k !== name).map(k => caches.delete(k)))));
  }
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
  return res;
}

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
