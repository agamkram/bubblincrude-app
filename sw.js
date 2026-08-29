/* BubblinCrude service worker — cache app shell + embedded JSON */
/* Bump CACHE together with APP_VERSION in app.js and the ?v= query strings
   in index.html. Renaming the cache is what evicts the previous build. */
const CACHE = "bubblincrude-v66";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css?v=66",
  "./app.js?v=66",
  "./data.js?v=66",
  "./sites.js?v=66",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (c) => {
        await Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Leaflet / tiles / fonts — network with cache fallback when possible
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  const path = url.pathname;
  const isNav =
    req.mode === "navigate" ||
    path === "/" ||
    path.endsWith(".html") ||
    path === "/compare" ||
    path.startsWith("/stream/") ||
    path === "/cuts" ||
    path === "/molecules" ||
    path === "/about";

  const isCode =
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith("manifest.webmanifest") ||
    path.endsWith("data.js");

  if (isNav) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (isCode) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
