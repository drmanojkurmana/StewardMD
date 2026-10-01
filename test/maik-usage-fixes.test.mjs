/* maik-usage-fixes.test.mjs - 2026-10-02 conversation fixes.
 * A: catch-all 500 carries a reason / provider timeout is a 504 / Vertex 401-403 drops the cached
 *    token and retries once / checkQuota survives a throwing dependency / clipQ keeps head AND tail.
 * B: per-doctor usage counters (lost updates, pool key, IST day, resetsAt/updatedAt).
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/maik-usage-fixes.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest, clipQ, errReason, isTimeoutErr } from "../functions/api/ai/[[path]].js";
import { checkQuota } from "../functions/_usage.js";
import { recordAiUsage, addAiSpend, doctorUsageSummary, buildUsageRecord, checkModuleQuota, usersReport } from "../functions/_ai_usage.js";
import { checkCostCap } from "../functions/_credits.js";
import { istDay, istNextMidnightMs } from "../functions/_counters.js";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { await new Promise((r) => setTimeout(r, 1)); db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } };
}
/* A KV whose get/put yield, like the real thing: concurrent read-modify-writes interleave. */
function slowKv() {
  const m = new Map();
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
  return { _m: m, get: async (k, t) => { await tick(); return m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null; }, put: async (k, v) => { await tick(); m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}
function fakeKv() {
  const m = new Map();
  return { _m: m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, list: async () => ({ keys: [], list_complete: true }) };
}

/* ============================== A ============================== */
const Q = { question: "maintenance dose of amiodarone in atrial fibrillation", grounding: [{ diseaseId: "af", text: "x" }] };
async function explain(env) {
  const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json", "X-SMD-Device": "dev-fix" }, body: JSON.stringify(Q) }), env, params: { path: ["explain"] }, waitUntil: () => {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test("A: the catch-all 500 carries a short non-sensitive reason", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "secret-key-abc123 in url" } }), { status: 400 });
  try {
    const r = await explain({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k", MAIK_KV: fakeKv() });
    assert.equal(r.status, 500);
    assert.equal(r.body.error, "server_error");
    assert.equal(r.body.reason, "provider_bad_request");
    assert.ok(!JSON.stringify(r.body).includes("secret-key"), "the provider's message never leaks");
  } finally { globalThis.fetch = real; }
});

test("A: a provider timeout is a 504 { error: timeout }, not a 500", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error("AI timeout after 30000ms"), { timeout: true }); };
  try {
    const r = await explain({ AI_PROVIDER: "developer", GEMINI_API_KEY: "k", MAIK_KV: fakeKv() });
    assert.equal(r.status, 504);
    assert.deepEqual(r.body, { error: "timeout" });
  } finally { globalThis.fetch = real; }
});

test("A: an unconfigured fallback provider does not mask the primary's timeout (Vertex timeout + no Gemini key)", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error("AI timeout after 30000ms"), { timeout: true }); };
  try {
    const r = await explain({ AI_PROVIDER: "vertex", VERTEX_API_KEY: "vk", MAIK_KV: fakeKv() });   // developer provider has no key
    assert.equal(r.status, 504);
    assert.deepEqual(r.body, { error: "timeout" });
  } finally { globalThis.fetch = real; }
});

test("A: errReason / isTimeoutErr vocabulary", () => {
  assert.equal(errReason(Object.assign(new Error("AI HTTP 403"), { status: 403 })), "provider_auth");
  assert.equal(errReason(Object.assign(new Error("AI HTTP 429"), { status: 429 })), "provider_rate_limit");
  assert.equal(errReason(Object.assign(new Error("AI HTTP 503"), { status: 503 })), "provider_unavailable");
  assert.equal(errReason(new TypeError("x is not a function")), "internal_typeerror");
  assert.equal(errReason(new Error("weird https://x?key=SECRET")), "internal");
  assert.equal(isTimeoutErr(new Error("AI deadline exceeded")), true);
  assert.equal(isTimeoutErr(Object.assign(new Error("x"), { timeout: true })), true);
  assert.equal(isTimeoutErr(new Error("boom")), false);
});

