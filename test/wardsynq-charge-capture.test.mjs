/* test/wardsynq-charge-capture.test.mjs — billing what happened, never what was intended.
 *
 * node --test test/wardsynq-charge-capture.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HAPPENED, capturableFrom, priceWith } from "../functions/_wardsynq/charge-capture.js";
import { grantForRole } from "../functions/_wardsynq/actor.js";

const adm = (over = {}) => ({ id: "mar-1", status: "administered", drug: "Metformin", drugCode: "MET500", patientId: "pat-1", encounterId: "enc-1", givenAt: "2026-09-08T09:00:00.000Z", ...over });

test("A HELD OR REFUSED DOSE IS NOT A CHARGE, and the patient is the one who would argue with it", () => {
  /* Billing from ORDERS is the ordinary way to build this and it bills for medicine the patient
   * declined. Only the eMAR's own terminal "administered" is a dose that happened. */
  const { items, skipped } = capturableFrom({
    MedicationAdministration: [
      adm(),
      adm({ id: "mar-2", status: "held" }),
      adm({ id: "mar-3", status: "refused" }),
      adm({ id: "mar-4", status: "scanned" }),
      adm({ id: "mar-5", status: "cancelled" }),
    ],
  });
  assert.deepEqual(items.map((i) => i.sourceId), ["mar-1"]);

  /* Named, not silently absent: a held dose and a dose nobody charted look identical on a bill that
   * lists neither, and only one of them is worth chasing. */
  assert.deepEqual(skipped.map((s) => s.status), ["held", "refused", "scanned", "cancelled"]);
  assert.ok(skipped.every((s) => s.reason === "did_not_happen"));

  // The rule is an allow-list, so a state invented later is excluded until somebody decides.
  assert.deepEqual(HAPPENED.MedicationAdministration, ["administered"]);
});

test("A DOSE ANOTHER HOSPITAL GAVE IS NOT THIS HOSPITAL'S CHARGE, and it is named as seen, not silently absent", () => {
  const theirs = adm({ id: "his-mar-1", meta: { source: { system: "fhir-partner-his", sourceId: "MA1" } } });
  const ours = adm({ meta: { source: { system: "wardsynq-native", sourceId: null } } });
  const { items, skipped } = capturableFrom({ MedicationAdministration: [theirs, ours], DiagnosticReport: [{ id: "their-rep", status: "final", code: "CXR", meta: { source: { system: "fhir-partner-his" } } }] });
  assert.deepEqual(items.map((i) => i.sourceId), ["mar-1"], "only ours is an item, even though both are administered");
  assert.deepEqual(skipped.map((s) => [s.sourceId, s.reason, s.system]), [["his-mar-1", "external_source", "fhir-partner-his"], ["their-rep", "external_source", "fhir-partner-his"]]);
});

test("A PRELIMINARY REPORT IS NOT A COMPLETED TEST", () => {
  /* Billing a preliminary result means billing again when it finalises, or never correcting it if
   * the result is withdrawn. */
  const { items } = capturableFrom({
    DiagnosticReport: [
      { id: "rep-1", status: "final", code: "Renal profile", patientId: "pat-1" },
      { id: "rep-2", status: "corrected", code: "FBC", patientId: "pat-1" },
      { id: "rep-3", status: "preliminary", code: "CRP", patientId: "pat-1" },
    ],
  });
  assert.deepEqual(items.map((i) => i.sourceId), ["rep-1", "rep-2"]);
});

test("AN UNPRICED ITEM IS LISTED, NEVER DROPPED AND NEVER FREE", () => {
  const items = [
    { code: "MET500", display: "Metformin", quantity: 1 },
    { code: "UNKNOWN", display: "Something", quantity: 1 },
  ];
  const out = priceWith(items, { MET500: { amount: 12.5, currency: "INR", description: "Metformin 500mg" } });
  assert.equal(out.priced.length, 1);
  assert.equal(out.total, 12.5);
  assert.equal(out.currency, "INR");

  /* Silently dropped is revenue nobody knows was lost; quietly zero reads as a decision to give it
   * away. Neither is what "we have no price for this" means. */
  assert.equal(out.unpriced.length, 1);
  assert.equal(out.unpriced[0].reason, "no_tariff_entry");
  assert.ok(!out.priced.some((p) => p.code === "UNKNOWN"));
});

test("a tariff entry with no amount is a configuration mistake, not a price of zero", () => {
  /* Number("") is 0 and 0 is finite - the bug this codebase has hit three times. Here it would
   * silently give an item away. */
  for (const bad of [{ amount: "" }, { amount: null }, { amount: "abc" }, {}]) {
    const out = priceWith([{ code: "X", quantity: 1 }], { X: bad });
    assert.equal(out.priced.length, 0, JSON.stringify(bad));
    assert.equal(out.unpriced[0].reason, "tariff_entry_has_no_amount");
    assert.equal(out.total, 0);
  }
  // A genuine zero, stated as a number, IS a price - a hospital may legitimately charge nothing.
  assert.equal(priceWith([{ code: "X", quantity: 1 }], { X: { amount: 0 } }).priced.length, 1);
});

test("ONE BILL, ONE CURRENCY: a total summed across two is a number with no meaning", () => {
  const out = priceWith(
    [{ code: "A", quantity: 1 }, { code: "B", quantity: 1 }],
    { A: { amount: 10, currency: "INR" }, B: { amount: 20, currency: "USD" } });
  assert.equal(out.currency, "INR");
  assert.equal(out.total, 10, "the mismatched line is not added");
  assert.equal(out.unpriced[0].reason, "currency_mismatch");
});

test("no tariff at all prices nothing, because there is no default rate card", () => {
  const out = priceWith([{ code: "A", quantity: 1 }], null);
  assert.equal(out.priced.length, 0);
  assert.equal(out.total, 0);
  assert.equal(out.currency, null);
});

test("CHARGE CAPTURE WIDENED BILLING'S READ AND NOT ITS WRITE", () => {
  const cashier = grantForRole("cashier");
  /* Billing what happened requires knowing what happened. The containment is that the write scope
   * did not move: billing still cannot write a clinical fact of any kind, which is the guarantee
   * #939 rests on. */
  assert.ok(cashier.read.includes("MedicationAdministration"));
  assert.ok(cashier.read.includes("DiagnosticReport"));
  assert.deepEqual(cashier.write, ["Claim", "PreAuthorisation"]);
  assert.ok(!cashier.write.includes("MedicationAdministration"), "reading a dose never becomes recording one");
  assert.ok(!cashier.write.includes("Condition"));
  // Still not the whole chart: the notes remain out of reach.
  assert.ok(!cashier.read.includes("ClinicalNote"));
});
