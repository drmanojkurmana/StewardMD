/* test/wardsynq-bundle-binding.test.mjs — knowing versus being told.
 *
 * The end-to-end test at the bottom is the one that matters: a nurse scans a wristband and a
 * product, the eMAR reaches ADMINISTERED, and the sepsis bundle's antibiotic element completes
 * without anybody claiming anything. Everything else guards the ways that could go wrong.
 *
 * node --test test/wardsynq-bundle-binding.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROVENANCE, BundleBinder, BindingError, provenanceSummary, provenanceReport, markAttested,
} from "../wardsynq/wardsynq-bundle-binding.js";
import { EmergencyBundle, CODE } from "../wardsynq/wardsynq-emergency.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { MedicationAdministrationRecord } from "../wardsynq/wardsynq-meds.js";
import { Patient, MedicationOrder } from "../wardsynq/wardsynq-model.js";

const T0 = "2026-09-04T02:10:00.000Z";
const at = (m) => new Date(Date.parse(T0) + m * 60000).toISOString();

const BINDINGS = [
  { code: CODE.SEPSIS, element: "antibiotics", drugCodes: ["PIPTAZ", "MEROPENEM"] },
  { code: CODE.STEMI, element: "aspirin", drugCodes: ["ASPIRIN"] },
];

const bundle = (over) => new EmergencyBundle({
  code: CODE.SEPSIS, patientId: "pat-1", startedBy: "dr-1", timeZero: T0, now: T0, ...over,
});

/** A minimal administration record of the shape wardsynq-meds.js emits. */
const admin = (over) => ({
  id: "adm-1", patientId: "pat-1", status: "administered",
  administeredAt: at(30), administeredBy: "nurse-7", ...over,
});

const binderFor = (b, over) => {
  const bus = new ClinicalEventBus();
  const binder = new BundleBinder({ bus, bindings: BINDINGS, now: () => at(31), ...over });
  if (b) binder.watch(b);
  return binder;
};

/* ------------------------------------------------------------------ derivation */

test("an eMAR administration completes the matching element without anyone claiming it", () => {
  const b = bundle();
  const binder = binderFor(b);
  const r = binder.onAdministered({ payload: { record: admin(), order: MedicationOrder({ patientId: "pat-1", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "dr-1" }) } });

  assert.equal(r.completed.length, 1);
  const el = b.element("antibiotics");
  assert.equal(el.done, true);
  assert.equal(el.provenance, PROVENANCE.DERIVED);
  assert.equal(el.doneBy, "nurse-7");
  assert.equal(el.sourceRecordId, "adm-1");
});

test("ADVERSARIAL: a derived completion carries the eMAR's time, not the processing time", () => {
  const b = bundle();
  // The binder's own clock says 31 minutes; the administration happened at 30. If the element took
  // the processing time, automation would become a way to make a bundle look faster or slower.
  const binder = binderFor(b, { now: () => at(300) });
  binder.onAdministered({ payload: { record: admin({ administeredAt: at(30) }), order: MedicationOrder({ patientId: "pat-1", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "d" }) } });
  assert.equal(b.element("antibiotics").doneAt, at(30));
  assert.equal(Math.round(b.element("antibiotics").elapsedMinutes), 30);
});

test("ADVERSARIAL: an administration BEFORE time zero belongs to an earlier episode", () => {
  const b = bundle();
  const binder = binderFor(b);
  const r = binder.onAdministered({ payload: { record: admin({ administeredAt: at(-120) }), order: MedicationOrder({ patientId: "pat-1", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "d" }) } });
  assert.equal(r.completed.length, 0, "crediting a dose given before the patient was recognised would be free compliance");
  assert.equal(b.element("antibiotics").done, false);
});

test("ADVERSARIAL: an administration with no administeredAt cannot anchor a timed element", () => {
  const b = bundle();
  const binder = binderFor(b);
  const r = binder.onAdministered({ payload: { record: admin({ administeredAt: null }), order: MedicationOrder({ patientId: "pat-1", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "d" }) } });
  assert.equal(r.completed.length, 0);
  assert.match(r.unmatched.reason, /cannot anchor a timed element/);
});

