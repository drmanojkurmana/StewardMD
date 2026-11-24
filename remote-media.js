/* StewardMD - pictures and clips that load from the server on first view, for signed-in users only (window.SMD_REMOTE_MEDIA).
 * ============================================================================================================
 * Owner 2026-11-12: PrepNucleus lesson pictures and CliniX photos load one at a time when they are viewed, from R2,
 * only for a signed-in user, and stay on the phone afterwards. One loader for every screen, so no screen has to know:
 *
 *   - It watches the document for <img>, <video>, <source>, and SVG <image> whose address is one of these:
 *       a. a gated bank picture  /api/prep/bank/<path>   (a lesson's v<n>/lessons/media/*; PREP_BANK_CLIENT decides)
 *       b. content that used to ship in the app, when window.SMD_REMOTE_MEDIA_ON === 1 (set by build-www when it leaves
 *          them out): clinix photos, prep lesson diagrams, teaching animations, SurgX, Kardia clips and diagrams,
 *          Tokos and Ophthalmos pictures  ->  bank path app/<path>
 *   - When it comes near the screen it is read from Cache Storage ("smd-media-v1"); else, for a signed-in user,
 *     fetched once through a short-lived signed URL (prep-bank-client.js, loaded here on demand) and kept in the cache.
 *     A file seen once therefore opens instantly and offline afterwards, and costs one request in its lifetime.
 *   - Signed out: a "Sign in to see this picture" placeholder. Offline before first view: "Connect to load this picture".
 *     Both retry when the account changes or the phone comes back online.
 *   - Code that draws its own picture (canvas Image, or a fetch of SVG text) calls SMD_REMOTE_MEDIA.resolve(path).
 *     That returns a blob URL when this loader is on, or the same path when it is off.
 * Kill switch: localStorage smd_remote_media = "0" leaves every picture and clip alone (they must then be in the app).
 * Clips use the same near-screen watch as pictures. preload stays none until then, so the WebView does not fetch them
 * up front. This loader does not set loading or fetchpriority; each screen keeps the size it already gave the clip.
 */
