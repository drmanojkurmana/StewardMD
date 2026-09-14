/* test/wardsynq-portal-gaps.test.mjs - the three patient-portal gaps: OPD queue status, released
 * documents, and the full discharge summary. Driven through the real routers - POST /api/portal/queue,
 * POST /api/portal/document, POST /api/portal/record, POST /api/queue/ward/document-release and
 * POST /api/queue/ward/patient-release - over an in-memory record store and Firestore double.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-portal-gaps.test.mjs
 *
 * The negative cases are the point: a ticket that might be somebody else's is not shown, a document
 * nobody released cannot be downloaded (nor one withdrawn since, nor one past retention), a proxy
 * cannot reach a section it was not granted, patient A cannot fetch patient B's document by id, and a
 * result with an open critical loop stays withheld even in a full discharge summary.
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
let failSessions = false;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      if (coll === "q_sessions" && failSessions) throw new Error("firestore unavailable");
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

/* The real object-store module under another URL, so the mock below can hand every importer a memory store. */
const realStore = await import("../functions/_wardsynq/object-store.js?real");
const STORE = realStore.memoryStore();
mock.module("../functions/_wardsynq/object-store.js", { namedExports: { ...realStore, storeFromEnv: () => STORE } });

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
const RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => {
        const who = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
        return who === DOCTOR ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest: queueRouter } = await import("../functions/api/queue/[[path]].js");
const { onRequest: portalRouter } = await import("../functions/api/portal/[[path]].js");
const { AccessGrant, hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { opdDate } = await import("../functions/_queue_engine.js");
const PV = await import("../functions/_wardsynq/portal-view.js");

const ORG = "org-wsq", OTHER_ORG = "org-other", TENANT = TENANT_ROW.id;
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", OTHER_DOCTOR = "other-doctor@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), DOC_ENC_KEY: Buffer.alloc(32, 9).toString("base64url"), CONNECT_DB: tenantDb,
};

docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT, ownerUid: "cfa:nobody", createdAt: 1,
  wardsynq: { patientAccess: { enabled: true }, neverRelease: [] } }, updateTime: "t1" });
for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"]]) {
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
}
docs.set(`q_orgs/${OTHER_ORG}`, { fields: { id: OTHER_ORG, code: "SMD-OTHR01", name: "A Different Hospital", kind: "clinic", mode: "native", ownerUid: "cfa:someone-else", createdAt: 1 }, updateTime: "t1" });
docs.set(`q_members/${sanitize(OTHER_ORG)}__${sanitize(idFor(OTHER_DOCTOR))}`, { fields: { orgId: OTHER_ORG, identity: idFor(OTHER_DOCTOR), role: "doctor", active: true }, updateTime: "t1" });

