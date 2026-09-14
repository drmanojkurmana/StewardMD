/* test/wardsynq-connectors-dicom.test.mjs - owner S5: a hospital's own DICOMweb archive, as a connector.
 *
 * Routes: GET /api/queue/ward/connectors, POST /api/queue/ward/connector-save, POST /api/queue/ward/connector-test,
 * and GET /api/queue/ward/imaging-studies reading the connector's viewer template.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-connectors-dicom.test.mjs
 */
import { as, seed, H, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, HR, DOCTOR, OTHER_ADMIN, writesNow, withFetch } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const D = await import("../functions/_wardsynq/dicomweb.js");
const { viewerLaunch } = await import("../functions/_wardsynq/imaging-viewer.js");
const { CONNECTOR_TYPE } = await import("../functions/_wardsynq/connectors.js");

const PACS = "https://93.184.216.34/dicomweb";
const TOKEN = "pacs-bearer-token-do-not-leak-0001";
const DICOM = { kind: "dicom", provider: "dicomweb", settings: { qidoUrl: PACS, authType: "bearer", ohifUrl: "https://93.184.216.35/ohif" }, secrets: { credential: TOKEN } };
const save = (who, over) => as(who, "/ward/connector-save", "POST", { orgId: ORG_ID, ...DICOM, ...(over || {}) });

function pacs(status, body) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return new Response(body === undefined ? null : JSON.stringify(body), { status }); } };
}

/* ---- the adapter, pure ------------------------------------------------------------------------------ */

test("viewer: the OHIF base becomes /viewer?StudyInstanceUIDs=, and a template wins over it", () => {
  assert.deepEqual(D.viewerConfigOf({ ohifUrl: "https://ohif.example/" }), { urlTemplate: "https://ohif.example/viewer?StudyInstanceUIDs={studyInstanceUid}" });
  assert.deepEqual(D.viewerConfigOf({ ohifUrl: "https://ohif.example", viewerUrlTemplate: "https://pacs.example/v?acc={accession}" }), { urlTemplate: "https://pacs.example/v?acc={accession}" });
  assert.equal(D.viewerConfigOf({}), null);
});

test("viewer: {accession} fills from the accession, and no MRN or name placeholder exists any more", () => {
  const ok = viewerLaunch({ urlTemplate: "https://pacs.example/v?acc={accession}&uid={studyInstanceUid}" }, { accessionNumber: "A 1", studyInstanceUid: "1.2.3" });
  assert.equal(ok.available, true);
  assert.equal(ok.url, "https://pacs.example/v?acc=A%201&uid=1.2.3");
  const mrn = viewerLaunch({ urlTemplate: "https://pacs.example/v?pid={patientId}" }, { patientId: "MRN-1" });
  assert.equal(mrn.reason, "template_unsupported_placeholder", "the MRN placeholder is refused");
  assert.match(D.validate({ authType: "none", viewerUrlTemplate: "https://pacs.example/v?n={patientName}" }, {}), /placeholders that do not exist/);
  assert.match(D.validate({ authType: "bearer" }, {}), /needs the token/);
  assert.match(D.validate({ authType: "basic" }, { credential: "no-colon" }), /user:password/);
  assert.equal(D.validate({ authType: "basic" }, { credential: "u:p" }), null);
});

test("qidoTest: one QIDO-RS study search, DICOM JSON, the bearer token, and the body never returned", async () => {
  const p = pacs(200, [{ "00100010": { vr: "PN", Value: [{ Alphabetic: "Secret^Patient" }] } }]);
  const r = await D.qidoTest({ settings: { qidoUrl: PACS + "/", authType: "bearer" }, secrets: { credential: TOKEN }, fetchImpl: p.fetchImpl });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.count, 1);
  assert.equal(p.calls[0].url, PACS + "/studies?limit=1");
  assert.equal(p.calls[0].init.headers.Accept, "application/dicom+json");
  assert.equal(p.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(p.calls[0].init.redirect, "manual");
  assert.ok(!JSON.stringify(r).includes("Secret"), "a study's patient name never comes back in the result");
});

