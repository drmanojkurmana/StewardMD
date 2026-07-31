// test/connect/abdm/hip-discovery.test.mjs — Stage-5 Task-6: HIP care-context DISCOVERY.
//
// handleDiscovery is the HIP's exact-match discovery endpoint. It must, in order:
//   (1) RATE-LIMIT per sourceId (fixed-window KV counter) — over-limit => RateLimited, audited, NO lookup;
//   (2) EXACT-IDENTIFIER match ONLY — HMAC the probe ABHA and look up connect_abdm_carecontext by
//       patient_abha_hash EXACT equality (never fuzzy/substring/demographic); a demographic-only probe => miss;
//   (3) audit EVERY probe with metadata ONLY (sourceId, matched bool, count — NEVER a raw ABHA/demographics);
//   (4) return matches on an exact hit, else a CONSTANT-shape { matched:false, careContexts:[] } (existence oracle
//       blunted — a registered-miss and an unregistered patient are byte-identical).
// Uses the REAL hmacPseudonym (a genuine per-tenant HMAC), the abdm mock D1, and the mock KV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleDiscovery, getServableCareContexts, RateLimited } from "../../../functions/_connect/abdm/hip.js";
import { hmacPseudonym, buildAuditEvent, ALLOW } from "../../../functions/_connect/audit.js";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";

