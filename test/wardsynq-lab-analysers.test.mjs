/* test/wardsynq-lab-analysers.test.mjs - laboratory analysers, the connector door, the bench inbox, QC, lab stock
 * and specimen rejection, through the real routes.
 *
 * Routes: GET /api/queue/ward/lab-analysers, POST /api/queue/ward/lab-analyser-save, POST /api/queue/ward/lab-connector-key,
 * GET /api/queue/lab-connector/analyser-config, POST /api/queue/lab-connector/analyser-results,
 * POST /api/queue/lab-connector/analyser-orders, GET /api/queue/ward/analyser-inbox, POST /api/queue/ward/analyser-release,
 * POST /api/queue/ward/analyser-dismiss, GET /api/queue/ward/lab-qc, POST /api/queue/ward/lab-qc-material,
 * POST /api/queue/ward/lab-qc-run, POST /api/queue/ward/lab-qc-action, GET /api/queue/ward/specimen-rejections,
 * POST /api/queue/ward/specimen-outcome (rejectionCode), POST /api/queue/ward/verify-result (qcOverrideReason),
 * GET /api/queue/ward/stock and POST /api/queue/ward/stock-move at the Laboratory location.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-lab-analysers.test.mjs
 */
import { as, seed, docs, H, T, ORG_ID, OTHER, ADMIN, NURSE, HR, DOCTOR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { westgard, blocksFrom } = await import("../functions/_wardsynq/lab-qc.js");
const { parseConnectorKey, analyserFrom } = await import("../functions/_wardsynq/lab-analysers.js");

const LAB = "lab@example.test", LAB2 = "lab2@example.test";
const sanitize = (x) => String(x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);

function hospital(cfg) {
  seed(cfg);
  for (const email of [LAB, LAB2]) docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role: "lab", active: true }, updateTime: "t1" });
}
const ANALYSER = { name: "Chemistry 1", ref: "chem1", protocol: "astm", transport: "tcp-server", port: 5000, hostQuery: true,
  testMap: [{ instrumentCode: "K", testName: "Potassium", unit: "mmol/L", orderedAs: "Renal profile" }, { instrumentCode: "NA", testName: "Sodium", unit: "mmol/L", orderedAs: "Renal profile" }] };
const connector = (key, path, method, body) => as(null, "/lab-connector/" + path, method, body, { Authorization: "Bearer " + key });
const records = (type) => H.RECORD._rows.filter((r) => r.tenantId === T && r.resourceType === type);

/** Admin registers the analyser and issues the key; a doctor orders, a nurse collects. */
async function ready(cfg) {
  hospital(cfg);
  const saved = await as(ADMIN, "/ward/lab-analyser-save", "POST", { orgId: ORG_ID, analyser: ANALYSER });
  assert.equal(saved.__status, 200, saved.__text);
  const k = await as(ADMIN, "/ward/lab-connector-key", "POST", { orgId: ORG_ID });
  assert.equal(k.__status, 200, k.__text);
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Analyser Patient", mobile: "9876500901", gender: "male", ageYears: 50 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: "1" });
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG_ID, encounterId: adm.encounterId, code: "Renal profile", category: "laboratory" });
  assert.equal(sr.__status, 200, sr.__text);
  const col = await as(NURSE, "/ward/collect", "POST", { orgId: ORG_ID, serviceRequestId: sr.orderId, specimenType: "Serum" });
  assert.equal(col.__status, 200, col.__text);
  return { key: k.key, analyserId: saved.analyser.id, sr: sr.orderId, patientId: adm.patientId, accession: col.accessionNumber, specimenId: col.specimenId };
}
const resultsBody = (w, over) => ({ analyserId: w.analyserId, messageId: "msg-" + "a".repeat(20), protocol: "astm", specimenId: w.accession, observedAt: "2026-09-16T08:00:00Z",
  results: [{ instrumentCode: "K", value: "4.1", unit: "mmol/L", referenceRange: "3.5-5.1", flags: "N", status: "final" }, { instrumentCode: "NA", value: "139", unit: null, referenceRange: "135 to 145", flags: null, status: "final" }], ...(over || {}) });

