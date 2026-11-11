// "Learn this module" must open the module's own lesson. Owner bug 2026-11-12: a Medical Oncology question in
// son-natural-products ("Anthracyclines, microtubule and topoisomerase agents") showed "Learn this module" with the
// module name but opened the subject rapid-review lesson med-mixed ("Mixed practice: high-yield medicine review").
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const R = createRequire(import.meta.url)(join(ROOT, "prep-reason.js"));

const IX = { modules: {
  "med-mixed": { title: "Mixed practice: high-yield medicine review" },
  "son-natural-products": { title: "Anthracyclines, microtubule and topoisomerase agents" },
  "son-anthracycline-heart": { title: "Anthracycline cardiotoxicity" },
  "phm-cytotoxic-b": { title: "Cytotoxic B", module: "phm-cytotoxic" },
  "phm-cytotoxic-a": { title: "Cytotoxic A", module: "phm-cytotoxic" },
} };
const MIXED = { key: "med-mixed", title: "Mixed practice: high-yield medicine review", c: 75, tier: "topic", step: "", ev: 0 };

test("ownLessonIn: the lesson filed under the module id, else the first lesson whose module is mid", () => {
  assert.equal(R.ownLessonIn(IX, "son-natural-products").key, "son-natural-products");
  assert.equal(R.ownLessonIn(IX, "phm-cytotoxic").key, "phm-cytotoxic-a");
  assert.equal(R.ownLessonIn(IX, "son-nothing"), null);
  assert.equal(R.ownLessonIn(null, "x"), null);
});

test("routeFallbackLessons: a subject fallback lesson is re-pointed at the module's own lesson", () => {
  const own = R.ownLessonIn(IX, "son-natural-products");
  const r = R.routeFallbackLessons([MIXED], null, own, {});
  assert.equal(r.lessons.length, 1);
  assert.equal(r.lessons[0].key, "son-natural-products");
  assert.equal(R.isFallback(r.lessons[0]), true, "still renders as Learn this module");
  const h = R.slotHtml({ links: [], lessons: r.lessons, sid: "ss-medical-oncology", mid: "son-natural-products", mt: "Anthracyclines, microtubule and topoisomerase agents" });
  assert.match(h, /data-l="son-natural-products"/);
  assert.doesNotMatch(h, /med-mixed/);
});

test("routeFallbackLessons: the module-fallback lesson (no per-item lessons) is re-pointed too", () => {
  const own = R.ownLessonIn(IX, "son-natural-products");
  const r = R.routeFallbackLessons([], { key: "med-mixed" }, own, {});
  assert.equal(r.lesson.key, "son-natural-products");
  const km = R.kmTargets({ links: [], okLessons: [], lesson: r.lesson, sid: "s", mid: "son-natural-products", mt: "Anthracyclines" });
  assert.equal(km.rowTargets[0].fb, true);
  assert.match(km.rowTargets[0].attrs, /data-l="son-natural-products"/);
});

test("routeFallbackLessons: an evidenced row already opening the own lesson absorbs the fallback", () => {
  const own = R.ownLessonIn(IX, "son-natural-products");
  const ev = { key: "son-natural-products", title: "Anthracyclines", c: 90, tier: "specific", step: "3" };
  const r = R.routeFallbackLessons([ev, MIXED], null, own, {});
  assert.deepEqual(r.lessons.map((l) => l.key), ["son-natural-products"]);
  assert.equal(r.lessons[0].step, "3");
});

test("routeFallbackLessons: a fallback already in the module, evidenced rows and pipeline lessons are kept", () => {
  const own = R.ownLessonIn(IX, "phm-cytotoxic");
  const fb = { key: "phm-cytotoxic-b", title: "Cytotoxic B", c: 75, tier: "topic", step: "", ev: 0 };
  assert.equal(R.routeFallbackLessons([fb], null, own, {}).lessons[0].key, "phm-cytotoxic-b");
  const spec = { key: "son-anthracycline-heart", title: "Anthracycline cardiotoxicity", c: 85, tier: "specific", step: "" };
  assert.deepEqual(R.routeFallbackLessons([spec, MIXED], null, own, {}).lessons.map((l) => l.key), ["son-anthracycline-heart", "phm-cytotoxic-a"]);
  const p = R.routeFallbackLessons([], { key: "son-anthracycline-heart" }, own, { "son-anthracycline-heart": 1 });
  assert.equal(p.lesson.key, "son-anthracycline-heart", "the item's own pipeline lesson is never re-pointed");
});

test("routeFallbackLessons: no own lesson keeps the fallback, subtitled with what it opens", () => {
  const r = R.routeFallbackLessons([MIXED], null, null, {});
  assert.equal(r.lessons[0].key, "med-mixed");
  const h = R.slotHtml({ links: [], lessons: r.lessons, sid: "s", mid: "m", mt: "Anthracyclines" });
  assert.match(h, /<small>Learn this module<\/small><b>Mixed practice: high-yield medicine review<\/b>/);
  const km = R.kmTargets({ links: [], okLessons: r.lessons, sid: "s", mid: "m", mt: "Anthracyclines" });
  assert.match(R.knowMoreHtml({ targets: km.rowTargets, allTargets: km.allTargets }), /<small>Mixed practice: high-yield medicine review<\/small>/);
});
