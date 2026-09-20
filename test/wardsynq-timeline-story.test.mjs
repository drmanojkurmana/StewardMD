/* The timeline as the whole clinical story: procedures, critical events, dispensing, allergies,
 * admission/transfer/discharge and billing, not just notes and vitals. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { timelineFromChart } from "../functions/_wardsynq/migrate-inpatient.js";

const meta = (at) => ({ effectiveAt: at, recordedAt: at });

test("the whole clinical story appears, not just notes and vitals", () => {
  const chart = {
    SurgicalCase: [{ resourceType: "SurgicalCase", id: "sc1", procedure: "Appendicectomy", site: "abdomen",
      laterality: "not-applicable", status: "signed-out", writtenBy: { id: "dr.surg@x.test" },
      meta: meta("2026-09-11T14:00:00.000Z") }],
    CriticalResultLoop: [{ resourceType: "CriticalResultLoop", id: "crl1", code: "K", display: "Potassium",
      value: 6.9, unit: "mmol/L", state: "open", meta: meta("2026-09-11T15:00:00.000Z") }],
    MedicationDispense: [{ resourceType: "MedicationDispense", id: "md1", drug: "Co-amoxiclav",
      quantity: 3, unit: "vial", writtenBy: { id: "pharm.a@x.test" }, meta: meta("2026-09-11T10:00:00.000Z") }],
    AllergyIntolerance: [{ resourceType: "AllergyIntolerance", id: "al1", substance: "Penicillin",
      severity: "severe", writtenBy: { id: "nurse.b@x.test" }, meta: meta("2026-09-10T08:30:00.000Z") }],
    Invoice: [{ resourceType: "Invoice", id: "inv1", lines: [{ display: "Bed charge" }, { display: "CBC" }],
      writtenBy: { id: "cashier.a@x.test" }, meta: meta("2026-09-12T08:00:00.000Z") }],
  };
  const { events } = timelineFromChart(chart);
  const by = {};
  for (const e of events) by[e.resourceType] = e;

  assert.match(by.SurgicalCase.label, /Operation: Appendicectomy/);
  assert.equal(by.SurgicalCase.category, "procedure");

  assert.match(by.CriticalResultLoop.label, /CRITICAL: Potassium 6\.9 mmol\/L/);
  assert.match(by.CriticalResultLoop.label, /nobody has acknowledged this yet/);
  assert.equal(by.CriticalResultLoop.category, "critical");
  assert.equal(by.CriticalResultLoop.critical, true);

  assert.match(by.MedicationDispense.label, /pharm\.a issued Co-amoxiclav 3 vial/);
  assert.equal(by.MedicationDispense.category, "medication");

  assert.match(by.AllergyIntolerance.label, /nurse\.b recorded an allergy: Penicillin/);
  assert.equal(by.AllergyIntolerance.category, "allergy");

  assert.equal(by.Invoice.category, "billing");
  assert.match(by.Invoice.label, /Bill raised — 2 items/);
});

test("a bill says WHAT was billed and never how much", () => {
  const chart = {
    Invoice: [{ resourceType: "Invoice", id: "inv2", currency: "INR",
      lines: [{ display: "Bed charge", amount: 4500 }, { display: "CBC", amount: 300 }],
      meta: meta("2026-09-12T08:00:00.000Z") }],
  };
  const { events } = timelineFromChart(chart);
  const inv = events[0];
  const text = inv.label + JSON.stringify(inv.body || []);
  assert.ok(text.includes("Bed charge"), "the item should be named");
  /* The amounts belong on the billing screen, which has its own permission. A clinical history that
   * quietly carries a patient's money puts it on every clinical reader's screen. */
  assert.ok(!text.includes("4500"), "an amount leaked onto the clinical history");
  assert.ok(!text.includes("300"), "an amount leaked onto the clinical history");
});

test("an outpatient visit checks in; a ward stay is admitted; and both can be left", () => {
  const opd = timelineFromChart({
    Encounter: [{ resourceType: "Encounter", id: "e2", class: "OPD", status: "in-progress", meta: meta("2026-09-10T08:00:00.000Z") }],
  }).events[0];
  assert.match(opd.label, /checked in/);

  const ipd = timelineFromChart({
    Encounter: [{ resourceType: "Encounter", id: "e3", class: "IPD", status: "in-progress", meta: meta("2026-09-10T08:00:00.000Z") }],
  }).events[0];
  assert.match(ipd.label, /admitted/);

  const moved = timelineFromChart({
    Encounter: [{ resourceType: "Encounter", id: "e5", class: "ICU", status: "in-progress",
      transferredAt: "2026-09-11T02:00:00.000Z", meta: meta("2026-09-11T02:00:00.000Z") }],
  }).events[0];
  assert.match(moved.label, /moved/);

  const gone = timelineFromChart({
    Encounter: [{ resourceType: "Encounter", id: "e4", class: "IPD", status: "finished", meta: meta("2026-09-12T08:00:00.000Z") }],
  }).events[0];
  assert.match(gone.label, /discharged/);
});

test("a resource type nobody has written a label for still appears, rather than vanishing", () => {
  const { events } = timelineFromChart({
    SomethingNew: [{ resourceType: "SomethingNew", id: "x1", meta: meta("2026-09-12T08:00:00.000Z") }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].category, "other");
  assert.match(events[0].label, /SomethingNew recorded/);
});