const NOW = new Date().toISOString();
let seq = 0;
async function seed(rec) {
  await RECORD.append(TENANT, [{ version: 1, meta: { recordedAt: NOW, effectiveAt: NOW, source: { system: "wardsynq-native", sourceId: null } }, ...rec }], { idempotencyKey: "seed-" + (++seq) });
}
async function grant(id, patientId, extra) {
  const token = "tok-" + id;
  await seed(AccessGrant({ id, patientId, issuedBy: "dr:1", issuedAt: NOW, codeHash: await hashSecret("00000000", id), redeemedAt: NOW, tokenHash: await hashSecret(token, id), ...(extra || {}) }));
  return token;
}
async function staff(email, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await queueRouter({ request: new Request("https://x/api/queue" + path, { method: "POST", headers, body: JSON.stringify({ orgId: ORG, ...body }) }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function portal(sub, body) {
  const res = await portalRouter({ request: new Request("https://x/api/portal/" + sub, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: ORG, ...body }) }), env: ENV, params: { path: [sub] } });
  const type = res.headers.get("Content-Type") || "";
  if (type.includes("application/json")) return { status: res.status, body: await res.json() };
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
}
const releases = () => RECORD._rows.filter((r) => r.tenantId === TENANT && r.resourceType === "PatientRecordRelease").length;

const PA = "opd-pat-gaps-a", PB = "opd-pat-gaps-b", PC = "opd-pat-gaps-c";
const T = {};
const PDF = Buffer.from("%PDF-1.4 patient A referral letter");

test("setup: patients, grants, and a real document uploaded through POST /api/queue/ward/document-upload", async () => {
  await seed({ resourceType: "Patient", id: PA, name: "Asha Gaps", mrn: "GAPS-A", dob: "1980-01-01" });
  await seed({ resourceType: "Patient", id: PB, name: "Bina Gaps", mrn: "GAPS-B", dob: "1970-01-01" });
  await seed({ resourceType: "Patient", id: PC, name: "Chandra Gaps", mrn: "GAPS-C", dob: "1990-01-01" });
  T.a = await grant("g-a", PA);
  T.b = await grant("g-b", PB);
  T.c = await grant("g-c", PC);
  T.proxy = await grant("g-proxy", PA, { issuedTo: "proxy", proxy: { relatedPersonId: "rp-1", name: "Ravi", relationship: "spouse", sections: ["discharge", "bills"], consentFrom: "patient", consentMethod: "in-person-verbal" } });
  T.proxyDocs = await grant("g-proxy-docs", PA, { issuedTo: "proxy", proxy: { relatedPersonId: "rp-2", name: "Mira", relationship: "daughter", sections: ["documents", "status"], consentFrom: "patient", consentMethod: "in-person-written" } });

  const up = await staff(DOCTOR, "/ward/document-upload", { patientId: PA, docType: "referral-letter", title: "Referral to cardiology", contentType: "application/pdf", dataBase64: PDF.toString("base64") });
  assert.equal(up.__status, 200, JSON.stringify(up));
  T.docA = up.document;
  const upB = await staff(DOCTOR, "/ward/document-upload", { patientId: PB, docType: "outside-report", title: "B-SECRET-TITLE", contentType: "application/pdf", dataBase64: Buffer.from("B bytes").toString("base64") });
  assert.equal(upB.__status, 200, JSON.stringify(upB));
  T.docB = upB.document;
  const upB2 = await staff(DOCTOR, "/ward/document-upload", { documentId: T.docB.id, expectedVersion: 1, docType: "outside-report", title: "B-SECRET-TITLE", contentType: "application/pdf", dataBase64: Buffer.from("B bytes v2").toString("base64") });
  assert.equal(upB2.__status, 200, JSON.stringify(upB2));
});

/* ---- staff release authorization --------------------------------------------------------------- */

test("POST /api/queue/ward/document-release: no session 401, nurse 403 with nothing written, other hospital refused, doctor releases", async () => {
  const body = { documentId: T.docB.id, version: 1, reason: "Patient asked for their outside report" };
  const before = releases();
  const r401 = await staff(null, "/ward/document-release", body);
  assert.equal(r401.__status, 401, JSON.stringify(r401));
  const r403 = await staff(NURSE, "/ward/document-release", body);
  assert.equal(r403.__status, 403, JSON.stringify(r403));
  const cross = await staff(OTHER_DOCTOR, "/ward/document-release", body);
  assert.ok(cross.__status === 403 || cross.__status === 404, JSON.stringify(cross));
  assert.equal(releases(), before, "nothing was written by a refused call");
  const ok = await staff(DOCTOR, "/ward/document-release", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.written, 1);
  assert.equal(releases(), before + 1);
  const rec = RECORD._rows.filter((r) => r.resourceType === "PatientRecordRelease").pop().body;
  assert.equal(rec.patientId, PB, "the patient comes from the document, not the request");
  assert.deepEqual(rec.documents, [{ id: T.docB.id, version: 1 }]);
  assert.equal(rec.releasedBy.length > 0, true);
  assert.ok(RECORD.audit.some((e) => e.action === "record.write" && e.actor === rec.releasedBy), "the release write is audited");
});

test("NEGATIVE: a release needs a reason or consent reference, and names a real version", async () => {
  const noReason = await staff(DOCTOR, "/ward/document-release", { documentId: T.docA.id, version: 1 });
  assert.equal(noReason.__status, 422);
  assert.equal(noReason.error, "reason_required");
  const byConsent = await staff(DOCTOR, "/ward/document-release", { documentId: T.docA.id, version: 7, consentRef: "CONS-9" });
  assert.equal(byConsent.__status, 404);
});

/* ---- released documents in the portal ---------------------------------------------------------- */

test("NEGATIVE: an unreleased document is not listed and cannot be downloaded", async () => {
  const rec = await portal("record", { grantId: "g-a", token: T.a });
  assert.equal(rec.status, 200, JSON.stringify(rec.body));
  assert.deepEqual(rec.body.documents, []);
  const dl = await portal("document", { grantId: "g-a", token: T.a, documentId: T.docA.id, version: 1 });
  assert.equal(dl.status, 404);
  assert.equal(dl.body.error, "document_not_found");
});

test("a released document is listed and downloads through the decrypting store, and every download is audited", async () => {
  const rel = await staff(DOCTOR, "/ward/document-release", { documentId: T.docA.id, version: 1, reason: "Copy of referral for the patient" });
  assert.equal(rel.__status, 200, JSON.stringify(rel));
  const rec = await portal("record", { grantId: "g-a", token: T.a });
  assert.equal(rec.body.documents.length, 1);
  assert.equal(rec.body.documents[0].title, "Referral to cardiology");
  assert.equal(rec.body.documents[0].version, 1);
  const text = JSON.stringify(rec.body);
  assert.ok(!/objectKey|t\/tenant|sha256|docs\/wsq-doc/.test(text), "no object-store key or address reaches the browser");

  const auditsBefore = RECORD.audit.filter((e) => e.action === "document.download").length;
  const dl = await portal("document", { grantId: "g-a", token: T.a, documentId: T.docA.id, version: 1 });
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(dl.bytes).toString(), PDF.toString(), "the decrypted bytes, not the ciphertext");
  assert.match(dl.headers.get("Content-Disposition"), /attachment; filename="referral-to-cardiology-v1"/);
  const audits = RECORD.audit.filter((e) => e.action === "document.download");
  assert.equal(audits.length, auditsBefore + 1);
  assert.equal(audits.at(-1).actor, "patient:" + PA);
  assert.equal(audits.at(-1).scope.via, "patient-portal");
});

