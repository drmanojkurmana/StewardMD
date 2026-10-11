/* PrepNucleus Tests gaps B (task B): new engine types in prep-assess.js.
 * What must hold:
 *  - the type names match prep/assess/schemas/blueprint.schema.json (case, image, daily_mixed, weak_area,
 *    incorrect); daily mixed is 25 questions, subject-balanced, seeded by the IST date, refused below 25;
 *  - clinical vignette detection is exactly the bank build's rule (tools/prep-build-bank.mjs isVignette),
 *    plus the USMLE tag accepted on any exam;
 *  - image/case assemble only matching items (the type implies its filter), record the drops, shrink with the
 *    reason or refuse below the minimum, and never pad with unrelated questions;
 *  - weak_area scopes to the given modules, incorrect to the given ids; custom honours count, difficulty and
 *    image together; Daily mixed completion is counted once per day;
 *  - assembly is deterministic per seed; no duplicate id or stem.
 * node --test test/prep-gaps-types.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { isVignette as buildVignette } from "../tools/prep-build-bank.mjs";

const require = createRequire(import.meta.url);
const A = require("../prep-assess.js");
const PG = A.profile("neet-pg");

const V_AGE = "A 45-year-old man presents with three days of fever, dry cough, and progressive shortness of breath on exertion and at rest with pleuritic chest pain and bilateral crackles on examination today";
const V_PRESENTS = "The patient complains of a severe throbbing headache with nausea, vomiting, photophobia, and visual aura lasting six hours despite rest, fluids, and two doses of simple analgesia today";
const LONG_PLAIN = "Explain in full detail the sequential steps of the citric acid cycle including every intermediate molecule enzyme cofactor and regulatory checkpoint controlling cellular energy production inside mitochondria under aerobic conditions always";

function mkBank(spec, each) {
  const bank = [];
  for (const s of Object.keys(spec)) spec[s].forEach((n, mi) => {
    const m = s + "-m" + mi, items = [];
    for (let i = 0; i < n; i++) {
      const it = { id: s + "." + mi + "." + i, q: "Question about " + s + " module " + mi + " number " + i + " with enough words", o: ["w", "x", "y", "z"], a: i % 4, d: 1 + (i % 3), _s: s, _m: m };
      if (each) each(it, s, mi, i);
      items.push(it);
    }
    bank.push({ s, m, items });
  });
  return bank;
}
const vig = (prefix) => (it, s, mi, i) => { if (i % 2 === 0) it.q = prefix + " case item " + s + " " + mi + " " + i + " end"; };

test("new types exist and their blueprints carry the planned numbers", () => {
  for (const t of ["daily_mixed", "image", "case", "weak_area", "incorrect"]) assert.ok(A.TYPES.includes(t), t);
  const dm = A.blueprint(PG, "daily_mixed");
  assert.equal(dm.count, 25); assert.equal(dm.spread, "balanced"); assert.equal(dm.seed_rule, "daily_ist_date");
  assert.equal(dm.shortfall, "refuse"); assert.equal(dm.min_viable, 25);
  for (const t of ["image", "case", "weak_area", "incorrect"]) {
    const b = A.blueprint(PG, t);
    assert.equal(b.count, 20); assert.equal(b.min_viable, 5); assert.equal(b.spread, "scope");
  }
  assert.equal(A.blueprint(PG, "custom", { count: 200 }).count, 100);
  assert.equal(A.blueprint(PG, "custom", { count: 2 }).count, 5);
  assert.equal(A.blueprint(PG, "custom").count, 20);
});

test("isVignette is exactly the bank build's rule, plus the USMLE tag on any exam", () => {
  assert.ok(V_AGE.split(/\s+/).length >= 25 && V_PRESENTS.split(/\s+/).length >= 25 && LONG_PLAIN.split(/\s+/).length >= 25);
  const samples = [V_AGE, V_PRESENTS, "Which enzyme is deficient in Tay-Sachs disease?", LONG_PLAIN, "A 45-year-old man", "The review presents three trials of therapy"];
  for (const q of samples) assert.equal(A.isVignette({ q }), buildVignette(q), q);
  assert.equal(A.isVignette({ q: "short", ex: ["usmle"] }), true, "tagged item counts without the pattern");
  assert.equal(A.isVignette({ q: V_AGE, ex: ["neet-pg"] }), true, "pattern counts without the tag");
  assert.equal(A.isVignette({ q: "short", ex: ["neet-pg"] }), false);
  assert.equal(A.isVignette(null), false);
});

test("case tests assemble vignettes only; shortfalls shrink or refuse with the reason", () => {
  const bank = mkBank({ anatomy: [12] }, vig(V_AGE));
  const r = A.assemble(PG, "case", { seed: "c1" }, bank);
  assert.equal(r.count, 6);
  assert.ok(r.items.every((it) => A.isVignette(it)));
  assert.equal(r.dropped["no-vignette"], 6);
  assert.equal(r.reduced, true);
  assert.match(r.deviations[0], /Reduced to 6 of 20/);
  const tiny = A.assemble(PG, "case", { seed: "c1" }, mkBank({ anatomy: [4] }, vig(V_AGE)));
  assert.equal(tiny.ok, false);
  assert.match(tiny.refused, /needs at least 5/);
});

test("image tests assemble image items only", () => {
  const bank = mkBank({ anatomy: [12] }, (it, s, mi, i) => { if (i < 7) it.img = ["fig" + i + ".jpg"]; });
  const r = A.assemble(PG, "image", { seed: "i1" }, bank);
  assert.equal(r.count, 7);
  assert.ok(r.items.every((it) => A.hasImage(it)));
  assert.equal(r.dropped["no-image"], 5);
  assert.match(r.deviations[0], /Reduced to 7 of 20/);
});

test("daily mixed is 25, subject-balanced and deterministic; below 25 it refuses", () => {
  const bank = mkBank({ anatomy: [30], physiology: [30], pathology: [30], medicine: [30], surgery: [30] });
  const seed = A.dailyKey("neet-pg", Date.parse("2026-10-11T06:00:00Z"), "daily_mixed");
  assert.equal(seed, "daily_mixed:neet-pg:2026-10-11");
  const r = A.assemble(PG, "daily_mixed", { seed }, bank);
  assert.equal(r.ok, true); assert.equal(r.count, 25);
  assert.deepEqual(Object.keys(r.actual).sort().map((k) => r.actual[k]), [5, 5, 5, 5, 5]);
  const r2 = A.assemble(PG, "daily_mixed", { seed }, bank);
  assert.deepEqual(r2.items.map((it) => it.id), r.items.map((it) => it.id), "same seed, same set");
  const thin = A.assemble(PG, "daily_mixed", { seed }, mkBank({ anatomy: [30], physiology: [30], pathology: [1] }));
  assert.equal(thin.count, 25); assert.equal(thin.actual.pathology, 1, "thin subject keeps its one; the rest stays in scope");
  assert.ok(thin.deviations.join(" ").match(/moved/), "redistribution is recorded");
  const small = A.assemble(PG, "daily_mixed", { seed }, mkBank({ anatomy: [20] }));
  assert.equal(small.ok, false);
  assert.match(small.refused, /needs at least 25/);
});

test("daily mixed completion is counted once per day, separately from Daily 10", () => {
  const ms = Date.parse("2026-10-11T06:00:00Z");
  const k0 = A.dailyKey("neet-pg", ms), k1 = A.dailyKey("neet-pg", ms, "daily_mixed");
  assert.equal(k0, "daily10:neet-pg:2026-10-11");
  assert.notEqual(k1, k0);
  const map = {};
  const first = A.dailyComplete(map, k1, { raw: 10, max: 25 });
  const retry = A.dailyComplete(map, k1, { raw: 20, max: 25 });
  assert.equal(first.fresh, true); assert.equal(retry.fresh, false);
  assert.equal(map[k1].raw, 10, "a retry keeps the first record");
  map["daily_mixed:neet-pg:2026-01-01"] = { raw: 1 };
  A.dailyPrune(map, ms, 60);
  assert.equal(map["daily_mixed:neet-pg:2026-01-01"], undefined, "old keys prune whatever the kind");
  assert.ok(map[k1], "today's key survives");
});

test("weak_area scopes to the given modules and refuses when empty", () => {
  const bank = mkBank({ anatomy: [10, 10], physiology: [10] });
  const r = A.assemble(PG, "weak_area", { seed: "w1", modules: ["anatomy-m1"] }, bank);
  assert.ok(r.items.length > 0 && r.items.every((it) => it._m === "anatomy-m1"));
  const empty = A.assemble(PG, "weak_area", { seed: "w1", modules: ["nope"] }, bank);
  assert.equal(empty.ok, false);
  assert.match(empty.refused, /No eligible questions/);
});

test("incorrect scopes to the given ids and never fills from outside", () => {
  const bank = mkBank({ anatomy: [12] });
  const only = {};
  bank[0].items.slice(0, 8).forEach((it) => { only[it.id] = 1; });
  const r = A.assemble(PG, "incorrect", { seed: "m1", count: 20, only }, bank);
  assert.equal(r.count, 8);
  assert.ok(r.items.every((it) => only[it.id]), "every item is one of the mistakes");
  assert.equal(r.reduced, true);
  assert.match(r.deviations[0], /Reduced to 8 of 20/);
});

test("custom honours count, difficulty and image together within the chosen subjects", () => {
  const bank = mkBank({ anatomy: [40], physiology: [40] }, (it, s, mi, i) => { if (i % 2 === 0) it.img = ["fig.jpg"]; });
  const r = A.assemble(PG, "custom", { seed: "u1", count: 10, difficulty: 3, image: true, subjects: ["anatomy"] }, bank);
  assert.equal(r.count, 7, "exactly the hard image items of anatomy");
  assert.ok(r.items.every((it) => it._s === "anatomy" && A.levelOf(it) === 3 && A.hasImage(it)));
  assert.match(r.deviations[0], /Reduced to 7 of 10/);
});

test("no duplicate id or stem; determinism per seed", () => {
  const bank = mkBank({ anatomy: [25] }, vig(V_PRESENTS));
  bank[0].items[1].q = bank[0].items[0].q;
  bank[0].items[1].id = "dup-id";
  const r = A.assemble(PG, "case", { seed: "d1" }, bank);
  const ids = r.items.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(r.deviations.join(" ").match(/duplicate/));
  const r2 = A.assemble(PG, "case", { seed: "d1" }, bank);
  assert.deepEqual(r2.items.map((it) => it.id), ids);
});
