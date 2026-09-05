const CACHE_NAME = "party-arcade-shell-v1";
const PRECACHE_URLS = ["/play.html", "/manifest.json", "/icons/apple-touch-icon.png", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Static-shell-only: cache-first for same-origin GET requests to the app's own build
// output (hashed JS/CSS bundles, images, fonts) plus the precached shell files above.
// This is a real-time multiplayer app — a service worker that ever served a stale
// WebSocket handshake or cached game state would be a real bug, not a safety margin — so
// this explicitly bails on any non-GET request, any cross-origin request, and anything
// whose path contains "/ws", on top of the fact that WebSocket upgrades never go through
// fetch at all.
const CACHEABLE_EXT = /\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?|ico)$/;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/ws")) return;
  if (!CACHEABLE_EXT.test(url.pathname) && !PRECACHE_URLS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});
