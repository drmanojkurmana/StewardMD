import { H, as, seedHospital, admittedPatient, ORG, DOCTOR, NURSE, ADMIN } from "./_wardsynq-alert-harness.mjs";
/* test/wardsynq-data-integrity-routes.test.mjs - the audit's data-integrity findings that go through the real
 * router (lane C of the 2026-09-26 audit). Each test reproduces the audit demo and fails without its fix.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-data-integrity-routes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** Makes the next `n` repository reads of `type` fail the way D1 does on a dropped connection. */
function failReads(type, n) {
  const repo = H.RECORD, real = repo.latest.bind(repo);
  let left = n || 1;
  repo.latest = async (tenantId, resourceType, id) => {
    if (left > 0 && resourceType === type) { left--; throw new Error("D1_ERROR: Network connection lost."); }
    return real(tenantId, resourceType, id);
  };
  return () => { repo.latest = real; };
}

test("DATA-03: a start-anaesthesia retried after a failed read refuses (502) and keeps the drugs already charted", async () => {
  seedHospital();
  const p = await admittedPatient();
  const book = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: p.mrn, procedure: "Appendectomy", laterality: "not-applicable", scheduledAt: "2026-09-27T05:00:00.000Z", theatre: "OT1" } });
  assert.equal(book.__status, 200, JSON.stringify(book));
  const caseId = book.caseId;
  const start = await as(DOCTOR, "/ward/anesthesia-start", "POST", { orgId: ORG, caseId, asaClass: "II", technique: "general" });
  assert.equal(start.__status, 200, JSON.stringify(start));
  const ev = await as(DOCTOR, "/ward/anesthesia-event", "POST", { orgId: ORG, caseId, event: { drug: "Propofol", dose: "150mg", route: "IV" } });
  assert.equal(ev.__status, 200, JSON.stringify(ev));

  const restore = failReads("AnesthesiaRecord", 1);
  const again = await as(DOCTOR, "/ward/anesthesia-start", "POST", { orgId: ORG, caseId, asaClass: "II", technique: "general" });
  restore();
  assert.equal(again.__status, 502, JSON.stringify(again));
  assert.equal(again.error, "record_read_failed");
  assert.equal(again.written, 0);

  const after = await as(DOCTOR, `/ward/anesthesia-get?orgId=${ORG}&caseId=${caseId}`);
  assert.deepEqual(after.record.events.map((e) => e.drug), ["Propofol"], "the charted drug survived");

  // A failed read of the anaesthesia record on GET is an error, not "no record".
  const r2 = failReads("AnesthesiaRecord", 1);
  const got = await as(DOCTOR, `/ward/anesthesia-get?orgId=${ORG}&caseId=${caseId}`);
  r2();
  assert.equal(got.__status, 502);
  assert.equal(got.record, null);

  // Booking the same case again after a failed case read refuses instead of overwriting the case.
  const r3 = failReads("SurgicalCase", 1);
  const rebook = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: p.mrn, procedure: "Appendectomy", laterality: "not-applicable", scheduledAt: "2026-09-27T05:00:00.000Z", theatre: "OT1" } });
  r3();
  assert.equal(rebook.__status, 502, JSON.stringify(rebook));
});

async function edPatient(mobile) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Patient ED", mobile, gender: "male", ageYears: 30 });
  const arrival = await as(DOCTOR, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, chiefComplaint: "chest pain", arrivedAt: new Date(Date.now() - 3600000).toISOString() } });
  assert.equal(arrival.__status, 200, JSON.stringify(arrival));
  return { mrn: reg.mrn, encounterId: arrival.encounterId };
}