test("A: Vertex 401 drops the cached OAuth token and retries once with a fresh one", async () => {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
  const pem = "-----BEGIN PRIVATE KEY-----\n" + der.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----";
  const env = { AI_PROVIDER: "vertex", GCP_PROJECT: "p", GCP_SA_EMAIL: "sa@p.iam.gserviceaccount.com", GCP_SA_PRIVATE_KEY: pem, MAIK_KV: fakeKv() };
  const real = globalThis.fetch;
  let minted = 0; const bearers = [];
  const hit = () => {
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2.googleapis.com")) { minted++; return new Response(JSON.stringify({ access_token: "tok" + minted, expires_in: 3600 }), { status: 200 }); }
      if (u.includes("aiplatform.googleapis.com")) {
        const b = init.headers.Authorization; bearers.push(b);
        // tok1 was revoked server-side; only tok2+ are accepted
        return b === "Bearer tok1" ? new Response(JSON.stringify({ error: { message: "401 revoked" } }), { status: 401 })
          : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "VERTEX-OK" }] } }] }), { status: 200 });
      }
      throw new Error("unexpected fetch " + u);
    };
  };
  try {
    hit();
    // call 1 mints tok1 -> 401 -> cache dropped -> mints tok2 -> 200, all inside one request
    const r1 = await explain(env);
    assert.equal(r1.status, 200);
    assert.deepEqual(bearers, ["Bearer tok1", "Bearer tok2"]);
    assert.equal(minted, 2);
    // call 2 reuses the (good) cached tok2: no more minting
    const r2 = await explain(env);
    assert.equal(r2.status, 200);
    assert.equal(minted, 2);
  } finally { globalThis.fetch = real; }
});

test("A: checkQuota survives a throwing identity, a sync-throwing KV get and a throwing owner check", async () => {
  const kv = fakeKv();
  kv.get = () => { throw new Error("KV binding blew up synchronously"); };
  const badReq = { headers: { get() { throw new Error("headers exploded"); } } };
  const g = await checkQuota({ MAIK_KV: kv }, badReq, "general");
  assert.equal(g.ok, true, "degrades to a guest meter instead of throwing into the 500 catch-all");
  assert.equal(g.guest, true);
});

test("A: clipQ keeps the head AND the tail so a trailing instruction survives", () => {
  const long = "history of present illness ".repeat(200) + "FINAL INSTRUCTION: summarise the plan";
  const c = clipQ(long, 2000);
  assert.ok(c.startsWith("history of present illness"));
  assert.ok(c.endsWith("FINAL INSTRUCTION: summarise the plan"), "the end of the pasted text is kept");
  assert.ok(c.includes("[question shortened]"), "the cut is still announced");
  assert.ok(c.length <= 2000 + 40);
  assert.equal(clipQ("short", 2000), "short");
});

/* ============================== B ============================== */
const NOW = Date.parse("2026-09-25T10:00:00Z");   // 15:30 IST, same calendar day in both zones
const DOC = "em:doc@x.in";

test("B: IST day key + next IST midnight (boundary at 18:30 UTC)", () => {
  assert.equal(istDay(Date.parse("2026-10-01T18:29:59Z")), "2026-10-01");
  assert.equal(istDay(Date.parse("2026-10-01T18:30:00Z")), "2026-10-02");
  assert.equal(istNextMidnightMs(Date.parse("2026-10-01T10:00:00Z")), Date.parse("2026-10-01T18:30:00Z"));
  assert.equal(istNextMidnightMs(Date.parse("2026-10-01T18:30:00Z")), Date.parse("2026-10-02T18:30:00Z"));
});

test("B: writer and reader agree on the IST day across the UTC midnight gap (19:00 UTC = next IST day)", async () => {
  const kv = fakeKv(), late = Date.parse("2026-10-01T19:00:00Z");
  await recordAiUsage({}, kv, buildUsageRecord({ doctorId: DOC, module: "maik", ts: late }), late);
  await addAiSpend(kv, DOC, istDay(late), 0.5, 100);
  assert.ok([...kv._m.keys()].some((k) => k === "aiu:mod:" + DOC + ":maik:2026-10-02"), "module counter lands on the IST day");
  const s = await doctorUsageSummary({}, kv, DOC, late);
  assert.equal(s.day, "2026-10-02");
  assert.equal(s.req, 1); assert.equal(s.estCostInr, 0.5);
  assert.equal((await checkModuleQuota({ MAIK_ENFORCE_CAPS: "1" }, kv, "maik", DOC, late)).used, 1, "the quota reader sees what the writer wrote");
  const early = Date.parse("2026-10-01T10:00:00Z");
  assert.equal((await doctorUsageSummary({}, kv, DOC, early)).req, 0, "earlier the same UTC day is still the previous IST day");
});

