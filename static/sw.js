/**
 * CMaps — Service Worker
 * Provides offline caching for the PWA shell + static assets.
 * GeoJSON data and API calls use a network-first strategy.
 */
const CACHE_NAME = 'cmaps-v1';
const SHELL_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/utils.js',
    '/static/js/globe.js',
    '/static/js/panels.js',
    '/static/js/search.js',
    '/static/js/editor.js',
    '/static/js/history.js',
    '/static/js/context-menu.js',
    '/static/js/scale-bar.js',
    '/static/js/leaderboard.js',
    '/static/js/app.js',
    '/static/manifest.json',
];

// Pre-cache the app shell on install
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
    );
    self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch strategy: network-first for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // API calls & GeoJSON data — network first, fallback to cache
    if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.geojson')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Static assets — cache first, fallback to network
    if (url.pathname.startsWith('/static/')) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                });
            })
        );
        return;
    }

    // Everything else — network first
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
