import "./helpers/json-import-attr.mjs";
/* ResearchMD PaperOrchestra (manuscript_draft) job creation tests (node:test, no network).
 * Mirrors the D1/R2/queue/KV test harness from test/research-phase3-api.test.mjs.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-po-job.test.mjs
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
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: { callGemini: async () => "mock answer" },
});
mock.module("../functions/api/billing/[[path]].js", {
  namedExports: {
    onRequest: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    plans: () => ({ tokens: {} }),
    fulfilPurchase: async () => ({ ok: true }),
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { validateJobMessage, DAILY_CAPS, HARD_STOP_MESSAGES } = await import("../functions/api/research/_caps.js");
const { quoteAiCall } = await import("../functions/api/research/_credits.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");

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
  return { _messages: [], failNext: false, async send(m) { if (this.failNext) { this.failNext = false; throw new Error("queue down"); } this._messages.push(m); } };
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
  const { r2 = true, queue = true } = opts;
  const poEnabled = Object.prototype.hasOwnProperty.call(opts, "poEnabled") ? opts.poEnabled : "1";
  const D = d1();
  D._db.exec(SCHEMA);
  const env = {
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_ADMIN_TOKEN: "admin-test-token",
    RESEARCH_CALLBACK_SECRET: "test-secret",
    MAIK_KV: kvShim(),
  };
  if (poEnabled !== undefined) env.RESEARCH_PO_ENABLED = poEnabled;
  if (r2) env.RESEARCH_R2 = r2Shim();
  if (queue) env.RESEARCH_QUEUE = queueShim();
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
async function makeProject(env, token, studyType = "systematic_review", title = "BCG review", question = "Does BCG prevent TB?") {
  const r = await call(env, "POST", "v1/projects", token, { title, studyType, researchQuestion: question });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
function lockProtocol(env, pid, { version = 1, status = "locked", lockHash = "a".repeat(64), population = "Adults at risk" } = {}) {
  const now = Date.now();
  const id = "prot_" + pid + "_" + version;
  const content = {
    pico: { population, intervention: "BCG vaccine", comparison: "Placebo", outcome: "Tuberculosis" },
    eligibility: ["Randomised controlled trials"],
    outcomes: { primary: "Tuberculosis incidence", secondary: ["All-cause mortality"] },
  };
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_protocols (id,project_id,version,status,content_json,lock_hash,locked_at,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, pid, version, status, JSON.stringify(content), status === "locked" ? lockHash : null, status === "locked" ? now : null, "u-alice", now);
  return id;
}
function addRun(env, pid, runId = "run_1") {
  const now = Date.now();
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_runs (id,project_id,measure,model,result_json,engine,engine_version,created_by,created_ts) VALUES (?,?,'RR','random_dl',?,'research-engine','rmd1','u-alice',?)")
    .run(runId, pid, JSON.stringify({ estimate: 0.49, ciLower: 0.31, ciUpper: 0.78, p: 0.002, k: 4, i2: 18.5 }), now);
}
function ledgerRows(env, jobId) {
  return env.RESEARCH_DB._db.prepare("SELECT * FROM research_credit_ledger WHERE job_id=? ORDER BY rowid ASC").all(jobId);
}

test("manuscript_draft: flag off -> 404 before auth/project gate", { skip: SKIP }, async () => {
  const env = freshEnv({ poEnabled: "0" });
  const p = await makeProject(env, "tok-alice", "systematic_review");
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  for (const tok of ["tok-alice", "tok-bob", "tok-eve"]) {
    const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", tok,
      { kind: "manuscript_draft", idempotencyKey: "k1" });
    assert.equal(r.http, 404, tok);
    assert.equal(r.error.code, "not_found");
  }
  const envUnset = freshEnv({ poEnabled: undefined });
  const p2 = await makeProject(envUnset, "tok-alice", "systematic_review");
  const r2 = await call(envUnset, "POST", "v1/projects/" + p2.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k1" });
  assert.equal(r2.http, 404);
  assert.equal(r2.error.code, "not_found");
});

test("manuscript_draft: viewer -> 403, outsider -> 404, non-SR -> 409", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice", "systematic_review");
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  const viewer = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-bob",
    { kind: "manuscript_draft", idempotencyKey: "k-view" });
  assert.equal(viewer.http, 403);
  assert.equal(viewer.error.code, "not_member");

  const outsider = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-eve",
    { kind: "manuscript_draft", idempotencyKey: "k-eve" });
  assert.equal(outsider.http, 404);
  assert.equal(outsider.error.code, "project_not_found");

  for (const badType of ["case_report", "Case Report", "cohort", "rct", "observational", ""]) {
    const nonSr = await makeProject(env, "tok-alice", badType, "Non-SR " + badType);
    const res = await call(env, "POST", "v1/projects/" + nonSr.id + "/jobs", "tok-alice",
      { kind: "manuscript_draft", idempotencyKey: "k-nonsr" });
    assert.equal(res.http, 409, "studyType=" + badType);
    assert.equal(res.error.code, "not_systematic_review");
  }
});

test("manuscript_draft: quote endpoint returns the same ceiling without reserving credits", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review");
  const q = await call(env, "GET", "v1/projects/" + p.id + "/jobs/quote?kind=manuscript_draft", "tok-alice");
  assert.equal(q.http, 200, JSON.stringify(q));
  assert.equal(q.quoteMicroUsd, quoteAiCall(env, "T2") * 64);
  assert.equal(q.calls, 64);
  assert.equal(q.tier, "T2");
  assert.equal(env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_job_runs WHERE project_id=?").get(p.id).n, 0,
    "quoting creates no job");
  assert.equal(env.MAIK_KV._m.get("maik:credit:em:alice@example.com").includes('"balance":500'), true,
    "quoting reserves no credits");

  const viewer = await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  assert.equal(viewer.http, 201);
  const denied = await call(env, "GET", "v1/projects/" + p.id + "/jobs/quote?kind=manuscript_draft", "tok-bob");
  assert.equal(denied.http, 403);
  assert.equal(denied.error.code, "not_member");

  const off = freshEnv({ poEnabled: undefined });
  await makeProject(off, "tok-alice", "systematic_review");
  const disabled = await call(off, "GET", "v1/projects/prj_missing/jobs/quote?kind=manuscript_draft", "tok-alice");
  assert.equal(disabled.http, 404);
});

test("manuscript_draft: unlocked protocol -> 409, no saved run -> 409, active job -> 409", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "Systematic Review & Meta-Analysis");

  /* No protocol row yet -> 409 protocol_unlocked. */
  const noProto = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k0" });
  assert.equal(noProto.http, 409);
  assert.equal(noProto.error.code, "protocol_unlocked");

  /* Draft protocol -> 409 protocol_unlocked. */
  lockProtocol(env, p.id, { version: 1, status: "draft" });
  const draftProto = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k1" });
  assert.equal(draftProto.http, 409);
  assert.equal(draftProto.error.code, "protocol_unlocked");

  /* Lock protocol v2, no run yet -> 409 no_saved_run. */
  lockProtocol(env, p.id, { version: 2, status: "locked" });
  const noRun = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k2" });
  assert.equal(noRun.http, 409);
  assert.equal(noRun.error.code, "no_saved_run");

  /* Latest protocol is draft v3 even though v2 was locked -> 409 protocol_unlocked. */
  addRun(env, p.id);
  lockProtocol(env, p.id, { version: 3, status: "draft" });
  const unlockedLatest = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k2b" });
  assert.equal(unlockedLatest.http, 409);
  assert.equal(unlockedLatest.error.code, "protocol_unlocked");

  /* Lock v4 -> create job -> active job blocks a second key with 409 job_active. */
  lockProtocol(env, p.id, { version: 4, status: "locked" });
  const first = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-first" });
  assert.equal(first.http, 202, JSON.stringify(first));
  const second = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-second" });
  assert.equal(second.http, 409);
  assert.equal(second.error.code, "job_active");

  /* Running status also blocks. */
  env.RESEARCH_DB._db.prepare("UPDATE research_job_runs SET status='running' WHERE id=?").run(first.job.id);
  const whileRunning = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-third" });
  assert.equal(whileRunning.http, 409);
  assert.equal(whileRunning.error.code, "job_active");
});

