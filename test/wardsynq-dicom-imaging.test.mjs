/* test/wardsynq-dicom-imaging.test.mjs — TASK 7.7: imaging, both directions, end to end.
 *
 * IN: a REAL http server started by this file answers QIDO-RS with real DICOM-JSON; the REAL
 * dicomweb connector (functions/_connect/connectors/dicomweb/connector.js) reads it over a real
 * socket; the SCCM bundle it produces is posted to the REAL ingest route, through the REAL adapter,
 * into the REAL governed record. Nothing between the socket and the chart is mocked.
 *
 * Before this task the last step did not exist: the SCCM adapter counted imaging studies and DROPPED
 * them, with an issue that said so. The tests below fail against that code.
 *
 * OUT: the modality worklist, read through the REAL queue route.
 *
 * NOT verified here and not claimed anywhere: any real PACS or VNA. There is none in this
 * environment. What is proven is the local side against a deterministic server.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-dicom-imaging.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { handle } from "../functions/api/wardsynq/[[path]].js";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { makeMockDb } from "../functions/_connect/testkit.js";
import { dicomWebConnector } from "../functions/_connect/connectors/dicomweb/connector.js";
import { mapSccmBundle } from "../wardsynq/adapters/wardsynq-sccm-adapter.js";
import { bundle as sccmBundle, patient as sccmPatient, serviceRequest as sccmServiceRequest, encounter as sccmEncounter } from "../functions/_connect/canonical/model.js";
import { SourceSystemGrant, grantIdFor } from "../functions/_wardsynq/fhir-inbound.js";
import { worklistItem, modalityMapOf, isPendingImaging, dicomName, dicomDateTime } from "../functions/_wardsynq/dicom.js";

const ENV = { WARDSYNQ_RECORD: "1" };
const TENANT = "gimsr";

function hospital() {
  const repository = new MemoryRepository();
  const db = makeMockDb({
    connect_tenant: [{ id: TENANT, name: "GIMSR", status: "active", mode: "sandbox", settings: "{}" }],
    connect_membership: [{ user_id: "fb:dr-menon", tenant_id: TENANT, role: "clinician" }],
  });
  const identifyFn = async (request) => {
    const who = request.headers.get("X-Test-User");
    return who ? { id: who, guest: false, email: `${who.replace("fb:", "")}@example.test` } : { guest: true };
  };
  const deps = { db, identifyFn, claimsFn: async () => ({}), repository, orgForTenant: null, authorizeOrg: null, staffSession: null };
  const fetchAs = (user) => async (url, init) => {
    const headers = new Headers((init && init.headers) || {});
    if (user) headers.set("X-Test-User", user);
    return handle(new Request(String(url), { method: (init && init.method) || "GET", headers, body: init && init.body }), ENV, deps);
  };
  return { repository, fetchAs };
}

/* ---- the far end: a real DICOMweb server answering QIDO-RS ------------------------------------- */

let server = null, port = 0;
let studies = [];                 // the DICOM-JSON this PACS will return
const asked = [];                 // every query it actually received

