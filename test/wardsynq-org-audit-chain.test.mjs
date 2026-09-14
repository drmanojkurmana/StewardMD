/* test/wardsynq-org-audit-chain.test.mjs - G3: the hospital event log (q_events) hash-chained like the
 * clinical audit trail, verified in GET /api/queue/ward/security-report and GET /api/queue/ward/system-health,
 * and shown on Admin Center > Security review.
 *
 * The Firestore mock HONOURS preconditions (exists, updateTime) and fsBatchGet, because the chain's
 * race guard is a precondition: a mock that ignores them would prove nothing.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-org-audit-chain.test.mjs
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

/* ---- the chain ------------------------------------------------------------------------------------ */

test("qAudit links every row to the one before it, per hospital, and the chain verifies", async () => {
  reset();
  for (let i = 1; i <= 4; i++) await qAudit({}, { hospitalId: H, actor: "staff-" + i, action: "login:pin_ok", meta: "Chrome" });
  await qAudit({}, { hospitalId: "org-else", actor: "x", action: "member:set", meta: "" });
  const rows = events(H).map(([, d]) => d.fields).sort((a, b) => a.chainSeq - b.chainSeq);
  assert.deepEqual(rows.map((r) => r.chainSeq), [1, 2, 3, 4]);
  assert.equal(rows[0].prevHash, AC.genesisHash(rows[0].legacyBoundary), "link 1 names when linking began");
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].prevHash, rows[i - 1].rowHash);
  assert.equal(docs.get("q_audit_chain_head/" + QC.chainKey(H)).fields.seq, 4, "the head doc moved with the rows");

  const chain = QC.orgAuditChain({}, H);
  assert.equal(chain.chainId, "q:" + H);
  const v = await AC.verifyAuditChain(chain, chain.chainId);
  assert.equal(v.status, "ok", JSON.stringify(v));
  assert.equal(v.checked, 4);
  assert.equal((await AC.verifyAuditChain(QC.orgAuditChain({}, "org-else"), "q:org-else")).headSeq, 1, "each hospital has its own chain");
  assert.equal((await AC.verifyAuditChain(QC.orgAuditChain({}, "nobody"), "q:nobody")).status, "empty");
});

test("chainKey is injective: ids that sanitise alike never share a chain", () => {
  assert.notEqual(QC.chainKey("group:a"), QC.chainKey("group-a"));
  assert.notEqual(QC.chainKey("a_b"), QC.chainKey("a-b"));
  assert.equal(QC.chainKey(""), "_none");
  assert.match(QC.chainKey("group:a/b c"), /^[A-Za-z0-9_-]+$/);
});

test("a changed row is broken at that row; a removed row is a gap; a failed read is NOT VERIFIED, never ok", async () => {
  reset();
  for (let i = 1; i <= 4; i++) await qAudit({}, { hospitalId: H, actor: "a" + i, action: "member:set", meta: "m" });
  const chain = QC.orgAuditChain({}, H);
  const third = docs.get(`q_events/${QC.chainKey(H)}__c3`);
  third.fields.actor = "someone-else";
  const b = await AC.verifyAuditChain(chain, chain.chainId);
  assert.equal(b.status, "broken", JSON.stringify(b));
  assert.equal(b.atSeq, 3);
  third.fields.actor = "a3";
  assert.equal((await AC.verifyAuditChain(chain, chain.chainId)).status, "ok");

  docs.delete(`q_events/${QC.chainKey(H)}__c2`);
  const g = await AC.verifyAuditChain(chain, chain.chainId);
  assert.equal(g.status, "gap", JSON.stringify(g));
  assert.equal(g.atSeq, 2);

  hooks.batchGetFails = true;
  const n = await AC.verifyAuditChain(chain, chain.chainId);
  assert.equal(n.status, "not_verified", JSON.stringify(n));
});

test("RACE, forced: another writer extends the chain between our head read and our commit; the create is refused, we retry, the chain stays whole", async () => {
  reset();
  await qAudit({}, { hospitalId: H, actor: "first", action: "member:set" });
  /* The other isolate's commit lands just before ours, taking the number we read. */
  hooks.beforeCommit = async () => {
    const head = docs.get("q_audit_chain_head/" + QC.chainKey(H)).fields;
    const row = { ts: 5, hospitalId: H, ticketId: "", actor: "other-isolate", action: "login:pin_ok", meta: "", chainSeq: head.seq + 1 };
    const rowHash = await AC.chainHash(head.hash, row);
    docs.set(`q_events/${QC.chainKey(H)}__c${head.seq + 1}`, { fields: { ...row, prevHash: head.hash, rowHash }, updateTime: "t" + (++clock) });
    docs.set("q_audit_chain_head/" + QC.chainKey(H), { fields: { seq: head.seq + 1, hash: rowHash }, updateTime: "t" + (++clock) });
  };
  const r = await QC.appendOrgAudit({}, { hospitalId: H, actor: "us", action: "member:set" });
  assert.equal(r.seq, 3, "we took the next number after the race");
  const v = await AC.verifyAuditChain(QC.orgAuditChain({}, H), "q:" + H);
  assert.equal(v.status, "ok", JSON.stringify(v));
  assert.equal(v.headSeq, 3);

  /* Many writers at once in one process never fork the chain. */
  await Promise.all(Array.from({ length: 20 }, (_, i) => qAudit({}, { hospitalId: H, actor: "w" + i, action: "login:pin_ok" })));
  const all = await AC.verifyAuditChain(QC.orgAuditChain({}, H), "q:" + H);
  assert.equal(all.status, "ok", JSON.stringify(all));
  assert.equal(all.headSeq, 23);
});