test("another patient's antibiotic never completes this patient's bundle", () => {
  const b = bundle();
  const binder = binderFor(b);
  const r = binder.onAdministered({ payload: { record: admin({ patientId: "pat-2" }), order: MedicationOrder({ patientId: "pat-2", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "d" }) } });
  assert.equal(r.completed.length, 0);
  assert.equal(b.element("antibiotics").done, false);
});

test("a drug that matches no binding is recorded as unmatched, not silently dropped", () => {
  const b = bundle();
  const binder = binderFor(b);
  const r = binder.onAdministered({ payload: { record: admin(), order: MedicationOrder({ patientId: "pat-1", drugCode: "PARACETAMOL", drug: "paracetamol", prescriberId: "d" }) } });
  assert.equal(r.completed.length, 0);
  assert.match(r.unmatched.reason, /no live bundle element matched drug PARACETAMOL/);
  assert.equal(binder.unmatched.length, 1);
});

test("an already-completed element is not completed twice", () => {
  const b = bundle();
  b.complete("antibiotics", { event: "administered", at: at(20), by: "nurse-3" });
  const binder = binderFor(b);
  const r = binder.onAdministered({ payload: { record: admin(), order: MedicationOrder({ patientId: "pat-1", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "d" }) } });
  assert.equal(r.completed.length, 0);
  assert.equal(b.element("antibiotics").doneAt, at(20), "the first record stands");
});

test("a voided bundle is never completed by a later event", () => {
  const b = bundle();
  b.void("dr-1", "wrong patient");
  const binder = binderFor(b);
  const r = binder.onAdministered({ payload: { record: admin(), order: MedicationOrder({ patientId: "pat-1", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "d" }) } });
  assert.equal(r.completed.length, 0);
});

test("junk payloads do not throw", () => {
  const binder = binderFor(bundle());
  for (const junk of [undefined, {}, { payload: {} }, { payload: { record: {} } }]) {
    assert.deepEqual(binder.onAdministered(junk).completed, []);
  }
});

test("a binder needs the bus", () => {
  assert.throws(() => new BundleBinder({}), (e) => e instanceof BindingError && e.code === "NO_BUS");
});

/* ------------------------------------------------------------------ ADVERSARIAL: attested is not derived */

test("ADVERSARIAL: a manually completed element is ATTESTED and is never called derived", () => {
  const b = bundle();
  b.complete("antibiotics", { event: "administered", at: at(30), by: "dr-1" });
  markAttested(b);
  assert.equal(b.element("antibiotics").provenance, PROVENANCE.ATTESTED);
});

test("manual completion REMAINS POSSIBLE, because a refusal is abandoned mid-resuscitation", () => {
  const b = bundle();
  // The eMAR is down and the drug came from the emergency box. Refusing to let the team record what
  // they did would fail the patient in the only direction that matters: the drug was given and the
  // record says it was not.
  assert.doesNotThrow(() => b.complete("antibiotics", { event: "administered", at: at(25), by: "nurse-7" }));
  assert.equal(b.element("antibiotics").done, true);
});

test("the summary reports the split and warns when compliance rests on attestation", () => {
  const b = bundle();
  b.notApplicable("fluids", { by: "dr-1", reason: "normotensive" });
  b.notApplicable("vasopressors", { by: "dr-1", reason: "not hypotensive" });
  b.complete("lactate", { event: "resulted", at: at(15), by: "lab" });
  b.complete("cultures", { event: "collected", at: at(20), by: "nurse-7" });

  const binder = binderFor(b);
  binder.onAdministered({ payload: { record: admin({ administeredAt: at(40) }), order: MedicationOrder({ patientId: "pat-1", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "d" }) } });

  const s = provenanceSummary(b, at(60));
  assert.equal(s.compliant, true);
  assert.equal(s.done, 3);
  assert.equal(s.derived, 1);
  assert.equal(s.attested, 2);
  assert.deepEqual(s.derivedKeys, ["antibiotics"]);
  assert.match(s.caution, /not that another system observed it/);
});

