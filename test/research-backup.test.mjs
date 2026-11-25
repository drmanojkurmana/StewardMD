/* Plan v2 item 8: encrypted backup and restore (research-backup.js) over RMDStore.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-backup.test.mjs
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

function fakeLocalStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
globalThis.localStorage = fakeLocalStorage();
const S = require("../research-idb.js");
const B = require("../research-backup.js");
const SRC = readFileSync(new URL("../research-backup.js", import.meta.url), "utf8");
const FAST = { iterations: 1000 };

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
  S._setBackend(S._memoryBackend(), true);
});

test("source is ES5 with .then chains and no dashes", () => {
  assert.ok(!/=>/.test(SRC) && !/\b(let|const|class|async|await)\s/.test(SRC));
  assert.ok(!/[–—]/.test(SRC));
  assert.equal(B.ITERATIONS, 600000);
});

test("round trip with the real 600,000 iterations; file layout is fixed", async () => {
  const file = await B.encrypt({ hello: "world", n: [1, 2] }, "correct horse");
  assert.equal(file.format, "rmd-backup");
  assert.equal(file.version, 1);
  assert.deepEqual(Object.keys(file.kdf).sort(), ["hash", "iterations", "name", "salt"]);
  assert.equal(file.kdf.iterations, 600000);
  assert.equal(Buffer.from(file.kdf.salt, "base64").length, 16);
  assert.equal(Buffer.from(file.cipher.iv, "base64").length, 12);
  assert.ok(!JSON.stringify(file).includes("world"), "plain text never in the file");
  assert.deepEqual(await B.decrypt(JSON.stringify(file), "correct horse"), { hello: "world", n: [1, 2] });
});

test("wrong passphrase or a changed file is refused", async () => {
  const file = await B.encrypt({ a: 1 }, "passphrase1", FAST);
  await assert.rejects(B.decrypt(file, "passphrase2"), /passphrase is wrong/);
  const bytes = Buffer.from(file.data, "base64");
  bytes[0] ^= 1;
  await assert.rejects(B.decrypt({ ...file, data: bytes.toString("base64") }, "passphrase1"), /passphrase is wrong/);
  await assert.rejects(B.decrypt({ format: "x" }, "passphrase1"), /not a ResearchMD backup/);
});

test("short passphrase is refused", async () => {
  await assert.rejects(B.encrypt({}, "short"), /at least 8 characters/);
  assert.equal(B.checkPassphrase("12345678"), "");
});

test("U6: data survives backup, clearing app data and restore", async () => {
  await S.put("p1", "casefile", "1", { age: 40, presenting: "fever" });
  await S.put("p1", "masterchart", "main", { columns: ["age"], rows: [["40"]] });
  await S.put("p1", "image", "1", { data: "big" });
  globalThis.localStorage.setItem("smd_rmd_masterchart_v1", "{}");
  const bk = await B.makeBackup("long enough", { ...FAST, now: new Date(2026, 10, 25) });
  assert.equal(bk.fileName, "ResearchMD-backup-2026-11-25.rmdbackup");
  assert.equal(bk.counts.records, 2, "images left out by default");
  B.markBackedUp("2026-11-25T00:00:00.000Z");
  assert.equal(globalThis.localStorage.getItem("rmd.v1.lastBackupAt"), "2026-11-25T00:00:00.000Z");
  assert.equal(globalThis.localStorage.getItem("smd_rmd_masterchart_v1"), null, "old copy dropped after the first backup");
  /* clear app data */
  S._setBackend(S._memoryBackend(), true);
  globalThis.localStorage = fakeLocalStorage();
  assert.equal(await S.get("p1", "casefile", "1"), null);
  const pv = await B.preview(bk.text, "long enough");
  assert.deepEqual(pv.counts.projects, [{ projectId: "p1", kinds: { casefile: 1, masterchart: 1 } }]);
  const res = await B.restore(bk.text, "long enough", "merge");
  assert.deepEqual(res, { added: 2, updated: 0, skipped: 0 });
  assert.deepEqual(await S.get("p1", "casefile", "1"), { age: 40, presenting: "fever" });
});

test("weekly prompt only after a change and a week without a backup", () => {
  assert.equal(B.needsPrompt(Date.parse("2026-11-25T00:00:00Z")), false, "nothing saved yet");
  S.lsSet("lastChangeAt", "2026-11-20T00:00:00.000Z");
  assert.equal(B.needsPrompt(Date.parse("2026-11-25T00:00:00Z")), true, "never backed up");
  S.lsSet("lastBackupAt", "2026-11-19T00:00:00.000Z");
  assert.equal(B.needsPrompt(Date.parse("2026-11-25T00:00:00Z")), false, "under a week");
  assert.equal(B.needsPrompt(Date.parse("2026-11-26T00:00:00Z")), true, "a week and a change");
  S.lsSet("lastBackupAt", "2026-11-21T00:00:00.000Z");
  assert.equal(B.needsPrompt(Date.parse("2026-12-30T00:00:00Z")), false, "no change since the backup");
});

test("the old localStorage chart is kept when IndexedDB is not available", () => {
  S._setBackend(S._memoryBackend(), false);
  globalThis.localStorage.setItem("smd_rmd_masterchart_v1", "{\"p1\":{}}");
  B.markBackedUp("2026-11-25T00:00:00.000Z");
  assert.equal(globalThis.localStorage.getItem("smd_rmd_masterchart_v1"), "{\"p1\":{}}");
});
