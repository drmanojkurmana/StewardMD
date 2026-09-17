/* test/wardsynq-anchor-stores.test.mjs - G12: a second outside anchor that is neither D1 nor KV (Firestore, behind the
 * {name, get, put} AnchorStore port), both chains anchored into both stores, disagreement between the two copies as its
 * own finding, and the owner acknowledgement across both stores, including POST /api/queue/ward/audit-anchor-acknowledge
 * for the hospital event log.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-anchor-stores.test.mjs
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
const hooks = { beforeCommit: null, batchGetFails: false };
const pre = () => Object.assign(new Error("fs_precondition"), { code: "precondition" });
const view = (path, d) => ({ id: path.slice(path.lastIndexOf("/") + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? view(path, d) : null; },
    fsBatchGet: async (_e, paths) => {
      if (hooks.batchGetFails) throw Object.assign(new Error("fs_batch_get_failed"), { code: "fs_batch_get" });
      return new Map(paths.map((p) => [p, docs.has(p) ? view(p, docs.get(p)) : null]));
    },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push(view(path, d));
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      if (hooks.beforeCommit) { const h = hooks.beforeCommit; hooks.beforeCommit = null; await h(); }
      for (const w of writes || []) {
        const name = w.update ? w.update.name : w.delete, cd = w.currentDocument, d = docs.get(name);
        if (!cd) continue;
        if (cd.exists === false && d) throw pre();
        if (cd.exists === true && !d) throw pre();
        if (cd.updateTime && (!d || d.updateTime !== cd.updateTime)) throw pre();
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => ({ update: { name: path, fields }, ...(opts && opts.updateTime ? { currentDocument: { updateTime: opts.updateTime } } : opts && opts.exists === true ? { currentDocument: { exists: true } } : {}) }),
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

const QC = await import("../functions/_q_audit_chain.js");
const AC = await import("../functions/_wardsynq/audit-chain.js");
const SR = await import("../functions/_wardsynq/security-review.js");
const { systemHealthReport } = await import("../functions/_wardsynq/system-health.js");
const { qAudit } = await import("../functions/_queue_engine.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const H = "org-chain";
const events = (hosp) => [...docs.entries()].filter(([p, d]) => p.startsWith("q_events/") && d.fields.hospitalId === hosp);
const reset = () => { docs.clear(); clock = 1; hooks.beforeCommit = null; hooks.batchGetFails = false; };
const { runTick } = await import("../functions/_wardsynq/ops-tick.js");

const ORG_ID = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test", OTHER_ADMIN = "boss@other.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
function seedHospital() {
  reset();
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set("q_orgs/org-other", { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OTHER_ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"]]) {
    docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/org-other__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: "org-other", identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path) {
  const headers = email ? { "Cf-Access-Authenticated-User-Email": email } : {};
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { headers }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const orgWrites = () => [...docs.keys()].filter((k) => k.startsWith("q_events/") || k.startsWith("q_audit_chain_head/")).length;

const memStore = (name) => { const m = new Map(); return { name, map: m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); } }; };
const T = "tenant-two";
const ev = (i) => ({ ts: `2026-09-14T08:00:${String(i).padStart(2, "0")}.000Z`, actor: "cfa:dr", connectorId: "wardsynq", action: "record.read", scope: { n: i }, outcome: "ok" });
async function chained(n) { const mem = new MemoryRepository(); for (let i = 1; i <= n; i++) await mem.auditOnly(T, ev(i)); return mem; }

/* ---- the Firestore store and the port ------------------------------------------------------------ */

test("the Firestore anchor store is the same {name, get, put} port as KV; keys are escaped, values round-trip", async () => {
  reset();
  const fs = QC.firestoreAnchorStore({});
  assert.equal(fs.name, "Firestore");
  assert.equal(await fs.get("wsq:auditanchor:t1"), null);
  await fs.put("wsq:auditanchor:t1", "[1]");
  assert.equal(await fs.get("wsq:auditanchor:t1"), "[1]");
  assert.ok([...docs.keys()].some((k) => /^q_audit_anchors\/[A-Za-z0-9_-]+$/.test(k)), "one doc per key, no path characters");
  const mem = await chained(3);
  const r = await AC.anchorHead(mem, T, fs, "2026-09-14T10:00:00.000Z");
  assert.equal(r.anchored, true);
  assert.equal((await AC.checkAnchors(mem, T, fs)).status, "ok");
});

