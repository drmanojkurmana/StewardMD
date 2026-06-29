/* StewardMD service worker — offline + instant repeat loads.
   UPDATE-SAFE BY DESIGN:
   - Navigations/HTML = NETWORK-FIRST → users always get the latest page when online
     (so ?v=goldN cache-busting keeps working); cache is only a fallback when offline.
   - Same-origin static assets (.js/.css/.png/.webp/.woff…) = stale-while-revalidate
     (instant from cache, refreshed in the background).
   - Cross-origin (Firebase/gstatic, api.stewardmd.in, fonts) = NOT intercepted → normal
     network, so auth + API are never affected.
   IMPORTANT: bump CACHE on every deploy (keep in step with ?v=goldN) so old caches purge. */
var CACHE = "stewardmd-gold55";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener("message", function (e) {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Only handle same-origin requests. Firebase/gstatic/API/fonts pass straight through.
  if (url.origin !== self.location.origin) return;

  var isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1;

  if (isHTML) {
    // NETWORK-FIRST: always try the network so updates flow; fall back to cache offline.
    e.respondWith((async function () {
      try {
        var net = await fetch(req);
        if (net && net.status === 200) {
          var copy = net.clone();  // clone immediately, before the body is consumed
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return net;
      } catch (err) {
        var cached = await caches.match(req);
        return cached || (await caches.match("/index.html")) || Response.error();
      }
    })());
    return;
  }

  // STATIC ASSETS: stale-while-revalidate.
  e.respondWith((async function () {
    var cached = await caches.match(req);
    var fetchP = fetch(req).then(function (net) {
      if (net && net.status === 200 && (net.type === "basic" || net.type === "default")) {
        var copy = net.clone();  // clone NOW (sync), before net is returned/consumed
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return net;
    }).catch(function () { return cached; });
    return cached || fetchP;
  })());
});
