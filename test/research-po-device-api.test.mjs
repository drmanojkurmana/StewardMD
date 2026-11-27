import "./helpers/json-import-attr.mjs";
/* ResearchMD PaperOrchestra on-device drafting server API tests (node:test, no network).
 * Mirrors test/research-po-job.test.mjs and test/research-phase3-api.test.mjs fakes.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-po-device-api.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
  "tok-bob": { sub: "u-bob", email: "bob@example.com", email_verified: true },
  "tok-eve": { sub: "u-eve", email: "eve@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifyFirebaseClaims: async (token) => CLAIMS[token] || null,
    verifiedClaimsFor: async (request) => CLAIMS[((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""))] || null,
  },
});

let geminiCalls = 0;
let geminiImpl = async (_env, _parts, _maxOut, opts) => {
  geminiCalls++;
  if (opts && opts.meta) {
    opts.meta.model = "gemini-3.5-flash";
    opts.meta.usage = { promptTokenCount: 120, candidatesTokenCount: 60 };
  }
  return "mock step answer";
};
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: { callGemini: (...args) => geminiImpl(...args) },
});
mock.module("../functions/api/billing/[[path]].js", {
  namedExports: {
    onRequest: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    plans: () => ({ tokens: {} }),
    fulfilPurchase: async () => ({ ok: true }),
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { mintJobToken } = await import("../functions/api/research/_gateway.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const SECRET = "test-secret";

function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return {
    _db: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec("BEGIN"); try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; },
  };
}
function r2Shim() {
  const objects = new Map();
  return {
    _objects: objects,
    async put(key, value) { objects.set(key, typeof value === "string" ? value : new TextDecoder().decode(value)); },
    async get(key) {
      if (!objects.has(key)) return null;
      const text = objects.get(key);
      return { text: async () => text, json: async () => JSON.parse(text), body: text };
    },
    async delete(key) { objects.delete(key); },
    async head(key) { return objects.has(key) ? { key } : null; },
  };
}
function queueShim() {
  return { _messages: [], async send(m) { this._messages.push(m); } };
}
function kvShim() {
  const m = new Map();
  return {
    _m: m,
    async get(key, type) { const v = m.get(key); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
  };
}
function freshEnv(opts = {}) {
  const D = d1();
  D._db.exec(SCHEMA);
  const env = {
    RESEARCH_MODE: "pilot",
    RESEARCH_PO_ENABLED: "1",
    RESEARCH_DB: D,
    RESEARCH_R2: r2Shim(),
    RESEARCH_QUEUE: opts.queue === false ? undefined : queueShim(),
    RESEARCH_ADMIN_TOKEN: "admin-test-token",
    RESEARCH_CALLBACK_SECRET: SECRET,
    MAIK_KV: kvShim(),
  };
  return env;
}
function fundWallet(env, email, inr) {
  env.MAIK_KV._m.set("maik:credit:em:" + email, JSON.stringify({ balance: inr, day: "", chargedToday: 0 }));
}
async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const req = new Request("https://stewardmd.in/api/research/" + path,
    { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
async function llmCall(env, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://stewardmd.in/api/research/v1/internal/llm",
    { method: "POST", headers, body: JSON.stringify(body) });
  const res = await onRequest({ request: req, env, params: { path: ["v1", "internal", "llm"] } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
async function setupSystematicReview(env, { lockHash = "a".repeat(64) } = {}) {
  fundWallet(env, "alice@example.com", 500);
  const p = (await call(env, "POST", "v1/projects", "tok-alice", {
    title: "Intervention X for outcome Y",
    studyType: "systematic_review",
    researchQuestion: "Does X reduce Y in adults?",
  })).project;
  const now = Date.now();
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_protocols (id,project_id,version,status,content_json,lock_hash,locked_at,created_by,created_ts) VALUES ('prot_1',?,1,'locked',?,?,?,'u-alice',?)")
    .run(p.id, JSON.stringify({ pico: { population: "adults", intervention: "X", comparison: "placebo", outcome: "Y" } }), lockHash, now, now);
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_runs (id,project_id,measure,model,result_json,engine,engine_version,created_by,created_ts) VALUES ('r1',?,'OR','random_dl',?,'research-engine','rmd1','u-alice',?)")
    .run(p.id, JSON.stringify({ estimate: 0.62, ciLower: 0.41, ciUpper: 0.93, p: 0.02, k: 12, i2: 35.2 }), now);
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_records (id,project_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES ('ref1',?,'pubmed','11111111','Trial One report',?,2019,'10.1000/trial1',?,?)")
    .run(p.id, JSON.stringify(["Smith J", "Doe A"]), JSON.stringify({ venue: "Journal of Examples", volume: "10", pages: "1-9" }), now);
  return { p, lockHash };
}

function validManuscript(lockHash = "a".repeat(64)) {
  return {
    v: 1,
    title: "Intervention X for outcome Y",
    sections: [
      { id: "abstract", heading: "Abstract", level: 1, text: "Pooled OR {{run:r1.estimate}} (95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}; p {{run:r1.p}})." },
      { id: "introduction", heading: "Introduction", level: 1, text: "Outcome Y is common \\cite{ref1}." },
      { id: "methods", heading: "Methods", level: 1, text: "Two reviewers screened 12 trials." },
      { id: "results", heading: "Results", level: 1, text: "Intervention X significantly reduced Y (OR {{run:r1.estimate}}, 95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}})." },
      { id: "discussion", heading: "Discussion", level: 1, text: "Findings support X \\cite{ref1}." },
    ],
    references: [
      { number: 1, key: "ref1", citation: "1. Smith J, Doe A. Trial One report. Journal of Examples. 2019;10:1-9. doi:10.1000/trial1. PMID:11111111.", doi: "10.1000/trial1", pmid: "11111111", resolved: true },
    ],
    tokens: {
      "r1.estimate": { value: 0.62, null: 1, measure: "OR", runId: "r1" },
      "r1.ciLower": { value: 0.41, null: 1, measure: "OR", runId: "r1" },
      "r1.ciUpper": { value: 0.93, null: 1, measure: "OR", runId: "r1" },
      "r1.p": { value: 0.02, null: 1, measure: "OR", runId: "r1" },
    },
    provenance: {
      protocolHash: lockHash,
      runIds: ["r1"],
      engines: ["research-engine:rmd1"],
      generatedBy: "po_adapter",
      upstreamCommit: "d9bae997e793a015ed38bb1605be9eb58c00284f",
    },
    outline: { section_plan: [] },
  };
}

test("device job creation skips queue (even when RESEARCH_QUEUE absent), stores runner:device, returns manifest + valid token", { skip: SKIP }, async () => {
  const env = freshEnv({ queue: false });
  const { p, lockHash } = await setupSystematicReview(env);

  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
    kind: "manuscript_draft",
    idempotencyKey: "dev-1",
    runner: "device",
    cutoffDate: "2025-11",
  });
  assert.equal(r.http, 202, JSON.stringify(r));
  assert.equal(r.job.kind, "manuscript_draft");
  assert.equal(r.job.status, "queued");
  assert.equal(r.job.runner, "device");
  assert.ok(r.manifest && r.manifest.v === 1, "manifest returned");
  assert.equal(r.manifest.protocol.lockHash, lockHash);
  assert.equal(r.manifest.runs.length, 1);
  assert.ok(typeof r.token === "string" && r.token.startsWith(r.job.id + "."), "per-job token returned");
  assert.ok(r.tokenExpiresAt > Math.floor(Date.now() / 1000));

  const row = env.RESEARCH_DB._db.prepare("SELECT * FROM research_job_runs WHERE id=?").get(r.job.id);
  const out = JSON.parse(row.output_json);
  assert.equal(out.runner, "device");
  assert.equal(out.cutoffDate, "2025-11");

  /* Minted token works against /v1/internal/llm. */
  geminiCalls = 0;
  const llm = await llmCall(env, {
    jobId: r.job.id, projectId: p.id, userId: "u-alice",
    tier: "T2", model: "researchmd-writer", prompt: "Write outline", purpose: "write",
  }, r.token);
  assert.equal(llm.http, 200, JSON.stringify(llm));
  assert.equal(geminiCalls, 1);

  /* Idempotent replay returns same job + manifest + fresh token without charging again. */
  const replay = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
    kind: "manuscript_draft", idempotencyKey: "dev-1", runner: "device",
  });
  assert.equal(replay.http, 200, JSON.stringify(replay));
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.job.id, r.job.id);
  assert.ok(replay.manifest && replay.token);
});