test("NEGATIVE: patient A's session cannot fetch patient B's document by id, even a released one", async () => {
  const dl = await portal("document", { grantId: "g-a", token: T.a, documentId: T.docB.id, version: 1 });
  assert.equal(dl.status, 404);
  assert.ok(!JSON.stringify(dl.body).includes("B-SECRET-TITLE"));
  const crossToken = await portal("document", { grantId: "g-b", token: T.a, documentId: T.docB.id, version: 1 });
  assert.equal(crossToken.status, 401);
  const own = await portal("document", { grantId: "g-b", token: T.b, documentId: T.docB.id, version: 1 });
  assert.equal(own.status, 200, "B's own session can, so the refusal above is not a broken harness");
  const notV2 = await portal("document", { grantId: "g-b", token: T.b, documentId: T.docB.id, version: 2 });
  assert.equal(notV2.status, 404, "only the exact version released");
});

test("NEGATIVE: a document withdrawn after release disappears with 'withdrawn by the hospital', and cannot be released again", async () => {
  const w = await staff(DOCTOR, "/ward/document-withdraw", { documentId: T.docA.id, reason: "Scanned under the wrong patient" });
  assert.equal(w.__status, 200, JSON.stringify(w));
  const rec = await portal("record", { grantId: "g-a", token: T.a });
  assert.equal(rec.body.documents.length, 1);
  assert.equal(rec.body.documents[0].unavailable, "withdrawn");
  assert.ok(!JSON.stringify(rec.body.documents).includes("Referral to cardiology"), "no stale title");
  const dl = await portal("document", { grantId: "g-a", token: T.a, documentId: T.docA.id, version: 1 });
  assert.equal(dl.status, 410);
  assert.equal(dl.body.error, "withdrawn");
  assert.match(dl.body.detail, /withdrawn by the hospital/);
  const again = await staff(DOCTOR, "/ward/document-release", { documentId: T.docA.id, version: 1, reason: "try to release again" });
  assert.equal(again.__status, 409);
  assert.equal(again.error, "document_withdrawn");
});

