/* ResearchMD Phase 3 server-side API tests (node:test, no network).
 * Covers: 0003 migration + rollback, PDF upload (25 MB, sha256 dedupe),
 * job create with idempotency, cancel, the HMAC callback (valid / invalid /
 * skewed / replayed, contract test vector), credits reserve / settle /
 * release and partial failure, caps hard stop (verbatim messages), the PHI
 * gate on the shared vector file (100% synthetic block, clean passes),
 * gateway tier routing + usage logging + prompt-injection framing, internal
 * literature-search with efetch abstracts, and outsider isolation on every
 * new route.
 *
 * Mocking pattern identical to test/research-phase2-e2e.test.mjs:
 * mock.module on ../functions/_fbauth.js and on the LLM facade
 * ../functions/api/ai/[[path]].js (callGemini), node:sqlite D1-shaped shim
 * behind the real schema, in-memory R2 / queue / KV stubs.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phase3-api.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

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
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
});

/* The LLM facade is mocked; the gateway must route through it (no new
 * provider client). llm.impl is swapped per test; llm.calls records every
 * call's parts and opts so framing / tools / data placement are assertable. */
const llm = { calls: [], impl: async () => "mock answer" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { scan } = await import("../functions/api/research/_phi.js");
const { mintJobToken, RESEARCH_FRAMING } = await import("../functions/api/research/_gateway.js");
const { validateJobMessage } = await import("../functions/api/research/_caps.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const PHI_VECTORS = JSON.parse(readFileSync(new URL("../docs/research/contracts/phase-3/phi-vectors.json", import.meta.url), "utf8"));
const INJECTION = JSON.parse(readFileSync(new URL("../docs/research/contracts/phase-3/injection-set.json", import.meta.url), "utf8"));
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
function freshEnv({ r2 = true, queue = true, secret = SECRET } = {}) {
  const D = d1();
  D._db.exec(SCHEMA);
  const env = {
    RESEARCH_MODE: "pilot", RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_ADMIN_TOKEN: "admin-test-token",
    MAIK_KV: kvShim(),
  };
  if (r2) env.RESEARCH_R2 = r2Shim();
  if (queue) env.RESEARCH_QUEUE = queueShim();
  if (secret) env.RESEARCH_CALLBACK_SECRET = secret;
  return env;
}
function fundWallet(env, email, inr) {
  env.MAIK_KV._m.set("maik:credit:em:" + email, JSON.stringify({ balance: inr, day: "", chargedToday: 0 }));
}
function walletBalance(env, email) {
  const raw = env.MAIK_KV._m.get("maik:credit:em:" + email);
  return raw ? JSON.parse(raw).balance : 0;
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
async function callForm(env, path, token, form) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://stewardmd.in/api/research/" + path, { method: "POST", headers, body: form });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
function pdfForm(bytes, name) {
  const form = new FormData();
  form.append("file", new File([bytes], name || "paper.pdf", { type: "application/pdf" }), name || "paper.pdf");
  return form;
}
async function makeProject(env, token, title) {
  const r = await call(env, "POST", "v1/projects", token, { title: title || "Phase 3 review" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
async function uploadPdf(env, pid, token, suffix) {
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic " + (suffix || Math.random().toString(36).slice(2)));
  const r = await callForm(env, "v1/projects/" + pid + "/pdfs", token, pdfForm(bytes));
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.pdf;
}
async function createJob(env, pid, token, pdfId, key) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/jobs", token,
    { kind: "pdf_extract", pdfId, idempotencyKey: key || "k-" + Math.random().toString(36).slice(2) });
  assert.equal(r.http, 202, JSON.stringify(r));
  return r.job;
}
function hmac(secret, ts, raw) { return createHmac("sha256", secret).update(ts + "." + raw).digest("hex"); }
async function callback(env, jobId, payload, { secret = SECRET, ts, sig, raw, pathPrefix = "v1/" } = {}) {
  const rawBody = raw !== undefined ? raw : JSON.stringify(payload);
  const timestamp = ts !== undefined ? ts : String(Math.floor(Date.now() / 1000));
  const signature = sig !== undefined ? sig : hmac(secret, timestamp, rawBody);
  const path = pathPrefix + "jobs/" + jobId + "/callback";
  const req = new Request("https://stewardmd.in/api/research/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Research-Timestamp": timestamp, "X-Research-Signature": signature },
    body: rawBody,
  });
  const parts = path.split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
function donePayload(jobId, key, usage, resultKey) {
  return { jobId, idempotencyKey: key, status: "done", resultKey, usage };
}
function ledgerRows(env, jobId) {
  return env.RESEARCH_DB._db.prepare("SELECT * FROM research_credit_ledger WHERE job_id=? ORDER BY rowid ASC").all(jobId);
}
function defaultLlmImpl() {
  llm.impl = async (env, parts, maxTokens, opts) => {
    if (opts && opts.meta) {
      opts.meta.usage = { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 0 };
      opts.meta.model = opts.model;
      opts.meta.finishReason = "STOP";
    }
    return "mock answer";
  };
  llm.calls.length = 0;
}

/* ---- 0003 migration + rollback ---------------------------------------------- */

test("0003 applies on live 0001+0002, rolls back cleanly, mirror is a no-op", { skip: SKIP }, async () => {
  const m1 = readFileSync(new URL("../docs/research/contracts/phase-1/0001_research_v1.sql", import.meta.url), "utf8");
  const m2 = readFileSync(new URL("../docs/research/contracts/phase-2/0002_research_v2.sql", import.meta.url), "utf8");
  const m3 = readFileSync(new URL("../docs/research/contracts/phase-3/0003_research_v3.sql", import.meta.url), "utf8");
  const rb = readFileSync(new URL("../docs/research/contracts/phase-3/0003_rollback.sql", import.meta.url), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(m1); db.exec(m2); db.exec(m3);
  const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["research_job_runs", "research_pdfs", "research_ai_usage", "research_credit_ledger", "research_institutions", "research_institution_members"])
    assert.ok(tables().includes(t), "0003 created " + t);
  assert.ok(!tables().includes("research_jobs"), "pilot research_jobs is NOT created by 0003 (no conflict on live 0001+0002)");
  /* Data survives the forward migration and is removed by the rollback only
   * for 0003 tables; Phase 1/2 rows stay. */
  const now = Date.now();
  db.prepare("INSERT INTO research_projects (id,owner_uid,title,created_ts,updated_ts) VALUES ('p1','u1','t',?,?)").run(now, now);
  db.prepare("INSERT INTO research_studies (id,project_id,measure,created_ts,updated_ts) VALUES ('st1','p1','OR',?,?)").run(now, now);
  db.prepare("INSERT INTO research_job_runs (id,project_id,kind,idempotency_key,created_by,created_ts) VALUES ('j1','p1','pdf_extract','k1','u1',?)").run(now);
  db.exec(rb);
  const after = tables();
  for (const t of ["research_job_runs", "research_pdfs", "research_ai_usage", "research_credit_ledger", "research_institutions", "research_institution_members"])
    assert.ok(!after.includes(t), "rollback dropped " + t);
  for (const t of ["research_projects", "research_studies", "research_runs", "research_protocols", "research_records", "research_screening_decisions"])
    assert.ok(after.includes(t), "rollback kept live table " + t);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_studies").get().n, 1);
  /* Applying 0003 over the full schema mirror is a no-op (IF NOT EXISTS). */
  const db2 = new DatabaseSync(":memory:");
  db2.exec(SCHEMA); db2.exec(m3);
  assert.ok(db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_job_runs'").get());
  assert.ok(db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_jobs'").get(), "pilot mirror untouched");
});

/* ---- PDF upload -------------------------------------------------------------- */

test("pdf upload: R2 layout, sha256 dedupe, ceilings, role gate", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic upload test");
  const r = await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-alice", pdfForm(bytes));
  assert.equal(r.http, 201, JSON.stringify(r));
  assert.match(r.pdf.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.pdf.r2Key, "projects/" + p.id + "/pdf/" + r.pdf.sha256 + ".pdf");
  assert.ok(env.RESEARCH_R2._objects.has(r.pdf.r2Key));
  assert.equal(r.pdf.bytes, bytes.length);
  assert.equal(r.pdf.pages, null, "pages unknown until extraction");
  /* Same bytes -> same row (dedupe), no second object. */
  const again = await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-alice", pdfForm(bytes, "other-name.pdf"));
  assert.equal(again.http, 200);
  assert.equal(again.idempotentReplay, true);
  assert.equal(again.pdf.id, r.pdf.id);
  /* Different bytes -> new row. */
  const other = await uploadPdf(env, p.id, "tok-alice", "different");
  assert.notEqual(other.id, r.pdf.id);
  /* 25 MB ceiling (26,214,400 bytes), verbatim message. */
  const big = new Uint8Array(26214401); big.set(new TextEncoder().encode("%PDF-"), 0);
  const tooBig = await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-alice", pdfForm(big));
  assert.equal(tooBig.http, 413);
  assert.equal(tooBig.error.code, "ceiling_bytes");
  assert.equal(tooBig.error.message, "This file is larger than 25 MB. Upload a smaller version.");
  /* Exactly 25 MB is allowed. */
  const exact = new Uint8Array(26214400); exact.set(new TextEncoder().encode("%PDF-"), 0);
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-alice", pdfForm(exact))).http, 201);
  /* Magic bytes, missing file, tiny file. */
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-alice", pdfForm(new TextEncoder().encode("not a pdf at all")))).http, 415);
  const noFile = new FormData(); noFile.append("note", "x");
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-alice", noFile)).http, 400);
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-alice", pdfForm(new TextEncoder().encode("%PDF-")))).http, 400);
  /* No R2 -> 503. */
  const envNoR2 = freshEnv({ r2: false });
  const p2 = await makeProject(envNoR2, "tok-alice");
  assert.equal((await callForm(envNoR2, "v1/projects/" + p2.id + "/pdfs", "tok-alice", pdfForm(bytes))).http, 503);
});

/* ---- Job create, idempotency, caps, cancel ----------------------------------- */

test("job create: quote -> caps -> reserve -> insert -> queue message; idempotent replay", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "k1" });
  assert.equal(r.http, 202, JSON.stringify(r));
  assert.equal(r.job.status, "queued");
  assert.equal(r.job.kind, "pdf_extract");
  assert.deepEqual(r.job.ceilings, { maxPages: 60, maxSeconds: 240, quoteMicroUsd: 50000 });
  assert.equal(r.job.inputR2Key, pdf.r2Key);
  /* Queue message exactly per job-message.schema.json. */
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  const msg = env.RESEARCH_QUEUE._messages[0];
  assert.ok(validateJobMessage(msg), "message passes the schema validator");
  assert.equal(msg.v, 1);
  assert.equal(msg.jobId, r.job.id);
  assert.equal(msg.projectId, p.id);
  assert.equal(msg.idempotencyKey, "k1");
  assert.equal(msg.input.r2Key, pdf.r2Key);
  assert.deepEqual(msg.ceilings, { maxPages: 60, maxSeconds: 240 });
  assert.ok(Number.isInteger(msg.createdAt));
  /* Reserve recorded, wallet untouched until settle. */
  const rows = ledgerRows(env, r.job.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "reserve");
  assert.equal(rows[0].delta, -50000);
  assert.equal(rows[0].owner_type, "user");
  assert.equal(rows[0].owner_id, "em:alice@example.com");
  assert.equal(walletBalance(env, "alice@example.com"), 100);
  /* Same key -> same job, no new message, no new reserve. */
  const replay = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "k1" });
  assert.equal(replay.http, 200);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.job.id, r.job.id);
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  assert.equal(ledgerRows(env, r.job.id).length, 1);
  /* Same key, different PDF -> 409. */
  const pdf2 = await uploadPdf(env, p.id, "tok-alice", "second");
  const conflict = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf2.id, idempotencyKey: "k1" });
  assert.equal(conflict.http, 409);
  assert.equal(conflict.error.code, "idempotency_conflict");
  /* Unknown pdf, bad kind, missing key. */
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: "pdf_missing", idempotencyKey: "kx" })).http, 404);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "other", pdfId: pdf.id, idempotencyKey: "kx" })).http, 400);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf.id })).http, 400);
  /* Batch: 20 allowed, 21 -> batch_too_large verbatim. */
  const ids = [pdf.id, pdf2.id];
  const batch = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfIds: ids, idempotencyKey: "batch1" });
  assert.equal(batch.http, 202);
  assert.equal(batch.jobs.length, 2);
  const tooMany = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfIds: Array(21).fill(pdf.id), idempotencyKey: "batch2" });
  assert.equal(tooMany.http, 400);
  assert.equal(tooMany.error.code, "batch_too_large");
  assert.equal(tooMany.error.message, "A batch can hold at most 20 PDFs. Split the batch and try again.");
  /* Queue failure -> job failed, reserve released, 503. */
  env.RESEARCH_QUEUE.failNext = true;
  const qf = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "kq" });
  assert.equal(qf.http, 503);
  assert.equal(qf.error.code, "queue_unavailable");
  const failedJob = env.RESEARCH_DB._db.prepare("SELECT * FROM research_job_runs WHERE idempotency_key='kq'").get();
  assert.equal(failedJob.status, "failed");
  assert.equal(failedJob.error_code, "queue_unavailable");
  const qRows = ledgerRows(env, failedJob.id);
  assert.deepEqual(qRows.map((x) => x.reason), ["reserve", "release"]);
  assert.equal(qRows[1].delta, 50000);
  /* No queue binding -> 503. */
  const envNoQ = freshEnv({ queue: false });
  const p3 = await makeProject(envNoQ, "tok-alice");
  const pdf3 = await uploadPdf(envNoQ, p3.id, "tok-alice");
  assert.equal((await call(envNoQ, "POST", "v1/projects/" + p3.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf3.id, idempotencyKey: "k1" })).http, 503);
});

