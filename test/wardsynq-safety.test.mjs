/* test/wardsynq-safety.test.mjs — WardSynQ deterministic clinical safety engine.
 *
 * The engine is a safety control, so these tests are written as the verification column of the
 * hazard table rather than as coverage: each one names the thing that must not happen. The two that
 * matter most are that an absolute block cannot be cleared by any override a caller supplies, and
 * that a weight-based drug on an unweighed patient refuses rather than passes.
 *
 * node --test test/wardsynq-safety.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEVERITY, DISPOSITION, SafetyEngine, SafetyEngineError,
  compileRulePack, emptyRulePack, defaultDisposition,
  checkAllergies, checkInteractions, checkDose, checkRenal,
  resolveGeneric, renalBand, isSevereReaction,
} from "../wardsynq/wardsynq-safety.js";
import { loadStewardMDRulePack } from "../wardsynq/adapters/wardsynq-rules-stewardmd.js";
import { Patient, MedicationOrder, AllergyIntolerance } from "../wardsynq/wardsynq-model.js";
import { MedicationAdministrationRecord, STATES } from "../wardsynq/wardsynq-meds.js";

/* ------------------------------------------------------------------ fixtures */

const TEST_PACK = compileRulePack({
  version: "test-1",
  drugClasses: {
    simvastatin: ["statin", "cyp3a4_substrate"],
    clarithromycin: ["macrolide", "cyp3a4_strong_inhibitor"],
    amoxicillin: ["penicillin_class"],
    cefalexin: ["cephalosporin_class"],
    warfarin: ["anticoagulant"],
    aspirin: ["antiplatelet", "nsaid"],
    ibuprofen: ["nsaid"],
    paracetamol: ["analgesic"],
    gentamicin: ["aminoglycoside"],
  },
  interactions: [
    {
      id: "xr-statin-cyp3a4", type: "pair", severity: "contraindicated",
      subjects: [{ kind: "class", value: "cyp3a4_strong_inhibitor" }, { kind: "generic", value: "simvastatin" }],
      effect: "High risk of rhabdomyolysis.", action: "Do not co-administer.",
    },
    {
      id: "xr-warfarin-nsaid", type: "pair", severity: "major",
      subjects: [{ kind: "generic", value: "warfarin" }, { kind: "class", value: "nsaid" }],
      effect: "Increased bleeding risk.",
    },
    {
      id: "xr-bleeding-triad", type: "combination", severity: "contraindicated",
      subjects: [{ kind: "class", value: "anticoagulant" }, { kind: "class", value: "antiplatelet" }, { kind: "class", value: "nsaid" }],
      effect: "Triple therapy bleeding risk.",
    },
    {
      id: "xr-minor-note", type: "pair", severity: "monitor",
      subjects: [{ kind: "generic", value: "paracetamol" }, { kind: "generic", value: "warfarin" }],
      effect: "May potentiate INR with sustained use.",
    },
  ],
  allergyClasses: {
    penicillins: ["amoxicillin", "penicillin", "ampicillin"],
    cephalosporins: ["cefalexin", "ceftriaxone"],
  },
  crossReactivity: [
    { id: "xr-pen-ceph", groups: ["penicillins", "cephalosporins"], likelihood: "low", note: "Side-chain dependent." },
  ],
  doseLimits: {
    paracetamol: { maxSingle: { value: 1000, unit: "mg" }, absoluteCeilingSingle: { value: 1000, unit: "mg" }, mgPerKgSingle: 15 },
    gentamicin: { mgPerKgSingle: 7 },
    ibuprofen: { maxSingle: { value: 400, unit: "mg" }, absoluteCeilingSingle: { value: 800, unit: "mg" } },
  },
  renalAdjustments: {
    gentamicin: { moderate: { dose: "extend interval to 36 h" }, severe: { dose: "extend interval to 48 h" } },
  },
});

const patient = (over) => Patient({ mrn: "MRN-1", name: "Test Patient", dob: "1980-01-01", wristbandBarcode: "WB-1", ...over });
const order = (over) => MedicationOrder({ patientId: "p1", drug: "Simvastatin 40mg tablet", prescriberId: "dr-1", ...over });
const allergy = (over) => AllergyIntolerance({ patientId: "p1", substance: "Penicillin", ...over });

const engine = new SafetyEngine({ rulePack: TEST_PACK });

/* ------------------------------------------------------------------ pack compilation */

test("pack: compiling requires an object and an engine requires a pack", () => {
  assert.throws(() => compileRulePack(null), SafetyEngineError);
  assert.throws(() => new SafetyEngine({}), /requires a compiled rulePack/);
  const empty = emptyRulePack();
  assert.equal(empty.interactions.length, 0);
  assert.equal(new SafetyEngine({ rulePack: empty }).evaluate({ order: order() }).allowed, true,
    "an empty pack finds nothing; it does not fail closed, because a pack-less engine is a deployment error caught elsewhere");
});

