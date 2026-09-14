/* Negative authorization for every S3 P0 route (PUSH-04, PUSH-05):
 *   GET  /api/push/notice/<nid>            no session 401; non-recipient, other hospital, wrong role, unknown nid 404 (design 3.4: an nid confirms nothing)
 *                                          another workplace (?orgId=) or none 404 before the loop is read, no read-log row
 *   POST /api/push/notice/<nid>/decline    no session 401; non-recipient 404 and nothing written
 *   POST /api/push/wardsynq-receipt        v2 notice: no session 401; non-recipient 404 and nothing written
 *   POST /api/push/register-member         no session 401; wrong role 403 and nothing bound; other hospital 403 and nothing bound
 *   GET  /api/queue/ward/alert-status      no session 401; wrong role 403; other hospital 403
 *   POST /api/queue/ops/tick-all           covered in wardsynq-alert-dispatch.test.mjs (401, 403 nothing written)
 * plus the positive case for each, so a refusal is never a broken harness.
 *
 * node --test --experimental-test-module-mocks test/neg-auth-push-notice.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  H, KV, docs, seedHospital, as, pushAs, admittedPatient, registerDevice, releasePotassium, loopOf, staffToken, idFor,
  ORG, OTHER_ORG, DOCTOR, NURSE, LAB, ADMIN, OFFDUTY, OTHER_DOCTOR, PATIENT_NAME, WARD, BED,
} from "./_wardsynq-alert-harness.mjs";

const T = "tenant-wsq";
const IN_ORG = "?orgId=" + ORG;
const whoKeys = () => [...KV.current.m.keys()].filter((k) => k.startsWith("push:who:"));

async function openNotice() {
  seedHospital({ alerts: { push: { enabled: true } } });
  const p = await admittedPatient();
  await registerDevice(DOCTOR, "p".repeat(64));
  const loop = await loopOf(await releasePotassium(p, 7.2));
  return { p, loop, nid: loop.notifications[0].nid };
}

test("PUSH-04: GET /api/push/notice/<nid> answers the addressee only, audits the read, and 404s everyone else", async () => {
  const { p, loop, nid } = await openNotice();
  assert.equal((await pushAs(null, "/notice/" + nid + IN_ORG)).__status, 401, "no session");
  assert.equal((await pushAs(OFFDUTY, "/notice/" + nid + IN_ORG)).__status, 404, "a member of the hospital it was not sent to");
  assert.equal((await pushAs(OTHER_DOCTOR, "/notice/" + nid + IN_ORG)).__status, 404, "another hospital's doctor");
  assert.equal((await pushAs(LAB, "/notice/" + nid + IN_ORG)).__status, 404, "a role that cannot read the chart");
  assert.equal((await pushAs(DOCTOR, "/notice/" + "0".repeat(32) + IN_ORG)).__status, 404, "an unknown nid");
  const otherStaff = await staffToken(OTHER_ORG, "nurse9");
  assert.equal((await pushAs(null, "/notice/" + nid + IN_ORG, "GET", null, { "X-Staff-Token": otherStaff })).__status, 404, "another hospital's staff session");
  const readsBefore = (await H.RECORD.latestByType(T, "ClinicalRead", 50)).length;
  assert.equal(readsBefore, 0, "a refused read logged nothing");

  const ok = await pushAs(DOCTOR, "/notice/" + nid + IN_ORG);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.notice.patient.name, PATIENT_NAME);
  assert.equal(ok.notice.patient.mrn, p.mrn);
  assert.equal(ok.notice.location.ward, WARD); assert.equal(ok.notice.location.bed, BED);
  assert.equal(ok.notice.result.value, 7.2);
  assert.equal(ok.notice.orgId, ORG, "the app checks the hospital before opening anything");
  assert.equal(ok.notice.acknowledge.route, "/api/queue/ward/acknowledge");
  const reads = await H.RECORD.latestByType(T, "ClinicalRead", 50);
  assert.equal(reads.length, 1, "every detail read writes a read-log row");
  assert.equal(reads[0].valueId, loop.id);
  assert.equal(reads[0].by, idFor(DOCTOR));
});

test("S3 P1 follow-up: GET /api/push/notice/<nid> in another workplace is 404 before the loop is read, and logs no read", async () => {
  const { nid } = await openNotice();
  // The doctor also belongs to the other hospital, so only the workplace can refuse this.
  docs.set(`q_members/${OTHER_ORG}__${idFor(DOCTOR).replace(/[^A-Za-z0-9_-]/g, "-")}`, { fields: { orgId: OTHER_ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
  const loopReads = [];
  const latest = H.RECORD.latest.bind(H.RECORD);
  H.RECORD.latest = (t, type, id) => { if (type === "CriticalResultLoop") loopReads.push(id); return latest(t, type, id); };
  try {
    assert.equal((await pushAs(null, "/notice/" + nid + "?orgId=" + OTHER_ORG)).__status, 401, "no session is still 401");
    const other = await pushAs(DOCTOR, "/notice/" + nid + "?orgId=" + OTHER_ORG);
    assert.equal(other.__status, 404, JSON.stringify(other));
    assert.equal(other.notice, undefined);
    assert.equal((await pushAs(DOCTOR, "/notice/" + nid)).__status, 404, "no workplace named");
    assert.equal((await pushAs(DOCTOR, "/notice/" + nid + "?orgId=")).__status, 404, "an empty workplace");
    assert.deepEqual(loopReads, [], "the loop was never read for a refused workplace");
    assert.equal((await H.RECORD.latestByType(T, "ClinicalRead", 50)).length, 0, "no read-log row");
    assert.equal(H.RECORD.audit.filter((e) => e.action === "record.read" && e.scope && e.scope.via === "push-notice").length, 0, "no audit row");

    const ok = await pushAs(DOCTOR, "/notice/" + nid + IN_ORG);
    assert.equal(ok.__status, 200, JSON.stringify(ok));
    assert.equal(ok.notice.orgId, ORG);
    assert.equal((await H.RECORD.latestByType(T, "ClinicalRead", 50)).length, 1, "the workplace that matches reads, and logs it");
  } finally { H.RECORD.latest = latest; }
});

test("PUSH-05: a receipt or a decline from anyone the notice was not addressed to is refused and writes nothing", async () => {
  const { loop, nid } = await openNotice();
  const v = (await H.RECORD.latest(T, "CriticalResultLoop", loop.id)).version;
  assert.equal((await pushAs(null, "/wardsynq-receipt", "POST", { noticeId: nid, kind: "delivered" })).__status, 401);
  assert.equal((await pushAs(OFFDUTY, "/wardsynq-receipt", "POST", { noticeId: nid, kind: "delivered" })).__status, 404);
  assert.equal((await pushAs(OTHER_DOCTOR, "/wardsynq-receipt", "POST", { noticeId: nid, kind: "viewed" })).__status, 404);
  assert.equal((await pushAs(null, "/notice/" + nid + "/decline", "POST", {})).__status, 401);
  assert.equal((await pushAs(OFFDUTY, "/notice/" + nid + "/decline", "POST", {})).__status, 404);
  assert.equal((await pushAs(OTHER_DOCTOR, "/notice/" + nid + "/decline", "POST", {})).__status, 404);
  assert.equal((await H.RECORD.latest(T, "CriticalResultLoop", loop.id)).version, v, "nothing written by a refusal");

  const ack = await pushAs(DOCTOR, "/wardsynq-receipt", "POST", { noticeId: nid, kind: "acknowledged" });
  assert.equal(ack.__status, 400, "acknowledging is the clinical act at /ward/acknowledge, never a receipt");
  const r = await pushAs(DOCTOR, "/wardsynq-receipt", "POST", { noticeId: nid, kind: "delivered", device: "iPhone" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  const again = await pushAs(DOCTOR, "/wardsynq-receipt", "POST", { noticeId: nid, kind: "delivered" });
  assert.equal(again.duplicate, true);
  const n = (await H.RECORD.latest(T, "CriticalResultLoop", loop.id)).notifications[0];
  assert.deepEqual(n.receipts.map((x) => [x.kind, x.by]), [["delivered", ORG + "~" + idFor(DOCTOR)]]);
});

test("POST /api/push/register-member: identity from the credential only; wrong role and other hospital bind nothing", async () => {
  seedHospital({ alerts: { push: { enabled: true } } });
  assert.equal((await pushAs(null, "/register-member", "POST", { orgId: ORG, token: "q".repeat(64), platform: "ios" })).__status, 401);
  assert.equal((await pushAs(LAB, "/register-member", "POST", { orgId: ORG, token: "q".repeat(64), platform: "ios" })).__status, 403, "a role that cannot read the chart");
  assert.equal((await pushAs(OTHER_DOCTOR, "/register-member", "POST", { orgId: ORG, token: "q".repeat(64), platform: "ios" })).__status, 403, "not a member of this hospital");
  const otherStaff = await staffToken(OTHER_ORG, "nurse9");
  assert.equal((await pushAs(null, "/register-member", "POST", { orgId: ORG, token: "q".repeat(64), platform: "ios" }, { "X-Staff-Token": otherStaff })).__status, 403, "a staff session for another hospital");
  assert.deepEqual(whoKeys(), [], "nothing bound by any refusal");

  const ok = await pushAs(NURSE, "/register-member", "POST", { orgId: ORG, token: "q".repeat(64), platform: "ios", identity: "someone-else" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.identity, idFor(NURSE), "a body identity is ignored");
  assert.deepEqual(whoKeys(), ["push:who:" + ORG + "~" + idFor(NURSE)]);
});

test("GET /api/queue/ward/alert-status: staff.admin only, this hospital only", async () => {
  seedHospital({ alerts: { push: { enabled: true } } });
  assert.equal((await as(null, "/ward/alert-status?orgId=" + ORG)).__status, 401);
  assert.equal((await as(NURSE, "/ward/alert-status?orgId=" + ORG)).__status, 403);
  assert.equal((await as(OTHER_DOCTOR, "/ward/alert-status?orgId=" + ORG)).__status, 403);
  const ok = await as(ADMIN, "/ward/alert-status?orgId=" + ORG);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.levels.approval.approvedBy, "Dr Manoj Kurmana");
  assert.equal(ok.levels.approval.approvedOn, "2026-09-14");
  assert.deepEqual(ok.levels.due.roles, ["doctor", "resident"]);
});
