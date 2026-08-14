/* Phase 8 P1 unit tests: tall-man lettering (onco-tallman.js) uses ONLY the cited ISMP forms and
 * never fabricates one for an unmapped drug; plus the pure helpers behind the onco drug view and the
 * protocol reference library (onco-home.js) — supportive-care filtering over the REAL formulary and
 * the DRAFT lifecycle badge.
 * node --test test/onco-p1.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

global.window = global;
if (!global.document) {
  global.document = {
    addEventListener() {}, getElementById() { return null; },
    createElement() { return { classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } }; },
    head: { appendChild() {} }, body: { appendChild() {} }, querySelectorAll() { return []; }
  };
}

const TM = require(join(ROOT, "onco-tallman.js"));
require(join(ROOT, "calculators.js"));   // window.MEDCALC (so onco-home.js can require cleanly)
require(join(ROOT, "drugs.js"));         // window.MEDDRUGS (the real ward formulary)
const OH = require(join(ROOT, "onco-home.js"));

test("tall-man applies ONLY the cited ISMP forms, case-insensitively, exact whole name", () => {
  assert.equal(TM.apply("doxorubicin"), "DOXOrubicin");
  assert.equal(TM.apply("Doxorubicin"), "DOXOrubicin");
  assert.equal(TM.apply("DOXORUBICIN"), "DOXOrubicin");
  assert.equal(TM.apply("vincristine"), "vinCRIStine");
  assert.equal(TM.apply("vinblastine"), "vinBLAStine");
  assert.equal(TM.apply("cisplatin"), "CISplatin");
  assert.equal(TM.apply("carboplatin"), "CARBOplatin");
  assert.equal(TM.apply("daunorubicin"), "DAUNOrubicin");
  assert.equal(TM.apply("idarubicin"), "IDArubicin");
});

test("tall-man NEVER fabricates a form for an unmapped drug (returns it unchanged)", () => {
  ["aspirin", "paracetamol", "rituximab", "prednisolone", "", null, undefined].forEach((x) => {
    assert.equal(TM.apply(x), x);
  });
});

test("tall-man replaces the mapped token inside a longer name but leaves the rest intact", () => {
  assert.equal(TM.apply("Doxorubicin liposomal"), "DOXOrubicin liposomal");
});

test("the tall-man source list is small, cited to ISMP, and every entry is well-formed", () => {
  const keys = Object.keys(TM.MAP);
  assert.ok(keys.length <= 8, "keep the ISMP list small: " + keys.length);
  assert.match(TM.SOURCE, /ISMP/);
  keys.forEach((k) => {
    assert.ok(TM.MAP[k].tallman && Array.isArray(TM.MAP[k].confusedWith) && TM.MAP[k].confusedWith.length, k + " malformed");
  });
  assert.deepEqual(TM.confusedWith("cisplatin"), ["CARBOplatin"]);
});

test("onco drug view: supportive-care filter keeps oncology-relevant formulary drugs, drops the rest", () => {
  const list = [
    { generic: "Ondansetron", cls: "Antiemetic (5-HT3 antagonist)" },
    { generic: "Dexamethasone", cls: "Corticosteroid" },
    { generic: "Enoxaparin", cls: "Low-molecular-weight heparin (LMWH)" },
    { generic: "Warfarin", cls: "Vitamin K antagonist" },
    { generic: "Amlodipine", cls: "Calcium channel blocker" }
  ];
  const kept = OH._oncoSupportive(list).map((d) => d.generic);
  assert.ok(kept.includes("Ondansetron") && kept.includes("Dexamethasone") && kept.includes("Enoxaparin"));
  assert.ok(!kept.includes("Amlodipine") && !kept.includes("Warfarin"));
});

test("onco drug view: the filter runs over the REAL ward formulary and finds antiemetics/steroids (not a local copy)", () => {
  const real = (global.window.MEDDRUGS && global.window.MEDDRUGS._list) || [];
  const kept = OH._oncoSupportive(real).map((d) => d.generic);
  assert.ok(kept.includes("Ondansetron"), "expected Ondansetron from the real drugs.js formulary: " + JSON.stringify(kept));
  assert.ok(kept.length >= 3, "expected several supportive-care drugs from the real formulary");
});

test("protocol reference: DRAFT lifecycle renders the honest 'DRAFT - not activated' badge (no em dash)", () => {
  const draft = OH._protoBadge("draft");
  assert.match(draft, /DRAFT - not activated/);
  assert.ok(draft.indexOf("—") < 0 && draft.indexOf("–") < 0, "no em/en dash in app text");
  assert.match(OH._protoBadge("active"), /active/);
  assert.equal(OH._protoBadge(""), "");
});
