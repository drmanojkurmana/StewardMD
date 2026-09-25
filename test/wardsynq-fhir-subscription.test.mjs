import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-fhir-subscription.test.mjs - P2.5 Subscription (R4 backport, rest-hook, id-only) on the webhooks.
 *
 * Routes: POST /api/queue/ward/webhook and /api/queue/ward/webhook-update with payload "fhir-id-only",
 * POST /api/queue/ward/admit as the event, the outbox delivery, then GET /api/queue/ward/fhir/Subscription
 * and GET /api/fhir/{org}/Subscription. G10: POST /api/queue/ward/fhir/Subscription (create) and
 * GET /api/queue/ward/fhir/Subscription/{id}/$status, GET /api/fhir/{org}/Subscription/{id}/$status.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-fhir-subscription.test.mjs
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
  prepare: () => ({ bind: (...a) => ({ first: async () => (TENANTS[String(a[0])] ? { ...TENANTS[String(a[0])] } : null), all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }),
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
const { drainOutbox } = await import("../functions/_wardsynq/outbox.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { onRequest: fhirDoor } = await import("../functions/api/fhir/[[path]].js");
const { hashSecret } = await import("../functions/_wardsynq/patient-access.js");
const { SmartGrant, readTypesFor } = await import("../functions/_wardsynq/smart-server.js");
const { resetMemory } = await import("../functions/_wardsynq/rate-limit.js");

const T = "tenant-wsq", ORG_ID = "org-wsq", OTHER = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", NURSE = "nurse@example.test", HR = "hr@example.test", OTHER_ADMIN = "boss@other.test";
const PUBLIC_URL = "https://93.184.216.34/hooks/fhir";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1" };
const SMART = { fhir: { smart: { enabled: true, clients: [{ clientId: "viewer", kind: "public", redirectUris: ["https://app/cb"], scopes: ["user/*.read", "patient/*.read"] }, { clientId: "hub", kind: "backend", scopes: ["system/*.read"], jwks: { keys: [{ kty: "EC", kid: "k" }] } }] } } };

beforeEach(() => {
  docs.clear(); clock = 1; resetMemory();
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: T, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: SMART }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER}`, { fields: { id: OTHER, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OTHER_ADMIN), createdAt: 1, wardsynq: SMART }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [NURSE, "nurse"], [HR, "hr"]]) docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(OTHER)}__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: OTHER, identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
});

async function as(email, path, method, body) {
  const headers = { ...(email ? { "Cf-Access-Authenticated-User-Email": email } : {}), ...(body ? { "Content-Type": "application/json" } : {}) };
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function mintBearer(scopes, opts) {
  const o = opts || {};
  const tok = "tok-" + Math.random().toString(36).slice(2);
  const now = Date.now(), backend = scopes.some((s) => s.startsWith("system/"));
  await RECORD.append(T, [{ ...SmartGrant({ id: `wsq-smart-token-${await hashSecret(tok, "smart:token")}`, kind: "token", clientId: backend ? "hub" : "viewer", clientKind: backend ? "backend" : "public", subject: backend ? "smart:hub" : idFor(ADMIN), subjectKind: backend ? "service" : "human", scopes, readTypes: readTypesFor(scopes), patientId: o.patientId || null, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString() }), version: 1, meta: { recordedAt: new Date(now).toISOString() }, writtenBy: { id: "cfa:seed", kind: "human", at: new Date(now).toISOString() } }]);
  return tok;
}
const smart = (path, tok) => fhirDoor({ request: new Request(`https://x/api/fhir/${ORG_ID}/${path}`, { headers: tok ? { Authorization: "Bearer " + tok } : {} }), env: ENV, params: { path: [ORG_ID, ...path.split("?")[0].split("/")] } });
function receiver() {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 200 }); } };
}

