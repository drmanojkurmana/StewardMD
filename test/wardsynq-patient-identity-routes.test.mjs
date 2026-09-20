/* test/wardsynq-patient-identity-routes.test.mjs — contacts and deceased status through the REAL
 * routes, with the authorisation separations that matter proved rather than asserted.
 *
 * Three actors, none of them the org owner: an owner resolves to `admin`, holds every capability,
 * and would make every separation below vacuous.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-patient-identity-routes.test.mjs
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

const contact = { name: "Sita Kumar", relationship: "spouse", phone: "9876543210", nextOfKin: true, emergencyContact: true };

test("reception records a contact, and a nurse can read it", async () => {
  seed();
  const added = await as(RECEPTION, "/ward/related-person", "POST", { orgId: ORG, patientId: PATIENT, person: contact });
  assert.equal(added.__status, 200, JSON.stringify(added));
  assert.equal(added.person.name, "Sita Kumar");

  const seen = await as(NURSE, `/ward/related-people?orgId=${ORG}&patientId=${PATIENT}`, "GET");
  assert.equal(seen.__status, 200, JSON.stringify(seen));
  assert.equal(seen.people.length, 1);
  assert.equal(seen.hasEmergencyContact, true);
});

test("NEGATIVE: a nurse cannot record a death", async () => {
  seed();
  const r = await as(NURSE, "/ward/deceased", "POST", { orgId: ORG, patientId: PATIENT, confirm: true });
  assert.equal(r.__status, 403, JSON.stringify(r));
  // And nothing was written: the patient is still not marked deceased.
  const after = await as(DOCTOR, `/ward/related-people?orgId=${ORG}&patientId=${PATIENT}`, "GET");
  assert.equal(after.deceased, undefined);
});

test("NEGATIVE: a nurse cannot withdraw a death either", async () => {
  seed();
  const r = await as(NURSE, "/ward/deceased-correct", "POST", { orgId: ORG, patientId: PATIENT, reason: "x" });
  assert.equal(r.__status, 403, JSON.stringify(r));
});

test("a doctor records a death, and it needs an explicit confirmation even from them", async () => {
  seed();
  const unconfirmed = await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: PATIENT });
  assert.equal(unconfirmed.__status, 422, JSON.stringify(unconfirmed));
  assert.equal(unconfirmed.error, "confirmation_required");

  const done = await as(DOCTOR, "/ward/deceased", "POST", {
    orgId: ORG, patientId: PATIENT, confirm: true,
    deceased: { at: "2026-09-12T10:00:00.000Z", cause: "Septic shock" },
  });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal(done.deceased.cause, "Septic shock");
  // Who recorded it is the authenticated session, never anything the body could claim.
  assert.equal(done.deceased.recordedBy, idFor(DOCTOR));
});

test("the death is visible to the ward, and the chart is not destroyed by it", async () => {
  seed();
  await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: PATIENT, confirm: true, deceased: { at: "2026-09-12T10:00:00.000Z" } });
  const seen = await as(NURSE, `/ward/related-people?orgId=${ORG}&patientId=${PATIENT}`, "GET");
  assert.ok(seen.deceased, "the ward must be able to see it");

  const patient = await RECORD.latest(TENANT_ROW.id, "Patient", PATIENT);
  assert.ok(patient.deceased, "the patient carries the deceased block");
  assert.equal(patient.name, "Ramesh Kumar", "the rest of the patient survives");
  assert.equal(patient.mrn, "SMD-ID01-00001");
});

test("recording a death leaves an audit row naming who did it", async () => {
  seed();
  await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: PATIENT, confirm: true });

  // MemoryRepository keeps the audit events it was handed, in order.
  const writes = RECORD.audit.filter((a) => a.action === "record.write");
  assert.ok(writes.length >= 1, "the write was not audited: " + JSON.stringify(RECORD.audit.map((a) => a.action)));
  const last = writes[writes.length - 1];
  assert.equal(last.tenantId, TENANT_ROW.id, "the audit row is scoped to this hospital");
  assert.ok(JSON.stringify(last).includes(idFor(DOCTOR)), "the audit row must name the actor");
});

test("the death is a new VERSION, so what the record said before is still readable", async () => {
  seed();
  await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: PATIENT, confirm: true });
  const history = await RECORD.history(TENANT_ROW.id, "Patient", PATIENT);
  assert.ok(history.length >= 2, "expected at least two versions, got " + history.length);
  const everSaidAlive = history.some((v) => !v.deceased);
  const nowSaysDead = history.some((v) => v.deceased);
  assert.ok(everSaidAlive, "the earlier version must survive");
  assert.ok(nowSaysDead, "the later version must carry the death");
});

test("a withdrawn death keeps the entry that was withdrawn", async () => {
  seed();
  await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: PATIENT, confirm: true });
  const back = await as(DOCTOR, "/ward/deceased-correct", "POST", { orgId: ORG, patientId: PATIENT, reason: "wrong patient" });
  assert.equal(back.__status, 200, JSON.stringify(back));

  const patient = await RECORD.latest(TENANT_ROW.id, "Patient", PATIENT);
  assert.equal(patient.deceased, null);
  assert.equal(patient.deceasedCorrection.reason, "wrong patient");
  assert.ok(patient.deceasedCorrection.withdrew, "what was withdrawn stays readable");
});

test("a contact needs a number when somebody will be expected to ring it", async () => {
  seed();
  const r = await as(RECEPTION, "/ward/related-person", "POST", {
    orgId: ORG, patientId: PATIENT, person: { ...contact, phone: "" },
  });
  assert.equal(r.__status, 422, JSON.stringify(r));
  assert.equal(r.error, "phone_required");
});

test("removing a contact keeps it on the record, marked", async () => {
  seed();
  const added = await as(RECEPTION, "/ward/related-person", "POST", { orgId: ORG, patientId: PATIENT, person: contact });
  const gone = await as(RECEPTION, "/ward/related-person-remove", "POST", {
    orgId: ORG, relatedPersonId: added.relatedPersonId, reason: "moved away",
  });
  assert.equal(gone.__status, 200, JSON.stringify(gone));

  const seen = await as(NURSE, `/ward/related-people?orgId=${ORG}&patientId=${PATIENT}`, "GET");
  assert.equal(seen.people.length, 1, "a removed contact is still listed");
  assert.equal(seen.people[0].active, false);
  assert.equal(seen.people[0].removedReason, "moved away");
  assert.equal(seen.hasEmergencyContact, false, "and no longer counts as somebody to ring");
});

test("NEGATIVE: another hospital's staff cannot read this patient's contacts", async () => {
  seed();
  await as(RECEPTION, "/ward/related-person", "POST", { orgId: ORG, patientId: PATIENT, person: contact });
  const stranger = "stranger@other.test";
  const r = await as(stranger, `/ward/related-people?orgId=${ORG}&patientId=${PATIENT}`, "GET");
  assert.ok(r.__status === 403 || r.__status === 404, "a non-member must not read a chart: got " + r.__status);
});
