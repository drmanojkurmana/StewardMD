/* test/wardsynq-webhooks.test.mjs - P2.13: tenant-scoped webhooks through the outbox.
 *
 * Routes: GET /api/queue/ward/webhooks, POST /api/queue/ward/webhook, POST /api/queue/ward/webhook-update,
 * POST /api/queue/ward/webhook-rotate, POST /api/queue/ward/webhook-test, GET /api/queue/ward/webhook-deliveries,
 * and POST /api/queue/ward/admit as the clinical write that emits encounter.admitted.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-webhooks.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  "tenant-wsq": { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) },
  "tenant-other": { id: "tenant-other", name: "Other", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-other" } }) },
};
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (TENANTS[String(a[0])] ? { ...TENANTS[String(a[0])] } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async (id) => "ref-" + id }),
  },
});

const W = await import("../functions/_wardsynq/webhooks.js");
const E = await import("../functions/_wardsynq/webhook-events.js");
const { TYPE: OUTBOX, MAX_ATTEMPTS, drainOutbox } = await import("../functions/_wardsynq/outbox.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const T = "tenant-wsq", ORG_ID = "org-wsq", OTHER = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", NURSE = "nurse@example.test", HR = "hr@example.test", OTHER_ADMIN = "boss@other.test";
const PUBLIC_URL = "https://93.184.216.34/hooks/wardsynq";
const kv = new Map();
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
  MAIK_KV: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); } } };

function seed() {
  docs.clear(); clock = 1; kv.clear();
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-wsq", ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER}`, { fields: { id: OTHER, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OTHER_ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [NURSE, "nurse"], [HR, "hr"]]) {
    docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(OTHER)}__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: OTHER, identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const headers = { ...(email ? { "Cf-Access-Authenticated-User-Email": email } : {}), ...(body ? { "Content-Type": "application/json" } : {}) };
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const writesNow = () => RECORD._rows.length + RECORD.audit.length + docs.size;
const outboxRows = async (topic) => (await RECORD.latestByType(T, OUTBOX, 1000)).filter((e) => !topic || e.topic === topic);
const register = (types) => as(ADMIN, "/ward/webhook", "POST", { orgId: ORG_ID, url: PUBLIC_URL, eventTypes: types || ["encounter.admitted"] });
let bedNo = 0;
const admit = (mrn) => as(ADMIN, "/ward/admit", "POST", { orgId: ORG_ID, mrn, ward: "Medical A", bed: String(++bedNo) });

/** A deterministic receiver: records each request, answers with `status`. */
function receiver(status) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(null, typeof status === "function" ? status(calls.length) : { status: status || 200 }); };
  return { calls, fetchImpl };
}
async function drainAll(deps, times) {
  for (let i = 0; i < (times || 1); i++) await drainOutbox(RECORD, T, W.webhookConsumers(deps), { now: () => deps.nowMs });
}

