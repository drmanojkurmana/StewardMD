/* test/wardsynq-immunization-routes.test.mjs - G6 immunizations through the REAL routes
 * (/api/queue/ward/immunization, /ward/immunization-error, /ward/immunizations) and the ward FHIR door
 * (/api/queue/ward/fhir/Immunization), with the authorisation separations proved.
 *
 * Actors are members, never the org owner: an owner holds every capability and would make every
 * separation below vacuous. Reception holds emr.view but not emr.vitals, so it is the wrong role.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-immunization-routes.test.mjs
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

const ORG = "org-id";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@id.test", NURSE = "nurse@id.test", RECEPTION = "reception@id.test";
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
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-ID01", name: "ID Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [RECEPTION, "reception"]]) {
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

const given = { vaccine: "Hepatitis B (adult)", vaccineCode: "43", vaccineCodeSystem: "cvx", occurredOn: "2026-09-10", doseNumber: 2, lotNumber: "HB-2291", site: "left deltoid", route: "intramuscular" };
const immunizationsOf = async () => (await RECORD.byPatient(TENANT_ROW.id, "Immunization", PATIENT)) || [];

test("a nurse records a dose through POST /api/queue/ward/immunization and a doctor reads it back", async () => {
  seed();
  const r = await as(NURSE, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: given });
  assert.equal(r.__status, 200, JSON.stringify(r));
  const list = await as(DOCTOR, `/ward/immunizations?orgId=${ORG}&patientId=${PATIENT}`, "GET");
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.immunizations.length, 1);
  const i = list.immunizations[0];
  assert.equal(i.vaccine, "Hepatitis B (adult)");
  assert.equal(i.doseNumber, 2);
  assert.equal(i.performerId, idFor(NURSE), "given by the recorder, from the session, not the body");
  const writes = RECORD.audit.filter((a) => a.action === "record.write");
  assert.ok(writes.some((w) => JSON.stringify(w).includes(idFor(NURSE))), "the write is audited with the actor");
});

test("NEGATIVE: no session gets 401 and nothing is written", async () => {
  seed();
  const res = await onRequest({ request: new Request("https://x/api/queue/ward/immunization", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: ORG, patientId: PATIENT, immunization: given }) }), env: ENV });
  assert.equal(res.status, 401);
  assert.equal((await immunizationsOf()).length, 0);
});

test("NEGATIVE: reception (emr.view, no emr.vitals) gets 403 and nothing is written", async () => {
  seed();
  const r = await as(RECEPTION, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: given });
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal((await immunizationsOf()).length, 0);
  const e = await as(RECEPTION, "/ward/immunization-error", "POST", { orgId: ORG, immunizationId: "x", reason: "x" });
  assert.equal(e.__status, 403, JSON.stringify(e));
});

test("NEGATIVE: staff of another hospital cannot write or read this patient's immunizations", async () => {
  seed();
  await as(NURSE, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: given });
  const stranger = "nurse@other.test";
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OT01", name: "Other", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(stranger))}`, { fields: { orgId: "org-other", identity: idFor(stranger), role: "nurse", active: true }, updateTime: "t1" });
  const w = await as(stranger, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: { ...given, vaccine: "Other" } });
  assert.ok(w.__status === 403 || w.__status === 404, "got " + w.__status);
  assert.equal((await immunizationsOf()).length, 1, "nothing written by the stranger");
  const r = await as(stranger, `/ward/immunizations?orgId=${ORG}&patientId=${PATIENT}`, "GET");
  assert.ok(r.__status === 403 || r.__status === 404, "got " + r.__status);
});

test("not given needs a reason; a future date and a code with no known system are refused", async () => {
  seed();
  const noReason = await as(NURSE, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: { vaccine: "MMR", occurredOn: "2026-09-10", status: "not-done" } });
  assert.equal(noReason.__status, 422); assert.equal(noReason.error, "reason_required");
  const future = await as(NURSE, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: { vaccine: "MMR", occurredOn: "2999-01-01" } });
  assert.equal(future.error, "date_in_the_future");
  const badSys = await as(NURSE, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: { vaccine: "MMR", occurredOn: "2026-09-10", vaccineCode: "03", vaccineCodeSystem: "made-up" } });
  assert.equal(badSys.error, "code_system_unknown");
  assert.equal((await immunizationsOf()).length, 0);
  const refused = await as(NURSE, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: { vaccine: "MMR", occurredOn: "2026-09-10", status: "not-done", statusReason: "parent declined" } });
  assert.equal(refused.__status, 200, JSON.stringify(refused));
});

test("withdrawing an entry keeps it readable, marked, with who and why", async () => {
  seed();
  const r = await as(NURSE, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: given });
  const noReason = await as(NURSE, "/ward/immunization-error", "POST", { orgId: ORG, immunizationId: r.immunizationId });
  assert.equal(noReason.__status, 422);
  const w = await as(DOCTOR, "/ward/immunization-error", "POST", { orgId: ORG, immunizationId: r.immunizationId, reason: "wrong patient" });
  assert.equal(w.__status, 200, JSON.stringify(w));
  const list = await as(NURSE, `/ward/immunizations?orgId=${ORG}&patientId=${PATIENT}`, "GET");
  assert.equal(list.immunizations[0].status, "entered-in-error");
  assert.equal(list.immunizations[0].errorReason, "wrong patient");
  const history = await RECORD.history(TENANT_ROW.id, "Immunization", r.immunizationId);
  assert.equal(history.length, 2, "the original version survives");
});

test("FHIR: GET /api/queue/ward/fhir/Immunization?patient= and the read return valid R4 Immunizations", async () => {
  seed();
  const r = await as(NURSE, "/ward/immunization", "POST", { orgId: ORG, patientId: PATIENT, immunization: given });
  const b = await as(DOCTOR, `/ward/fhir/Immunization?patient=${PATIENT}&orgId=${ORG}`, "GET");
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(b.resourceType, "Bundle");
  assert.equal(b.entry.length, 1);
  const f = b.entry[0].resource;
  assert.equal(f.resourceType, "Immunization");
  assert.equal(f.vaccineCode.text, "Hepatitis B (adult)");
  assert.deepEqual(f.vaccineCode.coding, [{ system: "http://hl7.org/fhir/sid/cvx", code: "43", display: "Hepatitis B (adult)" }]);
  assert.equal(f.protocolApplied[0].doseNumberPositiveInt, 2);
  const { validateResource } = await import("../functions/_wardsynq/fhir-validate.js");
  assert.deepEqual(validateResource(f).issues.filter((i) => i.severity === "error"), []);
  const one = await as(DOCTOR, `/ward/fhir/Immunization/${f.id}?orgId=${ORG}`, "GET");
  assert.equal(one.__status, 200, JSON.stringify(one));
  assert.equal(one.id, f.id);
  assert.ok(r.ok);
  const none = await as(NURSE, `/ward/fhir/Immunization?patient=${PATIENT}&status=not-done&orgId=${ORG}`, "GET");
  assert.equal(none.entry ? none.entry.length : 0, 0);
});

test("FHIR mapper: not given carries its reason, a reported dose names no performer, no code is invented, all R4-valid", async () => {
  const { toFhir } = await import("../functions/_wardsynq/fhir.js");
  const { validateResource } = await import("../functions/_wardsynq/fhir-validate.js");
  const base = { resourceType: "Immunization", version: 1, patientId: "p1", meta: { recordedAt: "2026-09-10T00:00:00.000Z" } };
  const refused = toFhir({ ...base, id: "i1", vaccine: "MMR", status: "not-done", statusReason: "parent declined", occurredOn: "2026-09-10", primarySource: true });
  assert.equal(refused.status, "not-done");
  assert.equal(refused.statusReason.text, "parent declined");
  assert.deepEqual(refused.vaccineCode, { text: "MMR" }, "text only: no code was given, none is invented");
  const reported = toFhir({ ...base, id: "i2", vaccine: "BCG", status: "completed", occurredOn: "2020-01-01", primarySource: false, performerId: null });
  assert.equal(reported.primarySource, false);
  assert.equal(reported.performer, undefined);
  const withdrawn = toFhir({ ...base, id: "i3", vaccine: "OPV", status: "entered-in-error", occurredOn: "2026-01-01", primarySource: true, performerId: "cfa:n" });
  assert.equal(withdrawn.status, "entered-in-error");
  for (const r of [refused, reported, withdrawn]) assert.deepEqual(validateResource(r).issues.filter((i) => i.severity === "error"), [], JSON.stringify(r));
});
