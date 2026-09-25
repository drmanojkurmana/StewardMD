/* test/maik-lite-kb-precompute.test.mjs — audit T25 follow-up (2026-09-25): the audit's stronger
 * recommendation was a PRECOMPUTED index shipped with the app. Not done that way (see the comment
 * in kb/ai/maik-lite-kb-store.js): the 42,176-row book is not in this repo and is not a build-time
 * asset, so instead the index kb/ai/maik-lite-rag.js's buildBookAsync() already builds in a Web
 * Worker is now PERSISTED to IndexedDB, keyed to the same SHA256 that pins the download, so only
 * the FIRST session after an install/update ever pays the tokenization pass.
 *
 * This proves: (a) a session that builds fresh persists an index whose search() results are
 * bit-identical to a plain from-scratch Book; (b) the NEXT session (a fresh module instance, same
 * backing IndexedDB - simulating an app relaunch) loads that persisted index WITHOUT constructing
 * a Worker at all, and its search() results are bit-identical to session (a)'s; (c) a persisted
 * index under a stale/mismatched SHA256 is ignored and a fresh build (and re-persist) happens
 * instead, exactly as a KB version bump must invalidate the cache.
 *
 * Node has no Worker, so a small in-process fake stands in for it - it runs the exact same
 * RAG.buildIndex() production code the real worker source string calls, just synchronously in
 * this process instead of across postMessage, so the index it produces is the real thing, not a
 * stub. A small in-memory fake stands in for IndexedDB the same way (Node has neither). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../kb/ai/maik-lite-rag.js");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

const GOOD_SHA = "96b4504ac62dfa50d672913aa7d52fbdb5f949de0b52dc9aed2fd73e74be480b"; // matches the module's pinned SHA256
const ROWS = 42176; // loadBook() requires this exact row count

// ── synthetic book: 300 rows of real varied vocabulary (search-quality assertions run against
// these), padded with uniform filler rows up to the real published row count so loadBook()'s
// corruption check passes without paying to tokenize 42,176 meaningfully-varied rows per run. ──
function makeRows() {
  const rows = [];
  const subjects = ["fever", "cough", "pneumonia", "anemia", "sepsis", "diabetes", "hypertension",
    "stroke", "asthma", "thrombosis", "a1", "a10", "ab", "ceftriaxone", "amoxicillin"];
  const headingsPool = [["Infection", "Treatment"], ["Cardiology", "Diagnosis"],
    ["Renal", "Pathogenesis"], ["Further Reading"], ["Endocrine", "Management"]];
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const REAL = 300;
  for (let i = 0; i < REAL; i++) {
    let text = "";
    while (text.length < 300) {
      text += subjects[(rnd() * subjects.length) | 0] + " ";
      if (rnd() < 0.4) text += subjects[(rnd() * subjects.length) | 0] + " " + subjects[(rnd() * subjects.length) | 0] + " ";
    }
    rows.push({ i, text, headings: headingsPool[i % headingsPool.length], pages: [1 + (i >> 3)] });
  }
  for (let i = REAL; i < ROWS; i++) {
    rows.push({ i, text: "chunk " + i + " " + "x".repeat(260), headings: ["Filler"], pages: [1000 + i] });
  }
  return rows;
}
const QUERIES = [
  "treatment for fever and cough", "what causes sepsis", "diabetes management",
  "hypertension diagnosis workup", "ceftriaxone dosing", "amoxicillin allergy",
  "thrombosis complications", "pneumonia tx", "fever cough pneumonia sepsis"
];

// ── fake Worker: runs the REAL RAG.buildIndex() (production code), just synchronously in-process
// instead of via postMessage - a faithful stand-in, not a stubbed result. ──
class FakeWorker {
  constructor() { this.onmessage = null; this.onerror = null; }
  postMessage(text) {
    const self = this;
    queueMicrotask(function () {
      try {
        const lines = text.split("\n"), rows = [];
        for (let i = 0; i < lines.length; i++) { if (!lines[i]) continue; try { rows.push(JSON.parse(lines[i])); } catch (e) {} }
        const idx = R.buildIndex(rows);
        if (self.onmessage) self.onmessage({ data: idx });
      } catch (e) { if (self.onerror) self.onerror(e); }
    });
  }
  terminate() {}
}

// ── fake IndexedDB: just enough of the API (open/onupgradeneeded, transaction/objectStore,
// get/put/clear) for kb-store.js's idbOpen/idbGetIndex/idbPutIndex. One shared instance across
// several makeKbStore() calls simulates a real device's IndexedDB persisting across app
// relaunches (each relaunch is a fresh module instantiation with its own _book/_loading, exactly
// like loadBook()'s own module-level cache resets on every app launch). ──
function makeFakeIndexedDB() {
  const databases = new Map();
  function fireAsync(req, ok2, value) {
    queueMicrotask(function () {
      if (ok2) { req.result = value; if (req.onsuccess) req.onsuccess({ target: req }); }
      else { req.error = value; if (req.onerror) req.onerror({ target: req }); }
    });
  }
  return {
    open(name) {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined };
      queueMicrotask(function () {
        let rec = databases.get(name);
        const isNew = !rec;
        if (!rec) { rec = { stores: new Map() }; databases.set(name, rec); }
        const db = {
          objectStoreNames: { contains: (n) => rec.stores.has(n) },
          createObjectStore(storeName, opts) {
            rec.stores.set(storeName, { keyPath: (opts && opts.keyPath) || null, rows: new Map() });
          },
          transaction(storeName) {
            const store = rec.stores.get(storeName);
            return {
              objectStore() {
                return {
                  get(key) {
                    const r2 = { onsuccess: null, onerror: null, result: undefined };
                    fireAsync(r2, true, store ? store.rows.get(key) : undefined);
                    return r2;
                  },
                  put(value) {
                    const r2 = { onsuccess: null, onerror: null, result: undefined };
                    store.rows.set(store.keyPath ? value[store.keyPath] : value, value);
                    fireAsync(r2, true, undefined);
                    return r2;
                  },
                  clear() {
                    const r2 = { onsuccess: null, onerror: null, result: undefined };
                    if (store) store.rows.clear();
                    fireAsync(r2, true, undefined);
                    return r2;
                  }
                };
              }
            };
          }
        };
        req.result = db;
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    // test-only escape hatch: seed a raw record directly under an explicit key, bypassing both
    // kb-store.js's own writes AND (unlike a real put()) keyPath extraction - so a record whose
    // own `sha` field disagrees with the key it is stored under can be constructed at all, to
    // exercise idbGetIndex()'s `record.sha === SHA256` defense specifically.
    _seed(dbName, storeName, value, key) {
      let rec = databases.get(dbName);
      if (!rec) { rec = { stores: new Map() }; databases.set(dbName, rec); }
      let store = rec.stores.get(storeName);
      if (!store) { store = { keyPath: "sha", rows: new Map() }; rec.stores.set(storeName, store); }
      store.rows.set(key !== undefined ? key : value[store.keyPath], value);
    }
  };
}

const rows = makeRows();
const jsonl = rows.map((r) => JSON.stringify(r)).join("\n");

function makeKbStore(fakeIDB) {
  const Filesystem = {
    stat: async () => ({ size: 37976783 }),
    mkdir: async () => ({}),
    readFile: async (o) => ({ data: o.encoding === "utf8" ? jsonl : Buffer.from(jsonl, "utf8").toString("base64") }),
    appendFile: async () => ({}), deleteFile: async () => ({})
  };
  const store = { smd_maik_kb_installed: "1", smd_maik_kb_sha: GOOD_SHA };
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const win = { Capacitor: { isNativePlatform: () => true, Plugins: { Filesystem } }, localStorage: ls };
  win.window = win; win.self = win;
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("../kb/ai/maik-lite-kb-store.js"), "utf8");
  const mod = { exports: {} };
  new Function("module", "self", "window", "localStorage", "btoa", "atob", "indexedDB", src)(
    mod, win, win, ls,
    (s) => Buffer.from(s, "binary").toString("base64"),
    (s) => Buffer.from(s, "base64").toString("binary"),
    fakeIDB);
  return mod.exports;
}

const fakeIDB = makeFakeIndexedDB();
let workerCount = 0;
const RealWorker = globalThis.Worker;
globalThis.Worker = class extends FakeWorker { constructor(...a) { super(...a); workerCount++; } };

try {
  ok("precondition: no real Worker exists in Node (the fake is standing in for it)", RealWorker === undefined);

  const bkFresh = new R.Book(rows); // ground truth: plain from-scratch Map-path book

  // (a) session 1: nothing persisted yet -> must build via the (fake) worker, and persist.
  const KB1 = makeKbStore(fakeIDB);
  const book1 = await KB1.loadBook(R);
  ok("session 1 built a working Book (rows loaded)", book1.rows.length === ROWS);
  ok("session 1 used the worker path (a Worker was constructed)", workerCount === 1);
  for (const q of QUERIES) {
    const a = bkFresh.search(q, 5), b = book1.search(q, 5);
    ok("session 1: search('" + q + "') matches a from-scratch Book", JSON.stringify(a) === JSON.stringify(b));
  }

  // give the fire-and-forget idbPutIndex() a tick to land before session 2 reads it.
  await new Promise((r) => setTimeout(r, 0));

  // (b) session 2: a fresh module instance (simulating an app relaunch), SAME backing IndexedDB.
  const KB2 = makeKbStore(fakeIDB);
  const workerCountBefore2 = workerCount;
  const book2 = await KB2.loadBook(R);
  ok("session 2 did NOT construct a worker (the persisted index was used instead)", workerCount === workerCountBefore2);
  ok("session 2 built a working Book (rows loaded)", book2.rows.length === ROWS);
  for (const q of QUERIES) {
    const a = book1.search(q, 5), b = book2.search(q, 5);
    ok("session 2: search('" + q + "') is bit-identical to session 1's (freshly built) result", JSON.stringify(a) === JSON.stringify(b));
  }

  // (c) the record's own `sha` field mismatching the current SHA256 (a genuinely stale/superseded
  // cache entry sitting under the current key) must be ignored, not trusted just because the
  // lookup key matched.
  fakeIDB._seed("smd-maik-kb", "kb-index", { sha: "old-version-sha-not-current", idx: null }, GOOD_SHA);
  const KB3 = makeKbStore(fakeIDB);
  const workerCountBefore3 = workerCount;
  const book3 = await KB3.loadBook(R);
  ok("a stale sha field under the current key is ignored: the worker path ran again", workerCount === workerCountBefore3 + 1);
  ok("the rebuilt book still works", book3.rows.length === ROWS);
  for (const q of QUERIES) {
    const a = bkFresh.search(q, 5), b = book3.search(q, 5);
    ok("session 3 (stale sha -> rebuild): search('" + q + "') matches a from-scratch Book", JSON.stringify(a) === JSON.stringify(b));
  }

  // (d) a persisted record that IS keyed/tagged with the current SHA256 but whose payload is a
  // structurally incompatible/corrupt index must not crash the app - Book construction throws,
  // is caught, and a fresh build replaces it.
  fakeIDB._seed("smd-maik-kb", "kb-index", { sha: GOOD_SHA, idx: { bogus: true } });
  const KB4 = makeKbStore(fakeIDB);
  const workerCountBefore4 = workerCount;
  const book4 = await KB4.loadBook(R);
  ok("a corrupt cached index (matching sha, unusable payload) is ignored: the worker path ran again", workerCount === workerCountBefore4 + 1);
  ok("the rebuilt book still works", book4.rows.length === ROWS);
  for (const q of QUERIES) {
    const a = bkFresh.search(q, 5), b = book4.search(q, 5);
    ok("session 4 (corrupt cache -> rebuild): search('" + q + "') matches a from-scratch Book", JSON.stringify(a) === JSON.stringify(b));
  }
} finally {
  if (RealWorker === undefined) delete globalThis.Worker; else globalThis.Worker = RealWorker;
}

console.log(`maik-lite-kb-precompute: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