test("pack: severity maps to disposition by policy, contraindicated is always a block", () => {
  assert.equal(defaultDisposition(SEVERITY.CONTRAINDICATED), DISPOSITION.BLOCK);
  assert.equal(defaultDisposition(SEVERITY.MAJOR), DISPOSITION.OVERRIDABLE);
  assert.equal(defaultDisposition(SEVERITY.MODERATE), DISPOSITION.WARN);
  assert.equal(defaultDisposition(SEVERITY.MONITOR), DISPOSITION.WARN);
});

test("pack: a rule may state its own disposition, overriding the severity default", () => {
  const pack = compileRulePack({
    drugClasses: { a: ["x"], b: ["y"] },
    interactions: [{ id: "r", subjects: [{ kind: "generic", value: "a" }, { kind: "generic", value: "b" }], severity: "major", disposition: "block" }],
  });
  const f = checkInteractions(pack, { drug: "a" }, [{ drug: "b" }]);
  assert.equal(f[0].disposition, DISPOSITION.BLOCK, "a site may tighten policy through the pack without editing the engine");
});

/* ------------------------------------------------------------------ drug resolution */

test("resolve: a drug name resolves to its pack key, conservatively", () => {
  assert.equal(resolveGeneric("Simvastatin 40mg tablet", TEST_PACK.genericIndex), "simvastatin");
  assert.equal(resolveGeneric("SIMVASTATIN", TEST_PACK.genericIndex), "simvastatin");
  assert.equal(resolveGeneric("Rosuvastatin 10mg", TEST_PACK.genericIndex), null,
    "a drug not in the pack must not be silently matched to a similar one");
  assert.equal(resolveGeneric("", TEST_PACK.genericIndex), null);
});

test("resolve: an unrecognised drug is reported rather than treated as safe", () => {
  const v = engine.evaluate({ order: order({ drug: "Notarealdrug 10mg" }) });
  assert.equal(v.unresolvedDrug, true, "the caller must be able to tell 'no findings' from 'not checked'");
  assert.equal(v.allowed, true, "whether an unknown drug should stop an order is site policy, not an engine decision");
});

/* ------------------------------------------------------------------ allergy shield (HAZ-MED-02) */

