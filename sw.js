const CACHE_NAME = 'qr-jar-label-v3';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// Install: cache degli asset base
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: pulizia vecchie cache
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (key) {
                    return key !== CACHE_NAME;
                }).map(function (key) {
                    return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch: network-first, fallback cache (garantisce aggiornamenti rapidi)
self.addEventListener('fetch', function (event) {
    event.respondWith(
        fetch(event.request).then(function (response) {
            // Aggiorna la cache con la risposta fresca
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
                cache.put(event.request, clone);
            });
            return response;
        }).catch(function () {
            return caches.match(event.request);
        })
    );
});
