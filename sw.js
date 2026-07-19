/*
 * Service worker för PWA:n. Strategi:
 *  - HTML-navigering: nätverk först (alltid färsk sida), cache som offline-reserv.
 *    Detta undviker också "gammal sida fastnar i cachen".
 *  - /api/*  (live-data): nätverk först, cache bara som reserv när offline.
 *  - /data/* (arkiv): stale-while-revalidate — snabbt och funkar offline.
 *  - Övrigt statiskt (js/ikoner/manifest): stale-while-revalidate.
 *  - Externa värdar (Blitzortung, SMHI via proxy sker på origin) rörs inte.
 */
const VERSION = "v1";
const SHELL = "shell-" + VERSION;
const DATA = "data-" + VERSION;
const SHELL_ASSETS = [
  "/", "/index.html", "/assets/charts.js", "/historik/", "/historik/index.html",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // externa resurser: låt gå direkt

  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  if (url.pathname.startsWith("/data/")) {
    e.respondWith(staleWhileRevalidate(req, DATA));
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(SHELL).then((c) => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req).then((m) => m || caches.match("/index.html")))
    );
    return;
  }
  e.respondWith(staleWhileRevalidate(req, SHELL));
});
