/* CLIN-08 (audit B:A3): supplemental oxygen is stored as the number 1 (migrate-vitals.js), and NEWS2 only
 * counted true or "oxygen", so every patient on oxygen lost 2 points. RR 22, SpO2 93 on O2, pulse 95 is 7
 * (high), not 5 (medium). Proven on the pure scorer for every stored form, and through /ward/vitals to
 * /ward/news2.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-news2-oxygen.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, NURSE } = await import("./_wardsynq-alert-harness.mjs");
const { news2 } = await import("../wardsynq/wardsynq-deterioration.js");

const now = new Date().toISOString();
const ob = (code, value, unit) => ({ id: code, code, value, unit, category: "vital-signs", effectiveAt: now });
const obs = (o2) => [ob("9279-1", 22, "/min"), ob("59408-5", 93, "%"), ob("80288-4", o2, null), ob("8480-6", 120, "mm[Hg]"), ob("8867-4", 95, "/min"), ob("8310-5", 37, "Cel"), ob("80339-5", "A", null)];

test("every stored form of 'on oxygen' scores 2 points; every form of 'air' scores 0", () => {
  for (const on of [1, "1", true, "true", "yes", "Y", "oxygen", " on "]) {
    const s = news2({ observations: obs(on), now });
    assert.equal(s.parameters.supplementalOxygen.points, 2, `o2=${JSON.stringify(on)}`);
    assert.equal(s.total, 7, `o2=${JSON.stringify(on)}`);
    assert.equal(s.risk, "high", `o2=${JSON.stringify(on)}`);
  }
  for (const off of [0, "0", false, "no", "air"]) {
    const s = news2({ observations: obs(off), now });
    assert.equal(s.parameters.supplementalOxygen.points, 0, `o2=${JSON.stringify(off)}`);
    assert.equal(s.total, 5, `o2=${JSON.stringify(off)}`);
  }
});

test("charting oxygen on the ward scores it on NEWS2 (route to route)", async () => {
  seedHospital();
  const p = await admittedPatient();
  const v = await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: p.encounterId, patientId: p.patientId,
    vitals: { rr: 22, spo2: 93, o2: "1", sbp: 120, pulse: 95, temp: 37, acvpu: "A" }, recordedAt: new Date(Date.now() - 60000).toISOString() });
  assert.equal(v.__status, 200, JSON.stringify(v));
  const n = await as(DOCTOR, `/ward/news2?orgId=${ORG}&patientId=${p.patientId}`);
  assert.equal(n.__status, 200, JSON.stringify(n));
  assert.equal(n.score.parameters.supplementalOxygen.value, 1, "stored as the number 1");
  assert.equal(n.score.parameters.supplementalOxygen.points, 2);
  assert.equal(n.score.total, 7);
  assert.equal(n.score.risk, "high");
});
