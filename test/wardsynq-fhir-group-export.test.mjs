/* test/wardsynq-fhir-group-export.test.mjs - G9: FHIR Group (the ward census), Group/{id}/$export, POST
 * kick-off with a Parameters body, and the Admin Center download buttons.
 *
 * Doors: /api/queue/ward/fhir/Group, /api/queue/ward/fhir/Group/{id}/$export, /api/queue/ward/fhir/$export
 * (POST), /api/queue/ward/fhir-export (groupId), /api/queue/ward/fhir/$export-file/{job}/{name} with a staff
 * session, and /api/fhir/{org}/$export and /api/fhir/{org}/Group/{id}/$export (POST) with a SMART bearer.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-fhir-group-export.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

/* The document object store, in memory. Everything else about object-store.js is the real module. */
const realStore = await import("../functions/_wardsynq/object-store.js?real");
let STORE = realStore.memoryStore();
mock.module("../functions/_wardsynq/object-store.js", { namedExports: { ...realStore, storeFromEnv: () => STORE } });

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
const { runTick } = await import("../functions/_wardsynq/ops-tick.js");
const { hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { SmartGrant, readTypesFor } = await import("../functions/_wardsynq/smart-server.js");
const B = await import("../functions/_wardsynq/fhir-bulk.js");
const { resetMemory } = await import("../functions/_wardsynq/rate-limit.js");

const ORG = "org-wsq", TENANT = "tenant-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test", ADMIN_B = "admin-b@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1" };
const BACKEND = { clientId: "bulk-sys", name: "Warehouse", kind: "backend", scopes: ["system/*.read"], jwks: { keys: [{ kty: "EC", kid: "k" }] } };
const OTHER = { ...BACKEND, clientId: "other-sys", name: "Registry" };

const member = (org, email, role) => docs.set(`q_members/${sanitize(org)}__${sanitize(idFor(email))}`, { fields: { orgId: org, identity: idFor(email), role, active: true }, updateTime: "t1" });
const orgDoc = (id, tenant) => docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id, name: id, kind: "clinic", mode: "wardsynq", connectTenantId: tenant, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { fhir: { smart: { enabled: true, clients: [BACKEND, OTHER, { clientId: "viewer", kind: "public", redirectUris: ["https://app/cb"], scopes: ["user/*.read"] }] } } } }, updateTime: "t1" });

const T0 = "2026-09-01T08:00:00.000Z", T1 = "2026-09-05T08:00:00.000Z";
const at = (iso) => ({ meta: { recordedAt: iso }, writtenBy: { id: "cfa:seed", kind: "human", at: iso } });
async function seedRecords() {
  await RECORD.append(TENANT, [{ resourceType: "Patient", id: "p1", version: 1, mrn: "MR1", name: "Asha", sex: "female", ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "Patient", id: "p2", version: 1, mrn: "MR2", name: "Ravi", sex: "male", ...at(T1) }]);
  await RECORD.append(TENANT, [{ resourceType: "Observation", id: "o1", version: 1, patientId: "p1", code: "8867-4", codeSystem: "loinc", value: 80, unit: "/min", ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "Observation", id: "o2", version: 1, patientId: "p2", code: "8867-4", codeSystem: "loinc", value: 90, unit: "/min", ...at(T1) }]);
  // o1 corrected: exported once, at its current version.
  await RECORD.append(TENANT, [{ resourceType: "Observation", id: "o1", version: 2, patientId: "p1", code: "8867-4", codeSystem: "loinc", value: 82, unit: "/min", ...at(T1) }]);
}

async function as(email, path, method, body, headers) {
  const res = await queue({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email || "", "Content-Type": "application/json", ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  return res;
}
const noSession = (path, method) => queue({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { Prefer: "respond-async" } }), env: ENV });
async function tick() {
  for (let i = 0; i < 20; i++) {
    const t = await runTick(RECORD, TENANT, { nowMs: Date.now(), consumers: B.exportConsumers({ repository: RECORD, tenantId: TENANT, store: STORE, env: ENV }) });
    assert.ok(!t.outbox.error, JSON.stringify(t.outbox));
    if (!t.outbox.ran) return;
  }
}
async function mintBearer(scopes, tenant, client) {
  const tok = "tok-" + Math.random().toString(36).slice(2);
  const now = Date.now();
  const cid = client || "bulk-sys";
  await RECORD.append(tenant || TENANT, [{ ...SmartGrant({ id: `wsq-smart-token-${await hashSecret(tok, "smart:token")}`, kind: "token", clientId: scopes.some((s) => s.startsWith("user/")) ? "viewer" : cid, clientKind: scopes.some((s) => s.startsWith("user/")) ? "public" : "backend", subject: scopes.some((s) => s.startsWith("user/")) ? idFor(DOCTOR) : "smart:" + cid, subjectKind: scopes.some((s) => s.startsWith("user/")) ? "human" : "service", scopes, readTypes: readTypesFor(scopes), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString() }), version: 1, ...at(new Date(now).toISOString()) }]);
  return tok;
}
const smart = (org, path, tok, method, headers) => fhirDoor({ request: new Request(`https://x/api/fhir/${org}/${path}`, { method: method || "GET", headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(headers || {}) } }), env: ENV, params: { path: [org, ...path.split("?")[0].split("/")] } });