/* ---- pure ------------------------------------------------------------------------------------------------ */

test("Westgard: each rule on its own pattern, 1-2s a warning, and every rule checked on every point", () => {
  const at = "2026-09-16T08:00:00Z", pt = (z, level) => ({ z, level: level || "1", at });
  assert.deepEqual(westgard([], pt(0.5)), { status: "accepted", rules: [] });
  assert.deepEqual(westgard([], pt(2.4)), { status: "warning", rules: ["1-2s"] });
  assert.deepEqual(westgard([], pt(-3.2)), { status: "rejected", rules: ["1-2s", "1-3s"] });
  assert.ok(westgard([pt(2.2)], pt(2.5)).rules.includes("2-2s"));
  assert.ok(!westgard([pt(-2.2)], pt(2.5)).rules.includes("2-2s"), "opposite sides are not 2-2s");
  assert.ok(westgard([pt(-2.3, "2")], pt(2.4, "1")).rules.includes("R-4s"));
  assert.ok(!westgard([{ z: -2.3, level: "2", at: "2026-09-15T01:00:00Z" }], pt(2.4, "1")).rules.includes("R-4s"), "R-4s is within a run, not across days");
  const r41 = westgard([pt(1.2), pt(1.5), pt(1.1)], pt(1.3));
  assert.equal(r41.status, "rejected"); assert.deepEqual(r41.rules, ["4-1s"], "a drift with no point past 2 SD is still caught");
  const r10 = westgard(Array.from({ length: 9 }, () => pt(0.4)), pt(0.3));
  assert.deepEqual(r10.rules, ["10x"]);
  assert.equal(westgard(Array.from({ length: 9 }, () => pt(0.4)), pt(-0.3)).status, "accepted");
});

test("blocks: a rejected run blocks its analyser and test until a later corrective action", () => {
  const run = (id, test, status, recordedAt) => ({ id, analyserId: "an-1", test, evaluation: { status, rules: status === "rejected" ? ["1-3s"] : [] }, recordedAt });
  const runs = [run("r1", "Potassium", "rejected", "2026-09-16T08:00:00Z"), run("r2", "Sodium", "accepted", "2026-09-16T08:01:00Z")];
  assert.deepEqual(blocksFrom(runs, []).map((b) => b.runId), ["r1"]);
  assert.deepEqual(blocksFrom(runs, [{ analyserId: "an-1", test: "potassium", recordedAt: "2026-09-16T09:00:00Z" }]), []);
  assert.equal(blocksFrom([...runs, run("r3", "Potassium", "rejected", "2026-09-16T10:00:00Z")], [{ analyserId: "an-1", test: "Potassium", recordedAt: "2026-09-16T09:00:00Z" }])[0].runId, "r3", "a new rejection after the action blocks again");
});

test("the register and the key format refuse what could never work", () => {
  assert.equal(analyserFrom({ ...ANALYSER, protocol: "serial" }).error.error, "bad_protocol");
  assert.equal(analyserFrom({ ...ANALYSER, transport: "tcp-client", host: "" }).error.error, "host_required");
  assert.equal(analyserFrom({ ...ANALYSER, testMap: [{ instrumentCode: "K|1", testName: "Potassium" }] }).error.error, "bad_mapping");
  assert.equal(analyserFrom({ ...ANALYSER, testMap: [{ instrumentCode: "K", testName: "A" }, { instrumentCode: "k", testName: "B" }] }).error.error, "duplicate_code");
  assert.equal(parseConnectorKey("wsqlab.b3JnLXdzcQ." + "x".repeat(43)).orgId, "org-wsq");
  assert.equal(parseConnectorKey("Bearer nonsense"), null);
});

/* ---- Admin ------------------------------------------------------------------------------------------------- */