// ---------------------------------------------------------------------------------------------
// ADDRESSES
// ---------------------------------------------------------------------------------------------
test("addressBlocked: private, loopback, link-local, metadata and tunnelled forms are refused; public ones are not", () => {
  for (const ip of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.1", "100.100.100.200", "192.0.0.192", "0.0.0.0", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fd00:ec2::254", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:0a00:0001::1", "2001:db8::1", "ff02::1", "not-an-ip"]) {
    assert.equal(W.addressBlocked(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(W.addressBlocked(ip), false, ip);
});

test("checkDestination: https only, and a NAME that resolves to a private or metadata address is refused", async () => {
  const to = (ips) => ({ resolveHost: async () => ips });
  assert.equal((await W.checkDestination("http://hooks.example.com/x", to(["93.184.216.34"]))).ok, false, "http refused");
  assert.equal((await W.checkDestination("https://169.254.169.254/latest/meta-data", to([]))).ok, false, "metadata literal refused");
  assert.equal((await W.checkDestination("https://metadata.google.internal/", to(["93.184.216.34"]))).ok, false, ".internal name refused");
  assert.equal((await W.checkDestination("https://hooks.example.com/x", to(["93.184.216.34", "10.1.2.3"]))).ok, false, "one private address among several is enough to refuse");
  assert.equal((await W.checkDestination("https://hooks.example.com/x", to([]))).reason, "dns-failed");
  assert.equal((await W.checkDestination("https://hooks.example.com/x", { resolveHost: async () => { throw new Error("SERVFAIL"); } })).ok, false, "a resolver that cannot answer is a refusal");
  assert.equal((await W.checkDestination("https://hooks.example.com/x", to(["93.184.216.34"]))).ok, true);
});

// ---------------------------------------------------------------------------------------------
// SIGNATURE
// ---------------------------------------------------------------------------------------------
test("signature verifies over timestamp and body; a changed body, a wrong secret or a stale timestamp does not", async () => {
  const now = Date.parse("2026-09-14T10:00:00Z"), ts = Math.floor(now / 1000), body = '{"id":"evt-1","type":"order.placed"}';
  const sig = await W.signPayload("whsec_abc", ts, body);
  assert.match(sig, /^v1=[0-9a-f]{64}$/);
  assert.equal(await W.verifySignature("whsec_abc", ts, body, sig, now), true);
  assert.equal(await W.verifySignature("whsec_abc", ts, body.replace("order", "result"), sig, now), false);
  assert.equal(await W.verifySignature("whsec_other", ts, body, sig, now), false);
  assert.equal(await W.verifySignature("whsec_abc", ts, body, sig, now + 10 * 60 * 1000), false, "a replay ten minutes later is refused");
});

// ---------------------------------------------------------------------------------------------
// END TO END: register, admit, deliver
// ---------------------------------------------------------------------------------------------
test("an admission emits one encounter.admitted in its own write; the delivery is signed, has the headers, and carries no PHI", async () => {
  seed();
  const reg = await register(["encounter.admitted", "encounter.discharged"]);
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  assert.match(reg.secret, /^whsec_/);

  const mrn = "MRN778812";
  const adm = await admit(mrn);
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  const staged = await outboxRows(E.TOPIC_EVENT);
  assert.equal(staged.length, 1, "exactly one event for one admission");
  assert.equal(staged[0].payload.type, "encounter.admitted");
  const enc = await RECORD.latest(T, "Encounter", adm.encounterId);
  assert.ok(RECORD._rows.findIndex((r) => r.id === staged[0].id) === RECORD._rows.findIndex((r) => r.id === enc.id) - 1, "the event landed in the same append, just before the encounter");

  const rx = receiver(204);
  const deps = { repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, nowMs: Date.now() };
  await drainAll(deps, 2);
  assert.equal(rx.calls.length, 1);
  const { url, init } = rx.calls[0];
  assert.equal(url, PUBLIC_URL);
  assert.equal(init.redirect, "manual", "redirects are never followed");
  assert.equal(init.headers["X-WardSynQ-Event-Id"], staged[0].id);
  assert.equal(init.headers["X-WardSynQ-Event-Type"], "encounter.admitted");
  assert.equal(await W.verifySignature(reg.secret, init.headers["X-WardSynQ-Timestamp"], init.body, init.headers["X-WardSynQ-Signature"], deps.nowMs), true, "the receiver can verify with the secret shown once");

  // NO PHI: exactly these keys, an opaque id, and none of the MRN, patient id, encounter id, ward or bed.
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["hospital", "id", "note", "occurredAt", "resource", "type"]);
  assert.deepEqual(Object.keys(body.resource).sort(), ["id", "resourceType"]);
  assert.match(body.resource.id, /^wsq-[0-9a-f]{48}$/);
  for (const needle of [mrn, mrn.toLowerCase(), adm.patientId, adm.encounterId, "Medical A", "medical-a"]) {
    assert.ok(!init.body.includes(needle), `payload leaks ${needle}: ${init.body}`);
    assert.ok(!JSON.stringify(staged[0]).includes(needle), `staged event leaks ${needle}`);
  }
  assert.deepEqual(await RECORD.idByHash(T, body.resource.id), { resourceType: "Encounter", id: adm.encounterId }, "the opaque id resolves on the FHIR door");

  const log = await as(ADMIN, `/ward/webhook-deliveries?orgId=${ORG_ID}&id=${reg.webhook.id}`);
  assert.equal(log.__status, 200, JSON.stringify(log));
  assert.equal(log.deliveries.length, 1);
  assert.deepEqual(Object.keys(log.deliveries[0]).sort(), ["at", "attempt", "eventId", "eventType", "reason", "responseCode", "status", "test"]);
  assert.equal(log.deliveries[0].status, "delivered");
  assert.equal(log.deliveries[0].responseCode, 204);
});

test("no event is emitted for a failed write, for a refused write, or for an event nobody subscribes to", async () => {
  seed();
  assert.equal((await admit("MRN1")).__status, 200);
  assert.equal((await outboxRows()).length, 0, "no webhook registered: nothing staged at all");

  assert.equal((await register(["encounter.discharged"])).__status, 200);
  assert.equal((await admit("MRN2")).__status, 200);
  assert.equal((await outboxRows()).length, 0, "only discharge subscribed: an admission stages nothing");

  seed();
  assert.equal((await register(["encounter.admitted"])).__status, 200);
  const realAppend = RECORD.append.bind(RECORD);
  RECORD.append = async (t, recs, ctx) => { if (recs.some((r) => r.resourceType === "Encounter")) throw new Error("disk full"); return realAppend(t, recs, ctx); };
  const failed = await admit("MRN3");
  assert.equal(failed.__status, 502, JSON.stringify(failed));
  assert.equal((await outboxRows()).length, 0, "the failed encounter write took its event with it");
  RECORD.append = realAppend;

  bedNo -= 1;                                     // the same bed again
  const first = await admit("MRN4");
  assert.equal(first.__status, 200);
  bedNo -= 1;
  const clash = await admit("MRN5");
  assert.equal(clash.__status, 409, JSON.stringify(clash));
  assert.equal((await outboxRows()).length, 1, "the refused admission emitted nothing; only the one that landed did");
});

test("webhookEventsFor: transfer, discharge, order, result release and critical result are recognised once", () => {
  const open = { resourceType: "Encounter", id: "e1", class: "IPD", status: "in-progress", location: { ward: "A", bed: "1" } };
  assert.deepEqual(E.webhookEventsFor(null, open).map((e) => e.type), ["encounter.admitted"]);
  assert.deepEqual(E.webhookEventsFor(open, { ...open, location: { ward: "B", bed: "2" } }).map((e) => e.type), ["encounter.transferred"]);
  assert.deepEqual(E.webhookEventsFor(open, { ...open, status: "finished" }).map((e) => e.type), ["encounter.discharged"]);
  assert.deepEqual(E.webhookEventsFor(open, { ...open }), [], "a re-save is not news");
  assert.deepEqual(E.webhookEventsFor(null, { resourceType: "MedicationOrder", id: "m1", status: "active" }).map((e) => e.resourceType), ["MedicationRequest"]);
  assert.deepEqual(E.webhookEventsFor({ status: "active" }, { resourceType: "ServiceRequest", id: "s1", status: "active" }), []);
  assert.deepEqual(E.webhookEventsFor({ status: "preliminary" }, { resourceType: "DiagnosticReport", id: "d1", status: "final" }).map((e) => e.type), ["result.released"]);
  assert.deepEqual(E.webhookEventsFor(null, { resourceType: "CriticalResultLoop", id: "c1", state: "open", reportId: "d1" }), [{ type: "critical-result.raised", resourceType: "DiagnosticReport", id: "d1" }]);
  assert.deepEqual(E.webhookEventsFor({ state: "open" }, { resourceType: "CriticalResultLoop", id: "c1", state: "acknowledged", reportId: "d1" }), []);
});

// ---------------------------------------------------------------------------------------------
// DELIVERY: DNS rebinding, redirects, timeout, backoff, dead, auto-disable
// ---------------------------------------------------------------------------------------------
test("a destination that now resolves inside is refused AT DELIVERY: nothing is sent and the attempt says why", async () => {
  seed();
  let answer = ["93.184.216.34"];
  const resolveHost = async () => answer;
  const r = await W.registerWebhook(new Request("https://x/", { headers: { "Cf-Access-Authenticated-User-Email": ADMIN } }), ENV, {
    migration: { mode: "native", tenantId: T }, actorDeps: (await import("../functions/_wardsynq/deps.js")).actorDeps(), recordDeps: { repository: RECORD },
    url: "https://hooks.example.com/in", eventTypes: ["encounter.admitted"], resolveHost,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  answer = ["10.0.0.7"];                                                     // rebinding
  const refusedNow = await W.registerWebhook(new Request("https://x/", { headers: { "Cf-Access-Authenticated-User-Email": ADMIN } }), ENV, {
    migration: { mode: "native", tenantId: T }, actorDeps: (await import("../functions/_wardsynq/deps.js")).actorDeps(), recordDeps: { repository: RECORD },
    url: "https://hooks.example.com/in", eventTypes: ["encounter.admitted"], resolveHost,
  });
  assert.equal(refusedNow.status, 422, "and at registration, the same name is refused");

  const rx = receiver(200);
  const deps = { repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, resolveHost, nowMs: Date.now() };
  await assert.rejects(W.deliverOne(deps, { endpointId: r.webhook.id, event: { id: "evt-x", type: "encounter.admitted", occurredAt: "t", resource: null } }, { attempts: 0 }));
  assert.equal(rx.calls.length, 0, "no request left the building");
  const row = (await RECORD.latestByType(T, W.DELIVERY_TYPE, 10))[0];
  assert.equal(row.status, "failed");
  assert.equal(row.reason, "blocked-address");
  assert.equal(row.responseCode, 0);
});

test("route: a private or metadata URL is refused at registration and nothing is written", async () => {
  seed();
  const before = writesNow();
  for (const url of ["https://169.254.169.254/latest/meta-data/", "https://10.0.0.1/hook", "https://[::1]/hook", "http://93.184.216.34/hook", "https://localhost/hook"]) {
    const r = await as(ADMIN, "/ward/webhook", "POST", { orgId: ORG_ID, url, eventTypes: ["order.placed"] });
    assert.equal(r.__status, 422, url + " " + JSON.stringify(r));
    assert.equal(r.secret, undefined);
  }
  assert.equal(writesNow(), before);
});

test("a redirect is not followed and a slow endpoint times out; both are failed attempts", async () => {
  seed();
  const reg = await register(["order.placed"]);
  const ep = await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id);
  assert.equal(W.TIMEOUT_MS, 5000);
  const redirect = receiver(() => ({ status: 302, headers: { Location: "https://169.254.169.254/" } }));
  const r1 = await W.sendOnce(ep, "s", { id: "e", type: "order.placed", occurredAt: "t", resource: null }, { fetchImpl: redirect.fetchImpl });
  assert.deepEqual([r1.ok, r1.code, r1.reason], [false, 302, "redirect-not-followed"]);
  assert.equal(redirect.calls.length, 1);
  const hang = async (_u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const r2 = await W.sendOnce(ep, "s", { id: "e", type: "order.placed", occurredAt: "t", resource: null }, { fetchImpl: hang, timeoutMs: 30 });
  assert.deepEqual([r2.ok, r2.reason], [false, "timeout"]);
});

test("retries back off on the outbox schedule, then the delivery goes dead, and every attempt is logged with its code only", async () => {
  seed();
  const reg = await register(["encounter.admitted"]);
  assert.equal((await admit("MRN9")).__status, 200);
  const rx = receiver(503);
  const deps = { repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, nowMs: Date.now() + 1000 };
  await drainAll(deps);                                                      // fan-out
  const waits = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await drainAll(deps);
    const d = (await outboxRows(W.TOPIC_DELIVER))[0];
    if (d.status === "retry") { waits.push(Date.parse(d.nextAttemptAt) - deps.nowMs); deps.nowMs = Date.parse(d.nextAttemptAt); }
  }
  assert.equal(rx.calls.length, MAX_ATTEMPTS);
  assert.deepEqual(waits, [30000, 60000, 120000, 240000, 480000], "each wait doubles");
  assert.equal((await outboxRows(W.TOPIC_DELIVER))[0].status, "dead");
  await drainAll(deps);
  assert.equal(rx.calls.length, MAX_ATTEMPTS, "a dead delivery is not tried again");
  const log = await as(ADMIN, `/ward/webhook-deliveries?orgId=${ORG_ID}&id=${reg.webhook.id}`);
  assert.deepEqual(log.deliveries.map((x) => x.status).sort(), ["dead", "failed", "failed", "failed", "failed", "failed"]);
  assert.ok(log.deliveries.every((x) => x.responseCode === 503 && !("body" in x)));
});

test("auto-disable: a sustained failure streak turns the endpoint off, audited and visible; a short one does not", async () => {
  seed();
  const reg = await register(["order.placed"]);
  const rx = receiver(500);
  const t0 = Date.parse("2026-09-14T09:00:00Z");
  const deps = { repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, nowMs: t0 };
  const fail = async (n) => { await assert.rejects(W.deliverOne(deps, { endpointId: reg.webhook.id, event: { id: `evt-${n}`, type: "order.placed", occurredAt: "t", resource: null } }, { attempts: 0 })); };
  for (let i = 0; i < W.AUTO_DISABLE_FAILURES; i++) { deps.nowMs = t0 + i * 60000; await fail(i); }   // ten failures inside nine minutes
  assert.equal((await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id)).active, true, "ten quick failures are not yet sustained");
  deps.nowMs = t0 + W.AUTO_DISABLE_SPAN_MS; await fail(99);
  const ep = await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id);
  assert.equal(ep.active, false);
  assert.equal(ep.status, "auto-disabled");
  assert.ok(RECORD.audit.some((a) => a.action === "webhook.auto-disable" && a.scope.webhookId === reg.webhook.id), "audited");
  const list = await as(ADMIN, `/ward/webhooks?orgId=${ORG_ID}`);
  const shown = list.webhooks.find((w) => w.id === reg.webhook.id);
  assert.equal(shown.status, "auto-disabled");
  assert.match(shown.disabledReason, /11 deliveries in a row failed/);

  const before = rx.calls.length;
  await W.deliverOne(deps, { endpointId: reg.webhook.id, event: { id: "evt-after", type: "order.placed", occurredAt: "t", resource: null } }, { attempts: 0 });
  assert.equal(rx.calls.length, before, "nothing is sent to a disabled endpoint");

  const on = await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: reg.webhook.id, active: true });
  assert.equal(on.__status, 200, JSON.stringify(on));
  assert.equal(on.webhook.consecutiveFailures, 0, "re-enabling clears the streak");
  assert.ok(RECORD.audit.some((a) => a.action === "webhook.enable"));
});