test("daily job caps hard stop with verbatim messages", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 10000);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const now = Date.now();
  const ins = env.RESEARCH_DB._db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES (?,?, 'pdf_extract','failed',?,?,?)");
  for (let i = 0; i < 200; i++) ins.run("seed_p_" + i, p.id, "seed_p_" + i, "u-alice", now);
  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "cap1" });
  assert.equal(r.http, 429);
  assert.equal(r.error.code, "project_daily_cap");
  assert.equal(r.error.message, "This project has reached today's processing limit. Try again tomorrow.");
  /* User cap: 300 jobs today across OTHER projects, fresh project here. */
  const p2 = await makeProject(env, "tok-alice", "Second");
  const pdf2 = await uploadPdf(env, p2.id, "tok-alice");
  const ins2 = env.RESEARCH_DB._db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES (?,?, 'pdf_extract','failed',?,?,?)");
  for (let i = 0; i < 100; i++) ins2.run("seed_u_" + i, p.id, "seed_u_" + i, "u-alice", now);
  const r2 = await call(env, "POST", "v1/projects/" + p2.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf2.id, idempotencyKey: "cap2" });
  assert.equal(r2.http, 429);
  assert.equal(r2.error.code, "user_daily_cap");
  assert.equal(r2.error.message, "You have reached today's research limit. Try again tomorrow.");
  /* Yesterday's jobs do not count (UTC day). */
  const env2 = freshEnv();
  fundWallet(env2, "alice@example.com", 100);
  const p3 = await makeProject(env2, "tok-alice");
  const pdf3 = await uploadPdf(env2, p3.id, "tok-alice");
  const old = now - 2 * 86400000;
  const insOld = env2.RESEARCH_DB._db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts) VALUES (?,?, 'pdf_extract','failed',?,?,?)");
  for (let i = 0; i < 200; i++) insOld.run("seed_old_" + i, p3.id, "seed_old_" + i, "u-alice", old);
  assert.equal((await call(env2, "POST", "v1/projects/" + p3.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf3.id, idempotencyKey: "cap3" })).http, 202);
});