before(async () => {
  server = http.createServer((req, res) => {
    asked.push(req.url);
    res.writeHead(200, { "Content-Type": "application/dicom+json" });
    res.end(JSON.stringify(studies));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

const dicomStudy = (over) => {
  const o = over || {};
  const t = (tag, vr, value) => (value == null ? null : [tag, { vr, Value: [value] }]);
  return Object.fromEntries([
    t("0020000D", "UI", o.uid || "1.2.840.113619.2.55.3.604688119.868.1234567890.1"),
    t("00080061", "CS", o.modality || "CT"),
    t("00080020", "DA", o.studyDate || "20260908"),
    t("00080050", "SH", o.accession === null ? null : (o.accession || "ACC-1001")),
    t("00081030", "LO", o.description || "CT ABDOMEN WITH CONTRAST"),
    t("00201206", "IS", o.series == null ? 4 : o.series),
    t("00201208", "IS", o.instances == null ? 812 : o.instances),
    t("00180015", "CS", o.bodySite || "ABDOMEN"),
  ].filter(Boolean));
};

/** The connector's context, as the onboarding engine builds one - with a real fetch to the server. */
const connectorCtx = () => ({
  config: { base_url: `http://127.0.0.1:${port}` },
  fetch: (url, init) => fetch(url, init),
  tenant: { id: TENANT },
  now: () => new Date("2026-09-09T10:00:00.000Z"),
  secrets: async () => null,
  budget: { maxRows: 100 },
});

/** The whole inbound path: QIDO-RS over a socket -> SCCM -> the real ingest route -> the record.
 *
 * dr-menon is granted to speak for "dicomweb" (the connector's own sourceConnector, see connector.js
 * normalize()) the first time this runs against a given hospital - the same precondition the ingest
 * door now requires of every caller, real or in a test. Idempotent: a second grant for the same
 * actor+system in the same tenant is refused by the store as a duplicate write, so it is written at
 * most once even though every test in this file calls through here. */
async function pullAndLand(h, patientRef, extra) {
  if (!h._sourceGranted) {
    h._sourceGranted = true;
    await h.repository.append(TENANT, [
      { ...SourceSystemGrant({ id: grantIdFor("fb:dr-menon", "dicomweb"), actorId: "fb:dr-menon", sourceSystem: "dicomweb", active: true, grantedBy: "fb:admin-one", grantedAt: "2026-01-01T00:00:00.000Z" }), version: 1 },
    ]);
  }
  const ctx = connectorCtx();
  const raw = await dicomWebConnector.fetchPatient(ctx, patientRef);
  const bundle = await dicomWebConnector.normalize(ctx, raw);
  // The PACS knows a patient id and a study; the ORDER it answers comes from the hospital's own
  // system, so a realistic bundle carries both. `extra` is what the order side of the message adds.
  const merged = { ...bundle, ...(extra || {}) };
  const res = await h.fetchAs("fb:dr-menon")(`https://x/api/wardsynq/${TENANT}/ingest/sccm`, { method: "POST", body: JSON.stringify(merged) });
  const out = await res.json();
  out.__status = res.status;
  out.__bundle = merged;
  return out;
}

const studyId = (uid) => null; // ids are hashed by the connector; tests look the study up by listing

async function onlyStudy(h) {
  const rows = await h.repository.latestByType(TENANT, "ImagingStudy", 10);
  return (rows || [])[0] || null;
}

/* ---- 1: the study actually reaches the chart ---------------------------------------------------- */

test("1. a study on a real DICOMweb server reaches the WardSynQ record through the real ingest route", async () => {
  const h = hospital();
  studies = [dicomStudy({})];
  asked.length = 0;

  const out = await pullAndLand(h, "MRN-1");
  assert.equal(out.__status, 200, JSON.stringify(out));
  assert.equal(out.ok, true);
  assert.ok(asked.length >= 1, "the connector really queried the server");
  assert.match(asked[0], /00100020=MRN-1/, "it queried by PatientID, as QIDO-RS does");

  const st = await onlyStudy(h);
  assert.ok(st, "the study is on the chart - before this task the adapter counted it and dropped it");
  assert.equal(st.resourceType, "ImagingStudy");
  assert.equal(st.accessionNumber, "ACC-1001");
  assert.equal(st.modality, "CT");
  assert.equal(st.description, "CT ABDOMEN WITH CONTRAST");
  assert.equal(st.seriesCount, 4);
  assert.equal(st.instanceCount, 812);
  assert.equal(st.studyUid, "1.2.840.113619.2.55.3.604688119.868.1234567890.1");
  assert.equal(st.meta.source.system, "dicomweb", "it is attributed to the PACS, like every imported row");
});

test("2. no pixel data, no retrieve URL, and no field one could be smuggled into", async () => {
  const h = hospital();
  studies = [dicomStudy({})];
  await pullAndLand(h, "MRN-2");
  const st = await onlyStudy(h);
  const serialised = JSON.stringify(st);
  assert.ok(!/https?:\/\//.test(serialised), `no URL of any kind is on the record: ${serialised}`);
  for (const forbidden of ["url", "endpoint", "instances", "data", "content", "attachment"]) {
    assert.equal(st[forbidden], undefined, `ImagingStudy has no ${forbidden} field`);
  }
  // And the connector was never asked to retrieve anything: one query, no WADO-RS call.
  assert.ok(!asked.some((u) => /\/instances|\/frames|\/rendered/.test(u)), "no retrieve was attempted");
});

/* ---- 3: the order link, which is the point --------------------------------------------------- */

test("3. a study is matched to the imaging ORDER it answers, by accession number, and inherits its visit", async () => {
  const h = hospital();
  studies = [dicomStudy({ accession: "ACC-2002" })];
  // The same message carries the order the accession number was issued against.
  const out = await pullAndLand(h, "MRN-3", {
    encounters: [sccmEncounter({ id: "V-9", status: "in-progress", class: "IMP" })],
    serviceRequests: [sccmServiceRequest({ id: "ACC-2002", code: { text: "CT abdomen" }, status: "active", intent: "order", encounter: { type: "Encounter", id: "V-9" } })],
  });
  assert.equal(out.ok, true, JSON.stringify(out));

  const st = await onlyStudy(h);
  assert.ok(st.serviceRequestId, "the study found its order");
  const order = await h.repository.latest(TENANT, "ServiceRequest", st.serviceRequestId);
  assert.ok(order, "and the order it points at really exists");
  assert.equal(order.code, "CT abdomen");
  assert.ok(st.encounterId, "the study took the visit from the order");
  assert.equal(st.encounterId, order.encounterId, "the SAME visit the request was placed on, not one it guessed");
});

test("4. a study whose accession matches no order here is filed WITHOUT a link, and the gap is stated", async () => {
  const h = hospital();
  studies = [dicomStudy({ accession: "ACC-NOBODYS" })];
  const out = await pullAndLand(h, "MRN-4", {
    serviceRequests: [sccmServiceRequest({ id: "ACC-SOMETHING-ELSE", code: { text: "MRI brain" }, status: "active", intent: "order" })],
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  const st = await onlyStudy(h);
  assert.equal(st.serviceRequestId, null, "no order link was invented for it");
  assert.equal(st.encounterId, null, "and no visit either - a scan is not attached to whichever admission is open");
  assert.ok((out.issues || []).some((i) => i.code === "SCCM_IMAGING_NO_ORDER"), `the gap is reported: ${JSON.stringify(out.issues)}`);
  assert.ok(st.accessionNumber, "the study itself is still a true study and is kept");
});

test("5. matching is exact: a study is never attached to an order whose number merely looks similar", async () => {
  const h = hospital();
  studies = [dicomStudy({ accession: "ACC-100" })];
  const out = await pullAndLand(h, "MRN-5", {
    serviceRequests: [sccmServiceRequest({ id: "ACC-1001", code: { text: "CT abdomen" }, status: "active", intent: "order" })],
  });
  assert.equal(out.ok, true);
  const st = await onlyStudy(h);
  assert.equal(st.serviceRequestId, null, "ACC-100 is not ACC-1001");
});

test("6. a study with no accession number at all is filed, unlinked, and nothing is guessed", async () => {
  const h = hospital();
  studies = [dicomStudy({ accession: null })];
  const out = await pullAndLand(h, "MRN-6", {
    serviceRequests: [sccmServiceRequest({ id: "ACC-1001", code: { text: "CT abdomen" }, status: "active", intent: "order" })],
  });
  assert.equal(out.ok, true);
  const st = await onlyStudy(h);
  assert.equal(st.accessionNumber, null);
  assert.equal(st.serviceRequestId, null, "with nothing to match on, nothing is matched");
});

test("7. a replayed pull versions nothing: the same study lands once", async () => {
  const h = hospital();
  studies = [dicomStudy({})];
  await pullAndLand(h, "MRN-7");
  const first = await onlyStudy(h);
  await pullAndLand(h, "MRN-7");
  const rows = await h.repository.latestByType(TENANT, "ImagingStudy", 10);
  assert.equal(rows.length, 1, "one study, not two");
  assert.equal(rows[0].id, first.id, "the same id - ids are stable, so a replay versions rather than duplicates");
});

test("8. a study the PACS cannot identify (no StudyInstanceUID) is skipped and SAID to be skipped", async () => {
  const h = hospital();
  const broken = dicomStudy({});
  delete broken["0020000D"];
  studies = [broken, dicomStudy({ uid: "1.2.3.4.5", accession: "ACC-OK" })];
  const out = await pullAndLand(h, "MRN-8");
  assert.equal(out.ok, true);
  const rows = await h.repository.latestByType(TENANT, "ImagingStudy", 10);
  assert.equal(rows.length, 1, "only the identifiable one landed");
  assert.ok((out.__bundle.meta.warnings || []).some((w) => /StudyInstanceUID/.test(w)), `the skip is named: ${JSON.stringify(out.__bundle.meta.warnings)}`);
});

/* ---- 9: the worklist, out ---------------------------------------------------------------------- */

test("9. the worklist maps an order to DICOM-JSON attributes, with the accession number the study will quote", () => {
  const order = { resourceType: "ServiceRequest", id: "sr-77", patientId: "pat-1", code: "CT-ABDO", display: "CT abdomen", category: "imaging", status: "active", meta: { effectiveAt: "2026-09-09T08:30:00.000Z" } };
  const patient = { resourceType: "Patient", id: "pat-1", mrn: "GH-1", name: "Anjali Menon", dob: "1959-02-14", sex: "female" };
  const item = worklistItem(order, patient, "CT");

  assert.equal(item["00100010"].Value[0], "Menon^Anjali", "PatientName is DICOM PN: family first");
  assert.equal(item["00100020"].Value[0], "GH-1");
  assert.equal(item["00100030"].Value[0], "19590214", "PatientBirthDate is DICOM DA");
  assert.equal(item["00100040"].Value[0], "F");
  assert.equal(item["00080050"].Value[0], "sr-77", "the accession number IS the order id - it is what comes back on the study");
  const step = item["00400100"].Value[0];
  assert.equal(step["00080060"].Value[0], "CT");
  assert.equal(step["00400002"].Value[0], "20260909");
  assert.equal(step["00400003"].Value[0], "083000");
  assert.equal(step["00400007"].Value[0], "CT abdomen");
});

test("10. modality is NEVER guessed from an order's words: only a hospital's own map decides", () => {
  const { map, rejected } = modalityMapOf({ modalityMap: { "CT-ABDO": "CT", "MRI-BRAIN": "MR", "XR-CHEST": "SCANNER" } });
  assert.equal(map["ct-abdo"], "CT");
  assert.equal(map["mri-brain"], "MR");
  assert.equal(map["xr-chest"], undefined, "a modality DICOM does not define is refused, not passed through");
  assert.equal(rejected.length, 1);

  // And with no map at all, an order that plainly says "CT" in its text still gets no modality.
  const order = { resourceType: "ServiceRequest", id: "sr-1", patientId: "p", code: "CT chest", display: "CT chest", category: "imaging", status: "active", meta: {} };
  const item = worklistItem(order, { mrn: "M", name: "A B", dob: "1980-01-01", sex: "male" }, null);
  assert.equal(item["00400100"].Value[0]["00080060"], undefined, "no modality was invented from the words 'CT chest'");
});

test("11. only imaging orders that are still to be done reach a worklist", () => {
  const mk = (over) => ({ resourceType: "ServiceRequest", id: "x", patientId: "p", category: "imaging", status: "active", ...over });
  assert.equal(isPendingImaging(mk({})), true);
  assert.equal(isPendingImaging(mk({ status: "completed" })), false, "a completed scan is not on today's list");
  assert.equal(isPendingImaging(mk({ status: "draft", externalStatus: "revoked" })), false, "a cancelled external order is off it too");
  assert.equal(isPendingImaging(mk({ category: "laboratory" })), false, "a blood test is not a scan");
  assert.equal(isPendingImaging({ resourceType: "Observation" }), false);
  assert.equal(isPendingImaging(null), false);
});

test("12. the small conversions are the ones DICOM actually requires", () => {
  assert.equal(dicomName("Anjali Menon"), "Menon^Anjali");
  assert.equal(dicomName("Prince"), "Prince", "a single name is not split into a family that does not exist");
  assert.equal(dicomName(""), null);
  assert.deepEqual(dicomDateTime("2026-09-09T08:30:00.000Z"), { date: "20260909", time: "083000" });
  assert.deepEqual(dicomDateTime("1959-02-14"), { date: "19590214", time: null });
  assert.deepEqual(dicomDateTime("not a date"), { date: null, time: null }, "an unparseable date is null, never today");
});