(function (G) {
  "use strict";
  var D = G.document;
  var CACHE = "smd-media-v1";
  var KEY_BASE = "https://stewardmd.in/__smd_media/";
  var BUNDLE_PREFIXES = [
    "clinix/media/practicals/", "clinix/media/skills/", "prep/lessons/media/", "media/anim/",
    "surgx/media/", "kardia/media/clips/", "kardia/learn/diagrams/",
    "tokos/media/", "tokos/learn/", "ophthalmos/learn/media/", "ophthalmos/learn/diagrams/"
  ];
  var MEDIA_EXT = /\.(?:webp|svg|png|jpe?g|mp4)$/i;
  var BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  var XLINK = "http://www.w3.org/1999/xlink";
  var MAX_PARALLEL = 4;

  function off() { try { return G.localStorage.getItem("smd_remote_media") === "0"; } catch (e) { return false; } }
  function remoteBundle() { return G.SMD_REMOTE_MEDIA_ON === 1; }
  function apiBase() { return G.SMD_API_BASE || ""; }
  function motionOk() {
    try { return !(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return true; }
  }

  /* Collapse "." and ".." on a bundle path. ".." that would leave the root returns null.
   * A bank path is not passed here: ".." in that branch is refused before this runs. */
  function bundleRel(s) {
    var rel = String(s || "").replace(/^\/+/, "");
    if (!rel || rel.indexOf("//") >= 0) return null;
    var parts = rel.split("/");
    var out = [];
    var i, seg;
    for (i = 0; i < parts.length; i++) {
      seg = parts[i];
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (!out.length) return null;
        out.pop();
        continue;
      }
      out.push(seg);
    }
    return out.length ? out.join("/") : null;
  }

  /* key(src) -> the bank path this element really wants ("v1/lessons/media/x.webp", "app/clinix/media/skills/y.webp"),
   * or null when it is not one of ours. Pure: tested under node. */
  function key(src, opts) {
    opts = opts || {};
    var s = String(src || "");
    if (!s || /^(?:data|blob):/i.test(s)) return null;
    s = s.split("#")[0].split("?")[0];
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^\/]+/i, "");
    var m = s.match(/(?:^|\/)api\/prep\/bank\/(.+)$/);
    if (m) {
      var p = m[1];
      if (/\.\.|\/\//.test(p) || !MEDIA_EXT.test(p)) return null;
      return opts.isGated && opts.isGated(p) ? p : null;
    }
    if (!opts.remoteBundle) return null;
    var rel = bundleRel(s);
    if (!rel || !MEDIA_EXT.test(rel)) return null;
    for (var i = 0; i < BUNDLE_PREFIXES.length; i++) if (rel.indexOf(BUNDLE_PREFIXES[i]) === 0) return "app/" + rel;
    return null;
  }

  function mediaKind(el) {
    if (!el) return "";
    var t = String(el.localName || el.tagName || "").toLowerCase();
    if (t === "img") return "img";
    if (t === "video") return "video";
    if (t === "source") return "source";
    if (t === "image") return "svgimage";
    return "";
  }
  function mediaPath(el) {
    var k = mediaKind(el);
    if (k === "svgimage") return el.getAttribute("href") || el.getAttribute("xlink:href") || "";
    if (k === "img" || k === "video" || k === "source") return el.getAttribute("src") || "";
    return "";
  }
  function parentVideo(el) {
    var p = el && el.parentNode;
    if (!p) return null;
    return String(p.tagName || p.localName || "").toLowerCase() === "video" ? p : null;
  }
  function setHref(el, url) {
    el.setAttribute("href", url);
    if (el.setAttributeNS) {
      try { el.setAttributeNS(XLINK, "href", url); } catch (e) { el.setAttribute("xlink:href", url); }
    } else el.setAttribute("xlink:href", url);
  }
  function note(text) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#e9eef1"/>' +
      '<text x="320" y="186" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="24" font-weight="600" fill="#5a7184" text-anchor="middle">' + text + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  var NOTE_SIGNIN = note("Sign in to see this picture"), NOTE_OFFLINE = note("Connect to load this picture"), NOTE_GONE = note("Picture not available");
  function noteFor(why) { return why === "signin" ? NOTE_SIGNIN : why === "gone" ? NOTE_GONE : NOTE_OFFLINE; }
  function playIf(el) {
    if (!el || !motionOk()) {
      if (el && el.removeAttribute) el.removeAttribute("autoplay");
      if (el && el.pause) el.pause();
      return;
    }
    if (el.autoplay || (el.hasAttribute && el.hasAttribute("autoplay"))) {
      var pr = el.play && el.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
  }

  /* phase "loading" drops the network address, "ok" sets the blob URL, "fail" shows the note. */
  function applySwap(el, phase, urlOrWhy) {
    var k = mediaKind(el);
    if (!k) return;
    var v;
    if (phase === "loading") {
      if (k === "img") el.setAttribute("src", BLANK);
      else if (k === "svgimage") setHref(el, BLANK);
      else if (k === "video") { el.removeAttribute("src"); el.setAttribute("preload", "none"); }
      else if (k === "source") {
        el.removeAttribute("src");
        v = parentVideo(el);
        if (v) v.setAttribute("preload", "none");
      }
      return;
    }
    if (phase === "ok") {
      if (k === "img") el.setAttribute("src", urlOrWhy);
      else if (k === "svgimage") setHref(el, urlOrWhy);
      else if (k === "video") { el.setAttribute("src", urlOrWhy); playIf(el); }
      else if (k === "source") {
        el.setAttribute("src", urlOrWhy);
        v = parentVideo(el);
        if (v && v.load) v.load();
        playIf(v);
      }
      return;
    }
    if (phase === "fail") {
      var n = noteFor(urlOrWhy);
      if (k === "img") el.setAttribute("src", n);
      else if (k === "svgimage") setHref(el, n);
      else if (k === "video") { el.removeAttribute("src"); el.setAttribute("poster", n); el.setAttribute("preload", "none"); }
      else if (k === "source") {
        el.removeAttribute("src");
        v = parentVideo(el);
        if (v) { v.removeAttribute("src"); v.setAttribute("poster", n); v.setAttribute("preload", "none"); }
      }
    }
  }

  /* resolve(path) -> Promise of a blob URL when the file is remote, or the same path when the loader is off,
   * the kill switch is set, or the path is not one of ours. Node tests pass opts; the phone calls it with the path only. */
  function resolve(path, opts) {
    var raw = path == null ? "" : String(path);
    var o = opts || {};
    var killed = o.off != null ? !!o.off : off();
    var remote = o.remoteBundle != null ? !!o.remoteBundle : remoteBundle();
    if (killed || !remote) return Promise.resolve(raw);
    var p = key(raw, { remoteBundle: true, isGated: o.isGated || gatedTest });
    if (!p) return Promise.resolve(raw);
    if (typeof o.load === "function") return Promise.resolve().then(function () { return o.load(p); });
    if (D && D.documentElement) return load(p);
    return Promise.resolve(p);
  }

  if (!D || !D.documentElement) {
    if (typeof module !== "undefined" && module.exports) {
      module.exports = { key: key, prefixes: BUNDLE_PREFIXES, resolve: resolve, applySwap: applySwap, mediaKind: mediaKind, mediaPath: mediaPath };
    }
    return;
  }
  if (G.SMD_REMOTE_MEDIA) return;
  function typeOf(p) { return /\.mp4$/i.test(p) ? "video/mp4" : /\.svg$/i.test(p) ? "image/svg+xml" : /\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : "image/webp"; }

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

  /* ---------- cache + fetch, one request per file at a time ---------- */
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
    return new Promise(function (resolveOne, reject) {
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
          var typed = b.type && /^(?:image|video)\//.test(b.type) ? b : new G.Blob([b], { type: typeOf(p) });
          cacheOpen().then(function (c) { return c.put(KEY_BASE + p, new G.Response(typed, { headers: { "Content-Type": typed.type } })); }).catch(function () {});
          return typed;
        }).then(resolveOne, function (e) { reject(e && e.why ? e : { why: "offline" }); })
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

  /* ---------- img, video, source, and SVG image ---------- */
  var waiting = [];   // elements showing a sign-in / offline note, retried on account change or reconnect
  function show(el, p) {
    load(p).then(function (u) {
      if (el.getAttribute("data-smd-rm") !== p) return;
      el.setAttribute("data-smd-rm-state", "ok");
      applySwap(el, "ok", u);
    }, function (e) {
      if (el.getAttribute("data-smd-rm") !== p) return;
      var why = (e && e.why) || "offline";
      el.setAttribute("data-smd-rm-state", why);
      applySwap(el, "fail", why);
      if (why !== "gone" && waiting.indexOf(el) < 0) waiting.push(el);
    });
  }
  var io = G.IntersectionObserver ? new G.IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      var node = en.target;
      var p = node.getAttribute("data-smd-rm");
      if (!p && node.querySelector) {
        var s = node.querySelector("source[data-smd-rm]");
        if (s) { node = s; p = s.getAttribute("data-smd-rm"); }
      }
      if (p && node.getAttribute("data-smd-rm-state") === "loading") show(node, p);
    });
  }, { rootMargin: "400px 0px" }) : null;

  function claim(el) {
    if (off() || !el) return;
    var kind = mediaKind(el);
    if (!kind) return;
    var src = mediaPath(el);
    var p = key(src, { remoteBundle: remoteBundle(), isGated: gatedTest });
    if (!p) return;
    if (el.getAttribute("data-smd-rm") === p) return;
    el.setAttribute("data-smd-rm", p);
    el.setAttribute("data-smd-rm-state", "loading");
    if (urls[p]) { el.setAttribute("data-smd-rm-state", "ok"); applySwap(el, "ok", urls[p]); return; }
    applySwap(el, "loading");
    var watch = el;
    if (kind === "source") {
      var v = parentVideo(el);
      if (v) watch = v;
    }
    if (io) io.observe(watch); else show(el, p);
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    claim(root);
    if (root.querySelectorAll) {
      var l = root.querySelectorAll("img, video, source, image");
      for (var i = 0; i < l.length; i++) claim(l[i]);
    }
  }
  function retryWaiting() {
    var w = waiting; waiting = [];
    w.forEach(function (el) {
      if (!el.isConnected) return;
      var p = el.getAttribute("data-smd-rm"); if (!p) return;
      el.setAttribute("data-smd-rm-state", "loading");
      show(el, p);
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
      }).observe(D.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href", "xlink:href"] });
    }
    scan(D.documentElement);
    try { if (G.SMD_ACCOUNT && G.SMD_ACCOUNT.onChange) G.SMD_ACCOUNT.onChange(function () { setTimeout(retryWaiting, 800); }); } catch (e) {}
    G.addEventListener("online", retryWaiting);
    D.addEventListener("visibilitychange", function () { if (D.visibilityState === "visible" && waiting.length) retryWaiting(); });
  }

  G.SMD_REMOTE_MEDIA = { key: key, load: load, claim: claim, retry: retryWaiting, resolve: resolve, CACHE: CACHE, _prefixes: BUNDLE_PREFIXES };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : globalThis);