test("NEGATIVE: a released document past its retention period is not downloaded", async () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  await seed({ resourceType: "DocumentReference", id: "doc-old", patientId: PC, docType: "other", title: "Old letter", contentType: "application/pdf", sizeBytes: 3, sha256: "x", objectKey: "t/x/old", status: "current", uploadedBy: "dr", uploadedAt: past, retainUntil: past });
  await seed({ resourceType: "PatientRecordRelease", id: "rel-old", patientId: PC, at: past, kind: "document", documents: [{ id: "doc-old", version: 1 }] });
  const dl = await portal("document", { grantId: "g-c", token: T.c, documentId: "doc-old", version: 1 });
  assert.equal(dl.status, 410);
  assert.equal(dl.body.error, "retention_ended");
  const rel = await staff(DOCTOR, "/ward/document-release", { documentId: "doc-old", version: 1, reason: "past retention release" });
  assert.equal(rel.__status, 409);
});

/* ---- proxies ------------------------------------------------------------------------------------ */

test("NEGATIVE: a proxy without the documents or status section is refused on POST /api/portal/document and /api/portal/queue", async () => {
  const dl = await portal("document", { grantId: "g-proxy", token: T.proxy, documentId: T.docB.id, version: 1 });
  assert.equal(dl.status, 403);
  assert.equal(dl.body.error, "not_in_grant");
  const q = await portal("queue", { grantId: "g-proxy", token: T.proxy });
  assert.equal(q.status, 403);
  const rec = await portal("record", { grantId: "g-proxy", token: T.proxy });
  assert.ok(!("documents" in rec.body), "documents are not read at all for this proxy");
  const withDocs = await portal("record", { grantId: "g-proxy-docs", token: T.proxyDocs });
  assert.ok(Array.isArray(withDocs.body.documents), "a proxy granted documents gets the list");
  assert.ok(!("dischargeSummaries" in withDocs.body));
});

/* ---- full versus patient copy discharge summary ------------------------------------------------ */

