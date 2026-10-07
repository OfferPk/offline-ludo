/* Offline shell cache for the static web demo. Bump CACHE_NAME when changing cache behavior. */
'use strict';

const CACHE_PREFIX = 'crossfour-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './icon.png',
  './css/style.css',
  './css/ludo-chess-discovery.css',
  './js/ads-config.js',
  './js/adgate.js',
  './js/ads.js',
  './js/logic.js',
  './js/sound.js',
  './js/themes.js',
  './js/token-evolution.js',
  './js/skin-shop.js',
  './js/art.js',
  './js/save-store.js',
  './js/dice-gesture.js',
  './js/path-animation.js',
  './js/celebration.js',
  './js/game.js',
  './js/community-fixtures.js',
  './js/community.js',
  './js/supabase-config.js',
  './js/chess.js',
  './js/online.js',
  './js/ludo-chess-discovery.js'
];
const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'worker', 'sharedworker', 'manifest']);

function cacheKey(url) {
  const key = new URL(url, self.registration.scope);
  key.search = '';
  key.hash = '';
  return key.href;
}

function isBackendPath(pathname, scopePath) {
  const relativePath = pathname.slice(scopePath.length);
  return /(?:^|\/)(?:auth|rest|storage|realtime|functions)(?:\/|$)/i.test(relativePath);
}

function canCache(request) {
  if (request.method !== 'GET' || request.headers.has('authorization')) return false;
  if (request.mode !== 'navigate' && !STATIC_DESTINATIONS.has(request.destination)) return false;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname) && !isBackendPath(url.pathname, scope.pathname);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const urls = SHELL_ASSETS.map(asset => cacheKey(new URL(asset, self.registration.scope).href));
    await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!canCache(request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const key = cacheKey(request.url);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      const cacheControl = response.headers.get('Cache-Control') || '';
      if (response.status === 200 && response.type === 'basic' && !/\b(?:no-store|private)\b/i.test(cacheControl)) {
        await cache.put(key, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(key);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const home = await cache.match(new URL('./index.html', self.registration.scope).href);
        if (home) return home;
      }
      throw error;
    }
  })());
});