const TENANT = "t-hip";
const SALT = Buffer.from("connect-hip-disco-test-hmac-salt").toString("base64");
const NOW = "2026-07-31T00:00:00Z";
const envOf = (over = {}) => ({ CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", CONNECT_HMAC_SALT: SALT, CONNECT_HIP_DISCO_LIMIT: "3", CONNECT_HIP_DISCO_WINDOW_SEC: "60", ...over });
const makeAudit = () => { const events = []; return { fn: async (e) => { events.push(e); }, events }; };

// Seed care-context rows for (tenant, abha) via the REAL per-tenant HMAC (mirrors what linkCareContext persists).
async function seedCc(db, env, tenant, abha, refs) {
  db._tables.connect_abdm_carecontext = db._tables.connect_abdm_carecontext || [];
  const hash = await hmacPseudonym(env, tenant, abha);
  for (const r of refs) {
    db._tables.connect_abdm_carecontext.push({ id: `id-${tenant}-${r}`, tenant_id: tenant, patient_abha_hash: hash, source: "followcare", ref: r, hi_type: "DischargeSummary", display: `Discharge ${r}`, linked_at: NOW });
  }
}

test("exact ABHA match -> matched:true + careContexts, audited (metadata only, no raw ABHA)", async () => {
  const env = envOf();
  const db = makeAbdmDb({});
  await seedCc(db, env, TENANT, "PATIENT-A@sbx", ["cc-A-1", "cc-A-2"]);
  const audit = makeAudit();
  const out = await handleDiscovery(env, { db, kv: makeMockKv(), audit: audit.fn }, {
    probe: { tenantId: TENANT, abhaAddress: "PATIENT-A@sbx" }, sourceId: "hiu-1", now: NOW,
  });
  assert.equal(out.matched, true);
  assert.equal(out.careContexts.length, 2);
  assert.deepEqual(out.careContexts.map((c) => c.referenceNumber).sort(), ["cc-A-1", "cc-A-2"]);
  const ev = audit.events.find((e) => e.action === "hip.discovery");
  assert.ok(ev, "every probe audits hip.discovery");
  assert.equal(ev.scope.matched, true);
  assert.equal(ev.resourceCounts.careContexts, 2);
  assert.equal(JSON.stringify(audit.events).includes("PATIENT-A@sbx"), false, "no raw ABHA in the audit");
});

test("demographic-only probe (NO exact ABHA identifier) -> matched:false constant shape, still audited, NEVER fuzzy", async () => {
  const env = envOf();
  const db = makeAbdmDb({});
  await seedCc(db, env, TENANT, "PATIENT-A@sbx", ["cc-A-1"]);       // a registered patient exists...
  const audit = makeAudit();
  const out = await handleDiscovery(env, { db, kv: makeMockKv(), audit: audit.fn }, {
    probe: { tenantId: TENANT, name: "A", gender: "M", yearOfBirth: "1990" }, sourceId: "hiu-1", now: NOW, // ...but only demographics on the probe
  });
  assert.deepEqual(out, { matched: false, careContexts: [] });      // no exact identifier => never match (no fuzzy/demographic)
  const ev = audit.events.find((e) => e.action === "hip.discovery");
  assert.ok(ev, "a demographic-only probe is STILL audited");
  assert.equal(ev.scope.matched, false);
});

test("over rate-limit -> RateLimited, NO lookup, audited (denied)", async () => {
  const env = envOf({ CONNECT_HIP_DISCO_LIMIT: "2" });               // 2 allowed, the 3rd is refused
  const kv = makeMockKv();
  const audit = makeAudit();
  const probe = { tenantId: TENANT, abhaAddress: "PATIENT-A@sbx" };
  const db = makeAbdmDb({});
  await seedCc(db, env, TENANT, "PATIENT-A@sbx", ["cc-A-1"]);
  await handleDiscovery(env, { db, kv, audit: audit.fn }, { probe, sourceId: "hiu-x", now: NOW });
  await handleDiscovery(env, { db, kv, audit: audit.fn }, { probe, sourceId: "hiu-x", now: NOW });
  // the 3rd probe must throw BEFORE touching the DB — a db that throws on any query proves "NO lookup".
  const noDb = { prepare() { throw new Error("a rate-limited probe must NOT query the DB"); } };
  await assert.rejects(() => handleDiscovery(env, { db: noDb, kv, audit: audit.fn }, { probe, sourceId: "hiu-x", now: NOW }), RateLimited);
  const denied = audit.events.filter((e) => e.action === "hip.discovery" && e.outcome === "denied");
  assert.equal(denied.length, 1, "the refused probe is audited as denied");
  assert.equal(denied[0].scope.reason, "rate-limited");
  assert.equal(JSON.stringify(audit.events).includes("PATIENT-A@sbx"), false, "no raw ABHA in the audit");
});

test("a distinct sourceId has its OWN budget (per-source, not global)", async () => {
  const env = envOf({ CONNECT_HIP_DISCO_LIMIT: "1" });
  const kv = makeMockKv();
  const db = makeAbdmDb({});
  await seedCc(db, env, TENANT, "PATIENT-A@sbx", ["cc-A-1"]);
  const probe = { tenantId: TENANT, abhaAddress: "PATIENT-A@sbx" };
  await handleDiscovery(env, { db, kv, audit: (async () => {}) }, { probe, sourceId: "src-1", now: NOW }); // src-1 uses its 1
  await assert.rejects(() => handleDiscovery(env, { db, kv, audit: (async () => {}) }, { probe, sourceId: "src-1", now: NOW }), RateLimited);
  // src-2 is unaffected — its own window still has budget.
  const ok = await handleDiscovery(env, { db, kv, audit: (async () => {}) }, { probe, sourceId: "src-2", now: NOW });
  assert.equal(ok.matched, true);
});

test("discovery audit carries ONLY allow-listed keys (buildAuditEvent drops the rest); no raw ABHA/demographics", async () => {
  const env = envOf();
  const db = makeAbdmDb({});
  await seedCc(db, env, TENANT, "PATIENT-SECRET@sbx", ["cc-1"]);
  const audit = makeAudit();
  await handleDiscovery(env, { db, kv: makeMockKv(), audit: audit.fn }, {
    probe: { tenantId: TENANT, abhaAddress: "PATIENT-SECRET@sbx", name: "Secret Name" }, sourceId: "hiu-1", now: NOW,
  });
  assert.ok(audit.events.length > 0);
  for (const ev of audit.events) {
    const persisted = buildAuditEvent(ev);                            // the REAL sink path structurally drops non-ALLOW keys
    for (const k of Object.keys(persisted)) assert.ok(ALLOW.includes(k), `non-allow-listed key survived: ${k}`);
    const s = JSON.stringify(persisted);
    assert.equal(s.includes("PATIENT-SECRET@sbx"), false, "no raw ABHA survives into the persisted event");
    assert.equal(s.includes("Secret Name"), false, "no demographic survives into the persisted event");
  }
});

test("two different patients never cross-match (exact HMAC equality, not substring)", async () => {
  const env = envOf();
  const db = makeAbdmDb({});
  await seedCc(db, env, TENANT, "PATIENT-A@sbx", ["cc-A-1"]);
  await seedCc(db, env, TENANT, "PATIENT-B@sbx", ["cc-B-1"]);
  const a = await handleDiscovery(env, { db, kv: makeMockKv(), audit: (async () => {}) }, { probe: { tenantId: TENANT, abhaAddress: "PATIENT-A@sbx" }, sourceId: "h", now: NOW });
  assert.equal(a.matched, true);
  assert.deepEqual(a.careContexts.map((c) => c.referenceNumber), ["cc-A-1"]);   // B's context never leaks in
});

test("unregistered patient -> matched:false, careContexts:[] (constant shape blunts the existence oracle)", async () => {
  const env = envOf();
  const db = makeAbdmDb({});
  await seedCc(db, env, TENANT, "PATIENT-A@sbx", ["cc-A-1"]);
  const registeredMiss = await handleDiscovery(env, { db, kv: makeMockKv(), audit: (async () => {}) }, { probe: { tenantId: TENANT, abhaAddress: "NOBODY@sbx" }, sourceId: "h", now: NOW });
  const emptyDb = makeAbdmDb({});
  const unregistered = await handleDiscovery(env, { db: emptyDb, kv: makeMockKv(), audit: (async () => {}) }, { probe: { tenantId: TENANT, abhaAddress: "NOBODY@sbx" }, sourceId: "h", now: NOW });
  assert.deepEqual(registeredMiss, { matched: false, careContexts: [] });
  assert.deepEqual(unregistered, registeredMiss, "a registered-miss and an unregistered patient are byte-identical");
});

test("getServableCareContexts returns ONLY that tenant+patient's rows (never another tenant's/patient's)", async () => {
  const env = envOf();
  const db = makeAbdmDb({});
  await seedCc(db, env, TENANT, "PATIENT-A@sbx", ["cc-A-1", "cc-A-2"]);
  await seedCc(db, env, TENANT, "PATIENT-B@sbx", ["cc-B-1"]);
  await seedCc(db, env, "t-other", "PATIENT-A@sbx", ["cc-O-1"]);      // SAME ABHA, DIFFERENT tenant
  const rowsA = await getServableCareContexts(db, TENANT, await hmacPseudonym(env, TENANT, "PATIENT-A@sbx"));
  assert.equal(rowsA.length, 2);
  assert.ok(rowsA.every((r) => r.tenant_id === TENANT));
  const rowsOther = await getServableCareContexts(db, "t-other", await hmacPseudonym(env, "t-other", "PATIENT-A@sbx"));
  assert.deepEqual(rowsOther.map((r) => r.ref), ["cc-O-1"]);          // never TENANT's cc-A-*
  // fail-closed: a missing tenant or hash never scans the table.
  assert.deepEqual(await getServableCareContexts(db, null, "h"), []);
  assert.deepEqual(await getServableCareContexts(db, TENANT, null), []);
});

test("flag OFF -> constant { matched:false, careContexts:[] } no-op (no db/kv/audit touched, no oracle)", async () => {
  const env = envOf({ CONNECT_HIP_FLAG: "0" });
  const noDb = { prepare() { throw new Error("flag-off must not query the DB"); } };
  const noKv = { get() { throw new Error("no"); }, put() { throw new Error("no"); } };
  const out = await handleDiscovery(env, { db: noDb, kv: noKv, audit: async () => { throw new Error("no audit when disabled"); } }, {
    probe: { tenantId: TENANT, abhaAddress: "A@sbx" }, sourceId: "h", now: NOW,
  });
  assert.deepEqual(out, { matched: false, careContexts: [] });
});