test("allergy: a verified severe direct match is an absolute block", () => {
  const f = checkAllergies(TEST_PACK, { drug: "Amoxicillin 500mg" }, [
    allergy({ substance: "Amoxicillin", reaction: "anaphylaxis", severity: "severe", verifiedBy: "dr-2" }),
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, "ALLERGY_DIRECT");
  assert.equal(f[0].disposition, DISPOSITION.BLOCK);
});

test("allergy: an unverified severe reaction is overridable, not an absolute block", () => {
  const f = checkAllergies(TEST_PACK, { drug: "Amoxicillin 500mg" }, [
    allergy({ substance: "Amoxicillin", reaction: "anaphylaxis", severity: "severe" }), // no verifiedBy
  ]);
  assert.equal(f[0].disposition, DISPOSITION.OVERRIDABLE,
    "an unconfirmed report must not be able to hard-stop care; confirming it is what makes it absolute");
});

test("allergy: a class-level allergy catches a member drug", () => {
  const f = checkAllergies(TEST_PACK, { drug: "Amoxicillin 500mg" }, [
    allergy({ substance: "Penicillins", reaction: "anaphylaxis", verifiedBy: "dr-2" }),
  ]);
  assert.equal(f[0].code, "ALLERGY_CLASS");
  assert.equal(f[0].disposition, DISPOSITION.BLOCK);
  assert.ok(f[0].classes.includes("penicillins"));
});

test("allergy: cross-reactivity fires across classes and is weaker evidence than a direct match", () => {
  const f = checkAllergies(TEST_PACK, { drug: "Cefalexin 500mg" }, [
    allergy({ substance: "Amoxicillin", reaction: "rash", severity: "mild" }),
  ]);
  assert.equal(f[0].code, "ALLERGY_CROSS_REACTIVITY");
  assert.equal(f[0].disposition, DISPOSITION.OVERRIDABLE,
    "over-blocking on presumed cross-reactivity drives harmful antibiotic substitution");
  assert.match(f[0].message, /cross-reactivity \(low\)/);
});

test("allergy: an unrelated allergy produces nothing", () => {
  assert.deepEqual(checkAllergies(TEST_PACK, { drug: "Simvastatin 40mg" }, [allergy({ substance: "Peanut" })]), []);
});

test("allergy: severity is recognised from reaction text, severity or criticality", () => {
  assert.equal(isSevereReaction({ reaction: "Anaphylaxis" }), true);
  assert.equal(isSevereReaction({ reaction: "Stevens-Johnson syndrome" }), true);
  assert.equal(isSevereReaction({ severity: "severe" }), true);
  assert.equal(isSevereReaction({ criticality: "high" }), true);
  assert.equal(isSevereReaction({ reaction: "mild rash", severity: "mild" }), false);
});

/* ------------------------------------------------------------------ interactions (HAZ-MED-01) */

test("interaction: a contraindicated class-to-generic pair blocks", () => {
  const f = checkInteractions(TEST_PACK, order({ drug: "Simvastatin 40mg" }), [{ drug: "Clarithromycin 500mg" }]);
  assert.equal(f.length, 1);
  assert.equal(f[0].disposition, DISPOSITION.BLOCK);
  assert.equal(f[0].ruleId, "xr-statin-cyp3a4");
  assert.deepEqual(f[0].drugs.sort(), ["Clarithromycin 500mg", "Simvastatin 40mg"]);
});

test("interaction: a major interaction is overridable, not blocked", () => {
  const f = checkInteractions(TEST_PACK, order({ drug: "Ibuprofen 400mg" }), [{ drug: "Warfarin 5mg" }]);
  assert.equal(f[0].disposition, DISPOSITION.OVERRIDABLE);
  assert.equal(f[0].severity, SEVERITY.MAJOR);
});

test("interaction: a three-subject combination rule fires only when all three are present", () => {
  const two = checkInteractions(TEST_PACK, order({ drug: "Aspirin 75mg" }), [{ drug: "Warfarin 5mg" }]);
  assert.equal(two.some((f) => f.ruleId === "xr-bleeding-triad"), false, "two of three must not fire the triad");

  const three = checkInteractions(TEST_PACK, order({ drug: "Ibuprofen 400mg" }), [{ drug: "Warfarin 5mg" }, { drug: "Aspirin 75mg" }]);
  assert.equal(three.some((f) => f.ruleId === "xr-bleeding-triad"), true);
});

test("interaction: one drug cannot satisfy two subjects of the same rule", () => {
  // Aspirin is both antiplatelet and nsaid. Alone with warfarin it must not complete the triad.
  const f = checkInteractions(TEST_PACK, order({ drug: "Warfarin 5mg" }), [{ drug: "Aspirin 75mg" }]);
  assert.equal(f.some((x) => x.ruleId === "xr-bleeding-triad"), false,
    "a rule needs three distinct drugs, not one drug wearing three class tags");
});

test("interaction: a pre-existing interaction between other drugs does not block a new order", () => {
  const f = checkInteractions(TEST_PACK, order({ drug: "Paracetamol 500mg" }), [{ drug: "Simvastatin 40mg" }, { drug: "Clarithromycin 500mg" }]);
  assert.equal(f.some((x) => x.ruleId === "xr-statin-cyp3a4"), false,
    "the statin interaction is real but is not caused by ordering paracetamol; blocking here would be alert fatigue");
});

test("interaction: a monitor-level finding is a warning only", () => {
  const f = checkInteractions(TEST_PACK, order({ drug: "Paracetamol 500mg" }), [{ drug: "Warfarin 5mg" }]);
  assert.equal(f[0].disposition, DISPOSITION.WARN);
});

/* ------------------------------------------------------------------ dose ceilings (HAZ-MED-03) */

test("dose: exceeding the absolute ceiling is an absolute block", () => {
  const f = checkDose(TEST_PACK, order({ drug: "Ibuprofen", dose: { value: 1200, unit: "mg" } }), { weightKg: 70 });
  assert.equal(f[0].code, "DOSE_ABSOLUTE_CEILING");
  assert.equal(f[0].disposition, DISPOSITION.BLOCK);
});

test("dose: exceeding the recommended maximum is overridable", () => {
  const f = checkDose(TEST_PACK, order({ drug: "Ibuprofen", dose: { value: 600, unit: "mg" } }), { weightKg: 70 });
  assert.equal(f[0].code, "DOSE_ABOVE_MAX_SINGLE");
  assert.equal(f[0].disposition, DISPOSITION.OVERRIDABLE);
});

test("dose: a weight-based drug with no recorded weight refuses rather than passes", () => {
  const f = checkDose(TEST_PACK, order({ drug: "Gentamicin", dose: { value: 400, unit: "mg" } }), {});
  assert.equal(f[0].code, "DOSE_WEIGHT_MISSING");
  assert.equal(f[0].disposition, DISPOSITION.BLOCK,
    "an unweighed patient on a weight-dosed drug is the hazard, so silence here would be the failure");
});

test("dose: a paediatric mg/kg dose is capped at the adult maximum", () => {
  // 60 kg adolescent, paracetamol at 15 mg/kg would be 900 mg, under the 1 g adult cap: allowed.
  const ok = checkDose(TEST_PACK, order({ drug: "Paracetamol", dose: { value: 900, unit: "mg" } }), { weightKg: 60 });
  assert.equal(ok.length, 0);

  // 90 kg adolescent: 15 mg/kg is 1350 mg, but the adult ceiling of 1 g still applies.
  const capped = checkDose(TEST_PACK, order({ drug: "Paracetamol", dose: { value: 1200, unit: "mg" } }), { weightKg: 90 });
  assert.equal(capped.some((f) => f.disposition === DISPOSITION.BLOCK), true,
    "mg/kg alone lets a heavy child exceed an adult dose; that is the classic paediatric overdose");
});

test("dose: a missing or non-numeric dose is reported, not skipped", () => {
  const f = checkDose(TEST_PACK, order({ drug: "Paracetamol", dose: null }), { weightKg: 70 });
  assert.equal(f[0].code, "DOSE_UNPARSEABLE");
});

test("dose: a unit mismatch does not silently compare numbers", () => {
  // 900 mcg of ibuprofen is far below the mg ceiling; comparing 900 > 800 would be a false block.
  const f = checkDose(TEST_PACK, order({ drug: "Ibuprofen", dose: { value: 900, unit: "mcg" } }), { weightKg: 70 });
  assert.equal(f.length, 0, "ceilings only compare like units");
});

/* ------------------------------------------------------------------ renal */

test("renal: bands are derived from eGFR", () => {
  assert.equal(renalBand(95), "normal");
  assert.equal(renalBand(70), "mild");
  assert.equal(renalBand(45), "moderate");
  assert.equal(renalBand(20), "severe");
  assert.equal(renalBand(8), "esrd");
  assert.equal(renalBand(undefined), null);
});

test("renal: an adjustment recommendation is always overridable, never a block", () => {
  const f = checkRenal(TEST_PACK, order({ drug: "Gentamicin" }), { egfr: 40 });
  assert.equal(f[0].code, "RENAL_ADJUSTMENT_RECOMMENDED");
  assert.equal(f[0].disposition, DISPOSITION.OVERRIDABLE,
    "the safety case lists renal dose reduction as an explicit Category 2 example; making it a block would contradict it");
  assert.equal(checkRenal(TEST_PACK, order({ drug: "Gentamicin" }), { egfr: 110 }).length, 0);
});

/* ------------------------------------------------------------------ the override boundary */

test("override: a valid override clears an overridable finding and leaves an audit trace", () => {
  const ctx = { order: order({ drug: "Ibuprofen 400mg", dose: { value: 400, unit: "mg" } }), patient: patient(), weightKg: 70, activeMeds: [{ drug: "Warfarin 5mg" }] };
  const before = engine.evaluate(ctx);
  assert.equal(before.allowed, false);
  assert.equal(before.overridables.length, 1);

  const after = engine.evaluate({
    ...ctx,
    overrides: [{ code: "INTERACTION_MAJOR", reasonCode: "CLINICALLY_INDICATED", rationale: "Short course, INR monitored", actorId: "dr-1" }],
  });
  assert.equal(after.allowed, true);
  assert.equal(after.overridables.length, 0);
  assert.equal(after.warnings.some((w) => w.overridden === true), true,
    "an overridden finding is downgraded, never deleted; the committee has to be able to see it happened");
});

test("override: an incomplete handshake does not clear anything", () => {
  const ctx = { order: order({ drug: "Ibuprofen 400mg", dose: { value: 400, unit: "mg" } }), patient: patient(), weightKg: 70, activeMeds: [{ drug: "Warfarin 5mg" }] };
  for (const bad of [
    { code: "INTERACTION_MAJOR", rationale: "x", actorId: "dr-1" }, // no reason code
    { code: "INTERACTION_MAJOR", reasonCode: "R", actorId: "dr-1" }, // no rationale
    { code: "INTERACTION_MAJOR", reasonCode: "R", rationale: "x" }, // no authenticated actor
  ]) {
    assert.equal(engine.evaluate({ ...ctx, overrides: [bad] }).allowed, false,
      "all four elements of the handshake are required, not any one of them");
  }
});

test("override: NO override can clear an absolute block", () => {
  const ctx = {
    order: order({ drug: "Simvastatin 40mg" }),
    patient: patient(), weightKg: 70,
    activeMeds: [{ drug: "Clarithromycin 500mg" }],
  };
  const attempts = [
    { code: "INTERACTION_CONTRAINDICATED", reasonCode: "R", rationale: "consultant approved", actorId: "dr-1", witnessId: "dr-2" },
    { code: "INTERACTION_CONTRAINDICATED", reasonCode: "R", rationale: "x", actorId: "dr-1", targetId: "xr-statin-cyp3a4" },
    { code: "ALLERGY_DIRECT", reasonCode: "R", rationale: "x", actorId: "dr-1" },
  ];
  for (const o of attempts) {
    const v = engine.evaluate({ ...ctx, overrides: [o] });
    assert.equal(v.allowed, false, "a Category 1 hard-stop has no override path by construction");
    assert.equal(v.blocks.length, 1);
  }
});

test("override: clearing one finding does not clear a different one", () => {
  const ctx = {
    order: order({ drug: "Ibuprofen", dose: { value: 600, unit: "mg" } }),
    patient: patient(), weightKg: 70,
    activeMeds: [{ drug: "Warfarin 5mg" }],
  };
  const v = engine.evaluate({ ...ctx, overrides: [{ code: "INTERACTION_MAJOR", reasonCode: "R", rationale: "x", actorId: "dr-1" }] });
  assert.equal(v.allowed, false, "the dose finding is untouched by an interaction override");
  assert.deepEqual(v.overridables.map((f) => f.code), ["DOSE_ABOVE_MAX_SINGLE"]);
});

/* ------------------------------------------------------------------ engine surface */

test("engine: evaluate requires an order", () => {
  assert.throws(() => engine.evaluate({}), /requires an order/);
  assert.throws(() => engine.evaluate({ order: { patientId: "p1" } }), /requires an order/);
});

test("engine: checks can be scoped to a subset", () => {
  const allergyOnly = new SafetyEngine({ rulePack: TEST_PACK, checks: ["allergy"] });
  const v = allergyOnly.evaluate({
    order: order({ drug: "Simvastatin 40mg" }),
    activeMeds: [{ drug: "Clarithromycin 500mg" }],
  });
  assert.equal(v.allowed, true, "order-entry screens may run only the checks they can act on");
});

test("engine: verdicts are deterministic and carry the pack version", () => {
  const ctx = { order: order({ drug: "Simvastatin 40mg" }), activeMeds: [{ drug: "Clarithromycin 500mg" }] };
  const a = engine.evaluate(ctx);
  const b = engine.evaluate(ctx);
  assert.deepEqual(a.findings, b.findings, "a control you cannot re-run identically is not a control");
  assert.equal(a.rulePackVersion, "test-1");
});

/* ------------------------------------------------------------------ eMAR integration */

test("emar: the engine hook actually gates a dose end to end", async () => {
  const p = patient();
  const o = MedicationOrder({
    patientId: p.id, drug: "Simvastatin 40mg tablet", drugBarcode: "DB-SIMVA",
    dose: { value: 40, unit: "mg" }, route: "oral", prescriberId: "dr-1",
  });
  const scan = { patientBarcode: "WB-1", drugBarcode: "DB-SIMVA", dose: { value: 40, unit: "mg" }, route: "oral" };

  const emar = new MedicationAdministrationRecord({
    safetyCheck: engine.hook((ctx) => ({ ...ctx, activeMeds: [{ drug: "Clarithromycin 500mg" }] })),
  });
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");

  await assert.rejects(
    () => emar.scan(rec, { order: o, patient: p, scan, nurseId: "nurse-1" }),
    (err) => {
      assert.equal(err.reasons[0].code, "INTERACTION_CONTRAINDICATED");
      return true;
    },
    "the engine and the eMAR must actually be wired together, not merely compatible on paper",
  );
  assert.equal(rec.status, STATES.DISPENSED, "a blocked dose stays where it was");
});

test("emar: an outstanding overridable stops the dose at the bedside", async () => {
  const p = patient();
  const o = MedicationOrder({
    patientId: p.id, drug: "Ibuprofen 400mg tablet", drugBarcode: "DB-IBU",
    dose: { value: 400, unit: "mg" }, route: "oral", prescriberId: "dr-1",
  });
  const scan = { patientBarcode: "WB-1", drugBarcode: "DB-IBU", dose: { value: 400, unit: "mg" }, route: "oral" };
  const emar = new MedicationAdministrationRecord({
    safetyCheck: engine.hook((ctx) => ({ ...ctx, activeMeds: [{ drug: "Warfarin 5mg" }] })),
  });
  const rec = emar.open(o);
  await emar.verify(rec, "pharm-1");
  await emar.dispense(rec, "pharm-1");
  await assert.rejects(
    () => emar.scan(rec, { order: o, patient: p, scan, nurseId: "nurse-1" }),
    (err) => {
      assert.equal(err.reasons[0].requiresOverride, true,
        "the handshake belongs at order entry; an un-actioned override must not be waved through at the bedside");
      return true;
    },
  );
});

/* ------------------------------------------------------------------ real StewardMD data */

test("integration: the StewardMD pack loads and finds its own contraindicated pairs", async () => {
  const pack = await loadStewardMDRulePack();
  assert.ok(pack.interactions.length > 250, `expected the full ruleset, got ${pack.interactions.length}`);
  assert.ok(pack.drugClasses.size > 2000, `expected the full class map, got ${pack.drugClasses.size}`);
  assert.match(pack.version, /^stewardmd-/);

  const real = new SafetyEngine({ rulePack: pack });

  // The spec's own worked example: simvastatin plus high-dose clarithromycin.
  const v = real.evaluate({
    order: MedicationOrder({ patientId: "p1", drug: "Simvastatin 40mg", prescriberId: "dr-1" }),
    activeMeds: [{ drug: "Clarithromycin 500mg" }],
  });
  assert.equal(v.allowed, false, "the hazard table's headline example must actually be caught");
  assert.equal(v.blocks.length > 0, true);
  assert.equal(v.blocks[0].severity, SEVERITY.CONTRAINDICATED);
});

test("integration: the seeded allergy shield works against real drug names", async () => {
  const pack = await loadStewardMDRulePack();
  const real = new SafetyEngine({ rulePack: pack });
  const v = real.evaluate({
    order: MedicationOrder({ patientId: "p1", drug: "Amoxicillin 500mg capsule", prescriberId: "dr-1" }),
    allergies: [AllergyIntolerance({ patientId: "p1", substance: "Penicillins", reaction: "anaphylaxis", criticality: "high", verifiedBy: "dr-2" })],
  });
  assert.equal(v.allowed, false);
  assert.equal(v.blocks[0].code, "ALLERGY_CLASS");
});

test("integration: a full evaluation against real data meets the 10 ms p95 budget", async () => {
  const pack = await loadStewardMDRulePack();
  const real = new SafetyEngine({ rulePack: pack });
  // The spec benchmarks deterministic safety execution with 100 concurrent drugs.
  const activeMeds = ["warfarin", "aspirin", "ibuprofen", "clarithromycin", "amoxicillin", "digoxin", "furosemide", "metformin", "atorvastatin", "omeprazole"]
    .flatMap((d) => Array.from({ length: 10 }, (_, i) => ({ drug: `${d} ${i + 1}mg` })));
  assert.equal(activeMeds.length, 100);

  const ctx = {
    order: MedicationOrder({ patientId: "p1", drug: "Simvastatin 40mg", prescriberId: "dr-1", dose: { value: 40, unit: "mg" } }),
    patient: Patient({ mrn: "M", name: "N", dob: "1980-01-01", weightKg: 70, egfr: 55 }),
    allergies: [AllergyIntolerance({ patientId: "p1", substance: "Penicillins", reaction: "rash" })],
    activeMeds,
  };

  real.evaluate(ctx); // warm
  const samples = Array.from({ length: 50 }, () => real.evaluate(ctx).elapsedMs).sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  assert.ok(p95 < 10, `p95 was ${p95.toFixed(2)} ms against a 10 ms budget with 100 concurrent drugs`);
});


/* ------------------------------------------------------------------ alert fatigue
 *
 * Found by running the workstation against the real pack rather than by a unit test: ordering
 * amoxicillin for a patient on clarithromycin produced SIX identical duplicate-therapy advisories,
 * one per shared class tag, including tags that mean nothing at the bedside ("Chemical Structure",
 * "Established Pharmacologic Classes"). Six alerts for one clinical fact is how alert fatigue is
 * manufactured, and a clinician who learns to dismiss that panel dismisses the hard-stop above it
 * too. That makes this a safety behaviour, not a tidiness one.
 */

test("alert fatigue: one clinical fact about the same drugs produces one finding", () => {
  const pack = compileRulePack({
    drugClasses: {
      amoxicillin: ["anti_infective", "antibacterial", "antimicrobial", "penicillin_class"],
      clarithromycin: ["anti_infective", "antibacterial", "antimicrobial", "macrolide"],
    },
    // Real data carries one duplicate-class rule per class tag, so several fire at once for the
    // same pair of drugs.
    interactions: ["anti_infective", "antibacterial", "antimicrobial"].map((cls) => ({
      id: `dup-${cls}`,
      type: "duplicate_class",
      severity: "monitor",
      subjects: [{ kind: "class", value: cls }, { kind: "class", value: cls }],
      effect: "Possible therapeutic duplication.",
      mechanism: `Two or more medicines from the same class (${cls}).`,
    })),
  });

  const f = checkInteractions(pack, { drug: "amoxicillin" }, [{ drug: "clarithromycin" }]);
  assert.equal(f.length, 1, "three rules about one duplication between two drugs is one finding to read");
  assert.equal(f[0].mergedCount, 3, "the collapse is reported, not hidden");
  assert.deepEqual(f[0].mergedRuleIds.sort(), ["dup-anti_infective", "dup-antibacterial", "dup-antimicrobial"],
    "every contributing rule id survives for the audit, so nothing is lost from the record");
});

test("alert fatigue: findings of different severity are never collapsed together", () => {
  const pack = compileRulePack({
    drugClasses: { a: ["x"], b: ["x"] },
    interactions: [
      { id: "r-monitor", type: "pair", severity: "monitor", subjects: [{ kind: "generic", value: "a" }, { kind: "generic", value: "b" }], effect: "Minor." },
      { id: "r-major", type: "pair", severity: "major", subjects: [{ kind: "generic", value: "a" }, { kind: "generic", value: "b" }], effect: "Serious bleeding risk." },
    ],
  });
  const f = checkInteractions(pack, { drug: "a" }, [{ drug: "b" }]);
  assert.equal(f.length, 2, "a major finding must never be absorbed into a monitor-level one");
  assert.equal(f.some((x) => x.severity === SEVERITY.MAJOR && x.disposition === DISPOSITION.OVERRIDABLE), true);
});

test("alert fatigue: findings about different drugs stay separate", () => {
  const pack = compileRulePack({
    drugClasses: { a: ["x"], b: ["x"], c: ["x"] },
    interactions: [{
      id: "dup-x", type: "duplicate_class", severity: "monitor",
      subjects: [{ kind: "class", value: "x" }, { kind: "class", value: "x" }],
      effect: "Duplication.",
    }],
  });
  const f = checkInteractions(pack, { drug: "a" }, [{ drug: "b" }, { drug: "c" }]);
  assert.equal(f.length >= 1, true);
  for (const finding of f) {
    assert.equal(finding.drugs.includes("a"), true, "every reported duplication involves the drug being ordered");
  }
});


/* ------------------------------------------------------------------ duplicate-therapy semantics
 *
 * A duplicate-therapy rule names ONE class and means "two or more drugs in this class". It looks
 * structurally identical to a single-subject pair rule, and read literally by a generic matcher it
 * fires on a SINGLE drug. All 270 such rules in the StewardMD pack are single-subject, so before
 * this was fixed, ordering warfarin for a patient on nothing else raised a major "two systemic
 * anticoagulants" alert and demanded an override handshake for a duplication that did not exist.
 * Found by driving the workstation against real data, not by a unit test.
 */

const DUP_PACK = compileRulePack({
  drugClasses: {
    warfarin: ["anticoagulant"],
    apixaban: ["anticoagulant"],
    paracetamol: ["analgesic"],
  },
  interactions: [{
    id: "dup-anticoagulant",
    type: "duplicate_class",
    subjects: [{ kind: "class", value: "anticoagulant" }], // ONE subject, meaning "two or more"
    severity: "major",
    effect: "Substantially increased bleeding risk.",
    mechanism: "Two systemic anticoagulants produce additive impairment of coagulation.",
  }],
});

test("duplication: a single drug in the class is NOT a duplication", () => {
  const f = checkInteractions(DUP_PACK, { drug: "warfarin" }, []);
  assert.deepEqual(f, [],
    "one anticoagulant is not two; alerting here would demand an override on ordinary orders and teach clinicians to click through");

  const withUnrelated = checkInteractions(DUP_PACK, { drug: "warfarin" }, [{ drug: "paracetamol" }]);
  assert.deepEqual(withUnrelated, [], "an unrelated co-medication does not make a duplication either");
});

test("duplication: two drugs in the class DO fire, and the finding names both", () => {
  const f = checkInteractions(DUP_PACK, { drug: "warfarin" }, [{ drug: "apixaban" }]);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, SEVERITY.MAJOR);
  assert.equal(f[0].disposition, DISPOSITION.OVERRIDABLE);
  assert.deepEqual(f[0].drugs.slice().sort(), ["apixaban", "warfarin"],
    "the clinician needs to see WHICH drugs overlap, not just that something did");
});

