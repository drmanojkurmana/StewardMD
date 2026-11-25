/* ResearchMD IndexedDB record store.
 * Node uses RMDStore._setBackend. One test drives a small fake indexedDB.
 * Run: node --test test/research-idb.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("../research-idb.js");

const JSON_MSG = "research: store values must be JSON";

function memoryStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    key(i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; },
    _data: data
  };
}

function fakeDocument() {
  const body = { children: [], firstChild: null };
  body.appendChild = function (el) {
    el.parentNode = body;
    this.children.push(el);
    this.firstChild = this.children[0];
  };
  body.insertBefore = function (el) {
    el.parentNode = body;
    this.children.unshift(el);
    this.firstChild = this.children[0];
  };
  body.removeChild = function (el) {
    this.children = this.children.filter(function (c) { return c !== el; });
    this.firstChild = this.children[0] || null;
  };
  return {
    body: body,
    createElement: function () {
      return { id: "", className: "", textContent: "", parentNode: null, setAttribute: function () {} };
    },
    getElementById: function (id) {
      for (let i = 0; i < body.children.length; i++) {
        if (body.children[i].id === id) return body.children[i];
      }
      return null;
    }
  };
}

function installFakeIdb() {
  const databases = {};
  function laterMicro(fn) { queueMicrotask(fn); }
  function laterMacro(fn) { setTimeout(fn, 0); }
  function cursorReq(rows) {
    const req = { result: null, onsuccess: null, onerror: null };
    let i = 0;
    function step() {
      laterMicro(function () {
        if (i >= rows.length) {
          req.result = null;
          if (req.onsuccess) req.onsuccess.call(req);
          return;
        }
        const value = rows[i];
        i += 1;
        req.result = { value: value, continue: function () { step(); } };
        if (req.onsuccess) req.onsuccess.call(req);
      });
    }
    step();
    return req;
  }
  function makeDb(name, version) {
    const db = {
      name: name,
      version: version,
      _stores: {},
      objectStoreNames: {
        names: [],
        contains: function (n) { return db.objectStoreNames.names.indexOf(n) !== -1; }
      },
      createObjectStore: function (storeName, opts) {
        const store = { keyPath: opts && opts.keyPath, rows: {}, indexes: {} };
        db._stores[storeName] = store;
        db.objectStoreNames.names.push(storeName);
        return { createIndex: function (indexName) { store.indexes[indexName] = true; } };
      },
      transaction: function (storeName) {
        const store = db._stores[storeName];
        const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
        tx.objectStore = function () {
          return {
            indexNames: { contains: function (n) { return !!store.indexes[n]; } },
            get: function (key) {
              const raw = store.rows[key];
              const req = {
                result: raw ? JSON.parse(JSON.stringify(raw)) : undefined,
                onsuccess: null,
                onerror: null
              };
              laterMicro(function () { if (req.onsuccess) req.onsuccess.call(req); });
              return req;
            },
            put: function (rec) {
              store.rows[rec.key] = JSON.parse(JSON.stringify(rec));
              return {};
            },
            delete: function (key) { delete store.rows[key]; return {}; },
            clear: function () { store.rows = {}; return {}; },
            openCursor: function () {
              return cursorReq(Object.keys(store.rows).map(function (k) { return store.rows[k]; }));
            },
            index: function () {
              return {
                openCursor: function (range) {
                  const rows = Object.keys(store.rows).map(function (k) { return store.rows[k]; }).filter(function (rec) {
                    if (!range || range.kind !== "only") return true;
                    return String(rec.projectId) === String(range.value[0]) && rec.kind === range.value[1];
                  });
                  return cursorReq(rows);
                }
              };
            }
          };
        };
        laterMacro(function () { if (tx.oncomplete) tx.oncomplete.call(tx); });
        return tx;
      }
    };
    return db;
  }
  globalThis.IDBKeyRange = { only: function (value) { return { kind: "only", value: value }; } };
  globalThis.indexedDB = {
    open: function (name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      laterMacro(function () {
        let db = databases[name];
        let upgrade = false;
        if (!db) {
          db = makeDb(name, version);
          databases[name] = db;
          upgrade = true;
        } else if (db.version < version) {
          db.version = version;
          upgrade = true;
        }
        req.result = db;
        if (upgrade && req.onupgradeneeded) req.onupgradeneeded.call(req);
        if (req.onsuccess) req.onsuccess.call(req);
      });
      return req;
    }
  };
  return databases;
}

describe("RMDStore", { concurrency: 1 }, function () {
  test("put, get, list and remove on the memory backend", async function () {
    const mem = { records: {}, local: {} };
    await store._setBackend(mem);
    assert.equal(await store.available(), true);
    const saved = await store.put("p1", "casefile", "main", { title: "Zinc", n: 1 });
    assert.equal(saved, undefined);
    assert.equal(typeof mem.local["rmd.v1.lastChangeAt"], "string");
    assert.deepEqual(await store.get("p1", "casefile", "main"), { title: "Zinc", n: 1 });
    await store.put("p1", "casefile", "b", { title: "B" });
    await store.put("p1", "draftmeta", "plan", { aim: "two_proportions" });
    await store.put("p2", "casefile", "main", { title: "Other" });
    const listed = await store.list("p1", "casefile");
    assert.deepEqual(listed.map(function (r) { return r.id; }), ["b", "main"]);
    assert.equal(listed[1].value.title, "Zinc");
    assert.equal(typeof listed[1].updatedAt, "string");
    await store.remove("p1", "casefile", "b");
    assert.equal((await store.list("p1", "casefile")).length, 1);
    await store.remove("p1", "casefile", "missing");
    assert.equal(await store.get("p1", "casefile", "missing"), null);
    const held = { title: "held" };
    await store.put("p1", "iec", "decision", held);
    held.title = "mutated";
    assert.equal((await store.get("p1", "iec", "decision")).title, "held");
  });

  test("rejects Blob, File, ArrayBuffer and values that do not survive JSON", async function () {
    const mem = { records: {}, local: {} };
    await store._setBackend(mem);
    const blob = await store.put("p", "image", "b", new Blob(["x"]));
    assert.deepEqual(blob, { ok: false, warnings: [JSON_MSG] });
    assert.equal(await store.get("p", "image", "b"), null);
    assert.equal(mem.local["rmd.v1.lastChangeAt"], undefined);
    const file = await store.put("p", "image", "f", new File(["x"], "a.txt"));
    assert.equal(file.ok, false);
    const buf = await store.put("p", "image", "a", new ArrayBuffer(4));
    assert.equal(buf.ok, false);
    const nested = await store.put("p", "image", "n", { photo: new Blob(["z"]) });
    assert.equal(nested.ok, false);
    const cycle = { a: 1 };
    cycle.self = cycle;
    const circled = await store.put("p", "casefile", "c", cycle);
    assert.equal(circled.ok, false);
    const missing = await store.put("p", "casefile", "u", { a: 1, b: undefined });
    assert.equal(missing.ok, false);
    const kind = await store.put("p", "nope", "1", { a: 1 });
    assert.deepEqual(kind, { ok: false, warnings: ["research: unknown record kind"] });
    assert.equal(mem.local["rmd.v1.lastChangeAt"], undefined);
  });

  test("image data URL round trips through export, JSON and import", async function () {
    const img = {
      dataUrl: "data:image/jpeg;base64,AAAA",
      width: 12,
      height: 8,
      name: "fig.jpg",
      redacted: true
    };
    await store._setBackend({ records: {}, local: {} });
    await store.put("p", "image", "img1", img);
    await store.put("p", "casefile", "main", { title: "Zinc phosphide" });
    const full = await store.exportAll({ includeImages: true });
    assert.equal(full.format, "rmd-data");
    assert.equal(full.version, 1);
    assert.equal(typeof full.exportedAt, "string");
    assert.equal(full.records.length, 2);
    assert.ok(full.records[0].key < full.records[1].key || full.records[0].key === full.records[1].key);
    const parsed = JSON.parse(JSON.stringify(full));
    await store._setBackend({ records: {}, local: {} });
    const imported = await store.importAll(parsed, "replace");
    assert.equal(imported.ok, true);
    assert.equal(imported.added, 2);
    assert.equal(imported.skipped, 0);
    const got = await store.get("p", "image", "img1");
    assert.equal(got.dataUrl, img.dataUrl);
    assert.equal(got.width, 12);
    assert.equal(got.redacted, true);
    const slim = await store.exportAll({ includeImages: false });
    assert.equal(slim.records.length, 1);
    assert.equal(slim.records[0].kind, "casefile");
    assert.equal(slim.records.some(function (r) { return r.kind === "image"; }), false);
  });

  test("importAll merge keeps the newer updatedAt and replace wipes extras", async function () {
    const mem = { records: {}, local: {} };
    await store._setBackend(mem);
    await store.put("p", "casefile", "main", { title: "old" });
    await store.put("p", "casefile", "keep", { title: "stay" });
    const dumped = await store.exportAll({ includeImages: true });
    const main = dumped.records.filter(function (r) { return r.id === "main"; })[0];
    const keep = dumped.records.filter(function (r) { return r.id === "keep"; })[0];
    const past = JSON.parse(JSON.stringify(dumped));
    past.records = [Object.assign({}, main, { value: { title: "stale" }, updatedAt: "2000-01-01T00:00:00.000Z" })];
    const skipped = await store.importAll(past, "merge");
    assert.deepEqual(skipped, { ok: true, added: 0, updated: 0, skipped: 1, warnings: [] });
    assert.equal((await store.get("p", "casefile", "main")).title, "old");
    const newer = JSON.parse(JSON.stringify(dumped));
    newer.records = [
      Object.assign({}, main, { value: { title: "new" }, updatedAt: "2099-01-01T00:00:00.000Z" }),
      {
        key: "p|casefile|extra",
        projectId: "p",
        kind: "casefile",
        id: "extra",
        value: { title: "extra" },
        updatedAt: "2099-01-01T00:00:00.000Z"
      },
      { projectId: "p", kind: "blob-kind", id: "bad", value: { a: 1 }, updatedAt: "2099-01-01T00:00:00.000Z" }
    ];
    const merged = await store.importAll(newer, "merge");
    assert.equal(merged.added, 1);
    assert.equal(merged.updated, 1);
    assert.equal(merged.skipped, 1);
    assert.equal((await store.get("p", "casefile", "main")).title, "new");
    assert.equal((await store.get("p", "casefile", "keep")).title, "stay");
    assert.equal((await store.get("p", "casefile", "extra")).title, "extra");
    const replacement = {
      format: "rmd-data",
      version: 1,
      records: [Object.assign({}, keep, { value: { title: "replaced" }, updatedAt: "1999-01-01T00:00:00.000Z" })]
    };
    const replaced = await store.importAll(replacement, "replace");
    assert.deepEqual(
      { added: replaced.added, updated: replaced.updated, skipped: replaced.skipped, ok: replaced.ok },
      { added: 0, updated: 1, skipped: 0, ok: true }
    );
    assert.equal((await store.get("p", "casefile", "keep")).title, "replaced");
    assert.equal(await store.get("p", "casefile", "main"), null);
    assert.equal(await store.get("p", "casefile", "extra"), null);
    const bad = await store.importAll({ format: "nope" }, "merge");
    assert.equal(bad.ok, false);
    assert.equal(bad.warnings[0], "research: not an rmd data file");
    const mode = await store.importAll(dumped, "append");
    assert.equal(mode.ok, false);
    assert.equal(mode.warnings[0], "research: import mode must be merge or replace");
  });

  test("migrates master chart and plan once per record and keeps the old keys", async function () {
    const local = {
      smd_rmd_masterchart_v1: JSON.stringify({
        p1: { fileName: "chart.csv", sample: false, columns: ["a"], rows: [["1"]], types: ["numeric"] }
      }),
      smd_research_plan_p1: JSON.stringify({ aim: "two_proportions", ssInputs: { p1: 0.3 } }),
      smd_research_plan_: JSON.stringify({ aim: "skip empty suffix" }),
      unrelated: "leave me"
    };
    const mem = { records: {}, local: local };
    await store._setBackend(mem);
    await store.available();
    const chart = await store.get("p1", "masterchart", "chart");
    assert.equal(chart.fileName, "chart.csv");
    assert.deepEqual(chart.rows, [["1"]]);
    const plan = await store.get("p1", "draftmeta", "plan");
    assert.equal(plan.aim, "two_proportions");
    assert.equal((await store.list("p1", "masterchart")).length, 1);
    assert.ok(local.smd_rmd_masterchart_v1.indexOf("chart.csv") >= 0);
    assert.ok(local.smd_research_plan_p1.indexOf("two_proportions") >= 0);
    await store.available();
    assert.equal((await store.list("p1", "masterchart")).length, 1);
    await store.put("p1", "masterchart", "chart", {
      fileName: "edited.csv", sample: false, columns: [], rows: [], types: []
    });
    local.smd_rmd_masterchart_v1 = JSON.stringify({
      p1: { fileName: "stale.csv", sample: false, columns: [], rows: [], types: [] }
    });
    await store.available();
    assert.equal((await store.get("p1", "masterchart", "chart")).fileName, "edited.csv");
    local.smd_research_plan_p2 = JSON.stringify({ aim: "later" });
    await store.get("p9", "casefile", "none");
    assert.equal((await store.get("p2", "draftmeta", "plan")).aim, "later");
  });

  test("indexedDB driver lists by project and kind", async function () {
    installFakeIdb();
    globalThis.localStorage = memoryStorage();
    globalThis.document = fakeDocument();
    await store._setBackend(null);
    assert.equal(await store.available(), true);
    assert.equal(globalThis.document.getElementById("rmdStoreFallback"), null);
    await store.put("p", "casefile", "main", { title: "From idb" });
    await store.put("p", "image", "img1", {
      dataUrl: "data:image/jpeg;base64,AAAA",
      width: 2,
      height: 2,
      name: "a.jpg",
      redacted: true
    });
    await store.put("q", "casefile", "main", { title: "Other project" });
    assert.equal((await store.get("p", "casefile", "main")).title, "From idb");
    const listed = await store.list("p", "casefile");
    assert.deepEqual(listed.map(function (r) { return r.id; }), ["main"]);
    const exported = await store.exportAll({ includeImages: false });
    assert.equal(exported.records.length, 2);
    await store.remove("q", "casefile", "main");
    assert.equal(await store.get("q", "casefile", "main"), null);
  });

  test("missing indexedDB falls back to localStorage and shows one calm banner", async function () {
    const ls = memoryStorage();
    globalThis.localStorage = ls;
    globalThis.indexedDB = null;
    globalThis.document = fakeDocument();
    await store._setBackend(null);
    assert.equal(await store.available(), false);
    const banner = globalThis.document.getElementById("rmdStoreFallback");
    assert.ok(banner);
    assert.equal(banner.className, "rmd-banner rmd-banner-info");
    assert.equal(banner.textContent, store.fallbackNotice);
    assert.equal(banner.textContent.indexOf("\u2014"), -1);
    assert.equal(banner.textContent.indexOf("\u2013"), -1);
    await store.put("p", "casefile", "main", { title: "fallback" });
    assert.equal((await store.get("p", "casefile", "main")).title, "fallback");
    assert.equal(typeof ls._data["rmd.v1.fallbackRecords"], "string");
    assert.equal(typeof ls._data["rmd.v1.lastChangeAt"], "string");
    const before = globalThis.document.body.children.length;
    await store.available();
    assert.equal(globalThis.document.body.children.length, before);
  });

  test("source opens database rmd version 1 with the byProjectKind index", function () {
    const src = readFileSync(new URL("../research-idb.js", import.meta.url), "utf8");
    assert.ok(src.indexOf('var DB_NAME = "rmd"') >= 0);
    assert.ok(src.indexOf("var DB_VERSION = 1") >= 0);
    assert.ok(src.indexOf('var STORE = "records"') >= 0);
    assert.ok(src.indexOf('var INDEX = "byProjectKind"') >= 0);
    assert.ok(src.indexOf('keyPath: "key"') >= 0);
    assert.ok(src.indexOf("factory.open(DB_NAME, DB_VERSION)") >= 0);
    assert.equal(src.indexOf("\u2014"), -1);
    assert.equal(src.indexOf("\u2013"), -1);
  });
});