test("Admin register: no session 401, nurse and hr 403 with nothing written, another hospital's admin refused, admin saves and the key is shown once", async () => {
  hospital();
  assert.equal((await as(null, "/ward/lab-analysers?orgId=" + ORG_ID)).__status, 401);
  for (const who of [NURSE, HR, LAB]) {
    const before = writesNow();
    const r = await as(who, "/ward/lab-analyser-save", "POST", { orgId: ORG_ID, analyser: ANALYSER });
    assert.equal(r.__status, 403, who + " " + r.__text);
    assert.equal(writesNow(), before, "nothing written for " + who);
  }
  const other = await as(OTHER_ADMIN, "/ward/lab-connector-key", "POST", { orgId: ORG_ID });
  assert.ok(other.__status === 403 || other.__status === 404, other.__text);
  assert.equal(records("_wardsynq_lab_connector").length, 0);

  const list0 = await as(ADMIN, "/ward/lab-analysers?orgId=" + ORG_ID);
  assert.equal(list0.connector.issued, false, "not connected is said plainly");
  const saved = await as(ADMIN, "/ward/lab-analyser-save", "POST", { orgId: ORG_ID, analyser: ANALYSER });
  assert.equal(saved.analyser.id, "an-chem1");
  const k = await as(ADMIN, "/ward/lab-connector-key", "POST", { orgId: ORG_ID });
  assert.match(k.key, /^wsqlab\./);
  const list = await as(ADMIN, "/ward/lab-analysers?orgId=" + ORG_ID);
  assert.equal(list.connector.issued, true);
  assert.ok(!list.__text.includes(k.key.split(".")[2]), "the secret is never returned again");
  assert.ok(!JSON.stringify(H.RECORD._rows).includes(k.key.split(".")[2]), "and never stored in the clear");
  assert.ok(H.RECORD.audit.some((a) => a.action === "lab.connector.key.issue"));
});

/* ---- the connector door --------------------------------------------------------------------------------------- */

test("connector door: no key, a wrong secret, another hospital's name and a revoked key are all 401; config carries no mapping", async () => {
  const w = await ready();
  assert.equal((await as(null, "/lab-connector/analyser-config")).__status, 401);
  const [p, org] = w.key.split(".");
  assert.equal((await connector(`${p}.${org}.${"y".repeat(43)}`, "analyser-config")).__status, 401);
  const otherOrg = Buffer.from(OTHER).toString("base64url");
  assert.equal((await connector(`${p}.${otherOrg}.${w.key.split(".")[2]}`, "analyser-config")).__status, 401);
  const cfg = await connector(w.key, "analyser-config");
  assert.equal(cfg.__status, 200, cfg.__text);
  assert.deepEqual(cfg.analysers.map((a) => [a.id, a.protocol, a.port, a.hostQuery]), [["an-chem1", "astm", 5000, true]]);
  assert.ok(!cfg.__text.includes("Potassium"), "the mapping stays on the server");
  await as(ADMIN, "/ward/lab-connector-key", "POST", { orgId: ORG_ID, revoke: true });
  assert.equal((await connector(w.key, "analyser-config")).__status, 401);
});

test("results: land in the bench inbox, never on the chart; a duplicate, an unmatched tube, an unknown analyser and a bad body are each answered", async () => {
  const w = await ready();
  const bad = await connector(w.key, "analyser-results", "POST", { analyserId: w.analyserId, results: [] });
  assert.equal(bad.__status, 422);
  assert.equal((await connector(w.key, "analyser-results", "POST", resultsBody(w, { analyserId: "an-nope" }))).__status, 409);

  const r = await connector(w.key, "analyser-results", "POST", resultsBody(w));
  assert.equal(r.__status, 200, r.__text); assert.equal(r.outcome, "queued");
  assert.equal(records("DiagnosticReport").length, 0, "nothing reaches the chart from the connector");
  assert.equal(records("Observation").length, 0);
  assert.equal((await connector(w.key, "analyser-results", "POST", resultsBody(w))).outcome, "duplicate");
  const un = await connector(w.key, "analyser-results", "POST", resultsBody(w, { messageId: "msg-" + "b".repeat(20), specimenId: "ACC-NOTOURS" }));
  assert.equal(un.outcome, "unmatched");
  const audit = H.RECORD.audit.filter((a) => a.action === "lab.analyser.result.receive");
  assert.equal(audit.length, 2);
  assert.ok(!JSON.stringify(audit).includes("4.1"), "no value in the audit");
});

