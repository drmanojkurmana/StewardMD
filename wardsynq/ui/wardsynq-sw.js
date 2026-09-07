/* wardsynq/ui/wardsynq-sw.js — the ward is in a basement.
 *
 * A clinical surface that stops working when the wifi does is a clinical surface that gets
 * abandoned, and the moment it is abandoned is a moment somebody is writing observations on a paper
 * towel. So this caches the whole surface up front and serves it from the cache first.
 *
 * THE RULE THAT MAKES THIS DIFFERENT FROM AN ORDINARY OFFLINE SHELL. Serving a stale APP is fine
 * and is the entire point. Serving stale CLINICAL DATA is not: a cached potassium from four hours
 * ago rendered without comment is exactly the hazard wardsynq-vitals.js refuses at the other end of
 * the pipe. So:
 *
 *   1. The app shell (HTML, CSS, JS, the mark) is CACHE FIRST. It changes on deploy, not on rounds.
 *   2. Anything that looks like clinical data is NETWORK FIRST, and when the network fails the
 *      response is NOT a cached body. It is a 503 carrying a JSON object that says the network is
 *      unavailable, so the caller renders "unavailable" rather than a number with no date on it.
 *   3. A failed navigation falls back to the shell, because a working app that says it is offline
 *      is more use at a bedside than a browser error page.
 *
 * The version is bumped on every deploy. An old cache is deleted on activate rather than left to
 * age out, because two versions of a clinical surface running side by side in different tabs is a
 * way for one nurse to be looking at a different rule set from the next.
 */

const VERSION = "wardsynq-v1";

/* The whole surface, listed rather than discovered. A shell that caches what it happens to fetch
   works until the one screen nobody opened before the wifi went is the one somebody needs. */
const SHELL = [
  "./wardsynq.html",
  "./wardsynq.css?v=8",
  "./wardsynq-app.js",
  "./opd.html",
  "./opd.css",
  "./opd-emr.js",
  "./brand/wardsynq-lockup.png",
  "./brand/wardsynq-mark.png",
  "./brand/icon-32.png",
  "./brand/icon-180.png",
  "./brand/icon-192.png",
  "./brand/wardsynq.webmanifest",
];

/** Anything under these paths is a clinical value and is never served from cache. */
const CLINICAL = [/\/api\//, /\/fhir\//, /\/observations?\b/, /\/results?\b/, /\/patients?\b/, /\/orders?\b/];

const isClinical = (url) => CLINICAL.some((re) => re.test(url));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll is atomic: one missing file fails the whole install rather than leaving a shell with a
    // hole in it that only shows up offline.
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      // Deleted, not left to expire. Two versions of a clinical surface in two tabs means one nurse
      // reading a different rule set from the next.
      if (key !== VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = request.url;

  /* Clinical data: network first, and NEVER a cached body on failure. */
  if (isClinical(url)) {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        // The important line in this file. A cached clinical value served without comment is a
        // number with no date on it, which is the thing every gatherer in this build refuses.
        return new Response(JSON.stringify({
          error: "network-unavailable",
          message: "This device is offline. No cached clinical value is served, because a stale result rendered without its age is indistinguishable from a current one.",
        }), { status: 503, headers: { "content-type": "application/json" } });
      }
    })());
    return;
  }

  /* The shell: cache first, and refresh in the background so the next load is current. */
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: false });
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok) (await caches.open(VERSION)).put(request, fresh.clone());
        } catch { /* offline is the normal case here, not an error */ }
      })());
      return cached;
    }

    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok && new URL(url).origin === self.location.origin) {
        (await caches.open(VERSION)).put(request, fresh.clone());
      }
      return fresh;
    } catch {
      // A working app that says it is offline beats a browser error page at a bedside.
      if (request.mode === "navigate") {
        const shell = await caches.match("./wardsynq.html");
        if (shell) return shell;
      }
      return new Response("Offline and not cached.", { status: 503 });
    }
  })());
});