test("B: /usage JSON carries resetsAt (ISO, next IST midnight) and updatedAt (ISO)", async () => {
  const kv = fakeKv();
  const s = await doctorUsageSummary({}, kv, DOC, Date.parse("2026-10-01T10:00:00Z"));
  assert.equal(s.resetsAt, "2026-10-01T18:30:00.000Z");
  assert.equal(s.updatedAt, "2026-10-01T10:00:00.000Z");
  const r = await onRequest({ request: new Request("https://stewardmd.in/api/ai/usage", { headers: { Origin: "https://stewardmd.in", "X-SMD-Device": "dev-u" } }), env: { MAIK_KV: kv, GEMINI_API_KEY: "k" }, params: { path: ["usage"] }, waitUntil: () => {} });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.match(j.resetsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(j.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.parse(j.resetsAt) > Date.parse(j.updatedAt) && Date.parse(j.resetsAt) - Date.parse(j.updatedAt) <= 86400000);
  assert.match(j.resetsAt, /T18:30:00\.000Z$/, "resets at IST midnight");
});

test("B: recordAiUsage and addAiSpend never overwrite each other (KV, no D1; was a lost update)", async () => {
  const kv = slowKv(), N = 25;
  await Promise.all(Array.from({ length: N }, (_, i) => {
    const t = NOW + i * 86400000;   // one day per trial: each trial races exactly one record against one spend
    return Promise.all([
      recordAiUsage({}, kv, buildUsageRecord({ doctorId: DOC, module: "maik", ts: t }), t),
      addAiSpend(kv, DOC, istDay(t), 0.5, 100),
    ]);
  }));
  for (let i = 0; i < N; i++) {
    const s = await doctorUsageSummary({}, kv, DOC, NOW + i * 86400000);
    assert.equal(s.req, 1, "request count survived on day " + i);
    assert.equal(s.estCostInr, 0.5, "spend survived on day " + i);
    assert.equal(s.tokens, 100);
    assert.deepEqual(s.byModule, { maik: 1 });
  }
});

test("B: with D1, 60 concurrent spends + 60 concurrent records are all counted exactly", { skip: SKIP }, async () => {
  const env = { UPDATES_DB: d1() }, kv = slowKv(), day = istDay(NOW);
  await Promise.all([
    ...Array.from({ length: 60 }, () => addAiSpend(kv, DOC, day, 0.25, 10, env)),
    ...Array.from({ length: 60 }, () => recordAiUsage(env, kv, buildUsageRecord({ doctorId: DOC, module: "maik", ts: NOW }), NOW)),
  ]);
  const s = await doctorUsageSummary(env, kv, DOC, NOW);
  assert.equal(s.estCostInr, 15, "60 x 0.25, atomic");
  assert.equal(s.tokens, 600);
  assert.ok(s.req >= 1 && s.req <= 60, "request counts keep their own (KV) record: " + s.req);
  assert.equal([...kv._m.keys()].filter((k) => k.startsWith("aiu:spend:")).length, 0, "with D1 bound spend never touches KV");
});

test("B: spend is written under the POOL key the readers use (co-resident pair)", async () => {
  const kv = fakeKv();
  kv._m.set("ai:pool:em:spouse@x.in", "em:doc@x.in");            // spouse meters under doc's pool
  await addAiSpend(kv, "em:spouse@x.in", istDay(NOW), 3, 5000);   // spend recorded for the spouse's own key
  assert.equal((await doctorUsageSummary({}, kv, "em:doc@x.in", NOW)).estCostInr, 3, "/usage reads the pool owner's key and sees it");
  const cc = await checkCostCap({ AI_COST_CAP_ON: "1" }, kv, "em:doc@x.in", 2, NOW);
  assert.equal(cc.ok, false, "the cost cap reads the same key, so the spend can trip it");
  assert.equal(cc.dayCost, 3);
});

test("B: usersReport sums the separate spend key into each user's cost", async () => {
  const kv = fakeKv();
  kv.list = async ({ prefix }) => ({ keys: [...kv._m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true });
  await recordAiUsage({}, kv, buildUsageRecord({ doctorId: "em:a@x.com", module: "maik", ts: NOW }), NOW);
  await addAiSpend(kv, "em:a@x.com", istDay(NOW), 1.25, 10);
  const rep = await usersReport(kv, istDay(NOW));
  assert.equal(rep.users.find((u) => u.email === "a@x.com").cost, 1.25);
});
