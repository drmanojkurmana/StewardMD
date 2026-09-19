/* test/wardsynq-fhir-version.test.mjs - D9: R4B and R5 by the fhirVersion MIME parameter.
 *
 * Pure: header negotiation, the R5 transforms validated against the generated R5 tables (and the R4 shape
 * refused by them), R4B against the R4B tables, the per-version CapabilityStatement. Routes:
 * GET /api/queue/ward/fhir/{Type}[/{id}] and /metadata with Accept fhirVersion=4.3 / 5.0, POST
 * /api/queue/ward/fhir/$validate with Content-Type fhirVersion=5.0, the 406s and 415s for what is R4 only,
 * and GET /api/fhir/{org}/metadata on the SMART door.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-fhir-version.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
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
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
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
const TENANT_ROW = { id: "tenant-id", name: "ID Hospital", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-id" } }) };
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
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { onRequest: fhirDoor } = await import("../functions/api/fhir/[[path]].js");
const { toFhir, capabilityStatement, FHIR_TYPE } = await import("../functions/_wardsynq/fhir.js");
const { validateResource, TABLES } = await import("../functions/_wardsynq/fhir-validate.js");
const V = await import("../functions/_wardsynq/fhir-version.js");

const ORG = "org-id";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@id.test", NURSE = "nurse@id.test", RECEPTION = "reception@id.test", CASHIER = "cashier@id.test", ADMIN = "admin@id.test";
const ENV = {
  QUEUE_ENABLED: "1",
  QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  // isQueueConfigured() needs both, or every route answers not_configured with a 200.
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"),
  CONNECT_DB: tenantDb,
};
const PATIENT = "wsq-pat-id-0001";

function seed() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-ID01", name: "ID Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { fhir: { inbound: { enabled: true } } } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [RECEPTION, "reception"], [CASHIER, "cashier"], [ADMIN, "admin"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  RECORD.append(TENANT_ROW.id, [{
    resourceType: "Patient", id: PATIENT, version: 1, mrn: "SMD-ID01-00001", name: "Ramesh Kumar",
    dob: "1970-01-01", sex: "male", identifiers: [], meta: { recordedAt: "2026-09-01T00:00:00.000Z", effectiveAt: "2026-09-01T00:00:00.000Z" },
  }]);
}

async function as(email, path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET",
      headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

/* The same, with the version headers and the raw Response kept (for Content-Type). */
async function fhir(email, path, opts) {
  const o = opts || {};
  const headers = { ...(email ? { "Cf-Access-Authenticated-User-Email": email } : {}), ...(o.accept ? { Accept: o.accept } : {}), ...(o.contentType ? { "Content-Type": o.contentType } : {}), ...(o.headers || {}) };
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir/${path}${path.includes("?") ? "&" : "?"}orgId=${ORG}`, { method: o.method || "GET", headers, body: o.body ? JSON.stringify(o.body) : undefined }), env: ENV });
  let j; try { j = await res.clone().json(); } catch { j = {}; }
  return { res, j };
}
const R5 = "application/fhir+json; fhirVersion=5.0", R4B = "application/fhir+json; fhirVersion=4.3";
const meta = { recordedAt: "2026-09-09T08:00:00.000Z", effectiveAt: "2026-09-09T08:00:00.000Z", source: { system: "wardsynq-native" } };
const FIXTURES = [
  { resourceType: "Patient", id: "p1", version: 1, mrn: "MR1", name: "Asha", sex: "female", dob: "1970-01-02", meta },
  { resourceType: "Encounter", id: "e1", version: 2, patientId: "p1", class: "IPD", status: "finished", periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-03T00:00:00Z", reason: "fever", location: { ward: "W3", bed: "4" }, meta },
  { resourceType: "Condition", id: "c1", version: 1, patientId: "p1", code: "J18.9", codeSystem: "icd-10", display: "Pneumonia", verificationStatus: "provisional", onsetDate: "2026-09-01", meta },
  { resourceType: "AllergyIntolerance", id: "a1", version: 1, patientId: "p1", substance: "Penicillin", reaction: "rash", severity: "mild", criticality: "high", meta },
  { resourceType: "Observation", id: "o1", version: 1, patientId: "p1", encounterId: "e1", category: "vital-signs", code: "8867-4", codeSystem: "loinc", display: "Heart rate", value: 80, unit: "/min", meta },
  { resourceType: "MedicationOrder", id: "m1", version: 1, patientId: "p1", drug: "Amoxicillin", status: "active", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TDS", prescriberId: "cfa:dr", meta },
  { resourceType: "Immunization", id: "i1", version: 1, patientId: "p1", vaccine: "Hepatitis B", vaccineCode: "43", vaccineCodeSystem: "cvx", status: "completed", occurredOn: "2026-09-01", doseNumber: 2, lotNumber: "L1", primarySource: true, performerId: "cfa:n", recordedAt: "2026-09-01T10:00:00Z", meta },
];
const errors = (r, version) => validateResource(r, { version }).issues.filter((i) => i.severity === "error" || i.severity === "fatal");

test("NEGOTIATION: Accept and Content-Type fhirVersion pick 4.0, 4.3 or 5.0; anything else is refused by name", () => {
  assert.deepEqual(V.versionFromHeader(null), { version: "4.0" });
  assert.deepEqual(V.versionFromHeader("application/fhir+json"), { version: "4.0" });
  assert.deepEqual(V.versionFromHeader(R5), { version: "5.0" });
  assert.deepEqual(V.versionFromHeader("application/fhir+json;fhirVersion=4.3.0"), { version: "4.3" });
  assert.deepEqual(V.versionFromHeader("application/fhir+json; fhirVersion=4.0.1"), { version: "4.0" });
  assert.deepEqual(V.versionFromHeader("application/fhir+json; fhirVersion=3.0; q=1, application/fhir+json; fhirVersion=5.0; q=0.5"), { version: "5.0" }, "the best version served wins");
  assert.match(V.versionFromHeader("application/fhir+json; fhirVersion=3.0").error, /3\.0 is not served/);
  assert.ok(V.versionFromHeader("application/fhir+json; fhirVersion=5.0.1").error, "a patch release not published is not claimed");
  assert.equal(V.contentTypeFor("5.0"), "application/fhir+json; fhirVersion=5.0; charset=utf-8");
});

test("R5 TRANSFORMS: every R5 type renders valid against the generated R5 tables, and the R4 shape is refused by them", () => {
  for (const rec of FIXTURES) {
    const r4 = toFhir(rec);
    const out = V.renderResource(r4, "5.0");
    assert.ok(out.resource, `${rec.resourceType}: ${JSON.stringify(out)}`);
    assert.deepEqual(errors(out.resource, "5.0"), [], rec.resourceType);
  }
  const enc = V.renderResource(toFhir(FIXTURES[1]), "5.0").resource;
  assert.equal(enc.status, "completed", "finished is completed in R5");
  assert.deepEqual(enc.class, [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" }] }]);
  assert.ok(enc.actualPeriod && !enc.period);
  assert.deepEqual(enc.reason, [{ value: [{ concept: { text: "fever" } }] }]);
  assert.ok(errors(toFhir(FIXTURES[1]), "5.0").length >= 3, "the R4 Encounter is not valid R5: the tables are separate");
  const cond = V.renderResource(toFhir(FIXTURES[2]), "5.0").resource;
  assert.equal(cond.clinicalStatus.coding[0].code, "unknown", "R5 requires clinicalStatus; unknown is the only true value");
  assert.deepEqual(V.renderResource(toFhir(FIXTURES[3]), "5.0").resource.reaction[0].manifestation, [{ concept: { text: "rash" } }]);
  const mr = V.renderResource(toFhir(FIXTURES[5]), "5.0").resource;
  assert.deepEqual(mr.medication, { concept: { text: "Amoxicillin" } });
  assert.equal(mr.medicationCodeableConcept, undefined);
  const imm = V.renderResource(toFhir(FIXTURES[6]), "5.0").resource;
  assert.equal(imm.protocolApplied[0].doseNumber, "2");
  assert.equal(imm.recorded, undefined, "Immunization.recorded has no R5 element");
  assert.deepEqual(V.renderResource({ resourceType: "DiagnosticReport", id: "d", status: "final", code: { text: "x" } }, "5.0"), { unsupported: ["DiagnosticReport"] });
});

test("R4B: what this server emits is valid against the R4B tables, which are not the R4 tables", () => {
  for (const rec of FIXTURES) assert.deepEqual(errors(V.renderResource(toFhir(rec), "4.3").resource, "4.3"), [], rec.resourceType);
  const enc = toFhir(FIXTURES[1]);
  const badId = { ...enc, class: { ...enc.class, id: "not an id!" } };
  assert.equal(errors(badId, "4.0").length, 0, "R4 Element.id is a string");
  assert.equal(errors(badId, "4.3").length, 1, "R4B Element.id is an id");
  assert.notEqual(TABLES["4.3"].RESOURCES.Observation.subject, TABLES["4.0"].RESOURCES.Observation.subject);
  for (const t of Object.values(FHIR_TYPE)) assert.ok(TABLES["4.3"].RESOURCES[t], `${t} has an R4B table`);
  assert.deepEqual(Object.keys(TABLES["5.0"].RESOURCES).sort(), ["AllergyIntolerance", "Bundle", "Condition", "Encounter", "Immunization", "MedicationRequest", "Observation", "OperationOutcome", "Patient"]);
});

test("CAPABILITYSTATEMENT per version: 4.3 drops what is R4 only, 5.0 declares only what it renders", () => {
  const r4 = capabilityStatement({ date: "2026-09-14", inbound: true });
  const b = V.capabilityFor(r4, "4.3");
  assert.equal(b.fhirVersion, "4.3.0");
  assert.ok(!b.rest[0].operation.some((o) => o.name === "export"));
  assert.ok(!b.rest[0].interaction, "no transaction or batch");
  assert.ok(!JSON.stringify(b.rest[0].resource.map((r) => r.interaction)).match(/create|update/));
  assert.ok(!b.rest[0].resource.find((r) => r.type === "Subscription").operation, "no $status");
  assert.ok(!b.rest[0].resource.some((r) => ["CodeSystem", "ValueSet", "AuditEvent", "Group"].includes(r.type)), "no R4B table, not declared in R4B");
  assert.ok(b.rest[0].resource.some((r) => r.type === "Provenance"));
  assert.deepEqual(b.rest[0].operation.map((o) => o.name).sort(), ["everything", "validate"]);
  const f = V.capabilityFor(r4, "5.0");
  assert.equal(f.fhirVersion, "5.0.0");
  assert.deepEqual(f.rest[0].resource.map((r) => r.type).sort(), [...V.R5_TYPES].sort());
  assert.deepEqual(f.rest[0].operation.map((o) => o.name), ["validate"]);
  assert.match(f.implementation.description, /Immunization\.recorded has no R5 element/);
  assert.equal(r4.fhirVersion, "4.0.1", "the R4 statement is not changed by rendering another");
});

test("READS on GET /api/queue/ward/fhir with Accept fhirVersion: R5 and R4B bodies and Content-Type; 406 for a type or version not rendered", async () => {
  seed();
  for (const rec of FIXTURES.slice(1)) await RECORD.append(TENANT_ROW.id, [{ ...rec, patientId: rec.patientId && PATIENT }]);
  const p = await fhir(DOCTOR, `Patient/${PATIENT}`, { accept: R5 });
  assert.equal(p.res.status, 200, JSON.stringify(p.j));
  assert.match(p.res.headers.get("Content-Type"), /fhirVersion=5\.0/);
  const encs = await fhir(DOCTOR, `Encounter?patient=${PATIENT}`, { accept: R5 });
  assert.equal(encs.res.status, 200, JSON.stringify(encs.j));
  assert.ok(Array.isArray(encs.j.entry[0].resource.class) && encs.j.entry[0].resource.actualPeriod);
  const imm = await fhir(NURSE, `Immunization?patient=${PATIENT}`, { accept: R5 });
  assert.equal(imm.j.entry[0].resource.protocolApplied[0].doseNumber, "2");
  const b = await fhir(DOCTOR, `Encounter?patient=${PATIENT}`, { accept: R4B });
  assert.equal(b.res.status, 200);
  assert.match(b.res.headers.get("Content-Type"), /fhirVersion=4\.3/);
  assert.equal(b.j.entry[0].resource.class.code, "IMP", "R4B is the R4 shape");
  const r4 = await fhir(DOCTOR, `Encounter?patient=${PATIENT}`);
  assert.ok(!/fhirVersion/.test(r4.res.headers.get("Content-Type")), "no Accept version is R4, as before");

  const dr = await fhir(DOCTOR, `DiagnosticReport?patient=${PATIENT}`, { accept: R5 });
  assert.equal(dr.res.status, 406);
  assert.match(dr.j.issue[0].diagnostics, /not rendered in FHIR 5\.0\.0: DiagnosticReport/);
  assert.equal((await fhir(DOCTOR, `Patient/${PATIENT}`, { accept: "application/fhir+json; fhirVersion=3.0" })).res.status, 406);
  const md = await fhir(DOCTOR, "metadata", { accept: R5 });
  assert.equal(md.j.fhirVersion, "5.0.0");
  assert.equal((await fhir(DOCTOR, "metadata", { accept: R4B })).j.fhirVersion, "4.3.0");
  const ips = await fhir(DOCTOR, `Patient/${PATIENT}/$summary`, { accept: R4B });
  assert.equal(ips.res.status, 406, "the IPS Composition has no R4B definition here, so it is not sent as R4B");
  assert.match(ips.j.issue[0].diagnostics, /Composition/);
});

test("NEGATIVE: a version header changes nobody's access - no session 401, cashier 403, another hospital 403/404, whatever the Accept", async () => {
  seed();
  assert.equal((await fhir("", `Patient/${PATIENT}`, { accept: R5 })).res.status, 401);
  assert.equal((await fhir(CASHIER, `Patient/${PATIENT}`, { accept: R5 })).res.status, 403);
  const stranger = await fhir("stranger@other.test", `Patient/${PATIENT}`, { accept: R5 });
  assert.ok(stranger.res.status === 403 || stranger.res.status === 404, String(stranger.res.status));
  assert.equal((await fhir("", `Patient/${PATIENT}`, { accept: "application/fhir+json; fhirVersion=9.9" })).res.status, 401, "the capability gate answers before the version is looked at");
});

test("$VALIDATE with Content-Type fhirVersion=5.0 checks R5; WRITES, BULK and Subscription $status are R4 only (415 / 406), and nothing is written", async () => {
  seed();
  const r5enc = V.renderResource(toFhir({ ...FIXTURES[1], patientId: PATIENT }), "5.0").resource;
  const ok = await fhir(DOCTOR, "Encounter/$validate", { method: "POST", contentType: R5, body: r5enc });
  assert.equal(ok.res.status, 200, JSON.stringify(ok.j));
  const r4shape = await fhir(DOCTOR, "Encounter/$validate", { method: "POST", contentType: R5, body: toFhir({ ...FIXTURES[1], patientId: PATIENT }) });
  assert.equal(r4shape.res.status, 422, "an R4-shaped body is not valid R5");
  assert.ok(r4shape.j.issue.some((i) => /not in R5/.test(i.diagnostics)));
  const asR4 = await fhir(DOCTOR, "Encounter/$validate", { method: "POST", body: r5enc, contentType: "application/fhir+json" });
  assert.equal(asR4.res.status, 422, "and an R5 body is not valid R4");

  const before = (await RECORD.byPatient(TENANT_ROW.id, "Encounter", PATIENT)).length;
  const write = await fhir(DOCTOR, "Encounter", { method: "POST", contentType: R5, body: r5enc });
  assert.equal(write.res.status, 415, JSON.stringify(write.j));
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "Encounter", PATIENT)).length, before, "nothing was written");
  const writeNoAuth = await fhir(CASHIER, "Encounter", { method: "POST", contentType: R5, body: r5enc });
  assert.equal(writeNoAuth.res.status, 403, "a refused writer is refused before the version is judged");

  const bulk = await fhir(ADMIN, "$export", { accept: R5, headers: { Prefer: "respond-async" } });
  assert.equal(bulk.res.status, 406);
  assert.match(bulk.j.issue[0].diagnostics, /R4 only/);
  const st = await fhir(ADMIN, "Subscription/wh-x.encounter.admitted/$status", { accept: R4B });
  assert.ok(st.res.status === 406 || st.res.status === 404, String(st.res.status));
});

test("SMART DOOR: GET /api/fhir/{org}/metadata answers per version and refuses an unserved one", async () => {
  seed();
  const call = (accept) => fhirDoor({ request: new Request(`https://x/api/fhir/${ORG}/metadata`, { headers: accept ? { Accept: accept } : {} }), env: ENV, params: { path: [ORG, "metadata"] } });
  assert.equal((await (await call(R5)).json()).fhirVersion, "5.0.0");
  assert.equal((await (await call()).json()).fhirVersion, "4.0.1");
  assert.equal((await call("application/fhir+json; fhirVersion=1.0")).status, 406);
  const bulk = await fhirDoor({ request: new Request(`https://x/api/fhir/${ORG}/$export`, { headers: { Accept: R5, Prefer: "respond-async" } }), env: ENV, params: { path: [ORG, "$export"] } });
  assert.equal(bulk.status, 406);
});
