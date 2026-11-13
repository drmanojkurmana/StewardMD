/* StewardMD - pictures that load from the server on first view, for signed-in users only (window.SMD_REMOTE_MEDIA).
 * ============================================================================================================
 * Owner 2026-11-12: PrepNucleus lesson pictures and CliniX photos load one at a time when they are viewed, from R2,
 * only for a signed-in user, and stay on the phone afterwards. One loader for every screen, so no screen has to know:
 *
 *   - It watches the document for <img> elements whose src is one of these pictures:
 *       a. a gated bank picture  /api/prep/bank/<path>   (a lesson's v<n>/lessons/media/*; PREP_BANK_CLIENT decides)
 *       b. content that used to ship in the app, when window.SMD_REMOTE_MEDIA_ON === 1 (set by build-www when it leaves
 *          them out): /clinix/media/practicals/*, /clinix/media/skills/*, /prep/lessons/media/*  ->  bank path app/<path>
 *   - When the picture comes near the screen it is read from Cache Storage ("smd-media-v1"); else, for a signed-in user,
 *     fetched once through a short-lived signed URL (prep-bank-client.js, loaded here on demand) and kept in the cache.
 *     A picture seen once therefore opens instantly and offline afterwards, and costs one request in its lifetime.
 *   - Signed out: a "Sign in to see this picture" placeholder. Offline before first view: "Connect to load this picture".
 *     Both retry when the account changes or the phone comes back online.
 * Kill switch: localStorage smd_remote_media = "0" leaves every <img> alone (bundled pictures must then be in the app).
 */
