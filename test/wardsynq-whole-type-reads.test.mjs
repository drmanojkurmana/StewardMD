import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-whole-type-reads.test.mjs - R4-2 whole-type-reads.
 *
 * Every roster read (service.list) was the OLDEST 1,000 records of a type, and callers asking for more compared against
 * their own number, so a ledger, a return or a worklist past the cap silently left out the newest records. These prove,
 * through the real /api/queue handler, that a stock ledger, the HMIS/NABH returns and the claims worklist count every
 * record past the old caps, that past the new ceiling a ledger refuses (409, nothing written) and a return says the newest
 * were not read, that the escalation timer reaches a new critical result behind 600 old ones, and that no caller in
 * functions/_wardsynq still asks svc.list for more than 1,000.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-whole-type-reads.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});
const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { escalateCriticals } = await import("../functions/_wardsynq/ops-tick.js");

const ORG = "org-wsq", OTHER = "org-other", T = TENANT_ROW.id;
const OWNER = "owner@example.test", PHARM = "pharmacy@example.test", CASHIER = "cashier@example.test", NURSE = "nurse@example.test", OUTSIDER = "outsider@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  const org = (id, owner) => ({ fields: { id, code: "SMD-" + id, name: "Hospital " + id, kind: "clinic", mode: "wardsynq", connectTenantId: T, ownerUid: owner, createdAt: 1, wardsynq: { utcOffsetMinutes: 330 } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG}`, org(ORG, idFor(OWNER)));
  docs.set(`q_orgs/${OTHER}`, org(OTHER, idFor(OUTSIDER)));
  for (const [email, role] of [[PHARM, "pharmacy"], [CASHIER, "cashier"], [NURSE, "nurse"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const NOW = new Date().toISOString();
const meta = { recordedAt: NOW, effectiveAt: NOW, source: { system: "wardsynq-native", sourceId: null } };
/* Written straight to the store in batches, oldest first: the record written last is the newest. */
async function seedMany(rows) { for (let i = 0; i < rows.length; i += 500) await RECORD.append(T, rows.slice(i, i + 500).map((r) => ({ version: 1, meta, ...r })), {}); }
const count = async (type) => { let n = 0, after = 0; for (;;) { const p = await RECORD.pageByType(T, type, { afterSeq: after, limit: 1000 }); n += p.records.length; if (p.next == null) return n; after = p.next; } };
/* A store that answers more than the 50,000 ceiling of one type, one synthetic page of 1,000 at a time. */
function pastCeiling(type, make) {
  const real = RECORD.pageByType.bind(RECORD);
  RECORD.pageByType = async (tenant, t, opts) => {
    if (t !== type) return real(tenant, t, opts);
    const after = Number(opts && opts.afterSeq) || 0, page = after / 1000;
    return { records: Array.from({ length: 1000 }, (_, i) => ({ resourceType: type, id: `syn-${page}-${i}`, version: 1, ...make(i) })), next: page < 60 ? after + 1000 : null };
  };
  return () => { RECORD.pageByType = real; };
}

/* ---- stock ledger ---------------------------------------------------------------------------------- */

const tab = (n) => ({ value: n, unit: "tablet" });
test("stock: 1,200 movements (past the old 1,000 refusal) compute levels and a FEFO pick from the newest receipt; past 50,000 both refuse 409 and a count posts nothing", async () => {
  seedHospital();
  const rows = Array.from({ length: 1199 }, (_, i) => ({ resourceType: "StockMovement", id: `mv-${i}`, kind: "receipt", code: `ITEM${i}`, display: `Item ${i}`, quantity: tab(10), location: "Main", batch: `B${i}`, expiry: "2030-01-01", at: NOW }));
  rows.push({ resourceType: "StockMovement", id: "mv-newest", kind: "receipt", code: "AMOX500", display: "Amoxicillin 500", quantity: tab(30), location: "Main", batch: "NEWEST", expiry: "2030-06-30", at: NOW });
  await seedMany(rows);

  const fefo = await as(PHARM, `/ward/stock-fefo?orgId=${ORG}&code=AMOX500&unit=tablet&quantity=10`);
  assert.equal(fefo.__status, 200, JSON.stringify(fefo).slice(0, 300));
  assert.deepEqual(fefo.picks.map((p) => p.batch), ["NEWEST"], "the receipt written 1,200th is read");
  const levels = await as(PHARM, `/ward/stock?orgId=${ORG}`);
  assert.equal(levels.__status, 200, JSON.stringify(levels).slice(0, 300));
  assert.equal(levels.levels.length, 1200, "every item's level, not the oldest 1,000");
  assert.equal(levels.truncated, undefined);

  const restore = pastCeiling("StockMovement", (i) => ({ kind: "receipt", code: `SYN${i}`, quantity: tab(1), location: "Main", batch: "S", expiry: "2030-01-01" }));
  try {
    const before = await count("StockMovement");
    const f = await as(PHARM, `/ward/stock-fefo?orgId=${ORG}&code=AMOX500&unit=tablet&quantity=10`);
    assert.equal(f.__status, 409); assert.equal(f.error, "too_many_records");
    const l = await as(PHARM, `/ward/stock?orgId=${ORG}`);
    assert.equal(l.__status, 409, "a level from a short read is refused, not shown with a warning");
    const c = await as(PHARM, "/ward/stock-reconcile", "POST", { orgId: ORG, code: "AMOX500", location: "Main", unit: "tablet", counted: 25, reason: "shelf count" });
    assert.equal(c.__status, 409, JSON.stringify(c).slice(0, 300)); assert.equal(c.written, 0);
    restore();
    assert.equal(await count("StockMovement"), 1200, "nothing was posted");
    assert.equal(before > 50000, true);
  } finally { restore(); }
});

test("stock routes: 401 without a session, 403 for a role without dispensing and nothing written, another hospital refused", async () => {
  seedHospital();
  assert.equal((await as(null, `/ward/stock?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(CASHIER, `/ward/stock?orgId=${ORG}`)).__status, 403);
  const w = await as(CASHIER, "/ward/stock-reconcile", "POST", { orgId: ORG, code: "AMOX500", location: "Main", unit: "tablet", counted: 5, reason: "x" });
  assert.equal(w.__status, 403);
  assert.equal(await count("StockMovement"), 0);
  assert.ok([403, 404].includes((await as(PHARM, `/ward/stock-fefo?orgId=${OTHER}&code=A&unit=tablet&quantity=1`)).__status));
});

/* ---- returns ---------------------------------------------------------------------------------------- */

test("HMIS and NABH: 1,300 outpatient visits this month count 1,300 (the old read stopped at 5,000 requested, 1,000 served); past 50,000 the return says the newest were not read", async () => {
  seedHospital();
  await seedMany(Array.from({ length: 1300 }, (_, i) => ({ resourceType: "Encounter", id: `opd-${i}`, patientId: `p-${i}`, class: "OPD", status: "finished", periodStart: NOW })));
  const h = await as(OWNER, `/ward/hmis-monthly?orgId=${ORG}`);
  assert.equal(h.__status, 200, JSON.stringify(h).slice(0, 300));
  assert.equal(h.items.find((i) => i.code === "14.2.1.").value, 1300);
  assert.equal(h.truncated, false);
  const n = await as(OWNER, `/ward/nabh-indicators?orgId=${ORG}&months=1`);
  assert.equal(n.__status, 200); assert.equal(n.truncated, false);

  const restore = pastCeiling("Encounter", () => ({ patientId: "p-syn", class: "OPD", status: "finished", periodStart: "2020-01-01T00:00:00Z" }));
  try {
    const t = await as(OWNER, `/ward/hmis-monthly?orgId=${ORG}`);
    assert.equal(t.__status, 200);
    assert.equal(t.truncated, true);
    assert.match(t.truncatedNote, /not all of them were read/);
    const k = await as(OWNER, `/ward/nabh-indicators?orgId=${ORG}&months=1`);
    assert.equal(k.truncated, true); assert.match(k.truncatedNote, /oldest months of it were not read/);
  } finally { restore(); }
  assert.equal((await as(null, `/ward/hmis-monthly?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(CASHIER, `/ward/hmis-monthly?orgId=${ORG}`)).__status, 403);
  assert.ok([403, 404].includes((await as(OWNER, `/ward/nabh-indicators?orgId=${OTHER}`)).__status));
});

/* ---- claims worklist -------------------------------------------------------------------------------- */

test("claims worklist: 2,500 billed stays and the newest unbilled one; only the unbilled stay is on discharged-not-final-billed (the old read took the oldest 2,000 of each)", async () => {
  seedHospital();
  const ended = new Date(Date.now() - 2 * 86400000).toISOString();
  const stays = Array.from({ length: 2500 }, (_, i) => ({ resourceType: "Encounter", id: `ipd-${i}`, patientId: `p-${i}`, class: "IPD", status: "finished", periodStart: ended, periodEnd: ended }));
  await seedMany(stays);
  await seedMany(stays.map((e, i) => ({ resourceType: "Invoice", id: `inv-${i}`, patientId: e.patientId, encounterId: e.id, lines: [], events: [{ at: ended }] })));
  await seedMany([{ resourceType: "Encounter", id: "ipd-newest", patientId: "p-newest", class: "IPD", status: "finished", periodStart: ended, periodEnd: ended }]);

  const r = await as(CASHIER, `/ward/rcm-worklists?orgId=${ORG}`);
  assert.equal(r.__status, 200, JSON.stringify(r).slice(0, 300));
  assert.equal(r.truncated, false);
  assert.deepEqual(r.dnfb.map((x) => x.encounterId), ["ipd-newest"]);
  assert.equal((await as(null, `/ward/rcm-worklists?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(PHARM, `/ward/rcm-worklists?orgId=${ORG}`)).__status, 403);
  assert.ok([403, 404].includes((await as(CASHIER, `/ward/rcm-worklists?orgId=${OTHER}`)).__status));
});

/* ---- the escalation timer --------------------------------------------------------------------------- */

test("escalation: a critical result opened after 600 closed ones is escalated (the timer read the oldest 500)", async () => {
  seedHospital();
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  await seedMany(Array.from({ length: 600 }, (_, i) => ({ resourceType: "CriticalResultLoop", id: `loop-${i}`, patientId: `p-${i}`, state: "closed", reportedAt: old })));
  await seedMany([{ resourceType: "CriticalResultLoop", id: "loop-new", patientId: "p-new", state: "open", reportedAt: old }]);
  const out = await escalateCriticals(RECORD, T, { nowMs: Date.now() });
  assert.equal(out.checked, 1);
  assert.equal(out.escalated, 1);
  assert.equal(out.partial, false);
  assert.equal((await RECORD.latest(T, "CriticalResultLoop", "loop-new")).escalatedLevel, "escalate");
});

/* ---- the sweep -------------------------------------------------------------------------------------- */

test("no svc.list( in functions/_wardsynq asks for more than 1,000 records (the roster ceiling), by literal or by a module constant", () => {
  const dir = new URL("../functions/_wardsynq/", import.meta.url);
  const over = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    const consts = new Map([...src.matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\b/g)].map((m) => [m[1], Number(m[2])]));
    for (const m of src.matchAll(/\.list\(\s*[^,()]+,\s*([A-Za-z0-9_]+)/g)) {
      const v = /^\d+$/.test(m[1]) ? Number(m[1]) : consts.get(m[1]);
      if (v > 1000) over.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(over, []);
});
