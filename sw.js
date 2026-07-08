/* StewardMD service worker — offline + instant repeat loads.
   UPDATE-SAFE BY DESIGN:
   - Navigations/HTML = NETWORK-FIRST with cache:"no-store" → users ALWAYS get the
     latest index.html when online (so ?v=goldN cache-busting actually works and stale
     browser-HTTP-cached HTML can never pin old asset versions); cache is offline fallback.
   - Same-origin static assets (.js/.css/.png/.webp/.woff…) = stale-while-revalidate,
     keyed by the full ?v=goldN URL (a version bump is a fresh key → fresh fetch).
   - Cross-origin (Firebase/gstatic/accounts.google.com, api.stewardmd.in, fonts) = NOT
     intercepted → normal network, so auth + API are never affected.
   - On activate, the new SW RELOADS open tabs so a deploy can't leave a client stuck on
     stale JS (this is what un-sticks users running an old reasoning.js/app.js).
   IMPORTANT: bump CACHE on every deploy (keep in step with ?v=goldN) so old caches purge. */
var CACHE = "stewardmd-gold272";

self.addEventListener("install", function () {
  self.skipWaiting();
});

// ── Web Push (payloadless): on push, pull the latest update and show a banner. ──
self.addEventListener("push", function (e) {
  e.waitUntil((async function () {
    var title = "StewardMD", body = "New medical update", url = "/", tag = "smd-update";
    try {
      if (e.data) { var d = e.data.json(); title = d.title || title; body = d.body || body; url = d.url || url; if (d.tag) tag = d.tag; }
      else {
        var r = await fetch("/api/updates", { cache: "no-store" });
        var j = await r.json(); var it = (j.items || [])[0];
        if (it) { title = it.title || title; body = (it.source ? it.source + " · " : "") + (it.category || "update"); tag = "smd-" + it.id; }
      }
    } catch (x) {}
    return self.registration.showNotification(title, {
      body: body, icon: "/android-chrome-192x192.png", badge: "/favicon-32x32.png",
      tag: tag, renotify: true, data: { url: url }
    });
  })());
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cls) {
    for (var i = 0; i < cls.length; i++) { if ("focus" in cls[i]) { try { cls[i].navigate && cls[i].navigate(url); } catch (x) {} return cls[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    await self.clients.claim();
    // Force open StewardMD tabs to reload so they pick up the new versioned assets.
    // Runs once per SW version (a reload fetches the SAME sw.js → no new activate → no loop).
    try {
      var cls = await self.clients.matchAll({ type: "window" });
      cls.forEach(function (c) { try { c.navigate(c.url); } catch (err) {} });
    } catch (err) {}
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

  // NEVER cache API responses (e.g. /api/ghis/* carries live PHI — labs, radiology,
  // patient lists). Let them go straight to the network so nothing is persisted.
  if (url.pathname.indexOf("/api/") === 0) return;

  var isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1;

  if (isHTML) {
    // NETWORK-FIRST, bypassing the browser HTTP cache so the freshest index.html
    // (and thus the freshest ?v=goldN asset refs) always wins; cache is offline fallback.
    e.respondWith((async function () {
      try {
        var net = await fetch(url.pathname + url.search, { cache: "no-store", credentials: "same-origin" });
        if (net && net.status === 200) {
          var copy = net.clone();
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
        var copy = net.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return net;
    }).catch(function () { return cached; });
    return cached || fetchP;
  })());
});