test("POST /v1/jobs/:jobId/token: owner only, active device job only, rate-limited to 1 per 60s", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p } = await setupSystematicReview(env);
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "editor" });

  const dev = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
    kind: "manuscript_draft", idempotencyKey: "dev-tok", runner: "device",
  });
  assert.equal(dev.http, 202);

  /* Outsider -> 404; non-creator project editor -> 403. */
  assert.equal((await call(env, "POST", "v1/jobs/" + dev.job.id + "/token", "tok-eve")).http, 404);
  const bob = await call(env, "POST", "v1/jobs/" + dev.job.id + "/token", "tok-bob");
  assert.equal(bob.http, 403);

  /* Owner refresh succeeds once, then 429 within 60s. */
  const t1 = await call(env, "POST", "v1/jobs/" + dev.job.id + "/token", "tok-alice");
  assert.equal(t1.http, 200, JSON.stringify(t1));
  assert.ok(typeof t1.token === "string" && t1.token.startsWith(dev.job.id + "."));

  const t2 = await call(env, "POST", "v1/jobs/" + dev.job.id + "/token", "tok-alice");
  assert.equal(t2.http, 429);
  assert.equal(t2.error.code, "rate_limited");

  /* Rewind lastTokenTs by 61s -> refresh allowed again. */
  const row = env.RESEARCH_DB._db.prepare("SELECT output_json FROM research_job_runs WHERE id=?").get(dev.job.id);
  const out = JSON.parse(row.output_json);
  out.lastTokenTs = Date.now() - 61000;
  env.RESEARCH_DB._db.prepare("UPDATE research_job_runs SET output_json=? WHERE id=?").run(JSON.stringify(out), dev.job.id);
  const t3 = await call(env, "POST", "v1/jobs/" + dev.job.id + "/token", "tok-alice");
  assert.equal(t3.http, 200);

  /* Settled job -> 409. */
  env.RESEARCH_DB._db.prepare("UPDATE research_job_runs SET status='succeeded' WHERE id=?").run(dev.job.id);
  assert.equal((await call(env, "POST", "v1/jobs/" + dev.job.id + "/token", "tok-alice")).http, 409);

  /* Cloud job -> 409 not_device_job. */
  const cloud = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
    kind: "manuscript_draft", idempotencyKey: "cloud-tok",
  });
  assert.equal(cloud.http, 202);
  const cloudTok = await call(env, "POST", "v1/jobs/" + cloud.job.id + "/token", "tok-alice");
  assert.equal(cloudTok.http, 409);
  assert.equal(cloudTok.error.code, "not_device_job");
});

