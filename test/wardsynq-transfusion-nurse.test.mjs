/* Owner decision 2026-10-04: a nurse may perform the bedside transfusion check and run the transfusion
 * (transfusion.administer, granted to the nurse role), still with a second, different, authenticated checker.
 * Request, crossmatch and issue stay with emr.treat / transfusion.issue. Through the real queue routes.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-transfusion-nurse.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { as, seedHospital, admittedPatient, ORG, DOCTOR, NURSE, OFFDUTY, SUPERVISOR, LAB, idFor } = await import("./_wardsynq-alert-harness.mjs");
const { can, CAPS } = await import("../functions/_queue_roles.js");

let seq = 0;
const at = () => new Date(Date.UTC(2026, 9, 4, 1, 0, ++seq)).toISOString();
async function recordGroup(p, value) {
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: p.encounterId, code: "Blood Group", category: "laboratory" });
  await as(LAB, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: order.orderId, specimenType: "Whole blood" });
  const r = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: order.orderId, tests: [{ test: "Blood Group", value }], status: "final" });
  assert.equal(r.__status, 200, JSON.stringify(r));
}
/** A doctor requests, crossmatches and issues one O+ unit; returns the episode and a bedside-check caller. */
async function issuedEpisode(p, unitId) {
  const ep = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, patientId: p.patientId, mrn: p.mrn, encounterId: p.encounterId, component: "prbc", units: 1, at: at() });
  assert.equal(ep.__status, 200, JSON.stringify(ep));
  const xm = await as(DOCTOR, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: ep.episodeId, component: "prbc", unitId, aboGroup: "O", rhD: "positive" });
  assert.equal(xm.__status, 200, JSON.stringify(xm));
  const iss = await as(DOCTOR, "/ward/transfusion-issue", "POST", { orgId: ORG, episodeId: ep.episodeId });
  assert.equal(iss.__status, 200, JSON.stringify(iss));
  const check = (who, secondCheckerId) => as(who, "/ward/transfusion-bedside-check", "POST", { orgId: ORG, episodeId: ep.episodeId, secondCheckerId,
    scannedPatientBarcode: p.mrn, scannedUnitId: unitId, unitInHand: { unitId, aboGroup: "O", rhD: "positive", component: "prbc" } });
  return { ep, check };
}

test("roles: the nurse holds transfusion.administer and still not emr.treat or transfusion.issue; the supervisor holds none", () => {
  assert.equal(can("nurse", CAPS.TRANSFUSION_ADMINISTER), true);
  assert.equal(can("nurse", CAPS.EMR_TREAT), false);
  assert.equal(can("nurse", CAPS.TRANSFUSION_ISSUE), false);
  assert.equal(can("supervisor", CAPS.TRANSFUSION_ADMINISTER), false);
  assert.equal(can("blood_bank", CAPS.TRANSFUSION_ADMINISTER), false);
});

test("a nurse with a second nurse completes the bedside check, starts, observes and completes the transfusion", async () => {
  seedHospital();
  const p = await admittedPatient();
  await recordGroup(p, "O Positive");
  const { ep, check } = await issuedEpisode(p, "U-N1");
  const ok = await check(NURSE, idFor(OFFDUTY));
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.phase, "checked");
  assert.equal(ok.bedsideCheck.checkerId, idFor(NURSE), "the first checker is the signed-in nurse");
  assert.equal(ok.bedsideCheck.secondCheckerId, idFor(OFFDUTY));
  const started = await as(NURSE, "/ward/transfusion-start", "POST", { orgId: ORG, episodeId: ep.episodeId });
  assert.equal(started.__status, 200, JSON.stringify(started));
  assert.equal(started.phase, "transfusing");
  assert.ok(started.ledger.some((l) => l.event === "started" && l.actorId === idFor(NURSE)));
  const obs = await as(NURSE, "/ward/transfusion-observe", "POST", { orgId: ORG, episodeId: ep.episodeId, vitals: { pulse: 82, temp: 37.0 } });
  assert.equal(obs.__status, 200, JSON.stringify(obs));
  const done = await as(NURSE, "/ward/transfusion-complete", "POST", { orgId: ORG, episodeId: ep.episodeId });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal(done.phase, "completed");
});