test("A FHIR-PAYLOAD WEBHOOK on POST /api/queue/ward/webhook delivers the backport id-only notification for an admission, signed, through the same outbox; no PHI", async () => {
  assert.equal((await as(ADMIN, "/ward/webhook", "POST", { orgId: ORG_ID, url: PUBLIC_URL, eventTypes: ["encounter.admitted"], payload: "rss" })).__status, 422, "an unknown payload is refused");
  const reg = await as(ADMIN, "/ward/webhook", "POST", { orgId: ORG_ID, url: PUBLIC_URL, eventTypes: ["encounter.admitted", "encounter.discharged"], payload: "fhir-id-only" });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  assert.equal(reg.webhook.payload, "fhir-id-only");
  const mrn = "MRN55123";
  const adm = await as(ADMIN, "/ward/admit", "POST", { orgId: ORG_ID, mrn, ward: "Medical A", bed: "4" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));

  const rx = receiver();
  const deps = { repository: RECORD, tenantId: T, env: ENV, orgId: ORG_ID, fetchImpl: rx.fetchImpl, nowMs: Date.now() };
  for (let i = 0; i < 2; i++) await drainOutbox(RECORD, T, W.webhookConsumers(deps), { now: () => deps.nowMs });
  assert.equal(rx.calls.length, 1, "one delivery, by the webhook outbox");
  const { init } = rx.calls[0];
  assert.equal(init.headers["Content-Type"], "application/fhir+json");
  assert.equal(await W.verifySignature(reg.secret, init.headers["X-WardSynQ-Timestamp"], init.body, init.headers["X-WardSynQ-Signature"], deps.nowMs), true);
  const b = JSON.parse(init.body);
  assert.equal(b.resourceType, "Bundle");
  assert.equal(b.type, "history");
  const status = b.entry[0].resource;
  const p = (n) => status.parameter.find((x) => x.name === n);
  assert.equal(status.resourceType, "Parameters");
  assert.equal(p("type").valueCode, "event-notification");
  assert.equal(p("topic").valueCanonical, "urn:stewardmd:fhir:SubscriptionTopic:encounter.admitted");
  assert.equal(p("subscription").valueReference.reference, `Subscription/${reg.webhook.id}.encounter.admitted`);
  const focus = p("notification-event").part.find((x) => x.name === "focus").valueReference.reference;
  assert.match(focus, /^Encounter\/wsq-[0-9a-f]{48}$/);
  assert.equal(b.entry.length, 2);
  assert.equal(b.entry[1].fullUrl, focus);
  assert.equal(b.entry[1].resource, undefined, "id-only: the focus is named, never included");
  for (const needle of [mrn, adm.patientId, adm.encounterId, "Medical A"]) assert.ok(!init.body.includes(needle), `payload leaks ${needle}`);

  // The "Send test" button's event goes out as a backport handshake with no event and no focus.
  const hs = JSON.parse(W.notificationBody({ id: "evt-test-1", type: "webhook.test", occurredAt: "2026-09-14T00:00:00.000Z", resource: null }, ORG_ID, { id: reg.webhook.id, payload: "fhir-id-only", eventTypes: ["encounter.admitted"] }));
  assert.equal(hs.entry.length, 1);
  assert.equal(hs.entry[0].resource.parameter.find((x) => x.name === "type").valueCode, "handshake");
  assert.equal(JSON.parse(W.notificationBody({ id: "e", type: "encounter.admitted", occurredAt: "t", resource: { resourceType: "Encounter", id: "x" } }, ORG_ID, { payload: "wardsynq" })).note.length > 0, true, "the default payload is unchanged");
});

test("SUBSCRIPTION READ on /api/queue/ward/fhir/Subscription: no session 401, a nurse 403, hr 403 (no clinical actor), another hospital 403, an admin sees one Subscription per topic; a JSON-payload webhook is not a Subscription", async () => {
  const fhir = await as(ADMIN, "/ward/webhook", "POST", { orgId: ORG_ID, url: PUBLIC_URL, eventTypes: ["encounter.admitted", "result.released"], payload: "fhir-id-only" });
  await as(ADMIN, "/ward/webhook", "POST", { orgId: ORG_ID, url: "https://93.184.216.35/plain", eventTypes: ["encounter.admitted"] });
  const path = `/ward/fhir/Subscription?orgId=${ORG_ID}`;
  assert.equal((await as("", path)).__status, 401);
  assert.equal((await as(NURSE, path)).__status, 403);
  assert.equal((await as(HR, path)).__status, 403);
  assert.equal((await as(OTHER_ADMIN, path)).__status, 403);
  const r = await as(ADMIN, path);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.total, 2);
  const s = r.entry.map((e) => e.resource).find((x) => x.criteria.endsWith("result.released"));
  assert.equal(s.id, `${fhir.webhook.id}.result.released`);
  assert.equal(s.status, "active");
  assert.equal(s.channel.type, "rest-hook");
  assert.equal(s.channel._payload.extension[0].valueCode, "id-only");
  assert.ok(!JSON.stringify(r).includes("whsec_") && !JSON.stringify(r).includes("secretEnc"), "the secret never appears");

  // Turning it off is visible, and changing the payload back removes it from FHIR.
  assert.equal((await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: fhir.webhook.id, active: false })).__status, 200);
  assert.equal((await as(ADMIN, `/ward/fhir/Subscription/${fhir.webhook.id}.result.released?orgId=${ORG_ID}`)).status, "off");
  assert.equal((await as(ADMIN, `/ward/fhir/Subscription?orgId=${ORG_ID}&status=active`)).total, 0);
  assert.equal((await as(ADMIN, "/ward/webhook-update", "POST", { orgId: ORG_ID, id: fhir.webhook.id, payload: "wardsynq" })).__status, 200);
  assert.equal((await as(ADMIN, path)).total, 0);
  assert.equal((await as(ADMIN, `/ward/fhir/Subscription?orgId=${ORG_ID}&endpoint=x`)).__status, 400);
});

