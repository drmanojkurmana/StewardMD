/* ResearchMD on-device checkpoint store unit tests.
 * Run: node --test test/research-ondevice-checkpoint.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../research-ondevice-checkpoint.js");

function installFakeIdb() {
  const databases = {};
  function laterMicro(fn) { queueMicrotask(fn); }
  function laterMacro(fn) { setTimeout(fn, 0); }
  function makeDb(name, version) {
    const db = {
      name,
      version,
      _stores: {},
      objectStoreNames: {
        names: [],
        contains(n) { return db.objectStoreNames.names.indexOf(n) !== -1; }
      },
      createObjectStore(storeName, opts) {
        const store = { keyPath: opts && opts.keyPath, rows: {} };
        db._stores[storeName] = store;
        db.objectStoreNames.names.push(storeName);
        return store;
      },
      transaction(storeName) {
        const store = db._stores[storeName];
        const tx = { error: null, oncomplete: null, onerror: null };
        tx.objectStore = () => ({
          get(key) {
            const raw = store.rows[key];
            const req = { result: raw ? JSON.parse(JSON.stringify(raw)) : undefined, onsuccess: null };
            laterMicro(() => { if (req.onsuccess) req.onsuccess.call(req); });
            return req;
          },
          put(rec) {
            store.rows[rec.jobKey] = JSON.parse(JSON.stringify(rec));
            return {};
          },
          delete(key) {
            delete store.rows[key];
            return {};
          },
          openCursor() {
            const rows = Object.keys(store.rows).map((k) => store.rows[k]);
            const req = { result: null, onsuccess: null };
            let i = 0;
            function step() {
              laterMicro(() => {
                if (i >= rows.length) {
                  req.result = null;
                  if (req.onsuccess) req.onsuccess.call(req);
                  return;
                }
                const value = rows[i++];
                req.result = { value, continue: step };
                if (req.onsuccess) req.onsuccess.call(req);
              });
            }
            step();
            return req;
          }
        });
        laterMacro(() => { if (tx.oncomplete) tx.oncomplete.call(tx); });
        return tx;
      }
    };
    return db;
  }
  globalThis.indexedDB = {
    open(name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      laterMacro(() => {
        let db = databases[name];
        let upgrade = false;
        if (!db) {
          db = makeDb(name, version);
          databases[name] = db;
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

describe("SMD_RMD_CHECKPOINT", { concurrency: 1 }, () => {
  test("put, get, list by prefix, remove with memory backend", async () => {
    const mem = { records: {} };
    await checkpoint._setBackend(mem);

    assert.equal(await checkpoint.get("pdf:p1:abc"), null);
    await checkpoint.put("pdf:p1:abc", { nextPage: 3, pages: [{ n: 1 }, { n: 2 }], sha256: "abc" });
    await checkpoint.put("pdf:p1:def", { nextPage: 2, pages: [{ n: 1 }], sha256: "def" });
    await checkpoint.put("stats:p1:run1", { done: true });

    const got = await checkpoint.get("pdf:p1:abc");
    assert.deepEqual(got, { nextPage: 3, pages: [{ n: 1 }, { n: 2 }], sha256: "abc" });

    // Mutating returned object does not mutate stored copy
    got.nextPage = 999;
    assert.equal((await checkpoint.get("pdf:p1:abc")).nextPage, 3);

    const pdfList = await checkpoint.list("pdf:p1:");
    assert.deepEqual(pdfList.map((e) => e.jobKey), ["pdf:p1:abc", "pdf:p1:def"]);
    assert.equal(pdfList[0].value.nextPage, 3);
    assert.equal(typeof pdfList[0].updatedAt, "string");

    const all = await checkpoint.list();
    assert.equal(all.length, 3);

    await checkpoint.remove("pdf:p1:abc");
    assert.equal(await checkpoint.get("pdf:p1:abc"), null);
    assert.deepEqual((await checkpoint.list("pdf:p1:")).map((e) => e.jobKey), ["pdf:p1:def"]);

    // Removing missing key is a no-op
    await checkpoint.remove("pdf:p1:missing");
  });

  test("rejects missing key or non-serializable value", async () => {
    await checkpoint._setBackend({ records: {} });
    await assert.rejects(() => checkpoint.put("", { a: 1 }));
    await assert.rejects(() => checkpoint.put("k1", undefined));
    const cyclic = {};
    cyclic.self = cyclic;
    await assert.rejects(() => checkpoint.put("k2", cyclic));
  });

  test("IndexedDB path uses database rmd_od and store checkpoints", async () => {
    const origIdb = globalThis.indexedDB;
    try {
      const dbs = installFakeIdb();
      await checkpoint._setBackend(null);
      await checkpoint.put("pdf:p9:zzz", { nextPage: 5 });
      assert.ok(dbs.rmd_od, "opened database rmd_od");
      assert.ok(dbs.rmd_od._stores.checkpoints, "created store checkpoints");
      assert.deepEqual(await checkpoint.get("pdf:p9:zzz"), { nextPage: 5 });
      const listed = await checkpoint.list("pdf:p9:");
      assert.equal(listed.length, 1);
      assert.equal(listed[0].jobKey, "pdf:p9:zzz");
      await checkpoint.remove("pdf:p9:zzz");
      assert.equal(await checkpoint.get("pdf:p9:zzz"), null);
    } finally {
      await checkpoint._setBackend({ records: {} });
      if (origIdb === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = origIdb;
    }
  });
});
