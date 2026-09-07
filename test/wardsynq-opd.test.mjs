/* test/wardsynq-opd.test.mjs — the bedside, tested without a browser.
 *
 * A phone at a bedside is the most likely place in a hospital for a wrong-patient action, because
 * the person holding it is standing in front of one patient while the screen shows whichever one it
 * was last showing. Every test here is about that, or about the UI not being where a clinical
 * decision gets made.
 *
 * node --test test/wardsynq-opd.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MODE, OpdError, BedsideSession, toRow } from "../wardsynq/ui/opd-emr.js";
import { MedicationAdministrationRecord } from "../wardsynq/wardsynq-meds.js";
import { GovernedStore, makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";
import { ClinicalStore, MemoryBackend } from "../wardsynq/wardsynq-store.js";
import { Patient, MedicationOrder, Observation } from "../wardsynq/wardsynq-model.js";

const NOW = "2026-09-04T09:00:00.000Z";

const patient = (over) => Patient({
  id: "pat-1", mrn: "MRN-1", name: "Test Patient", dob: "1960-05-05", wristbandBarcode: "WB-1", ...over,
});

const order = () => MedicationOrder({
  patientId: "pat-1", drug: "amoxicillin", drugCode: "AMOX", drugBarcode: "DB-1",
  dose: { value: 500, unit: "mg" }, route: "PO", prescriberId: "dr-1",
});

const goodScan = { patientBarcode: "WB-1", drugBarcode: "DB-1", dose: { value: 500, unit: "mg" }, route: "PO" };

async function session({ online = () => true, safetyCheck } = {}) {
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  const governed = new GovernedStore({ store: raw });
  const nurse = makeActor({ id: "nurse-7", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "RN-1234" });
  const emar = new MedicationAdministrationRecord({
    safetyCheck: safetyCheck || (async () => ({ allowed: true, reasons: [] })),
  });
  const s = new BedsideSession({ store: governed, actor: nurse, emar, now: () => NOW, online });
  s.open(patient());
  return { s, emar, nurse, governed };
}

/* ------------------------------------------------------------------ ADVERSARIAL: identity */

test("ADVERSARIAL: opening a chart does NOT confirm identity", async () => {
  const { s } = await session();
  assert.equal(s.mode, MODE.IDENTIFY);
  assert.equal(s.identityConfirmed, false,
    "opening a chart is something you can do from the corridor; identity is the band in front of you");
  assert.equal(s.state().actionsEnabled, false);
});

test("ADVERSARIAL: a mismatched wristband says you may be at the wrong patient", async () => {
  const { s } = await session();
  const r = s.confirmIdentity("WB-9");
  assert.equal(r.ok, false);
  assert.match(r.reason, /either the wrong chart is open or you are at the wrong patient/);
  assert.equal(s.identityConfirmed, false);
});

test("no scan at all is a failure with an instruction, not an error", async () => {
  const { s } = await session();
  const r = s.confirmIdentity(null);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Scan the band on the patient in front of you/);
});

test("a matching band confirms, and only then are actions enabled", async () => {
  const { s } = await session();
  assert.equal(s.confirmIdentity("WB-1").ok, true);
  assert.equal(s.mode, MODE.CHART);
  assert.equal(s.state().actionsEnabled, true);
});

test("ADVERSARIAL: switching patient REVOKES the confirmation", async () => {
  const { s } = await session();
  s.confirmIdentity("WB-1");
  assert.equal(s.state().actionsEnabled, true);

  s.open(patient({ id: "pat-2", mrn: "MRN-2", wristbandBarcode: "WB-2" }));
  assert.equal(s.identityConfirmed, false,
    "the commonest bedside error is the screen still showing the last patient");
  assert.equal(s.state().actionsEnabled, false);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the gate is real */

test("ADVERSARIAL: the ACTION refuses without identity, not just the button", async () => {
  const { s, emar } = await session();
  const o = order();
  const record = await emar.dispense(await emar.verify(emar.open(o), "pharm-1"), "pharm-1");

  // No confirmIdentity() call. A caller that bypasses the UI entirely still cannot administer.
  const r = await s.administer({ record, order: o, scan: goodScan });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, "IDENTITY_NOT_CONFIRMED");
  assert.match(r.refusal.message, /Scan the patient's wristband before giving anything/);
});

test("recording an observation is gated the same way", async () => {
  const { s } = await session();
  const r = await s.recordObservation(Observation({ patientId: "pat-1", code: "8867-4", value: 88 }));
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, "IDENTITY_NOT_CONFIRMED");
});

/* ------------------------------------------------------------------ ADVERSARIAL: refusals in full */

test("ADVERSARIAL: a five-rights failure is rendered IN FULL, not truncated to fit a phone", async () => {
  const { s, emar } = await session();
  s.confirmIdentity("WB-1");
  const o = order();
  const record = await emar.dispense(await emar.verify(emar.open(o), "pharm-1"), "pharm-1");

  // The wrong product in the nurse's hand.
  const r = await s.administer({ record, order: o, scan: { ...goodScan, drugBarcode: "DB-WRONG" } });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, "FIVE_RIGHTS");
  assert.ok(r.refusal.reasons.length >= 1, "every failed right is carried, not just the first");
  assert.match(r.refusal.reasons.map((x) => x.code).join(","), /FIVE_RIGHTS_DRUG/);
});

