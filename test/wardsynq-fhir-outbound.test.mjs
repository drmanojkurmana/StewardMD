/* test/wardsynq-fhir-outbound.test.mjs — TASK 7.4: the WardSynQ -> external FHIR pipeline.
 *
 * These tests drive the REAL routes (onRequest -> /ward/outbound-destination, /ward/outbound-send,
 * /ward/outbound-dispatch, /ward/outbound, /ward/outbound-replay) against a REAL http server that
 * this file starts, over a REAL socket, with the real node fetch. Nothing about the delivery logic
 * is mocked: the assertions are about what the far end actually RECEIVED and what the queue actually
 * RECORDS afterwards.
 *
 * The one seam is the transport binding (WSQ_OUTBOUND_FETCH), which maps the registered public
 * destination host onto the loopback port this file listens on. That seam exists because the SSRF
 * guard correctly refuses to let anything post to 127.0.0.1 - so a test server must be reachable
 * under a public-looking name, and the request that arrives is a genuine one either way.
 *
 * The resource that goes out is not a fixture: it is pushed IN through /ward/fhir first, so what is
 * exported is a real governed canonical record that came through the real inbound pipeline.
 *
 * NOT verified here, and not claimed anywhere: any real external FHIR server, partner or sandbox.
 * None exists in this environment.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-fhir-outbound.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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
const { DELIVERY_STATE, MAX_ATTEMPTS, backoffMs } = await import("../functions/_wardsynq/fhir-outbound.js");

const ORG_A = "org-a", ORG_B = "org-b";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test";

/* ---- the far end: a real HTTP server, deterministic, that RECORDS what it was sent -------------- */