test("qidoTest: basic auth, 204, refused credentials, redirects, not DICOM JSON, and a private address are each said honestly", async () => {
  const basic = pacs(204);
  const r204 = await D.qidoTest({ settings: { qidoUrl: PACS, authType: "basic" }, secrets: { credential: "u:p" }, fetchImpl: basic.fetchImpl });
  assert.equal(r204.ok, true);
  assert.equal(r204.count, 0);
  assert.equal(basic.calls[0].init.headers.Authorization, `Basic ${btoa("u:p")}`);
  const r401 = await D.qidoTest({ settings: { qidoUrl: PACS, authType: "bearer" }, secrets: { credential: "x" }, fetchImpl: pacs(401).fetchImpl });
  assert.equal(r401.ok, false); assert.equal(r401.reason, "auth-refused"); assert.equal(r401.httpStatus, 401);
  const r302 = await D.qidoTest({ settings: { qidoUrl: PACS, authType: "none" }, secrets: {}, fetchImpl: pacs(302).fetchImpl });
  assert.equal(r302.reason, "redirect-not-followed");
  const html = await D.qidoTest({ settings: { qidoUrl: PACS, authType: "none" }, secrets: {}, fetchImpl: async () => new Response("<html>", { status: 200 }) });
  assert.equal(html.ok, false); assert.equal(html.reason, "not-dicom-json");
  const priv = pacs(200, []);
  const inside = await D.qidoTest({ settings: { qidoUrl: "https://10.0.0.5/dicomweb", authType: "none" }, secrets: {}, fetchImpl: priv.fetchImpl });
  assert.equal(inside.ok, false); assert.equal(inside.reason, "blocked-address");
  assert.equal(priv.calls.length, 0, "a private address is never contacted");
  const down = await D.qidoTest({ settings: { qidoUrl: PACS, authType: "none" }, secrets: {}, fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.reason, "unreachable");
});

/* ---- who may configure ------------------------------------------------------------------------------ */

test("negative authorization: no session 401, hr and nurse 403 with nothing written, another hospital's admin 403", async () => {
  seed();
  const before = writesNow();
  const anon = await as(null, `/ward/connectors?orgId=${ORG_ID}`);
  assert.equal(anon.__status, 401);
  for (const who of [HR, NURSE]) {
    const r = await save(who);
    assert.equal(r.__status, 403, `${who}: ${r.__text}`);
    const t = await as(who, "/ward/connector-test", "POST", { orgId: ORG_ID, id: "dicom" });
    assert.equal(t.__status, 403);
  }
  const other = await save(OTHER_ADMIN);
  assert.equal(other.__status, 403, other.__text);
  const otherList = await as(OTHER_ADMIN, `/ward/connectors?orgId=${ORG_ID}`);
  assert.equal(otherList.__status, 403);
  assert.equal(writesNow(), before, "nothing was written by any refused call");
});

test("the admin saves the archive: the credential is sealed, never returned, and the change is audited without it", async () => {
  seed();
  const r = await save(ADMIN);
  assert.equal(r.__status, 200, r.__text);
  assert.ok(!r.__text.includes(TOKEN), "the save answer does not echo the credential");
  assert.deepEqual(r.connector.secretsSet, ["credential"]);
  assert.match(r.secretsNote, /not shown again/);
  const rec = await H.RECORD.latest(T, CONNECTOR_TYPE, "dicom");
  assert.ok(rec.secretsEnc.credential && !rec.secretsEnc.credential.includes(TOKEN), "stored sealed");
  const audit = H.RECORD.audit.filter((a) => a.action === "connector.create");
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].scope.secretsReplaced, ["credential"]);
  assert.ok(!JSON.stringify(H.RECORD.audit).includes(TOKEN), "no secret in the audit trail");

  const list = await as(ADMIN, `/ward/connectors?orgId=${ORG_ID}`);
  assert.equal(list.__status, 200);
  assert.ok(!list.__text.includes(TOKEN) && !list.__text.includes(rec.secretsEnc.credential), "neither the credential nor its seal is listed");
  assert.equal(list.connectors[0].settings.qidoUrl, PACS);
  assert.ok(list.catalogue.some((k) => k.kind === "dicom" && k.providers[0].testable));

  // Rotation: a new credential only, audited as a rotation.
  const rot = await save(ADMIN, { secrets: { credential: "a-new-token-000000000000" } });
  assert.equal(rot.__status, 200, rot.__text);
  assert.equal(H.RECORD.audit.filter((a) => a.action === "connector.rotate").length, 1);
  // A save with no change writes nothing.
  const n = writesNow();
  const same = await save(ADMIN, { secrets: undefined });
  assert.equal(same.unchanged, true);
  assert.equal(writesNow(), n);
});