(function (G) {
  "use strict";
  var D = G.document;
  var CACHE = "smd-media-v1";
  var KEY_BASE = "https://stewardmd.in/__smd_media/";
  var BUNDLE_PREFIXES = ["clinix/media/practicals/", "clinix/media/skills/", "prep/lessons/media/"];
  var BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  var MAX_PARALLEL = 4;

  function off() { try { return G.localStorage.getItem("smd_remote_media") === "0"; } catch (e) { return false; } }
  function remoteBundle() { return G.SMD_REMOTE_MEDIA_ON === 1; }
  function apiBase() { return G.SMD_API_BASE || ""; }

  /* key(src) -> the bank path this <img> really wants ("v1/lessons/media/x.webp", "app/clinix/media/skills/y.webp"),
   * or null when it is not one of ours. Pure: tested under node. */
  function key(src, opts) {
    opts = opts || {};
    var s = String(src || "");
    if (!s || /^(?:data|blob):/i.test(s)) return null;
    s = s.split("#")[0].split("?")[0];
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^\/]+/i, "");          // drop scheme and host (https://stewardmd.in, capacitor://localhost)
    var m = s.match(/(?:^|\/)api\/prep\/bank\/(.+)$/);
    if (m) {
      var p = m[1];
      if (/\.\.|\/\//.test(p)) return null;
      return opts.isGated && opts.isGated(p) && /\.(?:webp|svg|png|jpe?g)$/i.test(p) ? p : null;
    }
    if (!opts.remoteBundle) return null;
    var rel = s.replace(/^\/+/, "");
    if (/\.\.|\/\//.test(rel)) return null;
    for (var i = 0; i < BUNDLE_PREFIXES.length; i++) if (rel.indexOf(BUNDLE_PREFIXES[i]) === 0) return "app/" + rel;
    return null;
  }
  if (!D || !D.documentElement) { if (typeof module !== "undefined" && module.exports) module.exports = { key: key, prefixes: BUNDLE_PREFIXES }; return; }
  if (G.SMD_REMOTE_MEDIA) return;
  function typeOf(p) { return /\.svg$/i.test(p) ? "image/svg+xml" : /\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : "image/webp"; }

  function note(text) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#e9eef1"/>' +
      '<text x="320" y="186" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="24" font-weight="600" fill="#5a7184" text-anchor="middle">' + text + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  var NOTE_SIGNIN = note("Sign in to see this picture"), NOTE_OFFLINE = note("Connect to load this picture"), NOTE_GONE = note("Picture not available");

  /* ---------- the bank client (session + signed URLs), loaded on first need ---------- */
  var clientP = null;
  function client() {
    if (G.PREP_BANK_CLIENT) return Promise.resolve(G.PREP_BANK_CLIENT);
    if (clientP) return clientP;
    clientP = new Promise(function (res) {
      var s = D.createElement("script");
      s.src = "/prep-bank-client.js?v=rm1"; s.async = true;
      s.onload = function () { res(G.PREP_BANK_CLIENT || null); };
      s.onerror = function () { clientP = null; res(null); };
      D.head.appendChild(s);
    });
    return clientP;
  }
  function gatedTest(p) {
    var C = G.PREP_BANK_CLIENT;
    if (C && C.isGatedPath) return C.isGatedPath(p);
    // Before the client is loaded: the same rule for the paths this loader cares about.
    return /^v\d{1,3}\/lessons\/media\//.test(p) || /^app\//.test(p);
  }

  /* ---------- cache + fetch, one request per picture at a time ---------- */
  var urls = {}, inflight = {}, queue = [], running = 0;
  function cacheOpen() { return (G.caches && G.caches.open) ? G.caches.open(CACHE) : Promise.reject(new Error("no-cache")); }
  function fromCache(p) {
    return cacheOpen().then(function (c) { return c.match(KEY_BASE + p); }).then(function (r) { return r ? r.blob() : null; }, function () { return null; });
  }
  function toUrl(p, blob) {
    var b = blob.type ? blob : new G.Blob([blob], { type: typeOf(p) });
    return (urls[p] = G.URL.createObjectURL(b));
  }
  function pump() {
    while (running < MAX_PARALLEL && queue.length) { running++; queue.shift()(); }
  }
  function fetchOne(p) {
    return new Promise(function (resolve, reject) {
      queue.push(function () {
        client().then(function (C) {
          if (!C) throw { why: "offline" };
          return C.ensureSession().then(function (sess) {
            if (!sess) throw { why: "signin" };
            var signed = C.signImageUrl(apiBase() + "/api/prep/bank/" + p);
            // The WebView's own fetch, not the CapacitorHttp bridge: the bridge hands every body back as text, which
            // corrupts image bytes. The bank answers the app's origin with CORS headers (functions/_prep_bank_gate.js).
            var F = (typeof G.CapacitorWebFetch === "function") ? G.CapacitorWebFetch : G.fetch;
            return F(signed, { credentials: "omit" });
          });
        }).then(function (r) {
          if (r.status === 401 || r.status === 403) throw { why: "signin" };
          if (r.status === 404) throw { why: "gone" };
          if (!r.ok) throw { why: "offline" };
          return r.blob();
        }).then(function (b) {
          if (!b || !b.size) throw { why: "gone" };
          var typed = b.type && /^image\//.test(b.type) ? b : new G.Blob([b], { type: typeOf(p) });
          cacheOpen().then(function (c) { return c.put(KEY_BASE + p, new G.Response(typed, { headers: { "Content-Type": typed.type } })); }).catch(function () {});
          return typed;
        }).then(resolve, function (e) { reject(e && e.why ? e : { why: "offline" }); })
          .then(function () { running--; pump(); }, function () { running--; pump(); });
      });
      pump();
    });
  }
  /* load(p) -> Promise<objectURL>; rejects with { why: "signin" | "offline" | "gone" }. */
  function load(p) {
    if (urls[p]) return Promise.resolve(urls[p]);
    if (inflight[p]) return inflight[p];
    var pr = fromCache(p).then(function (b) { return b || fetchOne(p); }).then(function (b) { delete inflight[p]; return toUrl(p, b); },
      function (e) { delete inflight[p]; throw e; });
    return (inflight[p] = pr);
  }

  /* ---------- the <img> side ---------- */
  var waiting = [];   // imgs showing a sign-in / offline note, retried on account change or reconnect
  function show(img, p) {
    load(p).then(function (u) {
      if (img.getAttribute("data-smd-rm") !== p) return;
      img.setAttribute("data-smd-rm-state", "ok");
      img.src = u;
    }, function (e) {
      if (img.getAttribute("data-smd-rm") !== p) return;
      var why = (e && e.why) || "offline";
      img.setAttribute("data-smd-rm-state", why);
      img.src = why === "signin" ? NOTE_SIGNIN : why === "gone" ? NOTE_GONE : NOTE_OFFLINE;
      if (why !== "gone" && waiting.indexOf(img) < 0) waiting.push(img);
    });
  }
  var io = G.IntersectionObserver ? new G.IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      var p = en.target.getAttribute("data-smd-rm");
      if (p) show(en.target, p);
    });
  }, { rootMargin: "400px 0px" }) : null;

  function claim(img) {
    if (off() || !img || img.tagName !== "IMG") return;
    var src = img.getAttribute("src");
    var p = key(src, { remoteBundle: remoteBundle(), isGated: gatedTest });
    if (!p) return;
    img.setAttribute("data-smd-rm", p);
    img.setAttribute("data-smd-rm-state", "loading");
    if (urls[p]) { img.setAttribute("data-smd-rm-state", "ok"); img.src = urls[p]; return; }
    img.src = BLANK;   // stop the bundled 404 / unsigned 401 before it is requested
    if (io) io.observe(img); else show(img, p);
  }
  function scan(root) {
    if (!root) return;
    if (root.tagName === "IMG") { claim(root); return; }
    if (root.querySelectorAll) { var l = root.querySelectorAll("img"); for (var i = 0; i < l.length; i++) claim(l[i]); }
  }
  function retryWaiting() {
    var w = waiting; waiting = [];
    w.forEach(function (img) {
      if (!img.isConnected) return;
      var p = img.getAttribute("data-smd-rm"); if (!p) return;
      img.setAttribute("data-smd-rm-state", "loading");
      show(img, p);
    });
  }

  function start() {
    if (G.MutationObserver) {
      new G.MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === "attributes") claim(m.target);
          else for (var j = 0; j < m.addedNodes.length; j++) if (m.addedNodes[j].nodeType === 1) scan(m.addedNodes[j]);
        }
      }).observe(D.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
    }
    scan(D.documentElement);
    try { if (G.SMD_ACCOUNT && G.SMD_ACCOUNT.onChange) G.SMD_ACCOUNT.onChange(function () { setTimeout(retryWaiting, 800); }); } catch (e) {}
    G.addEventListener("online", retryWaiting);
    D.addEventListener("visibilitychange", function () { if (D.visibilityState === "visible" && waiting.length) retryWaiting(); });
  }

  G.SMD_REMOTE_MEDIA = { key: key, load: load, claim: claim, retry: retryWaiting, CACHE: CACHE, _prefixes: BUNDLE_PREFIXES };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : globalThis);