test("a safety-engine block reaches the bedside with its reasons", async () => {
  const { s, emar } = await session({
    safetyCheck: async () => ({
      allowed: false,
      blocks: [{ code: "ALLERGY_SEVERE", message: "documented anaphylaxis to penicillins; amoxicillin is a member" }],
    }),
  });
  s.confirmIdentity("WB-1");
  const o = order();
  const record = await emar.dispense(await emar.verify(emar.open(o), "pharm-1"), "pharm-1");

  const r = await s.administer({ record, order: o, scan: goodScan });
  assert.equal(r.ok, false);
  assert.match(r.refusal.reasons[0].message, /anaphylaxis/);
});

test("a refusal must be acknowledged explicitly, because one that fades was never read", async () => {
  const { s } = await session();
  await s.recordObservation(Observation({ patientId: "pat-1", code: "8867-4", value: 88 }));
  assert.equal(s.state().refusals.length, 1);
  s.acknowledgeRefusal(0);
  assert.equal(s.state().refusals.length, 0);
});

/* ------------------------------------------------------------------ the happy path */

test("a confirmed identity and a clean scan administers, through the real eMAR", async () => {
  const { s, emar } = await session();
  s.confirmIdentity("WB-1");
  const o = order();
  const record = await emar.dispense(await emar.verify(emar.open(o), "pharm-1"), "pharm-1");

  const r = await s.administer({ record, order: o, scan: goodScan });
  assert.equal(r.ok, true, JSON.stringify(r.refusal));
  assert.equal(r.state, "administered");
  assert.ok(r.administeredAt);
  assert.equal(r.persistence.heldOnDevice, false);
});

/* ------------------------------------------------------------------ ADVERSARIAL: offline */

test("ADVERSARIAL: offline work is durable BEFORE the screen says it was recorded", async () => {
  const { s, emar } = await session({ online: () => false });
  s.confirmIdentity("WB-1");
  const o = order();
  const record = await emar.dispense(await emar.verify(emar.open(o), "pharm-1"), "pharm-1");

  const r = await s.administer({ record, order: o, scan: goodScan });
  assert.equal(r.ok, true);
  assert.equal(r.persistence.heldOnDevice, true);
  assert.match(r.note, /held on this device/,
    "the screen must never report success over a write that is still only in memory");
  assert.equal(s.state().heldOnDevice, 1);
  assert.equal(s.state().online, false);
});

test("ADVERSARIAL: a governance refusal is NOT journalled as if it were a connectivity problem", async () => {
  const { s } = await session();
  s.confirmIdentity("WB-1");

  // A write aimed at another chart. The governed store refuses it; journalling it would retry a
  // write the system has already decided is not allowed.
  const r = await s.recordObservation(Observation({ patientId: "pat-9", code: "8867-4", value: 88 }));
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, "GOVERNANCE");
  assert.equal(s.state().heldOnDevice, 0, "nothing was queued for retry");
});

/* ------------------------------------------------------------------ construction */

test("the bedside refuses to work through a raw store or without an actor", () => {
  const raw = new ClinicalStore({ backend: new MemoryBackend() });
  assert.throws(() => new BedsideSession({ actor: { id: "n" } }), (e) => e instanceof OpdError && e.code === "NO_STORE");
  assert.throws(() => new BedsideSession({ store: new GovernedStore({ store: raw }) }), (e) => e.code === "NO_ACTOR");
});

/* ------------------------------------------------------------------ ADVERSARIAL: colour is never alone */

test("ADVERSARIAL: a signalled row cannot be rendered without a WORD", () => {
  for (const signal of ["stop", "major", "watch", "clear"]) {
    const row = toRow({ signal, label: "Potassium", value: 6.4, unit: "mmol/L" });
    assert.ok(row.signalWord, `${signal} must carry a word`);
    assert.notEqual(row.signalWord, "");
  }
  const plain = toRow({ label: "Sodium", value: 139 });
  assert.equal(plain.signalWord, null, "an unsignalled row carries no word, which is also honest");
  assert.throws(() => toRow({ signal: "urgent-ish", label: "x" }), (e) => e.code === "BAD_SIGNAL");
});

test("row values are stringified so a zero renders rather than vanishing", () => {
  assert.equal(toRow({ label: "Urine output", value: 0, unit: "mL/h" }).value, "0",
    "a falsy clinical value is still a clinical value, and 0 mL/h is the important one");
  assert.equal(toRow({ label: "Pending" }).value, null);
});