test("bench inbox: nurse and another hospital refused; lab releases as themselves, autoverification rules apply, critical check runs", async () => {
  const w = await ready({ labVerification: { mode: "second-person" } });
  await connector(w.key, "analyser-results", "POST", resultsBody(w, { results: [{ instrumentCode: "K", value: "7.4", unit: "mmol/L", referenceRange: "3.5-5.1", flags: "HH", status: "final" }] }));
  assert.equal((await as(null, "/ward/analyser-inbox?orgId=" + ORG_ID)).__status, 401);
  assert.equal((await as(NURSE, "/ward/analyser-inbox?orgId=" + ORG_ID)).__status, 403);
  assert.ok([403, 404].includes((await as(OTHER_ADMIN, "/ward/analyser-inbox?orgId=" + ORG_ID)).__status));
  const inbox = await as(LAB, "/ward/analyser-inbox?orgId=" + ORG_ID);
  assert.equal(inbox.__status, 200, inbox.__text);
  const row = inbox.rows[0];
  assert.equal(row.patientId, w.patientId); assert.equal(row.serviceRequestId, w.sr); assert.deepEqual(row.qcBlocked, []);

  const nurseTry = await as(NURSE, "/ward/analyser-release", "POST", { orgId: ORG_ID, inboxId: row.id, expectedVersion: row.version });
  assert.equal(nurseTry.__status, 403); assert.equal(records("DiagnosticReport").length, 0);

  const rel = await as(LAB, "/ward/analyser-release", "POST", { orgId: ORG_ID, inboxId: row.id, expectedVersion: row.version });
  assert.equal(rel.__status, 200, rel.__text);
  assert.equal(rel.status, "preliminary", "second-person mode: not autoverified, so it waits for another person");
  assert.equal(rel.awaitingVerification, true);
  assert.equal(rel.critical, true, "the analyser's HH flag is the laboratory's critical flag");
  assert.ok(rel.criticalCheck, "the critical check ran after the release");
  const report = records("DiagnosticReport").pop().body;
  assert.equal(report.analyserId, w.analyserId); assert.deepEqual(report.analyserTests, ["Potassium"]);
  assert.equal(report.releasedBy, idFor(LAB));
  assert.equal((await as(LAB, "/ward/analyser-inbox?orgId=" + ORG_ID)).rows.length, 0, "released rows leave the bench");
  assert.equal((await as(LAB, "/ward/analyser-release", "POST", { orgId: ORG_ID, inboxId: row.id })).error, "not_pending");
});