test("full vs patient copy: the clinician's choice is recorded, and an open critical-loop result stays withheld even in full", async () => {
  await seed({ resourceType: "ClinicalNote", id: "ds-c", patientId: PC, noteType: "discharge-summary", signedBy: "dr:1",
    sections: { admission: "Ward 5.", diagnoses: "Active:\nPneumonia - confirmed", medications: "Amoxicillin.", assessment: "ASSESS-QUOTES-POTASSIUM", investigations: "U&E (completed)", plan: "Rest.", provenance: "Review and sign before use." } });
  await seed({ resourceType: "DiagnosticReport", id: "rep-c", patientId: PC, status: "final", display: "Potassium", conclusion: "7.2" });
  await seed({ resourceType: "CriticalResultLoop", id: "loop-c", patientId: PC, reportId: "rep-c", state: "open" });

  const bad = await staff(DOCTOR, "/ward/patient-release", { patientId: PC, dischargeScope: "everything" });
  assert.equal(bad.__status, 422);
  const def = await staff(DOCTOR, "/ward/patient-release", { patientId: PC, at: "2026-09-14T08:00:00.000Z" });
  assert.equal(def.__status, 200, JSON.stringify(def));
  assert.equal(def.release.dischargeScope, "patient-copy", "default is the patient copy");
  let rec = await portal("record", { grantId: "g-c", token: T.c });
  assert.equal(rec.body.dischargeSummaries.length, 1);
  assert.equal(rec.body.dischargeSummaries[0].scope, "patient-copy");
  assert.ok(!JSON.stringify(rec.body.dischargeSummaries).includes("ASSESS-QUOTES-POTASSIUM"));

  const full = await staff(DOCTOR, "/ward/patient-release", { patientId: PC, dischargeScope: "full", at: "2026-09-14T09:00:00.000Z" });
  assert.equal(full.__status, 200, JSON.stringify(full));
  assert.deepEqual(full.release.dischargeSummaries, [{ id: "ds-c", version: 1, scope: "full" }]);
  rec = await portal("record", { grantId: "g-c", token: T.c });
  const ds = rec.body.dischargeSummaries[0];
  assert.equal(ds.scope, "full");
  const byKey = Object.fromEntries(ds.sections.map((s) => [s.key, s]));
  assert.equal(byKey.admission.text, "Ward 5.");
  assert.equal(byKey.plan.text, "Rest.");
  assert.equal(byKey.assessment.withheld, true, "the open critical loop keeps result text withheld in a full release");
  assert.equal(byKey.investigations.withheld, true);
  assert.match(byKey.assessment.say, /Withheld until your care team discusses it/);
  assert.ok(!JSON.stringify(rec.body).includes("ASSESS-QUOTES-POTASSIUM"));
  assert.ok(!("provenance" in byKey), "the note to the signing clinician is not the patient's");

  await RECORD.append(TENANT, [{ version: 2, meta: { recordedAt: NOW }, resourceType: "CriticalResultLoop", id: "loop-c", patientId: PC, reportId: "rep-c", state: "acknowledged" }], { idempotencyKey: "ack-c" });
  rec = await portal("record", { grantId: "g-c", token: T.c });
  const after = Object.fromEntries(rec.body.dischargeSummaries[0].sections.map((s) => [s.key, s]));
  assert.equal(after.assessment.text, "ASSESS-QUOTES-POTASSIUM", "acknowledging the loop is what releases it");
});

test("NEGATIVE: a proxy with only the patient-copy section sees a full release as the patient copy", async () => {
  await seed({ resourceType: "ClinicalNote", id: "ds-a", patientId: PA, noteType: "discharge-summary", signedBy: "dr:1", sections: { admission: "Ward 2.", plan: "Walk daily.", assessment: "A-ASSESSMENT" } });
  const full = await staff(DOCTOR, "/ward/patient-release", { patientId: PA, dischargeScope: "full", at: "2026-09-14T10:00:00.000Z" });
  assert.equal(full.__status, 200, JSON.stringify(full));
  const proxy = await portal("record", { grantId: "g-proxy", token: T.proxy });
  assert.equal(proxy.body.dischargeSummaries[0].scope, "patient-copy");
  assert.ok(!JSON.stringify(proxy.body).includes("A-ASSESSMENT"));
  const own = await portal("record", { grantId: "g-a", token: T.a });
  assert.equal(own.body.dischargeSummaries[0].scope, "full");
  assert.ok(JSON.stringify(own.body).includes("A-ASSESSMENT"), "the patient's own grant has discharge-full");
});

test("NEGATIVE: a correction is not shown until it is released in its turn", async () => {
  await RECORD.append(TENANT, [{ version: 2, meta: { recordedAt: NOW }, resourceType: "ClinicalNote", id: "ds-a", patientId: PA, noteType: "discharge-summary", signedBy: "dr:1", sections: { admission: "Ward 2.", plan: "CORRECTED-PLAN" } }], { idempotencyKey: "ds-a-v2" });
  let rec = await portal("record", { grantId: "g-a", token: T.a });
  assert.equal(rec.body.dischargeSummaries.length, 0, "v1 was released, v2 was not: neither a stale v1 nor the unreleased v2");
  assert.ok(!JSON.stringify(rec.body).includes("CORRECTED-PLAN"));
  const rel = await staff(DOCTOR, "/ward/patient-release", { patientId: PA, at: "2026-09-14T11:00:00.000Z" });
  assert.equal(rel.__status, 200, JSON.stringify(rel));
  rec = await portal("record", { grantId: "g-a", token: T.a });
  assert.ok(JSON.stringify(rec.body.dischargeSummaries).includes("CORRECTED-PLAN"));
  assert.equal(rec.body.dischargeSummaries[0].scope, "patient-copy");
});

