/* test/wardsynq-portal-p29.test.mjs - P2.9 patient and family portal: the server-side rules, driven
 * through the real /api/portal handler over an in-memory record store.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-portal-p29.test.mjs
 *
 * The negative tests are the point: a patient token cannot read another patient, a revoked token is
 * refused, a proxy cannot exceed its grant, and only released discharge summaries are shown.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";

const repository = new MemoryRepository();
const TENANT = "t-portal";
const ORG_ID = "org-portal";
let orgDoc = { mode: "wardsynq", connectTenantId: TENANT, name: "Test Hospital", wardsynq: { patientAccess: { enabled: true }, neverRelease: [] } };

/* Firestore holds the org document; nothing else here touches it. Every export is stubbed because a
 * module mock replaces the whole module for every importer. */
const none = () => null;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsProject: none, fsDocName: none, encodeValue: none, encodeFields: none, decodeValue: none, decodeFields: none,
    wCreate: none, wUpdate: none, wDelete: none, fsCommit: async () => null, fsQuery: async () => [],
    fsGet: async (_env, path) => (path === "q_orgs/" + ORG_ID ? { fields: { ...orgDoc } } : null),
  },
});
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: { claimsOf: async () => ({}), actorDeps: () => ({}), recordDeps: () => ({ repository, pseudonym: async () => null }) },
});

const { onRequest } = await import("../functions/api/portal/[[path]].js");
const { AccessGrant, hashSecret, GRANT_TYPE } = await import("../functions/_wardsynq/patient-access.js");
const { proxyFrom, grantSections, releasedDischargeSummaries, billView, consentView, scopeDocument, SECTIONS } = await import("../functions/_wardsynq/portal-view.js");

const NOW = new Date().toISOString();
const meta = () => ({ recordedAt: NOW, effectiveAt: NOW, source: { system: "wardsynq-native", sourceId: null } });
let seq = 0;
async function seed(rec) { await repository.append(TENANT, [{ version: 1, meta: meta(), ...rec }], { idempotencyKey: "seed-" + (++seq) }); }

async function grant(id, patientId, extra) {
  const token = "tok-" + id;
  const g = AccessGrant({ id, patientId, issuedBy: "dr:1", issuedAt: NOW, codeHash: await hashSecret("00000000", id), redeemedAt: NOW, tokenHash: await hashSecret(token, id), ...(extra || {}) });
  await seed(g);
  return token;
}

async function call(sub, body) {
  const request = new Request("https://x/api/portal/" + sub, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: ORG_ID, ...body }) });
  const res = await onRequest({ request, env: {}, params: { path: [sub] } });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

const T = {};
test("setup: two patients, their records, a proxy and a revoked grant", async () => {
  await seed({ resourceType: "Patient", id: "pat-a", name: "Asha A", mrn: "A1", dob: "1980-01-01" });
  await seed({ resourceType: "Patient", id: "pat-b", name: "Bina B", mrn: "B1", dob: "1970-01-01" });
  await seed({ resourceType: "DiagnosticReport", id: "rep-a", patientId: "pat-a", status: "final", display: "Haemoglobin", conclusion: "A-RESULT" });
  await seed({ resourceType: "DiagnosticReport", id: "rep-b", patientId: "pat-b", status: "final", display: "Sodium", conclusion: "B-RESULT" });
  await seed({ resourceType: "DiagnosticReport", id: "rep-a2", patientId: "pat-a", status: "preliminary", display: "CT head", conclusion: "PRELIM-SECRET" });
  await seed({ resourceType: "Invoice", id: "inv-a", patientId: "pat-a", currency: "INR", void: false,
    lines: [{ code: "BED", display: "Bed day", quantity: 1, amount: 500, line: 500 }],
    events: [{ kind: "raised", amount: 0, actorId: "staff:cashier", at: NOW }, { kind: "payment", amount: 200, actorId: "staff:cashier", at: NOW }] });
  await seed({ resourceType: "PatientConsent", id: "con-a-research", patientId: "pat-a", scope: "research", decision: "granted", recordedAt: NOW, source: { system: "wardsynq-native" } });
  await seed({ resourceType: "PatientConsent", id: "con-a-treat", patientId: "pat-a", scope: "treatment", decision: "granted", recordedAt: NOW, source: { system: "wardsynq-native" } });
  await seed({ resourceType: "PatientConsent", id: "con-b-research", patientId: "pat-b", scope: "research", decision: "granted", recordedAt: NOW, source: { system: "wardsynq-native" } });
  await seed({ resourceType: "ClinicalNote", id: "ds-a", patientId: "pat-a", noteType: "discharge-summary", signedBy: "dr:1",
    sections: { admission: "Ward 3.", medications: "Paracetamol.", plan: "Rest for a week.", assessment: "ASSESSMENT-SECRET", investigations: "INVEST-SECRET" } });
  await seed({ resourceType: "ClinicalNote", id: "ds-a-draft", patientId: "pat-a", noteType: "discharge-summary", signedBy: null, sections: { plan: "DRAFT-SECRET" } });
  await seed({ resourceType: "PatientRecordRelease", id: "rel-a", patientId: "pat-a", at: NOW, dischargeSummaries: [{ id: "ds-a", version: 1 }, { id: "ds-a-draft", version: 1 }] });
  await seed({ resourceType: "PatientMessage", id: "msg-a", patientId: "pat-a", body: "A-MESSAGE", sentAt: NOW });

  T.a = await grant("g-a", "pat-a");
  T.b = await grant("g-b", "pat-b");
  T.proxy = await grant("g-proxy", "pat-a", { issuedTo: "proxy", proxy: { relatedPersonId: "rp-1", name: "Ravi", relationship: "spouse", sections: ["appointments", "bills"], consentFrom: "patient", consentMethod: "in-person-verbal" } });
  T.revoked = await grant("g-rev", "pat-a", { revokedAt: NOW, revokedBy: "dr:1", revokedReason: "lost phone" });
});

