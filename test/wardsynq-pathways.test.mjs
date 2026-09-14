/* test/wardsynq-pathways.test.mjs - P2.12 clinical pathways and P2.11 specialty registry. Real router, real RecordService.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-pathways.test.mjs
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
      }
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
const TENANT = { id: "tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null),
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
const P = await import("../functions/_wardsynq/pathways.js");

const ORG = "org-a";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", CASHIER = "cashier@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", WSQ_TICK_OFF: "1",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

const ORDER_SETS = [{ id: "sepsis-bundle", name: "Sepsis bundle (example)", version: "1", items: [{ kind: "investigation", key: "lactate", code: "2524-7", display: "Lactate" }] }];
function seed(cfg) {
  docs.clear(); clock = 1; RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { orderSets: ORDER_SETS, ...(cfg || {}) } }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"], [NURSE, "nurse"], [CASHIER, "cashier"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET",
    headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

const DEF = {
  key: "sepsis_example", title: "Suspected sepsis (example)", owner: "Test committee", example: true,
  evidence: [{ citation: "Example citation text", url: "https://example.org/guideline" }],
  effectiveDate: "2026-01-01", reviewDate: "2026-06-01",
  applicability: { classes: ["IPD"], specialties: ["medicine"] },
  steps: [
    { key: "bundle", title: "Open the sepsis order set", kind: "orders", orderSetId: "sepsis-bundle" },
    { key: "bp", title: "Blood pressure recorded within 60 minutes", kind: "goal", withinMinutes: 60, evidence: { resourceType: "Observation", codes: ["8480-6"] } },
  ],
};

async function admitted() {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Patient A", mobile: "9876500701", gender: "male", ageYears: 40 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Ward A", bed: "1" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return adm;
}

test("authoring is staff.admin only; a published version is immutable and a new publish makes the next version", async () => {
  seed();
  for (const who of [DOCTOR, NURSE]) {
    assert.equal((await as(who, "/pathways/draft", "POST", { orgId: ORG, definition: DEF })).__status, 403, who);
    assert.equal((await as(who, "/pathways/definitions?orgId=" + ORG)).__status, 403, who);
  }
  const bad = await as(ADMIN, "/pathways/draft", "POST", { orgId: ORG, definition: { key: "x_bad", title: "No owner" } });
  assert.equal(bad.__status, 200); assert.ok(bad.problems.some((p) => /owner/.test(p)) && bad.problems.some((p) => /evidence/.test(p)));
  assert.equal((await as(ADMIN, "/pathways/publish", "POST", { orgId: ORG, key: "x_bad" })).__status, 422, "a draft with problems is not published");
  assert.equal((await as(ADMIN, "/pathways/draft", "POST", { orgId: ORG, definition: DEF })).problems.length, 0);
  assert.equal((await as(DOCTOR, "/pathways/publish", "POST", { orgId: ORG, key: DEF.key })).__status, 403);
  const v1 = await as(ADMIN, "/pathways/publish", "POST", { orgId: ORG, key: DEF.key });
  assert.equal(v1.version, 1);
  const v1Doc = JSON.stringify(docs.get(`q_pathway_defs/${ORG}__${DEF.key}__v1`).fields);
  await as(ADMIN, "/pathways/draft", "POST", { orgId: ORG, definition: { ...DEF, title: "Changed title" } });
  assert.equal((await as(ADMIN, "/pathways/publish", "POST", { orgId: ORG, key: DEF.key })).version, 2);
  assert.equal(JSON.stringify(docs.get(`q_pathway_defs/${ORG}__${DEF.key}__v1`).fields), v1Doc, "v1 unchanged");
  assert.ok([...docs.values()].some((d) => d.fields.action === "pathways:published"), "audited");
});

test("enrol, progress from real records, override with a mandatory reason; nurses and cashiers refused", async () => {
  seed();
  await as(ADMIN, "/pathways/draft", "POST", { orgId: ORG, definition: DEF });
  await as(ADMIN, "/pathways/publish", "POST", { orgId: ORG, key: DEF.key });
  const adm = await admitted();
  const list = await as(NURSE, "/ward/pathways?orgId=" + ORG);
  assert.equal(list.__status, 200);
  assert.equal(list.pathways[0].reviewOverdue, true, "review date in the past is flagged");
  assert.equal(list.pathways[0].exampleLabel, "Example, not approved for clinical use");

  const enrolBody = { orgId: ORG, pathwayKey: DEF.key, pathwayVersion: 1, patientId: adm.patientId, encounterId: adm.encounterId };
  assert.equal((await as(NURSE, "/ward/pathway-enrol", "POST", enrolBody)).__status, 403, "a nurse cannot enrol");
  assert.equal((await as(CASHIER, "/ward/pathway-progress?orgId=" + ORG + "&patientId=" + adm.patientId)).__status, 403, "a cashier cannot read the chart");
  assert.equal((await as(DOCTOR, "/ward/pathway-enrol", "POST", { ...enrolBody, pathwayVersion: 9 })).error, "pathway_not_found");
  const en = await as(DOCTOR, "/ward/pathway-enrol", "POST", enrolBody);
  assert.equal(en.__status, 200, JSON.stringify(en));
  assert.equal((await as(DOCTOR, "/ward/pathway-enrol", "POST", enrolBody)).error, "already_enrolled");

  let prog = await as(NURSE, "/ward/pathway-progress?orgId=" + ORG + "&patientId=" + adm.patientId);
  assert.equal(prog.__status, 200, JSON.stringify(prog));
  assert.deepEqual(prog.enrolments[0].steps.map((s) => s.status), ["pending", "pending"]);
  assert.equal(RECORD && (await RECORD.latestByType(TENANT.id, "ServiceRequest", 10)).length, 0, "nothing was ordered by enrolling");

  const vit = await as(DOCTOR, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { sbp: "118" } });
  assert.equal(vit.__status, 200, JSON.stringify(vit));
  prog = await as(DOCTOR, "/ward/pathway-progress?orgId=" + ORG + "&patientId=" + adm.patientId);
  const bp = prog.enrolments[0].steps.find((s) => s.key === "bp");
  assert.equal(bp.status, "met"); assert.equal(bp.evidence.resourceType, "Observation");

  const ov = { orgId: ORG, patientId: adm.patientId, enrolmentId: en.enrolmentId, stepKey: "bundle" };
  assert.equal((await as(NURSE, "/ward/pathway-override", "POST", { ...ov, reason: "Not indicated here" })).__status, 403, "a nurse cannot override");
  assert.equal((await as(DOCTOR, "/ward/pathway-override", "POST", ov)).error, "reason_required");
  assert.equal((await as(DOCTOR, "/ward/pathway-override", "POST", { ...ov, stepKey: "nope", reason: "Not indicated here" })).error, "step_not_found");
  const done = await as(DOCTOR, "/ward/pathway-override", "POST", { ...ov, reason: "Allergy to the listed antibiotic" });
  assert.equal(done.__status, 200, JSON.stringify(done));
  prog = await as(DOCTOR, "/ward/pathway-progress?orgId=" + ORG + "&patientId=" + adm.patientId);
  const b = prog.enrolments[0].steps.find((s) => s.key === "bundle");
  assert.equal(b.status, "pending", "the override does not rewrite what the record says");
  assert.equal(b.overrides[0].reason, "Allergy to the listed antibiotic");
  assert.ok([...docs.values()].some((d) => d.fields.action === "pathways:step_overridden"), "audited");
});

test("a retired version keeps its enrolments visible and takes no new patients", async () => {
  seed();
  await as(ADMIN, "/pathways/draft", "POST", { orgId: ORG, definition: DEF });
  await as(ADMIN, "/pathways/publish", "POST", { orgId: ORG, key: DEF.key });
  const adm = await admitted();
  await as(DOCTOR, "/ward/pathway-enrol", "POST", { orgId: ORG, pathwayKey: DEF.key, pathwayVersion: 1, patientId: adm.patientId, encounterId: adm.encounterId });
  assert.equal((await as(DOCTOR, "/pathways/retire", "POST", { orgId: ORG, key: DEF.key, version: 1, reason: "Superseded" })).__status, 403);
  assert.equal((await as(ADMIN, "/pathways/retire", "POST", { orgId: ORG, key: DEF.key, version: 1 })).error, "reason_required");
  assert.equal((await as(ADMIN, "/pathways/retire", "POST", { orgId: ORG, key: DEF.key, version: 1, reason: "Superseded" })).__status, 200);
  const again = await as(DOCTOR, "/ward/pathway-enrol", "POST", { orgId: ORG, pathwayKey: DEF.key, pathwayVersion: 1, patientId: adm.patientId, encounterId: "" });
  assert.equal(again.error, "pathway_retired");
  const prog = await as(DOCTOR, "/ward/pathway-progress?orgId=" + ORG + "&patientId=" + adm.patientId);
  assert.equal(prog.enrolments[0].pathway.status, "retired");
});

test("specialty panel: not configured, resolved with dangling references reported, and gated on emr.view", async () => {
  seed();
  assert.deepEqual((await as(DOCTOR, "/ward/specialty?orgId=" + ORG + "&class=IPD")).specialty, null);
  seed({ specialties: [{ key: "medicine", name: "General medicine", match: { classes: ["IPD"] }, orderSets: ["sepsis-bundle", "gone"], templates: ["progress"], modules: ["cardiology", "nonsense"], pathways: ["sepsis_example"] }] });
  await as(ADMIN, "/pathways/draft", "POST", { orgId: ORG, definition: DEF });
  await as(ADMIN, "/pathways/publish", "POST", { orgId: ORG, key: DEF.key });
  assert.equal((await as(CASHIER, "/ward/specialty?orgId=" + ORG + "&class=IPD")).__status, 403);
  const r = await as(NURSE, "/ward/specialty?orgId=" + ORG + "&class=IPD");
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.specialty.name, "General medicine");
  assert.deepEqual(r.specialty.orderSets.map((x) => x.id), ["sepsis-bundle"]);
  assert.equal(r.specialty.modules[0].act, "cardiologyopen");
  assert.equal(r.specialty.pathways[0].key, "sepsis_example");
  assert.deepEqual(r.specialty.missing.map((m) => m.id).sort(), ["gone", "nonsense"]);
  assert.equal((await as(NURSE, "/ward/specialty?orgId=" + ORG + "&class=ICU")).specialty, null);
});

test("PURE: missed, met late and not evaluated are distinct, and never confused", () => {
  const start = Date.parse("2026-09-13T08:00:00Z");
  const def = { steps: [
    { key: "a", title: "A", kind: "goal", withinMinutes: 60, evidence: { resourceType: "MedicationAdministration", drugs: ["ceftriaxone"] } },
    { key: "b", title: "B", kind: "goal", withinMinutes: 60, evidence: { resourceType: "Observation", codes: ["2524-7"] } },
    { key: "c", title: "C", kind: "assessment", formKey: "triage" },
  ] };
  const en = { id: "e1", enrolledAt: new Date(start).toISOString() };
  const late = { resourceType: "MedicationAdministration", id: "ma1", drug: "Ceftriaxone 1 g", status: "administered", administeredAt: "2026-09-13T09:30:00Z" };
  const before = { resourceType: "MedicationAdministration", id: "ma0", drug: "Ceftriaxone", status: "administered", administeredAt: "2026-09-13T07:00:00Z" };
  const s = P.evaluateProgress(def, en, { MedicationAdministration: [before, late], Observation: [], FormResponse: null }, [], start + 3 * 3600e3);
  assert.deepEqual(s.map((x) => x.status), ["met_late", "missed", "not_evaluated"]);
  assert.equal(s[0].evidence.id, "ma1", "a record from before enrolment does not count");
  assert.equal(P.evaluateProgress(def, en, { MedicationAdministration: [], Observation: [], FormResponse: [] }, [], start + 10 * 60000)[1].status, "pending");
  assert.ok(P.validatePathway({ ...DEF, reviewDate: "2025-01-01" }).some((p) => /after effectiveDate/.test(p)));
  assert.ok(P.validatePathway({ ...DEF, steps: [{ key: "g", title: "G", kind: "goal", evidence: { resourceType: "Observation" } }] }).some((p) => /name codes/.test(p)));
});
