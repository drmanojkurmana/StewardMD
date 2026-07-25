/* thorex-model-cache.js — ThoreX on-device models · persistent model-bytes cache (SMD_THOREX_MODEL_CACHE).
 *
 * Makes the on-device ONNX models self-contained after first run: download once from a configurable
 * URL, cache the raw bytes on-device, then serve every later load straight from the cache — no network
 * needed, so a clinician can validate fully offline after the first successful download. Mirrors
 * kardiox-model-manager.js's "download once, cache, then run offline" pattern, generalized here to a
 * single-URL keyed cache (thorex-ort.js loads each model by URL, not a multi-file "pack") and backed by
 * the standard web-platform Cache API / IndexedDB instead of @capacitor/filesystem, so it also works in
 * a plain browser tab as well as the native WebView.
 *
 * loadModelBytes(url, opts) -> Promise<ArrayBuffer>
 *   opts: { fetch, caches, indexedDB, cacheName, onProgress } — every dependency is injectable so this
 *   is fully unit-testable in Node (no browser required); when an opt is omitted this falls back to the
 *   real global (`window.fetch`/`caches`/`indexedDB`) if present.
 *
 *   1. Cache lookup FIRST: the Cache API (`caches.open(cacheName)` then `cache.match(url)`) if `caches`
 *      is available, else IndexedDB (a single object store keyed by url). A hit resolves immediately —
 *      NO fetch — so this is what makes the second-and-later run fully offline-capable.
 *   2. Cache miss: `fetch(url)`, streaming progress via `response.body.getReader()` summed against the
 *      `Content-Length` header (`onProgress(0..1)`), assembling the full ArrayBuffer; the bytes are then
 *      stored in whichever cache is available (best-effort — a failed cache WRITE must not sink an
 *      otherwise-successful download) and returned.
 *   3. A fetch failure (network error, non-OK HTTP status, or no fetch available and nothing cached)
 *      rejects with a typed `model_unavailable` error — this module never fabricates model bytes.
 *
 * node + browser.
 */