test("refusals write nothing: a private address, a missing credential, and a server that cannot seal", async () => {
  seed();
  const before = writesNow();
  const inside = await save(ADMIN, { settings: { ...DICOM.settings, qidoUrl: "https://169.254.169.254/latest" } });
  assert.equal(inside.__status, 422); assert.equal(inside.error, "url_refused");
  const noCred = await save(ADMIN, { secrets: undefined });
  assert.equal(noCred.__status, 422); assert.match(noCred.message, /needs the token/);
  // DOC_ENC_KEY wins over FOLLOWCARE_PHI_KEY in docKey(); a malformed one means no document key at all.
  ENV.DOC_ENC_KEY = Buffer.from("short").toString("base64url");
  try {
    const noKey = await save(ADMIN);
    assert.equal(noKey.__status, 503, noKey.__text); assert.equal(noKey.ok, false);
  } finally { delete ENV.DOC_ENC_KEY; }
  assert.equal(writesNow(), before);
});

test("test connection runs QIDO-RS server-side, reports honestly and is audited", async () => {
  seed();
  await save(ADMIN);
  const okPacs = pacs(200, []);
  const passed = await withFetch(okPacs.fetchImpl, () => as(ADMIN, "/ward/connector-test", "POST", { orgId: ORG_ID, id: "dicom" }));
  assert.equal(passed.__status, 200, passed.__text);
  assert.equal(passed.test.passed, true);
  assert.equal(passed.test.count, 0);
  assert.equal(okPacs.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`, "the sealed credential opened for the call");
  const refused = await withFetch(pacs(403).fetchImpl, () => as(ADMIN, "/ward/connector-test", "POST", { orgId: ORG_ID, id: "dicom" }));
  assert.equal(refused.test.passed, false);
  assert.match(refused.test.detail, /refused the credentials \(403\)/);
  const audits = H.RECORD.audit.filter((a) => a.action === "connector.test");
  assert.deepEqual(audits.map((a) => a.scope.ok), [true, false]);
  const missing = await as(ADMIN, "/ward/connector-test", "POST", { orgId: ORG_ID, id: "nope" });
  assert.equal(missing.__status, 404);
});

test("imaging-studies opens the study from the connector's viewer, with no patient name or MRN in the URL", async () => {
  seed({ imagingViewer: { urlTemplate: "https://legacy.example/v?acc={accessionNumber}" } });
  await save(ADMIN, { settings: { ...DICOM.settings, viewerUrlTemplate: "https://93.184.216.36/view?acc={accession}" } });
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Dicom Connector Person", mobile: "9876500011", gender: "female", ageYears: 50 });
  assert.equal(reg.__status, 200, reg.__text);
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: "1" });
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG_ID, encounterId: adm.encounterId, code: "CT chest", category: "imaging" });
  assert.equal(order.__status, 200, order.__text);
  const listed = await as(DOCTOR, `/ward/imaging-studies?orgId=${ORG_ID}&patientId=${adm.patientId}`);
  assert.equal(listed.__status, 200, listed.__text);
  const row = listed.orders.find((o) => o.serviceRequestId === order.orderId);
  assert.equal(row.viewer.available, true, JSON.stringify(row.viewer));
  assert.ok(row.viewer.url.startsWith("https://93.184.216.36/view?acc="), "the connector's template, not the older org field");
  assert.ok(!row.viewer.url.includes("Dicom") && !row.viewer.url.includes(reg.mrn), "no name, no MRN");
  // Turned off, the older org field answers again.
  await save(ADMIN, { secrets: undefined, active: false });
  const off = await as(DOCTOR, `/ward/imaging-studies?orgId=${ORG_ID}&patientId=${adm.patientId}`);
  assert.ok(off.orders.find((o) => o.serviceRequestId === order.orderId).viewer.url.startsWith("https://legacy.example/"));
  assert.equal(H.RECORD.audit.filter((a) => a.action === "connector.disable").length, 1);
});

test("another hospital sees none of these connectors", async () => {
  seed();
  await save(ADMIN);
  const theirs = await as(OTHER_ADMIN, `/ward/connectors?orgId=${OTHER}`);
  assert.equal(theirs.__status, 200, theirs.__text);
  assert.equal(theirs.connectors.length, 0);
});