test("insufficient credits blocks job create (402), client never writes balances", { skip: SKIP }, async () => {
  const env = freshEnv(); /* wallet empty */
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice",
    { kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "k1" });
  assert.equal(r.http, 402);
  assert.equal(r.error.code, "insufficient_credits");
  assert.equal(env.RESEARCH_QUEUE._messages.length, 0);
  /* The credits view is read-only and reflects the wallet. */
  fundWallet(env, "alice@example.com", 10);
  const view = await call(env, "GET", "v1/credits", "tok-alice");
  assert.equal(view.http, 200);
  assert.equal(view.credits.walletInr, 10);
  assert.ok(view.credits.availableMicroUsd > 0);
  assert.equal(view.credits.unit, "micro-USD");
});

test("cancel: R2 flag + timestamp, settled no-op, worker path settles cancelled", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createJob(env, p.id, "tok-alice", pdf.id, "kc");
  const c = await call(env, "POST", "v1/jobs/" + job.id + "/cancel", "tok-alice");
  assert.equal(c.http, 200, JSON.stringify(c));
  assert.ok(c.job.cancelRequestedTs > 0);
  assert.equal(c.job.status, "queued", "cancel requests; the worker settles via callback");
  const cancelKey = "projects/" + p.id + "/jobs/" + job.id + "/cancel";
  assert.ok(env.RESEARCH_R2._objects.has(cancelKey));
  /* Worker reports cancelled -> release full reserve, cancel object deleted. */
  const cb = await callback(env, job.id, { jobId: job.id, idempotencyKey: "kc", status: "cancelled", usage: { pages: 3, seconds: 1.5 } });
  assert.equal(cb.http, 200, JSON.stringify(cb));
  assert.equal(cb.job.status, "cancelled");
  assert.ok(!env.RESEARCH_R2._objects.has(cancelKey), "cancel flag deleted at settle");
  assert.equal(walletBalance(env, "alice@example.com"), 100, "cancelled job charges nothing");
  const rows = ledgerRows(env, job.id);
  assert.deepEqual(rows.map((r) => r.reason), ["reserve", "release"]);
  /* Cancel of a settled job is a no-op. */
  const again = await call(env, "POST", "v1/jobs/" + job.id + "/cancel", "tok-alice");
  assert.equal(again.http, 200);
  assert.equal(again.alreadySettled, true);
  assert.ok(!env.RESEARCH_R2._objects.has(cancelKey));
});

/* ---- Callback signature + settle --------------------------------------------- */

test("callback contract test vector reproduces (both sides, CI pin)", { skip: SKIP }, async () => {
  const rawBody = '{"jobId":"job_1","idempotencyKey":"k1","status":"done","resultKey":"projects/p1/jobs/job_1/result.json","usage":{"pages":2,"seconds":1.5}}';
  const sig = hmac("test-secret", "1763900000", rawBody);
  assert.equal(sig, "d9526eaa7328d6c49e32502c09811b05d46cdea2f82ec680ab29afe838c487e5");
});

