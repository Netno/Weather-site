/*
 * Service worker för PWA:n. Strategi:
 *  - HTML-navigering: nätverk först (alltid färsk sida), cache som offline-reserv.
 *    Detta undviker också "gammal sida fastnar i cachen".
 *  - /api/*  (live-data): nätverk först, cache bara som reserv när offline.
 *  - /data/* (arkiv): stale-while-revalidate — snabbt och funkar offline.
 *  - Övrigt statiskt (js/ikoner/manifest): stale-while-revalidate.
 *  - Externa värdar (Blitzortung, SMHI via proxy sker på origin) rörs inte.
 */
const VERSION = "v13";
const SHELL = "shell-" + VERSION;
const DATA = "data-" + VERSION;
const SHELL_ASSETS = [
  "/", "/index.html", "/assets/i18n.js?v=1", "/assets/i18n-live.js?v=1", "/assets/i18n-hist.js?v=4", "/assets/charts.js?v=8", "/historik/", "/historik/index.html",
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

// Stationens år, inte besökarens tidszon
function stationYear() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date()).slice(0, 4);
}
// Filer som fylls på löpande → nätverk först, cache bara som offline-reserv
function growingArchive(pathname) {
  if (pathname.endsWith("manifest.json")) return true;
  if (pathname.endsWith("/acurite/daily.json")) return true;
  const y = stationYear();
  return pathname.includes(`/${y}/`) || pathname.endsWith(`/${y}.json`);
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
    // Arkivfiler som fortfarande växer (manifesten, innevarande års dygnsfil,
    // innevarande månads timfil, AcuRites daily.json) måste hämtas färskt —
    // annars visar sidan gårdagens kopia och de senaste dygnen ser ut att
    // saknas fast de finns. Avslutade år ändras aldrig och cachas som förut.
    if (growingArchive(url.pathname)) {
      e.respondWith(
        caches.open(DATA).then((cache) =>
          fetch(req)
            .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
            .catch(() => cache.match(req))
        )
      );
      return;
    }
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
  // Skript: nätverk först så de aldrig hamnar ur synk med den (nätverk-först) HTML:en
  if (url.pathname.endsWith(".js")) {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res && res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }
  e.respondWith(staleWhileRevalidate(req, SHELL));
});