// ---------------------------------------------------------------------------------------------
// AUTHORIZATION AND THE SECRET
// ---------------------------------------------------------------------------------------------
test("route NEGATIVE: no session 401; a nurse 403; hr (staff.admin, no clinical actor) 403; another hospital 403 or 404; nothing written", async () => {
  seed();
  const reg = await register(["order.placed"]);
  const before = writesNow();
  const calls = [
    ["GET", `/ward/webhooks?orgId=${ORG_ID}`], ["POST", "/ward/webhook", { orgId: ORG_ID, url: PUBLIC_URL, eventTypes: ["order.placed"] }],
    ["POST", "/ward/webhook-update", { orgId: ORG_ID, id: reg.webhook.id, active: false }], ["POST", "/ward/webhook-rotate", { orgId: ORG_ID, id: reg.webhook.id }],
    ["POST", "/ward/webhook-test", { orgId: ORG_ID, id: reg.webhook.id }], ["GET", `/ward/webhook-deliveries?orgId=${ORG_ID}&id=${reg.webhook.id}`],
  ];
  for (const [method, path, body] of calls) {
    assert.equal((await as(null, path, method, body)).__status, 401, path);
    const nurse = await as(NURSE, path, method, body);
    assert.equal(nurse.__status, 403, path + JSON.stringify(nurse));
    const hr = await as(HR, path, method, body);
    assert.equal(hr.__status, 403, "hr " + path + JSON.stringify(hr));
    const other = await as(OTHER_ADMIN, path, method, body);
    assert.ok(other.__status === 403 || other.__status === 404, path + JSON.stringify(other));
    for (const r of [nurse, hr, other]) assert.equal(r.secret, undefined);
  }
  // The other hospital's admin, on their OWN hospital, naming this hospital's webhook: not found there.
  for (const [method, path] of [["POST", "/ward/webhook-rotate"], ["POST", "/ward/webhook-update"], ["GET", `/ward/webhook-deliveries?orgId=${OTHER}&id=${reg.webhook.id}`]]) {
    const r = await as(OTHER_ADMIN, path, method, method === "POST" ? { orgId: OTHER, id: reg.webhook.id, active: false } : undefined);
    assert.equal(r.__status, 404, path + JSON.stringify(r));
    assert.equal(r.secret, undefined);
  }
  assert.equal(writesNow(), before, "no record, audit row or org document written by a refused call");
  assert.equal((await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id)).version, 1);
});

