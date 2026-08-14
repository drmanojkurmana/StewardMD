/* Phase 8 P2 unit tests: the IO toxicity (irAE) principles engine (onco-iotox.js) and the Favorites +
 * Recent store (onco-favorites.js).
 *   - iotox: the real kb/onco/iotox/catalog.json passes the fabrication auditor; the auditor FAILS
 *     CLOSED on a numeral (a fabricated dose/threshold proxy), an unflagged entry, or a missing/empty
 *     principle; principles are grounded in ASCO/NCCN/SITC (by name) and carry no doses.
 *   - favorites: toggle is idempotent per id, recent is de-duplicated + capped, and every localStorage
 *     access is private-mode safe (a THROWING localStorage degrades to an in-memory no-op, never throws).
 * node --test test/onco-p2.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

global.window = global;
if (!global.document) global.document = { addEventListener() {}, getElementById() { return null; }, createElement() { return {}; }, body: { appendChild() {} } };

// A THROWING localStorage installed BEFORE requiring onco-favorites.js — proves the module's try/catch
// guards degrade to the in-memory fallback (private-mode / disabled-storage safe).
global.localStorage = { getItem() { throw new Error("private mode"); }, setItem() { throw new Error("private mode"); } };

const IOT = require(join(ROOT, "onco-iotox.js"));
const FAV = require(join(ROOT, "onco-favorites.js"));
const iotox = JSON.parse(readFileSync(join(ROOT, "kb", "onco", "iotox", "catalog.json"), "utf8"));

/* ---------------- IO toxicity (irAE) ---------------- */

test("gap message is shared by engine + catalog and names the guidelines", () => {
  assert.equal(iotox.gapMessage, IOT.GAP_MESSAGE);
  assert.match(iotox.gapMessage, /ASCO|NCCN|SITC/);
});

test("the real irAE catalog PASSES the fabrication auditor", () => {
  const res = IOT.auditFabricationSafe(iotox);
  assert.ok(res.ok, "iotox catalog failed the audit: " + JSON.stringify(res.problems));
});

test("every organ: R1-flagged, cites ASCO/NCCN/SITC, grades 1-4 non-empty and NUMERAL-FREE (principles, not doses)", () => {
  iotox.organs.forEach((o) => {
    assert.equal(o.requiresR1Verification, true, o.id + " must be R1-flagged");
    assert.ok((o.guidelineRefs || []).some((g) => ["ASCO", "NCCN", "SITC"].includes(g)), o.id + " must name a guideline");
    ["1", "2", "3", "4"].forEach((k) => {
      const v = o.grades[k];
      assert.ok(typeof v === "string" && v.trim().length, o.id + " grade " + k + " must be a non-empty principle");
      assert.ok(!/\d/.test(v), o.id + " grade " + k + " leaked a numeral (possible fabricated dose/threshold): " + v);
    });
  });
});

test("auditOrgan FAILS CLOSED if a principle contains a numeral (a fabricated dose/threshold)", () => {
  const bad = JSON.parse(JSON.stringify(IOT.findOrgan(iotox, "colitis")));
  bad.grades["2"] = "Withhold and give prednisone 1 mg/kg.";
  const res = IOT.auditOrgan(bad);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some((p) => /numeral/i.test(p)));
});

test("auditOrgan FAILS CLOSED if unflagged, un-cited, or a principle is empty", () => {
  const a = JSON.parse(JSON.stringify(IOT.findOrgan(iotox, "hepatitis")));
  a.requiresR1Verification = false;
  assert.equal(IOT.auditOrgan(a).ok, false);
  const b = JSON.parse(JSON.stringify(IOT.findOrgan(iotox, "hepatitis")));
  b.guidelineRefs = [];
  assert.equal(IOT.auditOrgan(b).ok, false);
  const c = JSON.parse(JSON.stringify(IOT.findOrgan(iotox, "hepatitis")));
  c.grades["3"] = "  ";
  assert.equal(IOT.auditOrgan(c).ok, false);
});

test("findOrgan resolves known organs (endocrine exception present) and returns null otherwise", () => {
  assert.ok(IOT.findOrgan(iotox, "endocrine"));
  assert.match(IOT.findOrgan(iotox, "endocrine").grades["2"], /hormone replacement/i);
  assert.equal(IOT.findOrgan(iotox, "nope"), null);
});

/* ---------------- Favorites + Recent (private-mode safe) ---------------- */

test("favorites: toggle is idempotent per id, has() reflects state, private-mode safe (no throw)", () => {
  const item = { id: "calc:khorana", label: "Khorana Score", act: "calc:khorana" };
  assert.equal(FAV.has("calc:khorana"), false);
  assert.equal(FAV.toggle(item), true);      // added
  assert.equal(FAV.has("calc:khorana"), true);
  assert.equal(FAV.toggle(item), false);     // removed
  assert.equal(FAV.has("calc:khorana"), false);
});

test("recent: de-duplicated by id, most-recent-first, capped at RECENT_CAP", () => {
  FAV.clearRecent();
  for (let i = 0; i < FAV.RECENT_CAP + 5; i++) FAV.record({ id: "kb:d" + i, label: "Disease " + i, act: "kb:d" + i });
  const rec = FAV.recent();
  assert.ok(rec.length <= FAV.RECENT_CAP, "recent must be capped: " + rec.length);
  assert.equal(rec[0].id, "kb:d" + (FAV.RECENT_CAP + 4), "most-recent-first");
  // re-recording an existing id moves it to the front without duplicating
  FAV.record({ id: rec[2].id, label: rec[2].label, act: rec[2].act });
  const rec2 = FAV.recent();
  assert.equal(rec2[0].id, rec[2].id);
  assert.equal(rec2.filter((x) => x.id === rec[2].id).length, 1, "no duplicate entries");
});

test("favorites: record ignores items with no act; toggle ignores items with no id", () => {
  FAV.clearRecent();
  FAV.record({ id: "x", label: "x" });           // no act -> ignored
  assert.equal(FAV.recent().length, 0);
  assert.equal(FAV.toggle(null), false);         // no item -> ignored, no throw
});
