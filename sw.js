// Une version télécharge un ensemble cohérent, sans réutiliser le cache HTTP.
// Incrémenter VERSION à chaque publication de l'application.
const VERSION = '2026.11.03.6';
const CACHE = 'mkp-v7-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/store.js',
  'js/engine.js',
  'js/ui.js',
  'js/views.js',
  'js/gp.js',
  'js/views-admin.js',
  'js/draw.js',
  'js/race-visuals.js',
  'js/share.js',
  'js/updates.js',
  'manifest.webmanifest',
  'icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    // Migration de sécurité : ces anciennes versions réécrivent toute leur
    // mémoire lors de controllerchange. Ne PAS déclencher cet événement.
    // Le worker attendra la fermeture de leurs onglets avant de s'activer.
    const existing = await caches.keys();
    const unsafeLegacy = existing.some((name) =>
      name.startsWith('mkp-v5') || name.startsWith('mkp-v6') ||
      name === 'mkp-v7-2026.11.01.3' || name === 'mkp-v7-2026.11.02.1');
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (path) => {
      const canonical = new URL(path, self.registration.scope);
      const fresh = new URL(canonical);
      fresh.searchParams.set('__mkp_release', VERSION);
      const response = await fetch(fresh.href, { cache: 'reload' });
      if (!response.ok) throw new Error('Installation incomplète : ' + path);
      // Conserver la clé normale : les imports JS existants restent compatibles.
      await cache.put(canonical.href, response);
    }));
    // N'activer le nouveau worker qu'après le téléchargement de TOUS les fichiers.
    if (!unsafeLegacy) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('mkp-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Les liens CSS/JS versionnés et les imports sans query partagent le même cache.
    if (url.searchParams.get('v') === VERSION) url.search = '';
    const cached = await cache.match(url.href);
    if (cached) return cached;
    try {
      return await fetch(e.request);
    } catch (error) {
      // Ne jamais répondre avec du HTML à la place d'un module JavaScript.
      if (e.request.mode === 'navigate') {
        const index = await cache.match(new URL('index.html', scope).href);
        if (index) return index;
      }
      throw error;
    }
  })());
});