test("duplication: three drugs in the class are reported as one finding naming all three", () => {
  const pack = compileRulePack({
    drugClasses: { a: ["x"], b: ["x"], c: ["x"] },
    interactions: [{ id: "dup-x", type: "duplicate_class", subjects: [{ kind: "class", value: "x" }], severity: "moderate", effect: "Duplication." }],
  });
  const f = checkInteractions(pack, { drug: "a" }, [{ drug: "b" }, { drug: "c" }]);
  assert.equal(f.length, 1, "one overlap is one finding, however many drugs are in it");
  assert.deepEqual(f[0].drugs.slice().sort(), ["a", "b", "c"]);
});

test("duplication: a duplication among drugs the patient is already on does not gate a new order", () => {
  const f = checkInteractions(DUP_PACK, { drug: "paracetamol" }, [{ drug: "warfarin" }, { drug: "apixaban" }]);
  assert.deepEqual(f, [],
    "the anticoagulant overlap is real but is not caused by ordering paracetamol; blocking here is alert fatigue");
});

test("duplication: the real StewardMD pack does not alert on a lone anticoagulant", async () => {
  const pack = await loadStewardMDRulePack();
  const real = new SafetyEngine({ rulePack: pack });
  const alone = real.evaluate({ order: MedicationOrder({ patientId: "p1", drug: "Warfarin 3mg", prescriberId: "dr-1" }), activeMeds: [] });
  assert.equal(alone.allowed, true, "an ordinary single-drug order must not require an override");
  assert.equal(alone.blocks.length + alone.overridables.length, 0);

  const both = real.evaluate({
    order: MedicationOrder({ patientId: "p1", drug: "Warfarin 3mg", prescriberId: "dr-1" }),
    activeMeds: [{ drug: "Apixaban 5mg" }],
  });
  assert.equal(both.allowed, false, "two anticoagulants together is a real finding and must still fire");
  assert.equal(both.overridables.length, 1);
});