(function () {
  "use strict";

  var DEFAULT_CACHE_NAME = "thorex-models";

  function err(code, message, stage) { var e = new Error(message); e.code = code; e.stage = stage || "download-model"; return e; }

  function realCaches() { try { return typeof caches !== "undefined" ? caches : null; } catch (e) { return null; } }
  function realIndexedDB() { try { return typeof indexedDB !== "undefined" ? indexedDB : null; } catch (e) { return null; } }
  function realFetch() { try { return typeof fetch !== "undefined" ? fetch : null; } catch (e) { return null; } }

  // ── Cache API path ──────────────────────────────────────────────────────────────────────────────
  function cacheApiGet(cachesImpl, cacheName, url) {
    return Promise.resolve(cachesImpl.open(cacheName)).then(function (cache) {
      return Promise.resolve(cache.match(url)).then(function (res) {
        if (!res) return null;
        return Promise.resolve(res.arrayBuffer());
      });
    }).catch(function () { return null; }); // a broken cache read must fall through to fetch, not throw
  }
  function cacheApiPut(cachesImpl, cacheName, url, bytes) {
    return Promise.resolve(cachesImpl.open(cacheName)).then(function (cache) {
      var res = (typeof Response !== "undefined")
        ? new Response(bytes, { headers: { "Content-Length": String(bytes.byteLength || 0) } })
        : { arrayBuffer: function () { return Promise.resolve(bytes); } };
      return Promise.resolve(cache.put(url, res));
    }).catch(function () { /* best-effort: a failed cache WRITE must not sink the model load */ });
  }

  // ── IndexedDB path (fallback when the Cache API is unavailable) ────────────────────────────────────
  var IDB_DB_NAME = "smd-thorex-models";
  var IDB_STORE = "models";

  function idbOpen(idbImpl) {
    return new Promise(function (resolve, reject) {
      var req = idbImpl.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = function () {
        try { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); } catch (e) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject((req.error) || new Error("indexedDB open failed")); };
    });
  }
  function idbGet(idbImpl, url) {
    return idbOpen(idbImpl).then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, "readonly");
          var req = tx.objectStore(IDB_STORE).get(url);
          req.onsuccess = function () { resolve(req.result != null ? req.result : null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; }); // a broken IndexedDB read must fall through to fetch, not throw
  }
  function idbPut(idbImpl, url, bytes) {
    return idbOpen(idbImpl).then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(bytes, url);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    }).catch(function () { /* best-effort */ });
  }

  // ── fetch + streamed progress ───────────────────────────────────────────────────────────────────
  function fetchWithProgress(fetchImpl, url, onProgress) {
    var req;
    try { req = fetchImpl(url); } catch (e) { return Promise.reject(err("model_unavailable", "model download failed: " + url + " (" + (e && e.message || e) + ")")); }
    return Promise.resolve(req).then(function (res) {
      if (!res || !res.ok) throw err("model_unavailable", "model download failed: " + url + (res ? (" (HTTP " + res.status + ")") : " (no response)"));
      var lenHeader = (res.headers && res.headers.get) ? res.headers.get("Content-Length") : null;
      var total = lenHeader ? parseInt(lenHeader, 10) : 0;
      if (!res.body || !res.body.getReader) {
        // no streaming support (e.g. a minimal fetch polyfill) — fall back to a single arrayBuffer() read;
        // still an honest download, just without incremental progress ticks (report 0 then 1).
        try { onProgress(0); } catch (e) {}
        return Promise.resolve(res.arrayBuffer()).then(function (ab) { try { onProgress(1); } catch (e) {} return ab; });
      }
      var reader = res.body.getReader();
      var chunks = [], received = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(received), off = 0;
            for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
            try { onProgress(1); } catch (e) {}
            return out.buffer;
          }
          chunks.push(r.value);
          received += r.value.length;
          if (total > 0) { try { onProgress(Math.min(1, received / total)); } catch (e) {} }
          return pump();
        });
      }
      return pump();
    }, function (netErr) {
      throw err("model_unavailable", "model download failed: " + url + " (" + (netErr && netErr.message || netErr) + ")");
    });
  }

  // url: absolute or relative model URL (operator-configurable base — see thorex-ort.js's modelBase()).
  // opts: { fetch, caches, indexedDB, cacheName, onProgress }
  function loadModelBytes(url, opts) {
    opts = opts || {};
    var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
    var cacheName = opts.cacheName || DEFAULT_CACHE_NAME;
    var cachesImpl = opts.caches !== undefined ? opts.caches : realCaches();
    var idbImpl = opts.indexedDB !== undefined ? opts.indexedDB : realIndexedDB();
    var fetchImpl = opts.fetch || realFetch();

    function fromCache() {
      if (cachesImpl && cachesImpl.open) return cacheApiGet(cachesImpl, cacheName, url);
      if (idbImpl && idbImpl.open) return idbGet(idbImpl, url);
      return Promise.resolve(null);
    }
    function storeInCache(bytes) {
      if (cachesImpl && cachesImpl.open) return cacheApiPut(cachesImpl, cacheName, url, bytes);
      if (idbImpl && idbImpl.open) return idbPut(idbImpl, url, bytes);
      return Promise.resolve();
    }

    return fromCache().then(function (cached) {
      if (cached) { try { onProgress(1); } catch (e) {} return cached; } // offline-capable: no fetch on a cache hit
      if (!fetchImpl) return Promise.reject(err("model_unavailable", "model not cached and no fetch available: " + url));
      return fetchWithProgress(fetchImpl, url, onProgress).then(function (bytes) {
        return storeInCache(bytes).then(function () { return bytes; }, function () { return bytes; });
      });
    });
  }

  var API = { loadModelBytes: loadModelBytes, DEFAULT_CACHE_NAME: DEFAULT_CACHE_NAME };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_MODEL_CACHE = API;
})();
