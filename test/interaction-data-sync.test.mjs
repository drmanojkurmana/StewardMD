// test/interaction-data-sync.test.mjs - one drug-interaction dataset, not three.
// August 2026's R1-reviewed DDI fixes were hand-edited into interaction-rules.js only. WardSynq and the
// Worker read data/interaction-rules.json and never got them (20 rules, ~29 classes), and
// scripts/interactions/curated/ never got them either, so a pipeline rebuild would have erased them
// from the app too. Resynced 2026-10-02. These checks fail the moment one copy is edited alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(join(ROOT, p), "utf8"));
globalThis.window = {};
new Function(fs.readFileSync(join(ROOT, "interaction-rules.js"), "utf8"))();
const APP = window.INTERACTION_RULES;
const JSON_TWIN = read("data/interaction-rules.json");
const CUR = "scripts/interactions/curated/";
const legacy = read(CUR + "legacy_rules.json"), mech = read(CUR + "mechanism_rules.json"), ov = read(CUR + "curated_overrides.json");
const curated = new Map([...legacy.rules, ...mech.rules].map((r) => [r.id, r]));
const norm = (s) => String(s || "").trim().toLowerCase();

test("data/interaction-rules.json is an exact twin of interaction-rules.js", () => {
  assert.deepEqual(JSON_TWIN, APP);
});

test("every shipped rule comes from curated/ (or is a build-generated class-duplication rule)", () => {
  // build_rules.py's auto duplicate rules come from the RxClass build cache, not curated/.
  const auto = (r) => r.type === "duplicate_class" && r.sourceId === "rxnorm-rxclass" && r.severity === "monitor" && !curated.has(r.id);
  for (const r of APP.rules) {
    if (auto(r)) continue;
    assert.ok(curated.has(r.id), `${r.id} is shipped but not in curated/ - a rebuild would erase it`);
    assert.deepEqual(r, curated.get(r.id), `${r.id} differs between the shipped data and curated/`);
  }
  const shipped = new Set(APP.rules.map((r) => r.id));
  for (const id of ["pair-allopurinol-azathioprine", "pair-digoxin-amiodarone", "pair-digoxin-verapamil", "pair-warfarin-aspirin"]) {
    assert.ok(!shipped.has(id) && !curated.has(id), `${id} was superseded by a class rule (retired 2026-10-02)`);
  }
});

test("every curated class pin and deny is in the shipped data", () => {
  const C = APP.drugClasses;
  for (const [g, tags] of Object.entries(ov.pin_classes)) {
    for (const t of tags) assert.ok((C[norm(g)] || []).includes(t), `pin ${g}: ${t}`);
  }
  for (const [g, tags] of Object.entries(ov.deny_classes)) {
    for (const t of tags) assert.ok(!(C[norm(g)] || []).includes(t), `deny ${g}: ${t}`);
  }
});

test("the same drug under a salt name is classed the same way (sarecycline is not a P-gp inhibitor)", () => {
  assert.ok(!(APP.drugClasses["sarecycline"] || []).includes("pgp_inhibitor"));
  assert.ok(!(APP.drugClasses["sarecycline hydrochloride"] || []).includes("pgp_inhibitor"));
});

test("new major / contraindicated curated rules are in the sign-off manifest", () => {
  // As validate.py gates it: shipped rules only (build_rules.py collapses a mechanism rule into a
  // grandfathered legacy rule with the same subjects, e.g. mech-betablocker-nondhp-ccb).
  const signed = new Set(read(CUR + "signoff.json").signed.map((s) => s.id));
  const shipped = new Set(APP.rules.map((r) => r.id));
  for (const r of mech.rules) {
    if (shipped.has(r.id) && ["major", "contraindicated"].includes(r.severity)) assert.ok(signed.has(r.id), `${r.id} has no sign-off entry`);
  }
});
