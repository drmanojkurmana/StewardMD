/* kb/ai/maik-book-vec.js — window.SMD_MAIK_BOOK_VEC
 *
 * Meaning search over the offline book, for the ONE case where keyword search carries the answer
 * alone: the router named no disease. MaiK Lite's book search (maik-local.js retrieveGrounding)
 * then fuses its keyword pool with the nearest book rows by EmbeddingGemma 2 vectors.
 *
 * Measured 2026-11-21 (scripts bench, real book, phone-identical prefixes, int8 vectors):
 *   router-miss key points 49.0% -> 54.5%; 390 cancer questions 42.7% -> 50.6%.
 *   When the router DID name a disease, fusion did not help (85.4% -> 84.8%), so it never runs then.
 *
 * Runs only when ALL hold, else every call yields null and retrieval is exactly as before:
 *   - flag smd_maik_book_vec === "1" (default OFF)
 *   - the active book is the one these vectors were built for (meta.bookSha256 === KB store SHA256)
 *   - the On-phone search pack is installed and the native embed() exists (window.SMD_EMBED_LOCAL)
 * Vectors: 55,385 x 768 int8 (42.5 MB) fetched once from models.stewardmd.in and kept in IndexedDB
 * under their sha256. Never dequantised in memory: dot products run on the int8 rows.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SMD_MAIK_BOOK_VEC = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FLAG = "smd_maik_book_vec";
  var BASE = "https://models.stewardmd.in/maik/maik-lite-kb-onco1.vec-q8";
  var META_SHA = "25a4558667efe3a8";      // first 16 hex of the uploaded .i8 sha256 (staleness key)
  var DIMS = 768;
  var POOL = 30;                          // dense candidates fused with the keyword pool
  var RRF_K = 60;
  var MIN_ROW_CHARS = 250;                // same floor Book.search applies (maik-lite-rag.js MIN_CHUNK)
  var IDB = "smd-maik-bookvec", STORE = "v";

  function g() { return (typeof window !== "undefined") ? window : (typeof self !== "undefined" ? self : {}); }
  function lget(k) { try { return g().localStorage.getItem(k); } catch (e) { return null; } }
  function flagOn() { return lget(FLAG) === "1"; }
  function embedder() { var E = g().SMD_EMBED_LOCAL; return (E && E.packReady && E.packReady() && E.embedAvailable && E.embedAvailable()) ? E : null; }

  var _meta = null, _vec = null, _p = null;

  /** Cheap synchronous gate: flag, search pack, native embed. The book check happens in load(). */
  function available() { return flagOn() && !!embedder(); }

  function idb(mode, fn) {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open(IDB, 1);
        rq.onupgradeneeded = function () { try { rq.result.createObjectStore(STORE); } catch (e) {} };
        rq.onsuccess = function () {
          try {
            var t = rq.result.transaction(STORE, mode), r = fn(t.objectStore(STORE));
            t.oncomplete = function () { res(r && ("result" in Object(r)) ? r.result : null); };
            t.onerror = function () { res(null); };
          } catch (e) { res(null); }
        };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }

  /** Meta + int8 rows, or rejects. Cached in memory and IndexedDB; a different book rejects. */
  function load(opt) {
    if (_vec) return Promise.resolve({ meta: _meta, vec: _vec });
    if (_p) return _p;
    var fx = (opt && opt.fetch) || g().fetch;
    if (typeof fx !== "function") return Promise.reject(new Error("no fetch"));
    var kbSha = (opt && opt.bookSha) || (g().SMD_MAIK_KB_STORE && g().SMD_MAIK_KB_STORE.SHA256);
    _p = fx(BASE + ".json").then(function (r) { if (!r.ok) throw new Error("meta " + r.status); return r.json(); })
      .then(function (m) {
        if (!m || m.dims !== DIMS || !(m.scale > 0) || !m.rows) throw new Error("bad meta");
        if (m.bookSha256 !== kbSha) throw new Error("vectors are for another book");
        if (String(m.sha256 || "").slice(0, 16) !== META_SHA) throw new Error("unexpected vector file");
        return (opt && opt.store === false ? Promise.resolve(null) : idb("readonly", function (s) { return s.get(META_SHA); }))
          .then(function (cached) {
            if (cached && cached.byteLength === m.rows * DIMS) return { m: m, ab: cached };
            return fx(BASE + ".i8").then(function (r) { if (!r.ok) throw new Error("vectors " + r.status); return r.arrayBuffer(); })
              .then(function (ab) {
                if (ab.byteLength !== m.rows * DIMS) throw new Error("vector size " + ab.byteLength);
                if (!(opt && opt.store === false)) idb("readwrite", function (s) { s.clear(); return s.put(ab, META_SHA); });
                return { m: m, ab: ab };
              });
          });
      }).then(function (x) { _meta = x.m; _vec = new Int8Array(x.ab); return { meta: _meta, vec: _vec }; })
      .catch(function (e) { _p = null; throw e; });
    return _p;
  }

  /** Top-k row indices by cosine to a unit query vector, int8 rows (score scaled back to cosine). */
  function topRowsFor(qv, vec, meta, k, rows) {
    var n = meta.rows, s = new Float32Array(n), i, d, o, acc;
    for (i = 0; i < n; i++) {
      acc = 0; o = i * DIMS;
      for (d = 0; d < DIMS; d++) acc += vec[o + d] * qv[d];
      s[i] = acc / meta.scale;
    }
    var idx = [];
    for (i = 0; i < n; i++) if (!rows || (rows[i] && String(rows[i].text || "").length >= MIN_ROW_CHARS)) idx.push(i);
    idx.sort(function (a, b) { return s[b] - s[a]; });
    var out = [];
    for (i = 0; i < Math.min(k, idx.length); i++) out.push([s[idx[i]], idx[i]]);
    return out;
  }

  /** Dense pool for a question: [[cosine, row], ...] best first, or null when anything is missing. */
  function topRows(question, k, rows, opt) {
    if (!available() && !(opt && opt.force)) return Promise.resolve(null);
    var E = (opt && opt.embedder) || embedder();
    var lp;
    try { lp = load(opt); } catch (e) { return Promise.resolve(null); }   // never throw into the search
    return lp.then(function (x) {
      return E.embedText(String(question || "")).then(function (qv) {
        if (!qv || qv.length !== DIMS) return null;
        return topRowsFor(qv, x.vec, x.meta, k || POOL, rows);
      });
    }).catch(function () { return null; });
  }

  /** Reciprocal-rank fusion of the keyword pool and the dense pool, in Book.search's [score, row]
   * shape. Keyword hits keep their own score; dense-only rows get a keyword-scale score so the
   * MIN_SCORE gate and the rerank downstream treat them like any other candidate. */
  function fuse(bm, dense, k, minScore) {
    if (!dense || !dense.length) return bm.slice(0, k);
    var rrf = {}, order = [], bmScore = {}, sim = {}, top = bm.length ? bm[0][0] : minScore;
    function add(i, r) { if (!(i in rrf)) { rrf[i] = 0; order.push(i); } rrf[i] += 1 / (RRF_K + r); }
    bm.forEach(function (h, r) { bmScore[h[1]] = h[0]; add(h[1], r); });
    dense.forEach(function (h, r) { sim[h[1]] = h[0]; add(h[1], r); });
    order.sort(function (a, b) { return rrf[b] - rrf[a]; });
    return order.slice(0, k).map(function (i) {
      return [(i in bmScore) ? bmScore[i] : Math.max(minScore, top * sim[i]), i];
    });
  }

  function reset() { _meta = null; _vec = null; _p = null; }

  return { FLAG: FLAG, DIMS: DIMS, POOL: POOL, available: available, load: load, topRows: topRows,
           topRowsFor: topRowsFor, fuse: fuse, reset: reset };
});
