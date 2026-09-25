import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-smart-clients.test.mjs - Connected apps (SMART client registration).
 *
 * Routes: GET /api/queue/ward/smart-clients, POST /api/queue/ward/smart-client-save,
 * POST /api/queue/ward/smart-client-remove, POST /api/queue/ward/smart-enable (Admin Center >
 * Integrations > Connected apps), and the SMART door (/api/fhir/{org}/smart/token plus a read)
 * proving removal cuts access at once.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-smart-clients.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const subtle = globalThis.crypto.subtle;
const b64url = (o) => Buffer.from(o).toString("base64url");

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

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { onRequest: fhirDoor } = await import("../functions/api/fhir/[[path]].js");
const { JWT_BEARER } = await import("../functions/_wardsynq/smart-server.js");

const T = "tenant-wsq", ORG_ID = "org-wsq", OTHER = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", NURSE = "nurse@example.test", HR = "hr@example.test", OTHER_ADMIN = "boss@other.test";
const kv = new Map();
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1",
  MAIK_KV: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); } } };

const PUBLIC = { clientId: "viewer-app", name: "Ward viewer", kind: "public", redirectUris: ["https://app.example.test/cb"], scopes: ["user/Observation.read", "openid"] };

function seed() {
  docs.clear(); clock = 1; kv.clear();
  RECORD = new MemoryRepository();
  /* Sibling configuration the smart writes must carry along untouched: a fhir sibling (profiles)
   * and a wardsynq sibling (criticalLimits). */
  const smart = { enabled: false, clients: [] };
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-wsq", ownerUid: idFor(ADMIN), createdAt: 1,
    wardsynq: { criticalLimits: { potassium: { low: 1 } }, fhir: { profiles: ["keep-me"], smart } } }, updateTime: "t1" });
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
const orgSmart = () => docs.get(`q_orgs/${ORG_ID}`).fields.wardsynq.fhir.smart;
const smartRead = (tok, path) => fhirDoor({ request: new Request(`https://x/api/fhir/${ORG_ID}/${path}`, { headers: { Authorization: "Bearer " + tok } }), env: ENV, params: { path: [ORG_ID, ...path.split("/")] } });
/* A real client_credentials mint through the SMART door: a signed private_key_jwt assertion
 * against the client's REGISTERED public key. Returns the access token, or null when refused. */
