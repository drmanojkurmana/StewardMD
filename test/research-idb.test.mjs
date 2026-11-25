/* ResearchMD on-phone data store (research-idb.js, window.RMDStore).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-idb.test.mjs
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m
  };
}

globalThis.localStorage = fakeLocalStorage();
const S = require("../research-idb.js");
const SRC = readFileSync(new URL("../research-idb.js", import.meta.url), "utf8");

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
  S._setBackend(S._memoryBackend(), true);
});

test("source is ES5 with no dashes", () => {
  assert.ok(!/=>/.test(SRC), "no arrow functions");
  assert.ok(!/\b(let|const|async|await|class)\s/.test(SRC), "no ES6 keywords");
  assert.ok(!/[–—]/.test(SRC), "no em or en dash");
});

test("put, get, list sorted by id, remove", async () => {
  await S.put("p1", "casefile", "2", { age: 40 });
  await S.put("p1", "casefile", "1", { age: 30 });
  await S.put("p2", "casefile", "1", { age: 99 });
  assert.deepEqual(await S.get("p1", "casefile", "1"), { age: 30 });
  assert.equal(await S.get("p1", "casefile", "9"), null);
  const rows = await S.list("p1", "casefile");
  assert.deepEqual(rows.map((r) => r.id), ["1", "2"]);
  assert.ok(typeof rows[0].updatedAt === "string" && rows[0].updatedAt.length > 10);
  await S.remove("p1", "casefile", "1");
  assert.deepEqual((await S.list("p1", "casefile")).map((r) => r.id), ["2"]);
  assert.ok(globalThis.localStorage.getItem("rmd.v1.lastChangeAt"));
});

test("values are copies, not shared references", async () => {
  const v = { rows: [[1, 2]] };
  await S.put("p", "masterchart", "main", v);
  v.rows[0][0] = 9;
  assert.deepEqual(await S.get("p", "masterchart", "main"), { rows: [[1, 2]] });
});

test("bad kind or missing id is refused", async () => {
  await assert.rejects(S.put("p", "nonsense", "1", {}), /unknown kind/);
  await assert.rejects(S.put("p", "casefile", "", {}), /id is required/);
  await assert.rejects(S.put("", "casefile", "1", {}), /projectId is required/);
});

test("exportAll leaves images out unless asked", async () => {
  await S.put("p", "casefile", "1", { a: 1 });
  await S.put("p", "image", "1", { data: "xx" });
  const e1 = await S.exportAll();
  assert.equal(e1.format, "rmd-data");
  assert.equal(e1.version, 1);
  assert.deepEqual(e1.records.map((r) => r.kind), ["casefile"]);
  const e2 = await S.exportAll({ includeImages: true });
  assert.deepEqual(e2.records.map((r) => r.kind).sort(), ["casefile", "image"]);
});

test("importAll merge keeps the newer record", async () => {
  await S.put("p", "casefile", "1", { v: "phone" });
  const exp = await S.exportAll();
  const phone = exp.records[0];
  const older = { ...phone, value: { v: "old" }, updatedAt: "2000-01-01T00:00:00.000Z" };
  const newer = { ...phone, value: { v: "new" }, updatedAt: "2999-01-01T00:00:00.000Z" };
  const fresh = { key: "q|iec|1", projectId: "q", kind: "iec", id: "1", value: { s: 1 }, updatedAt: "2026-01-01T00:00:00.000Z" };
  const junk = { key: "bad", projectId: "q", kind: "iec", id: "2", value: {} };
  let c = await S.importAll({ format: "rmd-data", version: 1, records: [older, fresh, junk] }, "merge");
  assert.deepEqual(c, { added: 1, updated: 0, skipped: 2 });
  assert.deepEqual(await S.get("p", "casefile", "1"), { v: "phone" });
  c = await S.importAll({ format: "rmd-data", version: 1, records: [newer] }, "merge");
  assert.deepEqual(c, { added: 0, updated: 1, skipped: 0 });
  assert.deepEqual(await S.get("p", "casefile", "1"), { v: "new" });
});

test("importAll replace clears first", async () => {
  await S.put("p", "casefile", "1", { v: 1 });
  await S.put("p", "casefile", "2", { v: 2 });
  const rec = { key: "p|casefile|3", projectId: "p", kind: "casefile", id: "3", value: { v: 3 }, updatedAt: "2026-01-01T00:00:00.000Z" };
  const c = await S.importAll({ format: "rmd-data", version: 1, records: [rec] }, "replace");
  assert.deepEqual(c, { added: 1, updated: 0, skipped: 0 });
  assert.deepEqual((await S.list("p", "casefile")).map((r) => r.id), ["3"]);
});

test("importAll refuses a file that is not an export", async () => {
  await assert.rejects(S.importAll({ format: "x" }, "merge"), /not a ResearchMD data export/);
  await assert.rejects(S.importAll({ format: "rmd-data", version: 1, records: [] }, "wipe"), /merge or replace/);
});

test("migrateLegacy copies old master charts once and keeps the old key", async () => {
  const chart = { fileName: "a.csv", columns: ["age"], rows: [["40"]], types: { age: "numeric" } };
  globalThis.localStorage.setItem("smd_rmd_masterchart_v1", JSON.stringify({ p9: chart, p8: null }));
  const r1 = await S.migrateLegacy();
  assert.equal(r1.migrated, 1);
  assert.deepEqual(await S.get("p9", "masterchart", "main"), chart);
  assert.ok(globalThis.localStorage.getItem("smd_rmd_masterchart_v1"), "old key left in place until backup");
  const r2 = await S.migrateLegacy();
  assert.equal(r2.migrated, 0);
});

test("available reflects the backend", () => {
  S._setBackend(S._memoryBackend(), false);
  assert.equal(S.available(), false);
  S._setBackend(S._memoryBackend(), true);
  assert.equal(S.available(), true);
});