let server = null, port = 0;
const received = [];          // every request that actually arrived, with its headers and body
let behaviour = { status: 201 };   // { status, body?, location?, delayMs? } - set per test

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
      const b = behaviour || { status: 201 };
      const headers = { "Content-Type": "application/fhir+json" };
      if (b.location) headers.Location = b.location;
      res.writeHead(b.status, headers);
      res.end(JSON.stringify(b.body != null ? b.body : { resourceType: "OperationOutcome", id: b.remoteId || "remote-1" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

const PARTNER = "https://fhir.partner.example/r4";
/* The transport binding. It rewrites ONLY the registered partner host onto the loopback listener;
 * anything else is left alone and therefore genuinely unreachable from the test. */
const transport = async (url, init) => {
  const u = new URL(url);
  if (u.host !== "fhir.partner.example") throw new Error(`refusing to reach ${u.host}`);
  return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init);
};

const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_OUTBOUND_FETCH: transport };

function seedHospitals() {
  docs.clear(); clock = 1; received.length = 0; behaviour = { status: 201 };
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_A}`, { fields: { id: ORG_A, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_A.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { fhir: { inbound: { enabled: true } } } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG_B}`, { fields: { id: ORG_B, code: "HOSP-B", name: "Hospital B", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_B.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { fhir: { inbound: { enabled: true } } } }, updateTime: "t1" });
  for (const [org, email, role] of [[ORG_A, ADMIN, "admin"], [ORG_A, DOCTOR, "doctor"], [ORG_B, ADMIN, "admin"]]) {
    docs.set(`q_members/${sanitize(org)}__${sanitize(idFor(email))}`, { fields: { orgId: org, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body, headers) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json", ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

/** Puts a real patient on the chart by pushing it IN through the real inbound door. */
async function seedPatient(org, mrn) {
  const tenant = org === ORG_A ? TENANT_A.id : TENANT_B.id;
  const g = await as(ADMIN, `/ward/source-grant?orgId=${org}`, "POST", { actorId: idFor(ADMIN), sourceSystem: "epic-a" });
  assert.equal(g.__status, 200, JSON.stringify(g));
  const bundle = { resourceType: "Bundle", type: "collection", id: `b-${mrn}`,
    entry: [{ resource: { resourceType: "Patient", id: `PAT-${mrn}`, identifier: [{ system: "urn:test:mrn", value: mrn }], name: [{ family: "Outbound", given: ["Test"] }], birthDate: "1980-01-01", gender: "female" } }] };
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir?orgId=${org}`, { method: "POST", headers: { "Cf-Access-Authenticated-User-Email": ADMIN, "Content-Type": "application/fhir+json", "X-Source-System": "epic-a" }, body: JSON.stringify(bundle) }), env: ENV });
  assert.equal(res.status, 200, await res.text());
  const rows = await RECORD.latestByType(tenant, "Patient", 10);
  assert.ok(rows && rows.length, "the inbound push actually put a patient on the chart");
  return rows[0].id;
}

const register = (org, over) => as(ADMIN, `/ward/outbound-destination?orgId=${org}`, "POST",
  { name: "partner-hospital", url: PARTNER, resourceTypes: ["Patient"], ...(over || {}) });
const sendOut = (org, id, over) => as(ADMIN, `/ward/outbound-send?orgId=${org}`, "POST", { destination: "partner-hospital", resourceType: "Patient", id, ...(over || {}) });
const dispatch = (org, now) => as(ADMIN, `/ward/outbound-dispatch?orgId=${org}`, "POST", now ? { now } : {});
const queue = (org, state) => as(ADMIN, `/ward/outbound${state ? `?state=${state}&` : "?"}orgId=${org}`, "GET");

/* The dispatcher takes the time to judge "is this due" as a parameter, so backoff can be tested
 * without waiting. T0 is anchored just AFTER the wall clock, because a delivery is queued due-now
 * against the real clock - a hard-coded date in the past would simply never be due, and a test that
 * passes only because nothing ran would prove nothing. */
const T0 = new Date(Date.now() + 1000).toISOString();
const at = (ms) => new Date(Date.parse(T0) + ms).toISOString();

/* ---- 1: the whole pipeline, end to end, and the far end really got it -------------------------- */

test("1. a registered destination receives the real record: queued, dispatched, delivered with a receipt", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-1");
  const reg = await register(ORG_A);
  assert.equal(reg.__status, 200, JSON.stringify(reg));

  behaviour = { status: 201, location: `${PARTNER}/Patient/remote-77`, remoteId: "remote-77" };
  const q = await sendOut(ORG_A, pid);
  assert.equal(q.__status, 200, JSON.stringify(q));
  assert.equal(q.delivery.state, DELIVERY_STATE.QUEUED);

  const d = await dispatch(ORG_A);
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.equal(d.attempted, 1);
  assert.equal(d.results[0].state, DELIVERY_STATE.DELIVERED);

  // What the far end ACTUALLY received - not what the queue says it sent.
  assert.equal(received.length, 1, "exactly one request reached the destination");
  assert.equal(received[0].method, "POST");
  assert.equal(received[0].url, "/r4/Patient", "posted to the FHIR type endpoint under the registered base");
  assert.match(received[0].headers["content-type"], /application\/fhir\+json/);
  const sent = JSON.parse(received[0].body);
  assert.equal(sent.resourceType, "Patient");
  assert.match(sent.name[0].text, /Outbound/, "the real chart content went out, not an empty shell");
  assert.equal(sent.identifier.find((i) => i.system === "urn:test:mrn").value, "MRN-1", "the partner receives the identifier it can match on");

  const list = await queue(ORG_A);
  const row = list.deliveries[0];
  assert.equal(row.state, DELIVERY_STATE.DELIVERED);
  assert.equal(row.receipt.status, 201);
  assert.equal(row.receipt.remoteId, "remote-77", "the receipt is what the far end said, not what we assumed");
  assert.ok(row.deliveredAt);
});

/* ---- 2: nothing is ever sent to an address a caller supplies ------------------------------------ */

test("2. the allowlist IS the registration: an unregistered destination is refused and nothing is sent", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-2");
  const q = await sendOut(ORG_A, pid, { destination: "somebody-elses-server" });
  assert.equal(q.__status, 404, JSON.stringify(q));
  assert.equal(q.error, "destination_not_registered");
  const d = await dispatch(ORG_A);
  assert.equal(d.attempted, 0);
  assert.equal(received.length, 0, "nothing left the building");
});

test("3. SSRF: a private, loopback, metadata or plain-http destination cannot be registered at all", async () => {
  seedHospitals();
  for (const bad of ["http://fhir.partner.example/r4", "https://127.0.0.1/r4", "https://localhost/r4",
    "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/r4", "https://internal.local/r4",
    "https://user:pass@fhir.partner.example/r4"]) {
    const r = await register(ORG_A, { url: bad });
    assert.equal(r.__status, 422, `${bad} was accepted: ${JSON.stringify(r)}`);
    assert.equal(r.error, "bad_destination_url");
  }
  const list = await as(ADMIN, `/ward/outbound-destinations?orgId=${ORG_A}`, "GET");
  assert.equal(list.destinations.length, 0, "not one of them was written down");
});

/* ---- 4: idempotency - one resource version, one delivery, one copy at the far end ---------------- */

test("4. idempotency: asking twice for the same version is ONE delivery and ONE request at the far end", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-4");
  await register(ORG_A);
  const first = await sendOut(ORG_A, pid);
  const second = await sendOut(ORG_A, pid);
  assert.equal(second.__status, 200, JSON.stringify(second));
  assert.equal(second.duplicate, true);
  assert.equal(second.delivery.id, first.delivery.id, "the same row, not a second copy");

  await dispatch(ORG_A);
  assert.equal(received.length, 1);
  // A dispatch after delivery does not send it again: a delivered row is not due.
  const again = await dispatch(ORG_A);
  assert.equal(again.attempted, 0);
  assert.equal(received.length, 1, "the destination was not sent a duplicate chart");

  // And asking a THIRD time, after delivery, is refused as already delivered rather than re-queued.
  const third = await sendOut(ORG_A, pid);
  assert.equal(third.duplicate, true);
  assert.match(third.note, /already delivered/);
  assert.equal(received.length, 1);
});

/* ---- 5: destination outage (the tenth 7.13 scenario) -------------------------------------------- */

test("5. destination outage: a 503 from the far end is a FAILED attempt with a backoff, never a delivery", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-5");
  await register(ORG_A);
  await sendOut(ORG_A, pid);

  behaviour = { status: 503, body: { resourceType: "OperationOutcome", issue: [{ severity: "error", diagnostics: "maintenance" }] } };
  const d1 = await dispatch(ORG_A, T0);
  assert.equal(d1.results[0].state, DELIVERY_STATE.FAILED);
  const row1 = (await queue(ORG_A)).deliveries[0];
  assert.equal(row1.state, DELIVERY_STATE.FAILED);
  assert.equal(row1.deliveredAt, null, "an outage never becomes a delivery");
  assert.equal(row1.receipt, null);
  assert.match(row1.lastError, /503/);
  assert.equal(Date.parse(row1.nextAttemptAt), Date.parse(T0) + backoffMs(1), "backed off, not retried instantly");

  // Not due yet: a dispatch before the backoff expires does not hammer a server that is down.
  const early = await dispatch(ORG_A, at(backoffMs(1) - 1000));
  assert.equal(early.attempted, 0);
  assert.equal(received.length, 1, "no second request while backing off");

  // Backoff grows.
  const d2 = await dispatch(ORG_A, at(backoffMs(1)));
  assert.equal(d2.results[0].state, DELIVERY_STATE.FAILED);
  const row2 = (await queue(ORG_A)).deliveries[0];
  assert.equal(row2.attempts.length, 2);
  assert.ok(Date.parse(row2.nextAttemptAt) - Date.parse(at(backoffMs(1))) > backoffMs(1), "the wait got longer");

  // The far end comes back: the SAME queued work delivers, nothing was lost by the outage.
  behaviour = { status: 200, remoteId: "remote-after-outage" };
  const d3 = await dispatch(ORG_A, at(24 * 3600_000));
  assert.equal(d3.results[0].state, DELIVERY_STATE.DELIVERED);
  const row3 = (await queue(ORG_A)).deliveries[0];
  assert.equal(row3.receipt.remoteId, "remote-after-outage");
  assert.equal(row3.attempts.length, 3, "every attempt, including the two failures, is still on the record");
});

test("6. an unreachable destination (connection refused, no HTTP answer at all) is a failed attempt, not a crash", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-6");
  await register(ORG_A, { name: "dark-hospital", url: "https://dark.partner.example/r4" });
  const q = await sendOut(ORG_A, pid, { destination: "dark-hospital" });
  assert.equal(q.__status, 200, JSON.stringify(q));
  const d = await dispatch(ORG_A, T0);
  assert.equal(d.__status, 200, "the dispatcher survived a destination it cannot reach");
  assert.equal(d.results[0].state, DELIVERY_STATE.FAILED);
  const row = (await queue(ORG_A)).deliveries[0];
  assert.equal(row.deliveredAt, null);
  assert.ok(row.lastError, "it says what went wrong");
});

/* ---- 7: giving up honestly ---------------------------------------------------------------------- */

test("7. dead-letter: after MAX_ATTEMPTS the delivery stops, stays visible, and keeps every attempt", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-7");
  await register(ORG_A);
  await sendOut(ORG_A, pid);
  behaviour = { status: 500, body: { error: "broken" } };

  let now = T0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) { await dispatch(ORG_A, now); now = at((i + 1) * 24 * 3600_000); }

  const row = (await queue(ORG_A)).deliveries[0];
  assert.equal(row.state, DELIVERY_STATE.DEAD_LETTER);
  assert.equal(row.attempts.length, MAX_ATTEMPTS);
  assert.equal(row.nextAttemptAt, null, "it is not still pretending to be on its way");
  assert.equal(received.length, MAX_ATTEMPTS, "it stopped trying rather than hammering for ever");

  const counts = await queue(ORG_A);
  assert.equal(counts.deadLetter, 1, "the queue view surfaces it for a person to look at");

  // And it stays stopped.
  const after = await dispatch(ORG_A, at(365 * 24 * 3600_000));
  assert.equal(after.attempted, 0);
  assert.equal(received.length, MAX_ATTEMPTS);
});

test("8. replay is a person's decision: it needs a reason, it re-queues, and a DELIVERED row cannot be replayed", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-8");
  await register(ORG_A);
  await sendOut(ORG_A, pid);
  behaviour = { status: 500 };
  let now = T0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) { await dispatch(ORG_A, now); now = at((i + 1) * 24 * 3600_000); }
  const dead = (await queue(ORG_A)).deliveries[0];
  assert.equal(dead.state, DELIVERY_STATE.DEAD_LETTER);

  const noReason = await as(ADMIN, `/ward/outbound-replay?orgId=${ORG_A}`, "POST", { deliveryId: dead.id, reason: "x" });
  assert.equal(noReason.__status, 422, JSON.stringify(noReason));

  behaviour = { status: 201, remoteId: "remote-replayed" };
  const replay = await as(ADMIN, `/ward/outbound-replay?orgId=${ORG_A}`, "POST", { deliveryId: dead.id, reason: "partner confirmed their endpoint is fixed" });
  assert.equal(replay.__status, 200, JSON.stringify(replay));
  assert.equal(replay.delivery.state, DELIVERY_STATE.QUEUED);

  const d = await dispatch(ORG_A, at(400 * 24 * 3600_000));
  assert.equal(d.results[0].state, DELIVERY_STATE.DELIVERED);
  const done = (await queue(ORG_A)).deliveries[0];
  assert.equal(done.receipt.remoteId, "remote-replayed");
  assert.ok(done.attempts.some((a) => a.replay), "who re-queued it, and why, is on the record");

  const again = await as(ADMIN, `/ward/outbound-replay?orgId=${ORG_A}`, "POST", { deliveryId: dead.id, reason: "trying to send a second copy" });
  assert.equal(again.__status, 409, "a delivered chart is not sent to them twice");
  assert.equal(again.error, "already_delivered");
});

/* ---- 9: revocation actually stops traffic ------------------------------------------------------- */

test("9. revoking a destination stops what is already queued for it; it is cancelled, not silently pending", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-9");
  await register(ORG_A);
  await sendOut(ORG_A, pid);

  const rev = await as(ADMIN, `/ward/outbound-destination-revoke?orgId=${ORG_A}`, "POST", { name: "partner-hospital", reason: "data sharing agreement ended" });
  assert.equal(rev.__status, 200, JSON.stringify(rev));

  const d = await dispatch(ORG_A, T0);
  assert.equal(d.results[0].state, DELIVERY_STATE.CANCELLED);
  assert.equal(received.length, 0, "nothing was sent after the agreement ended");
  const row = (await queue(ORG_A)).deliveries[0];
  assert.match(row.lastError, /data sharing agreement ended/);

  // And nothing new can be queued for it either.
  const q = await sendOut(ORG_A, pid);
  assert.equal(q.__status, 409);
  assert.equal(q.error, "destination_revoked");
});

/* ---- 10: authorization and secrets --------------------------------------------------------------- */

test("10. a clinician cannot register a destination or send a chart out of the building", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-10");
  await register(ORG_A);
  const reg = await as(DOCTOR, `/ward/outbound-destination?orgId=${ORG_A}`, "POST", { name: "my-own-server", url: "https://elsewhere.example/r4", resourceTypes: ["Patient"] });
  assert.equal(reg.__status, 403, JSON.stringify(reg));
  const send = await as(DOCTOR, `/ward/outbound-send?orgId=${ORG_A}`, "POST", { destination: "partner-hospital", resourceType: "Patient", id: pid });
  assert.equal(send.__status, 403, JSON.stringify(send));
  const d = await dispatch(ORG_A, T0);
  assert.equal(d.attempted, 0);
  assert.equal(received.length, 0);
});

test("11. a credential is named, never stored, never returned, and a missing one means nothing is sent", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-11");
  const bad = await register(ORG_A, { auth: { kind: "bearer" } });
  assert.equal(bad.__status, 422, "a bearer destination must name where its token lives");

  await register(ORG_A, { auth: { kind: "bearer", secretBinding: "PARTNER_TOKEN" } });
  await sendOut(ORG_A, pid);

  // The binding is not configured: a failed attempt, and NOT an unauthenticated send of a chart.
  const d1 = await dispatch(ORG_A, T0);
  assert.equal(d1.results[0].state, DELIVERY_STATE.FAILED);
  assert.equal(received.length, 0, "clinical data was not sent without the credential");
  assert.match(d1.results[0].detail, /PARTNER_TOKEN/);

  // Configure it, and the far end really receives the Authorization header.
  ENV.PARTNER_TOKEN = "s3cret-partner-token";
  try {
    const d2 = await dispatch(ORG_A, at(24 * 3600_000));
    assert.equal(d2.results[0].state, DELIVERY_STATE.DELIVERED);
    assert.equal(received[0].headers.authorization, "Bearer s3cret-partner-token");

    const list = await as(ADMIN, `/ward/outbound-destinations?orgId=${ORG_A}`, "GET");
    const body = JSON.stringify(list);
    assert.ok(!body.includes("s3cret-partner-token"), "the token never comes back out of the API");
    assert.equal(list.destinations[0].auth.secretBinding, "PARTNER_TOKEN");
    assert.equal(list.destinations[0].auth.configured, true);
  } finally { delete ENV.PARTNER_TOKEN; }
});

/* ---- 12: tenant isolation ------------------------------------------------------------------------ */

test("12. tenant isolation: hospital B cannot see, dispatch or reuse hospital A's destination or queue", async () => {
  seedHospitals();
  const pidA = await seedPatient(ORG_A, "MRN-12A");
  await register(ORG_A);
  await sendOut(ORG_A, pidA);

  const bList = await as(ADMIN, `/ward/outbound-destinations?orgId=${ORG_B}`, "GET");
  assert.equal(bList.destinations.length, 0, "A's destination is invisible in B");
  const bQueue = await queue(ORG_B);
  assert.equal(bQueue.deliveries.length, 0, "A's queue is invisible in B");

  // B cannot send to A's destination by name, and dispatching in B moves nothing of A's.
  const pidB = await seedPatient(ORG_B, "MRN-12B");
  const send = await as(ADMIN, `/ward/outbound-send?orgId=${ORG_B}`, "POST", { destination: "partner-hospital", resourceType: "Patient", id: pidB });
  assert.equal(send.__status, 404, JSON.stringify(send));
  const dB = await dispatch(ORG_B, T0);
  assert.equal(dB.attempted, 0);
  assert.equal(received.length, 0);

  // A's own dispatch still works: isolation, not breakage.
  const dA = await dispatch(ORG_A, T0);
  assert.equal(dA.results[0].state, DELIVERY_STATE.DELIVERED);
  assert.equal(received.length, 1);
});

/* ---- 13: what may be sent ------------------------------------------------------------------------ */

test("13. a destination receives only what it was registered for, and only what has an honest mapping", async () => {
  seedHospitals();
  const pid = await seedPatient(ORG_A, "MRN-13");
  await register(ORG_A, { resourceTypes: ["Encounter"] });
  const q = await sendOut(ORG_A, pid);
  assert.equal(q.__status, 409, JSON.stringify(q));
  assert.equal(q.error, "resource_type_not_accepted");

  const empty = await register(ORG_A, { name: "accepts-nothing", resourceTypes: [] });
  assert.equal(empty.__status, 422, "a destination that has not said what it accepts is not registered");

  const unknown = await register(ORG_A, { name: "wants-nonsense", resourceTypes: ["Unicorn"] });
  assert.equal(unknown.__status, 422);
  assert.equal(unknown.error, "unknown_resource_type");

  await dispatch(ORG_A, T0);
  assert.equal(received.length, 0);
});

test("14. nothing is queued blind: a resource this chart does not hold is refused, not sent as an empty shell", async () => {
  seedHospitals();
  await seedPatient(ORG_A, "MRN-14");
  await register(ORG_A);
  const q = await sendOut(ORG_A, "no-such-patient-id");
  assert.equal(q.__status, 404, JSON.stringify(q));
  assert.equal(q.error, "resource_not_found");
  const d = await dispatch(ORG_A, T0);
  assert.equal(d.attempted, 0);
  assert.equal(received.length, 0);
});
