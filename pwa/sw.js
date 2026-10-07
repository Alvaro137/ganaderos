// Service Worker para Ganaderos Campo (Offline-First)
const CACHE_NAME = "ganaderos-campo-v28";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon.ico",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./css/app.css",
  "./js/sql-wasm.js",
  "./js/sql-wasm.wasm",
  "./js/db_client.js",
  "./js/app.js",
  "./js/modules/config.js",
  "./js/modules/auth.js",
  "./js/modules/api.js",
  "./js/modules/db.js",
  "./js/modules/outbox.js",
  "./js/modules/voice.js",
  "./js/modules/views/cattle_view.js",
  "./js/modules/views/detail_view.js",
  "./js/modules/views/birth_modal.js",
  "./js/modules/views/sanitary_view.js",
  "./js/modules/views/feeds_view.js",
  "./js/modules/views/movements_view.js",
  "./js/modules/views/assistant_view.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Cacheando archivos estáticos...");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Peticiones no-GET (como POST /api/ai/query) o a endpoints /api/ van directo a la red
  if (event.request.method !== "GET" || event.request.url.includes("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Estrategia: Cache First, fallback a Network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});