/* ---- queue status ------------------------------------------------------------------------------ */

function seedQueue() {
  const date = opdDate();
  docs.set("q_rooms/room-7", { fields: { id: "room-7", orgId: ORG, name: "Cardiology", number: "7" }, updateTime: "t1" });
  docs.set("q_sessions/s-card", { fields: { hospitalId: ORG, doctorUid: "dr-card", department: "Cardiology", date, roomId: "room-7" }, updateTime: "t1" });
  docs.set("q_sessions/s-pool", { fields: { hospitalId: ORG, doctorUid: "__pool__", department: "", date }, updateTime: "t1" });
  docs.set("q_sessions/s-other-hospital", { fields: { hospitalId: OTHER_ORG, doctorUid: "dr-x", department: "X", date }, updateTime: "t1" });
  const t = (id, fields) => docs.set("q_tickets/" + id, { fields: { priority: 0, ...fields }, updateTime: "t1" });
  t("tk-x", { sessionId: "s-card", hospitalId: ORG, status: "waiting", registeredAt: 1, ghisPatientId: "GAPS-X", encName: "OTHER-PATIENT-NAME", mrnLast4: "9999", token: "A-013" });
  t("tk-a", { sessionId: "s-card", hospitalId: ORG, status: "waiting", registeredAt: 2, ghisPatientId: "GAPS-A", etaStart: Date.now() + 20 * 60000, roomId: "room-7", token: "A-014" });
  t("tk-c1", { sessionId: "s-pool", hospitalId: ORG, status: "registered", registeredAt: 3, ghisPatientId: "GAPS-C" });
  t("tk-c2", { sessionId: "s-card", hospitalId: ORG, status: "waiting", registeredAt: 4, ghisPatientId: "gaps c" });
  t("tk-b", { sessionId: "s-other-hospital", hospitalId: OTHER_ORG, status: "waiting", registeredAt: 1, ghisPatientId: "GAPS-B" });
}

test("POST /api/portal/queue shows the patient's own ticket only: place, state, a count ahead, and the queue's own ETA", async () => {
  seedQueue();
  const q = await portal("queue", { grantId: "g-a", token: T.a });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.available, true);
  assert.equal(q.body.ambiguous, false);
  assert.equal(q.body.tickets.length, 1);
  const tk = q.body.tickets[0];
  assert.equal(tk.label, "Cardiology 7");
  assert.equal(tk.state, "waiting");
  assert.equal(tk.ahead, 1);
  assert.equal(tk.token, "A-014", "the patient's own token, the number called in the hall");
  assert.ok(Date.parse(tk.eta) > Date.now());
  const text = JSON.stringify(q.body);
  for (const leak of ["OTHER-PATIENT-NAME", "GAPS-X", "9999", "tk-x", "tk-a", "GAPS-A", "A-013"]) assert.ok(!text.includes(leak), "no other patient's data, and no ids: " + leak);
  assert.ok(RECORD.audit.some((e) => e.action === "record.read" && e.actor === "patient:" + PA && e.scope && e.scope.resourceType === "QueueTicket"), "the queue read is audited under the reader");
});

test("NEGATIVE: an ambiguous ticket link shows nothing; another hospital's ticket is never this patient's", async () => {
  seedQueue();
  const c = await portal("queue", { grantId: "g-c", token: T.c });
  assert.equal(c.status, 200);
  assert.equal(c.body.ambiguous, true);
  assert.deepEqual(c.body.tickets, []);
  const b = await portal("queue", { grantId: "g-b", token: T.b });
  assert.equal(b.status, 200);
  assert.deepEqual(b.body.tickets, [], "patient B's ticket is at a different hospital");
});