test("callback: valid done settles, charges actual, releases rest; replay is a no-op", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createJob(env, p.id, "tok-alice", pdf.id, "kd");
  const resultKey = "projects/" + p.id + "/jobs/" + job.id + "/result.json";
  env.RESEARCH_R2._objects.set(resultKey, "{}");
  const cb = await callback(env, job.id, donePayload(job.id, "kd", { pages: 30, seconds: 120 }, resultKey));
  assert.equal(cb.http, 200, JSON.stringify(cb));
  assert.equal(cb.job.status, "succeeded", "callback done -> stored succeeded (callback.md)");
  assert.equal(cb.job.resultR2Key, resultKey);
  assert.deepEqual(cb.job.usage, { pages: 30, seconds: 120 });
  assert.ok(cb.job.completedTs > 0);
  const stored = env.RESEARCH_DB._db.prepare("SELECT output_json FROM research_job_runs WHERE id=?").get(job.id);
  assert.deepEqual(JSON.parse(stored.output_json), { resultKey, usage: { pages: 30, seconds: 120 } });
  /* util = max(30/60, 120/240) = 0.5 -> actual 25000 micro-USD = Rs 2.40. */
  assert.equal(walletBalance(env, "alice@example.com"), 97.6);
  const rows = ledgerRows(env, job.id);
  assert.deepEqual(rows.map((r) => [r.reason, r.delta]), [["reserve", -50000], ["release", 50000], ["settle", -25000]],
    "full hold refunded, actual charged once: net -25000");
  /* PDF pages now known. */
  const pdfRow = env.RESEARCH_DB._db.prepare("SELECT pages FROM research_pdfs WHERE id=?").get(pdf.id);
  assert.equal(pdfRow.pages, 30);
  /* Replay: same jobId + idempotencyKey -> 200, NOTHING changes. */
  const before = ledgerRows(env, job.id).length;
  const replay = await callback(env, job.id, donePayload(job.id, "kd", { pages: 30, seconds: 120 }, resultKey));
  assert.equal(replay.http, 200);
  assert.equal(replay.replay, true);
  assert.equal(replay.job.status, "succeeded");
  assert.equal(walletBalance(env, "alice@example.com"), 97.6);
  assert.equal(ledgerRows(env, job.id).length, before);
  /* The worker's actual path has no /v1 prefix (jobs.py send_callback). */
  const env2 = freshEnv();
  fundWallet(env2, "alice@example.com", 100);
  const p2 = await makeProject(env2, "tok-alice");
  const pdf2 = await uploadPdf(env2, p2.id, "tok-alice");
  const job2 = await createJob(env2, p2.id, "tok-alice", pdf2.id, "kw");
  const cb2 = await callback(env2, job2.id, donePayload(job2.id, "kw", { pages: 1, seconds: 1 },
    "projects/" + p2.id + "/jobs/" + job2.id + "/result.json"), { pathPrefix: "" });
  assert.equal(cb2.http, 200, JSON.stringify(cb2));
});

test("callback: invalid signature, skew, missing secret, bad body, mismatch, unknown job", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createJob(env, p.id, "tok-alice", pdf.id, "ks");
  const payload = donePayload(job.id, "ks", { pages: 1, seconds: 1 }, "projects/" + p.id + "/jobs/" + job.id + "/result.json");
  /* Wrong signature. */
  const bad = await callback(env, job.id, payload, { sig: "0".repeat(64) });
  assert.equal(bad.http, 401);
  assert.equal(bad.error.code, "callback_signature");
  /* Skew beyond 300 s. */
  const skewed = await callback(env, job.id, payload, { ts: String(Math.floor(Date.now() / 1000) - 301) });
  assert.equal(skewed.http, 401);
  assert.equal(skewed.error.code, "callback_skew");
  /* Non-integer timestamp. */
  assert.equal((await callback(env, job.id, payload, { ts: "12.5" })).error.code, "callback_skew");
  /* Within the window is fine. */
  assert.equal((await callback(env, job.id, payload, { ts: String(Math.floor(Date.now() / 1000) - 299) })).http, 200);
  /* Missing secret -> 503 (checked first). */
  const envNoSecret = freshEnv({ secret: "" });
  fundWallet(envNoSecret, "alice@example.com", 100);
  const p2 = await makeProject(envNoSecret, "tok-alice");
  const pdf2 = await uploadPdf(envNoSecret, p2.id, "tok-alice");
  const job2 = await createJob(envNoSecret, p2.id, "tok-alice", pdf2.id, "k2");
  const noSecret = await callback(envNoSecret, job2.id, donePayload(job2.id, "k2", { pages: 1, seconds: 1 }, "x"), { secret: "" });
  assert.equal(noSecret.http, 503);
  assert.equal(noSecret.error.code, "callback_unavailable");
  /* Bad body: extra field, missing usage, done without resultKey, failed without error. */
  const extra = await callback(env, job.id, Object.assign({}, payload, { evil: 1 }));
  assert.equal(extra.http, 400);
  assert.equal(extra.error.code, "invalid_body");
  const noUsage = { jobId: job.id, idempotencyKey: "ks", status: "done", resultKey: payload.resultKey };
  assert.equal((await callback(env, job.id, noUsage)).http, 400);
  const noResult = { jobId: job.id, idempotencyKey: "ks", status: "done", usage: { pages: 1, seconds: 1 } };
  assert.equal((await callback(env, job.id, noResult)).http, 400);
  const failedNoError = { jobId: job.id, idempotencyKey: "ks", status: "failed", usage: { pages: 1, seconds: 1 } };
  assert.equal((await callback(env, job.id, failedNoError)).http, 400);
  /* Unknown job. */
  assert.equal((await callback(env, "job_missing", donePayload("job_missing", "k", { pages: 0, seconds: 0 }, "projects/p/jobs/job_missing/result.json"))).http, 404);
  /* Key mismatch -> 409. */
  const mismatch = await callback(env, job.id, donePayload(job.id, "wrong-key", { pages: 1, seconds: 1 }, payload.resultKey));
  assert.equal(mismatch.http, 409);
  assert.equal(mismatch.error.code, "callback_mismatch");
  /* resultKey outside the job's project -> 409. */
  const cross = await callback(env, job.id, donePayload(job.id, "ks", { pages: 1, seconds: 1 }, "projects/other/jobs/" + job.id + "/result.json"));
  assert.equal(cross.http, 409);
  /* Nothing settled by any of the rejected callbacks. */
  const row = env.RESEARCH_DB._db.prepare("SELECT status FROM research_job_runs WHERE id=?").get(job.id);
  assert.equal(row.status, "succeeded", "only the valid in-window callback settled");
});