test("the patient's own session sees their released record, bills, consents and discharge summary", async () => {
  const r = await call("record", { grantId: "g-a", token: T.a });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.kind, "patient");
  const text = JSON.stringify(r.body);
  assert.ok(text.includes("A-RESULT"));
  assert.ok(!text.includes("PRELIM-SECRET"), "a preliminary result is withheld (#940 rules)");
  assert.equal(r.body.bills.length, 1);
  assert.equal(r.body.bills[0].balance, 300);
  assert.ok(!text.includes("staff:cashier"), "who took a payment is not on the patient's page");
  assert.equal(r.body.dischargeSummaries.length, 1, "only the signed, released version");
  assert.equal(r.body.dischargeSummaries[0].careInstructions, "Rest for a week.");
  assert.ok(!text.includes("DRAFT-SECRET") && !text.includes("ASSESSMENT-SECRET") && !text.includes("INVEST-SECRET"));
  const research = r.body.consents.find((c) => c.consentId === "con-a-research");
  const treat = r.body.consents.find((c) => c.consentId === "con-a-treat");
  assert.equal(research.canWithdraw, true);
  assert.equal(treat.canWithdraw, false, "treatment consent is withdrawn in person");
  assert.deepEqual(r.body.failedSections, []);
});

test("NEGATIVE: a patient token cannot read another patient, whatever the body says", async () => {
  const r = await call("record", { grantId: "g-a", token: T.a, patientId: "pat-b" });
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes("B-RESULT") && !text.includes("Bina"), "the patient id comes from the grant, never the request");
  const cross = await call("record", { grantId: "g-b", token: T.a });
  assert.equal(cross.status, 401, "patient A's token on patient B's grant is refused");
  assert.ok(!JSON.stringify(cross.body).includes("B-RESULT"));
});

test("NEGATIVE: a patient cannot withdraw another patient's consent, or a treatment consent", async () => {
  const other = await call("consent-withdraw", { grantId: "g-a", token: T.a, consentId: "con-b-research" });
  assert.equal(other.status, 404);
  const treat = await call("consent-withdraw", { grantId: "g-a", token: T.a, consentId: "con-a-treat" });
  assert.equal(treat.status, 409);
  assert.equal(treat.body.error, "withdraw_in_person");
});