test("two stores: both matching is ok; one store empty is no-anchors, not ok; a single store behaves exactly as before", async () => {
  const mem = await chained(3);
  const kv = memStore("KV"), fsx = memStore("Firestore");
  await AC.anchorHead(mem, T, kv, "2026-09-14T10:00:00.000Z");
  const one = await AC.checkAnchorStores(mem, T, [kv]);
  assert.deepEqual(one, await AC.checkAnchors(mem, T, kv), "one store returns checkAnchors' own answer");
  const half = await AC.checkAnchorStores(mem, T, [kv, fsx]);
  assert.equal(half.status, "no-anchors", JSON.stringify(half));
  assert.match(half.message, /KV: Outside copy matches/);
  assert.match(half.message, /Firestore: No outside copy/);
  await AC.anchorHead(mem, T, fsx, "2026-09-14T10:00:00.000Z");
  const both = await AC.checkAnchorStores(mem, T, [kv, fsx]);
  assert.equal(both.status, "ok", JSON.stringify(both));
  assert.equal(both.disagreement, null);
  assert.deepEqual(both.stores.map((s) => [s.name, s.status]), [["KV", "ok"], ["Firestore", "ok"]]);
});

test("ATTACK: the database AND KV rebuilt together agree with each other, but Firestore still holds the old hash: rewritten, and the copies' disagreement is its own finding", async () => {
  const mem = await chained(3);
  const kv = memStore("KV"), fsx = memStore("Firestore");
  for (const s of [kv, fsx]) await AC.anchorHead(mem, T, s, "2026-09-14T10:00:00.000Z");
  /* Rebuild row 3 and its link below the application, then rewrite the KV copy to match. */
  mem.audit[2].action = "record.list";
  mem._chain[2].rowHash = await AC.chainHash(mem._chain[2].prevHash, mem.audit[2]);
  assert.equal((await AC.verifyAuditChain(mem, T)).status, "ok", "the chain alone cannot see it");
  kv.map.set(AC.anchorKey(T), JSON.stringify([{ seq: 3, hash: mem._chain[2].rowHash, at: "2026-09-14T10:00:00.000Z" }]));
  assert.equal((await AC.checkAnchors(mem, T, kv)).status, "ok", "KV alone is fooled");

  const r = await AC.checkAnchorStores(mem, T, [kv, fsx]);
  assert.equal(r.status, "rewritten", JSON.stringify(r));
  assert.equal(r.atSeq, 3);
  assert.equal(r.disagreement.seq, 3);
  assert.deepEqual(r.disagreement.copies.map((c) => c.name), ["KV", "Firestore"]);
  assert.match(r.message, /^The outside copies disagree at chained row 3/);
  const d = await AC.anchorDisagreement(T, [kv, fsx]);
  assert.equal(d.seq, 3);

  const health = (await systemHealthReport({ repository: mem, tenantId: T, env: {}, maik: { enabled: false }, anchorStores: [kv, fsx],
    orgProbe: async () => ({}), documentProbe: async () => ({ state: "not_configured" }), lastTick: async () => null, timeoutMs: 1000 })).dependencies.find((x) => x.id === "audit-chain");
  assert.equal(health.status, "down");
  assert.match(health.reason, /disagree at chained row 3/);
  assert.match(health.consequence, /Do not restore or re-import/);
});

test("the tick anchors both chains into both stores; one store failing is named and never stops the other store's copy", async () => {
  reset();
  const mem = await chained(2);
  for (let i = 1; i <= 2; i++) await qAudit({}, { hospitalId: "org-t", actor: "a", action: "member:set" });
  const org = QC.orgAuditChain({}, "org-t");
  const kv = memStore("KV");
  const broken = { name: "Firestore", get: async () => null, put: async () => { throw new Error("down"); } };
  const t = await runTick(mem, T, { anchorStores: [kv, broken], orgAuditChain: org, nowMs: Date.parse("2026-09-14T10:00:00Z") });
  assert.equal(t.anchor.status, "failed", JSON.stringify(t.anchor));
  assert.equal(t.anchor.failedIn, "Firestore, Firestore (event log)");
  assert.equal((await AC.checkAnchors(mem, T, kv)).status, "ok", "KV got the clinical copy");
  assert.equal((await AC.checkAnchors(org, org.chainId, kv)).status, "ok", "KV got the event-log copy");
  const ok = await runTick(mem, T, { anchorStores: [kv, QC.firestoreAnchorStore({})], orgAuditChain: org, nowMs: Date.parse("2026-09-14T11:00:00Z") });
  assert.equal(ok.anchor.status, "ok", JSON.stringify(ok.anchor));
  assert.equal(ok.anchor.stores.length, 4);
});