test("gateway stepId cache: hit returns cached:true and charges nothing; miss runs PHI gate first", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p } = await setupSystematicReview(env);
  const dev = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
    kind: "manuscript_draft", idempotencyKey: "dev-cache", runner: "device",
  });
  const token = dev.token;

  /* Invalid stepId rejected 400. */
  const badStep = await llmCall(env, {
    jobId: dev.job.id, projectId: p.id, userId: "u-alice",
    tier: "T2", prompt: "hello", stepId: "Bad/Step!",
  }, token);
  assert.equal(badStep.http, 400);

  /* Non-cached path runs PHI gate BEFORE provider call. */
  geminiCalls = 0;
  const phiHit = await llmCall(env, {
    jobId: dev.job.id, projectId: p.id, userId: "u-alice",
    tier: "T2", prompt: "Patient Ramesh Kumar, MRN 483920", stepId: "outline",
  }, token);
  assert.equal(phiHit.http, 422);
  assert.equal(phiHit.error.code, "phi_blocked");
  assert.equal(geminiCalls, 0);

  /* First clean call -> provider runs, logs usage, debits wallet, caches in D1. */
  const balBefore = JSON.parse(env.MAIK_KV._m.get("maik:credit:em:alice@example.com")).balance;
  const r1 = await llmCall(env, {
    jobId: dev.job.id, projectId: p.id, userId: "u-alice",
    tier: "T2", prompt: "Draft outline", stepId: "outline",
  }, token);
  assert.equal(r1.http, 200, JSON.stringify(r1));
  assert.equal(r1.text, "mock step answer");
  assert.equal(r1.cached, undefined);
  assert.equal(geminiCalls, 1);
  const balAfterFirst = JSON.parse(env.MAIK_KV._m.get("maik:credit:em:alice@example.com")).balance;
  assert.ok(balAfterFirst < balBefore, "first call debited wallet");
  const usageRows1 = env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_ai_usage WHERE job_id=?").get(dev.job.id).n;
  assert.equal(usageRows1, 1);

  /* Second call with same (jobId, stepId) -> cached:true, 0 provider calls, 0 new debit, 0 new usage rows. */
  const r2 = await llmCall(env, {
    jobId: dev.job.id, projectId: p.id, userId: "u-alice",
    tier: "T2", prompt: "Draft outline", stepId: "outline",
  }, token);
  assert.equal(r2.http, 200, JSON.stringify(r2));
  assert.equal(r2.cached, true);
  assert.equal(r2.text, "mock step answer");
  assert.deepEqual(r2.usage, { inputTokens: 120, outputTokens: 60 });
  assert.equal(geminiCalls, 1, "provider not called on cache hit");
  const balAfterCache = JSON.parse(env.MAIK_KV._m.get("maik:credit:em:alice@example.com")).balance;
  assert.equal(balAfterCache, balAfterFirst, "wallet not debited on cache hit");
  const usageRows2 = env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_ai_usage WHERE job_id=?").get(dev.job.id).n;
  assert.equal(usageRows2, 1, "no duplicate ai_usage row on cache hit");
});