test("manuscript_draft: daily caps 3/project and 5/user -> 429, insufficient credits -> 402", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 1000);
  const p1 = await makeProject(env, "tok-alice", "systematic_review", "SR 1");
  lockProtocol(env, p1.id);
  addRun(env, p1.id, "r1");
  const now = Date.now();
  const ins = env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES (?,?,?,'succeeded',?,?,?)");
  /* pdf_extract and yesterday's jobs must NOT count toward PO caps. */
  for (let i = 0; i < 5; i++) ins.run("pdf_" + i, p1.id, "pdf_extract", "pdf_" + i, "u-alice", now);
  for (let i = 0; i < 3; i++) ins.run("old_" + i, p1.id, "manuscript_draft", "old_" + i, "u-alice", now - 2 * 86400000);
  assert.equal(DAILY_CAPS.poProjectJobs, 3);
  assert.equal(DAILY_CAPS.poUserJobs, 5);

  /* Seed 3 manuscript_draft jobs today in p1 -> 4th hits cap_po_project_daily. */
  for (let i = 0; i < 3; i++) ins.run("p1_po_" + i, p1.id, "manuscript_draft", "p1_po_" + i, "u-alice", now);
  const pCap = await call(env, "POST", "v1/projects/" + p1.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-pcap" });
  assert.equal(pCap.http, 429);
  assert.equal(pCap.error.code, "cap_po_project_daily");
  assert.equal(pCap.error.message, HARD_STOP_MESSAGES.cap_po_project_daily);
  assert.ok(!pCap.error.message.includes("\u2014"));

  /* Seed 2 more manuscript_draft jobs in p2 (total 5 today for u-alice) -> p3 hits cap_po_user_daily. */
  const p2 = await makeProject(env, "tok-alice", "meta_analysis", "SR 2");
  for (let i = 0; i < 2; i++) ins.run("p2_po_" + i, p2.id, "manuscript_draft", "p2_po_" + i, "u-alice", now);
  const p3 = await makeProject(env, "tok-alice", "systematic_review", "SR 3");
  lockProtocol(env, p3.id);
  addRun(env, p3.id, "r3");
  const uCap = await call(env, "POST", "v1/projects/" + p3.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-ucap" });
  assert.equal(uCap.http, 429);
  assert.equal(uCap.error.code, "cap_po_user_daily");
  assert.equal(uCap.error.message, HARD_STOP_MESSAGES.cap_po_user_daily);
  assert.ok(!uCap.error.message.includes("\u2014"));

  /* Insufficient credits -> 402. */
  const envPoor = freshEnv();
  fundWallet(envPoor, "alice@example.com", 10); /* 10 INR < ~61.44 INR (64 * T2) */
  const pp = await makeProject(envPoor, "tok-alice", "systematic_review");
  lockProtocol(envPoor, pp.id);
  addRun(envPoor, pp.id, "rp");
  const poor = await call(envPoor, "POST", "v1/projects/" + pp.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-poor" });
  assert.equal(poor.http, 402);
  assert.equal(poor.error.code, "insufficient_credits");
  assert.equal(envPoor.RESEARCH_QUEUE._messages.length, 0);
  assert.equal(envPoor.RESEARCH_R2._objects.size, 0);
});

test("manuscript_draft: PHI in protocol -> 422 phi_blocked, credits released, nothing in R2 or queue", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review");
  lockProtocol(env, p.id, { population: "Call patient coordinator at +91 9876543210 for enrolment" });
  addRun(env, p.id, "r1");

  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-phi" });
  assert.equal(r.http, 422, JSON.stringify(r));
  assert.equal(r.error.code, "phi_blocked");
  assert.ok(Array.isArray(r.categories) && r.categories.includes("phone"), JSON.stringify(r));
  assert.ok(!JSON.stringify(r).includes("9876543210"), "PHI text must never be echoed");
  assert.equal(env.RESEARCH_R2._objects.size, 0, "nothing written to R2");
  assert.equal(env.RESEARCH_QUEUE._messages.length, 0, "nothing sent to queue");
  assert.equal(env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_job_runs WHERE project_id=?").get(p.id).n, 0);

  const ledger = env.RESEARCH_DB._db.prepare("SELECT reason, delta FROM research_credit_ledger ORDER BY rowid ASC").all();
  assert.deepEqual(ledger.map((x) => x.reason), ["reserve", "release"]);
  assert.equal(ledger[0].delta + ledger[1].delta, 0);
});

test("manuscript_draft: happy path snapshot (verified only), queue message, idempotent replay", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "Systematic Review & Meta-Analysis", "BCG and TB", "Does BCG reduce TB?");
  const lockHash = "b".repeat(64);
  lockProtocol(env, p.id, { lockHash });
  addRun(env, p.id, "run_main");
  const now = Date.now();
  const db = env.RESEARCH_DB._db;

  /* Records + report link for study 1. */
  db.prepare("INSERT INTO research_records (id,project_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES ('rec_1',?,'pubmed','11111111','Colditz Trial',?,1994,'10.1000/colditz',?,?)")
    .run(p.id, JSON.stringify(["Colditz GA"]), JSON.stringify({ venue: "JAMA", volume: "271", pages: "698-702" }), now);

  /* Study 1: extraction has verified, corrected, unverified, and missing-provenance fields. */
  db.prepare("INSERT INTO research_studies (id,project_id,label,measure,inputs_json,locator_json,quote,verified,created_ts,updated_ts) VALUES ('st_1',?,'Colditz 1994','RR',?,?,?,1,?,?)")
    .run(p.id, JSON.stringify({ events1: 12, n1: 100 }), JSON.stringify({ kind: "manual", citation: "Colditz 1994", page: 2 }), "12 of 100", now, now);
  db.prepare("INSERT INTO research_reports (id,project_id,record_id,status,study_id,created_ts,updated_ts) VALUES ('rep_1',?,'rec_1','included','st_1',?,?)")
    .run(p.id, now, now);
  const extFields = {
    events1: { value: 12, status: "verified", locator: { kind: "pdf", citation: "Colditz 1994", page: 4 }, quote: "12 events in BCG" },
    n1: { value: 100, status: "unverified", locator: { kind: "pdf", citation: "Colditz 1994", page: 4 }, quote: "100 infants" },
    events2: { value: 24, status: "verified", locator: null, quote: "24 events in control" },
    n2: { value: 105, status: "corrected", locator: { kind: "pdf", citation: "Colditz 1994", page: 4 }, quote: "" },
  };
  db.prepare("INSERT INTO research_extractions (id,project_id,study_id,template,status,fields_json,created_ts,updated_ts) VALUES ('ex_1',?,'st_1','rct_binary','draft',?,?,?)")
    .run(p.id, JSON.stringify(extFields), now, now);

  /* Study 2: Phase 1 unverified study -> must NOT appear in evidence. */
  db.prepare("INSERT INTO research_studies (id,project_id,label,measure,inputs_json,locator_json,quote,verified,created_ts,updated_ts) VALUES ('st_unv',?,'Unverified Study','RR',?,?,?,0,?,?)")
    .run(p.id, JSON.stringify({ events1: 99, n1: 200 }), JSON.stringify({ kind: "manual", citation: "Draft", page: 1 }), "99 of 200", now, now);

  /* RoB: st_1 agreed dual votes -> included; st_unv single pending vote -> excluded; st_conf open conflict -> excluded. */
  const loc = { kind: "manual", citation: "Colditz 1994", page: 3 };
  db.prepare("INSERT INTO research_rob_assessments (id,project_id,study_id,tool,assessor_uid,domains_json,overall,created_ts) VALUES ('rob_a',?,'st_1','rob2','u-alice',?,'low',?)")
    .run(p.id, JSON.stringify([{ key: "d1", judgment: "low", locator: loc, quote: "Randomised by computer" }]), now);
  db.prepare("INSERT INTO research_rob_assessments (id,project_id,study_id,tool,assessor_uid,domains_json,overall,created_ts) VALUES ('rob_b',?,'st_1','rob2','u-bob',?,'low',?)")
    .run(p.id, JSON.stringify([{ key: "d1", judgment: "low", locator: loc, quote: "Computer sequence" }]), now);
  db.prepare("INSERT INTO research_rob_assessments (id,project_id,study_id,tool,assessor_uid,domains_json,overall,created_ts) VALUES ('rob_pending',?,'st_unv','rob2','u-alice',?,'high',?)")
    .run(p.id, JSON.stringify([{ key: "d1", judgment: "high", locator: loc, quote: "Unverified single vote" }]), now);

  /* GRADE assessment. */
  db.prepare("INSERT INTO research_grade_assessments (id,project_id,run_id,outcome,design,input_json,result_json,created_ts,updated_ts) VALUES ('grd_1',?,'run_main','Tuberculosis','rct',?,?,?,?)")
    .run(p.id,
      JSON.stringify({ riskOfBias: { level: "no" }, inconsistency: { level: "serious" } }),
      JSON.stringify({ certainty: "Moderate", footnotes: ["Downgraded one level for inconsistency"] }),
      now, now);

  const res = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-happy", cutoffDate: "2024-11" });
  assert.equal(res.http, 202, JSON.stringify(res));
  assert.equal(res.job.kind, "manuscript_draft");
  assert.equal(res.job.status, "queued");
  const expectedQuote = quoteAiCall(env, "T2") * 64;
  assert.deepEqual(res.job.ceilings, { maxSeconds: 600, maxCalls: 64, quoteMicroUsd: expectedQuote });
  const expectedSnapKey = "projects/" + p.id + "/manuscript/snapshots/" + res.job.id + ".json";
  assert.equal(res.job.inputR2Key, expectedSnapKey);

  /* R2 snapshot checks. */
  const rawSnap = env.RESEARCH_R2._objects.get(expectedSnapKey);
  assert.ok(rawSnap, "snapshot written to R2 at exact key");
  const snap = JSON.parse(rawSnap);
  assert.equal(snap.v, 1);
  assert.equal(snap.projectId, p.id);
  assert.equal(snap.jobId, res.job.id);
  assert.equal(snap.protocol.lockHash, lockHash);
  assert.equal(snap.protocol.title, "BCG and TB");
  assert.deepEqual(snap.protocol.outcomes, ["Tuberculosis incidence", "All-cause mortality"]);
  assert.equal(snap.runs.length, 1);
  assert.equal(snap.runs[0].runId, "run_main");
  assert.equal(snap.runs[0].result.estimate, 0.49);

  /* ONLY verified values with locator + quote reached snapshot.evidence. */
  assert.equal(snap.evidence.length, 1);
  assert.equal(snap.evidence[0].studyId, "st_1");
  assert.equal(snap.evidence[0].source.pmid, "11111111");
  assert.deepEqual(snap.evidence[0].values.map((v) => v.field), ["events1"]);
  assert.equal(snap.evidence[0].values[0].verified, true);
  assert.ok(!rawSnap.includes("Unverified Study"));
  assert.ok(!rawSnap.includes("Unverified single vote"));

  /* ONLY agreed RoB reached snapshot.rob. */
  assert.equal(snap.rob.length, 1);
  assert.equal(snap.rob[0].studyId, "st_1");
  assert.equal(snap.rob[0].verified, true);
  assert.equal(snap.rob[0].domain, "d1");

  /* GRADE + references. */
  assert.equal(snap.grade.length, 1);
  assert.equal(snap.grade[0].certainty, "moderate");
  assert.equal(snap.references.length, 1);
  assert.equal(snap.references[0].key, "rec_1");
  assert.equal(snap.references[0].pmid, "11111111");

  /* Queue message checks. */
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  const msg = env.RESEARCH_QUEUE._messages[0];
  assert.ok(validateJobMessage(msg), "queue message passes validateJobMessage");
  assert.deepEqual(Object.keys(msg).sort(), ["ceilings", "createdAt", "idempotencyKey", "input", "jobId", "kind", "projectId", "v"]);
  assert.equal(msg.kind, "manuscript_draft");
  assert.deepEqual(msg.input, { r2Key: expectedSnapKey, cutoffDate: "2024-11" });
  assert.deepEqual(msg.ceilings, { maxSeconds: 600, maxCalls: 64 });

  /* Ledger reserve + audit event. */
  const ledger = ledgerRows(env, res.job.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].reason, "reserve");
  assert.equal(ledger[0].delta, -expectedQuote);
  const aud = db.prepare("SELECT metadata_json FROM research_audit_events WHERE project_id=? AND event_type='job_created' AND resource_id=?").get(p.id, res.job.id);
  assert.deepEqual(JSON.parse(aud.metadata_json), { kind: "manuscript_draft", quoteMicroUsd: expectedQuote });

  /* Idempotent replay while queued -> 200 same job, no second queue message or reserve. */
  const replay = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-happy" });
  assert.equal(replay.http, 200, JSON.stringify(replay));
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.job.id, res.job.id);
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  assert.equal(ledgerRows(env, res.job.id).length, 1);
});

