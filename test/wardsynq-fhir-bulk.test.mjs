/* test/wardsynq-fhir-bulk.test.mjs - FHIR Bulk Data export ($export), end to end through both doors.
 *
 * The ward door (/api/queue/ward/fhir/$export, /ward/fhir-export, /ward/fhir-exports,
 * /ward/fhir-export-cancel) with a staff session, and the SMART door (/api/fhir/{org}/$export) with a
 * backend-services bearer. The background run is driven through ops-tick's runTick with the export
 * consumers, exactly as the router's waitUntil does.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-fhir-bulk.test.mjs
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

test("KICK-OFF AUTH on /api/queue/ward/fhir/$export: no session 401, a doctor 403, another hospital's admin 403, nothing started", async () => {
  assert.equal((await noSession(KICK)).status, 401);
  assert.equal((await as(DOCTOR, KICK, "GET", null, { Prefer: "respond-async" })).status, 403, "emr.view reads a chart; it does not export the hospital");
  assert.equal((await as(ADMIN_B, KICK, "GET", null, { Prefer: "respond-async" })).status, 403);
  assert.equal((await as(DOCTOR, "/ward/fhir-export", "POST", { orgId: ORG, types: ["Patient"] })).status, 403);
  assert.equal((await RECORD.latestByType(TENANT, B.JOB_TYPE, 10)).length, 0, "no job was written by any refusal");
});

test("PREFER: respond-async IS REQUIRED, then 202 with Content-Location; a poll before ready is 202 with X-Progress", async () => {
  const bad = await as(ADMIN, KICK, "GET");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).issue[0].diagnostics, /respond-async/);

  const ok = await as(ADMIN, KICK + "&_type=Patient,Observation", "GET", null, { Prefer: "respond-async" });
  assert.equal(ok.status, 202, await ok.clone().text());
  const loc = ok.headers.get("Content-Location");
  assert.match(loc, /^https:\/\/x\/api\/queue\/ward\/fhir\/\$export-status\/wsq-fhirexp-[0-9a-f]+\?orgId=org-wsq$/);

  const poll = await as(ADMIN, loc.replace("https://x/api/queue", ""));
  assert.equal(poll.status, 202, "not ready until the background run has happened");
  assert.match(poll.headers.get("X-Progress"), /0 resources exported/);
  assert.equal(await poll.text(), "", "a 202 poll is never mistaken for an empty manifest");

  const strict = await as(ADMIN, KICK + "&_typeFilter=Observation%3Fcode%3Dx", "GET", null, { Prefer: "respond-async" });
  assert.equal(strict.status, 400, "an unsupported parameter is refused, never silently dropped");
});

test("THE MANIFEST: NDJSON one resource per line, counts equal the lines, audited download, current version once", async () => {
  const k = await as(ADMIN, KICK + "&_type=Patient,Observation", "GET", null, { Prefer: "respond-async" });
  const loc = k.headers.get("Content-Location");
  await tick();
  const res = await as(ADMIN, loc.replace("https://x/api/queue", ""));
  assert.equal(res.status, 200);
  const m = await res.json();
  assert.equal(m.requiresAccessToken, true);
  assert.ok(m.transactionTime && m.request.includes("$export"));
  assert.deepEqual(m.error, []);
  assert.deepEqual(m.output.map((o) => o.type).sort(), ["Observation", "Patient"]);
  for (const o of m.output) {
    const lines = await readNdjson(ADMIN, o.url);
    assert.equal(lines.length, o.count, `${o.type}: manifest count equals lines`);
    for (const l of lines) { const r = JSON.parse(l); assert.equal(r.resourceType, o.type); assert.ok(r.id); }
    if (o.type === "Observation") {
      const obs = lines.map((l) => JSON.parse(l));
      assert.equal(obs.length, 2, "o1 has two versions and is exported once");
      assert.equal(obs.find((x) => x.id === "o1").valueQuantity.value, 82, "at its current version");
    }
  }
  assert.ok(RECORD.audit.some((a) => a.action === "fhir.export.kickoff" && a.actor === idFor(ADMIN)));
  assert.ok(RECORD.audit.some((a) => a.action === "fhir.export.complete"));
  assert.equal(RECORD.audit.filter((a) => a.action === "fhir.export.download").length, 2);

  // The file is not readable from another hospital, or without a session.
  const fileUrl = m.output[0].url.replace("https://x/api/queue", "");
  assert.equal((await as(ADMIN_B, fileUrl.replace("orgId=org-wsq", "orgId=org-b"))).status, 404, "another hospital's door has no such export");
  assert.equal((await as(ADMIN_B, fileUrl)).status, 403);
  assert.equal((await noSession(fileUrl)).status, 401);
});

test("_since FILTERS by when the record changed", async () => {
  const k = await as(ADMIN, KICK + "&_type=Patient&_since=2026-09-03T00:00:00Z", "GET", null, { Prefer: "respond-async" });
  await tick();
  const m = await (await as(ADMIN, k.headers.get("Content-Location").replace("https://x/api/queue", ""))).json();
  assert.equal(m.output.length, 1);
  const lines = await readNdjson(ADMIN, m.output[0].url);
  assert.deepEqual(lines.map((l) => JSON.parse(l).id), ["p2"], "p1 was last changed before _since");
  assert.equal(B.parseExportParams(new URLSearchParams("_since=yesterday")).problems.length, 1);
});

test("ONE ACTIVE EXPORT PER HOSPITAL, and CANCELLATION frees it and removes the files", async () => {
  const first = await as(ADMIN, "/ward/fhir-export", "POST", { orgId: ORG, types: ["Patient"] });
  assert.equal(first.status, 202);
  const { jobId } = await first.json();
  const second = await as(ADMIN, KICK, "GET", null, { Prefer: "respond-async" });
  assert.equal(second.status, 429);
  assert.ok(second.headers.get("Retry-After"));
  assert.equal((await RECORD.latestByType(TENANT, B.JOB_TYPE, 10)).length, 1);

  const listed = await (await as(ADMIN, "/ward/fhir-exports?orgId=" + ORG)).json();
  assert.equal(listed.exports[0].status, "in-progress");

  const cancel = await as(ADMIN, `/ward/fhir/$export-status/${jobId}?orgId=${ORG}`, "DELETE");
  assert.equal(cancel.status, 202);
  assert.ok(RECORD.audit.some((a) => a.action === "fhir.export.cancel"));
  assert.equal((await as(ADMIN, `/ward/fhir/$export-status/${jobId}?orgId=${ORG}`)).status, 404, "a cancelled export has no status");
  await tick();
  const job = await RECORD.latest(TENANT, B.JOB_TYPE, jobId);
  assert.equal(job.status, "cancelled", "the background run does not resurrect it");
  assert.equal(STORE._objects.size, 0, "and wrote no files for it");

  const third = await as(ADMIN, "/ward/fhir-export", "POST", { orgId: ORG, types: ["Patient"] });
  assert.equal(third.status, 202, "the slot is free again");
  const t = await third.json();
  await tick();
  assert.ok(STORE._objects.size > 0);
  const del = await as(ADMIN, "/ward/fhir-export-cancel", "POST", { orgId: ORG, id: t.jobId });
  assert.equal(del.status, 200);
  assert.equal(STORE._objects.size, 0, "withdrawing a finished export deletes its files");
  const after = await (await as(ADMIN, "/ward/fhir-exports?orgId=" + ORG)).json();
  assert.deepEqual(after.exports.map((x) => x.status).sort(), ["cancelled", "cancelled"]);
});

test("TRUNCATION IS NAMED IN error[], never a short file that looks whole", async () => {
  const k = await as(ADMIN, KICK + "&_type=Patient,Observation", "GET", null, { Prefer: "respond-async" });
  const jobId = k.headers.get("Content-Location").match(/(wsq-fhirexp-[0-9a-f]+)/)[1];
  const consumers = B.exportConsumers({ repository: RECORD, tenantId: TENANT, store: STORE, env: ENV, maxResources: 2 });
  for (let i = 0; i < 5; i++) { const t = await runTick(RECORD, TENANT, { consumers }); if (!t.outbox.ran) break; }
  const m = await (await as(ADMIN, `/ward/fhir/$export-status/${jobId}?orgId=${ORG}`)).json();
  assert.equal(m.output.reduce((n, o) => n + o.count, 0), 2);
  assert.equal(m.error.length, 1);
  assert.equal(m.error[0].type, "OperationOutcome");
  const oo = (await readNdjson(ADMIN, m.error[0].url)).map((l) => JSON.parse(l));
  assert.equal(oo.length, m.error[0].count);
  assert.deepEqual(oo.map((o) => o.issue[0].expression[0]).sort(), ["Observation", "Patient"], "every requested type is named as possibly incomplete");
  const issues = m.extension["https://wardsynq.com/fhir/StructureDefinition/export-issues"];
  assert.ok(issues.every((i) => i.code === "incomplete"));
  const listed = await (await as(ADMIN, "/ward/fhir-exports?orgId=" + ORG)).json();
  assert.equal(listed.exports[0].issues.length, 2, "the admin screen sees the same issues");
});

test("A RUN THAT KEEPS FAILING MARKS THE JOB FAILED, never in-progress for ever and never an empty success", async () => {
  const k = await as(ADMIN, "/ward/fhir-export", "POST", { orgId: ORG, types: ["Patient"] });
  const { jobId } = await k.json();
  const broken = { ...STORE, put: async () => { throw new Error("store unavailable"); } };
  const evt = (await RECORD.latestByType(TENANT, "_wardsynq_outbox", 10)).find((e) => e.payload.jobId === jobId);
  await assert.rejects(B.runExportChunk({ repository: RECORD, tenantId: TENANT, store: broken, env: ENV }, evt.payload, { attempts: 0 }), /store unavailable/);
  assert.equal((await RECORD.latest(TENANT, B.JOB_TYPE, jobId)).status, "in-progress", "an early failure is retried");
  await B.runExportChunk({ repository: RECORD, tenantId: TENANT, store: broken, env: ENV }, evt.payload, { attempts: 5 });
  const job = await RECORD.latest(TENANT, B.JOB_TYPE, jobId);
  assert.equal(job.status, "failed");
  const st = await as(ADMIN, `/ward/fhir/$export-status/${jobId}?orgId=${ORG}`);
  assert.equal(st.status, 500);
  assert.match((await st.json()).issue[0].diagnostics, /store unavailable/);
  const listed = await (await as(ADMIN, "/ward/fhir-exports?orgId=" + ORG)).json();
  assert.equal(listed.exports[0].status, "failed");
  assert.match(listed.exports[0].error, /store unavailable/);
  // A stalled job reads as failed and frees the slot.
  assert.equal(B.effectiveStatus({ status: "in-progress", progressAt: "2026-01-01T00:00:00Z" }, Date.now()), "failed");
});

test("ADMIN SCREEN: loading, failed load, running, done, failed, cancelled and expired all read differently; failed is never empty", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const html = win.WSQ._exportHtml, c = { esc: win.WSQ.esc, ms: win.WSQ.ms };

  assert.match(html(c, null), /spin/);
  const failedLoad = html(c, { failed: true, message: "forbidden" });
  assert.match(failedLoad, /could not be loaded: forbidden/);
  assert.match(failedLoad, /not the same as there being none/);
  assert.match(html(c, { ok: true, exportable: ["Patient"], exports: [] }), /No export has been started/);

  const job = (over) => ({ id: "j", level: "system", types: ["Patient"], since: null, requestedAt: "t", requestedBy: "cfa:a", files: [], issues: [], exported: 0, error: null, ...over });
  const page = html(c, { ok: true, exportable: ["Patient", "Observation"], exports: [
    job({ id: "run", status: "in-progress", exported: 40 }),
    job({ id: "done", status: "complete", files: [{ type: "Patient", name: "Patient-1.ndjson", count: 12 }] }),
    job({ id: "none", status: "complete" }),
    job({ id: "bad", status: "failed", error: "store unavailable" }),
    job({ id: "cx", status: "cancelled" }),
    job({ id: "old", status: "expired" }),
    job({ id: "cut", status: "complete", files: [{ type: "Patient", name: "Patient-1.ndjson", count: 2 }], issues: [{ type: "Patient", code: "incomplete", detail: "Patient may be incomplete" }] }),
  ] });
  assert.match(page, /Running<br><span class="quiet">40 resources so far/);
  assert.match(page, /Patient-1\.ndjson: 12/);
  assert.match(page, /Done\. No resources matched this export\./);
  assert.match(page, /Failed: store unavailable/);
  assert.match(page, /Cancelled/);
  assert.match(page, /Expired, files deleted/);
  assert.match(page, /Not included: Patient may be incomplete/);
  const failedRow = page.split("<tr>").find((r) => r.includes("store unavailable"));
  assert.ok(!/No resources matched/.test(failedRow), "a failed export never reads as an empty one");
  assert.ok(!/[—]/.test(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8").split("DATA EXPORT (FHIR)")[1].split("function renderSecurity")[0]), "no em dash in the export screen");
});

test("A RECORD EDITED DURING THE EXPORT appears once, as it stood at transactionTime", async () => {
  const k = await as(ADMIN, KICK + "&_type=Observation", "GET", null, { Prefer: "respond-async" });
  const later = new Date(Date.now() + 60000).toISOString();
  await RECORD.append(TENANT, [{ resourceType: "Observation", id: "o2", version: 2, patientId: "p2", code: "8867-4", codeSystem: "loinc", value: 140, unit: "/min", ...at(later) }]);
  await tick();
  const m = await (await as(ADMIN, k.headers.get("Content-Location").replace("https://x/api/queue", ""))).json();
  const obs = (await readNdjson(ADMIN, m.output[0].url)).map((l) => JSON.parse(l));
  assert.deepEqual(obs.map((o) => o.id).sort(), ["o1", "o2"]);
  assert.equal(obs.find((o) => o.id === "o2").valueQuantity.value, 90, "the version current when the export was asked for");
});

test("THE SMART DOOR /api/fhir/{org}/$export: no token 401, a user token 403, another hospital's token 401, a backend token 202 and its own export only", async () => {
  assert.equal((await smart(ORG, "$export", null, "GET", { Prefer: "respond-async" })).status, 401);
  const user = await mintBearer(["user/*.read"]);
  assert.equal((await smart(ORG, "$export", user, "GET", { Prefer: "respond-async" })).status, 403, "bulk needs system/ scopes");
  const other = await mintBearer(["system/*.read"], "tenant-b");
  assert.equal((await smart(ORG, "$export", other, "GET", { Prefer: "respond-async" })).status, 401, "a token is only a token at the hospital that issued it");

  const narrow = await mintBearer(["system/Patient.read"]);
  assert.equal((await smart(ORG, "$export?_type=Observation", narrow, "GET", { Prefer: "respond-async" })).status, 403, "types are limited to the granted scopes");

  const sys = await mintBearer(["system/*.read"]);
  const k = await smart(ORG, "Patient/$export?_type=Patient", sys, "GET", { Prefer: "respond-async" });
  assert.equal(k.status, 202, await k.clone().text());
  const loc = k.headers.get("Content-Location");
  assert.match(loc, /^https:\/\/x\/api\/fhir\/org-wsq\/\$export-status\/wsq-fhirexp-/);
  const statusPath = loc.replace("https://x/api/fhir/org-wsq/", "");
  await tick();
  const m = await (await smart(ORG, statusPath, sys)).json();
  assert.equal(m.output[0].count, 2);
  const filePath = m.output[0].url.replace("https://x/api/fhir/org-wsq/", "");
  const file = await smart(ORG, filePath, sys);
  assert.equal(file.status, 200);
  assert.equal((await file.text()).trim().split("\n").length, 2);

  const stranger = await mintBearer(["system/*.read"], TENANT, "other-sys");
  assert.equal((await smart(ORG, filePath, stranger)).status, 404, "another client does not see this export");
  assert.equal((await smart(ORG, statusPath, stranger)).status, 404);
  const obsOnly = await mintBearer(["system/Observation.read"]);
  assert.equal((await smart(ORG, filePath, obsOnly)).status, 403, "a narrower token of the same client may not read a type it was not granted");
  assert.equal((await smart(ORG, statusPath, sys, "DELETE")).status, 202);
});