test("DATA-05: a re-triage landing during an ED admission no longer leaves the patient open in the ED and in a ward bed", async () => {
  seedHospital();
  const { encounterId } = await edPatient("9876500901");
  assert.equal((await as(DOCTOR, "/ward/ed-triage", "POST", { orgId: ORG, encounterId, acuity: 2 })).__status, 200);
  const repo = H.RECORD, realAppend = repo.append.bind(repo);
  let armed = true;
  repo.append = async (tenantId, recs, ctx) => {
    const admission = recs.some((r) => r.resourceType === "Encounter" && r.id !== encounterId && r.class && r.class !== "ED");
    const out = await realAppend(tenantId, recs, ctx);
    if (armed && admission) {
      armed = false;                                   // a second nurse re-triages between the admission and the close
      const t = await as(NURSE, "/ward/ed-triage", "POST", { orgId: ORG, encounterId, acuity: 1, reason: "deteriorating, re-triaged" });
      assert.equal(t.__status, 200, JSON.stringify(t));
    }
    return out;
  };
  const disp = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId, disposition: "admitted", admission: { ward: "Ward B", bed: "5" }, idempotencyKey: "disp-key-0001" });
  repo.append = realAppend;
  assert.equal(disp.__status, 200, JSON.stringify(disp));
  const ed = await repo.latest("tenant-wsq", "Encounter", encounterId);
  assert.equal(ed.status, "finished", "the ED visit is closed");
  assert.equal(ed.acuity, 1, "and keeps the re-triage made meanwhile");
  const board = await as(DOCTOR, `/ward/ed-list?orgId=${ORG}`);
  assert.ok(!(board.patients || []).some((p) => p.encounterId === encounterId), "off the ED board");
});

test("DATA-05: a close that still fails after the admission says admitted_but_ed_not_closed, and recording it again closes it", async () => {
  seedHospital();
  const { encounterId } = await edPatient("9876500902");
  const repo = H.RECORD, realAppend = repo.append.bind(repo);
  const { VersionConflictError } = await import("../functions/_wardsynq/repository.js");
  let failClose = true;
  repo.append = async (tenantId, recs, ctx) => {
    if (failClose && recs.some((r) => r.resourceType === "Encounter" && r.id === encounterId && r.status === "finished")) { failClose = false; throw new VersionConflictError("moved", {}); }
    return realAppend(tenantId, recs, ctx);
  };
  const disp = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId, disposition: "admitted", admission: { ward: "Ward B", bed: "6" } });
  repo.append = realAppend;
  assert.equal(disp.__status, 409, JSON.stringify(disp));
  assert.equal(disp.error, "admitted_but_ed_not_closed");
  assert.ok(disp.admittedEncounterId);
  const again = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId, disposition: "admitted", admission: { ward: "Ward B", bed: "6" } });
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.equal((await repo.latest("tenant-wsq", "Encounter", encounterId)).status, "finished");
});

test("DATA-11: the same ED procedure submitted twice without a key is one procedure record", async () => {
  seedHospital();
  const { encounterId } = await edPatient("9876500777");
  const procedure = { name: "Wound closure", site: "left forearm", performedBy: "Dr Test", performedAt: new Date(Date.now() - 600000).toISOString(), notes: "5 sutures" };
  const p1 = await as(DOCTOR, "/ward/ed-procedure", "POST", { orgId: ORG, encounterId, procedure });
  const p2 = await as(DOCTOR, "/ward/ed-procedure", "POST", { orgId: ORG, encounterId, procedure });
  assert.equal(p1.__status, 200, JSON.stringify(p1));
  assert.equal(p2.__status, 200, JSON.stringify(p2));
  assert.equal(p1.procedureId, p2.procedureId);
  const rec = await as(DOCTOR, `/ward/ed-record?orgId=${ORG}&encounterId=${encounterId}`);
  assert.equal(rec.procedures.length, 1, JSON.stringify(rec.procedures));
  // A different procedure at the same time is its own record.
  await as(DOCTOR, "/ward/ed-procedure", "POST", { orgId: ORG, encounterId, procedure: { ...procedure, name: "Tetanus toxoid" } });
  assert.equal((await as(DOCTOR, `/ward/ed-record?orgId=${ORG}&encounterId=${encounterId}`)).procedures.length, 2);
});

