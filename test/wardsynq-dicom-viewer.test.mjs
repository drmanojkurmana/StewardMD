/* test/wardsynq-dicom-viewer.test.mjs - the in-app DICOM viewer's proxy, through the real queue router.
 *
 * Routes: GET /api/queue/ward/imaging-series, GET /api/queue/ward/imaging-instance, and the inAppViewer
 * flag on GET /api/queue/ward/imaging-studies. The PACS is a mocked fetch; no real patient image.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-dicom-viewer.test.mjs
 */
import { as, seed, H, T, ORG_ID, OTHER, ADMIN, HR, DOCTOR, OTHER_ADMIN, withFetch } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const V = await import("../functions/_wardsynq/dicom-viewer.js");

const PACS = "https://93.184.216.34/dicomweb";
const TOKEN = "pacs-bearer-token-do-not-leak-0002";
const STUDY_UID = "1.2.826.0.1.3680043.8.498.1";
const S1 = STUDY_UID + ".1", S2 = STUDY_UID + ".2";
const SOP = (s, n) => `${s}.${n}`;
const DICOM_BYTES = (() => { const b = new Uint8Array(300); b.set([68, 73, 67, 77], 128); b[299] = 7; return b; })();

function pacs() {
  const calls = [];
  const j = (x) => new Response(JSON.stringify(x), { status: 200, headers: { "Content-Type": "application/dicom+json" } });
  const fetchImpl = async (url, init) => {
    const u = String(url); calls.push({ url: u, init });
    const p = u.slice(PACS.length);
    if (p.startsWith("/studies?StudyInstanceUID=")) return j([{ "00100010": { vr: "PN", Value: [{ Alphabetic: "Synthetic^Person" }] }, "00100020": { vr: "LO", Value: ["PACS-77"] }, "00081030": { vr: "LO", Value: ["CT HEAD"] } }]);
    if (p === `/studies/${STUDY_UID}/series`) return j([
      { "0020000E": { vr: "UI", Value: [S2] }, "00200011": { vr: "IS", Value: [2] }, "00080060": { vr: "CS", Value: ["CT"] }, "0008103E": { vr: "LO", Value: ["Axial 5mm"] } },
      { "0020000E": { vr: "UI", Value: [S1] }, "00200011": { vr: "IS", Value: [1] }, "00080060": { vr: "CS", Value: ["CT"] } },
      { "0020000E": { vr: "UI", Value: ["not a uid"] } }]);
    if (p === `/studies/${STUDY_UID}/series/${S1}/instances`) return j([3, 1, 2].map((n) => ({ "00080018": { vr: "UI", Value: [SOP(S1, n)] }, "00200013": { vr: "IS", Value: [n] } })));
    if (p === `/studies/${STUDY_UID}/series/${S2}/instances`) return j([{ "00080018": { vr: "UI", Value: [SOP(S2, 1)] }, "00200013": { vr: "IS", Value: [1] } }]);
    if (p === `/studies/${STUDY_UID}/series/${S1}/instances/${SOP(S1, 1)}`) {
      const enc = new TextEncoder();
      const body = new Uint8Array([...enc.encode("--B0UND\r\nContent-Type: application/dicom\r\n\r\n"), ...DICOM_BYTES, ...enc.encode("\r\n--B0UND--\r\n")]);
      return new Response(body, { status: 200, headers: { "Content-Type": 'multipart/related; type="application/dicom"; boundary=B0UND' } });
    }
    return new Response("", { status: 404 });
  };
  return { calls, fetchImpl };
}

/** The hospital's archive saved, a patient admitted, and an ImagingStudy on the record. */
async function setup(opts) {
  seed();
  if (!(opts && opts.noArchive)) {
    const saved = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "dicom", provider: "dicomweb", settings: { qidoUrl: PACS, authType: "bearer" }, secrets: { credential: TOKEN } });
    assert.equal(saved.__status, 200, saved.__text);
  }
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Viewer Test Person", mobile: "9876500077", gender: "female", ageYears: 40 });
  assert.equal(reg.__status, 200, reg.__text);
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: "2" });
  assert.equal(adm.__status, 200, adm.__text);
  await H.RECORD.append(T, [{ resourceType: "ImagingStudy", id: "study-v1", version: 1, patientId: adm.patientId, studyUid: STUDY_UID, accessionNumber: "ACC-9", modality: "CT",
    meta: { source: { system: "dicomweb", sourceId: "study-v1" } } }]);
  return { patientId: adm.patientId, encounterId: adm.encounterId };
}
const series = (who, q) => as(who, `/ward/imaging-series?orgId=${ORG_ID}&studyId=${q === undefined ? "study-v1" : q}`);
const instance = (who, s, sop) => as(who, `/ward/imaging-instance?orgId=${ORG_ID}&studyId=study-v1&seriesUid=${s}&sopUid=${sop}`);

test("pure: series sorted by number, instances by InstanceNumber, bad UIDs dropped; the first multipart part", () => {
  assert.equal(V.isUid("1.2.3"), true); assert.equal(V.isUid("1.2.x"), false); assert.equal(V.isUid("../1"), false);
  const s = V.seriesOf([{ "0020000E": { Value: ["1.2"] }, "00200011": { Value: [2] } }, { "0020000E": { Value: ["1.1"] }, "00200011": { Value: [1] } }],
    { "1.1": [{ "00080018": { Value: ["1.1.2"] }, "00200013": { Value: [2] } }, { "00080018": { Value: ["1.1.1"] }, "00200013": { Value: [1] } }] });
  assert.deepEqual(s.map((x) => x.seriesUid), ["1.1", "1.2"]);
  assert.deepEqual(s[0].instances.map((i) => i.sopUid), ["1.1.1", "1.1.2"]);
  const part = V.firstPart(new TextEncoder().encode("--X\r\nA: b\r\n\r\nHELLO\r\n--X--"), "multipart/related; boundary=X");
  assert.equal(new TextDecoder().decode(part), "HELLO");
});