async function readNdjson(email, url) {
  const res = await as(email, url.replace(/^https:\/\/x\/api\/queue/, ""));
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get("Content-Type"), "application/fhir+ndjson");
  const text = await res.text();
  assert.ok(text.endsWith("\n"));
  return text.slice(0, -1).split("\n");
}

beforeEach(async () => {
  docs.clear(); clock = 1; resetMemory();
  RECORD = new MemoryRepository(); STORE = realStore.memoryStore();
  orgDoc(ORG, TENANT); orgDoc("org-b", "tenant-b");
  member(ORG, ADMIN, "admin"); member(ORG, DOCTOR, "doctor"); member("org-b", ADMIN_B, "admin");
  await seedRecords();
});

const KICK = "/ward/fhir/$export?orgId=" + ORG;
const { groupIdFor, censusOf } = await import("../functions/_wardsynq/fhir-group.js");

async function seedWards() {
  // p1 is on Ward 3 now; p2 WAS on Ward 3 (finished) and is on ICU now.
  await RECORD.append(TENANT, [{ resourceType: "Encounter", id: "e1", version: 1, patientId: "p1", class: "IPD", status: "in-progress", location: { ward: "Ward 3" }, periodStart: T0, ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "Encounter", id: "e2", version: 1, patientId: "p2", class: "IPD", status: "finished", location: { ward: "Ward 3" }, periodStart: T0, ...at(T0) }]);
  await RECORD.append(TENANT, [{ resourceType: "Encounter", id: "e3", version: 1, patientId: "p2", class: "ICU", status: "in-progress", location: { ward: "ICU" }, periodStart: T1, ...at(T1) }]);
}
const W3 = groupIdFor("Ward 3");
const status = (res) => res.headers.get("Content-Location").replace("https://x/api/queue", "");

test("GROUP IS THE WARD CENSUS: GET /api/queue/ward/fhir/Group lists wards with open encounters, Group/{id} reads one", async () => {
  await seedWards();
  const b = await (await as(DOCTOR, `/ward/fhir/Group?orgId=${ORG}`)).json();
  assert.equal(b.resourceType, "Bundle");
  assert.deepEqual(b.entry.map((e) => e.resource.name), ["ICU", "Ward 3"]);
  const g = await (await as(DOCTOR, `/ward/fhir/Group/${W3}?orgId=${ORG}`)).json();
  assert.equal(g.resourceType, "Group");
  assert.equal(g.actual, true);
  assert.deepEqual(g.member.map((m) => m.entity.reference), ["Patient/p1"], "a finished stay is not on the ward");
  assert.equal((await as(DOCTOR, `/ward/fhir/Group/ward-0000000000000000?orgId=${ORG}`)).status, 404);
  assert.equal((await as(DOCTOR, `/ward/fhir/Group?code=x&orgId=${ORG}`)).status, 400, "an unsupported search parameter is refused");
  assert.equal(censusOf([{ status: "in-progress", patientId: "x", location: {} }]).size, 0, "no ward, no group");
});

test("GROUP EXPORT AUTH on /api/queue/ward/fhir/Group/{id}/$export: no session 401, doctor 403, another hospital 403, nothing started; unknown group 404", async () => {
  await seedWards();
  const path = `/ward/fhir/Group/${W3}/$export?orgId=${ORG}`;
  assert.equal((await noSession(path)).status, 401);
  assert.equal((await as(DOCTOR, path, "GET", null, { Prefer: "respond-async" })).status, 403);
  assert.equal((await as(ADMIN_B, path, "GET", null, { Prefer: "respond-async" })).status, 403);
  assert.equal((await as(DOCTOR, "/ward/fhir-export", "POST", { orgId: ORG, groupId: W3 })).status, 403);
  assert.equal((await RECORD.latestByType(TENANT, B.JOB_TYPE, 10)).length, 0);
  const unknown = await as(ADMIN, `/ward/fhir/Group/ward-0000000000000000/$export?orgId=${ORG}`, "GET", null, { Prefer: "respond-async" });
  assert.equal(unknown.status, 404);
  assert.equal((await RECORD.latestByType(TENANT, B.JOB_TYPE, 10)).length, 0);
});