test("a nurse with a doctor as second checker completes the check; the nurse can stop it for a reaction", async () => {
  seedHospital();
  const p = await admittedPatient();
  await recordGroup(p, "O Positive");
  const { ep, check } = await issuedEpisode(p, "U-N2");
  const ok = await check(NURSE, idFor(DOCTOR));
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.bedsideCheck.secondCheckerId, idFor(DOCTOR));
  assert.equal((await as(NURSE, "/ward/transfusion-start", "POST", { orgId: ORG, episodeId: ep.episodeId })).__status, 200);
  const stop = await as(NURSE, "/ward/transfusion-reaction", "POST", { orgId: ORG, episodeId: ep.episodeId, detail: "rigors" });
  assert.equal(stop.__status, 200, JSON.stringify(stop));
  assert.equal(stop.phase, "stopped");
});

test("one nurse cannot do both checks: their own id or their own email as second checker is refused, and nothing is written", async () => {
  seedHospital();
  const p = await admittedPatient();
  await recordGroup(p, "O Positive");
  const { ep, check } = await issuedEpisode(p, "U-N3");
  for (const second of [idFor(NURSE), NURSE, NURSE.toUpperCase()]) {
    const r = await check(NURSE, second);
    assert.equal(r.__status, 409, JSON.stringify(r));
    assert.equal(r.code, "SECOND_CHECKER_NOT_INDEPENDENT", second);
  }
  const typed = await check(NURSE, "a name typed in");
  assert.equal(typed.code, "SECOND_CHECKER_NOT_STAFF");
  const none = await check(NURSE, "");
  assert.equal(none.code, "TWO_PERSON_REQUIRED");
  // Still issued: the nurse cannot start an unchecked transfusion either.
  const start = await as(NURSE, "/ward/transfusion-start", "POST", { orgId: ORG, episodeId: ep.episodeId });
  assert.equal(start.__status, 409, JSON.stringify(start));
  assert.equal(start.code, "NOT_CHECKED");
});

test("a role without the capability is refused every bedside step; the nurse is still refused request, crossmatch and issue", async () => {
  seedHospital();
  const p = await admittedPatient();
  await recordGroup(p, "O Positive");
  const { ep, check } = await issuedEpisode(p, "U-N4");
  const sup = await check(SUPERVISOR, idFor(NURSE));
  assert.equal(sup.__status, 403, JSON.stringify(sup));
  assert.equal((await check(NURSE, idFor(DOCTOR))).__status, 200);
  assert.equal((await as(SUPERVISOR, "/ward/transfusion-start", "POST", { orgId: ORG, episodeId: ep.episodeId })).__status, 403);
  assert.equal((await as(LAB, "/ward/transfusion-start", "POST", { orgId: ORG, episodeId: ep.episodeId })).__status, 403);

  const req = await as(NURSE, "/ward/transfusion-request", "POST", { orgId: ORG, patientId: p.patientId, mrn: p.mrn, encounterId: p.encounterId, component: "prbc", units: 1, at: at() });
  assert.equal(req.__status, 403, JSON.stringify(req));
  const ep2 = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, patientId: p.patientId, mrn: p.mrn, encounterId: p.encounterId, component: "prbc", units: 1, at: at() });
  const xm = await as(NURSE, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: ep2.episodeId, component: "prbc", unitId: "U-N5", aboGroup: "O", rhD: "positive" });
  assert.equal(xm.__status, 403, JSON.stringify(xm));
  assert.equal((await as(DOCTOR, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: ep2.episodeId, component: "prbc", unitId: "U-N5", aboGroup: "O", rhD: "positive" })).__status, 200);
  const iss = await as(NURSE, "/ward/transfusion-issue", "POST", { orgId: ORG, episodeId: ep2.episodeId });
  assert.equal(iss.__status, 403, JSON.stringify(iss));
});
