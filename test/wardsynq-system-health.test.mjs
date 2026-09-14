/* test/wardsynq-system-health.test.mjs - P2.15: per-dependency health. Each probe down and timed out,
 * GET /api/queue/ward/system-health authorization, and the Admin System health card.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-system-health.test.mjs
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
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async (id) => "ref-" + id }),
  },
});

const H = await import("../functions/_wardsynq/system-health.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");

// ---------------------------------------------------------------------------------------------
// EACH PROBE: down and timeout
// ---------------------------------------------------------------------------------------------
const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const SECRET = "AIza-test-secret-key-000111";
const LOCAL = "http://10.20.30.40:8080/v1";
const hang = () => new Promise(() => {});

function healthy(over) {
  const base = {
    repository: {
      probe: async () => ({ ok: true, backend: "d1", ms: 4 }),
      latestByType: async (_t, type) => type === "BackupRun" ? [{ at: iso(NOW - 10 * 60000), throughSeq: 5, rows: 5, location: "offsite" }]
        : type === "RestoreTest" ? [{ at: iso(NOW - 86400000), outcome: "success", restoredWhat: "last night into staging", performedBy: "it" }] : [],
      auditChainHead: async () => null,                     // P2.17: nothing chained yet reads as up
      auditChainRows: async () => [],
    },
    orgAuditChain: { chainId: "q:org", auditChainHead: async () => null, auditChainRows: async () => [] },   // G3: nothing linked yet reads as up
    tenantId: "t1", env: { GEMINI_API_KEY: SECRET }, maik: { enabled: true, localBaseUrl: LOCAL, localModel: "m1" }, rpoMinutes: 60,
    orgProbe: async () => ({ id: "org" }),
    documentProbe: async () => ({ state: "ok", checkedAt: iso(NOW - 60000) }),
    lastTick: async () => ({ at: iso(NOW - 2 * 60000), criticalsFailed: false, outboxFailed: false }),
    fetchImpl: async () => ({ ok: true }),
    timeoutMs: 40, now: () => NOW,
  };
  return { ...base, ...over, repository: { ...base.repository, ...((over && over.repository) || {}) } };
}
const byId = (r) => Object.fromEntries(r.dependencies.map((d) => [d.id, d]));

test("all probes answer: every dependency up, overall up, no consequence text", async () => {
  const r = await H.systemHealthReport(healthy());
  assert.equal(r.overall, "up", JSON.stringify(r.dependencies.filter((d) => d.status !== "up")));
  assert.deepEqual(r.dependencies.map((d) => d.id), ["record-store", "org-store", "document-storage", "maik-gateway", "outbox", "ops-tick", "backup", "audit-chain", "org-audit-chain"]);
  assert.ok(r.dependencies.every((d) => d.status === "up" && d.consequence === null && d.checkedAt));
  assert.equal(byId(r)["document-storage"].checkedAt, iso(NOW - 60000), "document storage says when its probe really ran");
});

const CASES = [
  ["record-store", { repository: { probe: async () => ({ ok: false, detail: "the record store could not be queried" }) } }, { repository: { probe: hang } }],
  ["org-store", { orgProbe: async () => null }, { orgProbe: hang }],
  ["document-storage", { documentProbe: async () => ({ state: "failed", step: "put", providerStatus: 403 }) }, { documentProbe: hang }],
  ["maik-gateway", { fetchImpl: async () => { throw new Error(`fetch ${LOCAL} failed key=${SECRET}`); } }, { fetchImpl: hang }],
  ["outbox", { repository: { latestByType: async (_t, type) => type === "_wardsynq_outbox" ? [{ status: "pending", createdAt: iso(NOW - 2 * 3600000) }] : healthy().repository.latestByType(_t, type) } },
    { repository: { latestByType: async (_t, type) => type === "_wardsynq_outbox" ? hang() : healthy().repository.latestByType(_t, type) } }],
  ["ops-tick", { lastTick: async () => null }, { lastTick: hang }],
  ["backup", { repository: { latestByType: async () => [] } }, { repository: { latestByType: async (_t, type) => type === "BackupRun" ? hang() : [] } }],
];

for (const [id, downOver, hangOver] of CASES) {
  test(`${id}: a failed probe is DOWN with a plain consequence, and no secret or internal address leaks`, async () => {
    const r = await H.systemHealthReport(healthy(downOver));
    const d = byId(r)[id];
    assert.equal(d.status, "down", JSON.stringify(d));
    assert.ok(d.consequence && d.consequence.length > 20, "says what staff will see");
    assert.equal(r.overall, "down", "one down dependency is never an overall green");
    const text = JSON.stringify(r);
    assert.ok(!text.includes(SECRET) && !text.includes("10.20.30.40") && !text.includes("googleapis"), "no secret or internal URL: " + text);
    assert.ok(!/[—–]/.test(text), "no em or en dash");
  });
  test(`${id}: a probe that does not answer in time is DOWN, never up`, async () => {
    const r = await H.systemHealthReport(healthy(hangOver));
    const d = byId(r)[id];
    assert.equal(d.status, "down", JSON.stringify(d));
    assert.match(d.reason, /No answer within 40 ms/);
    assert.equal(r.overall, "down");
  });
}

test("degraded branches: slow record store, MaiK off, one of two model providers failing, late tick, dead events", async () => {
  const slow = byId(await H.systemHealthReport(healthy({ repository: { probe: async () => ({ ok: true, ms: 2500 }) } })))["record-store"];
  assert.equal(slow.status, "degraded");
  assert.equal(byId(await H.systemHealthReport(healthy({ maik: { enabled: false } })))["maik-gateway"].status, "degraded");
  const one = byId(await H.systemHealthReport(healthy({ fetchImpl: async (url) => ({ ok: String(url).includes("generativelanguage") }) })))["maik-gateway"];
  assert.equal(one.status, "degraded");
  assert.match(one.reason, /hospital model server/);
  assert.equal(byId(await H.systemHealthReport(healthy({ lastTick: async () => ({ at: iso(NOW - 20 * 60000) }) })))["ops-tick"].status, "degraded");
  assert.equal(byId(await H.systemHealthReport(healthy({ lastTick: async () => undefined })))["ops-tick"].status, "down", "nowhere to record a run is not up");
  const dead = byId(await H.systemHealthReport(healthy({ repository: { latestByType: async (_t, type) => type === "_wardsynq_outbox" ? [{ status: "dead", attempts: 6 }] : healthy().repository.latestByType(_t, type) } })))["outbox"];
  assert.equal(dead.status, "degraded");
});

test("withTimeout rejects a hanging promise and passes a quick one through", async () => {
  assert.equal(await H.withTimeout(async () => 7, 50), 7);
  await assert.rejects(H.withTimeout(hang, 10), /timeout/);
});

// ---------------------------------------------------------------------------------------------
// REAL ROUTE: GET /api/queue/ward/system-health
// ---------------------------------------------------------------------------------------------
const ORG_ID = "org-wsq", OTHER = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", NURSE = "nurse@example.test", OTHER_ADMIN = "boss@other.test";
const kv = new Map();
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
  MAIK_KV: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); } } };

function seedHospital() {
  docs.clear(); clock = 1; kv.clear();
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER}`, { fields: { id: OTHER, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OTHER_ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [NURSE, "nurse"]]) {
    docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(OTHER)}__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: OTHER, identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path) {
  const headers = email ? { "Cf-Access-Authenticated-User-Email": email } : {};
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { headers }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const writesNow = () => RECORD._rows.length + RECORD.audit.length + docs.size + kv.size;

test("route NEGATIVE: no session 401, a nurse 403, another hospital's admin 403; nothing written", async () => {
  seedHospital();
  const before = writesNow();
  assert.equal((await as(null, `/ward/system-health?orgId=${ORG_ID}`)).__status, 401);
  const nurse = await as(NURSE, `/ward/system-health?orgId=${ORG_ID}`);
  assert.equal(nurse.__status, 403, JSON.stringify(nurse));
  assert.equal(nurse.dependencies, undefined);
  const other = await as(OTHER_ADMIN, `/ward/system-health?orgId=${ORG_ID}`);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  assert.equal(other.dependencies, undefined);
  const rl = [...kv.keys()].filter((k) => !k.startsWith("wsq:tick:"));
  assert.equal(writesNow() - rl.length, before, "no record, audit, org document or run log was written by a refused call");
});

test("route POSITIVE: the admin gets every dependency, never green where nothing was measured", async () => {
  seedHospital();
  const r = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const d = byId(r);
  assert.equal(d["record-store"].status, "up");
  assert.equal(d["org-store"].status, "up");
  assert.equal(d["document-storage"].status, "down", "not configured in this environment: uploads fail");
  assert.match(d["document-storage"].consequence, /uploads fail and existing documents cannot be opened; charting continues/);
  assert.equal(d["maik-gateway"].status, "degraded", "MaiK off for this hospital");
  assert.equal(d["ops-tick"].status, "down", "no background run recorded yet");
  assert.equal(d["backup"].status, "down", "no backup or restore test recorded");
  assert.equal(r.overall, "down");

  kv.set(`wsq:tick:last:${TENANT_ROW.id}`, JSON.stringify({ at: new Date().toISOString(), criticalsFailed: false, outboxFailed: false }));
  assert.equal(byId(await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`))["ops-tick"].status, "up", "a recorded run is read back");
});

// ---------------------------------------------------------------------------------------------
// ADMIN SCREEN
// ---------------------------------------------------------------------------------------------
test("screen: loading and a failed load never look healthy; each dependency shows its consequence", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const html = win.WSQ._systemHealthHtml;
  const c = { esc: win.WSQ.esc };
  const loading = html(c, null), failed = html(c, { failed: true, message: "forbidden" });
  for (const s of [loading, failed]) assert.ok(!/Every dependency answered|>Up</.test(s), s);
  assert.match(failed, /could not be loaded: forbidden/);
  assert.match(failed, /not the same as everything being up/);
  const report = { ok: true, overall: "down", generatedAt: "t", timeoutMs: 3000, dependencies: [
    { id: "document-storage", name: "Document storage", status: "down", checkedAt: "t", reason: "Not configured.", consequence: "Document storage down: uploads fail and existing documents cannot be opened; charting continues." },
    { id: "record-store", name: "Patient record store", status: "up", checkedAt: "t", reason: null, consequence: null },
  ] };
  const shown = html(c, report);
  assert.match(shown, /1 of 2 dependencies are not fully up/);
  assert.match(shown, /uploads fail and existing documents cannot be opened; charting continues/);
  assert.ok(!/Every dependency answered/.test(shown));
  assert.ok(!/[—–]/.test(loading + failed + shown), "no em or en dash on screen");
});
