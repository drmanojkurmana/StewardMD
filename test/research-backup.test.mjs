/* Encrypted backup round trip. Images are data URL strings, never Blobs.
 * PBKDF2 is 600,000 iterations, so this file is one sequential test.
 * Run: node --test --test-timeout=180000 test/research-backup.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("../research-idb.js");
const backup = require("../research-backup.js");

const PHRASE = "backup-phrase-1";
const DATA_URL = "data:image/jpeg;base64,SYNTHJPEGTOKEN";
const WEEK = 7 * 24 * 60 * 60 * 1000;

function memoryBag() {
  const bag = {};
  globalThis.localStorage = {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : null;
    },
    setItem: function (k, v) { bag[k] = String(v); },
    removeItem: function (k) { delete bag[k]; },
    key: function () { return null; },
    get length() { return Object.keys(bag).length; }
  };
  return bag;
}

test("export, restore, wrong passphrase, tamper, merge and replace", { timeout: 180000 }, async function () {
  const bag = memoryBag();
  const image = { dataUrl: DATA_URL, width: 8, height: 8, name: "synthetic.jpg", redacted: true };
  let backend = { records: {}, local: {} };
  await store._setBackend(backend);
  const putImage = await store.put("p1", "image", "img1", image);
  const putChart = await store.put("p1", "masterchart", "chart", { title: "Synthetic chart", n: 4 });
  assert.ok(!putImage || putImage.ok !== false);
  assert.ok(!putChart || putChart.ok !== false);

  const missing = await backup.exportFile();
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "not-a-backup");

  const exp = await backup.exportFile(PHRASE, { includeImages: true });
  assert.equal(exp.ok, true);
  assert.match(exp.filename, /^ResearchMD-backup-\d{4}-\d{2}-\d{2}\.rmdbackup$/);
  assert.deepEqual(exp.warnings, []);
  const text = await exp.blob.text();
  const env = JSON.parse(text);
  assert.equal(env.format, "rmd-backup");
  assert.equal(env.version, 1);
  assert.equal(env.kdf.name, "PBKDF2");
  assert.equal(env.kdf.hash, "SHA-256");
  assert.equal(env.kdf.iterations, 600000);
  assert.equal(env.cipher.name, "AES-GCM");

  const opened = await backup.readFile(exp.blob, PHRASE);
  assert.equal(opened.ok, true);
  assert.equal(opened.counts.images, 1);
  assert.equal(opened.counts.records, 2);
  const imgRec = opened.data.records.filter(function (r) { return r.kind === "image"; })[0];
  assert.equal(imgRec.value.dataUrl, DATA_URL);

  backend = { records: {}, local: {} };
  await store._setBackend(backend);
  const restored = await backup.restore(opened.data, "replace");
  assert.equal(restored.ok, true);
  assert.equal(restored.added, 2);
  assert.equal(restored.updated, 0);
  const back = await store.get("p1", "image", "img1");
  assert.equal(back.dataUrl, DATA_URL);
  const chartBack = await store.get("p1", "masterchart", "chart");
  assert.equal(chartBack.title, "Synthetic chart");

  const wrong = await backup.readFile(text, "not-the-phrase");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "wrong-passphrase");

  const flipped = JSON.parse(text);
  const chars = flipped.data.split("");
  chars[8] = chars[8] === "A" ? "B" : "A";
  flipped.data = chars.join("");
  const tampered = await backup.readFile(JSON.stringify(flipped), PHRASE);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, "wrong-passphrase");

  const hidden = await backup.exportFile(PHRASE, { includeImages: false });
  assert.equal(hidden.ok, true);
  const hiddenRead = await backup.readFile(hidden.blob, PHRASE);
  assert.equal(hiddenRead.ok, true);
  assert.equal(hiddenRead.counts.images, 0);
  assert.equal(hiddenRead.data.records.some(function (r) { return r.kind === "image"; }), false);
  assert.ok(hiddenRead.data.records.some(function (r) { return r.kind === "masterchart"; }));

  const newer = JSON.parse(text);
  newer.version = 2;
  const refused = await backup.readFile(JSON.stringify(newer), PHRASE);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "newer-version");
  const junk = await backup.readFile("not json", PHRASE);
  assert.equal(junk.ok, false);
  assert.equal(junk.reason, "not-a-backup");

  const fileData = {
    format: "rmd-data",
    version: 1,
    exportedAt: "2024-06-01T00:00:00.000Z",
    records: [
      { projectId: "p1", kind: "masterchart", id: "chart", value: { title: "from file", n: 2 }, updatedAt: "2024-06-01T00:00:00.000Z" },
      { projectId: "p1", kind: "casefile", id: "1", value: { note: "added" }, updatedAt: "2024-06-01T00:00:00.000Z" }
    ]
  };
  backend = { records: {}, local: {} };
  await store._setBackend(backend);
  await store.put("p1", "masterchart", "chart", { title: "on phone", n: 1 });
  backend.records["p1|masterchart|chart"].updatedAt = "2020-01-01T00:00:00.000Z";
  await store.put("p1", "casefile", "keep", { note: "stay" });
  backend.records["p1|casefile|keep"].updatedAt = "2025-01-01T00:00:00.000Z";
  const merged = await backup.restore(fileData, "merge");
  assert.equal(merged.ok, true);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.skipped, 0);
  assert.equal((await store.get("p1", "masterchart", "chart")).title, "from file");
  assert.equal((await store.get("p1", "casefile", "keep")).note, "stay");
  const older = await backup.restore({
    format: "rmd-data",
    version: 1,
    records: [
      { projectId: "p1", kind: "masterchart", id: "chart", value: { title: "older" }, updatedAt: "2023-01-01T00:00:00.000Z" }
    ]
  }, "merge");
  assert.equal(older.ok, true);
  assert.equal(older.added, 0);
  assert.equal(older.updated, 0);
  assert.equal(older.skipped, 1);
  assert.equal((await store.get("p1", "masterchart", "chart")).title, "from file");

  await store.put("p1", "casefile", "extra", { note: "gone" });
  const replaced = await backup.restore(fileData, "replace");
  assert.equal(replaced.ok, true);
  assert.equal(replaced.added, 0);
  assert.equal(replaced.updated, 2);
  assert.equal(replaced.skipped, 0);
  assert.equal((await store.get("p1", "masterchart", "chart")).title, "from file");
  assert.equal((await store.get("p1", "casefile", "1")).note, "added");
  assert.equal(await store.get("p1", "casefile", "keep"), null);
  assert.equal(await store.get("p1", "casefile", "extra"), null);
  const badMode = await backup.restore(fileData, "sideways");
  assert.equal(badMode.ok, false);

  const now = Date.parse("2026-06-15T00:00:00.000Z");
  delete bag["rmd.v1.lastChangeAt"];
  delete bag["rmd.v1.lastBackupAt"];
  assert.equal(await backup.isDue(now), false);
  bag["rmd.v1.lastChangeAt"] = new Date(now - 1000).toISOString();
  assert.equal(await backup.isDue(now), false);
  bag["rmd.v1.lastChangeAt"] = new Date(now - WEEK - 1000).toISOString();
  assert.equal(await backup.isDue(now), true);
  bag["rmd.v1.lastBackupAt"] = new Date(now - 1000).toISOString();
  assert.equal(await backup.isDue(now), false);
  bag["rmd.v1.lastChangeAt"] = new Date(now - 1000).toISOString();
  bag["rmd.v1.lastBackupAt"] = new Date(now - WEEK - 1000).toISOString();
  assert.equal(await backup.isDue(now), true);
  const banner = await backup.weeklyBanner(now);
  assert.ok(banner.indexOf("Back up your research data") >= 0);
  bag["rmd.v1.lastBackupAt"] = new Date(now - 1000).toISOString();
  assert.equal(await backup.weeklyBanner(now), "");
});
