/* test/_wardsynq-alert-harness.mjs — one hospital, two routers, real push senders, for the S3 P0 tests.
 *
 * Import this FIRST (it registers the module mocks before either router loads). In-memory Firestore,
 * _wardsynq/deps.js on a real MemoryRepository, a Map-backed KV, a real APNs/FCM signing key and a
 * captured fetch, so what leaves for Apple, Google and 2Factor is asserted byte for byte.
 *
 * node --test --experimental-test-module-mocks test/<file>.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { mock } from "node:test";
import { webcrypto, createHash, generateKeyPairSync } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

export const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/") || path.slice(coll.length + 1).includes("/")) continue;
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
const { verifyStaffSession, mintStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
export const H = { RECORD: new MemoryRepository() };
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
    recordDeps: () => ({ repository: H.RECORD, pseudonym: async () => null }),
  },
});

export const { onRequest: queue } = await import("../functions/api/queue/[[path]].js");
export const { onRequest: push } = await import("../functions/api/push/[[path]].js");

export const ORG = "org-wsq", OTHER_ORG = "org-other";
export const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
export const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
export const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", SUPERVISOR = "supervisor@example.test", LAB = "lab@example.test";
export const ADMIN = "admin@example.test", OFFDUTY = "offduty@example.test", OTHER_DOCTOR = "other-doctor@example.test";
export const PATIENT_NAME = "Alertpath Testpatient", WARD = "Medical A", BED = "7";

/* A Map-backed KV with the three calls the code uses, plus list for the account fan-out. */
export function memoryKv() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => { const v = m.has(k) ? m.get(k) : null; return v != null && type === "json" ? JSON.parse(v) : v; },
    put: async (k, v) => { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix } = {}) => ({ keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const KV = { current: memoryKv(), maik: memoryKv() };
export const ENV = {
  QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
  UPDATES_ADMIN_TOKEN: "worker-admin-token-for-tests",
  APNS_KEY_P8: ec.privateKey.export({ type: "pkcs8", format: "pem" }), APNS_KEY_ID: "KEYID12345", APNS_TEAM_ID: "TEAMID1234",
  FCM_SERVICE_ACCOUNT: JSON.stringify({ client_email: "svc@test.iam", project_id: "proj-test", private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }) }),
  TWOFACTOR_API_KEY: "twofactor-test-key",
  get PUSH_KV() { return KV.current; },
  get MAIK_KV() { return KV.maik; },
};

/* Every outbound call, captured. APNs, FCM (and its OAuth) and 2Factor answer success. */
export const sent = [];
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input.url);
  const body = init && init.body != null ? String(init.body) : "";
  if (url.startsWith("https://api.push.apple.com/") || url.startsWith("https://api.sandbox.push.apple.com/")) { sent.push({ kind: "apns", url, body, headers: init.headers }); return new Response("", { status: 200 }); }
  if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
  if (url.startsWith("https://fcm.googleapis.com/")) { sent.push({ kind: "fcm", url, body }); return new Response("{}", { status: 200 }); }
  if (url.startsWith("https://2factor.in/")) { sent.push({ kind: "sms", url, body }); return new Response(JSON.stringify({ Status: "Success", Details: "sms-1" }), { status: 200 }); }
  throw new Error("unexpected fetch " + url);
};

