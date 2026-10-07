// test/interaction-class-negation.test.mjs - "Non-opioid" is not an opioid.
// scripts/interactions/build_gold.py matched r"opioid" inside "Non-opioid analgesic", so paracetamol
// was classed opioid + cns_depressant and paracetamol + midazolam fired the MAJOR opioid +
// benzodiazepine rule. The same bug hit non-benzodiazepine, non-NSAID and insulin-secretagogue text.
// Owner-approved fix 2026-10-02 (curated_overrides.json _notes_2026_10_02). Real data, real engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(fs.readFileSync(join(ROOT, "interaction-rules.js"), "utf8"))();
new Function(fs.readFileSync(join(ROOT, "interactions.js"), "utf8"))();
// Both artifacts: the app's checker reads interaction-rules.js, WardSynq and the Worker read the JSON.
const SOURCES = { "interaction-rules.js": window.INTERACTION_RULES.drugClasses,
  "data/interaction-rules.json": JSON.parse(fs.readFileSync(join(ROOT, "data/interaction-rules.json"), "utf8")).drugClasses };
const BUCKETS = ["critical", "major", "moderate", "minor", "monitor", "duplicates", "combinations"];
const ids = (a, b) => {
  const r = window.INTERACTIONS.checkInteractions([{ generic: a }, { generic: b }]) || {};
  return BUCKETS.flatMap((k) => (Array.isArray(r[k]) ? r[k] : [])).map((x) => x.id || x.ruleId || JSON.stringify(x).slice(0, 60));
};
for (const [file, C] of Object.entries(SOURCES)) {
const has = (g, t) => (C[g] || []).includes(t);

test(file + ": non-opioids are not opioids; the non-sedating ones are not CNS depressants", () => {
  for (const g of ["paracetamol", "metamizole (dipyrone)", "levodropropizine", "prenoxdiazine (prenoxdiazine hydrochloride)"]) {
    assert.ok(!has(g, "opioid") && !has(g, "cns_depressant"), g);
  }
  // central and sedating, but not opioids (owner: keep cns_depressant)
  for (const g of ["nefopam", "flupirtine (as maleate)", "noscapine", "levocloperastine (levocloperastine fendizoate/hydrochloride)"]) {
    assert.ok(!has(g, "opioid") && has(g, "cns_depressant"), g);
  }
  assert.ok(!has("nefopam", "nsaid"), "nefopam is a non-NSAID");
  assert.ok(!has("naloxone", "opioid") && !has("naloxone", "cns_depressant"), "naloxone is an antagonist");
  for (const g of ["zopiclone", "eszopiclone", "zaleplon"]) assert.ok(!has(g, "benzodiazepine") && has(g, "cns_depressant"), g);
  assert.ok(!has("buspirone", "benzodiazepine") && !has("buspirone", "cns_depressant") && has("buspirone", "serotonergic"), "buspirone");
  for (const g of ["repaglinide", "nateglinide", "rosiglitazone (rosiglitazone maleate)", "lobeglitazone sulfate"]) {
    assert.ok(!has(g, "insulin") && has(g, "hypoglycemic"), g);
  }
  for (const g of ["morphine", "tramadol"]) assert.ok(has(g, "opioid") && has(g, "cns_depressant"), g + " is still an opioid");
});
}

test("the false alerts are gone", () => {
  assert.deepEqual(ids("paracetamol", "midazolam"), [], "paracetamol + midazolam");
  assert.deepEqual(ids("paracetamol", "morphine"), [], "paracetamol + morphine");
  assert.ok(!ids("nefopam", "warfarin").some((x) => /nsaid/i.test(x)), "nefopam + warfarin is not warfarin + NSAID");
  assert.ok(!ids("naloxone", "midazolam").some((x) => /opioid-benzo/i.test(x)), "naloxone + midazolam");
});

test("the true alerts survive (no false negative from removing a wrong tag)", () => {
  const major = (a, b) => { const r = window.INTERACTIONS.checkInteractions([{ generic: a }, { generic: b }]) || {}; return (r.major || []).map((x) => x.ruleId || x.id).sort(); };
  assert.deepEqual(major("morphine", "midazolam"), ["combo-opioid-benzodiazepine", "dup-cns-depressant"]);
  assert.deepEqual(major("zopiclone", "morphine"), ["dup-cns-depressant"], "Z-drug + opioid still stacks CNS depressants");
  assert.deepEqual(major("nefopam", "morphine"), ["dup-cns-depressant"], "nefopam is still a CNS depressant");
  assert.deepEqual(major("verapamil", "clarithromycin"), ["mech-cyp3a4strong-nondhp-ccb"]);
  // Known-wrong tag kept on purpose until a signed-off antagonist + agonist rule replaces it (curated_overrides.json):
  assert.deepEqual(major("naltrexone", "morphine"), ["dup-cns-depressant"]);
  // Buspirone lost its wrong benzodiazepine/CNS tags; it is pinned serotonergic so it is never alert-free (R1, owner).
  assert.deepEqual(major("buspirone", "tramadol"), ["combo-serotonin-syndrome", "dup-serotonergic"]);
  const crit = (a, b) => ((window.INTERACTIONS.checkInteractions([{ generic: a }, { generic: b }]) || {}).critical || []).map((x) => x.ruleId || x.id);
  assert.deepEqual(crit("buspirone", "linezolid"), ["pair-maoi-serotonergic"]);
});

test("WardSynq (reads the JSON): paracetamol + midazolam is not opioid + benzodiazepine; morphine + midazolam still is", async () => {
  const { loadStewardMDRulePack } = await import("../wardsynq/adapters/wardsynq-rules-stewardmd.js");
  const { SafetyEngine } = await import("../wardsynq/wardsynq-safety.js");
  const { MedicationOrder } = await import("../wardsynq/wardsynq-model.js");
  const engine = new SafetyEngine({ rulePack: await loadStewardMDRulePack() });
  const rules = (drug, other) => engine.evaluate({ order: MedicationOrder({ patientId: "p1", drug, prescriberId: "dr-1" }), activeMeds: [{ drug: other }] })
    .findings.filter((f) => /^INTERACTION/.test(f.code)).map((f) => f.ruleId || f.message);
  assert.deepEqual(rules("Paracetamol 650", "Midazolam 2mg"), []);
  assert.deepEqual(rules("Crocin 650", "Morphine 10mg"), []);
  assert.ok(rules("Morphine 10mg", "Midazolam 2mg").length > 0);
  assert.ok(rules("Zopiclone 7.5", "Morphine 10mg").length > 0, "Z-drug + opioid still alerts (CNS stacking)");
  assert.deepEqual(rules("Verapamil 80", "Clarithromycin 500mg"), ["mech-cyp3a4strong-nondhp-ccb"], "the non-DHP rule, not a DHP tag");
  assert.ok(rules("Buspirone 10mg", "Tramadol 50mg").length > 0, "buspirone + tramadol: serotonin syndrome");
});
