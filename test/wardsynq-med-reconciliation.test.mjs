/* test/wardsynq-med-reconciliation.test.mjs — medicines reconciled in and out. Pure half.
 *
 * node --test test/wardsynq-med-reconciliation.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGES, DECISIONS, NEEDS_REASON, reconciliationIdFor, medicineKey, medicinesFrom,
  reconciliationSummary, reconciliationForSummary, MedicationReconciliation,
} from "../functions/_wardsynq/med-reconciliation.js";

const HOME = [
  { drug: "Warfarin", dose: "3 mg", frequency: "OD" },
  { drug: "Levothyroxine", dose: "75 mcg", frequency: "OM" },
  { drug: "Amlodipine", dose: "5 mg", frequency: "OD" },
];
const recFrom = (meds, over) => MedicationReconciliation({
  id: "wsq-medrec-e1-admission", patientId: "pat", encounterId: "e1", stage: "admission",
  medicines: medicinesFrom(meds).medicines, ...(over || {}),
});

test("UNRECONCILED IS THE DEFAULT: every home medicine starts undecided", () => {
  const { medicines } = medicinesFrom(HOME);
  assert.equal(medicines.length, 3);
  assert.ok(medicines.every((m) => m.decision === "undecided"), "nothing is assumed continued");
  assert.ok(medicines.every((m) => m.decidedBy === null && m.decidedAt === null));
  // A reconciliation that defaulted to "continued" would put an assurance on the chart nobody gave.
  assert.equal(DECISIONS[0], "undecided");
});

test("COMPLETE IS DERIVED FROM THE MEDICINES, never a flag somebody set", () => {
  const rec = recFrom(HOME);
  const open = reconciliationSummary(rec);
  assert.equal(open.complete, false);
  assert.equal(open.undecided, 3);
  assert.equal(open.counts.undecided, 3);

  // Two decided, one still open: still not complete. A stored flag would let this be declared
  // finished with an item open, which is the exact failure the file exists to prevent.
  const partly = reconciliationSummary({ ...rec, medicines: rec.medicines.map((m, i) => (i < 2 ? { ...m, decision: "continued" } : m)) });
  assert.equal(partly.complete, false);
  assert.equal(partly.undecided, 1);

  const done = reconciliationSummary({ ...rec, medicines: rec.medicines.map((m) => ({ ...m, decision: "continued" })) });
  assert.equal(done.complete, true);
  assert.equal(done.undecided, 0);

  // An EMPTY list is not "complete": nobody having taken a history is not the same as a patient on
  // no medicines, and the record says which it is.
  const none = reconciliationSummary(recFrom([]));
  assert.equal(none.complete, false);
  assert.equal(none.empty, true);
});

test("stopping and changing need a reason; continuing does not", () => {
  // The decisions that cause the harm are the ones that remove or alter a medicine the patient was
  // already stable on. Requiring a reason for "continued" would only produce it typed a thousand times.
  assert.deepEqual([...NEEDS_REASON].sort(), ["changed", "held", "stopped"]);
  assert.ok(!NEEDS_REASON.includes("continued"));
});

test("a medicine with no name is refused, and a duplicate is not listed twice", () => {
  const { medicines, rejected } = medicinesFrom([
    { drug: "Warfarin", dose: "3 mg" },
    { drug: "   ", dose: "5 mg" },
    { dose: "10 mg" },
    { drug: "warfarin", dose: "3 mg" },      // the same medicine, spelled differently
  ]);
  assert.equal(medicines.length, 1);
  // An unnamed medicine is an item nobody can ever decide; it would sit there as permanent noise.
  assert.deepEqual(rejected.map((r) => r.reason), ["no_drug_name", "no_drug_name", "duplicate"]);
  assert.equal(medicineKey("Warfarin"), medicineKey("  warfarin  "));
  assert.notEqual(medicineKey("Warfarin"), medicineKey("Warfarin sodium"));
});

test("one reconciliation per encounter and stage; admission and discharge are separate questions", () => {
  const a = reconciliationIdFor("e1", "admission");
  assert.equal(a, reconciliationIdFor("e1", "admission"));
  assert.notEqual(a, reconciliationIdFor("e1", "discharge"));
  assert.notEqual(a, reconciliationIdFor("e2", "admission"));
  assert.equal(reconciliationIdFor("e1", "sometime"), null, "an unknown stage is not a reconciliation");
  assert.equal(reconciliationIdFor("", "admission"), null);
  assert.deepEqual([...STAGES], ["admission", "discharge"]);
});

test("THE SUMMARY NAMES WHAT WAS NOT RECONCILED, rather than quietly omitting it", () => {
  const rec = recFrom(HOME);
  const mixed = {
    ...rec,
    medicines: [
      { ...rec.medicines[0], decision: "stopped", reason: "Held for surgery, restart per haematology." },
      { ...rec.medicines[1], decision: "continued" },
      { ...rec.medicines[2] },   // still undecided
    ],
  };
  const text = reconciliationForSummary(mixed);
  assert.match(text, /Continued:\nLevothyroxine 75 mcg, OM/);
  assert.match(text, /Stopped:\nWarfarin 3 mg, OD - Held for surgery/);
  // A summary that showed only the decided medicines would read as a completed reconciliation, and
  // the one nobody decided is exactly the one that gets lost.
  assert.match(text, /NOT RECONCILED - no decision was recorded for these:\nAmlodipine/);

  // Nothing on the list means nothing to say, rather than an empty heading implying completeness.
  assert.equal(reconciliationForSummary(recFrom([])), null);
  assert.equal(reconciliationForSummary(null), null);
});

test("the reason travels with the decision into the summary", () => {
  const rec = recFrom([{ drug: "Metformin", dose: "1 g", frequency: "BD" }]);
  const changed = { ...rec, medicines: [{ ...rec.medicines[0], decision: "changed", reason: "Reduced to 500 mg BD, eGFR 38." }] };
  assert.match(reconciliationForSummary(changed), /Changed:\nMetformin 1 g, BD - Reduced to 500 mg BD, eGFR 38\./);
});