test("QC: a rejected run blocks release and verification; override needs a reason and is recorded; a corrective action lifts the block", async () => {
  const w = await ready({ labVerification: { mode: "second-person" } });
  assert.equal((await as(NURSE, "/ward/lab-qc-material", "POST", { orgId: ORG_ID, material: {} })).__status, 403);
  const mat = await as(LAB, "/ward/lab-qc-material", "POST", { orgId: ORG_ID, material: { name: "Chem control", lot: "L123", level: "1", expiry: "2099-12-31", sampleId: "QC-L1", analyserId: w.analyserId, targets: [{ test: "Potassium", mean: 4, sd: 0.1, unit: "mmol/L" }] } });
  assert.equal(mat.__status, 200, mat.__text);

  // The analyser runs the control: its sample id makes it a QC run, evaluated on the server. 4.5 is +5 SD.
  const qc = await connector(w.key, "analyser-results", "POST", resultsBody(w, { messageId: "qc-" + "c".repeat(20), specimenId: "QC-L1", results: [{ instrumentCode: "K", value: "4.5", status: "final" }] }));
  assert.equal(qc.outcome, "qc", qc.__text);
  const view = await as(LAB, "/ward/lab-qc?orgId=" + ORG_ID);
  assert.equal(view.runs[0].evaluation.status, "rejected"); assert.ok(view.runs[0].evaluation.rules.includes("1-3s"));
  assert.equal(view.blocks.length, 1);

  await connector(w.key, "analyser-results", "POST", resultsBody(w, { results: [{ instrumentCode: "K", value: "4.2", unit: "mmol/L", referenceRange: "3.5-5.1", status: "final" }] }));
  const row = (await as(LAB, "/ward/analyser-inbox?orgId=" + ORG_ID)).rows[0];
  assert.equal(row.qcBlocked[0].test, "Potassium");
  const before = records("DiagnosticReport").length;
  const blocked = await as(LAB, "/ward/analyser-release", "POST", { orgId: ORG_ID, inboxId: row.id });
  assert.equal(blocked.__status, 409); assert.equal(blocked.error, "qc_blocked");
  assert.equal(records("DiagnosticReport").length, before, "nothing released while blocked");
  const overridden = await as(LAB, "/ward/analyser-release", "POST", { orgId: ORG_ID, inboxId: row.id, qcOverrideReason: "Repeat QC in range, supervisor agreed" });
  assert.equal(overridden.__status, 200, overridden.__text);
  assert.ok(overridden.overrideId);
  assert.ok(H.RECORD.audit.some((a) => a.action === "lab.qc.override"));
  assert.equal((await as(LAB, "/ward/lab-qc?orgId=" + ORG_ID)).overrides.length, 1, "the override is listed on the QC screen");

  // Verifying (a second person) is held by the same block.
  const v = await as(LAB2, "/ward/verify-result", "POST", { orgId: ORG_ID, reportId: overridden.reportId, decision: "verify" });
  assert.equal(v.__status, 409); assert.equal(v.error, "qc_blocked");

  // The corrective action: too short is refused; a real one lifts the block, and a second has nothing to act on.
  assert.equal((await as(LAB, "/ward/lab-qc-action", "POST", { orgId: ORG_ID, analyserId: w.analyserId, test: "Potassium", action: "fixed" })).__status, 422);
  const act = await as(LAB, "/ward/lab-qc-action", "POST", { orgId: ORG_ID, analyserId: w.analyserId, test: "Potassium", action: "Recalibrated potassium, new reagent lot, repeat QC in range" });
  assert.equal(act.__status, 200, act.__text);
  assert.equal((await as(LAB, "/ward/lab-qc?orgId=" + ORG_ID)).blocks.length, 0);
  assert.equal((await as(LAB, "/ward/lab-qc-action", "POST", { orgId: ORG_ID, analyserId: w.analyserId, test: "Potassium", action: "Recalibrated potassium again" })).error, "not_blocked");
  const v2 = await as(LAB2, "/ward/verify-result", "POST", { orgId: ORG_ID, reportId: overridden.reportId, decision: "verify" });
  assert.equal(v2.__status, 200, v2.__text);

  // A manual QC value: typed, evaluated server-side, audited.
  const manual = await as(LAB, "/ward/lab-qc-run", "POST", { orgId: ORG_ID, materialId: mat.material.id, analyserId: w.analyserId, test: "Potassium", value: "4.02" });
  assert.equal(manual.__status, 200, manual.__text); assert.equal(manual.run.evaluation.status, "accepted"); assert.equal(manual.run.source, "manual");
  assert.equal((await as(LAB, "/ward/lab-qc-run", "POST", { orgId: ORG_ID, materialId: mat.material.id, analyserId: w.analyserId, test: "Potassium", value: "high" })).__status, 422);
});

test("host query: the ordered tests come back as this analyser's own codes, and nothing for a tube the hospital does not know", async () => {
  const w = await ready();
  const q = await connector(w.key, "analyser-orders", "POST", { analyserId: w.analyserId, specimenIds: [w.accession, "ACC-UNKNOWN"] });
  assert.equal(q.__status, 200, q.__text);
  assert.deepEqual(q.orders, [{ specimenId: w.accession, priority: "routine", tests: [{ instrumentCode: "K" }, { instrumentCode: "NA" }] }]);
  assert.ok(!q.__text.includes("Analyser Patient"), "no patient name leaves for the analyser");
});