test("device-result: happy path writes R2, releases initial reserve, ingests version; gate failure rejected", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p, lockHash } = await setupSystematicReview(env);
  const dev = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
    kind: "manuscript_draft", idempotencyKey: "dev-res", runner: "device",
  });
  assert.equal(dev.http, 202);

  /* Gate failure (bare number in Results) -> 422 gate_failed, job remains queued/running, no version. */
  const badMan = validManuscript(lockHash);
  badMan.sections[3].text = "Intervention X reduced Y with OR 0.62.";
  const gateBad = await call(env, "POST", "v1/jobs/" + dev.job.id + "/device-result", "tok-alice", {
    manuscript: badMan,
    usage: { calls: 4, inputTokens: 400, outputTokens: 200, seconds: 5.2 },
  });
  assert.equal(gateBad.http, 422, JSON.stringify(gateBad));
  assert.equal(gateBad.error.code, "gate_failed");
  assert.equal(gateBad.gatesPassed, false);
  assert.ok(Array.isArray(gateBad.gateFailures) && gateBad.gateFailures.length > 0);
  assert.equal(env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_manuscript_versions WHERE project_id=?").get(p.id).n, 0);

  /* Happy path -> 200, writes result.json, releases initial reserve, ingests version 1. */
  const okRes = await call(env, "POST", "v1/jobs/" + dev.job.id + "/device-result", "tok-alice", {
    manuscript: validManuscript(lockHash),
    usage: { calls: 6, inputTokens: 800, outputTokens: 500, seconds: 8.4 },
  });
  assert.equal(okRes.http, 200, JSON.stringify(okRes));
  assert.equal(okRes.job.status, "succeeded");
  const expectedKey = "projects/" + p.id + "/jobs/" + dev.job.id + "/result.json";
  assert.equal(okRes.job.resultR2Key, expectedKey);
  assert.ok(env.RESEARCH_R2._objects.has(expectedKey));
  assert.ok(okRes.versionId);

  const ledger = env.RESEARCH_DB._db.prepare("SELECT reason, delta FROM research_credit_ledger WHERE job_id=? ORDER BY rowid ASC").all(dev.job.id);
  assert.deepEqual(ledger.map((x) => x.reason), ["reserve", "release"]);
  assert.equal(ledger[0].delta + ledger[1].delta, 0);

  const man = await call(env, "GET", "v1/projects/" + p.id + "/manuscript", "tok-alice");
  assert.equal(man.http, 200);
  assert.equal(man.manuscript.version, 1);
  assert.equal(man.manuscript.sections.length, 5);
});