test("a caller's own guard refusing the commit is handed back unchanged, and nothing is written (hospital group changes)", async () => {
  reset();
  docs.set("q_groups/g1", { fields: { name: "G" }, updateTime: "t-real" });
  await assert.rejects(QC.appendOrgAudit({}, { hospitalId: "group:g1", actor: "u", action: "group:policy" }, [
    { update: { name: "q_groups/g1", fields: { name: "changed" } }, currentDocument: { updateTime: "t-stale" } }]), (e) => e.code === "precondition");
  assert.equal(events("group:g1").length, 0, "no audit row without its change");
  assert.equal(docs.get("q_groups/g1").fields.name, "G", "no change without its audit row");
});

test("a head that no longer names the newest row: qAudit still writes the row, UNLINKED, and the review names it after linking began", async () => {
  reset();
  for (let i = 1; i <= 2; i++) await qAudit({}, { hospitalId: H, actor: "a", action: "member:set" });
  docs.set("q_audit_chain_head/" + QC.chainKey(H), { fields: { seq: 1, hash: docs.get(`q_events/${QC.chainKey(H)}__c1`).fields.rowHash }, updateTime: "t" + (++clock) });
  const w = await QC.writeOrgAudit({}, { hospitalId: H, actor: "b", action: "login:pin_ok" });
  assert.deepEqual(w, { linked: false });
  const rows = events(H).map(([p, d]) => ({ id: p.slice(9), ...d.fields }));
  assert.equal(rows.length, 3, "the event was not lost");
  const start = await QC.orgAuditChain({}, H).chainStart();
  const u = SR.unlinkedRows(rows, start, false);
  assert.equal(u.after, 1, JSON.stringify(u));
  assert.match(u.message, /written after linking began without a link/);
  assert.equal(u.evidence[0].action, "login:pin_ok");
});

test("unlinked rows: before linking began named as the old era, never verified; nothing linked yet says so; a partial scan says so", () => {
  const start = Date.parse("2026-09-14T10:00:00Z");
  const old = { id: "old1", ts: start - 1000, action: "login:pin_ok" };
  const linked = { id: "k__c1", ts: start, action: "member:set", rowHash: "abc" };
  const u = SR.unlinkedRows([old, linked], start, false);
  assert.deepEqual([u.before, u.after, u.unlinked], [1, 0, 1]);
  assert.match(u.message, /before linking began on 2026-09-14\. They are not linked and cannot be checked/);
  assert.ok(!/verified|intact/i.test(u.message));
  const none = SR.unlinkedRows([old], null, true);
  assert.match(none.message, /has been linked yet: all 1 rows read are unlinked/);
  assert.match(none.message, /Only the first 1 rows/);
  assert.match(SR.unlinkedRows([linked], start, false).message, /Every row read carries a link/);
});

/* ---- system health ---------------------------------------------------------------------------------- */

test("system health: the event-log chain line is up only when verified; missing, broken and unreadable are down", async () => {
  const NOW = Date.parse("2026-09-14T12:00:00.000Z");
  const deps = (orgAuditChain) => ({ repository: new MemoryRepository(), tenantId: "t", env: {}, maik: { enabled: false }, rpoMinutes: null, orgAuditChain,
    orgProbe: async () => ({ id: "org" }), documentProbe: async () => ({ state: "not_configured" }), lastTick: async () => null, timeoutMs: 1000, now: () => NOW });
  const line = async (chain) => (await systemHealthReport(deps(chain))).dependencies.find((d) => d.id === "org-audit-chain");
  reset();
  assert.equal((await line(undefined)).status, "down");
  assert.match((await line(undefined)).reason, /Not verified/);
  assert.equal((await line(QC.orgAuditChain({}, H))).status, "up", "nothing linked yet is not a failure");
  for (let i = 1; i <= 3; i++) await qAudit({}, { hospitalId: H, actor: "a", action: "member:set" });
  const ok = await line(QC.orgAuditChain({}, H));
  assert.equal(ok.status, "up", JSON.stringify(ok));
  assert.match(ok.reason, /Intact/);
  docs.get(`q_events/${QC.chainKey(H)}__c2`).fields.meta = "x";
  const broken = await line(QC.orgAuditChain({}, H));
  assert.equal(broken.status, "down");
  assert.match(broken.consequence, /Tell the information governance lead/);
  hooks.batchGetFails = true;
  assert.equal((await line(QC.orgAuditChain({}, H))).status, "down");
});