/* ------------------------------------------------------------------ subset absorption
 *
 * Found by reading the finished screen: the workstation showed two Monitor findings with the
 * identical sentence, one naming two of the patient's drugs and one naming three including both.
 * Telling a clinician the same fact twice with a different drug list is how a safety panel becomes
 * something to scroll past.
 */

test("noise: a finding whose drugs are a subset of an identical finding is absorbed", () => {
  const pack = compileRulePack({
    drugClasses: { ibuprofen: ["x", "y"], warfarin: ["x", "y"], clarithromycin: ["y"] },
    interactions: [
      { id: "dup-x", type: "duplicate_class", subjects: [{ kind: "class", value: "x" }], severity: "monitor", effect: "Possible therapeutic duplication." },
      { id: "dup-y", type: "duplicate_class", subjects: [{ kind: "class", value: "y" }], severity: "monitor", effect: "Possible therapeutic duplication." },
    ],
  });
  const f = checkInteractions(pack, { drug: "ibuprofen" }, [{ drug: "warfarin" }, { drug: "clarithromycin" }]);
  assert.equal(f.length, 1, "the two-drug statement is contained in the three-drug one and must not be shown twice");
  assert.deepEqual(f[0].drugs.slice().sort(), ["clarithromycin", "ibuprofen", "warfarin"],
    "the surviving finding names every drug actually involved");
  assert.deepEqual(f[0].mergedRuleIds.sort(), ["dup-x", "dup-y"], "both rule ids survive for the audit");
});