test("DATA-06: merges stay one hop: no chain (C into B, then B into A) and no cycle (A into B after B into A)", async () => {
  seedHospital();
  const reg = async (n, m) => { const r = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: n, mobile: m, gender: "male", ageYears: 40 }); return "opd-pat-" + r.mrn.toLowerCase(); };
  const A = await reg("Ram Kumar", "9876500711"), B = await reg("Ram Kumaar", "9876500712"), C = await reg("R Kumar", "9876500713");
  const reason = "same person, verified Aadhaar at desk";
  assert.equal((await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: B, mergedId: C, reason })).__status, 200);
  const chain = await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: A, mergedId: B, reason });
  assert.equal(chain.__status, 409, JSON.stringify(chain));
  assert.equal(chain.error, "merged_has_absorbed");
  assert.deepEqual(chain.absorbed, [C]);
  const onto = await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: C, mergedId: A, reason });
  assert.equal(onto.__status, 409, JSON.stringify(onto));
  assert.equal(onto.error, "survivor_is_merged");
  // The record that absorbed C can still take A directly: one hop, every record reachable.
  assert.equal((await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: B, mergedId: A, reason })).__status, 200);
  const cycle = await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: A, mergedId: B, reason });
  assert.equal(cycle.__status, 409, JSON.stringify(cycle));
  const idB = await as(DOCTOR, `/ward/identity?orgId=${ORG}&patientId=${B}`);
  assert.deepEqual([...idB.identity.allIds].sort(), [A, B, C].sort());
  assert.equal(idB.identity.isMerged, false);
});

test("DATA-08: the downtime sheet shows the newest ward-charted vital of each kind", async () => {
  seedHospital();
  const p = await admittedPatient();
  const t0 = Date.now() - 3 * 3600000;
  for (const [i, v] of [[0, { sbp: "120", pulse: "80" }], [1, { sbp: "82", pulse: "130" }]]) {
    const r = await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: p.encounterId, patientId: p.patientId, vitals: v, recordedAt: new Date(t0 + i * 3600000).toISOString() });
    assert.equal(r.__status, 200, JSON.stringify(r));
  }
  const d = await as(DOCTOR, `/ward/downtime?orgId=${ORG}`);
  assert.equal(d.__status, 200, JSON.stringify(d));
  const page = d.patients.find((x) => x.encounterId === p.encounterId) || d.patients[0];
  assert.ok(page.lastVitals, JSON.stringify(page));
  const vals = Object.values(page.lastVitals).map((v) => String(v.value));
  assert.ok(vals.includes("82") && vals.includes("130"), "the newest reading of each: " + JSON.stringify(page.lastVitals));
  assert.ok(!vals.includes("120"));
});

test("DATA-07: a legacy import that stopped between the registration and the chart record is repaired by importing the same file again", async () => {
  seedHospital();
  const real = H.RECORD;
  let armed = true;
  H.RECORD = new Proxy(real, { get(t, k) {
    if (k === "append") return async (tenantId, recs, c) => { if (armed && recs.some((r) => r.resourceType === "Patient")) { armed = false; throw new Error("simulated failure writing Patient"); } return t.append(tenantId, recs, c); };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
  } });
  const csv = "mrn,name,mobile,gender,age\nLM-1001,Test Patient,9876543210,male,40\n";
  const mapping = { legacyMrn: 0, name: 1, mobile: 2, gender: 3, ageYears: 4 };
  const imp = (extra) => as(ADMIN, "/ward/legacy-import", "POST", { orgId: ORG, kind: "patients", csv, mapping, ...(extra || {}) });

  let r = await imp();
  r = await imp({ commit: true, confirmCount: r.counts.create, planId: r.planId });
  assert.equal(r.__status, 502, JSON.stringify(r));
  assert.equal(r.error, "import_incomplete");
  assert.equal((await real.latestByType("tenant-wsq", "Patient", 100)).length, 0, "registered, but no chart record");

  const dry = await imp();
  assert.equal(dry.__status, 200, JSON.stringify(dry));
  assert.equal(dry.counts.create, 1, "planned as a repair, not left as a duplicate: " + JSON.stringify(dry.rows));
  assert.equal(dry.counts.duplicate, 0);
  assert.match(dry.rows[0].reason, /chart record was never written/);
  const done = await imp({ commit: true, confirmCount: dry.counts.create, planId: dry.planId });
  assert.equal(done.__status, 200, JSON.stringify(done));
  const pts = await real.latestByType("tenant-wsq", "Patient", 100);
  assert.equal(pts.length, 1, "the chart record now exists");
  assert.ok((pts[0].identifiers || []).some((i) => i.system === "legacy-mrn" && i.value === "LM-1001"), "with the legacy number, the names agreeing");
  assert.equal(done.rows[0].mrn, pts[0].mrn, "no new MR number issued");

  const again = await imp();
  assert.equal(again.counts.matched, 1, "a third run finds it by its legacy number");
  assert.equal(again.counts.create, 0);
});