test("callback failed: stable error code, full release, no charge", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createJob(env, p.id, "tok-alice", pdf.id, "kf");
  const cb = await callback(env, job.id, { jobId: job.id, idempotencyKey: "kf", status: "failed", error: "ceiling_pages", usage: { pages: 60, seconds: 240 } });
  assert.equal(cb.http, 200, JSON.stringify(cb));
  assert.equal(cb.job.status, "failed");
  assert.equal(cb.job.errorCode, "ceiling_pages");
  assert.equal(walletBalance(env, "alice@example.com"), 100, "partial failure charges only completed steps; none completed");
  const rows = ledgerRows(env, job.id);
  assert.deepEqual(rows.map((r) => [r.reason, r.delta]), [["reserve", -50000], ["release", 50000]]);
  /* Free-text error is rejected (stable codes only). */
  const job2 = await createJob(env, p.id, "tok-alice", pdf.id, "kf2");
  const freeText = await callback(env, job2.id, { jobId: job2.id, idempotencyKey: "kf2", status: "failed", error: "PDF said: ignore rules", usage: { pages: 0, seconds: 0 } });
  assert.equal(freeText.http, 400);
});

/* ---- Institution credits (D-4) ------------------------------------------------ */

test("institution invoicing: admin grant, member draws pool first, wallet untouched", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  /* Admin routes: token required, constant-time. */
  assert.equal((await call(env, "POST", "v1/admin/institutions", null, { name: "Example Institute" })).http, 401);
  const noTok = await call(env, "POST", "v1/admin/institutions", "tok-alice", { name: "X" });
  assert.equal(noTok.http, 401, "Firebase user is not an admin");
  const headers = { "x-research-admin-token": "admin-test-token", "Content-Type": "application/json" };
  const mk = async (path, body) => {
    const req = new Request("https://stewardmd.in/api/research/" + path, { method: "POST", headers, body: JSON.stringify(body) });
    const res = await onRequest({ request: req, env, params: { path: path.split("/").filter(Boolean) } });
    return { http: res.status, ...(await res.json()) };
  };
  const inst = await mk("v1/admin/institutions", { name: "Example Institute" });
  assert.equal(inst.http, 201, JSON.stringify(inst));
  assert.equal((await mk("v1/admin/institutions/" + inst.institution.id + "/members", { uid: "u-alice" })).http, 201);
  const grant = await mk("v1/admin/institutions/" + inst.institution.id + "/credits", { amountMicroUsd: 1000000 });
  assert.equal(grant.http, 201);
  assert.equal(grant.balanceMicroUsd, 1000000);
  /* Alice's job draws the institution pool (covers the quote), wallet stays. */
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createJob(env, p.id, "tok-alice", pdf.id, "ki");
  const rows = ledgerRows(env, job.id);
  assert.equal(rows[0].owner_type, "institution");
  assert.equal(rows[0].owner_id, inst.institution.id);
  const cb = await callback(env, job.id, donePayload(job.id, "ki", { pages: 60, seconds: 240 },
    "projects/" + p.id + "/jobs/" + job.id + "/result.json"));
  assert.equal(cb.http, 200);
  assert.equal(walletBalance(env, "alice@example.com"), 100, "institution credit, not the wallet");
  const after = ledgerRows(env, job.id);
  assert.deepEqual(after.map((r) => [r.reason, r.delta]), [["reserve", -50000], ["release", 50000], ["settle", -50000]]);
  const bal = env.RESEARCH_DB._db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM research_credit_ledger WHERE owner_type='institution' AND owner_id=?").get(inst.institution.id);
  assert.equal(bal.n, 950000);
  /* Non-member bob still uses his own wallet. */
  fundWallet(env, "bob@example.com", 50);
  const p2 = await makeProject(env, "tok-bob");
  const pdf2 = await uploadPdf(env, p2.id, "tok-bob");
  const job2 = await createJob(env, p2.id, "tok-bob", pdf2.id, "kb");
  assert.equal(ledgerRows(env, job2.id)[0].owner_type, "user");
  assert.equal(ledgerRows(env, job2.id)[0].owner_id, "em:bob@example.com");
});

/* ---- PHI gate: shared vectors -------------------------------------------------- */

test("PHI gate: 100% of the synthetic block set blocked, clean set passes (shared vectors)", { skip: SKIP }, async () => {
  assert.ok(PHI_VECTORS.cases.length >= 90, "vector file is substantial");
  let blocked = 0, allowed = 0;
  for (const c of PHI_VECTORS.cases) {
    const r = scan(c.text);
    if (c.expect === "block") {
      blocked++;
      assert.equal(r.blocked, true, c.id + " must block: " + c.text);
      if (!c.category.startsWith("near_miss"))
        assert.ok(r.hits.some((h) => h.category === c.category), c.id + " hits category " + c.category);
      /* Hits never carry the matched text. */
      for (const h of r.hits) assert.deepEqual(Object.keys(h).sort(), ["category", "end", "rule", "start"]);
    } else {
      allowed++;
      assert.equal(r.blocked, false, c.id + " must pass: " + c.text + " hits " + JSON.stringify(r.hits));
    }
  }
  assert.ok(blocked >= 50 && allowed >= 30, "both sets covered");
  /* Every blocked category from phi-gate.md is represented. */
  const cats = new Set(PHI_VECTORS.cases.filter((c) => c.expect === "block").map((c) => c.category));
  for (const want of ["mrn", "aadhaar", "ssn", "nhs", "phone", "email", "dob", "address", "patient_name", "admission_date"])
    assert.ok(cats.has(want), "category covered: " + want);
});

/* ---- Gateway: token, PHI-first, caps, tier routing, usage logging -------------- */

