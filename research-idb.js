/* StewardMD - ResearchMD record store (window.RMDStore).
 * ES5 IIFE. Dual export. IndexedDB database "rmd" version 1,
 * object store "records", index byProjectKind.
 * Node tests pass a memory backend to _setBackend.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  var DB_NAME = "rmd";
  var DB_VERSION = 1;
  var STORE = "records";
  var INDEX = "byProjectKind";
  var FALLBACK_KEY = "rmd.v1.fallbackRecords";
  var CHANGE_KEY = "rmd.v1.lastChangeAt";
  var JSON_MSG = "research: store values must be JSON";
  var KIND_MSG = "research: unknown record kind";
  var FORMAT_MSG = "research: not an rmd data file";
  var MODE_MSG = "research: import mode must be merge or replace";
  var MC_KEY = "smd_rmd_masterchart_v1";
  var PLAN_PREFIX = "smd_research_plan_";
  var NOTICE = "Research data is saved in this browser for now. Back up when you can.";
  var FALLBACK_KINDS = [
    "casefile", "masterchart", "image", "randomlist", "randomfingerprint", "consort",
    "iec", "ctri", "blinding", "samplesize", "draftmeta", "pubconsent"
  ];

  var backend = null;
  var useFallback = false;
  var cachedDb = null;
  var modePromise = null;
  var bannerShown = false;

  function tagOf(value) {
    return Object.prototype.toString.call(value);
  }

  function isArray(value) {
    return tagOf(value) === "[object Array]";
  }

  function kindList() {
    var C = G && G.SMD_RESEARCH_CONTRACTS;
    if (C && isArray(C.STORE_KINDS) && C.STORE_KINDS.length) return C.STORE_KINDS;
    return FALLBACK_KINDS;
  }

  function kindOk(kind) {
    var list = kindList();
    var i;
    for (i = 0; i < list.length; i++) if (list[i] === kind) return true;
    return false;
  }

  function keyOf(projectId, kind, id) {
    return String(projectId) + "|" + kind + "|" + String(id);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function walkJson(value, seen) {
    var t, i, keys, tag;
    tag = tagOf(value);
    if (tag === "[object Blob]" || tag === "[object File]" || tag === "[object ArrayBuffer]") return false;
    if (value === null) return true;
    t = typeof value;
    if (t === "string" || t === "boolean") return true;
    if (t === "number") {
      if (value !== value || value === Infinity || value === -Infinity) return false;
      if (value === 0 && 1 / value < 0) return false;
      return true;
    }
    if (t !== "object") return false;
    if (tag !== "[object Object]" && tag !== "[object Array]") return false;
    if (typeof value.toJSON === "function") return false;
    for (i = 0; i < seen.length; i++) if (seen[i] === value) return false;
    seen.push(value);
    if (tag === "[object Array]") {
      for (i = 0; i < value.length; i++) {
        if (!walkJson(value[i], seen)) return false;
      }
    } else {
      keys = Object.keys(value);
      for (i = 0; i < keys.length; i++) {
        if (!walkJson(value[keys[i]], seen)) return false;
      }
    }
    seen.pop();
    return true;
  }

  function jsonSafe(value) {
    if (!walkJson(value, [])) return false;
    try {
      JSON.parse(JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function lsBag() {
    if (!backend) return null;
    if (!backend.local || typeof backend.local !== "object" || isArray(backend.local)) backend.local = {};
    return backend.local;
  }

  function lsGet(name) {
    var bag = lsBag();
    if (bag) {
      if (!Object.prototype.hasOwnProperty.call(bag, name) || bag[name] == null) return null;
      return String(bag[name]);
    }
    try {
      if (!G || !G.localStorage) return null;
      return G.localStorage.getItem(name);
    } catch (e) {
      return null;
    }
  }

  function lsSet(name, value) {
    var bag = lsBag();
    if (bag) {
      bag[name] = String(value);
      return;
    }
    try {
      if (G && G.localStorage) G.localStorage.setItem(name, String(value));
    } catch (e) {}
  }

  function lsKeys() {
    var bag = lsBag();
    var keys = [];
    var i, k;
    if (bag) return Object.keys(bag);
    try {
      if (!G || !G.localStorage) return keys;
      for (i = 0; i < G.localStorage.length; i++) {
        k = G.localStorage.key(i);
        if (k) keys.push(k);
      }
    } catch (e2) {}
    return keys;
  }

  function touchChange() {
    lsSet(CHANGE_KEY, nowIso());
  }

  function docBody() {
    var doc = G && G.document;
    if (!doc || !doc.createElement || !doc.body || !doc.getElementById) return null;
    return doc;
  }

  function hideBanner() {
    var doc, el;
    bannerShown = false;
    doc = docBody();
    if (!doc) return;
    el = doc.getElementById("rmdStoreFallback");
    if (el && el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el);
  }

  function showBanner() {
    var doc, el, body;
    if (bannerShown) return;
    bannerShown = true;
    doc = docBody();
    if (!doc) return;
    if (doc.getElementById("rmdStoreFallback")) return;
    el = doc.createElement("div");
    el.id = "rmdStoreFallback";
    el.className = "rmd-banner rmd-banner-info";
    if (el.setAttribute) el.setAttribute("role", "status");
    el.textContent = NOTICE;
    body = doc.body;
    if (body.firstChild && body.insertBefore) body.insertBefore(el, body.firstChild);
    else if (body.appendChild) body.appendChild(el);
  }

  function readFallbackMap() {
    var raw, parsed;
    raw = lsGet(FALLBACK_KEY);
    if (!raw) return {};
    try {
      parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !isArray(parsed)) return parsed;
    } catch (e) {}
    return {};
  }

  function writeFallbackMap(map) {
    lsSet(FALLBACK_KEY, JSON.stringify(map));
  }

  function memRecords() {
    if (!backend.records || typeof backend.records !== "object" || isArray(backend.records)) backend.records = {};
    return backend.records;
  }

  function indexedDBFactory() {
    if (backend) return null;
    try {
      if (G && G.indexedDB) return G.indexedDB;
    } catch (e) {}
    return null;
  }

  function openDb() {
    if (cachedDb) return Promise.resolve(cachedDb);
    return new Promise(function (resolve, reject) {
      var factory, req;
      factory = indexedDBFactory();
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
        var store;
        if (db.objectStoreNames && !db.objectStoreNames.contains(STORE)) {
          store = db.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex(INDEX, ["projectId", "kind"], { unique: false });
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

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, req, found;
        tx = db.transaction(STORE, "readonly");
        found = null;
        req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { found = req.result || null; };
        tx.oncomplete = function () { resolve(found ? clone(found) : null); };
        tx.onerror = function () { reject(tx.error || new Error("idb get failed")); };
      });
    });
  }

  function idbPut(rec) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(clone(rec));
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error("idb put failed")); };
      });
    });
  }

  function idbDelete(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error("idb delete failed")); };
      });
    });
  }

  function idbClear() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error("idb clear failed")); };
      });
    });
  }

  function cursorCollect(req, tx, accept) {
    return new Promise(function (resolve, reject) {
      var out = [];
      req.onsuccess = function () {
        var cur = req.result;
        if (!cur) return;
        if (!accept || accept(cur.value)) out.push(clone(cur.value));
        cur.continue();
      };
      tx.oncomplete = function () { resolve(out); };
      tx.onerror = function () { reject(tx.error || new Error("idb cursor failed")); };
    });
  }

  function idbAll() {
    return openDb().then(function (db) {
      var tx, req;
      tx = db.transaction(STORE, "readonly");
      req = tx.objectStore(STORE).openCursor();
      return cursorCollect(req, tx, null);
    });
  }

  function idbList(projectId, kind) {
    return openDb().then(function (db) {
      var tx, store, index, req, range, pid;
      pid = String(projectId);
      tx = db.transaction(STORE, "readonly");
      store = tx.objectStore(STORE);
      if (store.indexNames && store.indexNames.contains(INDEX) && typeof IDBKeyRange !== "undefined") {
        index = store.index(INDEX);
        range = IDBKeyRange.only([pid, kind]);
        req = index.openCursor(range);
      } else {
        req = store.openCursor();
      }
      return cursorCollect(req, tx, function (rec) {
        return rec && String(rec.projectId) === pid && rec.kind === kind;
      });
    });
  }

  function onFallback() {
    return !backend && (useFallback || !indexedDBFactory());
  }

  function readAll() {
    var map, keys, out, i, rec;
    if (backend) {
      map = memRecords();
      keys = Object.keys(map);
      out = [];
      for (i = 0; i < keys.length; i++) {
        rec = map[keys[i]];
        if (rec) out.push(clone(rec));
      }
      return Promise.resolve(out);
    }
    if (onFallback()) {
      map = readFallbackMap();
      keys = Object.keys(map);
      out = [];
      for (i = 0; i < keys.length; i++) {
        rec = map[keys[i]];
        if (rec) out.push(clone(rec));
      }
      return Promise.resolve(out);
    }
    return idbAll();
  }

  function writeRecord(rec) {
    var map, copy;
    copy = clone(rec);
    if (backend) {
      memRecords()[copy.key] = copy;
      return Promise.resolve();
    }
    if (onFallback()) {
      map = readFallbackMap();
      map[copy.key] = copy;
      writeFallbackMap(map);
      return Promise.resolve();
    }
    return idbPut(copy);
  }

  function readRecord(key) {
    var map, rec;
    if (backend) {
      rec = memRecords()[key];
      return Promise.resolve(rec ? clone(rec) : null);
    }
    if (onFallback()) {
      map = readFallbackMap();
      rec = map[key];
      return Promise.resolve(rec ? clone(rec) : null);
    }
    return idbGet(key);
  }

  function deleteRecord(key) {
    var map;
    if (backend) {
      delete memRecords()[key];
      return Promise.resolve();
    }
    if (onFallback()) {
      map = readFallbackMap();
      delete map[key];
      writeFallbackMap(map);
      return Promise.resolve();
    }
    return idbDelete(key);
  }

  function clearRecords() {
    if (backend) {
      backend.records = {};
      return Promise.resolve();
    }
    if (onFallback()) {
      writeFallbackMap({});
      return Promise.resolve();
    }
    return idbClear();
  }

  function listRecords(projectId, kind) {
    var pid = String(projectId);
    if (backend || onFallback()) {
      return readAll().then(function (all) {
        var out = [];
        var i;
        for (i = 0; i < all.length; i++) {
          if (String(all[i].projectId) === pid && all[i].kind === kind) out.push(all[i]);
        }
        return out;
      });
    }
    return idbList(projectId, kind);
  }

  function sortBy(list, field) {
    list.sort(function (a, b) {
      var ak = String(a[field] || "");
      var bk = String(b[field] || "");
      if (ak < bk) return -1;
      if (ak > bk) return 1;
      return 0;
    });
    return list;
  }

  function badPut(msg) {
    return { ok: false, warnings: [msg] };
  }

  function put(projectId, kind, id, value) {
    return ready().then(function () {
      var rec;
      if (projectId == null || id == null || String(projectId) === "" || String(id) === "") return badPut(JSON_MSG);
      if (!kindOk(kind)) return badPut(KIND_MSG);
      if (!jsonSafe(value)) return badPut(JSON_MSG);
      rec = {
        key: keyOf(projectId, kind, id),
        projectId: String(projectId),
        kind: kind,
        id: String(id),
        value: clone(value),
        updatedAt: nowIso()
      };
      return writeRecord(rec).then(function () {
        touchChange();
      });
    });
  }

  function get(projectId, kind, id) {
    return ready().then(function () {
      return readRecord(keyOf(projectId, kind, id)).then(function (rec) {
        if (!rec || rec.value === undefined) return null;
        return clone(rec.value);
      });
    });
  }

  function list(projectId, kind) {
    return ready().then(function () {
      return listRecords(projectId, kind).then(function (recs) {
        var out = [];
        var i;
        for (i = 0; i < recs.length; i++) {
          out.push({
            id: recs[i].id,
            value: clone(recs[i].value),
            updatedAt: recs[i].updatedAt
          });
        }
        return sortBy(out, "id");
      });
    });
  }

  function remove(projectId, kind, id) {
    return ready().then(function () {
      return deleteRecord(keyOf(projectId, kind, id)).then(function () {
        touchChange();
      });
    });
  }

  function exportAll(opts) {
    var includeImages = !(opts && opts.includeImages === false);
    return ready().then(function () {
      return readAll().then(function (all) {
        var records = [];
        var i;
        for (i = 0; i < all.length; i++) {
          if (!includeImages && all[i].kind === "image") continue;
          records.push(clone(all[i]));
        }
        sortBy(records, "key");
        return {
          format: "rmd-data",
          version: 1,
          exportedAt: nowIso(),
          records: records
        };
      });
    });
  }

  function emptyImport(warnings) {
    return { ok: false, added: 0, updated: 0, skipped: 0, warnings: warnings };
  }

  function normaliseIncoming(raw) {
    var projectId, kind, id, value;
    if (!raw || typeof raw !== "object" || isArray(raw)) return null;
    projectId = raw.projectId;
    kind = raw.kind;
    id = raw.id;
    value = raw.value;
    if (projectId == null || id == null || String(projectId) === "" || String(id) === "") return null;
    if (!kindOk(kind)) return null;
    if (!jsonSafe(value)) return null;
    return {
      key: keyOf(projectId, kind, id),
      projectId: String(projectId),
      kind: kind,
      id: String(id),
      value: clone(value),
      updatedAt: raw.updatedAt ? String(raw.updatedAt) : nowIso()
    };
  }

  function writeSeq(list, idx) {
    if (idx >= list.length) return Promise.resolve();
    return writeRecord(list[idx]).then(function () {
      return writeSeq(list, idx + 1);
    });
  }

  function importAll(data, mode) {
    return ready().then(function () {
      var incoming, i, rec, added, updated, skipped;
      if (!data || data.format !== "rmd-data" || data.version !== 1 || !isArray(data.records)) {
        return emptyImport([FORMAT_MSG]);
      }
      if (mode !== "merge" && mode !== "replace") return emptyImport([MODE_MSG]);
      incoming = [];
      skipped = 0;
      for (i = 0; i < data.records.length; i++) {
        rec = normaliseIncoming(data.records[i]);
        if (!rec) { skipped += 1; continue; }
        incoming.push(rec);
      }
      return readAll().then(function (existing) {
        var prev = {};
        var j, toWrite;
        for (j = 0; j < existing.length; j++) prev[existing[j].key] = existing[j];
        added = 0;
        updated = 0;
        if (mode === "replace") {
          for (j = 0; j < incoming.length; j++) {
            if (prev[incoming[j].key]) updated += 1;
            else added += 1;
          }
          return clearRecords().then(function () {
            return writeSeq(incoming, 0);
          }).then(function () {
            return { added: added, updated: updated, skipped: skipped };
          });
        }
        toWrite = [];
        for (j = 0; j < incoming.length; j++) {
          rec = incoming[j];
          if (!prev[rec.key]) {
            added += 1;
            toWrite.push(rec);
          } else if (String(rec.updatedAt) > String(prev[rec.key].updatedAt || "")) {
            updated += 1;
            toWrite.push(rec);
          } else {
            skipped += 1;
          }
        }
        return writeSeq(toWrite, 0).then(function () {
          return { added: added, updated: updated, skipped: skipped };
        });
      }).then(function (counts) {
        if (counts.added + counts.updated > 0) touchChange();
        return {
          ok: true,
          added: counts.added,
          updated: counts.updated,
          skipped: counts.skipped,
          warnings: []
        };
      });
    }).catch(function () {
      return emptyImport([FORMAT_MSG]);
    });
  }

  function writeIfAbsent(rec) {
    return readRecord(rec.key).then(function (existing) {
      if (existing) return;
      return writeRecord(rec);
    });
  }

  function migrateInner() {
    var jobs = [];
    var raw, parsed, keys, i, pid, chart, suffix, planRaw, plan;
    try {
      raw = lsGet(MC_KEY);
      if (raw) {
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        if (parsed && typeof parsed === "object" && !isArray(parsed)) {
          keys = Object.keys(parsed);
          for (i = 0; i < keys.length; i++) {
            pid = keys[i];
            chart = parsed[pid];
            if (!pid || !jsonSafe(chart)) continue;
            jobs.push({
              key: keyOf(pid, "masterchart", "chart"),
              projectId: String(pid),
              kind: "masterchart",
              id: "chart",
              value: clone(chart),
              updatedAt: nowIso()
            });
          }
        }
      }
      keys = lsKeys();
      for (i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(PLAN_PREFIX) !== 0) continue;
        suffix = keys[i].substring(PLAN_PREFIX.length);
        if (!suffix) continue;
        planRaw = lsGet(keys[i]);
        if (!planRaw) continue;
        try { plan = JSON.parse(planRaw); } catch (e2) { continue; }
        if (!jsonSafe(plan)) continue;
        jobs.push({
          key: keyOf(suffix, "draftmeta", "plan"),
          projectId: String(suffix),
          kind: "draftmeta",
          id: "plan",
          value: clone(plan),
          updatedAt: nowIso()
        });
      }
    } catch (e3) {
      jobs = [];
    }
    function next(idx) {
      if (idx >= jobs.length) return Promise.resolve();
      return writeIfAbsent(jobs[idx]).then(function () { return next(idx + 1); });
    }
    return next(0);
  }

  function chooseMode() {
    var factory;
    if (backend) {
      useFallback = false;
      return Promise.resolve("memory");
    }
    factory = indexedDBFactory();
    if (!factory) {
      useFallback = true;
      showBanner();
      return Promise.resolve("fallback");
    }
    return openDb().then(function () {
      useFallback = false;
      hideBanner();
      return "idb";
    }).catch(function () {
      useFallback = true;
      cachedDb = null;
      showBanner();
      return "fallback";
    });
  }

  function ready() {
    if (!modePromise) modePromise = chooseMode();
    return modePromise.then(function () {
      return migrateInner();
    }).then(function () {
      return true;
    });
  }

  function available() {
    return ready().then(function () {
      return !useFallback;
    });
  }

  function setBackend(memoryBackend) {
    if (memoryBackend && typeof memoryBackend === "object") {
      backend = memoryBackend;
      if (!backend.records || typeof backend.records !== "object" || isArray(backend.records)) backend.records = {};
      if (!backend.local || typeof backend.local !== "object" || isArray(backend.local)) backend.local = {};
    } else if (memoryBackend) {
      backend = { records: {}, local: {} };
    } else {
      backend = null;
    }
    useFallback = false;
    cachedDb = null;
    modePromise = null;
    hideBanner();
    return Promise.resolve();
  }

  var API = {
    put: put,
    get: get,
    list: list,
    remove: remove,
    exportAll: exportAll,
    importAll: importAll,
    available: available,
    _setBackend: setBackend,
    fallbackNotice: NOTICE
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.RMDStore = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
