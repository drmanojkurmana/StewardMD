/* test/wardsynq-print-lang-routes.test.mjs - owner decision 2026-09-15 (bilingual prints), the server side,
 * through the real /api/queue router.
 *
 * Routes: POST /api/queue/ward/medication-order and POST /api/queue/ward/consultation (patientInstructions:
 * closed-list codes on a prescription), GET /api/queue/ward/patient-copy and GET /api/queue/ward/discharge-summary
 * (the `print` settings the screens read), POST /api/queue/org/update (wardsynq.printLanguages, saved on
 * Admin > Hospital). Negative authorization on each changed save route: no session 401, wrong role 403 with
 * nothing written, another hospital refused, an unknown instruction code 422, and the positive case.
 * The print itself is pinned in test/wardsynq-print-lang.test.mjs.
 *
 * Harness: the one test/neg-auth-ward-sensitive.test.mjs uses (in-memory Firestore, a real MemoryRepository).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-print-lang-routes.test.mjs
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
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const TARIFF = { "MET500": { amount: 12, currency: "INR" } };
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

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";        // the real hospital, with a real tenant/record store
const OTHER_ORG = "org-other"; // a second hospital, real q_orgs/q_members row only - no tenant needed
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", CASHIER = "cashier@example.test", HIM = "him@example.test";
const OTHER_CASHIER = "other-cashier@example.test", OTHER_DOCTOR = "other-doctor@example.test", OTHER_HIM = "other-him@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { tariff: TARIFF } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [CASHIER, "cashier"], [HIM, "him"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  // A second, real hospital - own owner, own q_orgs row - never linked to a tenant. Its admins hold
  // the very same capabilities, in THEIR OWN hospital only.
  docs.set(`q_orgs/${OTHER_ORG}`, { fields: { id: OTHER_ORG, code: "SMD-OTHR01", name: "A Different Hospital", kind: "clinic", mode: "native", ownerUid: "cfa:someone-else", createdAt: 1 }, updateTime: "t1" });
  for (const [email, role] of [[OTHER_CASHIER, "cashier"], [OTHER_DOCTOR, "doctor"], [OTHER_HIM, "him"]]) {
    docs.set(`q_members/${sanitize(OTHER_ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: OTHER_ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function anon(path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

/* ---- the hospital's admin, for POST /org/update (staff.admin) ---- */
const ADMIN = "admin@example.test", OTHER_ADMIN = "other-admin@example.test";
function seedWithAdmin(wardsynq) {
  seedHospital();
  docs.get(`q_orgs/${ORG}`).fields.wardsynq = { tariff: TARIFF, ...(wardsynq || {}) };
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(ADMIN))}`, { fields: { orgId: ORG, identity: idFor(ADMIN), role: "admin", active: true }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(OTHER_ORG)}__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: OTHER_ORG, identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
}
const orders = () => RECORD._rows.filter((r) => r.resourceType === "MedicationOrder");
let m = 0;
async function admitted() {
  m++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Print Lang Testcase " + m, mobile: "98765091" + String(m).padStart(2, "0"), gender: "female", ageYears: 58 });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: String(m) });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return adm;
}
const rx = (adm, extra) => ({ orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Methotrexate", dose: { value: 7.5, unit: "mg" }, route: "oral", frequency: "once weekly", ...(extra || {}) } });

test("POST /api/queue/ward/medication-order with patientInstructions: 401, nurse 403, other hospital refused, unknown code 422, all with nothing written; the doctor's codes are stored in list order", async () => {
  seedWithAdmin();
  const adm = await admitted();
  const body = rx(adm, { patientInstructions: ["do-not-drink-alcohol", "after-food"] });
  assert.equal((await anon("/ward/medication-order", "POST", body)).__status, 401);
  assert.equal((await as(NURSE, "/ward/medication-order", "POST", body)).__status, 403);
  const cross = await as(OTHER_DOCTOR, "/ward/medication-order", "POST", body);
  assert.ok(cross.__status === 403 || cross.__status === 404, JSON.stringify(cross));
  for (const bad of [["after food"], ["after-food", "take-double"], "after-food", [7]]) {
    const r = await as(DOCTOR, "/ward/medication-order", "POST", rx(adm, { patientInstructions: bad }));
    assert.equal(r.__status, 422, JSON.stringify(r));
    assert.equal(r.error, "unknown_patient_instruction");
    assert.equal(r.written, 0);
  }
  assert.equal(orders().length, 0, "nothing was written by a refused call");

  const ok = await as(DOCTOR, "/ward/medication-order", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const stored = orders().at(-1).body;
  assert.deepEqual(stored.patientInstructions, ["after-food", "do-not-drink-alcohol"], "kept in the closed list's order");
  assert.equal(stored.frequency, "once weekly", "the frequency is stored as written");
  assert.equal(stored.dose.value, 7.5);
});

test("POST /api/queue/ward/consultation carries the instructions; an unknown code saves none of the consultation; a nurse is refused", async () => {
  seedWithAdmin();
  const adm = await admitted();
  const med = { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Digoxin", dose: { value: 0.125, unit: "mg" }, route: "oral", frequency: "OD", patientInstructions: ["in-the-morning"] };
  const cbody = (meds) => ({ orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, medications: meds });
  assert.equal((await anon("/ward/consultation", "POST", cbody([med]))).__status, 401);
  assert.equal((await as(NURSE, "/ward/consultation", "POST", cbody([med]))).__status, 403);
  const bad = await as(DOCTOR, "/ward/consultation", "POST", cbody([{ ...med, patientInstructions: ["as-you-like"] }]));
  assert.notEqual(bad.ok, true, JSON.stringify(bad));
  assert.equal(orders().length, 0, "nothing from the refused consultation is on the chart");
  const ok = await as(DOCTOR, "/ward/consultation", "POST", cbody([med]));
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual(orders().at(-1).body.patientInstructions, ["in-the-morning"]);
});

test("GET /api/queue/ward/patient-copy and /ward/discharge-summary say whether a second language is offered and give the hospital's clock; the copy carries the codes", async () => {
  seedWithAdmin();
  const adm = await admitted();
  assert.equal((await as(DOCTOR, "/ward/medication-order", "POST", rx(adm, { patientInstructions: ["after-food"] }))).__status, 200);
  const off = await as(DOCTOR, "/ward/patient-copy?orgId=" + ORG + "&patientId=" + encodeURIComponent(adm.patientId));
  assert.equal(off.__status, 200, JSON.stringify(off));
  assert.deepEqual(off.print, { languagesEnabled: false, timeZone: null, utcOffsetMinutes: 330 }, "off by default; India without a configured offset is IST");
  assert.deepEqual(off.document.medicines[0].patientInstructions, ["after-food"]);
  assert.equal(off.document.medicines[0].frequency, "once weekly");
  assert.equal((await anon("/ward/patient-copy?orgId=" + ORG + "&patientId=" + encodeURIComponent(adm.patientId))).print, undefined, "a refused read says nothing about the settings");

  docs.get(`q_orgs/${ORG}`).fields.wardsynq.printLanguages = { enabled: true };
  docs.get(`q_orgs/${ORG}`).fields.wardsynq.timeZone = "Asia/Kolkata";
  const on = await as(DOCTOR, "/ward/patient-copy?orgId=" + ORG + "&patientId=" + encodeURIComponent(adm.patientId));
  assert.equal(on.print.languagesEnabled, true);
  assert.equal(on.print.timeZone, "Asia/Kolkata");
  const dc = await as(DOCTOR, "/ward/discharge-summary?orgId=" + ORG + "&encounterId=" + encodeURIComponent(adm.encounterId));
  assert.equal(dc.__status, 200, JSON.stringify(dc));
  assert.equal(dc.print.languagesEnabled, true);

  docs.get(`q_orgs/${ORG}`).fields.wardsynq.printLanguages = { enabled: "yes" };
  assert.equal((await as(DOCTOR, "/ward/patient-copy?orgId=" + ORG + "&patientId=" + encodeURIComponent(adm.patientId))).print.languagesEnabled, false, "only enabled:true turns it on");
});

test("POST /api/queue/org/update wardsynq.printLanguages: 401, nurse 403, other hospital refused, nothing written; the admin's save survives the whitelist and keeps the rest", async () => {
  seedWithAdmin();
  const before = JSON.stringify(docs.get(`q_orgs/${ORG}`).fields);
  const body = { orgId: ORG, wardsynq: { printLanguages: { enabled: true } } };
  assert.equal((await anon("/org/update", "POST", body)).__status, 401);
  assert.equal((await as(NURSE, "/org/update", "POST", body)).__status, 403);
  assert.equal((await as(DOCTOR, "/org/update", "POST", body)).__status, 403);
  const cross = await as(OTHER_ADMIN, "/org/update", "POST", body);
  assert.ok(cross.__status === 403 || cross.__status === 404, JSON.stringify(cross));
  assert.equal(JSON.stringify(docs.get(`q_orgs/${ORG}`).fields), before, "nothing written");

  const ok = await as(ADMIN, "/org/update", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.org.wardsynq.printLanguages, { enabled: true });
  assert.deepEqual(ok.org.wardsynq.tariff, TARIFF, "the rest of the hospital's config is kept");
  const off = await as(ADMIN, "/org/update", "POST", { orgId: ORG, wardsynq: { printLanguages: { enabled: false } } });
  assert.deepEqual(off.org.wardsynq.printLanguages, { enabled: false });
});