test("acknowledge across stores: every broken store restarts, an empty store is seeded, ONE chained row; a broken store that fails is named and a retry finishes it", async () => {
  /* KV broken, Firestore never anchored and failing: the acknowledgement lands in KV, the seed failure is named, not fatal. */
  const mem = await chained(3);
  const kv = memStore("KV"), fsx = memStore("Firestore");
  await AC.anchorHead(mem, T, kv, "2026-09-14T10:00:00.000Z");
  for (let i = 4; i <= 5; i++) await mem.auditOnly(T, ev(i));
  await AC.anchorHead(mem, T, kv, "2026-09-14T11:00:00.000Z");
  mem._chain.splice(3);
  assert.equal((await AC.checkAnchorStores(mem, T, [kv, fsx])).status, "truncated");
  const realPut = fsx.put;
  fsx.put = async () => { throw new Error("Firestore down"); };
  const audits = mem.audit.length;
  const seeded = await AC.acknowledgeAnchorBreak(mem, T, [kv, fsx], { by: "owner@x", reason: "Planned point in time restore for the drill", incidentRef: "INC-1", nowIso: "2026-09-14T12:00:00.000Z" });
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  assert.deepEqual([seeded.restarted, seeded.notSeeded], [["KV"], ["Firestore"]]);
  assert.match(seeded.message, /Firestore held no copy and could not be given one now/);
  assert.equal(mem.audit.length, audits + 1, "the acknowledgement was chained once");
  fsx.put = realPut;

  /* Both copies broken together, the usual case after a restore; the second store's replace fails once. */
  const mem2 = await chained(3);
  const a = memStore("KV"), b = memStore("Firestore");
  for (const s of [a, b]) await AC.anchorHead(mem2, T, s, "2026-09-14T10:00:00.000Z");
  mem2._chain.splice(2);
  const bPut = b.put;
  b.put = async (k, v) => { if (k === AC.anchorKey(T)) throw new Error("Firestore down"); return bPut(k, v); };
  const bad = await AC.acknowledgeAnchorBreak(mem2, T, [a, b], { by: "owner@x", reason: "Planned point in time restore for the drill", incidentRef: "INC-2", nowIso: "2026-09-14T12:00:00.000Z" });
  assert.equal(bad.ok, false, JSON.stringify(bad));
  assert.equal(bad.error, "replace_failed");
  assert.deepEqual(bad.restarted, ["KV"]);
  assert.match(bad.message, /^Firestore: /);
  assert.match((await AC.checkAnchors(mem2, T, b)).status, /^(rewritten|truncated)$/, "Firestore still reports the break, never a half move");
  b.put = bPut;
  const before = mem2.audit.length;
  const r = await AC.acknowledgeAnchorBreak(mem2, T, [a, b], { by: "owner@x", reason: "Planned point in time restore for the drill", incidentRef: "INC-2", nowIso: "2026-09-14T12:05:00.000Z" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.restarted, ["Firestore"], "the retry redoes only the store that failed");
  assert.equal(mem2.audit.length, before + 1);
  for (const [s, at] of [[a, "2026-09-14T12:00:00.000Z"], [b, "2026-09-14T12:05:00.000Z"]]) assert.ok(s.map.has(AC.anchorArchiveKey(T, at)), s.name + " kept its archive");
  const after = await AC.checkAnchorStores(mem2, T, [a, b]);
  assert.equal(after.status, "ok", JSON.stringify(after));
  assert.ok(after.acknowledgement && after.acknowledgement.incidentRef === "INC-2");
});

/* ---- the acknowledgement route for the hospital event log -------------------------------------------- */

const DEPUTY = "deputy@example.test";
function kvMap() { const m = new Map(); return { m, kv: { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, String(v)); } } }; }
async function postAs(email, path, body, env) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: "POST", headers, body: JSON.stringify(body || {}) }), env });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("route: POST /api/queue/ward/audit-anchor-acknowledge with chain event-log is owner-only (401, 403, other hospital refused, 422) and restarts the event log's copies in KV and Firestore", async () => {
  seedHospital();
  docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(DEPUTY))}`, { fields: { orgId: ORG_ID, identity: idFor(DEPUTY), role: "admin", active: true }, updateTime: "t1" });
  const { m, kv } = kvMap();
  const env = { ...ENV, MAIK_KV: kv };
  const org = QC.orgAuditChain({}, ORG_ID);
  const fsStore = QC.firestoreAnchorStore({});
  for (let i = 1; i <= 3; i++) await qAudit({}, { hospitalId: ORG_ID, actor: "a", action: "member:set" });
  for (const s of [kv, fsStore]) await AC.anchorHead(org, org.chainId, s, "2026-09-14T10:00:00.000Z");
  /* A restore of Firestore below the application: the newest row and the head move back. */
  const key = QC.chainKey(ORG_ID);
  docs.delete(`q_events/${key}__c3`);
  docs.set(`q_audit_chain_head/${key}`, { fields: { seq: 2, hash: docs.get(`q_events/${key}__c2`).fields.rowHash }, updateTime: "t" + (++clock) });
  assert.equal((await AC.checkAnchorStores(org, org.chainId, [kv, fsStore])).status, "truncated");
  const PATH = "/ward/audit-anchor-acknowledge";
  const GOOD = { orgId: ORG_ID, chain: "event-log", reason: "Planned point in time restore of the org store", incidentRef: "INC-9" };
  const logBefore = m.get(AC.anchorKey(org.chainId));
  const eventsBefore = [...docs.keys()].filter((k) => k.startsWith("q_events/")).length;

  assert.equal((await postAs(null, PATH, GOOD, env)).__status, 401);
  for (const who of [DOCTOR, DEPUTY]) assert.equal((await postAs(who, PATH, GOOD, env)).__status, 403, who);
  const cross = await postAs(OTHER_ADMIN, PATH, GOOD, env);
  assert.ok(cross.__status === 403 || cross.__status === 404, JSON.stringify(cross));
  assert.equal((await postAs(ADMIN, PATH, { ...GOOD, reason: "short" }, env)).__status, 422);
  assert.equal(m.get(AC.anchorKey(org.chainId)), logBefore, "every refused call moved nothing");
  assert.equal([...docs.keys()].filter((k) => k.startsWith("q_events/")).length, eventsBefore, "and wrote no event-log row");

  const ok = await postAs(ADMIN, PATH, GOOD, env);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.restarted, ["KV", "Firestore"]);
  assert.equal(ok.seq, 3, "the acknowledgement itself was chained into the event log at the restored head");
  assert.equal(docs.get(`q_events/${key}__c3`).fields.action, AC.ANCHOR_ACK_ACTION);
  const after = await AC.checkAnchorStores(org, org.chainId, [kv, fsStore]);
  assert.equal(after.status, "ok", JSON.stringify(after));
  assert.match(after.message, /Acknowledged restore by admin@example\.test/);
  assert.equal((await AC.verifyAuditChain(org, org.chainId)).status, "ok");
});

test("screen: copies that disagree are an error naming governance; the event-log acknowledgement form has its own ids", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const dis = win.WSQ._anchorHtml(c, { status: "disagree", atSeq: 3, message: "The outside copies disagree at chained row 3." });
  assert.match(dis, /msg err/);
  assert.match(dis, /Outside copies disagree/);
  assert.match(dis, /information governance lead/);
  assert.match(win.WSQ._anchorHtml(c, { status: "not-verified", message: "x" }), /Outside copy not verified/);
  const org = win.WSQ._anchorHtml(c, { status: "truncated", atSeq: 3, message: "Truncated.", canAcknowledge: true }, "event-log");
  assert.match(org, /id="secAckReasonOrg"/);
  assert.match(org, /id="secAckReviewOrg"/);
  assert.match(org, /of the hospital event log/);
  const clin = win.WSQ._anchorHtml(c, { status: "truncated", atSeq: 3, message: "Truncated.", canAcknowledge: true });
  assert.match(clin, /id="secAckReason"/);
  assert.match(win.WSQ._anchorAckConfirmHtml(c, "r", "INC", "event-log"), /id="secAckGoOrg"/);
  assert.ok(!/[—–]/.test(dis + org + clin), "no em or en dash on screen");
});