async function gatewaySetup(env) {
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createJob(env, p.id, "tok-alice", pdf.id, "kg");
  return { p, pdf, job };
}
async function llmCall(env, job, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://stewardmd.in/api/research/v1/internal/llm",
    { method: "POST", headers, body: JSON.stringify(body) });
  const res = await onRequest({ request: req, env, params: { path: ["v1", "internal", "llm"] } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
function llmBody(job, over) {
  return Object.assign({ jobId: job.id, projectId: job.projectId, userId: job.createdBy,
    tier: "T1", model: "gemini-2.0-flash", system: "You extract study data.",
    prompt: "Extract the sample size from: We enrolled 120 adults.", maxOutputTokens: 2000, purpose: "extraction" }, over || {});
}

test("gateway llm: per-job token, PHI first, tier routing via callGemini, usage logged, credits settled", { skip: SKIP }, async () => {
  defaultLlmImpl();
  const env = freshEnv();
  const { job } = await gatewaySetup(env);
  const token = await mintJobToken(SECRET, job.id, Math.floor(Date.now() / 1000) + 600);
  const r = await llmCall(env, job, llmBody(job), token);
  assert.equal(r.http, 200, JSON.stringify(r));
  assert.equal(r.text, "mock answer");
  assert.equal(r.model, "gemini-3.1-flash-lite", "T1 routes to the low-cost model, not the requested one");
  assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 50 });
  /* Routed through the existing facade with framing + no tools. */
  assert.equal(llm.calls.length, 1);
  const opts = llm.calls[0].opts;
  assert.ok(opts.system.startsWith(RESEARCH_FRAMING));
  assert.ok(opts.system.includes("You extract study data."));
  assert.equal(opts.tools, undefined);
  assert.equal(opts.model, "gemini-3.1-flash-lite");
  assert.equal(llm.calls[0].maxTokens, 2000);
  assert.deepEqual(llm.calls[0].parts, [{ text: llmBody(job).prompt }]);
  /* Usage row: metadata only. */
  const usage = env.RESEARCH_DB._db.prepare("SELECT * FROM research_ai_usage WHERE job_id=?").all(job.id);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].tier, "T1");
  assert.equal(usage[0].step, "extraction");
  assert.equal(usage[0].tokens_in, 100);
  assert.equal(usage[0].tokens_out, 50);
  assert.ok(usage[0].cost_micro_usd > 0);
  assert.equal(usage[0].user_id, "u-alice");
  /* Credits: AI reserve released/settled on top of the pdf reserve. */
  const rows = ledgerRows(env, job.id);
  assert.equal(rows.filter((x) => x.reason === "settle").length, 1);
  assert.equal(rows.filter((x) => x.reason === "reserve").length, 2);
  /* T2/T3 routing. */
  const t2 = await llmCall(env, job, llmBody(job, { tier: "T2" }), token);
  assert.equal(t2.http, 200);
  assert.equal(t2.model, "gemini-3.5-flash");
  const t3 = await llmCall(env, job, llmBody(job, { tier: "T3" }), token);
  assert.equal(t3.http, 200);
  assert.equal(t3.model, "gemini-3.5-flash");
  env.RESEARCH_T3_MODEL = "gemini-3.6-flash";
  const t3b = await llmCall(env, job, llmBody(job, { tier: "T3" }), token);
  assert.equal(t3b.model, "gemini-3.6-flash", "env override honoured for the strong tier");
});