test("NEGATIVE: a failed queue read says it failed, never an empty queue; an expired ETA is no estimate", async () => {
  seedQueue();
  failSessions = true;
  try {
    const q = await portal("queue", { grantId: "g-a", token: T.a });
    assert.equal(q.status, 502);
    assert.equal(q.body.error, "queue_read_failed");
    assert.ok(!("tickets" in q.body));
  } finally { failSessions = false; }
  const s = [{ id: "s", doctorUid: "d" }];
  const past = PV.queueStatusFor(PA, "GAPS-A", s, { s: [{ id: "t", status: "waiting", ghisPatientId: "GAPS-A", etaStart: 5 }] }, [], Date.now());
  assert.equal(past.tickets[0].eta, null);
  const called = PV.queueStatusFor(PA, "GAPS-A", s, { s: [{ id: "t", status: "in_consultation", ghisPatientId: "GAPS-A" }] }, [], Date.now());
  assert.equal(called.tickets[0].state, "in-consultation");
  assert.equal(called.tickets[0].ahead, null);
  assert.equal(called.tickets[0].token, null, "a ticket registered before tokens existed has none, and none is made up");
  assert.equal(PV.queueStatusFor(PA, "GAPS-Z", s, { s: [{ id: "t", status: "waiting", ghisPatientId: "GAPS-A" }] }, [], 0).ambiguous, true, "the record's MRN disagreeing is ambiguous too");
});

test("PURE: existing releases stay patient copy, and a full release without the section is the patient copy", () => {
  const notes = [{ id: "ds", version: 1, noteType: "discharge-summary", signedBy: "dr", sections: { plan: "p", assessment: "a" } }];
  assert.equal(PV.releasedDischargeSummaries(notes, [{ dischargeSummaries: [{ id: "ds", version: 1 }] }], { patientCopy: true, full: true })[0].scope, "patient-copy");
  assert.equal(PV.releasedDischargeSummaries(notes, [{ dischargeSummaries: [{ id: "ds", version: 1, scope: "full" }] }], { patientCopy: true, full: false })[0].scope, "patient-copy");
  assert.deepEqual(PV.releasedDischargeSummaries(notes, [{ dischargeSummaries: [{ id: "ds", version: 1 }] }], { patientCopy: false, full: true }), []);
  const dx = PV.releasedDischargeSummaries([{ ...notes[0], sections: { diagnoses: "Active:\nX - differential" } }], [{ dischargeSummaries: [{ id: "ds", version: 1, scope: "full" }] }], { full: true, withheldResults: 0, excludedDiagnoses: 1 });
  assert.equal(dx[0].sections[0].withheld, true, "a differential is not printed as a diagnosis, even in full");
  assert.ok(PV.SECTIONS.includes("status") && PV.SECTIONS.includes("documents") && PV.SECTIONS.includes("discharge-full"));
  assert.equal(PV.documentUnavailable({ status: "current", retainUntil: "not a date" }, Date.now()).reason, "retention_ended", "unreadable retention fails closed");
});

/* ---- screens ----------------------------------------------------------------------------------- */

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
function loadPortal() {
  const window = {};
  vm.runInNewContext(read("wardsynq/site/i18n.js"), { window });
  vm.runInNewContext(read("wardsynq/site/portal.js"), { window });
  return window.WSQPortal;
}

