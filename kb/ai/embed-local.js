/* StewardMD — on-phone semantic search (window.SMD_EMBED_LOCAL).
 * ===========================================================================
 * Finds Knowledge Base diseases on this phone with EmbeddingGemma 2 vectors,
 * no network and no AI tokens. Two halves:
 *
 *   1. DISEASE VECTORS (5,365 x 768 int8, Q5 build). Fetched once through the
 *      existing prep-bank API (/api/prep/bank/v1/kb/kb-vectors-q5.{json,i8},
 *      same gate as every bank file), then kept in the same IndexedDB
 *      database and store the bank modules use ("prep-bank" / "files"), under
 *      the bank path as the key. Row i of the .i8 file (768 int8 values,
 *      row-major) belongs to ids[i]; dequantise v = q / scale. Rows are
 *      L2-normalised, so cosine similarity is the dot product.
 *   2. QUERY VECTOR. The native Llama plugin embeds the question on-device.
 *      That method does not exist yet (native follow-up); until it does,
 *      embedAvailable() is false and everything below silently yields [] so
 *      retrieval falls through to the server arm, then to keyword only.
 *
 * PRIVACY: the local tier sends nothing anywhere. The question never leaves
 * the phone, which is why steward-ai.browser.js runs this tier even in Local
 * and KB-only modes, where the server vector arm is policy-blocked.
 *
 * In node (tests) the module exports the same API via module.exports; all
 * platform access (window, fetch, indexedDB) is lazy, so requiring it is safe.
 * Pass { fetch, store } into loadVectors()/localTier() to inject fakes, where
 * store is { get(k)->Promise, put(k,v)->Promise }.
 * ======================================================================== */