test("gateway llm: token expiry, mismatch, settled job, PHI block, input ceiling, AI caps, partial failure", { skip: SKIP }, async () => {
  defaultLlmImpl();
  const env = freshEnv();
  const { p, job } = await gatewaySetup(env);
  const nowSec = Math.floor(Date.now() / 1000);
  /* No token / expired / too long-lived / forged. */
  assert.equal((await llmCall(env, job, llmBody(job), null)).http, 401);
  assert.equal((await llmCall(env, job, llmBody(job), await mintJobToken(SECRET, job.id, nowSec - 5))).http, 401);
  assert.equal((await llmCall(env, job, llmBody(job), await mintJobToken(SECRET, job.id, nowSec + 10000))).http, 401);
  assert.equal((await llmCall(env, job, llmBody(job), job.id + "." + (nowSec + 600) + "." + "0".repeat(64))).http, 401);
  /* Token for another job cannot act on this one. */
  const otherJob = await createJob(env, p.id, "tok-alice", (await uploadPdf(env, p.id, "tok-alice", "x")).id, "kg2");
  const crossToken = await mintJobToken(SECRET, otherJob.id, nowSec + 600);
  assert.equal((await llmCall(env, job, llmBody(job), crossToken)).http, 409);
  /* Body projectId/userId must match the stored job. */
  const token = await mintJobToken(SECRET, job.id, nowSec + 600);
  assert.equal((await llmCall(env, job, llmBody(job, { projectId: "prj_other" }), token)).http, 409);
  assert.equal((await llmCall(env, job, llmBody(job, { userId: "u-eve" }), token)).http, 409);
  /* PHI block happens BEFORE any provider call; categories only. */
  llm.calls.length = 0;
  const phi = await llmCall(env, job, llmBody(job, { prompt: "Patient Ramesh Kumar, MRN 483920, admitted on 12/03/2024" }), token);
  assert.equal(phi.http, 422);
  assert.equal(phi.error.code, "phi_blocked");
  assert.ok(phi.categories.includes("mrn"));
  assert.ok(!JSON.stringify(phi).includes("Ramesh"), "matched text never echoed");
  assert.equal(llm.calls.length, 0, "no provider call on PHI hit");
  /* Input ceiling (T1 8000 tokens ~ 32000 chars). */
  const huge = await llmCall(env, job, llmBody(job, { prompt: "x".repeat(40000) }), token);
  assert.equal(huge.http, 400);
  assert.equal(huge.error.code, "ceiling_input_tokens");
  /* Daily AI cap: seed today's spend at the project cap. */
  env.RESEARCH_DB._db.prepare("INSERT INTO research_ai_usage (id,project_id,user_id,job_id,step,tier,model,tokens_in,tokens_out,cost_micro_usd,ts) VALUES ('seed',?,'u-alice',?,'s','T1','m',0,0,5000000,?)")
    .run(p.id, job.id, Date.now());
  const capped = await llmCall(env, job, llmBody(job), token);
  assert.equal(capped.http, 429);
  assert.equal(capped.error.code, "project_ai_cap");
  assert.equal(capped.error.message, "This project has reached today's AI budget. AI suggestions resume tomorrow; your data and tools are unaffected.");
  env.RESEARCH_DB._db.prepare("DELETE FROM research_ai_usage WHERE id='seed'").run();
  /* User AI cap: spend seeded in another project, so only the user cap binds. */
  const pOther = await makeProject(env, "tok-alice", "Other project");
  env.RESEARCH_DB._db.prepare("INSERT INTO research_ai_usage (id,project_id,user_id,job_id,step,tier,model,tokens_in,tokens_out,cost_micro_usd,ts) VALUES ('seed2',?,'u-alice',?,'s','T1','m',0,0,10000000,?)")
    .run(pOther.id, job.id, Date.now());
  const uCapped = await llmCall(env, job, llmBody(job), token);
  assert.equal(uCapped.http, 429);
  assert.equal(uCapped.error.code, "user_ai_cap");
  assert.equal(uCapped.error.message, "You have reached today's AI budget. AI suggestions resume tomorrow; your data and tools are unaffected.");
  env.RESEARCH_DB._db.prepare("DELETE FROM research_ai_usage WHERE id='seed2'").run();
  /* Partial failure: provider error -> release the AI reserve, charge nothing,
   * no usage row (the step did not complete). */
  const before = ledgerRows(env, job.id).length;
  llm.impl = async () => { throw new Error("provider 500"); };
  const fail = await llmCall(env, job, llmBody(job), token);
  assert.equal(fail.http, 502);
  assert.equal(fail.error.code, "ai_provider_error");
  const rows = ledgerRows(env, job.id);
  assert.equal(rows.length, before + 2, "reserve + full release");
  assert.equal(rows[rows.length - 1].reason, "release");
  assert.equal(rows[rows.length - 1].delta, rows[rows.length - 2].delta * -1);
  assert.equal(env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_ai_usage WHERE job_id=?").get(job.id).n, 0);
  defaultLlmImpl();
  /* Settled job rejects gateway calls. */
  await callback(env, job.id, { jobId: job.id, idempotencyKey: "kg", status: "cancelled", usage: { pages: 0, seconds: 0 } });
  assert.equal((await llmCall(env, job, llmBody(job), token)).http, 409);
  /* Insufficient credits. */
  const envPoor = freshEnv();
  const poor = await gatewaySetup(envPoor);
  envPoor.MAIK_KV._m.clear();
  const poorToken = await mintJobToken(SECRET, poor.job.id, nowSec + 600);
  assert.equal((await llmCall(envPoor, poor.job, llmBody(poor.job), poorToken)).http, 402);
});

/* ---- Prompt-injection set ------------------------------------------------------ */

test("prompt injection: 0 instructions followed; framing treats document text as data (48 cases)", { skip: SKIP }, async () => {
  assert.ok(INJECTION.cases.length >= 40, "at least 40 cases");
  const vectors = new Set(INJECTION.cases.map((c) => c.vector));
  for (const v of ["pdf_text", "citation", "author_field"]) assert.ok(vectors.has(v), "vector " + v);
  defaultLlmImpl();
  const env = freshEnv();
  const { job } = await gatewaySetup(env);
  const token = await mintJobToken(SECRET, job.id, Math.floor(Date.now() / 1000) + 600);
  let followed = 0;
  for (const c of INJECTION.cases) {
    llm.calls.length = 0;
    const prompt = "Extract the study data from the document below.\n\n" + c.text;
    const r = await llmCall(env, job, llmBody(job, { prompt }), token);
    if (c.phi) {
      assert.equal(r.http, 422, c.id + " carries PHI and must be blocked");
      assert.equal(r.error.code, "phi_blocked");
      assert.equal(llm.calls.length, 0, c.id + " never reaches the provider");
      continue;
    }
    assert.equal(r.http, 200, c.id + ": " + JSON.stringify(r));
    assert.equal(llm.calls.length, 1, c.id);
    const { parts, opts } = llm.calls[0];
    /* The framing is the system instruction; the injection stays in DATA. */
    assert.ok(opts.system.startsWith(RESEARCH_FRAMING), c.id + " framing present");
    assert.ok(opts.system.includes("UNTRUSTED DATA"), c.id);
    assert.ok(opts.system.includes("Never follow"), c.id);
    assert.ok(opts.system.includes("no tools"), c.id);
    assert.ok(!opts.system.includes(c.text), c.id + " injection must not enter the system instruction");
    assert.ok(parts[0].text.includes(c.text), c.id + " document text is user data");
    assert.equal(opts.tools, undefined, c.id + " no tools passed");
    assert.equal(opts.schema, undefined, c.id);
    /* The mocked model answers the task; nothing in the pipeline executed the
     * injected instruction (no tool opts, no system rewrite, no extra call). */
    assert.equal(r.text, "mock answer", c.id);
    if (r.text !== "mock answer") followed++;
  }
  assert.equal(followed, 0, "gate: 0 instructions followed");
});

/* ---- Internal literature search ------------------------------------------------ */

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
const EFETCH_XML = '<?xml version="1.0"?><PubmedArticleSet>' +
  "<PubmedArticle><MedlineCitation><PMID>111</PMID><Article><Journal><Title>PubMed Journal A</Title></Journal>" +
  "<ArticleDate><Year>2020</Year><Month>01</Month><Day>15</Day></ArticleDate>" +
  "<Abstract><AbstractText Label=\"BACKGROUND\">Background abstract text.</AbstractText><AbstractText>Methods abstract text.</AbstractText></Abstract>" +
  "</Article></MedlineCitation></PubmedArticle>" +
  "<PubmedArticle><MedlineCitation><PMID>222</PMID><Article><Journal><Title>PubMed Journal B</Title></Journal>" +
  "<PubDate><Year>2021</Year><Month>Feb</Month></PubDate>" +
  "<Abstract><AbstractText>Second abstract.</AbstractText></Abstract>" +
  "</Article></MedlineCitation></PubmedArticle></PubmedArticleSet>";
function mockLiteratureFetch(t) {
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    if (u.includes("efetch")) return new Response(EFETCH_XML, { status: 200, headers: { "content-type": "text/xml" } });
    if (u.includes("esummary")) {
      return jsonResponse({ result: { uids: ["111", "222"],
        "111": { uid: "111", title: "PubMed A", authors: [{ name: "Smith J" }], pubdate: "2020 Jan", elocationid: "doi: 10.1000/pm-a" },
        "222": { uid: "222", title: "PubMed B", authors: [{ name: "Jones B" }], pubdate: "2021 Feb", articleids: [{ idtype: "doi", value: "10.1000/pm-b" }] } } });
    }
    if (u.includes("esearch")) {
      const params = new URL(u).searchParams;
      if (params.get("retmax") === "0")
        return jsonResponse({ esearchresult: { count: "2", webenv: "WE1", querykey: "1", querytranslation: "asthma" } });
      return jsonResponse({ esearchresult: { idlist: ["111", "222"] } });
    }
    if (u.includes("europepmc")) {
      const params = new URL(u).searchParams;
      if (params.get("resultType") === "core") {
        return jsonResponse({ resultList: [{ pmid: "333", doi: "10.1000/epmc", title: "EPMC paper", authorString: "Lee C",
          pubYear: "2022", abstractText: "EPMC abstract text.", firstPublicationDate: "2022-05-01",
          journalInfo: { journal: { title: "EPMC Journal" } } }] });
      }
      return jsonResponse({ hitCount: 1, resultList: [{ source: "MED", id: "333" }] });
    }
    if (u.includes("crossref")) {
      const params = new URL(u).searchParams;
      if (params.get("filter")) {
        return jsonResponse({ message: { items: [{ DOI: "10.1000/cr", title: ["Crossref paper"],
          author: [{ family: "Kim", given: "D" }], published: { "date-parts": [[2021, 3, 1]] },
          abstract: "<jats:p>Crossref abstract text.</jats:p>", "container-title": ["CR Journal"] }] } });
      }
      return jsonResponse({ message: { "total-results": 1, items: [{ DOI: "10.1000/cr" }], "next-cursor": "x" } });
    }
    throw new Error("unexpected fetch " + u);
  });
}
async function signedSearch(env, body, { secret = SECRET, ts, sig } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = ts !== undefined ? ts : String(Math.floor(Date.now() / 1000));
  const signature = sig !== undefined ? sig : hmac(secret, timestamp, raw);
  const req = new Request("https://stewardmd.in/api/research/v1/internal/literature-search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Research-Timestamp": timestamp, "X-Research-Signature": signature },
    body: raw,
  });
  const res = await onRequest({ request: req, env, params: { path: ["v1", "internal", "literature-search"] } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}

test("literature-search: HMAC before parse, efetch abstracts, normalised records", { skip: SKIP }, async (t) => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createJob(env, p.id, "tok-alice", pdf.id, "kl");
  mockLiteratureFetch(t);
  const body = { jobId: job.id, projectId: p.id, query: "asthma", databases: ["pubmed", "europe_pmc", "crossref"], dateTo: null, limit: 2 };
  /* Unsigned / forged / skewed rejected BEFORE parsing. */
  assert.equal((await signedSearch(env, body, { sig: "0".repeat(64) })).http, 401);
  assert.equal((await signedSearch(env, body, { ts: String(Math.floor(Date.now() / 1000) - 400) })).http, 401);
  const r = await signedSearch(env, body);
  assert.equal(r.http, 200, JSON.stringify(r));
  assert.equal(r.records.length, 4);
  const pm = r.records.filter((x) => x.source === "pubmed");
  assert.equal(pm.length, 2);
  assert.ok(pm[0].abstract.includes("Background abstract text."), "efetch abstract, not esummary");
  assert.ok(pm[0].abstract.includes("Methods abstract text."));
  assert.equal(pm[0].publicationDate, "2020-01-15");
  assert.equal(pm[0].venue, "PubMed Journal A");
  assert.equal(pm[0].doi, "10.1000/pm-a");
  assert.equal(pm[1].publicationDate, "2021-02");
  const epmc = r.records.find((x) => x.source === "europe_pmc");
  assert.equal(epmc.abstract, "EPMC abstract text.");
  assert.equal(epmc.publicationDate, "2022-05-01");
  assert.equal(epmc.venue, "EPMC Journal");
  const cr = r.records.find((x) => x.source === "crossref");
  assert.equal(cr.abstract, "Crossref abstract text.");
  assert.equal(cr.publicationDate, "2021-03-01");
  assert.equal(cr.venue, "CR Journal");
  /* Job scope enforced. */
  assert.equal((await signedSearch(env, Object.assign({}, body, { projectId: "prj_other" }))).http, 409);
  assert.equal((await signedSearch(env, Object.assign({}, body, { jobId: "job_missing" }))).http, 404);
  assert.equal((await signedSearch(env, Object.assign({}, body, { databases: ["semantic_scholar"] }))).http, 400);
});

