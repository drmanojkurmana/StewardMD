/* test/wardsynq-fhir-ips.test.mjs - Patient/{id}/$summary (IPS), AuditEvent and Consent, through both doors.
 *
 * The ward door (/api/queue/ward/fhir/...) with a staff session and the SMART door (/api/fhir/{org}/...)
 * with a bearer. The clinical safety line under test: an empty section and an unreadable one are
 * different sentences, and the audit trail is never readable by a patient/ or user/ token.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-fhir-ips.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
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

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANTS = {
  "tenant-wsq": { id: "tenant-wsq", name: "WSQ", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) },
  "tenant-b": { id: "tenant-b", name: "B", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-b" } }) },
};
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({ first: async () => (TENANTS[String(a[0])] ? { ...TENANTS[String(a[0])] } : null), all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest: queue } = await import("../functions/api/queue/[[path]].js");
const { onRequest: fhirDoor } = await import("../functions/api/fhir/[[path]].js");
const { hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { SmartGrant, readTypesFor } = await import("../functions/_wardsynq/smart-server.js");
const { resetMemory } = await import("../functions/_wardsynq/rate-limit.js");

const ORG = "org-wsq", TENANT = "tenant-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test", CASHIER = "cashier@example.test", HR = "hr@example.test", ADMIN_B = "admin-b@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1" };
const CLIENTS = [
  { clientId: "viewer", kind: "public", redirectUris: ["https://app/cb"], scopes: ["user/*.read", "patient/*.read", "launch"] },
  { clientId: "siem", kind: "backend", scopes: ["system/*.read"], jwks: { keys: [{ kty: "EC", kid: "k" }] } },
];

const member = (org, email, role) => docs.set(`q_members/${sanitize(org)}__${sanitize(idFor(email))}`, { fields: { orgId: org, identity: idFor(email), role, active: true }, updateTime: "t1" });
const orgDoc = (id, tenant) => docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id, name: "Hospital " + id, kind: "clinic", mode: "wardsynq", connectTenantId: tenant, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { fhir: { smart: { enabled: true, clients: CLIENTS } } } }, updateTime: "t1" });
const T0 = "2026-09-01T08:00:00.000Z", T1 = "2026-09-05T08:00:00.000Z";
const at = (iso) => ({ meta: { recordedAt: iso }, writtenBy: { id: "cfa:seed", kind: "human", at: iso } });

async function seed() {
  await RECORD.append(TENANT, [{ resourceType: "Patient", id: "p1", version: 1, mrn: "MR1", name: "Asha", sex: "female", ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "Patient", id: "p2", version: 1, mrn: "MR2", name: "Ravi", sex: "male", ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "Condition", id: "c1", version: 1, patientId: "p1", display: "Community acquired pneumonia", codeSystem: "text", clinicalStatus: "active", verificationStatus: "provisional", ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "Condition", id: "c2", version: 1, patientId: "p1", display: "Old fracture", codeSystem: "text", clinicalStatus: "resolved", ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "MedicationOrder", id: "m1", version: 1, patientId: "p1", drug: "Amoxicillin", status: "active", dose: { value: 500, unit: "mg" }, ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "Observation", id: "o1", version: 1, patientId: "p1", category: "laboratory", code: "2160-0", codeSystem: "loinc", display: "Creatinine", value: 1.1, unit: "mg/dL", ...at(T1) }]);
  await RECORD.append(TENANT, [{ resourceType: "Observation", id: "o2", version: 1, patientId: "p1", category: "vital-signs", code: "8867-4", codeSystem: "loinc", value: 80, unit: "/min", ...at(T1) }]);
  await RECORD.append(TENANT, [{ resourceType: "PatientConsent", id: "consent-1", version: 1, patientId: "p1", scope: "treatment", decision: "granted", givenBy: "patient", recordedAt: T0, ...at(T0) }]);
  await RECORD.auditOnly(TENANT, { id: "aud-1", ts: T1, actor: idFor(DOCTOR), connectorId: "wardsynq", action: "record.read", scope: { resourceType: "Observation", id: "o1" }, resourceCounts: { Observation: 1 }, patientRefHash: "ph-abc", latencyMs: 12, outcome: "ok" });
  await RECORD.auditOnly(TENANT, { id: "aud-2", ts: T0, actor: idFor(CASHIER), connectorId: "wardsynq", action: "record.read", scope: { resourceType: "ClinicalNote" }, outcome: "denied" });
}

async function as(email, path) {
  return queue({ request: new Request("https://x/api/queue" + path, { headers: { "Cf-Access-Authenticated-User-Email": email || "" } }), env: ENV });
}
const noSession = (path) => queue({ request: new Request("https://x/api/queue" + path), env: ENV });
async function mintBearer(scopes, opts) {
  const o = opts || {};
  const tok = "tok-" + Math.random().toString(36).slice(2);
  const now = Date.now();
  const backend = scopes.some((s) => s.startsWith("system/"));
  await RECORD.append(o.tenant || TENANT, [{ ...SmartGrant({ id: `wsq-smart-token-${await hashSecret(tok, "smart:token")}`, kind: "token", clientId: backend ? "siem" : "viewer", clientKind: backend ? "backend" : "public", subject: backend ? "smart:siem" : idFor(DOCTOR), subjectKind: backend ? "service" : "human", scopes, readTypes: readTypesFor(scopes), patientId: o.patientId || null, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString() }), version: 1, ...at(new Date(now).toISOString()) }]);
  return tok;
}
const smart = (org, path, tok) => fhirDoor({ request: new Request(`https://x/api/fhir/${org}/${path}`, { headers: tok ? { Authorization: "Bearer " + tok } : {} }), env: ENV, params: { path: [org, ...path.split("?")[0].split("/")] } });
const W = (p) => `/ward/fhir/${p}${p.includes("?") ? "&" : "?"}orgId=${ORG}`;
const sectionByCode = (bundle, code) => bundle.entry[0].resource.section.find((s) => s.code.coding[0].code === code);

beforeEach(async () => {
  docs.clear(); clock = 1; resetMemory();
  RECORD = new MemoryRepository();
  orgDoc(ORG, TENANT); orgDoc("org-b", "tenant-b");
  member(ORG, ADMIN, "admin"); member(ORG, DOCTOR, "doctor"); member(ORG, CASHIER, "cashier"); member(ORG, HR, "hr"); member("org-b", ADMIN_B, "admin");
  await seed();
});

test("IPS AUTH on /api/queue/ward/fhir/Patient/{id}/$summary: no session 401, no emr.view 403, another hospital 403, a doctor gets a document", async () => {
  const path = W("Patient/p1/$summary");
  assert.equal((await noSession(path)).status, 401);
  assert.equal((await as(CASHIER, path)).status, 403);
  assert.equal((await as(ADMIN_B, path)).status, 403);
  const r = await as(DOCTOR, path);
  assert.equal(r.status, 200, await r.clone().text());
  const b = await r.json();
  assert.equal(b.type, "document");
  assert.ok(b.identifier && b.identifier.value && b.timestamp);
  const comp = b.entry[0].resource;
  assert.equal(comp.resourceType, "Composition");
  assert.equal(comp.type.coding[0].code, "60591-5");
  assert.equal(comp.subject.reference, "Patient/p1");
  assert.equal(comp.author[0].reference, `Organization/${ORG}`);
  assert.ok(b.entry.some((e) => e.resource.resourceType === "Organization"), "the author travels in the document");
  assert.equal(comp.meta, undefined, "no IPS profile is claimed");

  const problems = sectionByCode(b, "11450-4");
  assert.equal(problems.entry.length, 1, "the resolved fracture is not an active problem");
  const meds = sectionByCode(b, "10160-0");
  assert.equal(meds.entry[0].reference, "MedicationRequest/m1");
  const results = sectionByCode(b, "30954-2");
  assert.deepEqual(results.entry.map((e) => e.reference), ["Observation/o1"], "a heart rate is not a laboratory result");
  // Every referenced resource is in the Bundle.
  const held = new Set(b.entry.map((e) => `${e.resource.resourceType}/${e.resource.id}`));
  for (const s of comp.section) for (const e of s.entry || []) assert.ok(held.has(e.reference), e.reference);
  assert.equal((await as(DOCTOR, W("Patient/nobody/$summary"))).status, 404, "a patient this hospital never registered is not an empty summary");
});

test("IPS EMPTY VERSUS UNAVAILABLE: no allergy rows is 'none recorded' as text, an allergy read that fails is emptyReason unavailable with no entries, never 'none recorded'", async () => {
  const b1 = await (await as(DOCTOR, W("Patient/p1/$summary"))).json();
  const empty = sectionByCode(b1, "48765-2");
  assert.ok(empty, "a required section is never omitted");
  assert.equal(empty.entry, undefined);
  assert.equal(empty.emptyReason.coding, undefined, "no code: an empty record is not a clinician's 'nil known'");
  assert.match(empty.emptyReason.text, /None recorded/);
  assert.match(empty.emptyReason.text, /not a clinical statement that there are none/);

  await RECORD.append(TENANT, [{ resourceType: "AllergyIntolerance", id: "a1", version: 1, patientId: "p1", substance: "Penicillin", substanceCodeSystem: "text", clinicalStatus: "active", criticality: "high", ...at(T1) }]);
  const realByPatient = RECORD.byPatient.bind(RECORD);
  RECORD.byPatient = async (tenant, type, pid) => { if (type === "AllergyIntolerance") throw new Error("storage unreachable"); return realByPatient(tenant, type, pid); };
  const b2 = await (await as(DOCTOR, W("Patient/p1/$summary"))).json();
  const down = sectionByCode(b2, "48765-2");
  assert.equal(down.emptyReason.coding[0].code, "unavailable");
  assert.equal(down.entry, undefined, "an allergy that exists is not listed from a read that failed, and nothing claims completeness");
  assert.doesNotMatch(JSON.stringify(down), /None recorded|no known/i);
  assert.match(down.text.div, /could not be read/);
  assert.ok(!b2.entry.some((e) => e.resource.resourceType === "AllergyIntolerance"));
  assert.equal(sectionByCode(b2, "11450-4").entry.length, 1, "the other sections still render");

  RECORD.byPatient = realByPatient;
  const b3 = await (await as(DOCTOR, W("Patient/p1/$summary"))).json();
  assert.equal(sectionByCode(b3, "48765-2").entry[0].reference, "AllergyIntolerance/a1");
});

test("IPS ON THE SMART DOOR /api/fhir/{org}/Patient/{id}/$summary: fenced to the token's patient, a type the token cannot read is withheld, no bearer 401", async () => {
  assert.equal((await smart(ORG, "Patient/p1/$summary")).status, 401);
  const all = await mintBearer(["patient/*.read"], { patientId: "p1" });
  assert.equal((await smart(ORG, "Patient/p1/$summary", all)).status, 200);
  assert.equal((await smart(ORG, "Patient/p2/$summary", all)).status, 403, "another patient is outside the launch context");
  const other = await mintBearer(["user/*.read"], { tenant: "tenant-b" });
  assert.equal((await smart(ORG, "Patient/p1/$summary", other)).status, 401, "another hospital's token");

  const narrow = await mintBearer(["patient/Patient.read", "patient/Condition.read", "patient/AllergyIntolerance.read"], { patientId: "p1" });
  const r = await smart(ORG, "Patient/p1/$summary", narrow);
  assert.equal(r.status, 200, await r.clone().text());
  const b = await r.json();
  const meds = sectionByCode(b, "10160-0");
  assert.equal(meds.emptyReason.coding[0].code, "withheld");
  assert.equal(meds.entry, undefined);
  assert.equal(sectionByCode(b, "11450-4").entry.length, 1);
  assert.ok(!b.entry.some((e) => e.resource.resourceType === "MedicationRequest"));
});

test("AUDITEVENT on /api/fhir/{org}/AuditEvent: patient/ and user/ scopes 403, no bearer 401, another hospital's token 401, a system/ token reads the envelope only", async () => {
  assert.equal((await smart(ORG, "AuditEvent")).status, 401);
  const patient = await mintBearer(["patient/*.read"], { patientId: "p1" });
  const pr = await smart(ORG, "AuditEvent", patient);
  assert.equal(pr.status, 403);
  assert.match((await pr.json()).issue[0].diagnostics, /system\/AuditEvent\.read/);
  assert.equal((await smart(ORG, "AuditEvent/aud-1", patient)).status, 403, "a read by id is refused the same way");
  assert.equal((await smart(ORG, "AuditEvent", await mintBearer(["user/*.read"]))).status, 403);
  assert.equal((await smart(ORG, "AuditEvent", await mintBearer(["system/*.read"], { tenant: "tenant-b" }))).status, 401);
  const before = RECORD.audit.length;
  assert.equal(RECORD.audit.filter((a) => a.action === "fhir.auditevent.read").length, 0, "no refusal read the trail");

  const sys = await mintBearer(["system/*.read"]);
  const r = await smart(ORG, "AuditEvent?type=record.read", sys);
  assert.equal(r.status, 200, await r.clone().text());
  const b = await r.json();
  assert.ok(b.total >= 2);
  const ev = b.entry.map((e) => e.resource).find((e) => e.id === "aud-1");
  assert.equal(ev.type.code, "record.read");
  assert.equal(ev.outcome, "0");
  assert.equal(ev.agent[0].who.identifier.value, idFor(DOCTOR));
  assert.equal(ev.entity[0].what.reference, "Observation/o1");
  assert.equal(ev.entity[1].what.identifier.value, "ph-abc");
  assert.doesNotMatch(JSON.stringify(ev), /latency|resourceCounts|Asha|MR1/, "nothing beyond the audit screen's envelope");
  assert.equal(b.entry.map((e) => e.resource).find((e) => e.id === "aud-2").outcome, "4");
  assert.ok(RECORD.audit.length > before && RECORD.audit.some((a) => a.action === "fhir.auditevent.read" && a.actor === "smart:siem"), "reading the trail is audited");

  const dated = await (await smart(ORG, "AuditEvent?date=ge2026-09-03", sys)).json();
  assert.ok(dated.entry.every((e) => e.resource.recorded >= "2026-09-03"));
  assert.ok(dated.entry.some((e) => e.resource.id === "aud-1") && !dated.entry.some((e) => e.resource.id === "aud-2"));
  assert.equal((await smart(ORG, "AuditEvent?patient=p1", sys)).status, 400, "an unsupported parameter is refused, not dropped");
  assert.equal((await (await smart(ORG, "AuditEvent/aud-2", sys)).json()).id, "aud-2");
});

test("AUDITEVENT on /api/queue/ward/fhir/AuditEvent: no session 401, a doctor 403 (emr.view is not staff.admin), hr 403 (no clinical actor), another hospital 403, an admin 200", async () => {
  const path = W("AuditEvent");
  assert.equal((await noSession(path)).status, 401);
  assert.equal((await as(DOCTOR, path)).status, 403);
  assert.equal((await as(HR, path)).status, 403);
  assert.equal((await as(ADMIN_B, path)).status, 403);
  const r = await as(ADMIN, path);
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok((await r.json()).entry.some((e) => e.resource.id === "aud-1"));
});

test("CONSENT on /api/queue/ward/fhir/Consent and /api/fhir/{org}/Consent: read and search mapped from PatientConsent, read-only", async () => {
  const ward = await (await as(DOCTOR, W("Consent?patient=p1"))).json();
  assert.equal(ward.resourceType, "Bundle");
  const c = ward.entry.find((e) => e.resource.resourceType === "Consent").resource;
  assert.equal(c.status, "active");
  assert.equal(c.provision.type, "permit");
  assert.equal(c.patient.reference, "Patient/p1");
  assert.equal((await as(CASHIER, W("Consent?patient=p1"))).status, 403);
  const tok = await mintBearer(["patient/*.read"], { patientId: "p1" });
  const read = await smart(ORG, "Consent/consent-1", tok);
  assert.equal(read.status, 200, await read.clone().text());
  assert.equal((await read.json()).resourceType, "Consent");
  const put = await fhirDoor({ request: new Request(`https://x/api/fhir/${ORG}/Consent/consent-1`, { method: "PUT", headers: { Authorization: "Bearer " + tok }, body: "{}" }), env: ENV, params: { path: [ORG, "Consent", "consent-1"] } });
  assert.equal(put.status, 405, "the SMART door writes nothing");
});

/* ---------------------------------------------------------------- screen */