(function () {
  "use strict";

  var DIMS = 768;
  var FLAG = "smd_local_embed";   // default OFF: localStorage "1" turns it on
  var EMBED_ID = "embedding-gemma-2";
  var META_PATH = "v1/kb/kb-vectors-q5.json";
  var VEC_PATH = "v1/kb/kb-vectors-q5.i8";
  var TOP_DEFAULT = 8;

  function glb() {
    try {
      if (typeof window !== "undefined") return window;
      if (typeof globalThis !== "undefined") return globalThis;
    } catch (e) {}
    return {};
  }
  function bankBase() {
    try { var g = glb(); return g.SMD_PREP_BANK_API || "/api/prep/bank/"; } catch (e) { return "/api/prep/bank/"; }
  }
  function lget(k) { try { return glb().localStorage.getItem(k); } catch (e) { return null; } }

  function flagOn() { return lget(FLAG) === "1"; }
  function setFlag(on) {
    try {
      if (on) glb().localStorage.setItem(FLAG, "1");
      else glb().localStorage.removeItem(FLAG);
    } catch (e) {}
    return flagOn();
  }

  /** The native embed method, or null. Feature-detected: absent until the native PR lands. */
  function llamaEmbed() {
    try {
      var g = glb(), c = g.Capacitor, L = c && c.Plugins && c.Plugins.Llama;
      return (L && typeof L.embed === "function") ? L : null;
    } catch (e) { return null; }
  }
  function embedAvailable() { return !!llamaEmbed(); }

  /** The 210 MB search pack verified on disk (maik-models.js install marker). */
  function packReady() {
    try {
      var M = glb().SMD_MAIK_MODELS;
      return !!(M && M.installedCached && M.installedCached(EMBED_ID));
    } catch (e) { return false; }
  }

  /* ── IndexedDB store (same database and store as the bank modules) ── */
  function idbStore() {
    return new Promise(function (res) {
      var idb = null;
      try { idb = glb().indexedDB; } catch (e) { idb = null; }
      if (!idb || !idb.open) { res(null); return; }
      try {
        var rq = idb.open("prep-bank", 1);
        rq.onupgradeneeded = function () { try { rq.result.createObjectStore("files"); } catch (e) {} };
        rq.onsuccess = function () {
          var db = rq.result;
          var tx = function (mode, fn) {
            return new Promise(function (res2) {
              try {
                var t = db.transaction("files", mode), os = t.objectStore("files"), r = fn(os);
                t.oncomplete = function () { res2(r && ("result" in Object(r)) ? r.result : null); };
                t.onerror = function () { res2(null); };
              } catch (e) { res2(null); }
            });
          };
          res({
            get: function (k) { return tx("readonly", function (os) { return os.get(k); }); },
            put: function (k, v) { return tx("readwrite", function (os) { return os.put(v, k); }); }
          });
        };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }

  /* ── validation ── */
  function validMeta(m) {
    if (!m || typeof m !== "object") return false;
    if (!Array.isArray(m.ids) || !m.ids.length) return false;
    if (m.dims !== DIMS) return false;
    if (typeof m.scale !== "number" || !(m.scale > 0) || !isFinite(m.scale)) return false;
    return true;
  }
  // Int8 bytes (any view) covering exactly ids.length * DIMS values, or null.
  function asInt8(v, n) {
    if (v == null) return null;
    try {
      if (v instanceof Int8Array) return v.length === n ? v : null;
      if (v instanceof Uint8Array) {
        if (v.length !== n) return null;
        return new Int8Array(v.buffer, v.byteOffset, v.length);
      }
      if (v instanceof ArrayBuffer) {
        if (v.byteLength !== n) return null;
        return new Int8Array(v);
      }
      if (Array.isArray(v)) {
        if (v.length !== n) return null;
        var o = new Int8Array(n);
        for (var i = 0; i < n; i++) o[i] = v[i] | 0;
        return o;
      }
    } catch (e) { return null; }
    return null;
  }

  function fetchBuf(fx, url) {
    return fx(url, { cache: "no-cache" }).then(function (r) {
      if (!r || !r.ok) { var e = new Error("HTTP " + (r && r.status)); e.status = r && r.status; throw e; }
      return r.arrayBuffer();
    });
  }

  /* ── loader (memory-cached; concurrent callers share one flight) ── */
  var _vec = null, _vecP = null;
  function loadVectors(opt) {
    if (_vec) return Promise.resolve(_vec);
    if (_vecP) return _vecP;
    _vecP = _load(opt).then(function (v) { _vec = v; return v; }, function (e) { _vecP = null; throw e; });
    return _vecP;
  }
  function _load(opt) {
    opt = opt || {};
    var storeP = opt.store ? Promise.resolve(opt.store) : idbStore();
    var fx = opt.fetch || null;
    try { if (!fx && typeof fetch !== "undefined") fx = fetch; } catch (e) {}
    return storeP.then(function (store) {
      var metaP = store
        ? store.get(META_PATH).then(function (m) { return validMeta(m) ? m : null; }, function () { return null; })
        : Promise.resolve(null);
      return metaP.then(function (m) {
        if (m) return m;
        if (!fx) throw new Error("no fetch for " + META_PATH);
        return fx(bankBase() + META_PATH, { cache: "no-cache" }).then(function (r) {
          if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
          return r.json();
        }).then(function (j) {
          if (!validMeta(j)) throw new Error("bad vector meta");
          if (store) { try { var _pm = store.put(META_PATH, j); if (_pm && _pm.catch) _pm.catch(function () {}); } catch (e) {} }
          return j;
        });
      }).then(function (meta) {
        var n = meta.ids.length * meta.dims;
        var hitP = store
          ? store.get(VEC_PATH).then(function (v) { return asInt8(v, n); }, function () { return null; })
          : Promise.resolve(null);
        return hitP.then(function (hit) {
          if (hit) return { meta: meta, bytes: hit };
          if (!fx) throw new Error("no fetch for " + VEC_PATH);
          return fetchBuf(fx, bankBase() + VEC_PATH).then(function (ab) {
            var q = asInt8(ab, n);
            if (!q) throw new Error("vector size mismatch: got " + (ab && ab.byteLength) + " want " + n);
            if (store) {
              try { var _pv = store.put(VEC_PATH, ab.slice ? ab.slice(0) : ab); if (_pv && _pv.catch) _pv.catch(function () {}); }
              catch (e) {}
            }
            return { meta: meta, bytes: q };
          });
        }).then(function (r) {
          return { ids: r.meta.ids, dims: r.meta.dims, scale: r.meta.scale, model: r.meta.model || "",
                   matrix: dequantise(r.bytes, r.meta.scale) };
        });
      });
    });
  }
  function cachedVectors() { return _vec; }
  function resetCache() { _vec = null; _vecP = null; }

  /* ── maths (pure; the part the tests pin down) ── */
  // v = q / scale, row-major Int8 into one Float32Array.
  function dequantise(bytes, scale) {
    var n = bytes ? (bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.length) : 0;
    var q = asInt8(bytes, n);
    if (!q) throw new Error("dequantise needs int8 bytes");
    if (typeof scale !== "number" || !(scale > 0) || !isFinite(scale)) throw new Error("dequantise needs a positive scale");
    var out = new Float32Array(q.length), i;
    for (i = 0; i < q.length; i++) out[i] = q[i] / scale;
    return out;
  }
  // Unit length in place (a zero vector stays zero; cosine callers treat it as no match).
  function normaliseInPlace(v) {
    var s = 0, i;
    for (i = 0; i < v.length; i++) s += v[i] * v[i];
    var n = Math.sqrt(s);
    if (n > 1e-12) for (i = 0; i < v.length; i++) v[i] /= n;
    return v;
  }
  // Cosine top-K over a dequantised row-major matrix. Both sides are unit length
  // (rows by construction, the query by normalise), so the dot product is the cosine.
  function cosineTopK(matrix, ids, qv, k) {
    if (!matrix || !ids || !qv || qv.length !== DIMS || ids.length * DIMS > matrix.length) return [];
    k = Math.min(k > 0 ? k : 0, ids.length);
    if (!k) return [];
    var q = normaliseInPlace(Float32Array.from(qv)), scored = new Array(ids.length), d, i, j, s;
    for (i = 0; i < ids.length; i++) {
      s = 0;
      var off = i * DIMS;
      for (j = 0; j < DIMS; j++) s += matrix[off + j] * q[j];
      scored[i] = s;
    }
    var order = new Array(ids.length);
    for (d = 0; d < ids.length; d++) order[d] = d;
    order.sort(function (a, b) { return scored[b] - scored[a]; });
    var out = [];
    for (d = 0; d < k; d++) out.push({ id: ids[order[d]], score: scored[order[d]] });
    return out;
  }
  // Ranked [{ id, score }] for a query vector, or [] when vectors are not loaded.
  function topDiseases(queryVector, k, vec) {
    var v = vec || _vec;
    if (!v || !v.matrix || !v.ids) return [];
    return cosineTopK(v.matrix, v.ids, queryVector, k == null ? TOP_DEFAULT : k);
  }

  /* ── query embedding (native only; null until the native PR lands) ── */
  // kind "query" tells the native side to apply the query prefix
  // ("task: search result | query: ") before encoding, matching the vector set.
  function embedText(text, opt) {
    var L = llamaEmbed();
    if (!L) return Promise.resolve(null);
    var t = String(text == null ? "" : text).slice(0, 500);
    if (!t.trim()) return Promise.resolve(null);
    var p = null;
    try { p = L.embed({ text: t, kind: "query" }); }
    catch (e) { return Promise.resolve(null); }
    return Promise.resolve(p).then(function (r) {
      var v = r && (r.vector || r.embedding || r.data);
      if (!v || v.length !== DIMS) return null;
      var out = new Float32Array(DIMS), i, n;
      for (i = 0; i < DIMS; i++) { n = Number(v[i]); if (!isFinite(n)) return null; out[i] = n; }
      return normaliseInPlace(out);
    }, function () { return null; });
  }

  /* ── the tier: disease ids, best first, or [] on ANY missing piece ── */
  function localTier(query, k, opt) {
    if (!flagOn()) return Promise.resolve([]);
    if (!packReady()) return Promise.resolve([]);
    if (!embedAvailable()) return Promise.resolve([]);
    var t = String(query == null ? "" : query);
    if (!t.trim()) return Promise.resolve([]);
    return loadVectors(opt).then(function (vec) {
      return embedText(t, opt).then(function (qv) {
        if (!qv) return [];
        return topDiseases(qv, k == null ? TOP_DEFAULT : k, vec).map(function (r) { return r.id; });
      });
    }).catch(function () { return []; });
  }

  var API = {
    DIMS: DIMS, FLAG: FLAG, EMBED_ID: EMBED_ID, META_PATH: META_PATH, VEC_PATH: VEC_PATH,
    flagOn: flagOn, setFlag: setFlag,
    embedAvailable: embedAvailable, packReady: packReady,
    loadVectors: loadVectors, cachedVectors: cachedVectors, resetCache: resetCache,
    topDiseases: topDiseases, embedText: embedText, localTier: localTier,
    dequantise: dequantise, normaliseInPlace: normaliseInPlace, cosineTopK: cosineTopK
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  try {
    var _g = glb();
    if (typeof window !== "undefined") _g.SMD_EMBED_LOCAL = API;
  } catch (e) {}
})();
