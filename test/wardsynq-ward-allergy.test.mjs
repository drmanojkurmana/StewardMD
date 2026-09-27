/* test/wardsynq-ward-allergy.test.mjs - CLIN-05 (audit B5): the ward can record an allergy, and every
 * allergy check reads it. Before the fix only the OPD assessment wrote AllergyIntolerance, so a patient
 * admitted directly had amoxicillin prescribed with no allergy finding whatever their history.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-ward-allergy.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, H } = await import("./_wardsynq-alert-harness.mjs");

const allergy = (p, body) => as(DOCTOR, "/ward/allergy", "POST", { orgId: ORG, patientId: p.patientId, ...body });
const check = (p, drug) => as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, checkOnly: true,
  order: { patientId: p.patientId, encounterId: p.encounterId, drug, dose: { value: 500, unit: "mg" }, route: "PO", frequency: "TDS" } });

test("CLIN-05: a penicillin allergy recorded on the ward is found when amoxicillin is prescribed", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const before = await check(p, "Amoxicillin");
  assert.ok(!before.safety.findings.some((f) => /^ALLERGY/.test(f.code)), "nothing on file yet");

  const r = await allergy(p, { substance: "Penicillin", reaction: "anaphylaxis", severity: "severe" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.resolved, true);
  const rec = await H.RECORD.latest("tenant-wsq", "AllergyIntolerance", r.allergyId);
  assert.equal(rec.reaction, "anaphylaxis");
  assert.equal(rec.verifiedBy, null, "a ward entry is unverified until a doctor verifies it");

  const after = await check(p, "Amoxicillin");
  assert.ok(after.safety.findings.some((f) => /^ALLERGY/.test(f.code)), JSON.stringify(after.safety.findings));
});

test("CLIN-05: no known drug allergies is a positive record, ended by a real allergy and refused over one", async () => {
  seedHospital({});
  const p = await admittedPatient();
  const nka = await allergy(p, { noKnownAllergies: true });
  assert.equal(nka.__status, 200, JSON.stringify(nka));
  assert.equal((await H.RECORD.latest("tenant-wsq", "AllergyIntolerance", nka.allergyId)).noKnownAllergies, true);
  assert.ok(!(await check(p, "Amoxicillin")).safety.findings.some((f) => /^ALLERGY/.test(f.code)), "NKDA matches no drug");

  const neg = await allergy(p, { substance: "no penicillin allergy" });
  assert.equal(neg.__status, 422);
  assert.equal(neg.error, "substance_negated");

  const real = await allergy(p, { substance: "Sulfonamides", reaction: "rash" });
  assert.equal(real.__status, 200, JSON.stringify(real));
  assert.equal(real.nkdaRetired, true);
  const retired = await H.RECORD.latest("tenant-wsq", "AllergyIntolerance", nka.allergyId);
  assert.equal(retired.noKnownAllergies, false);
  assert.match(retired.substance, /no longer true/);

  const again = await allergy(p, { noKnownAllergies: true });
  assert.equal(again.__status, 409);
  assert.equal(again.error, "allergies_on_file");
});
