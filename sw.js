const CACHE = 'dossier-competences-v1';
const FILES = ['./','index.html','style.css','app.js','jszip.min.js','manifest.webmanifest',
  'icon-192.png','icon-512.png','icon-maskable-512.png',
  'atkinson-hyperlegible-latin-400-normal.woff2','atkinson-hyperlegible-latin-700-normal.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const key = e.request.mode === 'navigate' ? './' : e.request;
  e.respondWith(caches.match(key, {ignoreSearch: true}).then(hit => hit || fetch(e.request)));
});
