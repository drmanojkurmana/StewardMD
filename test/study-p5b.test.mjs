/* Phase 5b pure helpers (study-media.js): bytes/duration format, seek clamp, hit stepping, page list, mime pick, storage. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const M = createRequire(import.meta.url)("../study-media.js");

test("fmtBytes: B to MB thresholds", () => {
  assert.equal(M.fmtBytes(0), "0 B");
  assert.equal(M.fmtBytes(512), "512 B");
  assert.equal(M.fmtBytes(1024), "1 KB");
  assert.equal(M.fmtBytes(1536), "1.5 KB");
  assert.match(M.fmtBytes(1048576), /MB|KB/);
  assert.ok(/MB/.test(M.fmtBytes(3 * 1048576)));
});

test("fmtDur: minutes:seconds with pad", () => {
  assert.equal(M.fmtDur(0), "0:00");
  assert.equal(M.fmtDur(65), "1:05");
  assert.equal(M.fmtDur(125), "2:05");
  assert.equal(M.fmtDur(-5), "0:00");
  assert.equal(M.fmtDur(5.9), "0:05");
});

test("clampSeek: clamps to [0, dur], dur 0 means no upper clamp", () => {
  assert.equal(M.clampSeek(-1, 10), 0);
  assert.equal(M.clampSeek(20, 10), 10);
  assert.equal(M.clampSeek(5, 10), 5);
  assert.equal(M.clampSeek(100, 0), 100);
  assert.equal(M.clampSeek(2.5, 10), 2.5);
});

test("nextIdx: wraps both directions", () => {
  assert.equal(M.nextIdx(0, 3, 1), 1);
  assert.equal(M.nextIdx(2, 3, 1), 0);
  assert.equal(M.nextIdx(0, 3, -1), 2);
  assert.equal(M.nextIdx(5, 3, 1), 0);
  assert.equal(M.nextIdx(0, 0, 1), -1);
});

test("isValidStrokeTime: non-negative finite within dur", () => {
  assert.equal(M.isValidStrokeTime(0, 10), true);
  assert.equal(M.isValidStrokeTime(10, 10), true);
  assert.equal(M.isValidStrokeTime(11, 10), false);
  assert.equal(M.isValidStrokeTime(-1, 10), false);
  assert.equal(M.isValidStrokeTime(null, 10), false);
  assert.equal(M.isValidStrokeTime(5, 0), true);
});

test("pageList: all pages or single page, bounds checked", () => {
  assert.deepEqual(M.pageList(3, null), [1, 2, 3]);
  assert.deepEqual(M.pageList(3, 2), [2]);
  assert.deepEqual(M.pageList(3, 9), []);
  assert.deepEqual(M.pageList(0, null), []);
  assert.deepEqual(M.pageList(2, 0), []);
});

test("pickMime: prefers mp4/aac then webm/opus", () => {
  assert.equal(M.pickMime({ "audio/mp4": 1, "audio/webm": 1 }), "audio/mp4");
  assert.equal(M.pickMime({ "audio/webm": 1 }), "audio/webm");
  assert.equal(M.pickMime({}), "");
});

test("storageOf: sums pdf + audio + strokes", () => {
  assert.deepEqual(M.storageOf({}), { pdfBytes: 0, audioBytes: 0, strokeBytes: 0, total: 0 });
  assert.deepEqual(M.storageOf({ pdfBytes: 100, audioBytes: 50, strokeBytes: 25 }), { pdfBytes: 100, audioBytes: 50, strokeBytes: 25, total: 175 });
});

/* Audio backup: verifyBackup stays compatible with old backups and checks audio. */
import { createHash } from "node:crypto";
const S = createRequire(import.meta.url)("../study.js");
const F = createRequire(import.meta.url)("../fflate.min.js");
const shaN = async (b) => createHash("sha256").update(b).digest("hex");
const enc = (o) => F.strToU8(JSON.stringify(o));
async function makeBackupWithAudio(mut) {
  const pdf = new Uint8Array(100).map((_, i) => (i + 1) & 255);
  const bin = new Uint8Array([1, 2, 3, 4, 5]);
  const ent = {};
  ent["folders.json"] = enc([]);
  ent["docs/d1.json"] = enc({ doc: { id: "d1", title: "A", sha256: await shaN(pdf), kind: "pdf" }, strokes: [], undo: null, ptext: [], index: null });
  ent["files/d1.pdf"] = pdf;
  ent["audio.json"] = enc([{ id: "a1", doc: "d1", mime: "audio/webm", size: 5, started: 1, dur: 2 }]);
  ent["audio/a1.bin"] = bin;
  const man = { format: "stewardmd-study-backup", v: 1, created: 1, counts: { docs: 1, folders: 0, strokes: 0, ptext: 0, files: 1, audio: 1 }, files: [] };
  for (const n of Object.keys(ent)) man.files.push({ name: n, sha256: await shaN(ent[n]), bytes: ent[n].length });
  ent["manifest.json"] = enc(man);
  if (mut) await mut(ent, man);
  return ent;
}
test("audio backup verify: audio round trips, old backup without audio still passes", async () => {
  const v = await S.verifyBackup(await makeBackupWithAudio(), shaN);
  assert.equal(v.ok, true);
  assert.equal(v.audio.length, 1);
  const oldEnt = await makeBackupWithAudio(async (e, m) => { delete e["audio.json"]; delete e["audio/a1.bin"]; m.counts.audio = 0; m.files = m.files.filter((f) => !/^audio/.test(f.name)); e["manifest.json"] = enc(m); });
  assert.equal((await S.verifyBackup(oldEnt, shaN)).ok, true);
  const noCount = await makeBackupWithAudio(async (e, m) => { delete m.counts.audio; e["manifest.json"] = enc(m); });
  assert.equal((await S.verifyBackup(noCount, shaN)).ok, true);
  const bad = await makeBackupWithAudio(async (e, m) => { m.counts.audio = 2; e["manifest.json"] = enc(m); });
  assert.equal((await S.verifyBackup(bad, shaN)).ok, false);
});
