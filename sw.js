const CACHE_NAME = 'autobahn-tool-v1';
const ASSETS_ZUM_SPEICHERN = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/wachenData.js',
    '/manifest.json',
    '/turf.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    '/Abschnitt.json',
    '/AbschnittBAB.json',
    '/BABKM.json',
    '/Gemeinden.json'
];

self.addEventListener('install', (ereignis) => {
    ereignis.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_ZUM_SPEICHERN);
        })
    );
});

self.addEventListener('fetch', (ereignis) => {
    // Cache First, Network Fallback
    ereignis.respondWith(
        caches.match(ereignis.request).then((zwischenspeicherAntwort) => {
            if (zwischenspeicherAntwort) {
                return zwischenspeicherAntwort;
            }
            return fetch(ereignis.request).then((netzwerkAntwort) => {
                // Optionale dynamische Speicherung für zukünftige Anfragen
                return caches.open(CACHE_NAME).then((cache) => {
                    cache.put(ereignis.request, netzwerkAntwort.clone());
                    return netzwerkAntwort;
                });
            });
        }).catch(() => {
            // Offline-Fallback, falls weder im Cache noch im Netz verfügbar
            console.error('Offline und Ressource nicht im Cache gefunden:', ereignis.request.url);
        })
    );
});

self.addEventListener('activate', (ereignis) => {
    const berechtigteCaches = [CACHE_NAME];
    ereignis.waitUntil(
        caches.keys().then((cacheNamen) => {
            return Promise.all(
                cacheNamen.map((cacheName) => {
                    if (!berechtigteCaches.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});