test("dismiss: a reason is required, and an unmatched tube can be taken off the bench", async () => {
  const w = await ready();
  await connector(w.key, "analyser-results", "POST", resultsBody(w, { specimenId: "ACC-NOTOURS" }));
  const row = (await as(LAB, "/ward/analyser-inbox?orgId=" + ORG_ID)).rows[0];
  assert.equal(row.state, "unmatched");
  assert.equal((await as(LAB, "/ward/analyser-release", "POST", { orgId: ORG_ID, inboxId: row.id })).error, "not_pending");
  assert.equal((await as(LAB, "/ward/analyser-dismiss", "POST", { orgId: ORG_ID, inboxId: row.id })).__status, 422);
  const d = await as(LAB, "/ward/analyser-dismiss", "POST", { orgId: ORG_ID, inboxId: row.id, reason: "Not our specimen" });
  assert.equal(d.__status, 200, d.__text);
  assert.equal((await as(LAB, "/ward/analyser-inbox?orgId=" + ORG_ID)).rows.length, 0);
});

/* ---- rejection and stock ----------------------------------------------------------------------------------------- */

test("sample rejection: a coded reason sends the order back for recollection, and the month is counted by reason and ward", async () => {
  const w = await ready();
  assert.equal((await as(LAB, "/ward/specimen-outcome", "POST", { orgId: ORG_ID, specimenId: w.specimenId, state: "failed", rejectionCode: "sticky" })).__status, 422);
  const rej = await as(LAB, "/ward/specimen-outcome", "POST", { orgId: ORG_ID, specimenId: w.specimenId, state: "failed", rejectionCode: "haemolysed" });
  assert.equal(rej.__status, 200, rej.__text);
  assert.equal(rej.failureReason, "Haemolysed"); assert.equal(rej.rejection.code, "haemolysed");
  const col = await as(NURSE, "/ward/collections?orgId=" + ORG_ID + "&patientId=" + encodeURIComponent(w.patientId));
  assert.equal(col.requests[0].collection.state, "failed", "the ward sees it needs taking again");

  const month = new Date().toISOString().slice(0, 7);
  assert.equal((await as(NURSE, "/ward/specimen-rejections?orgId=" + ORG_ID + "&month=" + month)).__status, 403);
  const stats = await as(LAB, "/ward/specimen-rejections?orgId=" + ORG_ID + "&month=" + month);
  assert.equal(stats.__status, 200, stats.__text);
  assert.equal(stats.rejected, 1); assert.deepEqual(stats.byReason, { haemolysed: 1 });
  assert.deepEqual(stats.byWard, [{ ward: "Medical A", total: 1, byReason: { haemolysed: 1 } }]);
  assert.ok(!stats.__text.includes(w.patientId), "counts only");
  assert.equal((await as(ADMIN, "/ward/specimen-rejections?orgId=" + ORG_ID + "&month=2026-13")).__status, 422);
});

test("lab stock: the laboratory counts its reagents at the Laboratory location on the shared ledger, and cannot touch pharmacy stock", async () => {
  hospital();
  const before = writesNow();
  const pharm = await as(LAB, "/ward/stock-move", "POST", { orgId: ORG_ID, kind: "receipt", code: "Amoxicillin", quantity: { value: 10, unit: "tablet" }, location: "Main" });
  assert.equal(pharm.__status, 403); assert.equal(writesNow(), before);
  assert.equal((await as(LAB, "/ward/stock?orgId=" + ORG_ID)).__status, 403, "no location is not the laboratory's");
  const rec = await as(LAB, "/ward/stock-move", "POST", { orgId: ORG_ID, kind: "receipt", code: "Glucose reagent", quantity: { value: 4, unit: "kit" }, location: "Laboratory", batch: "GL-77", expiry: "2026-10-01" });
  assert.equal(rec.__status, 200, rec.__text);
  assert.equal(rec.movement.location, "Laboratory");
  const lv = await as(LAB, "/ward/stock?orgId=" + ORG_ID + "&location=Laboratory");
  assert.equal(lv.__status, 200, lv.__text);
  assert.deepEqual(lv.levels.map((l) => [l.code, l.level, l.unit]), [["Glucose reagent", 4, "kit"]]);
  assert.equal(lv.expiring[0].batch, "GL-77");
  assert.equal((await as(null, "/ward/stock?orgId=" + ORG_ID + "&location=Laboratory")).__status, 401);
});