test("manuscript_draft: queue failure marks failed and releases credits; validateJobMessage rejects bad payloads", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review");
  lockProtocol(env, p.id);
  addRun(env, p.id);
  env.RESEARCH_QUEUE.failNext = true;

  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-qfail", cutoffDate: "2024-13" });
  assert.equal(r.http, 503);
  assert.equal(r.error.code, "queue_unavailable");
  const row = env.RESEARCH_DB._db.prepare("SELECT * FROM research_job_runs WHERE idempotency_key='k-qfail'").get();
  assert.equal(row.status, "failed");
  assert.equal(row.error_code, "queue_unavailable");
  assert.equal(env.RESEARCH_R2._objects.size, 0, "snapshot deleted on queue-send failure");
  const ledger = ledgerRows(env, row.id);
  assert.deepEqual(ledger.map((x) => x.reason), ["reserve", "release"]);
  assert.equal(ledger[0].delta + ledger[1].delta, 0);

  const valid = {
    v: 1, jobId: "job_1", kind: "manuscript_draft", projectId: "prj_1", idempotencyKey: "k1", createdAt: 1763900000,
    input: { r2Key: "projects/prj_1/manuscript/snapshots/job_1.json", cutoffDate: "2024-11" },
    ceilings: { maxSeconds: 600, maxCalls: 64 },
  };
  assert.equal(validateJobMessage(valid), true);
  assert.equal(validateJobMessage({ ...valid, input: { r2Key: "projects/prj_1/manuscript/snapshots/job_1.json" } }), true);
  assert.equal(validateJobMessage({ ...valid, input: { r2Key: "projects/prj_other/manuscript/snapshots/job_1.json" } }), false);
  assert.equal(validateJobMessage({ ...valid, input: { r2Key: "projects/prj_1/pdf/" + "a".repeat(64) + ".pdf" } }), false);
  assert.equal(validateJobMessage({ ...valid, input: { r2Key: valid.input.r2Key, cutoffDate: "2024-13" } }), false);
  assert.equal(validateJobMessage({ ...valid, input: { r2Key: valid.input.r2Key, extra: 1 } }), false);
  assert.equal(validateJobMessage({ ...valid, ceilings: { maxSeconds: 601, maxCalls: 64 } }), false);
  assert.equal(validateJobMessage({ ...valid, ceilings: { maxSeconds: 600, maxCalls: 65 } }), false);
  assert.equal(validateJobMessage({ ...valid, ceilings: { maxSeconds: 0, maxCalls: 1 } }), false);
  assert.equal(validateJobMessage({ ...valid, ceilings: { maxSeconds: 600, maxCalls: 64, maxPages: 1 } }), false);
  assert.equal(validateJobMessage({ ...valid, extra: 1 }), false);
});

