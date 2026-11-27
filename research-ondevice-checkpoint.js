/* StewardMD - ResearchMD on-device checkpoint store (window.SMD_RMD_CHECKPOINT).
 * ES5 IIFE. Dual export. IndexedDB database "rmd_od" version 1,
 * object store "checkpoints", keyPath "jobKey".
 * Node tests pass a memory backend to _setBackend.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  var DB_NAME = "rmd_od";
  var DB_VERSION = 1;
  var STORE = "checkpoints";

  var backend = null;
  var fallbackMap = {};
  var useFallback = false;
  var cachedDb = null;
  var modePromise = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function indexedDBFactory() {
    if (backend) return null;
    try {
      if (G && G.indexedDB) return G.indexedDB;
    } catch (e) {}
    return null;
  }

  function memRecords() {
    if (!backend.records || typeof backend.records !== "object" || Object.prototype.toString.call(backend.records) === "[object Array]") {
      backend.records = {};
    }
    return backend.records;
  }

  function openDb() {
    if (cachedDb) return Promise.resolve(cachedDb);
    return new Promise(function (resolve, reject) {
      var factory = indexedDBFactory();
      var req;
      if (!factory || !factory.open) {
        reject(new Error("no indexedDB"));
        return;
      }
      try {
        req = factory.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (db.objectStoreNames && !db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "jobKey" });
        }
      };
      req.onsuccess = function () {
        cachedDb = req.result;
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("idb open failed"));
      };
    });
  }

  function chooseMode() {
    if (backend) {
      useFallback = false;
      return Promise.resolve("memory");
    }
    if (!indexedDBFactory()) {
      useFallback = true;
      return Promise.resolve("fallback");
    }
    return openDb().then(function () {
      useFallback = false;
      return "idb";
    }).catch(function () {
      useFallback = true;
      cachedDb = null;
      return "fallback";
    });
  }

  function ready() {
    if (!modePromise) modePromise = chooseMode();
    return modePromise;
  }

  function idbGet(jobKey) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var found = null;
        var req = tx.objectStore(STORE).get(jobKey);
        req.onsuccess = function () { found = req.result || null; };
        tx.oncomplete = function () { resolve(found ? clone(found) : null); };
        tx.onerror = function () { reject(tx.error || new Error("idb get failed")); };
      });
    });
  }

  function idbPut(rec) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(clone(rec));
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error("idb put failed")); };
      });
    });
  }

  function idbRemove(jobKey) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(jobKey);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error("idb delete failed")); };
      });
    });
  }

  function idbList(prefix) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).openCursor();
        var out = [];
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) return;
          var rec = cur.value;
          if (rec && typeof rec.jobKey === "string" && (!prefix || rec.jobKey.indexOf(prefix) === 0)) {
            out.push(clone(rec));
          }
          cur.continue();
        };
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = function () { reject(tx.error || new Error("idb list failed")); };
      });
    });
  }

  function get(jobKey) {
    if (jobKey == null || String(jobKey) === "") return Promise.resolve(null);
    var key = String(jobKey);
    return ready().then(function () {
      if (backend) {
        var rec = memRecords()[key];
        return rec && rec.value !== undefined ? clone(rec.value) : null;
      }
      if (useFallback) {
        var fb = fallbackMap[key];
        return fb && fb.value !== undefined ? clone(fb.value) : null;
      }
      return idbGet(key).then(function (rec) {
        return rec && rec.value !== undefined ? clone(rec.value) : null;
      });
    });
  }

  function put(jobKey, value) {
    if (jobKey == null || String(jobKey) === "") {
      return Promise.reject(new Error("checkpoint: jobKey is required"));
    }
    if (value === undefined) {
      return Promise.reject(new Error("checkpoint: value is required"));
    }
    var key = String(jobKey);
    var safe;
    try {
      safe = clone(value);
    } catch (e) {
      return Promise.reject(new Error("checkpoint: value must be JSON-serializable"));
    }
    var rec = { jobKey: key, value: safe, updatedAt: nowIso() };
    return ready().then(function () {
      if (backend) {
        memRecords()[key] = rec;
        return;
      }
      if (useFallback) {
        fallbackMap[key] = rec;
        return;
      }
      return idbPut(rec);
    });
  }

  function remove(jobKey) {
    if (jobKey == null || String(jobKey) === "") return Promise.resolve();
    var key = String(jobKey);
    return ready().then(function () {
      if (backend) {
        delete memRecords()[key];
        return;
      }
      if (useFallback) {
        delete fallbackMap[key];
        return;
      }
      return idbRemove(key);
    });
  }

  function list(prefix) {
    var p = prefix == null ? "" : String(prefix);
    return ready().then(function () {
      if (backend || useFallback) {
        var map = backend ? memRecords() : fallbackMap;
        var keys = Object.keys(map);
        var out = [];
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (!p || k.indexOf(p) === 0) {
            var rec = map[k];
            if (rec) out.push({ jobKey: rec.jobKey, value: clone(rec.value), updatedAt: rec.updatedAt });
          }
        }
        out.sort(function (a, b) { return a.jobKey < b.jobKey ? -1 : (a.jobKey > b.jobKey ? 1 : 0); });
        return out;
      }
      return idbList(p).then(function (recs) {
        var out = [];
        for (var i = 0; i < recs.length; i++) {
          out.push({ jobKey: recs[i].jobKey, value: clone(recs[i].value), updatedAt: recs[i].updatedAt });
        }
        out.sort(function (a, b) { return a.jobKey < b.jobKey ? -1 : (a.jobKey > b.jobKey ? 1 : 0); });
        return out;
      });
    });
  }

  function setBackend(memoryBackend) {
    if (memoryBackend && typeof memoryBackend === "object") {
      backend = memoryBackend;
      memRecords();
    } else if (memoryBackend) {
      backend = { records: {} };
    } else {
      backend = null;
    }
    fallbackMap = {};
    useFallback = false;
    cachedDb = null;
    modePromise = null;
    return Promise.resolve();
  }

  var API = {
    get: get,
    put: put,
    remove: remove,
    list: list,
    _setBackend: setBackend
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RMD_CHECKPOINT = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
