/* PrepNucleus subject screen data: module counts include the overlay items practice draws (prep.js countFor, ovFor and
 * the committed prep/bank/overlay-counts.json), a subject's lessons grouped by module in module order
 * (prep-lessons.js subjectLessons), and the overlay counts tool's parsing (tools/prep-overlay-counts.mjs).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-subject.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { overlaysOf, usableCount } from "../tools/prep-overlay-counts.mjs";
const require = createRequire(import.meta.url);
const P = require("../prep.js");
const L = require("../prep-lessons.js");
const ROOT = new URL("..", import.meta.url);

test("countFor adds overlay items; USMLE vignettes stay their own count", () => {
  assert.equal(P.countFor({ count: 40, ov: 12 }, "neet-pg"), 52);
  assert.equal(P.countFor({ count: 40 }, "neet-pg"), 40);
  assert.equal(P.countFor({ count: 0, ov: 5 }, "neet-pg"), 5);
  assert.equal(P.countFor({ count: 40, ov: 12, usmle: 9 }, "usmle"), 9);
  assert.equal(P.countFor({ count: 40, ov: 12, usmle: 2 }, "usmle"), 52);
});

test("ovFor sums a module's items over the subject's sets", () => {
  const sets = { radnotes: { radiology: { "rad-chest": 49 } }, radmax: { radiology: { "rad-chest": 25, "rad-xray": 3 } } };
  assert.equal(P.ovFor(sets, ["radnotes", "radmax"], "radiology", "rad-chest"), 74);
  assert.equal(P.ovFor(sets, ["radnotes", "radmax"], "radiology", "rad-xray"), 3);
  assert.equal(P.ovFor(sets, ["radnotes"], "radiology", "rad-xray"), 0);
  assert.equal(P.ovFor(sets, ["radnotes", "radmax"], "medicine", "rad-chest"), 0);
  assert.equal(P.ovFor({}, ["radnotes"], "radiology", "rad-chest"), 0);
  assert.equal(P.ovFor(null, null, "radiology", "rad-chest"), 0);
});

test("the committed overlay counts cover every set prep.js asks for, on modules of that subject", () => {
  const src = fs.readFileSync(new URL("prep.js", ROOT), "utf8");
  const ov = overlaysOf(src);
  assert.deepEqual(ov.radiology, ["radnotes2", "radmax6"]);
  const oc = JSON.parse(fs.readFileSync(new URL("prep/bank/overlay-counts.json", ROOT), "utf8"));
  assert.equal(oc.v, 1);
  const ver = /VER = G\.SMD_PREP_BANK_VER \|\| "(v\d+)"/.exec(src)[1];
  for (const [sid, list] of Object.entries(ov)) for (const set of list) {
    const m = (oc.sets[set] || {})[sid];
    assert.ok(m && Object.keys(m).length, set + "/" + sid + " has counts");
    const ids = new Set(JSON.parse(fs.readFileSync(new URL("prep/bank/" + ver + "/" + sid + "/index.json", ROOT), "utf8")).topics.map((t) => t.id));
    for (const [mid, n] of Object.entries(m)) { assert.ok(ids.has(mid), mid + " is a " + sid + " module"); assert.ok(Number.isInteger(n) && n > 0); }
  }
});

test("usableCount: an id once, flagged items out", () => {
  assert.equal(usableCount({ items: [{ id: "a" }, { id: "a" }, { id: "b", flags: ["key"] }, { id: "c", flags: [] }, {}, null] }), 2);
  assert.equal(usableCount(null), 0);
});

test("subjectLessons: modules with lessons, in module order, own lesson first", () => {
  const ix = { modules: { m2: { title: "Two" }, "x-1": { title: "Extra", module: "m2" }, m9: { title: "Not here" }, "a-0": { title: "A", module: "m1" } } };
  const out = L.subjectLessons(ix, [{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
  assert.deepEqual(out.map((m) => m.mid), ["m1", "m2"]);
  assert.deepEqual(out[1].list.map((x) => x[0]), ["m2", "x-1"]);
  assert.deepEqual(L.subjectLessons({ modules: {} }, [{ id: "m1" }]), []);
  assert.deepEqual(L.subjectLessons(null, null), []);
});

/* ss-radiology (bank v6 to v10) has no search.json; the app builds the same index from the module files on a 404. */
test("buildSearch: the index built in the app finds items like search.json, flagged items left out", () => {
  const BANK = require("../specialty-bank.js");
  {
    const sx = P.buildSearch([
      { id: "srd-a", items: [{ id: "a1", q: "Berry aneurysm of the anterior communicating artery is seen on", o: ["CT angiography", "MRI", "X-ray", "USG"], a: 0 }, { id: "a2", q: "Flagged aneurysm item", o: ["a", "b", "c", "d"], a: 1, flags: ["key"] }] },
      { id: "srd-b", items: [{ id: "b1", q: "Moyamoya disease shows a puff of smoke on angiography", o: ["ICA", "MCA", "ACA", "PCA"], a: 0 }] },
    ], BANK);
    assert.deepEqual(sx.ids, ["a1", "b1"]);
    assert.deepEqual(BANK.searchIndex(sx, "aneurysm", 10).map((h) => h.id + ":" + h.t), ["a1:srd-a"]);
    assert.deepEqual(BANK.searchIndex(sx, "angiography", 10).map((h) => h.t), ["srd-a", "srd-b"]);
  }
});