test("manuscript_draft: lockedAt and references with author names next to 'patients' -> 202 (not blocked)", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review", "Sepsis review", "Does hydrocortisone reduce mortality?");
  lockProtocol(env, p.id);
  addRun(env, p.id, "run_1");
  const now = Date.now();
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_records (id,project_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES ('rec_pat',?,'pubmed','22222222','Hydrocortisone in patients with septic shock',?,2023,'10.1000/sepsis',?,?)")
    .run(p.id, JSON.stringify(["Ramesh Kumar", "Ananya Sharma"]), JSON.stringify({ venue: "Lancet" }), now);

  const res = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-ref-patients" });
  assert.equal(res.http, 202, JSON.stringify(res));
  const snap = JSON.parse(env.RESEARCH_R2._objects.get(res.job.inputR2Key));
  assert.ok(snap.protocol.lockedAt, "lockedAt included in snapshot");
  assert.equal(snap.references.length, 1);
  assert.ok(snap.references[0].title.includes("patients"));
});

test("manuscript_draft: phone in protocol.question -> 422 phi_blocked", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review", "BCG review", "Does BCG reduce TB? Contact 9876543210");
  lockProtocol(env, p.id);
  addRun(env, p.id, "r1");

  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-phi-question" });
  assert.equal(r.http, 422, JSON.stringify(r));
  assert.equal(r.error.code, "phi_blocked");
  assert.ok(Array.isArray(r.categories) && r.categories.includes("phone"), JSON.stringify(r));
  assert.ok(!JSON.stringify(r).includes("9876543210"), "PHI text must never be echoed");
  assert.equal(env.RESEARCH_R2._objects.size, 0);
  assert.equal(env.RESEARCH_QUEUE._messages.length, 0);
  const ledger = env.RESEARCH_DB._db.prepare("SELECT reason, delta FROM research_credit_ledger ORDER BY rowid ASC").all();
  assert.deepEqual(ledger.map((x) => x.reason), ["reserve", "release"]);
  assert.equal(ledger[0].delta + ledger[1].delta, 0);
});