test("the secret is returned by registration and rotation only, and is stored encrypted", async () => {
  seed();
  const reg = await register(["order.placed", "result.released"]);
  assert.equal(reg.__status, 200);
  const secret = reg.secret;
  const stored = JSON.stringify(RECORD._rows) + JSON.stringify(RECORD.audit);
  assert.ok(!stored.includes(secret) && !stored.includes(secret.slice(6)), "never stored or audited in plain text");

  const rx = receiver(200);
  const origFetch = globalThis.fetch;
  globalThis.fetch = rx.fetchImpl;
  let answers;
  try {
    answers = [
      await as(ADMIN, `/ward/webhooks?orgId=${ORG_ID}`),
      await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: reg.webhook.id, eventTypes: ["result.released"] }),
      await as(ADMIN, "/ward/webhook-test", "POST", { orgId: ORG_ID, id: reg.webhook.id }),
      await as(ADMIN, `/ward/webhook-deliveries?orgId=${ORG_ID}&id=${reg.webhook.id}`),
      await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: reg.webhook.id, active: false }),
    ];
  } finally { globalThis.fetch = origFetch; }
  for (const a of answers) {
    assert.equal(a.__status, 200, JSON.stringify(a));
    const text = JSON.stringify(a);
    assert.ok(!text.includes(secret) && !/secretEnc|"secret"/.test(text), "no secret in " + text);
  }
  assert.equal(answers[2].delivered, true);
  assert.equal(await W.verifySignature(secret, rx.calls[0].init.headers["X-WardSynQ-Timestamp"], rx.calls[0].init.body, rx.calls[0].init.headers["X-WardSynQ-Signature"]), true, "the test event is signed");
  assert.equal(JSON.parse(rx.calls[0].init.body).type, "webhook.test");

  const rot = await as(ADMIN, "/ward/webhook-rotate", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  assert.equal(rot.__status, 200);
  assert.match(rot.secret, /^whsec_/);
  assert.notEqual(rot.secret, secret);
  for (const action of ["webhook.register", "webhook.update", "webhook.test", "webhook.disable", "webhook.rotate"]) {
    assert.ok(RECORD.audit.some((a) => a.action === action && a.actor), `${action} audited`);
  }
  const list = await as(ADMIN, `/ward/webhooks?orgId=${ORG_ID}`);
  assert.equal(list.webhooks[0].status, "disabled");
  assert.ok(!JSON.stringify(list).includes(rot.secret));
});

