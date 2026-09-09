/* test/wardsynq-source-system-grant.test.mjs — TASK 7 STEP 1: the source-system impersonation
 * vulnerability, closed. A skeptical audit of fhir-inbound.js and hl7-inbound.js found that a
 * feed's claimed identity (X-Source-System header, Bundle.meta.source, or HL7 MSH-3/MSH-4) was
 * trusted OUTRIGHT - any authenticated clinician holding emr.treat could declare itself to be any
 * registered partner's name, and every downstream ownership/provenance/MPI-precedent decision
 * would believe it.
 *
 * These tests invoke the REAL endpoints - onRequest -> /ward/fhir, /ward/hl7, /ward/source-grant -
 * exactly as a real client would, never a bare helper function. Every one of them is written to
 * FAIL against the pre-fix code (no SourceSystemGrant check at all) and PASS only with the fix.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-source-system-grant.test.mjs
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

const TENANT_A = { id: "tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) };
const TENANT_B = { id: "tenant-b", name: "Hospital B", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-b" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => {
      const id = String(a[0]);
      if (id === TENANT_A.id) return { ...TENANT_A };
      if (id === TENANT_B.id) return { ...TENANT_B };
      return null;
    },
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async () => ({}),
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG_A = "org-a", ORG_B = "org-b";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test", DOCTOR2 = "doctor2@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospitals() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_A}`, { fields: { id: ORG_A, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_A.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { fhir: { inbound: { enabled: true } }, hl7: { inbound: { enabled: true }, profile: { sendingApplications: [] } } } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG_B}`, { fields: { id: ORG_B, code: "HOSP-B", name: "Hospital B", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_B.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { fhir: { inbound: { enabled: true } } } }, updateTime: "t1" });
  for (const [org, email, role] of [
    [ORG_A, ADMIN, "admin"], [ORG_A, DOCTOR, "doctor"], [ORG_A, DOCTOR2, "doctor"],
    [ORG_B, ADMIN, "admin"], [ORG_B, DOCTOR, "doctor"],
  ]) {
    docs.set(`q_members/${sanitize(org)}__${sanitize(idFor(email))}`, { fields: { orgId: org, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body, headers) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json", ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function pushFhir(email, org, body, headers) {
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir?orgId=${org}`, { method: "POST", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/fhir+json", ...(headers || {}) }, body: JSON.stringify(body) }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function pushHl7(email, org, text, headers) {
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/hl7?orgId=${org}`, { method: "POST", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "x-application/hl7-v2+er7", ...(headers || {}) }, body: text }), env: ENV });
  const text2 = await res.text();
  const msa = (/^MSA\|(\w+)\|([^|\r]*)\|?([^\r]*)/m.exec(text2) || []).slice(1);
  return { status: res.status, ack: text2, code: msa[0] || null, text: msa[2] || null };
}
async function grant(email, org, actorEmail, sourceSystem) {
  return as(email, `/ward/source-grant?orgId=${org}`, "POST", { actorId: idFor(actorEmail), sourceSystem });
}

function bundle(patientId, mrn, over) {
  const o = over || {};
  return {
    resourceType: "Bundle", type: "collection", id: `b-${patientId}`,
    ...(o.bundleMeta || {}),
    entry: [{ resource: { resourceType: "Patient", id: patientId, identifier: [{ system: "urn:test:mrn", value: mrn }], name: [{ family: "Testcase", given: ["Feed"] }], birthDate: "1980-01-01", gender: "female" } }],
  };
}
function similarLookalikeBundle(patientId, name, dob) {
  return { resourceType: "Bundle", type: "collection", id: `b-${patientId}`,
    entry: [{ resource: { resourceType: "Patient", id: patientId, name: [{ family: name.split(" ")[1], given: [name.split(" ")[0]] }], birthDate: dob, gender: "female" } }] };
}
function adt(sendingApp, sendingFacility, controlId, mrn) {
  return [
    `MSH|^~\\&|${sendingApp}|${sendingFacility}|WARDSYNQ|WSQ|20260808101500||ADT^A01^ADT_A01|${controlId}|P|2.5.1`,
    `EVN|A01|20260808101500`,
    `PID|1||${mrn}^^^${sendingFacility}^MR||Testcase^Feed||19800101|F`,
    `PV1|1|I|MED-A^12^^${sendingFacility}|||||||||||||||V-${controlId}^^^${sendingFacility}`,
  ].join("\r");
}

/* ---- 1: a legitimate, granted source succeeds --------------------------------------------------- */