/* ---- the routes ------------------------------------------------------------------------------------ */

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

test("route NEGATIVE: GET /api/queue/ward/security-report and /api/queue/ward/system-health refuse no session (401), a doctor (403) and another hospital's admin; nothing written", async () => {
  seedHospital();
  await qAudit({}, { hospitalId: ORG_ID, actor: idFor(ADMIN), action: "member:set", meta: "x" });
  const before = orgWrites(), audits = RECORD.audit.length;
  for (const path of [`/ward/security-report?orgId=${ORG_ID}`, `/ward/system-health?orgId=${ORG_ID}`]) {
    assert.equal((await as(null, path)).__status, 401, path);
    const doc = await as(DOCTOR, path);
    assert.equal(doc.__status, 403, path + " " + JSON.stringify(doc));
    assert.equal(doc.auditRetention, undefined);
    assert.equal(doc.dependencies, undefined);
    const other = await as(OTHER_ADMIN, path);
    assert.ok(other.__status === 403 || other.__status === 404, path + " " + JSON.stringify(other));
    assert.equal(other.auditRetention, undefined);
  }
  assert.equal(RECORD.audit.length, audits, "no refused call wrote an audit row");
  assert.equal(orgWrites(), before, "a refused call adds no event-log row and moves no chain head");
});

test("route POSITIVE: the admin sees the event-log chain intact in both, then broken at the changed row, and unlinked rows named", async () => {
  seedHospital();
  const now = Date.now();
  docs.set("q_events/legacy1", { fields: { ts: now - 86400000, hospitalId: ORG_ID, ticketId: "", actor: "old", action: "login:pin_ok", meta: "" }, updateTime: "t1" });
  for (let i = 1; i <= 3; i++) await qAudit({}, { hospitalId: ORG_ID, actor: idFor(ADMIN), action: "member:set", meta: "m" + i });

  const rep = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(rep.__status, 200, JSON.stringify(rep).slice(0, 400));
  assert.equal(rep.auditRetention.orgIntegrity.status, "ok", JSON.stringify(rep.auditRetention.orgIntegrity));
  assert.equal(rep.auditRetention.orgUnlinked.before, 1, JSON.stringify(rep.auditRetention.orgUnlinked));
  assert.equal(rep.auditRetention.orgUnlinked.after, 0);
  await AC.anchorHead(QC.orgAuditChain({}, ORG_ID), "q:" + ORG_ID, QC.firestoreAnchorStore({}), new Date().toISOString());
  let health = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`);
  let line = health.dependencies.find((d) => d.id === "org-audit-chain");
  assert.equal(line.status, "up", JSON.stringify(line));

  docs.get(`q_events/${QC.chainKey(ORG_ID)}__c2`).fields.actor = "cfa:someone-else";
  const bad = await as(ADMIN, `/ward/security-report?orgId=${ORG_ID}`);
  assert.equal(bad.auditRetention.orgIntegrity.status, "broken");
  assert.equal(bad.auditRetention.orgIntegrity.atSeq, 2);
  health = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`);
  line = health.dependencies.find((d) => d.id === "org-audit-chain");
  assert.equal(line.status, "down");
  assert.match(line.reason, /Broken at chained row 2/);
});

/* ---- the screen -------------------------------------------------------------------------------------- */

test("screen: the event-log block never reads intact when unverified; unlinked rows after linking began are an error with the rows", () => {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const ls = { getItem: () => null, setItem() {}, removeItem() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "" }, ls);
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc };
  const base = { days: 7, note: "n", counts: {}, notDetected: [], reviewQueue: { status: "ok", items: [], missing: [] }, dataProtection: { status: "unavailable" } };
  const page = win.WSQ._securityReviewHtml(c, { ...base, auditRetention: { status: "ok", configuredNote: "x", integrity: { status: "ok", message: "Intact: all 3 chained rows checked." } } });
  assert.match(page, /Tamper evidence: hospital event log/);
  assert.match(page, /Not verified: no integrity result was returned/, "a report without the event-log result is not intact");
  assert.match(page, /Unlinked rows not counted/);

  const u = win.WSQ._orgUnlinkedHtml;
  const late = u(c, { status: "ok", after: 2, unlinked: 2, message: "2 rows were written after linking began without a link.", evidence: [{ id: "q-row-9", ts: "2026-09-14T10:00:00Z", actor: "x", action: "login:pin_ok" }] });
  assert.match(late, /msg err/);
  assert.match(late, /Rows without a link/);
  assert.match(late, /q-row-9/);
  assert.match(late, /Showing 1 of 2 rows/);
  assert.match(u(c, { status: "ok", after: 0, unlinked: 5, before: 5, message: "5 rows were written before linking began." }), /msg note/);
  assert.match(u(c, { status: "ok", after: 0, unlinked: 0, message: "Every row read carries a link." }), /msg ok/);
  assert.match(u(c, { status: "unavailable", message: "The hospital event log could not be read." }), /not the same as every row being linked/);
  assert.ok(!/[—–]/.test(page + late), "no em or en dash on screen");
});
