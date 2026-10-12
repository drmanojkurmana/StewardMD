// Nucleus360 concept-to-MCQ matching (prep-nucleus360.js): reuse first, force nothing.
// All items synthetic.
// node --test test/prep-nucleus360-match.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const N = require("../prep-nucleus360.js");

const OUTLINE = N.outlineOf({ id: "t1", title: "Pancreatic adenocarcinoma" });
const IT = (o) => ({ id: "i" + Math.random().toString(36).slice(2, 8), q: "Synthetic stem.", o: ["A", "B", "C", "D"], a: 0, exp: "", ...o });

test("an investigation question lands on Investigations", () => {
  const items = [IT({ id: "q1", q: "Synthetic: best initial imaging test for suspected pancreatic cancer?", exp: "Contrast CT is the investigation of choice." })];
  const m = N.matchConcepts(OUTLINE, items, "disease");
  assert.deepEqual(m.assign.inv, ["q1"]);
  assert.deepEqual(m.unassigned, []);
});

test("a management question lands on Management via options and explanation", () => {
  const items = [IT({ id: "q2", q: "Synthetic: resectable head mass. What next?", o: ["Whipple surgery", "Wait", "Herbs", "Nothing"], exp: "Surgical treatment with curative intent." })];
  const m = N.matchConcepts(OUTLINE, items, "disease");
  assert.deepEqual(m.assign.rx, ["q2"]);
});

test("ties go to the earlier concept; matching is deterministic", () => {
  const items = [IT({ id: "q3", q: "Synthetic diagnosis and staging workup question", exp: "How to diagnose and stage." })];
  const a = N.matchConcepts(OUTLINE, items, "disease");
  const b = N.matchConcepts(OUTLINE, JSON.parse(JSON.stringify(items)), "disease");
  assert.deepEqual(a, b);
  const placed = Object.keys(a.assign).filter((k) => a.assign[k].includes("q3"));
  assert.equal(placed.length, 1, "exactly one concept owns the item");
});

test("items matching no concept are listed, never forced", () => {
  const items = [IT({ id: "q9", q: "Zebra.", o: ["1", "2", "3", "4"], exp: "Quux." })];
  const m = N.matchConcepts(OUTLINE, items, "disease");
  assert.deepEqual(m.unassigned, ["q9"]);
  assert.ok(Object.values(m.assign).every((l) => !l.includes("q9")));
});

test("reasoning fields (lo, clues, mechanism) count as item text", () => {
  const items = [IT({ id: "q4", q: "Vignette.", x: { lo: "Recall the genetics: KRAS mutation drives pathogenesis." } })];
  const m = N.matchConcepts(OUTLINE, items, "disease");
  assert.deepEqual(m.assign.path, ["q4"]);
});

test("the stem outranks the explanation; function words never match", () => {
  const items = [IT({ id: "q5", q: "A patient with chronic diverticular disease has pneumaturia. Which complication is most likely?", o: ["Fistula", "Stricture", "Bleed", "Nothing"], exp: "In older adults the incidence rises with age; epidemiology and prevalence vary by sex and definition, and the diagnosis rests on imaging." })];
  const m = N.matchConcepts(OUTLINE, items, "disease");
  assert.deepEqual(m.assign.comp, ["q5"], "stem 'complication' beats epi-flavoured explanation; 'and' matches nothing");
});

test("Images needs a real image, not a mention", () => {
  const withImg = [IT({ id: "q6", q: "Which triangle is shown here?", img: "r2pic1", exp: "The image shows the gastrinoma triangle." })];
  assert.deepEqual(N.matchConcepts(OUTLINE, withImg, "disease").assign.img, ["q6"]);
  const noImg = [IT({ id: "q7", q: "Which triangle is shown here?", exp: "The image shows the gastrinoma triangle." })];
  const m = N.matchConcepts(OUTLINE, noImg, "disease");
  assert.ok(!m.assign.img.includes("q7"), "an imageless mention must not cover Images");
});

test("items without ids are skipped, empty bank matches nothing", () => {
  const m = N.matchConcepts(OUTLINE, [{ q: "no id" }], "disease");
  assert.deepEqual(m.unassigned, []);
  const e = N.matchConcepts(OUTLINE, [], "disease");
  assert.ok(Object.values(e.assign).every((l) => l.length === 0));
});
