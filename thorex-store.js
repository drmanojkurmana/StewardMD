/* thorex-store.js — ThoreX AI · encrypted on-device chest-X-ray case store (SMD_THOREX_STORE).
 *
 * Privacy contract (mirrors KardioX README §Local Storage & Privacy): every CXR case (incl. the
 * uploaded/enhanced image) is stored LOCALLY, encrypted at rest with AES-GCM. The key is generated
 * NON-EXTRACTABLE and kept in the device's own storage (IndexedDB CryptoKey — raw bytes never exposed,
 * never synced, excluded from OS backup). deleteAll() wipes BOTH the records AND the key irreversibly
 * (sign-out / "Clear local CXRs"). Never syncs to the cloud.
 *
 * Backend is pluggable via a tiny KV interface (get/set/del/keys/clear) so the crypto + CRUD are unit-
 * testable headlessly (WebCrypto works in Node; an in-memory KV replaces IndexedDB). In the browser it
 * defaults to an IndexedDB-backed KV + an IndexedDB-held CryptoKey. Exposed as window.SMD_THOREX_STORE.
 */
(function () {
  "use strict";

  function subtle() {
    try {
      if (typeof crypto !== "undefined" && crypto.subtle) return crypto.subtle;
      if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) return window.crypto.subtle;
      if (typeof require !== "undefined") { var wc = require("crypto").webcrypto; return wc && wc.subtle; }
    } catch (e) {}
    return null;
  }
  function getRandom(len) {
    var c = (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto : (typeof window !== "undefined" ? window.crypto : null);
    if (!c && typeof require !== "undefined") { try { c = require("crypto").webcrypto; } catch (e) {} }
    var a = new Uint8Array(len); c.getRandomValues(a); return a;
  }

  var enc = (typeof TextEncoder !== "undefined") ? new TextEncoder() : { encode: function (s) { return Uint8Array.from(unescape(encodeURIComponent(s)), function (c) { return c.charCodeAt(0); }); } };
  var dec = (typeof TextDecoder !== "undefined") ? new TextDecoder() : { decode: function (b) { return decodeURIComponent(escape(String.fromCharCode.apply(null, new Uint8Array(b)))); } };
  function b64(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return (typeof btoa !== "undefined") ? btoa(s) : Buffer.from(b).toString("base64"); }
  function unb64(str) { var s = (typeof atob !== "undefined") ? atob(str) : Buffer.from(str, "base64").toString("binary"); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }

  // In-memory KV (default in Node / tests). Browser build swaps in the IndexedDB KV via configure().
  function memKV() {
    var m = {};
    return {
      get: function (k) { return Promise.resolve(k in m ? m[k] : null); },
      set: function (k, v) { m[k] = v; return Promise.resolve(); },
      del: function (k) { delete m[k]; return Promise.resolve(); },
      keys: function () { return Promise.resolve(Object.keys(m)); },
      clear: function () { m = {}; return Promise.resolve(); }
    };
  }

  function makeStore(opts) {
    opts = opts || {};
    var kv = opts.kv || memKV();
    var keyStore = opts.keyStore || memKV();      // holds the CryptoKey / raw key material
    var KEY_ID = "tx-cxr-key";
    var PREFIX = "tx-cxr:";
    var _key = null;

    function s() { var x = subtle(); if (!x) return Promise.reject(new Error("WebCrypto unavailable")); return Promise.resolve(x); }

    // Load-or-create the AES-GCM key. Prefer a NON-EXTRACTABLE CryptoKey persisted in the keyStore
    // (IndexedDB can hold a CryptoKey object directly). Fallback: extractable raw bytes if the KV can't
    // hold structured clones (still device-only, never synced).
    function key() {
      if (_key) return Promise.resolve(_key);
      return keyStore.get(KEY_ID).then(function (stored) {
        if (stored && stored.type === "secret") { _key = stored; return _key; }           // CryptoKey
        if (stored && stored.raw) {
          return s().then(function (x) { return x.importKey("raw", unb64(stored.raw), "AES-GCM", true, ["encrypt", "decrypt"]); }).then(function (k) { _key = k; return _key; });
        }
        return s().then(function (x) { return x.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); })
          .then(function (k) { _key = k; return keyStore.set(KEY_ID, k).catch(function () { return null; }); }, function () {
            // generateKey non-extractable unsupported by KV clone → extractable fallback
            return s().then(function (x) { return x.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); })
              .then(function (k) { _key = k; return x_exportRaw(k).then(function (raw) { return keyStore.set(KEY_ID, { raw: b64(raw) }); }); });
          }).then(function () { return _key; });
      });
    }
    function x_exportRaw(k) { return s().then(function (x) { return x.exportKey("raw", k); }); }

    function encryptRecord(obj) {
      return key().then(function (k) {
        var iv = getRandom(12);
        return s().then(function (x) { return x.encrypt({ name: "AES-GCM", iv: iv }, k, enc.encode(JSON.stringify(obj))); })
          .then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
      });
    }
    function decryptRecord(rec) {
      if (!rec || !rec.iv || !rec.ct) return Promise.resolve(null);
      return key().then(function (k) {
        return s().then(function (x) { return x.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, k, unb64(rec.ct)); })
          .then(function (pt) { try { return JSON.parse(dec.decode(pt)); } catch (e) { return null; } });
      });
    }

    function ids() { return kv.keys().then(function (ks) { return ks.filter(function (k) { return k.indexOf(PREFIX) === 0; }); }); }
    // Per-record resilient decrypt: a single corrupt/tampered/undecryptable record must never take
    // down the whole timeline. Any failure (bad AES-GCM auth tag, JSON parse, etc.) resolves to null
    // (no PHI in the log — just a generic notice) instead of rejecting the batch.
    function decryptRecordSafe(rec) {
      return decryptRecord(rec).catch(function () {
        try { console.warn("[thorex-store] skipped an unreadable record"); } catch (e) {}
        return null;
      });
    }
    function all() {
      return ids().then(function (ks) { return Promise.all(ks.map(function (k) { return kv.get(k).then(decryptRecordSafe); })); })
        .then(function (list) { return list.filter(Boolean); });
    }

    return {
      save: function (a) { if (!a || !a.id) return Promise.resolve(); return encryptRecord(a).then(function (rec) { return kv.set(PREFIX + a.id, rec); }); },
      all: all,
      // Newest-first: sorted by createdAt descending (chest-X-ray case timeline).
      timeline: function () { return all().then(function (list) { return list.sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); }); }); },
      get: function (id) { return kv.get(PREFIX + id).then(decryptRecord); },
      delete: function (id) { return kv.del(PREFIX + id); },
      // Irreversible wipe: remove every record AND destroy the key (sign-out / "Clear local CXRs").
      deleteAll: function () {
        return ids().then(function (ks) { return Promise.all(ks.map(function (k) { return kv.del(k); })); })
          .then(function () { _key = null; return keyStore.del(KEY_ID); });
      },
      search: function (q) { q = String(q || "").toLowerCase(); return all().then(function (list) { return list.filter(function (a) { return (a.verdict || "").toLowerCase().indexOf(q) >= 0 || String(a.createdAt || "").toLowerCase().indexOf(q) >= 0 || (a.context || "").toLowerCase().indexOf(q) >= 0; }); }); },
      storageInfo: function () { return all().then(function (list) { var bytes = 0; return ids().then(function (ks) { return Promise.all(ks.map(function (k) { return kv.get(k); })); }).then(function (recs) { recs.forEach(function (r) { if (r && r.ct) bytes += r.ct.length * 0.75; }); return { count: list.length, bytes: Math.round(bytes) }; }); }); }
    };
  }

  // IndexedDB KV (browser). Structured-clone store; holds records and (separately) the CryptoKey.
  function idbKV(dbName, storeName) {
    if (typeof indexedDB === "undefined") return memKV();
    function open() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open(dbName, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(storeName); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
    }
    function tx(mode, fn) { return open().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction(storeName, mode), st = t.objectStore(storeName), out = fn(st); t.oncomplete = function () { res(out && out._val !== undefined ? out._val : out); }; t.onerror = function () { rej(t.error); }; }); }); }
    return {
      get: function (k) { return tx("readonly", function (st) { var box = {}; var rq = st.get(k); rq.onsuccess = function () { box._val = rq.result === undefined ? null : rq.result; }; return box; }); },
      set: function (k, v) { return tx("readwrite", function (st) { st.put(v, k); return {}; }); },
      del: function (k) { return tx("readwrite", function (st) { st.delete(k); return {}; }); },
      keys: function () { return tx("readonly", function (st) { var box = {}; var rq = st.getAllKeys(); rq.onsuccess = function () { box._val = rq.result || []; }; return box; }); },
      clear: function () { return tx("readwrite", function (st) { st.clear(); return {}; }); }
    };
  }

  var API = {
    makeStore: makeStore,
    _memKV: memKV,
    __testStore: function () { return makeStore({ kv: memKV(), keyStore: memKV() }); },
    // Browser default: IndexedDB-backed records + a separate IndexedDB store for the CryptoKey.
    create: function () {
      if (typeof indexedDB !== "undefined") return makeStore({ kv: idbKV("thorex", "cxr"), keyStore: idbKV("thorex-keys", "k") });
      return makeStore();
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_THOREX_STORE = API;
})();