// ---------------------------------------------------------------------------------------------
// ADMIN SCREEN
// ---------------------------------------------------------------------------------------------
test("screen: loading, failed and empty are distinct, the no-PHI note is shown, and a secret is shown only when handed one", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const html = win.WSQ._webhooksHtml, log = win.WSQ._webhookDeliveriesHtml;
  const loading = html(c, null), failed = html(c, { failed: true, message: "forbidden" });
  const empty = html(c, { ok: true, keyConfigured: true, webhooks: [], eventTypes: [{ id: "order.placed", label: "Order placed" }] });
  assert.match(loading, /Loading webhooks/);
  assert.match(failed, /could not be loaded: forbidden/);
  assert.match(failed, /not the same as there being none/);
  assert.match(empty, /No webhooks are registered/);
  for (const s of [loading, failed]) assert.ok(!/No webhooks are registered|Add webhook/.test(s), s);
  assert.match(empty, /never a name, a number, a test or a value/);
  assert.match(empty, /FHIR API with its own SMART access/);
  assert.ok(!/Copy it now/.test(empty));
  const row = { id: "wh-1", url: PUBLIC_URL, eventTypes: ["order.placed"], active: false, status: "auto-disabled", disabledReason: "11 deliveries in a row failed over 30 minutes", consecutiveFailures: 11, lastAttemptAt: "t", lastOk: false, lastResponseCode: 500 };
  const withRow = html(c, { ok: true, keyConfigured: true, webhooks: [row], eventTypes: [{ id: "order.placed", label: "Order placed" }] }, { url: PUBLIC_URL, secret: "whsec_shown" });
  assert.match(withRow, /Turned off after repeated failures/);
  assert.match(withRow, /whsec_shown/);
  assert.match(withRow, /Copy it now. It is not shown again/);
  assert.match(html(c, { ok: true, keyConfigured: false, webhooks: [], eventTypes: [] }), /cannot be stored encrypted/);

  const l0 = log(c, null), l1 = log(c, { failed: true, message: "read failed" }), l2 = log(c, { ok: true, deliveries: [] });
  assert.match(l0, /Loading deliveries/);
  assert.match(l1, /not the same as nothing having been sent/);
  assert.match(l2, /No delivery attempts are recorded/);
  assert.match(log(c, { ok: true, deliveries: [{ at: "t", eventId: "evt-1", eventType: "order.placed", attempt: 6, status: "dead", responseCode: 503, reason: "http-error" }] }), /Failed for good/);
  assert.ok(!/[—–]/.test(loading + failed + empty + withRow + l0 + l1 + l2), "no em or en dash on screen");
});