test("manuscript_draft: full date in evidence quote passes (published text, default mode)", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review");
  lockProtocol(env, p.id);
  addRun(env, p.id, "r1");
  const now = Date.now();
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_studies (id,project_id,label,measure,inputs_json,locator_json,quote,verified,created_ts,updated_ts) VALUES ('st_date',?,'Trial 2023','RR',?,?,?,1,?,?)")
    .run(p.id, JSON.stringify({ events1: 5, n1: 50 }), JSON.stringify({ kind: "manual", citation: "Trial 2023", page: 1 }), "Observed on 14/03/2023 in ward", now, now);

  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-phi-evquote" });
  assert.equal(r.http, 202, JSON.stringify(r));
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  const snap = JSON.parse(env.RESEARCH_R2._objects.get(r.job.inputR2Key));
  assert.ok(JSON.stringify(snap).includes("14/03/2023"), "published quote stays in the snapshot verbatim");
});

test("manuscript_draft: full date in the protocol question blocks (user-typed text)", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review", "BCG review", "Was the outcome on 12/03/2023 representative?");
  lockProtocol(env, p.id);
  addRun(env, p.id, "r1");

  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-phi-proto-date" });
  assert.equal(r.http, 422, JSON.stringify(r));
  assert.equal(r.error.code, "phi_blocked");
  assert.ok(Array.isArray(r.categories) && r.categories.includes("dates"), JSON.stringify(r));
  assert.equal(r.overridable, undefined, "jobs never offer an override");
  assert.ok(!JSON.stringify(r).includes("12/03/2023"), "PHI date must never be echoed");
  assert.equal(env.RESEARCH_R2._objects.size, 0);
  assert.equal(env.RESEARCH_QUEUE._messages.length, 0);
  const ledger = env.RESEARCH_DB._db.prepare("SELECT reason, delta FROM research_credit_ledger ORDER BY rowid ASC").all();
  assert.deepEqual(ledger.map((x) => x.reason), ["reserve", "release"]);
  assert.equal(ledger[0].delta + ledger[1].delta, 0);
});