test("the patient withdraws their own research consent, and it is recorded as theirs", async () => {
  const r = await call("consent-withdraw", { grantId: "g-a", token: T.a, consentId: "con-a-research", reason: "changed my mind" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const stored = await repository.latest(TENANT, "PatientConsent", "con-a-research");
  const body = stored.body || stored;
  assert.equal(body.decision, "withdrawn");
  assert.equal(body.withdrawnBy, "patient:pat-a");
  const again = await call("record", { grantId: "g-a", token: T.a });
  assert.equal(again.body.consents.find((c) => c.consentId === "con-a-research").status, "withdrawn");
});

test("NEGATIVE: a revoked token is refused on every route", async () => {
  for (const sub of ["record", "message", "appointment-request", "consent-withdraw"]) {
    const r = await call(sub, { grantId: "g-rev", token: T.revoked, body: "hi", reason: "x", consentId: "con-a-treat" });
    assert.equal(r.status, 401, sub);
    assert.equal(r.body.error, "revoked", sub);
  }
});

test("NEGATIVE: a proxy sees only its granted sections and cannot exceed them", async () => {
  const r = await call("record", { grantId: "g-proxy", token: T.proxy });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.access.kind, "proxy");
  assert.deepEqual(r.body.access.sections, ["appointments", "bills"]);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes("A-RESULT"), "results were not granted");
  assert.ok(!text.includes("A-MESSAGE"), "messages were not granted");
  assert.ok(!("consents" in r.body) && !("dischargeSummaries" in r.body) && !("messages" in r.body));
  assert.ok(!("patientId" in r.body) && !text.includes("A1"), "no MRN or patient id for a partial proxy");
  assert.equal(r.body.bills.length, 1, "bills were granted");

  const msg = await call("message", { grantId: "g-proxy", token: T.proxy, body: "hello" });
  assert.equal(msg.status, 403);
  assert.equal(msg.body.error, "not_in_grant");
  const withdraw = await call("consent-withdraw", { grantId: "g-proxy", token: T.proxy, consentId: "con-a-treat" });
  assert.equal(withdraw.status, 403);
  assert.equal(withdraw.body.error, "patient_only");
  const appt = await call("appointment-request", { grantId: "g-proxy", token: T.proxy, reason: "review" });
  assert.equal(appt.status, 200, "appointments were granted");
  const stored = repository._rows.filter((row) => row.resourceType === "AppointmentRequest").pop();
  assert.equal(stored.body.requestedBy, "proxy:rp-1:for:pat-a", "a proxy's request is recorded as the proxy, not the patient");
});

test("reads through the portal are audited under the reader's own id", async () => {
  const actors = new Set(repository.audit.filter((e) => e.action === "record.read").map((e) => e.actor));
  assert.ok(actors.has("patient:pat-a"));
  assert.ok(actors.has("proxy:rp-1:for:pat-a"));
});

test("the whole portal is off unless the hospital turns it on", async () => {
  const saved = orgDoc;
  orgDoc = { ...orgDoc, wardsynq: { patientAccess: { enabled: false } } };
  try {
    const r = await call("record", { grantId: "g-a", token: T.a });
    assert.equal(r.status, 404);
    const w = await call("consent-withdraw", { grantId: "g-a", token: T.a, consentId: "con-a-research" });
    assert.equal(w.status, 404);
  } finally { orgDoc = saved; }
});

test("PURE: proxy validation requires a contact, named sections, and recorded consent", () => {
  assert.equal(proxyFrom({}).error, "related_person_required");
  assert.equal(proxyFrom({ relatedPersonId: "rp" }).error, "sections_required");
  assert.equal(proxyFrom({ relatedPersonId: "rp", sections: ["everything"] }).error, "unknown_section");
  assert.equal(proxyFrom({ relatedPersonId: "rp", sections: ["bills"] }).error, "consent_from_required");
  assert.equal(proxyFrom({ relatedPersonId: "rp", sections: ["bills"], consentFrom: "proxy" }).error, "consent_from_required", "the proxy cannot consent for themselves");
  assert.equal(proxyFrom({ relatedPersonId: "rp", sections: ["bills"], consentFrom: "patient" }).error, "consent_method_required");
  assert.deepEqual(proxyFrom({ relatedPersonId: "rp", sections: ["bills", "bills"], consentFrom: "patient", consentMethod: "in-person-written" }).proxy.sections, ["bills"]);
  assert.deepEqual(grantSections({ proxy: { sections: [] } }), [], "a proxy with nothing granted sees nothing");
  assert.deepEqual(grantSections({}), SECTIONS.slice());
});

test("PURE: a discharge summary corrected after release is not shown until released again", () => {
  const notes = [{ id: "ds", version: 2, noteType: "discharge-summary", signedBy: "dr", sections: { plan: "v2" } }];
  assert.equal(releasedDischargeSummaries(notes, [{ dischargeSummaries: [{ id: "ds", version: 1 }] }]).length, 0);
  assert.equal(releasedDischargeSummaries(notes, [{ dischargeSummaries: [{ id: "ds", version: 2 }] }]).length, 1);
  assert.equal(billView([{ id: "x", lines: [], events: [], meta: { source: { system: "ghis" } } }]).length, 0, "an external system's bill is not ours to state");
  assert.equal(consentView([{ id: "c", scope: "research", decision: "granted" }], false)[0].canWithdraw, false, "a proxy never withdraws");
  assert.deepEqual(Object.keys(scopeDocument({ patient: { name: "n", mrn: "m" }, results: [1] }, ["bills"])), ["patient"]);
});

test("the grant type is the one the store knows", () => { assert.equal(GRANT_TYPE, "PatientAccessGrant"); });