test("INTEGRATIONS SCREEN (admin.js): the payload is chosen when a webhook is added, and a Subscription is labelled as one", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  const adminSrc = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(adminSrc);
  const c = { esc: win.WSQ.esc, ms: win.WSQ.ms };
  const types = [{ id: "order.placed", label: "Order placed" }];
  const html = win.WSQ._webhooksHtml(c, { ok: true, keyConfigured: true, eventTypes: types, webhooks: [{ id: "wh-1", url: PUBLIC_URL, eventTypes: ["order.placed"], active: true, status: "active", payload: "fhir-id-only" }, { id: "wh-2", url: PUBLIC_URL, eventTypes: ["order.placed"], active: true, status: "active", payload: "wardsynq" }] });
  assert.match(html, /<option value="fhir-id-only">FHIR Subscription notification \(R4 backport, id only\)/);
  assert.equal((html.match(/FHIR Subscription, id only/g) || []).length, 1, "only the FHIR-payload webhook is labelled");
  assert.ok(adminSrc.includes('payload: document.getElementById("whPayload").value'), "the choice is sent to /ward/webhook");
});

test("SUBSCRIPTION on /api/fhir/{org}/Subscription: no bearer 401, patient/ and user/ tokens 403, a system/ token 200, and nothing is writable", async () => {
  await as(ADMIN, "/ward/webhook", "POST", { orgId: ORG_ID, url: PUBLIC_URL, eventTypes: ["order.placed"], payload: "fhir-id-only" });
  assert.equal((await smart("Subscription")).status, 401);
  assert.equal((await smart("Subscription", await mintBearer(["patient/*.read"], { patientId: "p1" }))).status, 403);
  assert.equal((await smart("Subscription", await mintBearer(["user/*.read"]))).status, 403);
  const sys = await smart("Subscription", await mintBearer(["system/*.read"]));
  assert.equal(sys.status, 200, await sys.clone().text());
  assert.equal((await sys.json()).entry[0].resource.criteria, "urn:stewardmd:fhir:SubscriptionTopic:order.placed");
  const post = await fhirDoor({ request: new Request(`https://x/api/fhir/${ORG_ID}/Subscription`, { method: "POST", body: "{}" }), env: ENV, params: { path: [ORG_ID, "Subscription"] } });
  assert.equal(post.status, 405);
});

/* ---- G10: create over FHIR, and $status --------------------------------------------------------- */

const PAYLOAD_EXT = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-payload-content";
const sub = (over, channel) => ({
  resourceType: "Subscription", status: "requested", reason: "Bed management feed",
  criteria: "urn:stewardmd:fhir:SubscriptionTopic:encounter.admitted",
  channel: { type: "rest-hook", endpoint: PUBLIC_URL, payload: "application/fhir+json", _payload: { extension: [{ url: PAYLOAD_EXT, valueCode: "id-only" }] }, ...(channel || {}) },
  ...(over || {}),
});
async function postSub(email, body) {
  return onRequest({ request: new Request(`https://x/api/queue/ward/fhir/Subscription?orgId=${ORG_ID}`, { method: "POST", headers: { ...(email ? { "Cf-Access-Authenticated-User-Email": email } : {}), "Content-Type": "application/fhir+json" }, body: JSON.stringify(body) }), env: ENV });
}
const endpoints = async () => (await RECORD.latestByType(T, "_wardsynq_webhook", 100)) || [];