// ---------------------------------------------------------------------------------------------
// ROTATION OVERLAP: the retired secret verifies for 24 hours, then stops
// ---------------------------------------------------------------------------------------------
test("right after a rotate, a delivery carries both signatures, new first", async () => {
  seed();
  const reg = await register(["encounter.admitted"]);
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const rot = await as(ADMIN, "/ward/webhook-rotate", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  assert.equal(rot.__status, 200, JSON.stringify(rot));
  assert.notEqual(rot.secret, reg.secret);

  const stored = await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id);
  assert.equal(Date.parse(stored.previousSecretUntil) - Date.parse(stored.secretSetAt), W.ROTATION_OVERLAP_MS, "the window runs 24 hours from the rotation");

  const rx = receiver(200);
  const nowMs = Date.now();
  await W.deliverOne({ repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, nowMs },
    { endpointId: reg.webhook.id, event: { id: "evt-overlap", type: "encounter.admitted", occurredAt: "t", resource: null } }, { attempts: 0 });
  assert.equal(rx.calls.length, 1);
  const h = rx.calls[0].init.headers, body = rx.calls[0].init.body;
  const parts = String(h["X-WardSynQ-Signature"]).split(",");
  assert.equal(parts.length, 2, h["X-WardSynQ-Signature"]);
  for (const p of parts) assert.match(p, /^v1=[0-9a-f]{64}$/);
  assert.notEqual(parts[0], parts[1]);
  assert.equal(await W.verifySignature(rot.secret, h["X-WardSynQ-Timestamp"], body, parts[0], nowMs), true, "the first signature verifies with the new secret");
  assert.equal(await W.verifySignature(reg.secret, h["X-WardSynQ-Timestamp"], body, parts[1], nowMs), true, "the second signature verifies with the old secret");
  assert.equal(await W.verifySignature(reg.secret, h["X-WardSynQ-Timestamp"], body, parts[0], nowMs), false, "the new signature does not verify with the old secret");
});