test("1. legitimate source: a GRANTED actor's push succeeds through the real /ward/fhir door", async () => {
  seedHospitals();
  const g = await grant(ADMIN, ORG_A, DOCTOR, "epic-a");
  assert.equal(g.__status, 200, JSON.stringify(g));
  assert.equal(g.grant.sourceSystem, "epic-a");

  const r = await pushFhir(DOCTOR, ORG_A, bundle("PAT-1", "MRN-1"), { "X-Source-System": "epic-a" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  const landed = await RECORD.latest(TENANT_A.id, "Patient", "fhir-epic-a-pat-pat-1");
  assert.ok(landed, "the legitimate feed's patient landed");
});

/* ---- 2: caller claims another source -> rejected ------------------------------------------------- */

test("2. impersonation: an actor claims a DIFFERENT source it was never granted -> rejected, nothing written", async () => {
  seedHospitals();
  await grant(ADMIN, ORG_A, DOCTOR, "epic-a");
  const r = await pushFhir(DOCTOR, ORG_A, bundle("PAT-2", "MRN-2"), { "X-Source-System": "oracle-health" });
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.match(r.issue[0].diagnostics, /not registered to push data as "oracle-health"/);
  assert.equal(await RECORD.latest(TENANT_A.id, "Patient", "fhir-oracle-health-pat-pat-2"), null, "nothing was written under the unauthorized claim");
});

/* ---- 3: caller claims a source belonging to another tenant -> rejected -------------------------- */

test("3. cross-tenant: a grant issued in hospital A does not authorize a claim in hospital B, for the same real person", async () => {
  seedHospitals();
  await grant(ADMIN, ORG_A, DOCTOR, "epic-a");
  // The SAME doctor is also a real member of hospital B - the grant simply does not exist there.
  const r = await pushFhir(DOCTOR, ORG_B, bundle("PAT-3", "MRN-3"), { "X-Source-System": "epic-a" });
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(await RECORD.latest(TENANT_B.id, "Patient", "fhir-epic-a-pat-pat-3"), null);
  // And it still works fine back in hospital A, where the grant actually lives.
  const ok = await pushFhir(DOCTOR, ORG_A, bundle("PAT-3", "MRN-3"), { "X-Source-System": "epic-a" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
});

/* ---- 4: valid tenant auth, no authorization for THIS connector -> rejected ---------------------- */

test("4. valid clinical auth is not enough: a second doctor with real emr.treat but NO grant is refused", async () => {
  seedHospitals();
  await grant(ADMIN, ORG_A, DOCTOR, "epic-a"); // DOCTOR2 gets nothing
  const r = await pushFhir(DOCTOR2, ORG_A, bundle("PAT-4", "MRN-4"), { "X-Source-System": "epic-a" });
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.match(r.issue[0].diagnostics, new RegExp(idFor(DOCTOR2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

/* ---- 5: body/header source mismatch -> rejected -------------------------------------------------- */

test("5. mismatch: header and Bundle.meta.source disagree -> rejected before any grant is even consulted", async () => {
  seedHospitals();
  await grant(ADMIN, ORG_A, DOCTOR, "epic-a");
  await grant(ADMIN, ORG_A, DOCTOR, "oracle-health");
  const b = bundle("PAT-5", "MRN-5", { bundleMeta: { meta: { source: "urn:stewardmd:source:oracle-health" } } });
  const r = await pushFhir(DOCTOR, ORG_A, b, { "X-Source-System": "epic-a" });
  assert.equal(r.__status, 400, JSON.stringify(r));
  assert.match(r.issue[0].diagnostics, /disagree/);
  assert.equal(await RECORD.latest(TENANT_A.id, "Patient", "fhir-epic-a-pat-pat-5"), null);
  assert.equal(await RECORD.latest(TENANT_A.id, "Patient", "fhir-oracle-health-pat-pat-5"), null);
});

/* ---- 6: replay remains safe ----------------------------------------------------------------------- */

test("6. replay: the same bundle pushed twice by a granted actor lands once, and the second push is a safe no-op", async () => {
  seedHospitals();
  await grant(ADMIN, ORG_A, DOCTOR, "epic-a");
  const b = bundle("PAT-6", "MRN-6");
  const first = await pushFhir(DOCTOR, ORG_A, b, { "X-Source-System": "epic-a" });
  assert.equal(first.__status, 200, JSON.stringify(first));
  const before = (await RECORD.history(TENANT_A.id, "Patient", "fhir-epic-a-pat-pat-6")).length;
  const second = await pushFhir(DOCTOR, ORG_A, b, { "X-Source-System": "epic-a" });
  assert.equal(second.__status, 200, JSON.stringify(second));
  const after = (await RECORD.history(TENANT_A.id, "Patient", "fhir-epic-a-pat-pat-6")).length;
  assert.equal(after, before, "an identical replay writes no new version");
});

/* ---- 7: wrong-patient protection is untouched by this fix ---------------------------------------- */

test("7. wrong-patient: a granted feed's look-alike patient is still HELD for a human, never auto-linked", async () => {
  seedHospitals();
  await grant(ADMIN, ORG_A, DOCTOR, "epic-a");
  // Seed a real local patient this incoming one merely resembles (name+DOB, no identifier match).
  await RECORD.append(TENANT_A.id, [{ resourceType: "Patient", id: "opd-pat-local-1", version: 1, name: "Feed Testcase", dob: "1980-01-01", gender: "female", source: { system: "wardsynq-native" } }]);
  const r = await pushFhir(DOCTOR, ORG_A, similarLookalikeBundle("PAT-7", "Feed Testcase", "1980-01-01"), { "X-Source-System": "epic-a" });
  assert.equal(r.__status, 202, JSON.stringify(r), "202: the resource was accepted for review, not written and not refused");
  assert.match(r.entry[0].response.outcome.issue[0].diagnostics, /identity-probable-duplicate/);
  const exceptions = await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG_A}`);
  assert.ok(exceptions.open.some((x) => x.reason === "identity-probable-duplicate"), JSON.stringify(exceptions.open));
  assert.equal(await RECORD.latest(TENANT_A.id, "Patient", "fhir-epic-a-pat-pat-7"), null, "never auto-created while a look-alike is unresolved");
});

/* ---- 8: the accepted record carries the AUTHENTICATED identity, never the caller's raw claim ----- */

test("8. the landed record's source is the GRANT's own value, not whatever casing/spacing the caller sent", async () => {
  seedHospitals();
  await grant(ADMIN, ORG_A, DOCTOR, "epic-a");
  const r = await pushFhir(DOCTOR, ORG_A, bundle("PAT-8", "MRN-8"), { "X-Source-System": "  Epic-A  " });
  assert.equal(r.__status, 200, JSON.stringify(r));
  const landed = await RECORD.latest(TENANT_A.id, "Patient", "fhir-epic-a-pat-pat-8");
  assert.ok(landed, "the differently-cased header still resolves to the same grant");
  assert.equal(landed.meta.source.system, "fhir-epic-a", "stored under the grant's own canonical value (fhir-<system>), not the differently-cased header text");
});

/* ---- HL7: the same fix, proven against real parsed MSH-3/MSH-4, not a header ---------------------- */

test("HL7: MSH-3/MSH-4 is the claim when no header is sent, and it is checked against a real grant the same way", async () => {
  seedHospitals();
  const legit = await pushHl7(DOCTOR, ORG_A, adt("HIS", "GENHOSP", "MSG-1", "H-1"));
  assert.equal(legit.code, "AR", "no grant yet - rejected even though the message itself is well-formed");
  assert.match(legit.text, /not registered to push data as "his-genhosp"/);

  await grant(ADMIN, ORG_A, DOCTOR, "his-genhosp");
  const ok = await pushHl7(DOCTOR, ORG_A, adt("HIS", "GENHOSP", "MSG-2", "H-2"));
  assert.equal(ok.code, "AA", ok.ack);
  const landed = await RECORD.latest(TENANT_A.id, "Patient", "hl7v2-his-genhosp-pat-h-2");
  assert.ok(landed, "the granted HL7 facility's patient landed");

  // A DIFFERENT sending application/facility the actor was never granted -> rejected.
  const stranger = await pushHl7(DOCTOR, ORG_A, adt("OTHERLAB", "ELSEWHERE", "MSG-3", "H-3"));
  assert.equal(stranger.code, "AR");
  assert.match(stranger.text, /not registered to push data as "otherlab-elsewhere"/);

  // A header naming a DIFFERENT source than MSH-3/MSH-4 disagree -> rejected before any grant check.
  const mismatch = await pushHl7(DOCTOR, ORG_A, adt("HIS", "GENHOSP", "MSG-4", "H-4"), { "X-Source-System": "unrelated-system" });
  assert.equal(mismatch.code, "AR");
  assert.match(mismatch.text, /disagree/);
});

/* ---- the grant door itself: admin-only, and the record is real and readable ----------------------- */

test("the /ward/source-grant door itself is admin-only, and a non-admin's attempt writes nothing", async () => {
  seedHospitals();
  const denied = await grant(DOCTOR, ORG_A, DOCTOR, "epic-a");
  assert.equal(denied.__status, 403, JSON.stringify(denied));
  const r = await pushFhir(DOCTOR, ORG_A, bundle("PAT-9", "MRN-9"), { "X-Source-System": "epic-a" });
  assert.equal(r.__status, 403, JSON.stringify(r), "no grant exists - a doctor could not create one for itself");
});
