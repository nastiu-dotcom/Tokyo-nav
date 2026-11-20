// Service worker: keeps the app shell available offline.
// API calls and map tiles always go to the network.
const CACHE = "tke-shell-v11";
const SHELL = [
  "/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest",
  "/js/util.js", "/js/legs.js", "/js/picker.js", "/js/share.js", "/js/plan.js", "/js/trip2027.js", "/js/tax.js", "/js/mapview.js", "/js/takeout.js", "/js/taxutil.js", "/js/i18n.js", "/js/i18n-he.js", "/js/theme.js", "/js/family.js", "/js/plan-he.js", "/js/account.js", "/data/tokyo-5day-2027.json",
  "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png",
  "/vendor/leaflet/leaflet.css", "/vendor/leaflet/leaflet.js",
  "/vendor/leaflet/images/marker-icon.png", "/vendor/leaflet/images/marker-icon-2x.png",
  "/vendor/leaflet/images/marker-shadow.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Network first (so updates show up), cache as offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && !res.redirected) { // never cache the login page in place of the app
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html"))),
  );
});