test("a doctor opens a study: series and instances from the archive, header shown, credential used but never returned, audited", async () => {
  await setup();
  const p = pacs();
  const auditBefore = H.RECORD.audit.length;
  const r = await withFetch(p.fetchImpl, () => series(DOCTOR));
  assert.equal(r.__status, 200, r.__text);
  assert.deepEqual(r.series.map((s) => s.seriesUid), [S1, S2], "sorted by series number; the bad UID dropped");
  assert.deepEqual(r.series[0].instances.map((i) => i.number), [1, 2, 3]);
  assert.equal(r.header.patientName, "Synthetic^Person");
  assert.equal(r.headerHidden, false);
  assert.ok(!r.__text.includes(TOKEN) && !r.__text.includes(PACS), "neither the credential nor the archive address reaches the browser");
  assert.ok(p.calls.every((c) => c.init.headers.Authorization === `Bearer ${TOKEN}` && c.init.redirect === "manual"));
  const opened = H.RECORD.audit.slice(auditBefore).filter((a) => a.action === "imaging.study.open");
  assert.equal(opened.length, 1, "one audit row per study opened");
  assert.equal(opened[0].scope.studyUid, STUDY_UID);
  assert.ok(opened[0].actor && opened[0].ts, "who and when");
});

test("an instance is proxied as application/dicom, no-store, not stored, not audited per image", async () => {
  await setup();
  const p = pacs();
  const rowsBefore = H.RECORD._rows.length, auditBefore = H.RECORD.audit.length;
  const { onRequest } = await import("../functions/api/queue/[[path]].js");
  const { ENV } = await import("./wardsynq-connectors-harness.mjs");
  const res = await withFetch(p.fetchImpl, () => onRequest({ request: new Request(`https://x/api/queue/ward/imaging-instance?orgId=${ORG_ID}&studyId=study-v1&seriesUid=${S1}&sopUid=${SOP(S1, 1)}`, { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } }), env: ENV, waitUntil: () => {} }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/dicom");
  assert.match(res.headers.get("cache-control"), /no-store/);
  const got = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...got], [...DICOM_BYTES], "exactly the multipart's DICOM part");
  assert.ok(p.calls[0].url.endsWith(`/studies/${STUDY_UID}/series/${S1}/instances/${SOP(S1, 1)}`), "the study UID is the record's");
  assert.match(p.calls[0].init.headers.Accept, /multipart\/related; type="application\/dicom"/);
  assert.equal(H.RECORD._rows.length, rowsBefore, "no image is written to the record");
  assert.equal(H.RECORD.audit.filter((a, i) => i >= auditBefore && a.action === "imaging.study.open").length, 0);
});

test("refusals: no session 401, no chart capability 403, another hospital 403/404, and the archive is never asked", async () => {
  await setup();
  const p = pacs();
  await withFetch(p.fetchImpl, async () => {
    assert.equal((await series(null)).__status, 401);
    assert.equal((await series(HR)).__status, 403);
    assert.equal((await instance(HR, S1, SOP(S1, 1))).__status, 403);
    assert.equal((await series(OTHER_ADMIN)).__status, 403, "another hospital's admin naming this hospital");
    const theirs = await as(OTHER_ADMIN, `/ward/imaging-series?orgId=${OTHER}&studyId=study-v1`);
    assert.ok(theirs.__status >= 400 && theirs.__status !== 409, `this hospital's study is not reachable from another: ${theirs.__status}`);
    assert.ok(!theirs.__text.includes("Synthetic"));
  });
  assert.equal(p.calls.length, 0, "no refused call reached the PACS");
});

test("bad input: unknown study 404, missing study 422, bad UIDs 400, unknown instance 404, no archive 409", async () => {
  await setup();
  const p = pacs();
  await withFetch(p.fetchImpl, async () => {
    const none = await series(DOCTOR, "no-such-study");
    assert.equal(none.__status, 404); assert.equal(none.error, "study_not_found");
    assert.equal((await series(DOCTOR, "")).__status, 422);
    const bad = await instance(DOCTOR, "1.2/../../x", SOP(S1, 1));
    assert.equal(bad.__status, 400); assert.equal(bad.error, "bad_uid");
    assert.equal((await instance(DOCTOR, S1, "9.9.9")).__status, 404);
  });
  assert.ok(p.calls.every((c) => !c.url.includes("..")));
  await setup({ noArchive: true });
  const noArch = await series(DOCTOR);
  assert.equal(noArch.__status, 409); assert.equal(noArch.error, "no_archive");
});

test("imaging-studies says when the in-app viewer can open a study, and not without an archive", async () => {
  for (const noArchive of [false, true]) {
    const { patientId, encounterId } = await setup({ noArchive });
    const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG_ID, encounterId, code: "CT head", category: "imaging" });
    assert.equal(order.__status, 200, order.__text);
    await H.RECORD.append(T, [{ resourceType: "ImagingStudy", id: "study-o1", version: 1, patientId, studyUid: STUDY_UID + ".9", accessionNumber: order.orderId, modality: "CT", meta: { source: { system: "dicomweb", sourceId: "study-o1" } } }]);
    const listed = await as(DOCTOR, `/ward/imaging-studies?orgId=${ORG_ID}&patientId=${patientId}`);
    assert.equal(listed.__status, 200, listed.__text);
    const row = listed.orders.find((o) => o.serviceRequestId === order.orderId);
    assert.equal(row.study.id, "study-o1");
    assert.equal(row.study.inAppViewer, !noArchive);
  }
});