test("device-fail marks failed, releases reserve, and device_failed does not count toward daily cap", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p } = await setupSystematicReview(env);

  /* Fail 4 device jobs with device_failed -> none should count toward the 3/project daily cap. */
  for (let i = 0; i < 4; i++) {
    const dev = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
      kind: "manuscript_draft", idempotencyKey: "df-" + i, runner: "device",
    });
    assert.equal(dev.http, 202, "job " + i + " allowed after prior device_failed");
    const fail = await call(env, "POST", "v1/jobs/" + dev.job.id + "/device-fail", "tok-alice", {
      code: "device_failed", step: "section:methods",
    });
    assert.equal(fail.http, 200, JSON.stringify(fail));
    assert.equal(fail.job.status, "failed");
    assert.equal(fail.job.errorCode, "device_failed");
    const ledger = env.RESEARCH_DB._db.prepare("SELECT reason, delta FROM research_credit_ledger WHERE job_id=? ORDER BY rowid ASC").all(dev.job.id);
    assert.deepEqual(ledger.map((x) => x.reason), ["reserve", "release"]);
  }

  /* 5th job still allowed because device_failed is excluded from PO_FREE_FAILURE_SQL. */
  const fifth = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
    kind: "manuscript_draft", idempotencyKey: "df-fifth", runner: "device",
  });
  assert.equal(fifth.http, 202, JSON.stringify(fifth));
});

test("0009 migration applies over 0001..0008, rolls back cleanly, and mirror is a no-op", { skip: SKIP }, () => {
  const db = new DatabaseSync(":memory:");
  const migrations = [
    "../docs/research/contracts/phase-1/0001_research_v1.sql",
    "../docs/research/contracts/phase-2/0002_research_v2.sql",
    "../docs/research/contracts/phase-3/0003_research_v3.sql",
    "../docs/research/contracts/phase-3/0004_research_v4.sql",
    "../docs/research/contracts/phase-6/0005_research_v5.sql",
    "../docs/research/contracts/phase-5/0006_research_v6.sql",
    "../docs/research/contracts/phase-5/0007_research_v7.sql",
    "../docs/research/contracts/phase-5/0008_research_v8.sql",
    "../docs/research/contracts/phase-5/0009_research_v9.sql",
  ];
  for (const m of migrations) {
    db.exec(readFileSync(new URL(m, import.meta.url), "utf8"));
  }
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_job_steps'").get();
  assert.ok(hasTable, "research_job_steps created by 0009");

  /* Re-applying 0009 over schema mirror is a no-op. */
  const db2 = new DatabaseSync(":memory:");
  db2.exec(SCHEMA);
  db2.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0009_research_v9.sql", import.meta.url), "utf8"));
  assert.ok(db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_job_steps'").get());

  /* Rollback drops research_job_steps cleanly. */
  db.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0009_rollback.sql", import.meta.url), "utf8"));
  const afterRb = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_job_steps'").get();
  assert.equal(afterRb, undefined, "research_job_steps dropped by 0009_rollback");
});