async function tokenFor(kp, kid, clientId, jti) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const p = b64url(JSON.stringify({ iss: clientId, sub: clientId, aud: `https://x/api/fhir/${ORG_ID}/smart/token`, exp: now + 120, jti }));
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  const form = new URLSearchParams({ grant_type: "client_credentials", client_assertion_type: JWT_BEARER, client_assertion: `${h}.${p}.${b64url(sig)}`, scope: "system/Patient.read" });
  const res = await fhirDoor({ request: new Request(`https://x/api/fhir/${ORG_ID}/smart/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() }), env: ENV, params: { path: [ORG_ID, "smart", "token"] } });
  if (res.status !== 200) return null;
  return (await res.json()).access_token;
}

// ---------------------------------------------------------------------------------------------
// AUTHORIZATION
// ---------------------------------------------------------------------------------------------
test("route NEGATIVE: no session 401; a nurse 403; hr (staff.admin, no clinical actor) 403; another hospital 403 or 404; nothing written", async () => {
  seed();
  const before = writesNow();
  const calls = [
    ["GET", `/ward/smart-clients?orgId=${ORG_ID}`],
    ["POST", "/ward/smart-client-save", { orgId: ORG_ID, client: PUBLIC }],
    ["POST", "/ward/smart-client-remove", { orgId: ORG_ID, clientId: "viewer-app" }],
    ["POST", "/ward/smart-enable", { orgId: ORG_ID, enabled: true }],
  ];
  for (const [method, path, body] of calls) {
    assert.equal((await as(null, path, method, body)).__status, 401, path);
    const nurse = await as(NURSE, path, method, body);
    assert.equal(nurse.__status, 403, path + JSON.stringify(nurse));
    const hr = await as(HR, path, method, body);
    assert.equal(hr.__status, 403, "hr " + path + JSON.stringify(hr));
    const other = await as(OTHER_ADMIN, path, method, body);
    assert.ok(other.__status === 403 || other.__status === 404, path + JSON.stringify(other));
  }
  assert.equal(writesNow(), before, "no record, audit row or org document written by a refused call");
  assert.deepEqual(orgSmart(), { enabled: false, clients: [] });
});

// ---------------------------------------------------------------------------------------------
// POSITIVE: enable, save, list, update
// ---------------------------------------------------------------------------------------------
test("positive: the switch moves, a save lists back with counts and no key material, an update lands, siblings survive", async () => {
  seed();
  let r = await as(ADMIN, `/ward/smart-clients?orgId=${ORG_ID}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.enabled, false);
  assert.deepEqual(r.clients, []);
  assert.ok(r.scopeCatalog.user.includes("user/Observation.read"), "the catalog carries resource scopes");
  assert.ok(r.scopeCatalog.special.includes("openid"), "and the special scopes");

  r = await as(ADMIN, "/ward/smart-enable", "POST", { orgId: ORG_ID, enabled: true });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.enabled, true);

  r = await as(ADMIN, "/ward/smart-client-save", "POST", { orgId: ORG_ID, client: PUBLIC });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.action, "created");

  r = await as(ADMIN, `/ward/smart-clients?orgId=${ORG_ID}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.enabled, true);
  assert.equal(r.clients.length, 1);
  assert.deepEqual(r.clients[0], { clientId: "viewer-app", name: "Ward viewer", kind: "public", redirectUris: ["https://app.example.test/cb"], scopes: ["user/Observation.read", "openid"], keyCount: 0, keys: [], jwksUri: null });
  assert.ok(!/"secret"|secretEnc|private/i.test(JSON.stringify(r)), "no secret material in the list");

  const upd = await as(ADMIN, "/ward/smart-client-save", "POST", { orgId: ORG_ID, client: { ...PUBLIC, name: "Ward viewer 2" } });
  assert.equal(upd.__status, 200, JSON.stringify(upd));
  assert.equal(upd.action, "updated");
  r = await as(ADMIN, `/ward/smart-clients?orgId=${ORG_ID}`);
  assert.equal(r.clients.length, 1, "an update replaces, never duplicates");
  assert.equal(r.clients[0].name, "Ward viewer 2");

  /* The write went to wardsynq.fhir.smart, and the siblings on both levels are still there. */
  const stored = orgSmart();
  assert.equal(stored.enabled, true);
  assert.equal(stored.clients.length, 1);
  assert.deepEqual(stored.clients[0].scopes, ["user/Observation.read", "openid"]);
  assert.deepEqual(docs.get(`q_orgs/${ORG_ID}`).fields.wardsynq.fhir.profiles, ["keep-me"], "the fhir sibling survives");
  assert.deepEqual(docs.get(`q_orgs/${ORG_ID}`).fields.wardsynq.criticalLimits, { potassium: { low: 1 } }, "the wardsynq sibling survives");

  /* Audited with the clientId and the action, never the keys. */
  assert.ok(RECORD.audit.some((a) => a.action === "smart.client.save" && a.scope && a.scope.clientId === "viewer-app" && a.scope.action === "created" && a.actor), "save audited");
  assert.ok(RECORD.audit.some((a) => a.action === "smart.enable" && a.scope && a.scope.enabled === true), "enable audited");
  assert.ok(!JSON.stringify(RECORD.audit).includes("app.example.test"), "the audit names the client, never its redirect addresses");
});

// ---------------------------------------------------------------------------------------------
// VALIDATION: every refusal is a 422 naming its field, and writes nothing
// ---------------------------------------------------------------------------------------------
test("validation: every refusal is a 422 naming its field, and writes nothing", async () => {
  seed();
  await as(ADMIN, "/ward/smart-enable", "POST", { orgId: ORG_ID, enabled: true });
  const ok = await as(ADMIN, "/ward/smart-client-save", "POST", { orgId: ORG_ID, client: PUBLIC });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const before = writesNow();
  const bad = [
    [{ ...PUBLIC, clientId: "ab" }, "invalid_client_id", "clientId"],
    [{ ...PUBLIC, clientId: "has space!" }, "invalid_client_id", "clientId"],
    [{ ...PUBLIC, clientId: "x".repeat(65) }, "invalid_client_id", "clientId"],
    [{ ...PUBLIC, name: "  " }, "name_required", "name"],
    [{ ...PUBLIC, kind: "confidential" }, "invalid_kind", "kind"],
    [{ ...PUBLIC, redirectUris: [] }, "redirect_uri_required", "redirectUris"],
    [{ ...PUBLIC, redirectUris: ["http://app.example.test/cb"] }, "invalid_redirect_uri", "redirectUris"],
    [{ ...PUBLIC, redirectUris: ["https://app.example.test/cb#frag"] }, "invalid_redirect_uri", "redirectUris"],
    [{ ...PUBLIC, scopes: [] }, "scopes_required", "scopes"],
    [{ ...PUBLIC, scopes: ["user/Observation.write"] }, "unknown_scope", "scopes"],
    [{ ...PUBLIC, scopes: ["user/NoSuchType.read"] }, "unknown_scope", "scopes"],
    [{ ...PUBLIC, scopes: ["system/Patient.read"] }, "system_scope_needs_backend", "scopes"],
    [{ clientId: "sys", name: "Sys", kind: "backend", redirectUris: [], scopes: ["user/Patient.read"], jwksUri: "https://keys.example.test/jwks" }, "user_scope_needs_public", "scopes"],
    [{ clientId: "sys", name: "Sys", kind: "backend", redirectUris: [], scopes: ["patient/Observation.read"], jwksUri: "https://keys.example.test/jwks" }, "user_scope_needs_public", "scopes"],
    [{ clientId: "sys", name: "Sys", kind: "backend", redirectUris: [], scopes: ["system/Patient.read"] }, "backend_key_required", "jwks"],
    [{ clientId: "sys", name: "Sys", kind: "backend", redirectUris: [], scopes: ["system/Patient.read"], jwks: { keys: [{ kty: "EC", crv: "P-256", kid: "k", x: "a", y: "b", d: "PRIVATE" }] } }, "private_key_not_accepted", "jwks"],
    [{ clientId: "sys", name: "Sys", kind: "backend", redirectUris: [], scopes: ["system/Patient.read"], jwks: { keys: [{ kty: "oct", kid: "k", k: "SECRET" }] } }, "private_key_not_accepted", "jwks"],
    [{ clientId: "sys", name: "Sys", kind: "backend", redirectUris: [], scopes: ["system/Patient.read"], jwksUri: "http://keys.example.test/jwks" }, "invalid_jwks_uri", "jwksUri"],
  ];
  for (const [client, error, field] of bad) {
    const r = await as(ADMIN, "/ward/smart-client-save", "POST", { orgId: ORG_ID, client });
    assert.equal(r.__status, 422, JSON.stringify(client) + " -> " + JSON.stringify(r));
    assert.equal(r.error, error, JSON.stringify(r));
    assert.equal(r.field, field, JSON.stringify(r));
    assert.ok(r.message && r.message.length > 0, "a save failure carries the server's field message");
  }
  const noClient = await as(ADMIN, "/ward/smart-client-save", "POST", { orgId: ORG_ID });
  assert.equal(noClient.__status, 422);
  assert.equal(noClient.field, "client");
  const en = await as(ADMIN, "/ward/smart-enable", "POST", { orgId: ORG_ID, enabled: "yes" });
  assert.equal(en.__status, 422, JSON.stringify(en));
  assert.equal(en.field, "enabled", "a non-boolean switch value is refused, never coerced");
  const rm = await as(ADMIN, "/ward/smart-client-remove", "POST", { orgId: ORG_ID, clientId: "nobody-here" });
  assert.equal(rm.__status, 404, JSON.stringify(rm));
  assert.equal(rm.field, "clientId");
  assert.equal(writesNow(), before, "no refusal wrote anything");
  const list = await as(ADMIN, `/ward/smart-clients?orgId=${ORG_ID}`);
  assert.equal(list.clients.length, 1, "only the one good client survived the refusal run");
  assert.equal(list.clients[0].clientId, "viewer-app");
});

// ---------------------------------------------------------------------------------------------
// BACKEND KEYS: counts and public ids only, never key material
// ---------------------------------------------------------------------------------------------
test("backend keys: the list carries a count with kid/kty/alg and nothing else", async () => {
  seed();
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await subtle.exportKey("jwk", kp.publicKey);
  const save = await as(ADMIN, "/ward/smart-client-save", "POST", { orgId: ORG_ID, client:
    { clientId: "lab-sys", name: "Lab feed", kind: "backend", redirectUris: [], scopes: ["system/Patient.read"], jwks: { keys: [{ ...pub, kid: "lab-1", alg: "ES256", use: "sig" }] } } });
  assert.equal(save.__status, 200, JSON.stringify(save));
  const list = await as(ADMIN, `/ward/smart-clients?orgId=${ORG_ID}`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.clients[0].keyCount, 1);
  assert.deepEqual(list.clients[0].keys, [{ kid: "lab-1", kty: "EC", alg: "ES256" }]);
  assert.equal(list.clients[0].jwksUri, null);
  const text = JSON.stringify(list);
  assert.ok(!/"(d|p|q|dp|dq|qi|k)":/.test(text), "no private key member anywhere in the list: " + text);
  assert.ok(!text.includes(pub.x), "not even the public coordinates leave the server in the list");
});

// ---------------------------------------------------------------------------------------------
// REMOVAL CUTS ACCESS: a token issued to a client is refused once the client is gone
// ---------------------------------------------------------------------------------------------
test("a token issued to a client stops working the moment that client is removed", async () => {
  seed();
  await RECORD.append(T, [{ resourceType: "Patient", id: "p1", version: 1, mrn: "MR1", name: "Asha", sex: "female",
    meta: { recordedAt: "2026-09-01T08:00:00.000Z" }, writtenBy: { id: "cfa:seed", kind: "human", at: "2026-09-01T08:00:00.000Z" } }]);
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await subtle.exportKey("jwk", kp.publicKey);
  assert.equal((await as(ADMIN, "/ward/smart-enable", "POST", { orgId: ORG_ID, enabled: true })).__status, 200);
  const save = await as(ADMIN, "/ward/smart-client-save", "POST", { orgId: ORG_ID, client:
    { clientId: "lab-sys", name: "Lab feed", kind: "backend", redirectUris: [], scopes: ["system/Patient.read"], jwks: { keys: [{ ...pub, kid: "lab-1", alg: "ES256", use: "sig" }] } } });
  assert.equal(save.__status, 200, JSON.stringify(save));

  const token = await tokenFor(kp, "lab-1", "lab-sys", "jti-first");
  const read = await smartRead(token, "Patient/p1");
  assert.equal(read.status, 200, "the issued token reads before removal: " + await read.clone().text());

  const rm = await as(ADMIN, "/ward/smart-client-remove", "POST", { orgId: ORG_ID, clientId: "lab-sys" });
  assert.equal(rm.__status, 200, JSON.stringify(rm));
  assert.equal(rm.removed, "lab-sys");
  assert.ok(RECORD.audit.some((a) => a.action === "smart.client.remove" && a.scope && a.scope.clientId === "lab-sys"), "removal audited with the clientId");

  const after = await smartRead(token, "Patient/p1");
  assert.equal(after.status, 401, "the same token is refused after removal");
  assert.match((await after.json()).issue[0].diagnostics, /no longer registered/);

  const again = await tokenFor(kp, "lab-1", "lab-sys", "jti-second");
  assert.equal(again, null, "and no new token can be minted for the removed client");
  const list = await as(ADMIN, `/ward/smart-clients?orgId=${ORG_ID}`);
  assert.deepEqual(list.clients, [], "the client is actually gone from configuration");
});

// ---------------------------------------------------------------------------------------------
// ADMIN SCREEN
// ---------------------------------------------------------------------------------------------
test("screen: loading, failed and empty are distinct; scopes come from the answer, per kind; edit prefills", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const html = win.WSQ._smartClientsHtml;
  const catalog = { user: ["user/Observation.read"], patient: ["patient/Observation.read"], system: ["system/Patient.read"], special: ["openid", "launch"] };
  const loading = html(c, null), failed = html(c, { failed: true, message: "forbidden" });
  const empty = html(c, { ok: true, enabled: false, clients: [], scopeCatalog: catalog });
  assert.match(loading, /Loading connected apps/);
  assert.match(failed, /could not be loaded: forbidden/);
  assert.match(failed, /not the same as there being none/);
  assert.match(empty, /No connected apps are registered/);
  for (const s of [loading, failed]) assert.ok(!/No connected apps are registered|Add a connected app/.test(s), s);
  /* The checkboxes are the answer's catalog, nothing else: one listed scope renders, one equally
   * plausible scope that was not listed does not. */
  assert.match(empty, /value="user\/Observation\.read"/);
  assert.ok(!/user\/Encounter\.read/.test(empty), "a scope outside the catalog is not offered");
  assert.ok(!/system\/Patient\.read/.test(empty), "a public form does not offer system scopes");
  assert.match(empty, /SMART access is on for this hospital/);

  const row = { clientId: "lab-sys", name: "Lab feed", kind: "backend", redirectUris: [], scopes: ["system/Patient.read"], keyCount: 2, keys: [{ kid: "lab-1", kty: "EC", alg: "ES256" }], jwksUri: null };
  const withRow = html(c, { ok: true, enabled: true, clients: [row], scopeCatalog: catalog });
  assert.match(withRow, /Lab feed/);
  assert.match(withRow, /lab-sys/);
  assert.match(withRow, /2 inline/);
  assert.match(withRow, /lab-1/);
  assert.match(withRow, /data-sc-edit="lab-sys"/);
  assert.match(withRow, /data-sc-remove="lab-sys"/);
  const editing = html(c, { ok: true, enabled: true, clients: [row], scopeCatalog: catalog }, "lab-sys");
  assert.match(editing, /Edit lab-sys/);
  assert.match(editing, /id="scId"[^>]*disabled/, "the client id cannot be renamed under a live token");
  assert.match(editing, /Keys are never shown again/);
  /* Kind toggles which fields and scopes the form shows: a backend edit offers system scopes
   * (with the registered one checked) and hides the redirect list. */
  assert.match(editing, /value="system\/Patient\.read"[^>]*checked/, "the registered scope is checked");
  assert.ok(!/user\/Observation\.read/.test(editing), "a backend form does not offer user scopes");
  assert.match(editing, /id="scRedirectWrap" style="display:none"/);
  assert.match(editing, /id="scBackendWrap" style=""/);
  assert.ok(!/[—–]/.test(loading + failed + empty + withRow + editing), "no em or en dash on screen");
});