test("past the 24 hour window only the new signature is sent", async () => {
  seed();
  assert.equal(W.ROTATION_OVERLAP_MS, 24 * 3600 * 1000);
  const reg = await register(["encounter.admitted"]);
  const rot = await as(ADMIN, "/ward/webhook-rotate", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  assert.equal(rot.__status, 200, JSON.stringify(rot));
  const rx = receiver(200);
  const nowMs = Date.now() + W.ROTATION_OVERLAP_MS + 60000;
  await W.deliverOne({ repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, nowMs },
    { endpointId: reg.webhook.id, event: { id: "evt-late", type: "encounter.admitted", occurredAt: "t", resource: null } }, { attempts: 0 });
  assert.equal(rx.calls.length, 1);
  const h = rx.calls[0].init.headers, body = rx.calls[0].init.body;
  assert.ok(!String(h["X-WardSynQ-Signature"]).includes(","), h["X-WardSynQ-Signature"]);
  assert.match(h["X-WardSynQ-Signature"], /^v1=[0-9a-f]{64}$/);
  assert.equal(await W.verifySignature(rot.secret, h["X-WardSynQ-Timestamp"], body, h["X-WardSynQ-Signature"], nowMs), true, "the lone signature verifies with the new secret");
  assert.equal(await W.verifySignature(reg.secret, h["X-WardSynQ-Timestamp"], body, h["X-WardSynQ-Signature"], nowMs), false, "the retired secret no longer verifies");
});

test("a test send inside the window carries both signatures too", async () => {
  seed();
  const reg = await register(["order.placed"]);
  const rot = await as(ADMIN, "/ward/webhook-rotate", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  assert.equal(rot.__status, 200, JSON.stringify(rot));
  const rx = receiver(200);
  const origFetch = globalThis.fetch;
  globalThis.fetch = rx.fetchImpl;
  let answer;
  try {
    answer = await as(ADMIN, "/ward/webhook-test", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  } finally { globalThis.fetch = origFetch; }
  assert.equal(answer.__status, 200, JSON.stringify(answer));
  assert.equal(rx.calls.length, 1);
  const h = rx.calls[0].init.headers, body = rx.calls[0].init.body;
  const parts = String(h["X-WardSynQ-Signature"]).split(",");
  assert.equal(parts.length, 2, h["X-WardSynQ-Signature"]);
  const nowMs = Date.now();
  assert.equal(await W.verifySignature(rot.secret, h["X-WardSynQ-Timestamp"], body, parts[0], nowMs), true);
  assert.equal(await W.verifySignature(reg.secret, h["X-WardSynQ-Timestamp"], body, parts[1], nowMs), true);
});

test("a previous seal that no longer opens leaves delivery on the new secret alone", async () => {
  seed();
  const reg = await register(["encounter.admitted"]);
  const rot = await as(ADMIN, "/ward/webhook-rotate", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  assert.equal(rot.__status, 200, JSON.stringify(rot));
  const stored = await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id);
  await RECORD.append(T, [{ ...stored, version: stored.version + 1, previousSecretEnc: "!!!no-longer-a-seal!!!" }], {});
  const rx = receiver(200);
  const nowMs = Date.now();
  await W.deliverOne({ repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, nowMs },
    { endpointId: reg.webhook.id, event: { id: "evt-badprev", type: "encounter.admitted", occurredAt: "t", resource: null } }, { attempts: 0 });
  assert.equal(rx.calls.length, 1, "delivery does not fail because of the old secret");
  const h = rx.calls[0].init.headers;
  assert.match(h["X-WardSynQ-Signature"], /^v1=[0-9a-f]{64}$/, "only the new signature is sent");
  assert.equal(await W.verifySignature(rot.secret, h["X-WardSynQ-Timestamp"], rx.calls[0].init.body, h["X-WardSynQ-Signature"], nowMs), true);
});

test("rotating twice keeps only the most recently retired secret as previous", async () => {
  seed();
  const reg = await register(["encounter.admitted"]);
  const rot1 = await as(ADMIN, "/ward/webhook-rotate", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  assert.equal(rot1.__status, 200, JSON.stringify(rot1));
  const ep1 = await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id);
  const rot2 = await as(ADMIN, "/ward/webhook-rotate", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  assert.equal(rot2.__status, 200, JSON.stringify(rot2));
  const ep2 = await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id);
  assert.equal(ep2.previousSecretEnc, ep1.secretEnc, "the previous seal is the secret retired just now");
  assert.notEqual(ep2.previousSecretEnc, ep1.previousSecretEnc, "the older retired secret is gone");
  assert.deepEqual(Object.keys(ep2).filter((k) => k.indexOf("previous") === 0).sort(), ["previousSecretEnc", "previousSecretUntil"], "never more than one previous secret");

  const rx = receiver(200);
  const nowMs = Date.now();
  await W.deliverOne({ repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, nowMs },
    { endpointId: reg.webhook.id, event: { id: "evt-twice", type: "encounter.admitted", occurredAt: "t", resource: null } }, { attempts: 0 });
  const h = rx.calls[0].init.headers, body = rx.calls[0].init.body;
  const parts = String(h["X-WardSynQ-Signature"]).split(",");
  assert.equal(parts.length, 2, h["X-WardSynQ-Signature"]);
  assert.equal(await W.verifySignature(rot2.secret, h["X-WardSynQ-Timestamp"], body, parts[0], nowMs), true);
  assert.equal(await W.verifySignature(rot1.secret, h["X-WardSynQ-Timestamp"], body, parts[1], nowMs), true);
  assert.equal(await W.verifySignature(reg.secret, h["X-WardSynQ-Timestamp"], body, parts[1], nowMs), false, "the twice-retired secret verifies nothing");
});

test("list and update answers never carry secret material", async () => {
  seed();
  const reg = await register(["order.placed"]);
  const rot = await as(ADMIN, "/ward/webhook-rotate", "POST", { orgId: ORG_ID, id: reg.webhook.id });
  assert.equal(rot.__status, 200, JSON.stringify(rot));
  assert.ok(!("secretEnc" in rot.webhook) && !("previousSecretEnc" in rot.webhook));
  assert.ok(!JSON.stringify(rot).includes("previousSecretEnc"));
  const list = await as(ADMIN, `/ward/webhooks?orgId=${ORG_ID}`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  const shown = list.webhooks.find((w) => w.id === reg.webhook.id);
  assert.ok(shown);
  assert.ok(!("secretEnc" in shown) && !("previousSecretEnc" in shown), JSON.stringify(Object.keys(shown)));
  assert.ok(!JSON.stringify(list).includes("secretEnc"), "no sealed secret anywhere in the list answer");
  const upd = await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: reg.webhook.id, eventTypes: ["order.placed", "result.released"] });
  assert.equal(upd.__status, 200, JSON.stringify(upd));
  assert.ok(!("secretEnc" in upd.webhook) && !("previousSecretEnc" in upd.webhook));
  assert.ok(!JSON.stringify(upd).includes("secretEnc"));
});

// ---------------------------------------------------------------------------------------------
// G8: EDIT AN ADDRESS, AND ONE ENDPOINT'S DELIVERY LOG A PAGE AT A TIME
// ---------------------------------------------------------------------------------------------
test("G8 POST /api/queue/ward/webhook-update {url}: re-checked, audited by host, the secret unchanged; a private address is refused and nothing written", async () => {
  seed();
  const reg = await register(["order.placed"]);
  const sealed = (await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id)).secretEnc;
  const NEW_URL = "https://93.184.216.35/hooks/v2";
  const before = writesNow();
  for (const url of ["https://10.0.0.1/hook", "http://93.184.216.35/hook", "https://169.254.169.254/latest/meta-data/"]) {
    const r = await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: reg.webhook.id, url });
    assert.equal(r.__status, 422, url + JSON.stringify(r));
    assert.match(r.message, /Address not changed/);
  }
  assert.equal(writesNow(), before, "a refused address writes nothing");

  const ok = await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: reg.webhook.id, url: NEW_URL });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.webhook.url, NEW_URL);
  assert.equal(ok.secret, undefined, "no secret in the answer");
  const stored = await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id);
  assert.equal(stored.url, NEW_URL);
  assert.equal(stored.version, 2);
  assert.equal(stored.secretEnc, sealed, "the signing secret is not changed");
  const audit = RECORD.audit.filter((a) => a.action === "webhook.update").pop();
  assert.deepEqual(audit.scope.url, { fromHost: "93.184.216.34", toHost: "93.184.216.35" });
  assert.ok(audit.actor);
  assert.ok(!JSON.stringify(audit).includes("/hooks/v2"), "the audit names hosts, not the full address");
  const same = await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: reg.webhook.id, url: NEW_URL });
  assert.equal(same.unchanged, true);
});