test("manuscript_draft: full date in a GRADE rationale blocks (user-typed text)", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review");
  lockProtocol(env, p.id);
  addRun(env, p.id, "r1");
  const now = Date.now();
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_grade_assessments (id,project_id,run_id,outcome,design,input_json,result_json,created_ts,updated_ts) VALUES ('grd_date',?,'r1','Tuberculosis','rct',?,?,?,?)")
    .run(p.id, JSON.stringify({}), JSON.stringify({ certainty: "Low", footnotes: ["Downgraded after review on 12/03/2023"] }), now, now);

  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "manuscript_draft", idempotencyKey: "k-phi-grade-date" });
  assert.equal(r.http, 422, JSON.stringify(r));
  assert.equal(r.error.code, "phi_blocked");
  assert.ok(Array.isArray(r.categories) && r.categories.includes("dates"), JSON.stringify(r));
  assert.ok(!JSON.stringify(r).includes("12/03/2023"), "PHI date must never be echoed");
  assert.equal(env.RESEARCH_R2._objects.size, 0);
  assert.equal(env.RESEARCH_QUEUE._messages.length, 0);
});

test("manuscript_draft: snapshot build throwing releases reserved credits", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 500);
  const p = await makeProject(env, "tok-alice", "systematic_review");
  lockProtocol(env, p.id);
  addRun(env, p.id, "r1");

  const origPrepare = env.RESEARCH_DB.prepare.bind(env.RESEARCH_DB);
  env.RESEARCH_DB.prepare = (sql) => {
    if (sql.includes("FROM research_studies")) {
      return {
        bind: () => ({
          all: async () => { throw new Error("simulated snapshot failure"); },
        }),
      };
    }
    return origPrepare(sql);
  };

  await assert.rejects(
    () => call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
      { kind: "manuscript_draft", idempotencyKey: "k-snap-err" }),
    /simulated snapshot failure/
  );
  assert.equal(env.RESEARCH_R2._objects.size, 0);
  assert.equal(env.RESEARCH_QUEUE._messages.length, 0);
  const ledger = env.RESEARCH_DB._db.prepare("SELECT reason, delta FROM research_credit_ledger ORDER BY rowid ASC").all();
  assert.deepEqual(ledger.map((x) => x.reason), ["reserve", "release"]);
  assert.equal(ledger[0].delta + ledger[1].delta, 0);
});