export function seedHospital(wardsynq) {
  docs.clear(); clock = 1; sent.length = 0;
  H.RECORD = new MemoryRepository();
  KV.current = memoryKv();
  KV.maik = memoryKv();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: wardsynq || {} }, updateTime: "t1" });
  for (const [email, role, mobile] of [[DOCTOR, "doctor", "9876500001"], [NURSE, "nurse", "9876500002"], [SUPERVISOR, "supervisor", ""], [LAB, "lab", ""], [ADMIN, "admin", ""], [OFFDUTY, "nurse", ""]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true, alertMobile: mobile }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(ORG)}__nurse1`, { fields: { orgId: ORG, identity: "nurse1", role: "nurse", active: true }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER_ORG}`, { fields: { id: OTHER_ORG, code: "SMD-OTHR01", name: "A Different Hospital", kind: "clinic", mode: "native", ownerUid: "cfa:someone-else", createdAt: 1 }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(OTHER_ORG)}__${sanitize(idFor(OTHER_DOCTOR))}`, { fields: { orgId: OTHER_ORG, identity: idFor(OTHER_DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(OTHER_ORG)}__nurse9`, { fields: { orgId: OTHER_ORG, identity: "nurse9", role: "nurse", active: true }, updateTime: "t1" });
  /* The rota: doctor, nurse and supervisor on duty in Medical A around the clock (two 12-hour shifts,
   * yesterday to tomorrow, so the test passes at any hour). OFFDUTY is a nurse with no shift. */
  for (const [id, start, end] of [["day", "00:00", "12:00"], ["night", "12:00", "00:00"]]) {
    docs.set(`q_roster_shifts/${ORG}__${id}`, { fields: { orgId: ORG, shiftId: id, name: id, unit: WARD, start, end, minimum: {}, active: true }, updateTime: "t1" });
  }
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  let k = 0;
  for (const email of [DOCTOR, NURSE, SUPERVISOR]) {
    for (const n of [-1, 0, 1]) for (const shiftId of ["day", "night"]) {
      docs.set(`q_roster_assign/a${++k}`, { fields: { orgId: ORG, orgMonth: ORG + "|" + day(n).slice(0, 7), identity: idFor(email), date: day(n), shiftId, status: "active" }, updateTime: "t1" });
    }
  }
}

async function call(handler, base, path, method, body, headers) {
  const url = "https://x" + base + path;
  const res = await handler({
    request: new Request(url, { method: method || "GET", headers: { "Content-Type": "application/json", ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined }),
    env: ENV, params: { path: path.replace(/^\//, "").split("?")[0].split("/") },
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const who = (email) => (email ? { "Cf-Access-Authenticated-User-Email": email } : {});
export const as = (email, path, method, body, headers) => call(queue, "/api/queue", path, method, body, { ...who(email), ...(headers || {}) });
export const pushAs = (email, path, method, body, headers) => call(push, "/api/push", path, method, body, { ...who(email), ...(headers || {}) });
export const staffToken = (orgId, identity, atMs) => mintStaffSession(ENV, orgId, identity, atMs || Date.now());

let n = 0;
/** Admits a real patient and gives the doctor a device; returns ids for a result to be released against. */
export async function admittedPatient() {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: PATIENT_NAME, mobile: "98765012" + String(n).padStart(2, "0"), gender: "male", ageYears: 60 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: WARD, bed: BED });
  if (adm.__status !== 200) throw new Error("admit failed " + JSON.stringify(adm));
  return { mrn: reg.mrn, patientId: adm.patientId, encounterId: adm.encounterId };
}
export async function registerDevice(email, token, headers) {
  return pushAs(email, "/register-member", "POST", { orgId: ORG, token, platform: "ios" }, headers);
}
/** The doctor orders a potassium (or `analyte`, one per encounter) and the lab releases `value`, reported `minutesAgo` minutes ago. */
export async function releasePotassium(p, value, minutesAgo, analyte) {
  const test = analyte || "Potassium";
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: p.encounterId, code: test, category: "laboratory" });
  if (order.__status !== 200) throw new Error("order failed " + JSON.stringify(order));
  // LT-25: a result is released for a sample somebody collected.
  const got = await as(LAB, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: order.orderId, specimenType: "Serum" });
  if (got.__status !== 200) throw new Error("collect failed " + JSON.stringify(got));
  const r = await as(LAB, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: order.orderId, status: "final", reportedAt: new Date(Date.now() - (minutesAgo || 0) * 60000).toISOString(),
    tests: [{ test, value, unit: "mmol/L" }],
  });
  if (r.__status !== 200) throw new Error("release failed " + JSON.stringify(r));
  return r;
}
export async function loopOf(release) {
  const id = release.criticalCheck.loops[0].loopId;
  return H.RECORD.latest("tenant-wsq", "CriticalResultLoop", id);
}
export const tickAll = (headers) => call(queue, "/api/queue", "/ops/tick-all", "POST", {}, headers === undefined ? { "X-Admin-Token": ENV.UPDATES_ADMIN_TOKEN } : headers);
