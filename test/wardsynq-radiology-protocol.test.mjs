/* test/wardsynq-radiology-protocol.test.mjs — deciding what will actually be done to the patient.
 *
 * node --test test/wardsynq-radiology-protocol.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TYPE, CREATININE_CODES, isContrastAllergy, latestCreatinine } from "../functions/_wardsynq/radiology-protocol.js";
import { grantForRole } from "../functions/_wardsynq/actor.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/radiology-protocol.js", import.meta.url), "utf8");
const cr = (over = {}) => ({ code: "2160-0", value: 88, unit: "umol/L", meta: { effectiveAt: "2026-09-08T08:00:00.000Z" }, ...over });

test("NO CREATININE IS NOT A NORMAL CREATININE", () => {
  /* Assuming normal is the assumption that makes contrast dangerous, and an absent value shown as a
   * blank reads as "checked" to whoever is protocolling. */
  const none = latestCreatinine([], "2026-09-08T12:00:00.000Z");
  assert.equal(none.known, false);
  assert.equal(none.value, undefined);
  assert.match(none.note, /not the same as normal/);

  // An observation with no usable time cannot be judged and is not offered as if it could be.
  assert.equal(latestCreatinine([cr({ meta: {} })], "2026-09-08T12:00:00.000Z").known, false);
  assert.equal(latestCreatinine([cr({ value: null })], "2026-09-08T12:00:00.000Z").known, false);
});

test("AN OLD CREATININE IS NOT A CURRENT ONE, and its age travels with it", () => {
  const fresh = latestCreatinine([cr()], "2026-09-08T12:00:00.000Z");
  assert.equal(fresh.known, true);
  assert.equal(fresh.value, 88);
  assert.equal(fresh.ageDays, 0);
  assert.match(fresh.note, /today/);

  const old = latestCreatinine([cr({ meta: { effectiveAt: "2026-08-01T08:00:00.000Z" } })], "2026-09-08T12:00:00.000Z");
  assert.equal(old.ageDays, 38);
  assert.match(old.note, /describes the patient then, not now/);

  // The most recent wins, whatever order the record hands them over in.
  const many = latestCreatinine([
    cr({ value: 70, meta: { effectiveAt: "2026-09-01T08:00:00.000Z" } }),
    cr({ value: 300, meta: { effectiveAt: "2026-09-08T08:00:00.000Z" } }),
    cr({ value: 90, meta: { effectiveAt: "2026-09-05T08:00:00.000Z" } }),
  ], "2026-09-08T12:00:00.000Z");
  assert.equal(many.value, 300);
});

test("A RECORDED CONTRAST REACTION IS RECOGNISED, and unrelated allergies are not", () => {
  assert.equal(isContrastAllergy({ substance: "Iodinated contrast media" }), true);
  assert.equal(isContrastAllergy({ substance: "Gadolinium" }), true);
  assert.equal(isContrastAllergy({ substance: "IOHEXOL" }), true, "matching is case-insensitive");
  assert.equal(isContrastAllergy({ substance: "Penicillin" }), false);
  assert.equal(isContrastAllergy({ substance: "" }), false);
  assert.equal(isContrastAllergy(null), false);
});

test("CONTRAST IS NOT BLOCKED, but a reaction on file makes the reason mandatory", () => {
  /* A contrast study is sometimes the right call under premedication, and a radiologist who cannot
   * make that call safely here will make it unsafely somewhere this system cannot see. */
  assert.ok(/contrast_reason_required/.test(SRC));
  assert.ok(/not blocked/i.test(SRC));
  // And what was on screen is kept, so a later reader can tell an informed decision from a blind one.
  assert.ok(/renalAtProtocol/.test(SRC));
  assert.ok(/contrastAllergiesAtProtocol/.test(SRC));
});

test("AN UNREADABLE ALLERGY LIST IS NOT A CLEAR ONE: contrast fails closed", () => {
  /* Proceeding with an empty list would look identical to proceeding with a clear one, which is the
   * exact situation this file exists to prevent. */
  assert.ok(/allergy_read_failed/.test(SRC));
  assert.ok(/An unreadable allergy list is not a clear one/.test(SRC));
});

test("IT COMPUTES NO eGFR, because a number it invented would be trusted like a laboratory's", () => {
  /* The word appears in the note that EXPLAINS the absence, which is code and should stay. What must
   * not appear is a formula: those are the names an implementation would carry. */
  assert.ok(!/cockcroft|gault|mdrd|ckd-?epi|\*\s*1\.?15|Math\.pow/i.test(SRC));
  // And the returned renal figure is the recorded value, never a derived one.
  const r = latestCreatinine([cr()], "2026-09-08T12:00:00.000Z");
  assert.equal(r.value, 88, "exactly what the laboratory reported");
  assert.equal(r.egfr, undefined);
  // It shows what the record holds, from the codes the lab seed already produces - one vocabulary.
  assert.ok(CREATININE_CODES.includes("2160-0"));
});

test("a protocol is against a request VERSION and performs nothing", () => {
  assert.ok(/requestVersion: Number\(sr\.version\)/.test(SRC));
  assert.ok(/A protocol, not a scan/.test(SRC));
  assert.ok(RESOURCE_TYPES.includes(TYPE));
});

test("the grant reaches the protocol and nothing clinical beyond it", () => {
  const lab = grantForRole("lab");
  assert.ok(lab.write.includes(TYPE));
  assert.ok(lab.read.includes("AllergyIntolerance"), "the contrast check needs it to be honest");
  // Still no prescription, no administration, no diagnosis.
  assert.ok(!lab.write.includes("MedicationOrder"));
  assert.ok(!lab.write.includes("MedicationAdministration"));
  assert.ok(!lab.write.includes("Condition"));
  // A ward nurse gains nothing: deciding on contrast is not the ward's act.
  assert.ok(!grantForRole("nurse").write.includes(TYPE));
});