test("a fully derived bundle carries no caution", () => {
  const b = new EmergencyBundle({
    code: CODE.STEMI, patientId: "pat-1", startedBy: "dr-1", timeZero: T0, now: T0,
    definition: { label: "STEMI (aspirin only, for this test)", elements: [{ key: "aspirin", label: "Aspirin", targetMinutes: 30, doneOn: "administered" }] },
  });
  const binder = binderFor(b);
  binder.onAdministered({ payload: { record: admin({ administeredAt: at(10) }), order: MedicationOrder({ patientId: "pat-1", drugCode: "ASPIRIN", drug: "aspirin", prescriberId: "d" }) } });
  const s = provenanceSummary(b, at(20));
  assert.equal(s.derived, 1);
  assert.equal(s.attested, 0);
  assert.equal(s.caution, null);
});

test("ADVERSARIAL: the roll-up exposes a unit that is compliant on paperwork", () => {
  // Ten bundles, all compliant, only one of them evidenced by anything but a claim. Before this
  // report that unit looked like a 100 percent unit.
  const bundles = [];
  for (let i = 0; i < 10; i++) {
    const b = bundle({ patientId: `pat-${i}` });
    b.notApplicable("fluids", { by: "dr-1", reason: "normotensive" });
    b.notApplicable("vasopressors", { by: "dr-1", reason: "not hypotensive" });
    b.complete("lactate", { event: "resulted", at: at(10), by: "lab" });
    b.complete("cultures", { event: "collected", at: at(12), by: "n" });
    if (i === 0) {
      const binder = binderFor(b);
      binder.onAdministered({ payload: { record: admin({ patientId: "pat-0", administeredAt: at(20) }), order: MedicationOrder({ patientId: "pat-0", drugCode: "PIPTAZ", drug: "piperacillin-tazobactam", prescriberId: "d" }) } });
    } else {
      b.complete("antibiotics", { event: "administered", at: at(20), by: "n" });
    }
    bundles.push(b);
  }

  const r = provenanceReport(bundles, at(60));
  assert.equal(r.compliantPercent, 100);
  assert.equal(r.derivedPercent, 3, "1 derived element out of 30 completed");
  assert.match(r.reading, /a compliance figure is only as good as that proportion/);
});

/* ------------------------------------------------------------------ the whole point */

test("ADVERSARIAL: a bedside scan, and only a bedside scan, completes the antibiotic element", async () => {
  const bus = new ClinicalEventBus();
  const engine = new MedicationAdministrationRecord({
    bus,
    safetyCheck: async () => ({ allowed: true, reasons: [] }),
  });

  const b = bundle();
  const binder = new BundleBinder({ bus, bindings: BINDINGS, now: () => at(45) });
  binder.watch(b);
  binder.start();

  const patient = Patient({ id: "pat-1", mrn: "MRN-1", name: "Test Patient", dob: "1975-04-02", wristbandBarcode: "WB-1" });
  const order = MedicationOrder({
    patientId: "pat-1", drug: "piperacillin-tazobactam", drugCode: "PIPTAZ",
    drugBarcode: "DB-1", dose: { value: 4.5, unit: "g" }, route: "IV", prescriberId: "dr-1",
  });

  let record = engine.open(order);
  record = await engine.verify(record, "pharm-1");
  record = await engine.dispense(record, "pharm-1");

  // Nothing has completed yet: an order and a dispense are not an administration.
  assert.equal(b.element("antibiotics").done, false);

  record = await engine.scan(record, {
    order, patient, nurseId: "nurse-7",
    scan: { patientBarcode: "WB-1", drugBarcode: "DB-1", dose: { value: 4.5, unit: "g" }, route: "IV" },
  });
  assert.equal(b.element("antibiotics").done, false, "a scan is not an administration either");

  record = await engine.administer(record, { order, nurseId: "nurse-7" });

  const el = b.element("antibiotics");
  assert.equal(el.done, true, "the bundle element is now anchored to a wristband and a product barcode");
  assert.equal(el.provenance, PROVENANCE.DERIVED);
  assert.equal(el.doneAt, record.administeredAt, "and to the eMAR's own time");

  binder.stop();
});
