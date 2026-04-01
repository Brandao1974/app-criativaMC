const CACHE_NAME = "gestao-obras-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./dashboard.html",
  "./obras.html",
  "./obras-detalhe.html",
  "./caixa.html",
  "./agenda.html",
  "./css/style.css",
  "./js/auth.js",
  "./js/dashboard.js",
  "./js/obras.js",
  "./js/caixa.js",
  "./js/agenda.js",
  "./js/pwa.js",
  "./manifest.json",
  "./images/apple-touch-icon.png",
  "./images/favicon.ico",
  "./images/favicon.svg",
  "./images/favicon-96x96.png",
  "./images/web-app-manifest-192x192.png",
  "./images/web-app-manifest-512x512.png",
  "https://cdn.jsdelivr.net/npm/chart.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
        .then(response => response || caches.match("./index.html"))
    );
    return;
  }

  if (
    requestUrl.origin !== self.location.origin &&
    requestUrl.origin !== "https://cdn.jsdelivr.net"
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        return networkResponse;
      });
    })
  );
});