test("G8 NEGATIVE POST /api/queue/ward/webhook-update {url}: no session 401, nurse 403, hr 403, another hospital 403/404; nothing written", async () => {
  seed();
  const reg = await register(["order.placed"]);
  const before = writesNow();
  const body = { orgId: ORG_ID, id: reg.webhook.id, url: "https://93.184.216.35/elsewhere" };
  assert.equal((await as(null, "/ward/webhook-update", "POST", body)).__status, 401);
  assert.equal((await as(NURSE, "/ward/webhook-update", "POST", body)).__status, 403);
  assert.equal((await as(HR, "/ward/webhook-update", "POST", body)).__status, 403);
  const other = await as(OTHER_ADMIN, "/ward/webhook-update", "POST", body);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  assert.equal((await as(OTHER_ADMIN, "/ward/webhook-update", "POST", { ...body, orgId: OTHER })).__status, 404, "named from their own hospital: not found");
  assert.equal(writesNow(), before);
  assert.equal((await RECORD.latest(T, E.ENDPOINT_TYPE, reg.webhook.id)).url, PUBLIC_URL);
});

test("G8 GET /api/queue/ward/webhook-deliveries: one endpoint only, newest first, paged past the old 50 and 1000 caps", async () => {
  seed();
  const a = await register(["order.placed"]), b = await register(["order.placed"]);
  const row = (ep, i) => ({ resourceType: W.DELIVERY_TYPE, id: `whd-${ep}-evt-${String(i).padStart(4, "0")}-a1`, version: 1, endpointId: ep, eventId: `evt-${i}`, eventType: "order.placed",
    attempt: 1, status: i % 2 ? "failed" : "delivered", responseCode: i % 2 ? 503 : 200, reason: null, test: false, at: new Date(1e12 + i * 1000).toISOString(), writtenBy: { id: "system:webhooks", kind: "service" } });
  // 1100 attempts for B written AFTER A's 70: the hospital-wide newest-1000 scan would have shown A nothing.
  for (let i = 0; i < 70; i++) await RECORD.append(T, [row(a.webhook.id, i)], {});
  for (let i = 0; i < 1100; i++) await RECORD.append(T, [row(b.webhook.id, i)], {});
  const p1 = await as(ADMIN, `/ward/webhook-deliveries?orgId=${ORG_ID}&id=${a.webhook.id}`);
  assert.equal(p1.__status, 200, JSON.stringify(p1).slice(0, 300));
  assert.equal(p1.deliveries.length, 50);
  assert.equal(p1.deliveries[0].eventId, "evt-69", "newest first");
  assert.ok(p1.deliveries.every((d) => d.eventId && d.status && d.attempt === 1 && "responseCode" in d && d.at));
  assert.ok(p1.next, "a cursor to older attempts");
  const p2 = await as(ADMIN, `/ward/webhook-deliveries?orgId=${ORG_ID}&id=${a.webhook.id}&before=${p1.next}`);
  assert.equal(p2.deliveries.length, 20);
  assert.equal(p2.deliveries[0].eventId, "evt-19");
  assert.equal(p2.next, null, "no page after the last");
  const seen = new Set([...p1.deliveries, ...p2.deliveries].map((d) => d.eventId));
  assert.equal(seen.size, 70, "every attempt once, none from the other endpoint");
  const small = await as(ADMIN, `/ward/webhook-deliveries?orgId=${ORG_ID}&id=${b.webhook.id}&limit=5`);
  assert.equal(small.deliveries.length, 5);
  assert.equal(small.deliveries[0].eventId, "evt-1099");
  const path = `/ward/webhook-deliveries?orgId=${ORG_ID}&id=${a.webhook.id}&before=${p1.next}`;
  assert.equal((await as(null, path)).__status, 401);
  assert.equal((await as(NURSE, path)).__status, 403);
  assert.equal((await as(HR, path)).__status, 403);
  assert.equal((await as(OTHER_ADMIN, `/ward/webhook-deliveries?orgId=${OTHER}&id=${a.webhook.id}&before=${p1.next}`)).__status, 404);
});

test("G8 screen: change-address form, and the delivery log pages with Older and Newest", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const list = win.WSQ._webhooksHtml(c, { ok: true, keyConfigured: true, webhooks: [{ id: "wh-1", url: PUBLIC_URL, eventTypes: ["order.placed"], active: true, status: "active" }], eventTypes: [] });
  assert.match(list, /data-wh-edit="wh-1"/);
  const edit = win.WSQ._webhookEditHtml(c, { id: "wh-1", url: PUBLIC_URL });
  assert.match(edit, /id="whEditUrl" value="https:\/\/93\.184\.216\.34\/hooks\/wardsynq"/);
  assert.match(edit, /signing secret does not change/);
  const log = win.WSQ._webhookDeliveriesHtml;
  const d = { ok: true, next: "42", deliveries: [{ at: "t", eventId: "evt-1", eventType: "order.placed", attempt: 2, status: "failed", responseCode: 503, reason: "http-error" }] };
  const first = log(c, d, PUBLIC_URL, false);
  assert.match(first, /data-wh-page="42">Older/);
  assert.ok(!/Newest/.test(first));
  assert.match(log(c, { ok: true, next: null, deliveries: [] }, PUBLIC_URL, true), /No older delivery attempts[\s\S]*Newest/);
  assert.ok(!/[—–]/.test(list + edit + first));
});
