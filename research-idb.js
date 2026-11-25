/* StewardMD - ResearchMD on-phone data store (window.RMDStore).
 * ES5 only, buildless. IndexedDB database "rmd" v1, object store "records"
 * (keyPath "key"; index "byProjectKind" on [projectId, kind]).
 * Record: { key, projectId, kind, id, value, updatedAt } with key =
 * projectId + "|" + kind + "|" + id and updatedAt an ISO string.
 * Patient rows, case files and documents live here; localStorage holds small
 * settings only (rmd.v1.*). Every call returns a Promise and never throws.
 * Node tests swap the backend with RMDStore._setBackend(RMDStore._memoryBackend()).
 * Contract: docs/research/contracts.md ("Storage").
 */
(function (G) {
  "use strict";

  var DB_NAME = "rmd";
  var DB_VERSION = 1;
  var STORE = "records";
  var KINDS = ["casefile", "masterchart", "image", "randomlist", "randomfingerprint", "consort",
    "iec", "ctri", "blinding", "samplesize", "draftmeta"];
  var LS_PREFIX = "rmd.v1.";
  var LEGACY_MC_KEY = "smd_rmd_masterchart_v1";

  function P() { return G && G.Promise ? G.Promise : Promise; }
  function resolved(v) { return P().resolve(v); }
  function rejected(e) { return P().reject(e); }

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  function lsGet(name) {
    try { return G && G.localStorage ? G.localStorage.getItem(LS_PREFIX + name) : null; } catch (e) { return null; }
  }
  function lsSet(name, v) {
    try { if (G && G.localStorage) G.localStorage.setItem(LS_PREFIX + name, String(v)); } catch (e) {}
  }

  function makeKey(projectId, kind, id) {
    return String(projectId) + "|" + String(kind) + "|" + String(id);
  }

  function clone(v) {
    if (v === undefined) return null;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
  }

  function byId(a, b) {
    var x = String(a.id), y = String(b.id);
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  /* ---------- Backends ---------- */

  function memoryBackend() {
    var rows = {};
    return {
      name: "memory",
      put: function (rec) { rows[rec.key] = clone(rec); return resolved(); },
      get: function (key) { return resolved(rows.hasOwnProperty(key) ? clone(rows[key]) : null); },
      byProjectKind: function (pid, kind) {
        var out = [];
        for (var k in rows) {
          if (rows.hasOwnProperty(k) && rows[k].projectId === pid && rows[k].kind === kind) out.push(clone(rows[k]));
        }
        return resolved(out);
      },
      remove: function (key) { delete rows[key]; return resolved(); },
      all: function () {
        var out = [];
        for (var k in rows) { if (rows.hasOwnProperty(k)) out.push(clone(rows[k])); }
        return resolved(out);
      },
      clear: function () { rows = {}; return resolved(); }
    };
  }

  function idbBackend(idb) {
    var dbPromise = null;
    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new (P())(function (res, rej) {
        var req;
        try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { rej(e); return; }
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var os = db.createObjectStore(STORE, { keyPath: "key" });
            os.createIndex("byProjectKind", ["projectId", "kind"], { unique: false });
          }
        };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error || new Error("research: could not open the phone store")); };
        req.onblocked = function () { rej(new Error("research: the phone store is busy")); };
      });
      dbPromise.then(null, function () { dbPromise = null; });
      return dbPromise;
    }
    function run(mode, fn) {
      return open().then(function (db) {
        return new (P())(function (res, rej) {
          var tx, out;
          try {
            tx = db.transaction(STORE, mode);
            out = fn(tx.objectStore(STORE));
          } catch (e) { rej(e); return; }
          tx.oncomplete = function () { res(out && out.hasOwnProperty("result") ? out.result : (out && out.req ? out.req.result : undefined)); };
          tx.onerror = function () { rej(tx.error || new Error("research: phone store write failed")); };
          tx.onabort = function () { rej(tx.error || new Error("research: phone store write stopped")); };
        });
      });
    }
    return {
      name: "indexeddb",
      put: function (rec) { return run("readwrite", function (os) { os.put(rec); return null; }); },
      get: function (key) {
        return run("readonly", function (os) { return { req: os.get(key) }; }).then(function (r) { return r || null; });
      },
      byProjectKind: function (pid, kind) {
        return run("readonly", function (os) { return { req: os.index("byProjectKind").getAll([pid, kind]) }; })
          .then(function (r) { return r || []; });
      },
      remove: function (key) { return run("readwrite", function (os) { os["delete"](key); return null; }); },
      all: function () {
        return run("readonly", function (os) { return { req: os.getAll() }; }).then(function (r) { return r || []; });
      },
      clear: function () { return run("readwrite", function (os) { os.clear(); return null; }); }
    };
  }

  var backend = null;
  var isAvailable = false;

  function pickBackend() {
    var idb = null;
    try { idb = G && G.indexedDB ? G.indexedDB : null; } catch (e) { idb = null; }
    if (idb) { backend = idbBackend(idb); isAvailable = true; }
    else { backend = memoryBackend(); isAvailable = false; }
  }

  function safe(p) {
    return p.then(null, function (e) {
      if (backend && backend.name === "indexeddb") {
        /* Private mode or a broken store: keep working in memory for this session. */
        backend = memoryBackend();
        isAvailable = false;
      }
      return rejected(e);
    });
  }

  function checkArgs(projectId, kind, id) {
    if (projectId == null || projectId === "") return "research: projectId is required";
    if (KINDS.indexOf(kind) < 0) return "research: unknown kind " + kind;
    if (id == null || id === "") return "research: id is required";
    return "";
  }

  /* ---------- Public API ---------- */

  function put(projectId, kind, id, value) {
    var err = checkArgs(projectId, kind, id);
    if (err) return rejected(new Error(err));
    var rec = { key: makeKey(projectId, kind, id), projectId: String(projectId), kind: kind, id: String(id), value: clone(value), updatedAt: nowIso() };
    return safe(backend.put(rec)).then(function () { lsSet("lastChangeAt", rec.updatedAt); return undefined; });
  }

  function get(projectId, kind, id) {
    var err = checkArgs(projectId, kind, id);
    if (err) return rejected(new Error(err));
    return safe(backend.get(makeKey(projectId, kind, id))).then(function (r) { return r ? r.value : null; });
  }

  function list(projectId, kind) {
    if (KINDS.indexOf(kind) < 0) return rejected(new Error("research: unknown kind " + kind));
    return safe(backend.byProjectKind(String(projectId), kind)).then(function (rows) {
      rows.sort(byId);
      var out = [];
      for (var i = 0; i < rows.length; i++) out.push({ id: rows[i].id, value: rows[i].value, updatedAt: rows[i].updatedAt });
      return out;
    });
  }

  function remove(projectId, kind, id) {
    var err = checkArgs(projectId, kind, id);
    if (err) return rejected(new Error(err));
    return safe(backend.remove(makeKey(projectId, kind, id))).then(function () { lsSet("lastChangeAt", nowIso()); return undefined; });
  }

  function exportAll(opts) {
    var includeImages = !!(opts && opts.includeImages);
    return safe(backend.all()).then(function (rows) {
      var recs = [];
      for (var i = 0; i < rows.length; i++) {
        if (!includeImages && rows[i].kind === "image") continue;
        recs.push(rows[i]);
      }
      recs.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
      return { format: "rmd-data", version: 1, exportedAt: nowIso(), records: recs };
    });
  }

  function validRecord(r) {
    return r && typeof r === "object" && r.projectId != null && KINDS.indexOf(r.kind) >= 0 && r.id != null &&
      r.key === makeKey(r.projectId, r.kind, r.id);
  }

  function importAll(data, mode) {
    if (!data || data.format !== "rmd-data" || data.version !== 1 || Object.prototype.toString.call(data.records) !== "[object Array]") {
      return rejected(new Error("research: this file is not a ResearchMD data export"));
    }
    if (mode !== "merge" && mode !== "replace") return rejected(new Error("research: mode must be merge or replace"));
    var counts = { added: 0, updated: 0, skipped: 0 };
    var start = mode === "replace" ? safe(backend.clear()) : resolved();
    var recs = data.records.slice();
    return start.then(function () {
      var i = 0;
      function next() {
        if (i >= recs.length) return resolved(counts);
        var r = recs[i++];
        if (!validRecord(r)) { counts.skipped++; return next(); }
        return safe(backend.get(r.key)).then(function (old) {
          if (old && mode === "merge" && String(old.updatedAt || "") >= String(r.updatedAt || "")) {
            counts.skipped++;
            return next();
          }
          var rec = { key: r.key, projectId: String(r.projectId), kind: r.kind, id: String(r.id), value: clone(r.value), updatedAt: String(r.updatedAt || nowIso()) };
          return safe(backend.put(rec)).then(function () {
            if (old) counts.updated++; else counts.added++;
            return next();
          });
        });
      }
      return next();
    }).then(function (c) { lsSet("lastChangeAt", nowIso()); return c; });
  }

  function available() { return isAvailable; }

  /* First run: copy master charts saved by the older build (localStorage) into the store.
   * The old key stays until the first successful backup (research-backup.js clears it). */
  function migrateLegacy() {
    if (lsGet("migrated") === "1") return resolved({ migrated: 0 });
    var all = null;
    try { all = G && G.localStorage ? JSON.parse(G.localStorage.getItem(LEGACY_MC_KEY) || "{}") : null; } catch (e) { all = null; }
    var pids = [];
    if (all && typeof all === "object") { for (var k in all) { if (all.hasOwnProperty(k) && all[k]) pids.push(k); } }
    var n = 0;
    var i = 0;
    function next() {
      if (i >= pids.length) return resolved();
      var pid = pids[i++];
      return get(pid, "masterchart", "main").then(function (cur) {
        if (cur) return next();
        n++;
        return put(pid, "masterchart", "main", all[pid]).then(next);
      });
    }
    return next().then(function () { lsSet("migrated", "1"); return { migrated: n }; }, function () { return { migrated: n, failed: true }; });
  }

  function legacyKeys() { return [LEGACY_MC_KEY]; }

  pickBackend();

  var RMDStore = {
    put: put,
    get: get,
    list: list,
    remove: remove,
    exportAll: exportAll,
    importAll: importAll,
    available: available,
    migrateLegacy: migrateLegacy,
    legacyKeys: legacyKeys,
    KINDS: KINDS.slice(),
    lsGet: lsGet,
    lsSet: lsSet,
    _setBackend: function (b, avail) { backend = b; isAvailable = avail == null ? true : !!avail; },
    _memoryBackend: memoryBackend
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = RMDStore; }
  if (G) { G.RMDStore = RMDStore; }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : undefined));