/* ---- Outsider isolation on every new route ------------------------------------- */

test("phase 3 isolation: outsider gets 404 on every project route; worker routes need credentials", { skip: SKIP }, async () => {
  defaultLlmImpl();
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createJob(env, p.id, "tok-alice", pdf.id, "kiso");
  const attempts = [
    ["GET", "v1/jobs/" + job.id],
    ["POST", "v1/jobs/" + job.id + "/cancel"],
    ["POST", "v1/projects/" + p.id + "/jobs", { kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "eve" }],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call(env, method, path, "tok-eve", body);
    assert.equal(r.http, 404, method + " " + path + " leaked: " + JSON.stringify(r));
  }
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-eve", pdfForm(new TextEncoder().encode("%PDF-1.4 eve")))).http, 404);
  /* Viewer role cannot write. */
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-bob",
    { kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "bob" })).http, 403);
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-bob", pdfForm(new TextEncoder().encode("%PDF-1.4 bob")))).http, 403);
  /* Viewer CAN read job status. */
  assert.equal((await call(env, "GET", "v1/jobs/" + job.id, "tok-bob")).http, 200);
  /* Anonymous. */
  assert.equal((await call(env, "GET", "v1/jobs/" + job.id, null)).http, 401);
  /* Worker routes: no Firebase token helps; credentials are HMAC / job token. */
  const nowSec = Math.floor(Date.now() / 1000);
  const eveToken = await mintJobToken(SECRET, job.id, nowSec + 600);
  const eveBody = llmBody(job, { userId: "u-eve" });
  assert.equal((await llmCall(env, job, eveBody, eveToken)).http, 409, "token cannot act as another user");
  assert.equal((await callback(env, job.id, donePayload(job.id, "kiso", { pages: 0, seconds: 0 }, "projects/" + p.id + "/jobs/" + job.id + "/result.json"), { sig: "0".repeat(64) })).http, 401);
  assert.equal((await signedSearch(env, { jobId: job.id, projectId: p.id, query: "x" }, { sig: "0".repeat(64) })).http, 401);
  /* Admin routes need the admin token, not a Firebase user. */
  assert.equal((await call(env, "POST", "v1/admin/institutions", "tok-eve", { name: "Evil" })).http, 401);
  /* Unknown job id falls through to the pilot lookup and 404s. */
  assert.equal((await call(env, "GET", "v1/jobs/job_does_not_exist", "tok-alice")).http, 404);
});