test("noise: a subset finding of DIFFERENT severity is never absorbed", () => {
  const pack = compileRulePack({
    drugClasses: { a: ["x", "y"], b: ["x", "y"], c: ["y"] },
    interactions: [
      { id: "minor-x", type: "duplicate_class", subjects: [{ kind: "class", value: "x" }], severity: "monitor", effect: "Same text." },
      { id: "major-y", type: "duplicate_class", subjects: [{ kind: "class", value: "y" }], severity: "major", effect: "Same text." },
    ],
  });
  const f = checkInteractions(pack, { drug: "a" }, [{ drug: "b" }, { drug: "c" }]);
  assert.equal(f.length, 2, "a major finding must never be swallowed by a monitor-level one, however similar the wording");
});

test("noise: findings saying DIFFERENT things are never absorbed", () => {
  const pack = compileRulePack({
    drugClasses: { a: ["x", "y"], b: ["x", "y"], c: ["y"] },
    interactions: [
      { id: "r-x", type: "duplicate_class", subjects: [{ kind: "class", value: "x" }], severity: "monitor", effect: "Duplication of anticoagulant." },
      { id: "r-y", type: "duplicate_class", subjects: [{ kind: "class", value: "y" }], severity: "monitor", effect: "Duplication of antibiotic." },
    ],
  });
  const f = checkInteractions(pack, { drug: "a" }, [{ drug: "b" }, { drug: "c" }]);
  assert.equal(f.length, 2, "two different clinical facts remain two findings");
});