test("portal screen: queue status has distinct loading, failed, off, ask-at-the-desk and empty states", () => {
  const P = loadPortal();
  const states = [P.statusSection(null), P.statusSection(false), P.statusSection({ available: false }), P.statusSection({ available: true, ambiguous: true, tickets: [] }), P.statusSection({ available: true, ambiguous: false, tickets: [] })];
  assert.match(states[0], /data-state="loading"/);
  assert.match(states[1], /data-state="failed"[\s\S]*does not mean you are not in the queue/);
  assert.match(states[2], /data-state="off"/);
  assert.match(states[3], /data-state="ambiguous"[\s\S]*ask at the desk/);
  assert.match(states[4], /data-empty="status"/);
  assert.equal(new Set(states).size, 5);
  const one = P.statusSection({ available: true, tickets: [{ label: "Cardiology 7", state: "waiting", ahead: 2, eta: null }] });
  assert.match(one, /2 people ahead of you/);
  assert.match(one, /No estimate/);
  assert.doesNotMatch(one, /token/i, "an old ticket without a token keeps today's wording");
  const withTok = P.statusSection({ available: true, tickets: [{ label: "Cardiology 7", state: "waiting", token: "A-014", ahead: 2, eta: null }] });
  assert.match(withTok, /Your token: A-014[\s\S]*2 people ahead of you[\s\S]*No estimate/);
  assert.doesNotMatch(one, /status\./, "every string resolves from the catalog");
});

test("portal screen: documents, withdrawn documents, and a printable full summary with withheld sections", () => {
  const P = loadPortal();
  const html = P.renderRecord({ access: { kind: "patient", sections: ["documents", "discharge", "discharge-full"] }, document: {}, failedSections: [],
    documents: [{ documentId: "d1", version: 2, title: "<b>Letter</b>", docType: "referral-letter", uploadedAt: "2026-09-01T00:00:00Z" }, { documentId: "d2", version: 1, unavailable: "withdrawn" }],
    dischargeSummaries: [{ id: "ds", scope: "full", sections: [{ key: "admission", text: "Ward 5." }, { key: "assessment", withheld: true }] }] });
  assert.match(html, /data-act="doc" data-id="d1" data-version="2"/);
  assert.doesNotMatch(html, /<b>Letter/, "titles are escaped");
  assert.match(html, /Referral letter/);
  assert.match(html, /data-doc-state="withdrawn"[^<]*withdrawn by the hospital/);
  assert.match(html, /class="ds-full"[\s\S]*data-withheld="assessment"[\s\S]*Withheld until your care team discusses it/);
  assert.match(html, /data-act="print"/);
  const failed = P.renderRecord({ access: { kind: "patient", sections: ["documents"] }, document: {}, failedSections: ["documents"] });
  assert.match(failed, /data-section="documents"[\s\S]*could not load this part/);
  assert.doesNotMatch(failed, /data-empty="documents"/);
});

test("screens reach every new route; i18n has English and Hindi for every new key; tokens bumped", async () => {
  const portalJs = read("wardsynq/site/portal.js"), html = read("wardsynq/site/portal.html"), ward = read("ward.js"), staffPage = read("wardsynq/site/pages/portal-access.js");
  assert.match(portalJs, /post\("queue"/);
  assert.match(portalJs, /"\/api\/portal\/document"/);
  assert.doesNotMatch(portalJs, /fetch\([^)]*\?/, "no query strings on portal calls");
  assert.match(html, /i18n\.js\?v=\d+"[\s\S]*portal\.js\?v=4/);
  assert.match(html, /@media print/);
  assert.match(ward, /apiPost\("\/ward\/document-release"/);
  assert.match(ward, /dischargeScope: scope/);
  for (const s of ["status", "discharge-full", "documents"]) assert.match(staffPage, new RegExp('\\["' + s + '"'));
  assert.match(read("functions/api/queue/[[path]].js"), /"document-release": CAPS\.EMR_TREAT/);
  const { default: i18n } = await import("../wardsynq/site/i18n.js");
  const { default: hiCatalog } = await import("../wardsynq/site/i18n/hi.js");
  const keys = Object.keys(i18n._catalogs.en).filter((k) => /^(status|docs|dc\.full|dc\.print|dc\.withheld|dc\.section)\b/.test(k));
  assert.ok(keys.length > 40);
  for (const k of keys) assert.ok(Object.prototype.hasOwnProperty.call(hiCatalog, k), "Hindi for " + k);
  assert.doesNotMatch(portalJs + html + staffPage + keys.map((k) => i18n._catalogs.en[k]).join(" "), /—/, "no em dash");
  assert.match(read("wardsynq/site/index.html"), /ward\.js\?v=site79/);
});