test("CREATE on POST /api/queue/ward/fhir/Subscription: no session 401, nurse 403, hr 403, another hospital 403, nothing registered; an admin gets 201, a Location, the secret once, and the same webhook the screen lists", async () => {
  assert.equal((await postSub("", sub())).status, 401);
  assert.equal((await postSub(NURSE, sub())).status, 403);
  assert.equal((await postSub(HR, sub())).status, 403, "staff.admin with no clinical actor registers nothing");
  assert.equal((await postSub(OTHER_ADMIN, sub())).status, 403);
  assert.equal((await endpoints()).length, 0, "no refusal wrote an endpoint");

  const res = await postSub(ADMIN, sub());
  assert.equal(res.status, 201, await res.clone().text());
  const created = await res.json();
  assert.equal(created.resourceType, "Subscription");
  assert.equal(created.status, "active");
  assert.equal(created.criteria, "urn:stewardmd:fhir:SubscriptionTopic:encounter.admitted");
  assert.equal(res.headers.get("Location"), `https://x/api/queue/ward/fhir/Subscription/${created.id}`);
  const secret = res.headers.get("X-WardSynQ-Webhook-Secret");
  assert.match(secret, /^whsec_/);
  assert.ok(!JSON.stringify(created).includes("whsec_"), "the secret is never in the resource");
  const { validateResource } = await import("../functions/_wardsynq/fhir-validate.js");
  assert.deepEqual(validateResource(created).issues.filter((i) => i.severity === "error"), [], "what is served is valid R4");
  const read = await as(ADMIN, `/ward/fhir/Subscription/${created.id}?orgId=${ORG_ID}`);
  assert.equal(read.__status, 200);
  assert.ok(!JSON.stringify(read).includes("whsec_"), "and never readable again");
  const list = await as(ADMIN, `/ward/webhooks?orgId=${ORG_ID}`);
  assert.equal(list.webhooks.length, 1);
  assert.equal(list.webhooks[0].payload, "fhir-id-only");
  assert.equal(list.webhooks[0].description, "Bed management feed");
  assert.ok(RECORD.audit.some((a) => a.action === "webhook.register" && a.actor === idFor(ADMIN)), "audited by the same registration");
});

test("CREATE REFUSES what it cannot honour, by name, and writes nothing: private or http endpoint, unknown topic, full-resource payload, header, end, missing reason", async () => {
  const cases = [
    [sub(null, { endpoint: "https://10.0.0.5/hook" }), /public address|private/i],
    [sub(null, { endpoint: "http://93.184.216.34/hook" }), /https/i],
    [sub(null, { endpoint: "https://169.254.169.254/latest" }), /public address|metadata|link-local|private/i],
    [sub({ criteria: "Observation?code=1234" }), /exactly one topic/],
    [sub(null, { _payload: { extension: [{ url: PAYLOAD_EXT, valueCode: "full-resource" }] } }), /id-only/],
    [sub(null, { header: ["Authorization: Bearer x"] }), /headers are not sent/],
    [sub({ end: "2026-12-31T00:00:00Z" }), /end date/],
    [sub(null, { type: "websocket" }), /rest-hook/],
    [(() => { const b = sub(); delete b.reason; return b; })(), /required/],
  ];
  for (const [body, why] of cases) {
    const res = await postSub(ADMIN, body);
    assert.equal(res.status, 422, JSON.stringify(body));
    const oo = await res.json();
    assert.equal(oo.resourceType, "OperationOutcome");
    assert.match(oo.issue.map((i) => i.diagnostics).join(" | "), why, JSON.stringify(body));
  }
  assert.equal((await endpoints()).length, 0);
});

test("$STATUS on GET /api/queue/ward/fhir/Subscription/{id}/$status and the SMART door: a searchset with one SubscriptionStatus; 401, 403, 404 as for a read; the error when delivery turned it off", async () => {
  const created = await (await postSub(ADMIN, sub())).json();
  const path = `/ward/fhir/Subscription/${created.id}/$status?orgId=${ORG_ID}`;
  assert.equal((await as("", path)).__status, 401);
  assert.equal((await as(NURSE, path)).__status, 403);
  assert.equal((await as(OTHER_ADMIN, path)).__status, 403);
  assert.equal((await as(ADMIN, `/ward/fhir/Subscription/wh-none.encounter.admitted/$status?orgId=${ORG_ID}`)).__status, 404);
  const b = await as(ADMIN, path);
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(b.type, "searchset");
  const p = (n) => b.entry[0].resource.parameter.find((x) => x.name === n);
  assert.equal(b.entry[0].resource.resourceType, "Parameters");
  assert.equal(p("type").valueCode, "query-status");
  assert.equal(p("status").valueCode, "active");
  assert.equal(p("topic").valueCanonical, created.criteria);
  assert.match(p("subscription").valueReference.reference, new RegExp(`Subscription/${created.id.replace(/\./g, "\\.")}$`));
  assert.equal(p("events-since-subscription-start"), undefined, "no count that is not one");

  const ep = (await endpoints())[0];
  await RECORD.append(T, [{ ...ep, version: ep.version + 1, active: false, status: "auto-disabled", disabledReason: "10 failed deliveries in 30 minutes" }]);
  const off = await as(ADMIN, path);
  assert.equal(off.entry[0].resource.parameter.find((x) => x.name === "status").valueCode, "error");
  assert.equal(off.entry[0].resource.parameter.find((x) => x.name === "error").valueCodeableConcept.text, "10 failed deliveries in 30 minutes");

  const sys = await smart(`Subscription/${created.id}/$status`, await mintBearer(["system/*.read"]));
  assert.equal(sys.status, 200, await sys.clone().text());
  assert.equal((await smart(`Subscription/${created.id}/$status`, await mintBearer(["user/*.read"]))).status, 403);
});