test("GROUP EXPORT carries only the ward's patients, frozen at kick-off", async () => {
  await seedWards();
  const k = await as(ADMIN, `/ward/fhir/Group/${W3}/$export?orgId=${ORG}&_type=Patient,Observation,Encounter`, "GET", null, { Prefer: "respond-async" });
  assert.equal(k.status, 202, await k.clone().text());
  // Admitted to Ward 3 after the kick-off: not in this export.
  await RECORD.append(TENANT, [{ resourceType: "Patient", id: "p9", version: 1, mrn: "MR9", name: "Late", sex: "male", ...at(T1) }]);
  await tick();
  const m = await (await as(ADMIN, status(k))).json();
  const ids = {};
  for (const o of m.output) ids[o.type] = (await readNdjson(ADMIN, o.url)).map((l) => JSON.parse(l).id).sort();
  assert.deepEqual(ids.Patient, ["p1"]);
  assert.deepEqual(ids.Observation, ["o1"], "p2's observation is not on Ward 3");
  assert.deepEqual(ids.Encounter, ["e1"]);
  const listed = await (await as(ADMIN, "/ward/fhir-exports?orgId=" + ORG)).json();
  assert.equal(listed.exports[0].level, "group");
  assert.equal(listed.exports[0].groupName, "Ward 3");
  assert.ok(RECORD.audit.some((a) => a.action === "fhir.export.kickoff" && a.scope && a.scope.groupId === W3));
});

test("POST KICK-OFF: a Parameters body on /api/queue/ward/fhir/$export; parameters in the URL or an unknown one are refused", async () => {
  const body = { resourceType: "Parameters", parameter: [{ name: "_type", valueString: "Patient" }, { name: "_since", valueInstant: "2026-09-03T00:00:00Z" }] };
  const inUrl = await as(ADMIN, KICK + "&_type=Patient", "POST", body, { Prefer: "respond-async" });
  assert.equal(inUrl.status, 400);
  const notParams = await as(ADMIN, KICK, "POST", { _type: "Patient" }, { Prefer: "respond-async" });
  assert.equal(notParams.status, 400);
  const unknown = await as(ADMIN, KICK, "POST", { resourceType: "Parameters", parameter: [{ name: "_typeFilter", valueString: "Observation?code=x" }] }, { Prefer: "respond-async" });
  assert.equal(unknown.status, 400, "never silently dropped");
  assert.equal((await RECORD.latestByType(TENANT, B.JOB_TYPE, 10)).length, 0);
  const noAuth = await queue({ request: new Request(`https://x/api/queue${KICK}`, { method: "POST", headers: { Prefer: "respond-async", "Content-Type": "application/json" }, body: JSON.stringify(body) }), env: ENV });
  assert.equal(noAuth.status, 401);

  const ok = await as(ADMIN, KICK, "POST", body, { Prefer: "respond-async" });
  assert.equal(ok.status, 202, await ok.clone().text());
  await tick();
  const m = await (await as(ADMIN, status(ok))).json();
  assert.deepEqual((await readNdjson(ADMIN, m.output[0].url)).map((l) => JSON.parse(l).id), ["p2"], "_since from the body was applied");
});

test("SMART DOOR: POST /api/fhir/{org}/Group/{id}/$export with a backend token is 202; a user token is 403 and a bearer-less POST 401", async () => {
  await seedWards();
  const post = (path, tok) => fhirDoor({ request: new Request(`https://x/api/fhir/${ORG}/${path}`, { method: "POST", headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), Prefer: "respond-async", "Content-Type": "application/fhir+json" }, body: JSON.stringify({ resourceType: "Parameters", parameter: [{ name: "_type", valueString: "Patient" }] }) }), env: ENV, params: { path: [ORG, ...path.split("/")] } });
  assert.equal((await post(`Group/${W3}/$export`)).status, 401);
  const user = await mintBearer(["user/*.read"]);
  assert.equal((await post(`Group/${W3}/$export`, user)).status, 403);
  assert.equal((await RECORD.latestByType(TENANT, B.JOB_TYPE, 10)).length, 0);
  const sys = await mintBearer(["system/*.read"]);
  const ok = await post(`Group/${W3}/$export`, sys);
  assert.equal(ok.status, 202, await ok.clone().text());
  assert.equal((await post("Patient", sys)).status, 405, "POST opens the kick-off only; the door stays read-only");
});

test("ADMIN SCREEN: a finished file has a Download button, the ward picker lists the census, a failed ward list is said", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  const adminSrc = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  run(adminSrc);
  const html = win.WSQ._exportHtml, c = { esc: win.WSQ.esc, ms: win.WSQ.ms };
  assert.equal(typeof win.WSQ.download, "function");
  const r = { ok: true, exportable: ["Patient"], exports: [{ id: "j1", status: "complete", level: "group", groupName: "Ward 3", types: ["Patient"], files: [{ type: "Patient", name: "Patient-1.ndjson", count: 1 }], issues: [], requestedAt: "t", requestedBy: "a" }] };
  const groups = { resourceType: "Bundle", entry: [{ resource: { resourceType: "Group", id: W3, name: "Ward 3", quantity: 1 } }] };
  const page = html(c, r, groups);
  assert.ok(page.includes('data-exp-file="j1" data-exp-name="Patient-1.ndjson"'));
  assert.ok(page.includes(`<option value="${W3}">Ward 3 (1 patients now)</option>`));
  assert.ok(page.includes("ward: Ward 3"));
  assert.match(html(c, r, false), /wards could not be listed/);
  assert.match(html(c, r, null), /Loading the wards/);
  assert.ok(adminSrc.includes('c.download("/ward/fhir/$export-file/"'), "the button downloads through the audited file route");
  assert.ok(adminSrc.includes('c.api("/ward/fhir/Group" + q)'));
});