function loadWard() {
  const src = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return { Ward: sb.window.WARD, src };
}

test("IPS SCREEN in ward.js: reached from the chart; loading, failed, none recorded, unreadable and withheld read differently", async () => {
  const { Ward, src } = loadWard();
  assert.match(src, /data-w-act="ipsopen"[^\n]*IPS summary/, "the chart has the button");
  assert.ok(src.includes('apiGet("/ward/fhir/Patient/" + encodeURIComponent(pid) + "/$summary?orgId="'));
  const view = (ips) => Ward._render({ ...Ward._st, view: "ips", ips });
  assert.match(view(null), /Loading the summary/);
  const failed = view({ failed: "outside the token's patient context" });
  assert.match(failed, /could not be produced: outside the token/);
  assert.match(failed, /Nothing is known from this screen/);
  assert.ok(!/None recorded/.test(failed));

  const realByPatient = RECORD.byPatient.bind(RECORD);
  RECORD.byPatient = async (tenant, type, pid) => { if (type === "MedicationOrder") throw new Error("storage unreachable"); return realByPatient(tenant, type, pid); };
  const doc = await (await as(DOCTOR, W("Patient/p2/$summary"))).json();
  RECORD.byPatient = realByPatient;
  const html = view(doc);
  assert.match(html, /None recorded in this record\. That is not a statement that the patient has none/, "p2 has no problems or allergies recorded");
  assert.match(html, /Could not be read\. This is not the same as none/, "the medication read failed");
  const withheld = JSON.parse(JSON.stringify(doc));
  withheld.entry[0].resource.section.find((s) => s.code.coding[0].code === "10160-0").emptyReason = { coding: [{ code: "withheld" }] };
  assert.match(view(withheld), /your access does not include this section/);

  await RECORD.append(TENANT, [{ resourceType: "AllergyIntolerance", id: "a1", version: 1, patientId: "p1", substance: "Penicillin", substanceCodeSystem: "text", clinicalStatus: "active", ...at(T1) }]);
  const full = view(await (await as(DOCTOR, W("Patient/p1/$summary"))).json());
  assert.match(full, /Penicillin/);
  assert.match(full, /Amoxicillin/);
  assert.match(full, /Creatinine 1\.1 mg\/dL/);
  assert.ok(!/None recorded|Could not be read/.test(full));
  assert.ok(!/[—]/.test(full), "no em dash");
});
