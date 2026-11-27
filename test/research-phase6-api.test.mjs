import "./helpers/json-import-attr.mjs";
/* ResearchMD Phase 6 server-side API tests (node:test, no network).
 * Covers: 0005 migration + rollback + mirror parity; 5C evidence upload /
 * owner approval, IPD config + residency lock, the upload gate (403 before
 * R2), the deterministic identifier scanner per tier, envelope encryption
 * round-trip + wrong-key failure, access log on every read, breach log SLA
 * timers, stats_model jobs carrying {ipdApproved:true, evidenceId} only when
 * gated (+ callback dispatch), the gateway IPD refusal; 6.1 purchase via the
 * stubbed MaiK billing route, institution credits + invoicing, member pool
 * draw; 6.3 cost report totals + CSV + pricing note; 6.5 institution
 * workspaces, seats, roles, projects, onboarding; 5D.1 templates; 5B.3
 * journal seed parity + match; 5B.5 reviewer responses with the mandatory
 * manuscript link; outsider isolation on every new route.
 *
 * Mocking pattern identical to test/research-phase3-api.test.mjs: mock.module
 * on ../functions/_fbauth.js, the LLM facade and the MaiK billing route;
 * node:sqlite D1-shaped shim behind the real schema; in-memory R2/queue/KV.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phase6-api.test.mjs
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
  "tok-admin": { sub: "u-admin", email: "owner@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null,
    verifiedClaimsFor: async (request) => CLAIMS[((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""))] || null },
});
const llm = { calls: [], impl: async () => "mock answer" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});
/* The MaiK purchase/payment route is STUBBED: the research purchase module
 * must forward to it (no new provider) and pass its response through. */
const billing = { calls: [], response: { ok: true, orderId: "order_test", amount: 19900, currency: "INR", plan: "tokens:plus" } };
mock.module("../functions/api/billing/[[path]].js", {
  namedExports: {
    onRequest: async (ctx) => {
      const url = new URL(ctx.request.url);
      const body = await ctx.request.json();
      billing.calls.push({ path: url.pathname, body, auth: ctx.request.headers.get("authorization") });
      return new Response(JSON.stringify(billing.response), { status: 200, headers: { "content-type": "application/json" } });
    },
    plans: () => ({ tokens: {
      boost: { mt: 10000, amount: 4900, label: "Boost" },
      plus: { mt: 40000, amount: 19900, label: "Plus" },
      power: { mt: 100000, amount: 49900, label: "Power" },
    } }),
    fulfilPurchase: async () => ({ ok: true }),
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { mintJobToken } = await import("../functions/api/research/_gateway.js");
const { encryptSnapshot, decryptSnapshot, scanIpdIdentifiers, validateStatsMessage } = await import("../functions/api/research/_ipd.js");
const { STUDY_TEMPLATES } = await import("../functions/api/research/_templates.js");
const { JOURNAL_SEED } = await import("../functions/api/research/_journals.js");
const { verhoeffCheckDigit } = await import("../functions/api/research/_phi.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const SEED_JSON = JSON.parse(readFileSync(new URL("../docs/research/contracts/phase-6/journals.seed.json", import.meta.url), "utf8"));
const SECRET = "test-secret";
const KEK = "test-kek-0123456789abcdef";

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
/* Binary-safe R2 shim: IPD ciphertext must round-trip byte-for-byte. */
function r2Shim() {
  const objects = new Map();
  return {
    _objects: objects,
    async put(key, value) { objects.set(key, typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)); },
    async get(key) {
      if (!objects.has(key)) return null;
      const bytes = objects.get(key);
      return {
        text: async () => new TextDecoder().decode(bytes),
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        body: bytes,
      };
    },
    async delete(key) { objects.delete(key); },
    async head(key) { return objects.has(key) ? { key } : null; },
  };
}
function queueShim() { return { _messages: [], failNext: false, async send(m) { if (this.failNext) { this.failNext = false; throw new Error("queue down"); } this._messages.push(m); } }; }
function kvShim() {
  const m = new Map();
  return { _m: m,
    async get(key, type) { const v = m.get(key); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); } };
}
function freshEnv({ r2 = true, queue = true, kek = KEK } = {}) {
  const D = d1();
  D._db.exec(SCHEMA);
  const env = {
    RESEARCH_MODE: "pilot", RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_ADMIN_TOKEN: "admin-test-token",
    RESEARCH_CALLBACK_SECRET: SECRET,
    OWNER_EMAILS: "owner@example.com",
    MAIK_KV: kvShim(),
  };
  if (kek) env.RESEARCH_IPD_KEK = kek;
  if (r2) env.RESEARCH_R2 = r2Shim();
  if (queue) env.RESEARCH_QUEUE = queueShim();
  return env;
}
function fundWallet(env, email, inr) {
  env.MAIK_KV._m.set("maik:credit:em:" + email, JSON.stringify({ balance: inr, day: "", chargedToday: 0 }));
}
function walletBalance(env, email) {
  const raw = env.MAIK_KV._m.get("maik:credit:em:" + email);
  return raw ? JSON.parse(raw).balance : 0;
}
async function call(env, method, path, token, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
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
async function callText(env, path, token, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://stewardmd.in/api/research/" + path, { method: "GET", headers });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) } });
  return { http: res.status, text: await res.text(), contentType: res.headers.get("content-type") };
}
async function callAdmin(env, method, path, body, { adminToken = "admin-test-token", firebase } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (adminToken) headers["x-research-admin-token"] = adminToken;
  if (firebase) headers.Authorization = "Bearer " + firebase;
  const req = new Request("https://stewardmd.in/api/research/" + path,
    { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const res = await onRequest({ request: req, env, params: { path: path.split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
async function makeProject(env, token, title) {
  const r = await call(env, "POST", "v1/projects", token, { title: title || "Phase 6 review" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
function pdfForm(bytes, name) {
  const form = new FormData();
  form.append("file", new File([bytes], name || "paper.pdf", { type: "application/pdf" }), name || "paper.pdf");
  return form;
}
async function uploadPdf(env, pid, token, suffix) {
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic " + (suffix || Math.random().toString(36).slice(2)));
  const r = await callForm(env, "v1/projects/" + pid + "/pdfs", token, pdfForm(bytes));
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.pdf;
}
async function createPdfJob(env, pid, token, pdfId, key) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/jobs", token,
    { kind: "pdf_extract", pdfId, idempotencyKey: key || "k-" + Math.random().toString(36).slice(2) });
  assert.equal(r.http, 202, JSON.stringify(r));
  return r.job;
}
function hmac(secret, ts, raw) { return createHmac("sha256", secret).update(ts + "." + raw).digest("hex"); }
async function statsCallback(env, jobId, payload, { secret = SECRET, ts, sig } = {}) {
  const rawBody = JSON.stringify(payload);
  const timestamp = ts !== undefined ? ts : String(Math.floor(Date.now() / 1000));
  const signature = sig !== undefined ? sig : hmac(secret, timestamp, rawBody);
  const path = "v1/jobs/" + jobId + "/callback";
  const req = new Request("https://stewardmd.in/api/research/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Research-Timestamp": timestamp, "X-Research-Signature": signature },
    body: rawBody,
  });
  const res = await onRequest({ request: req, env, params: { path: path.split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
function ledgerRows(env, jobId) {
  return env.RESEARCH_DB._db.prepare("SELECT * FROM research_credit_ledger WHERE job_id=? ORDER BY rowid ASC").all(jobId);
}

/* ---- IPD helpers -------------------------------------------------------------- */
async function uploadEvidence(env, pid, token, kind, extra = {}) {
  const form = new FormData();
  form.append("file", new File([new TextEncoder().encode("%PDF-1.4 evidence " + kind)], kind + ".pdf", { type: "application/pdf" }), kind + ".pdf");
  form.append("kind", kind);
  if (extra.jurisdiction) form.append("jurisdiction", extra.jurisdiction);
  if (extra.expiresTs) form.append("expiresTs", String(extra.expiresTs));
  const r = await callForm(env, "v1/projects/" + pid + "/ipd-evidence", token, form);
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.evidence;
}
async function approveEvidence(env, eid, token = "tok-alice") {
  const r = await call(env, "POST", "v1/ipd-evidence/" + eid + "/approve", token);
  assert.equal(r.http, 200, JSON.stringify(r));
  return r.evidence;
}
const IN_CONFIG = {
  dataRegion: "IN", jurisdictions: ["IN"], identifiabilityTier: "coded_pseudonymised",
  legalBasis: { IN: "consent" }, attestation: { responsibility: true }, agreements: {},
};
const IPD_CSV = "patient_id,age,follow_up_time,event\nP001,45,12.5,1\nP002,60,8,0\n";
function csvForm(text, name) {
  const form = new FormData();
  form.append("file", new File([text], name || "ipd.csv", { type: "text/csv" }), name || "ipd.csv");
  return form;
}
/* Project with IN config + owner-approved ethics and consent evidence. */
async function ipdReady(env, token = "tok-alice") {
  const p = await makeProject(env, token);
  const cfg = await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", token, IN_CONFIG);
  assert.equal(cfg.http, 200, JSON.stringify(cfg));
  const ethics = await uploadEvidence(env, p.id, token, "irb_approval", { jurisdiction: "IN" });
  const consent = await uploadEvidence(env, p.id, token, "consent_basis", { jurisdiction: "IN" });
  await approveEvidence(env, ethics.id, token);
  await approveEvidence(env, consent.id, token);
  return { p, ethics, consent };
}
async function uploadIpdCsv(env, pid, token, text) {
  return callForm(env, "v1/projects/" + pid + "/ipd-uploads", token, csvForm(text || IPD_CSV));
}
function defaultLlmImpl() {
  llm.impl = async (env, parts, maxTokens, opts) => {
    if (opts && opts.meta) { opts.meta.usage = { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 0 }; opts.meta.model = opts.model; }
    return "mock answer";
  };
  llm.calls.length = 0;
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
    tier: "T1", system: "You extract study data.",
    prompt: "Extract the sample size from: We enrolled 120 adults.", maxOutputTokens: 2000, purpose: "extraction" }, over || {});
}

/* ---- 0005 migration + rollback + mirror ---------------------------------------- */
test("0005 applies on live 0001-0004, rolls back cleanly, mirror matches", { skip: SKIP }, async () => {
  const m = ["phase-1/0001_research_v1.sql", "phase-2/0002_research_v2.sql",
    "phase-3/0003_research_v3.sql", "phase-3/0004_research_v4.sql", "phase-6/0005_research_v5.sql"]
    .map((f) => readFileSync(new URL("../docs/research/contracts/" + f, import.meta.url), "utf8"));
  const rb = readFileSync(new URL("../docs/research/contracts/phase-6/0005_rollback.sql", import.meta.url), "utf8");
  const db = new DatabaseSync(":memory:");
  for (const sql of m) db.exec(sql);
  const newTables = ["research_ipd_config", "research_ipd_evidence", "research_ipd_datasets",
    "research_ipd_access_log", "research_security_incidents", "research_invoices",
    "research_institution_onboarding", "research_journals", "research_reviewer_comments",
    "research_reviewer_responses", "research_stats_jobs"];
  const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of newTables) assert.ok(tables().includes(t), "0005 created " + t);
  const cols = (t) => db.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name);
  assert.ok(cols("research_projects").includes("data_region"));
  assert.ok(cols("research_projects").includes("institution_id"));
  assert.ok(cols("research_institutions").includes("seats"));
  assert.ok(cols("research_institution_members").includes("role"));
  /* Data survives the forward migration; rollback removes only 0005 shapes. */
  const now = Date.now();
  db.prepare("INSERT INTO research_projects (id,owner_uid,title,created_ts,updated_ts) VALUES ('p1','u1','t',?,?)").run(now, now);
  db.prepare("INSERT INTO research_studies (id,project_id,measure,created_ts,updated_ts) VALUES ('st1','p1','OR',?,?)").run(now, now);
  db.prepare("INSERT INTO research_ipd_datasets (id,project_id,version,storage_key,sha256,bytes,identifiability_tier,data_region,evidence_id,envelope_json,created_by,created_ts) VALUES ('d1','p1',1,'k','s',10,'coded_pseudonymised','IN','e1','{}','u1',?)").run(now);
  db.exec(rb);
  const after = tables();
  for (const t of newTables) assert.ok(!after.includes(t), "rollback dropped " + t);
  for (const t of ["research_projects", "research_studies", "research_job_runs", "research_credit_ledger", "research_institutions"])
    assert.ok(after.includes(t), "rollback kept live table " + t);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_studies").get().n, 1);
  const afterCols = (t) => db.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name);
  assert.ok(!afterCols("research_projects").includes("data_region"));
  assert.ok(!afterCols("research_institution_members").includes("role"));
  /* Mirror parity: same tables (minus pilot-only) and same columns. */
  const PILOT = new Set(["research_jobs", "research_meta_analyses", "research_artifacts", "research_search_ids"]);
  const mirror = new DatabaseSync(":memory:");
  mirror.exec(SCHEMA);
  const live = new DatabaseSync(":memory:");
  for (const sql of m) live.exec(sql);
  live.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0006_research_v6.sql", import.meta.url), "utf8"));
  live.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0007_research_v7.sql", import.meta.url), "utf8"));
  live.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0008_research_v8.sql", import.meta.url), "utf8"));
  live.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0009_research_v9.sql", import.meta.url), "utf8"));
  const tset = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name).filter((n) => !PILOT.has(n)).sort();
  assert.deepEqual(tset(mirror), tset(live));
  for (const t of tset(mirror)) {
    const mc = mirror.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name).sort();
    const lc = live.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name).sort();
    assert.deepEqual(mc, lc, "column parity for " + t);
  }
});

/* ---- 5C evidence + config ------------------------------------------------------- */
test("IPD evidence: upload, owner-only approval, reject, expiry, role gates", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const ev = await uploadEvidence(env, p.id, "tok-alice", "irb_approval", { jurisdiction: "IN" });
  assert.equal(ev.status, "pending");
  assert.equal(ev.kind, "irb_approval");
  assert.ok(env.RESEARCH_R2._objects.has(ev.r2Key));
  /* Editor may upload but NOT approve; owner approves. */
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "editor" });
  const ev2 = await uploadEvidence(env, p.id, "tok-bob", "consent_basis");
  assert.equal((await call(env, "POST", "v1/ipd-evidence/" + ev2.id + "/approve", "tok-bob")).http, 403);
  const approved = await approveEvidence(env, ev.id);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedBy, "u-alice");
  assert.ok(approved.approvedTs > 0);
  assert.equal((await call(env, "POST", "v1/ipd-evidence/" + ev.id + "/approve", "tok-alice")).http, 409);
  const rejected = await call(env, "POST", "v1/ipd-evidence/" + ev2.id + "/reject", "tok-alice");
  assert.equal(rejected.http, 200);
  assert.equal(rejected.evidence.status, "rejected");
  /* List + one + file; outsider 404. */
  const list = await call(env, "GET", "v1/projects/" + p.id + "/ipd-evidence", "tok-alice");
  assert.equal(list.evidence.length, 2);
  assert.equal((await call(env, "GET", "v1/ipd-evidence/" + ev.id, "tok-alice")).http, 200);
  const file = await callText(env, "v1/ipd-evidence/" + ev.id + "/file", "tok-alice");
  assert.equal(file.http, 200);
  assert.ok(file.text.includes("%PDF-"));
  assert.equal((await call(env, "GET", "v1/ipd-evidence/" + ev.id, "tok-eve")).http, 404);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/ipd-evidence", "tok-eve")).http, 404);
  /* Bad kind / file type. */
  const badForm = new FormData();
  badForm.append("file", new File([new TextEncoder().encode("%PDF-1.4 x")], "x.pdf", { type: "application/pdf" }), "x.pdf");
  badForm.append("kind", "not_a_kind");
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/ipd-evidence", "tok-alice", badForm)).http, 400);
  const txtForm = new FormData();
  txtForm.append("file", new File(["hello"], "x.txt", { type: "text/plain" }), "x.txt");
  txtForm.append("kind", "other");
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/ipd-evidence", "tok-alice", txtForm)).http, 415);
});

test("IPD config: owner-only, validation, residency pin locked", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "editor" });
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-bob", IN_CONFIG)).http, 403);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice",
    Object.assign({}, IN_CONFIG, { dataRegion: "MARS" }))).http, 400);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice",
    Object.assign({}, IN_CONFIG, { jurisdictions: [] }))).http, 400);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice",
    Object.assign({}, IN_CONFIG, { legalBasis: { IN: "consent", US: "preparatory_to_research" }, jurisdictions: ["IN", "US"] }))).http, 400);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice",
    Object.assign({}, IN_CONFIG, { attestation: { responsibility: false } }))).http, 400);
  const ok = await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice", IN_CONFIG);
  assert.equal(ok.http, 200, JSON.stringify(ok));
  assert.equal(ok.config.dataRegion, "IN");
  const pin = env.RESEARCH_DB._db.prepare("SELECT data_region FROM research_projects WHERE id=?").get(p.id);
  assert.equal(pin.data_region, "IN");
  /* Region change after lock -> 409; same-region re-attestation allowed. */
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice",
    Object.assign({}, IN_CONFIG, { dataRegion: "EU" }))).http, 409);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice", IN_CONFIG)).http, 200);
  const got = await call(env, "GET", "v1/projects/" + p.id + "/ipd-config", "tok-alice");
  assert.equal(got.config.identifiabilityTier, "coded_pseudonymised");
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/ipd-config", "tok-eve")).http, 404);
});

/* ---- 5C upload gate + scanner ----------------------------------------------------- */
test("IPD upload refused without approved owner evidence (403 before R2)", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  /* No config at all. */
  const noCfg = await uploadIpdCsv(env, p.id, "tok-alice");
  assert.equal(noCfg.http, 403);
  assert.equal(noCfg.error.code, "ipd_gate");
  assert.equal(env.RESEARCH_R2._objects.size, 0, "no R2 write before the gate passes");
  /* Config but no evidence. */
  await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice", IN_CONFIG);
  const noEv = await uploadIpdCsv(env, p.id, "tok-alice");
  assert.equal(noEv.http, 403);
  assert.ok(noEv.missing.includes("ethics_approval"));
  assert.ok(noEv.missing.includes("consent_basis"));
  /* Pending evidence is not enough. */
  const ethics = await uploadEvidence(env, p.id, "tok-alice", "irb_approval");
  const pending = await uploadIpdCsv(env, p.id, "tok-alice");
  assert.equal(pending.http, 403);
  await approveEvidence(env, ethics.id);
  const consent = await uploadEvidence(env, p.id, "tok-alice", "consent_basis");
  await approveEvidence(env, consent.id);
  /* Expired evidence fails the gate. */
  env.RESEARCH_DB._db.prepare("UPDATE research_ipd_evidence SET expires_ts=? WHERE id=?").run(Date.now() - 1000, ethics.id);
  const expired = await uploadIpdCsv(env, p.id, "tok-alice");
  assert.equal(expired.http, 403);
  assert.ok(expired.missing.includes("ethics_approval"));
  env.RESEARCH_DB._db.prepare("UPDATE research_ipd_evidence SET expires_ts=NULL WHERE id=?").run(ethics.id);
  /* Gate passes: encrypted snapshot, access log, metadata. */
  const ok = await uploadIpdCsv(env, p.id, "tok-alice");
  assert.equal(ok.http, 201, JSON.stringify(ok));
  assert.equal(ok.dataset.containsIpd, true);
  assert.equal(ok.dataset.rowCount, 2);
  assert.equal(ok.dataset.evidenceId, ethics.id);
  assert.equal(ok.dataset.dataRegion, "IN");
  assert.ok(env.RESEARCH_R2._objects.has(ok.dataset.storageKey));
  const stored = env.RESEARCH_R2._objects.get(ok.dataset.storageKey);
  assert.notEqual(new TextDecoder().decode(stored), IPD_CSV, "R2 holds ciphertext, not plaintext");
  const log = env.RESEARCH_DB._db.prepare("SELECT * FROM research_ipd_access_log WHERE project_id=?").all(p.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].action, "upload");
  assert.equal(log[0].result, "ok");
  /* Role gates. */
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  assert.equal((await uploadIpdCsv(env, p.id, "tok-bob")).http, 403);
  assert.equal((await uploadIpdCsv(env, p.id, "tok-eve")).http, 404);
  /* KEK unconfigured -> 503. */
  const envNoKek = freshEnv({ kek: "" });
  const { p: p2 } = await ipdReady(envNoKek);
  assert.equal((await uploadIpdCsv(envNoKek, p2.id, "tok-alice")).http, 503);
});

test("IPD scanner: Safe Harbor / LDS / coded tiers block the right identifiers", { skip: SKIP }, async () => {
  const env = freshEnv();
  /* GLOBAL_DEID + anonymised_deid needs deid evidence + noActualKnowledge. */
  const p = await makeProject(env, "tok-alice");
  const deidCfg = { dataRegion: "GLOBAL_DEID", jurisdictions: [], identifiabilityTier: "anonymised_deid",
    legalBasis: {}, attestation: { responsibility: true, noActualKnowledge: true }, agreements: {} };
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/ipd-config", "tok-alice", deidCfg)).http, 200);
  const ethics = await uploadEvidence(env, p.id, "tok-alice", "irb_approval");
  const sh = await uploadEvidence(env, p.id, "tok-alice", "safe_harbor");
  await approveEvidence(env, ethics.id);
  await approveEvidence(env, sh.id);
  const blocks = [
    "code,email,outcome\nX1,a@b.com,1\n",
    "code,admission_date,outcome\nX1,2024-01-15,1\n",
    "code,age,outcome\nX1,95,1\n",
    "patient_id,age,outcome\nP1,45,1\n",
    "code,phone,outcome\nX1,+1 415-555-2671,1\n",
    "code,notes,outcome\nX1,http://hospital.example/patient,1\n",
  ];
  for (const csv of blocks) {
    const r = await uploadIpdCsv(env, p.id, "tok-alice", csv);
    assert.equal(r.http, 422, csv + " -> " + JSON.stringify(r));
    assert.equal(r.error.code, "ipd_identifiers");
    assert.ok(r.hits.length >= 1);
    for (const h of r.hits) assert.deepEqual(Object.keys(h).sort(), ["column", "rule"]);
  }
  /* Aadhaar with a valid Verhoeff checksum blocks; a random 12-digit number does not. */
  const base = "12345678901";
  const aadhaar = (base + verhoeffCheckDigit(base)).replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
  assert.equal((await uploadIpdCsv(env, p.id, "tok-alice", "code,id\nX1," + aadhaar + "\n")).http, 422);
  /* Clean de-identified rows pass. */
  const clean = await uploadIpdCsv(env, p.id, "tok-alice", "code,age_group,outcome\nX1,40-49,1\nX2,50-59,0\n");
  assert.equal(clean.http, 201, JSON.stringify(clean));
  /* LDS: dates and ZIP allowed, email blocked. */
  const p2 = await makeProject(env, "tok-alice", "LDS");
  const ldsCfg = { dataRegion: "US", jurisdictions: ["US"], identifiabilityTier: "hipaa_lds",
    legalBasis: { US: "dua" }, attestation: { responsibility: true }, agreements: { baa: true } };
  assert.equal((await call(env, "POST", "v1/projects/" + p2.id + "/ipd-config", "tok-alice", ldsCfg)).http, 200);
  for (const kind of ["irb_approval", "baa", "dua"]) {
    const e = await uploadEvidence(env, p2.id, "tok-alice", kind, { jurisdiction: "US" });
    await approveEvidence(env, e.id);
  }
  const ldsOk = await uploadIpdCsv(env, p2.id, "tok-alice", "subject_code,admission_date,zip,outcome\nC1,2024-01-15,560001,1\n");
  assert.equal(ldsOk.http, 201, JSON.stringify(ldsOk));
  const ldsBad = await uploadIpdCsv(env, p2.id, "tok-alice", "subject_code,email\nC1,a@b.com\n");
  assert.equal(ldsBad.http, 422);
  /* Coded tier: patient codes and dates pass, MRN blocks. */
  const { p: p3 } = await ipdReady(env);
  assert.equal((await uploadIpdCsv(env, p3.id, "tok-alice", IPD_CSV)).http, 201);
  const mrn = await uploadIpdCsv(env, p3.id, "tok-alice", "mrn,age\n483920,45\n");
  assert.equal(mrn.http, 422);
  /* Unit-level scanner: tier differences on the same header. */
  assert.ok(scanIpdIdentifiers(["admission_date"], [["2024-01-15"]], "anonymised_deid").length > 0);
  assert.equal(scanIpdIdentifiers(["admission_date"], [["2024-01-15"]], "hipaa_lds").length, 0);
  assert.equal(scanIpdIdentifiers(["patient_id"], [["P1"]], "coded_pseudonymised").length, 0);
});

/* ---- 5C encryption + access log ----------------------------------------------------- */
test("IPD encryption round-trip, wrong-key failure, access log on every read", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p } = await ipdReady(env);
  const up = await uploadIpdCsv(env, p.id, "tok-alice");
  assert.equal(up.http, 201, JSON.stringify(up));
  const ds = up.dataset;
  /* Direct crypto round-trip (binary-safe). */
  const bytes = new TextEncoder().encode(IPD_CSV);
  const enc = await encryptSnapshot(env, bytes);
  const dec = await decryptSnapshot(env, enc.envelope, enc.ciphertext);
  assert.equal(new TextDecoder().decode(dec), IPD_CSV);
  /* Wrong KEK fails the unwrap. */
  await assert.rejects(() => decryptSnapshot({ RESEARCH_IPD_KEK: "another-kek-0123456789" }, enc.envelope, enc.ciphertext));
  /* Snapshot read returns the exact plaintext and logs EVERY read. */
  const r1 = await callText(env, "v1/ipd-datasets/" + ds.id + "/snapshot", "tok-alice", { "cf-connecting-ip": "203.0.113.7" });
  assert.equal(r1.http, 200);
  assert.equal(r1.text, IPD_CSV);
  assert.equal(r1.contentType, "text/csv; charset=utf-8");
  await callText(env, "v1/ipd-datasets/" + ds.id + "/snapshot", "tok-alice");
  const log = env.RESEARCH_DB._db.prepare("SELECT * FROM research_ipd_access_log WHERE dataset_id=? AND action='read' ORDER BY rowid").all(ds.id);
  assert.equal(log.length, 2, "one row per read");
  assert.equal(log[0].result, "ok");
  assert.ok(log[0].ip_hash.length === 16, "hashed IP, never raw");
  assert.ok(!JSON.stringify(log).includes("203.0.113.7"));
  /* Wrong KEK at read time: stable 500 + error log row. */
  env.RESEARCH_IPD_KEK = "rotated-kek-9876543210fedcba";
  const bad = await callText(env, "v1/ipd-datasets/" + ds.id + "/snapshot", "tok-alice");
  assert.equal(bad.http, 500);
  assert.equal(JSON.parse(bad.text).error.code, "ipd_decrypt_failed");
  const errLog = env.RESEARCH_DB._db.prepare("SELECT * FROM research_ipd_access_log WHERE dataset_id=? AND result='error'").all(ds.id);
  assert.equal(errLog.length, 1);
  env.RESEARCH_IPD_KEK = KEK;
  /* Role gates: viewer cannot read rows; outsider 404; owner reads the log. */
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  assert.equal((await callText(env, "v1/ipd-datasets/" + ds.id + "/snapshot", "tok-bob")).http, 403);
  assert.equal((await callText(env, "v1/ipd-datasets/" + ds.id + "/snapshot", "tok-eve")).http, 404);
  assert.equal((await call(env, "GET", "v1/ipd-datasets/" + ds.id, "tok-bob")).http, 200, "metadata is readable");
  const accessLog = await call(env, "GET", "v1/projects/" + p.id + "/ipd-access-log", "tok-alice");
  assert.equal(accessLog.http, 200);
  assert.ok(accessLog.accessLog.length >= 4);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/ipd-access-log", "tok-bob")).http, 403);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/ipd-access-log", "tok-eve")).http, 404);
  /* Dataset list. */
  const list = await call(env, "GET", "v1/projects/" + p.id + "/ipd-datasets", "tok-alice");
  assert.equal(list.datasets.length, 1);
  assert.equal(list.datasets[0].encryption, "AES-256-GCM");
});

/* ---- 5C stats_model jobs + gateway IPD refusal ---------------------------------------- */
test("stats_model jobs carry {ipdApproved:true,evidenceId} only when gated; callback settles", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p, ethics } = await ipdReady(env);
  const up = await uploadIpdCsv(env, p.id, "tok-alice");
  const ds = up.dataset;
  const model = { family: "cox", time: "follow_up_time", event: "event", covariates: ["age"] };
  const r = await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-alice",
    { datasetId: ds.id, model, idempotencyKey: "s1" });
  assert.equal(r.http, 202, JSON.stringify(r));
  assert.deepEqual(r.job.compliance, { ipdApproved: true, evidenceId: ethics.id });
  assert.equal(r.job.containsIpd, true);
  /* Queue message exactly per job.py. */
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  const msg = env.RESEARCH_QUEUE._messages[0];
  assert.ok(validateStatsMessage(msg));
  assert.equal(msg.kind, "stats_model");
  assert.equal(msg.v, 1);
  assert.equal(msg.input.r2Key, ds.storageKey);
  assert.deepEqual(msg.input.compliance, { ipdApproved: true, evidenceId: ethics.id });
  assert.deepEqual(msg.ceilings, { maxSeconds: 240, maxRows: 100000 });
  assert.ok(Number.isInteger(msg.createdAt));
  /* Access log analysis row. */
  const log = env.RESEARCH_DB._db.prepare("SELECT * FROM research_ipd_access_log WHERE action='analysis'").all();
  assert.equal(log.length, 1);
  /* Idempotent replay; different input under the same key -> 409. */
  const replay = await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-alice",
    { datasetId: ds.id, model, idempotencyKey: "s1" });
  assert.equal(replay.http, 200);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-alice",
    { datasetId: ds.id, model: { family: "km", time: "follow_up_time", event: "event" }, idempotencyKey: "s1" })).http, 409);
  /* Gate re-check at creation: expired evidence -> 403, no message. */
  env.RESEARCH_DB._db.prepare("UPDATE research_ipd_evidence SET expires_ts=? WHERE id=?").run(Date.now() - 1, ethics.id);
  const blocked = await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-alice",
    { datasetId: ds.id, model, idempotencyKey: "s2" });
  assert.equal(blocked.http, 403);
  assert.equal(blocked.error.code, "ipd_gate");
  assert.equal(env.RESEARCH_QUEUE._messages.length, 1);
  env.RESEARCH_DB._db.prepare("UPDATE research_ipd_evidence SET expires_ts=NULL WHERE id=?").run(ethics.id);
  /* Validation + isolation. */
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-alice",
    { datasetId: "ipd_missing", model, idempotencyKey: "s3" })).http, 404);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-alice",
    { datasetId: ds.id, model: { family: "neural" }, idempotencyKey: "s3" })).http, 400);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-alice",
    { datasetId: ds.id, model, idempotencyKey: "s3", maxRows: 100001 })).http, 400);
  assert.equal((await call(env, "GET", "v1/stats-jobs/" + r.job.id, "tok-eve")).http, 404);
  assert.equal((await call(env, "GET", "v1/stats-jobs/" + r.job.id, "tok-alice")).http, 200);
  /* Cancel writes the R2 flag; settled cancel is a no-op. */
  const cancel = await call(env, "POST", "v1/stats-jobs/" + r.job.id + "/cancel", "tok-alice");
  assert.equal(cancel.http, 200);
  assert.ok(cancel.job.cancelRequestedTs > 0);
  assert.ok(env.RESEARCH_R2._objects.has("projects/" + p.id + "/jobs/" + r.job.id + "/cancel"));
  /* Callback: valid done settles via the stats dispatch (no credit movement). */
  const resultKey = "projects/" + p.id + "/jobs/" + r.job.id + "/result.json";
  const cb = await statsCallback(env, r.job.id, { jobId: r.job.id, idempotencyKey: "s1", status: "done", resultKey, usage: { pages: 0, seconds: 2.5 } });
  assert.equal(cb.http, 200, JSON.stringify(cb));
  assert.equal(cb.job.status, "succeeded");
  assert.equal(cb.job.resultR2Key, resultKey);
  assert.ok(!env.RESEARCH_R2._objects.has("projects/" + p.id + "/jobs/" + r.job.id + "/cancel"));
  assert.equal(ledgerRows(env, r.job.id).length, 0, "T0 stats job: no credits");
  const again = await statsCallback(env, r.job.id, { jobId: r.job.id, idempotencyKey: "s1", status: "done", resultKey, usage: { pages: 0, seconds: 2.5 } });
  assert.equal(again.replay, true);
  assert.equal((await statsCallback(env, r.job.id, { jobId: r.job.id, idempotencyKey: "wrong", status: "done", resultKey, usage: { pages: 0, seconds: 0 } })).http, 409);
  assert.equal((await statsCallback(env, r.job.id, { jobId: r.job.id, idempotencyKey: "s1", status: "done", resultKey, usage: { pages: 0, seconds: 0 } }, { sig: "0".repeat(64) })).http, 401);
  const settledCancel = await call(env, "POST", "v1/stats-jobs/" + r.job.id + "/cancel", "tok-alice");
  assert.equal(settledCancel.alreadySettled, true);
  /* Queue failure -> failed row, 503. */
  env.RESEARCH_QUEUE.failNext = true;
  const qf = await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-alice",
    { datasetId: ds.id, model, idempotencyKey: "sq" });
  assert.equal(qf.http, 503);
});

test("gateway refuses IPD-tagged payloads and IPD stats jobs; normal calls unaffected", { skip: SKIP }, async () => {
  defaultLlmImpl();
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createPdfJob(env, p.id, "tok-alice", pdf.id, "kg");
  const token = await mintJobToken(SECRET, job.id, Math.floor(Date.now() / 1000) + 600);
  /* Tagged payload: refused BEFORE the PHI gate and any provider call. */
  const tagged = await llmCall(env, job, llmBody(job, { containsIpd: true }), token);
  assert.equal(tagged.http, 422);
  assert.equal(tagged.error.code, "ipd_blocked");
  assert.equal(llm.calls.length, 0);
  const truthy = await llmCall(env, job, llmBody(job, { containsIpd: "yes" }), token);
  assert.equal(truthy.http, 422, "fail-closed on any truthy tag");
  const auditRows = env.RESEARCH_DB._db.prepare("SELECT * FROM research_audit_events WHERE event_type='ai_ipd_blocked'").all();
  assert.ok(auditRows.length >= 2);
  /* A valid token for an IPD stats job cannot reach the provider either. */
  const { p: p2 } = await ipdReady(env);
  const up = await uploadIpdCsv(env, p2.id, "tok-alice");
  const sj = await call(env, "POST", "v1/projects/" + p2.id + "/stats-jobs", "tok-alice",
    { datasetId: up.dataset.id, model: { family: "km", time: "follow_up_time", event: "event" }, idempotencyKey: "sg" });
  assert.equal(sj.http, 202);
  const statsToken = await mintJobToken(SECRET, sj.job.id, Math.floor(Date.now() / 1000) + 600);
  const statsCall = await llmCall(env, sj.job, llmBody(sj.job, { projectId: p2.id }), statsToken);
  assert.equal(statsCall.http, 422);
  assert.equal(statsCall.error.code, "ipd_blocked");
  assert.equal(llm.calls.length, 0);
  /* Ordinary (untagged) call still works end to end. */
  const ok = await llmCall(env, job, llmBody(job), token);
  assert.equal(ok.http, 200, JSON.stringify(ok));
  assert.equal(llm.calls.length, 1);
});

/* ---- 6.1 purchase via the MaiK route + invoicing ---------------------------------------- */
test("purchase forwards to the existing MaiK billing route (stubbed), packs read-only", { skip: SKIP }, async () => {
  const env = freshEnv();
  billing.calls.length = 0;
  const packs = await call(env, "GET", "v1/purchase/packs", "tok-alice");
  assert.equal(packs.http, 200);
  assert.ok(packs.packs.plus.mt > 0);
  assert.equal(packs.usdInrRate, 96);
  /* Order: forwarded with the caller's Authorization, response passthrough. */
  const order = await call(env, "POST", "v1/purchase/order", "tok-alice", { pack: "plus" });
  assert.equal(order.http, 200);
  assert.equal(order.orderId, "order_test");
  assert.equal(billing.calls.length, 1);
  assert.equal(billing.calls[0].path, "/api/billing/razorpay/order");
  assert.deepEqual(billing.calls[0].body, { pack: "plus" });
  assert.equal(billing.calls[0].auth, "Bearer tok-alice");
  assert.equal((await call(env, "POST", "v1/purchase/order", "tok-alice", { pack: "not_a_pack" })).http, 400);
  /* IAP verify: token packs only. */
  const iap = await call(env, "POST", "v1/purchase/iap-verify", "tok-alice",
    { platform: "apple", productId: "in.stewardmd.tokens.plus", purchaseToken: "receipt-x" });
  assert.equal(iap.http, 200);
  assert.equal(billing.calls[1].path, "/api/billing/iap/verify");
  assert.equal(billing.calls[1].body.productId, "in.stewardmd.tokens.plus");
  assert.equal((await call(env, "POST", "v1/purchase/iap-verify", "tok-alice",
    { platform: "apple", productId: "in.stewardmd.pro.monthly", purchaseToken: "x" })).http, 400);
  assert.equal((await call(env, "POST", "v1/purchase/iap-verify", "tok-alice",
    { productId: "in.stewardmd.tokens.plus", purchaseToken: "x" })).http, 400);
  /* The client never writes balances: nothing touched the wallet. */
  assert.equal(env.MAIK_KV._m.size, 0);
  assert.equal((await call(env, "GET", "v1/purchase/packs", null)).http, 401);
});

test("institution invoicing: admin grant, invoice paid once, member draws the pool", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  /* Admin surface: research token OR owner Firebase claim; others refused. */
  assert.equal((await callAdmin(env, "POST", "v1/institutions", { name: "X" }, { adminToken: null })).http, 401);
  assert.equal((await callAdmin(env, "POST", "v1/institutions", { name: "X" }, { adminToken: null, firebase: "tok-alice" })).http, 403);
  assert.equal((await callAdmin(env, "POST", "v1/institutions", { name: "X" }, { adminToken: "wrong" })).http, 401);
  const inst = await callAdmin(env, "POST", "v1/institutions", { name: "Example Institute", seats: 5 });
  assert.equal(inst.http, 201, JSON.stringify(inst));
  const id = inst.institution.id;
  const byClaim = await callAdmin(env, "POST", "v1/institutions", { name: "By Owner Claim" }, { adminToken: null, firebase: "tok-admin" });
  assert.equal(byClaim.http, 201, "owner Firebase claim is an existing admin credential");
  /* Direct grant (reuses grantInstitutionCredits). */
  const grant = await callAdmin(env, "POST", "v1/institutions/" + id + "/credits", { amountMicroUsd: 200000 });
  assert.equal(grant.http, 201);
  assert.equal(grant.balanceMicroUsd, 200000);
  /* Invoice: issued -> paid grants exactly once. */
  const invoice = await callAdmin(env, "POST", "v1/institutions/" + id + "/invoices", { amountMicroUsd: 1000000, reference: "INV-001" });
  assert.equal(invoice.http, 201);
  assert.equal(invoice.invoice.status, "issued");
  const paid = await callAdmin(env, "POST", "v1/invoices/" + invoice.invoice.id + "/mark-paid", {});
  assert.equal(paid.http, 200, JSON.stringify(paid));
  assert.equal(paid.invoice.status, "paid");
  assert.equal(paid.balanceMicroUsd, 1200000);
  const twice = await callAdmin(env, "POST", "v1/invoices/" + invoice.invoice.id + "/mark-paid", {});
  assert.equal(twice.http, 409);
  assert.equal(twice.error.code, "invoice_already_paid");
  const grants = env.RESEARCH_DB._db.prepare("SELECT * FROM research_credit_ledger WHERE owner_type='institution' AND owner_id=? AND reason='grant'").all(id);
  assert.equal(grants.length, 2, "one direct grant + one invoice grant, never double");
  assert.equal((await callAdmin(env, "POST", "v1/invoices/inv_missing/mark-paid", {})).http, 404);
  assert.equal((await callAdmin(env, "POST", "v1/institutions/inst_missing/credits", { amountMicroUsd: 1 })).http, 404);
  assert.equal((await callAdmin(env, "POST", "v1/institutions/" + id + "/credits", { amountMicroUsd: -5 })).http, 400);
  /* Invoice list: institution admin (Firebase) may read. The owner Firebase
   * claim manages members through the user surface (instAdminAuth fallback). */
  await call(env, "POST", "v1/institutions/" + id + "/members", "tok-admin", { uid: "u-alice", role: "admin" });
  const list = await call(env, "GET", "v1/institutions/" + id + "/invoices", "tok-alice");
  assert.equal(list.http, 200);
  assert.equal(list.invoices.length, 1);
  assert.equal((await call(env, "GET", "v1/institutions/" + id + "/invoices", "tok-eve")).http, 404);
  /* Member draw: alice's job reserves from the pool, wallet untouched. */
  const p = await makeProject(env, "tok-alice");
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createPdfJob(env, p.id, "tok-alice", pdf.id, "ki");
  const rows = ledgerRows(env, job.id);
  assert.equal(rows[0].owner_type, "institution");
  assert.equal(rows[0].owner_id, id);
  const cb = await statsCallbackPdf(env, job, "ki");
  assert.equal(cb.http, 200);
  assert.equal(walletBalance(env, "alice@example.com"), 100, "institution credit, not the wallet");
  const bal = env.RESEARCH_DB._db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM research_credit_ledger WHERE owner_type='institution' AND owner_id=?").get(id);
  assert.equal(bal.n, 1150000);
  /* Phase 3 token-only admin route still works (regression). */
  const legacy = await callAdmin(env, "POST", "v1/admin/institutions", { name: "Legacy" });
  assert.equal(legacy.http, 201);
});
/* pdf callback helper (phase 3 path, same HMAC). */
async function statsCallbackPdf(env, job, key) {
  const resultKey = "projects/" + job.projectId + "/jobs/" + job.id + "/result.json";
  env.RESEARCH_R2._objects.set(resultKey, new TextEncoder().encode("{}"));
  const payload = { jobId: job.id, idempotencyKey: key, status: "done", resultKey, usage: { pages: 60, seconds: 240 } };
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const req = new Request("https://stewardmd.in/api/research/v1/jobs/" + job.id + "/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Research-Timestamp": ts, "X-Research-Signature": hmac(SECRET, ts, raw) },
    body: raw,
  });
  const res = await onRequest({ request: req, env, params: { path: ["v1", "jobs", job.id, "callback"] } });
  return { http: res.status, ...(await res.json()) };
}

/* ---- 6.5 institution workspaces -------------------------------------------------------- */
test("institution workspaces: seats, roles, projects, onboarding, isolation", { skip: SKIP }, async () => {
  const env = freshEnv();
  const inst = await callAdmin(env, "POST", "v1/institutions", { name: "Pilot Institute", seats: 2 });
  const id = inst.institution.id;
  await call(env, "POST", "v1/institutions/" + id + "/members", "tok-admin", { uid: "u-alice", role: "admin" });
  await call(env, "POST", "v1/institutions/" + id + "/members", "tok-admin", { uid: "u-bob", role: "member" });
  /* Seats full. */
  const full = await call(env, "POST", "v1/institutions/" + id + "/members", "tok-admin", { uid: "u-carol" });
  assert.equal(full.http, 409);
  assert.equal(full.error.code, "seats_full");
  /* Member (non-admin) cannot manage members; institution admin can. */
  assert.equal((await call(env, "POST", "v1/institutions/" + id + "/members", "tok-bob", { uid: "u-dave" })).http, 403);
  const seats = await call(env, "GET", "v1/institutions/" + id + "/seats", "tok-bob");
  assert.equal(seats.http, 200);
  assert.equal(seats.seats, 2);
  assert.equal(seats.used, 2);
  assert.equal(seats.members.find((m) => m.uid === "u-alice").role, "admin");
  /* Role changes; last admin protected. */
  assert.equal((await call(env, "PUT", "v1/institutions/" + id + "/members/u-alice", "tok-alice", { role: "member" })).http, 409);
  assert.equal((await call(env, "DELETE", "v1/institutions/" + id + "/members/u-alice", "tok-alice")).http, 409);
  assert.equal((await call(env, "PUT", "v1/institutions/" + id + "/members/u-bob", "tok-alice", { role: "admin" })).http, 200);
  assert.equal((await call(env, "DELETE", "v1/institutions/" + id + "/members/u-bob", "tok-alice")).http, 200);
  /* Outsider 404 everywhere. */
  assert.equal((await call(env, "GET", "v1/institutions/" + id, "tok-eve")).http, 404);
  assert.equal((await call(env, "GET", "v1/institutions/" + id + "/seats", "tok-eve")).http, 404);
  assert.equal((await call(env, "GET", "v1/institutions/inst_missing", "tok-alice")).http, 404);
  /* Institution-owned project: creator is project owner; institution membership
   * alone grants NO project role (tenant isolation). */
  const pr = await call(env, "POST", "v1/institutions/" + id + "/projects", "tok-alice", { title: "Institution review" });
  assert.equal(pr.http, 201, JSON.stringify(pr));
  assert.equal(pr.project.institutionId, id);
  const pid = pr.project.id;
  const stored = env.RESEARCH_DB._db.prepare("SELECT institution_id FROM research_projects WHERE id=?").get(pid);
  assert.equal(stored.institution_id, id);
  const list = await call(env, "GET", "v1/institutions/" + id + "/projects", "tok-alice");
  assert.equal(list.projects.length, 1);
  await call(env, "POST", "v1/institutions/" + id + "/members", "tok-admin", { uid: "u-bob", role: "member" });
  assert.equal((await call(env, "GET", "v1/projects/" + pid, "tok-bob")).http, 404, "inst member is not a project member");
  assert.equal((await call(env, "GET", "v1/projects/" + pid, "tok-alice")).http, 200);
  /* My institutions. */
  const mine = await call(env, "GET", "v1/institutions", "tok-alice");
  assert.equal(mine.institutions.length, 1);
  assert.equal(mine.institutions[0].role, "admin");
  /* Onboarding: computed flags + manual flags. */
  let ob = await call(env, "GET", "v1/institutions/" + id + "/onboarding", "tok-alice");
  assert.equal(ob.http, 200);
  const byKey = Object.fromEntries(ob.items.map((i) => [i.key, i]));
  assert.equal(byKey.workspace_created.done, true);
  assert.equal(byKey.members_added.done, true);
  assert.equal(byKey.credits_granted.done, false);
  assert.equal(byKey.first_project.done, true);
  assert.equal(byKey.first_review.done, false);
  assert.equal(byKey.pilot_agreement_signed.source, "manual");
  await callAdmin(env, "POST", "v1/institutions/" + id + "/credits", { amountMicroUsd: 1000 });
  env.RESEARCH_DB._db.prepare("INSERT INTO research_runs (id,project_id,measure,created_ts) VALUES ('run_ob',?,'OR',?)").run(pid, Date.now());
  ob = await call(env, "GET", "v1/institutions/" + id + "/onboarding", "tok-alice");
  const byKey2 = Object.fromEntries(ob.items.map((i) => [i.key, i]));
  assert.equal(byKey2.credits_granted.done, true);
  assert.equal(byKey2.first_review.done, true);
  assert.equal((await call(env, "PUT", "v1/institutions/" + id + "/onboarding", "tok-alice", { items: { pilot_agreement_signed: true } })).http, 200);
  assert.equal((await call(env, "PUT", "v1/institutions/" + id + "/onboarding", "tok-alice", { items: { first_review: true } })).http, 400, "computed items cannot be forced");
  ob = await call(env, "GET", "v1/institutions/" + id + "/onboarding", "tok-alice");
  assert.equal(ob.items.find((i) => i.key === "pilot_agreement_signed").done, true);
  /* Admin list. */
  const all = await callAdmin(env, "GET", "v1/admin/institutions", undefined);
  assert.equal(all.http, 200);
  assert.ok(all.institutions.length >= 1);
  assert.equal((await callAdmin(env, "GET", "v1/admin/institutions", undefined, { adminToken: null, firebase: "tok-alice" })).http, 403);
});

/* ---- 6.3 cost reports + pricing note ------------------------------------------------------ */
test("cost reports: totals by step/tier/model/day, CSV, user scope, isolation", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const day1 = Date.UTC(2026, 10, 20), day2 = Date.UTC(2026, 10, 21);
  const ins = env.RESEARCH_DB._db.prepare("INSERT INTO research_ai_usage (id,project_id,user_id,job_id,step,tier,model,tokens_in,tokens_out,cost_micro_usd,ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  ins.run("u1", p.id, "u-alice", "", "extraction", "T1", "m1", 100, 50, 1000, day1 + 1000);
  ins.run("u2", p.id, "u-alice", "", "extraction", "T1", "m1", 200, 80, 2000, day1 + 2000);
  ins.run("u3", p.id, "u-alice", "", "drafting", "T2", "m2", 400, 300, 5000, day2 + 1000);
  ins.run("u4", p.id, "u-bob", "", "drafting", "T2", "m2", 100, 100, 700, day2 + 2000);
  /* A real pdf job gives the ledger join something to sum. */
  const pdf = await uploadPdf(env, p.id, "tok-alice");
  const job = await createPdfJob(env, p.id, "tok-alice", pdf.id, "kr");
  await statsCallbackPdf(env, job, "kr");
  const r = await call(env, "GET", "v1/projects/" + p.id + "/cost-report", "tok-alice");
  assert.equal(r.http, 200, JSON.stringify(r));
  assert.equal(r.report.ai.totalCostMicroUsd, 8700);
  assert.equal(r.report.ai.calls, 4);
  assert.equal(r.report.ai.tokensIn, 800);
  const byStep = Object.fromEntries(r.report.ai.byStep.map((x) => [x.key, x]));
  assert.equal(byStep.extraction.costMicroUsd, 3000);
  assert.equal(byStep.extraction.calls, 2);
  assert.equal(byStep.drafting.costMicroUsd, 5700);
  const byTier = Object.fromEntries(r.report.ai.byTier.map((x) => [x.key, x.costMicroUsd]));
  assert.deepEqual(byTier, { T1: 3000, T2: 5700 });
  const byModel = Object.fromEntries(r.report.ai.byModel.map((x) => [x.key, x.costMicroUsd]));
  assert.deepEqual(byModel, { m1: 3000, m2: 5700 });
  assert.deepEqual(r.report.ai.byDay.map((x) => [x.key, x.costMicroUsd]), [["2026-11-20", 3000], ["2026-11-21", 5700]]);
  assert.equal(r.report.ledger.settledMicroUsd, 50000);
  assert.equal(r.report.ledger.reservedMicroUsd, 50000);
  assert.equal(r.report.ledger.releasedMicroUsd, 50000);
  assert.equal(r.report.totalChargedMicroUsd, 50000);
  /* Bounds filter. */
  const bounded = await call(env, "GET", "v1/projects/" + p.id + "/cost-report?from=" + day2, "tok-alice");
  assert.equal(bounded.report.ai.totalCostMicroUsd, 5700);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/cost-report?from=20&to=10", "tok-alice")).http, 400);
  /* CSV. */
  const csv = await callText(env, "v1/projects/" + p.id + "/cost-report.csv", "tok-alice");
  assert.equal(csv.http, 200);
  assert.equal(csv.contentType, "text/csv; charset=utf-8");
  assert.ok(csv.text.startsWith("scope,day,step,tier,model,tokens_in,tokens_out,cost_micro_usd"));
  assert.ok(csv.text.includes("project,2026-11-20,extraction,T1,m1,300,130,3000"));
  assert.ok(csv.text.trim().endsWith("project,TOTAL,,,,,,8700"));
  /* User report: alice's own usage only. */
  const user = await call(env, "GET", "v1/cost-report", "tok-alice");
  assert.equal(user.report.ai.totalCostMicroUsd, 8000);
  assert.equal(user.report.scope, "user");
  assert.equal(user.report.ledger.settledMicroUsd, 50000);
  const userCsv = await callText(env, "v1/cost-report.csv", "tok-alice");
  assert.ok(userCsv.text.trim().endsWith("user,TOTAL,,,,,,8000"));
  /* Roles: editor reads, viewer refused, outsider 404. */
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "editor" });
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/cost-report", "tok-bob")).http, 200);
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/cost-report", "tok-bob")).http, 403);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/cost-report", "tok-eve")).http, 404);
});

test("pricing note: measured cost per review, admin-only, 5-review gate text", { skip: SKIP }, async () => {
  const env = freshEnv();
  assert.equal((await callAdmin(env, "GET", "v1/admin/pricing-note", undefined, { adminToken: null, firebase: "tok-alice" })).http, 403);
  const p = await makeProject(env, "tok-alice");
  env.RESEARCH_DB._db.prepare("INSERT INTO research_runs (id,project_id,measure,created_ts) VALUES ('r1',?,'OR',?)").run(p.id, Date.now());
  env.RESEARCH_DB._db.prepare("INSERT INTO research_ai_usage (id,project_id,user_id,job_id,step,tier,model,tokens_in,tokens_out,cost_micro_usd,ts) VALUES ('a1',?,'u-alice','','s','T1','m',0,0,1500000,?)").run(p.id, Date.now());
  const note = await callAdmin(env, "GET", "v1/admin/pricing-note", undefined);
  assert.equal(note.http, 200);
  assert.equal(note.measured.reviews, 1);
  assert.equal(note.measured.meanMicroUsd, 1500000);
  assert.ok(note.note.includes("NOT met"));
  assert.ok(note.note.includes("US$1.50"));
  assert.ok(note.note.includes("15 to 30 percent"));
  /* Five measured reviews meet the gate. */
  for (let i = 0; i < 4; i++) {
    const pi = await makeProject(env, "tok-alice", "Review " + i);
    env.RESEARCH_DB._db.prepare("INSERT INTO research_runs (id,project_id,measure,created_ts) VALUES (?,?,'OR',?)").run("r_x" + i, pi.id, Date.now());
    env.RESEARCH_DB._db.prepare("INSERT INTO research_ai_usage (id,project_id,user_id,job_id,step,tier,model,tokens_in,tokens_out,cost_micro_usd,ts) VALUES (?,?,'u-alice','','s','T1','m',0,0,1000000,?)").run("a_x" + i, pi.id, Date.now());
  }
  const note2 = await callAdmin(env, "GET", "v1/admin/pricing-note", undefined);
  assert.equal(note2.measured.reviews, 5);
  assert.equal(note2.measured.medianMicroUsd, 1000000);
  assert.ok(note2.note.includes("is met"));
});

/* ---- 5C breach log ------------------------------------------------------------------------ */
test("breach log: admin-only, SLA timers per jurisdiction, status transitions", { skip: SKIP }, async () => {
  const env = freshEnv();
  assert.equal((await callAdmin(env, "POST", "v1/admin/incidents", { description: "x", jurisdictions: ["IN"] }, { adminToken: null, firebase: "tok-alice" })).http, 403);
  const discovered = Date.now() - 3600000;
  const inc = await callAdmin(env, "POST", "v1/admin/incidents",
    { description: "Lost laptop with exported snapshot", jurisdictions: ["IN", "EU", "US"], affectedProjects: ["prj_x"], encrypted: true, discoveredTs: discovered });
  assert.equal(inc.http, 201, JSON.stringify(inc));
  assert.equal(inc.incident.encrypted, true);
  assert.equal(inc.incident.sla.dpbiReportDueTs, discovered + 72 * 3600000);
  assert.equal(inc.incident.sla.certInDueTs, discovered + 6 * 3600000);
  assert.equal(inc.incident.sla.authorityDueTs, discovered + 72 * 3600000);
  assert.equal(inc.incident.sla.ceDueTs, discovered + 60 * 86400000);
  assert.equal(inc.incident.sla.ocrAnnualLogUnder500, true);
  assert.equal(inc.incident.status, "open");
  const list = await callAdmin(env, "GET", "v1/admin/incidents", undefined);
  assert.equal(list.incidents.length, 1);
  const one = await callAdmin(env, "GET", "v1/admin/incidents/" + inc.incident.id, undefined);
  assert.equal(one.http, 200);
  const upd = await callAdmin(env, "POST", "v1/admin/incidents/" + inc.incident.id + "/status", { status: "contained", note: "Device recovered" });
  assert.equal(upd.incident.status, "contained");
  assert.equal((await callAdmin(env, "POST", "v1/admin/incidents/" + inc.incident.id + "/status", { status: "bogus" })).http, 400);
  assert.equal((await callAdmin(env, "GET", "v1/admin/incidents/inc_missing", undefined)).http, 404);
  assert.equal((await callAdmin(env, "POST", "v1/admin/incidents", { description: "x", jurisdictions: [] })).http, 400);
  /* Firebase user (non-admin) cannot read the breach log through user routes. */
  assert.equal((await call(env, "GET", "v1/admin/incidents", "tok-alice")).http, 403);
});

/* ---- 5D.1 templates ------------------------------------------------------------------------- */
test("study templates: five designs, read-only, job.py-compatible analysis defaults", { skip: SKIP }, async () => {
  const env = freshEnv();
  const list = await call(env, "GET", "v1/study-templates", "tok-alice");
  assert.equal(list.http, 200);
  assert.deepEqual(list.templates.map((t) => t.id).sort(),
    ["cohort", "diagnostic_accuracy", "observational", "prognostic", "rct"]);
  const families = ["linear", "logistic", "km", "logrank", "cox", "diagnostic"];
  for (const t of STUDY_TEMPLATES) {
    const r = await call(env, "GET", "v1/study-templates/" + t.id, "tok-alice");
    assert.equal(r.http, 200);
    assert.ok(r.template.protocolFields.length >= 5);
    assert.ok(r.template.extractionForm.fields.length >= 4);
    assert.ok(r.template.reportingChecklistId);
    assert.equal(r.template.analysisDefaults.jobKind, "stats_model");
    assert.ok(families.includes(r.template.analysisDefaults.family));
    assert.ok(r.template.analysisDefaults.spec.family === r.template.analysisDefaults.family);
  }
  assert.equal((await call(env, "GET", "v1/study-templates/rct", "tok-alice")).template.reportingChecklistId, "consort");
  assert.equal((await call(env, "GET", "v1/study-templates/diagnostic_accuracy", "tok-alice")).template.reportingChecklistId, "stard");
  assert.equal((await call(env, "GET", "v1/study-templates/prognostic", "tok-alice")).template.reportingChecklistId, "tripod");
  assert.equal((await call(env, "GET", "v1/study-templates/cohort", "tok-alice")).template.reportingChecklistId, "strobe");
  assert.equal((await call(env, "GET", "v1/study-templates/nope", "tok-alice")).http, 404);
  assert.equal((await call(env, "GET", "v1/study-templates", null)).http, 401);
});

/* ---- 5B.3 journals ---------------------------------------------------------------------------- */
test("journals: seed parity with the contract JSON, read-only, deterministic match", { skip: SKIP }, async () => {
  assert.deepEqual(JOURNAL_SEED, SEED_JSON.journals, "embedded seed must equal journals.seed.json");
  assert.equal(JOURNAL_SEED.length, 10);
  const env = freshEnv();
  const list = await call(env, "GET", "v1/journals", "tok-alice");
  assert.equal(list.http, 200);
  assert.equal(list.journals.length, 10);
  for (const j of list.journals) {
    assert.equal(j.checkedTs, null, "seed is not live-verified");
    assert.ok(/^\d{4}-\d{3}[\dX]$/.test(j.issn), "ISSN shape: " + j.issn);
  }
  const nejm = await call(env, "GET", "v1/journals/nejm", "tok-alice");
  assert.equal(nejm.journal.name, "New England Journal of Medicine");
  assert.equal(nejm.journal.wordLimits.abstract, null);
  assert.equal((await call(env, "GET", "v1/journals/nope", "tok-alice")).http, 404);
  const filtered = await call(env, "GET", "v1/journals?q=systematic", "tok-alice");
  assert.ok(filtered.journals.some((j) => j.id === "systematic_reviews"));
  /* Match: systematic review keywords + design ranks Systematic Reviews first. */
  const m = await call(env, "POST", "v1/journals/match", "tok-alice",
    { keywords: ["systematic reviews", "meta-analysis", "evidence synthesis"], design: "systematic_review" });
  assert.equal(m.http, 200);
  assert.equal(m.matches[0].journal.id, "systematic_reviews");
  assert.equal(m.matches[0].designMatch, true);
  assert.ok(m.matches[0].score >= 7);
  for (let i = 1; i < m.matches.length; i++) assert.ok(m.matches[i - 1].score >= m.matches[i].score);
  /* Diagnostic design surfaces BMJ Open. */
  const d = await call(env, "POST", "v1/journals/match", "tok-alice",
    { keywords: ["diagnostic accuracy"], design: "diagnostic_accuracy" });
  assert.ok(d.matches.some((x) => x.journal.id === "bmj_open" && x.designMatch));
  /* No overlap -> empty. */
  const none = await call(env, "POST", "v1/journals/match", "tok-alice", { keywords: ["quantum chromodynamics"] });
  assert.equal(none.matches.length, 0);
  assert.equal((await call(env, "POST", "v1/journals/match", "tok-alice", { keywords: [] })).http, 400);
  assert.equal((await call(env, "GET", "v1/journals", null)).http, 401);
  /* Read-only: no write route exists. */
  assert.equal((await call(env, "POST", "v1/journals", "tok-alice", { name: "Fake" })).http, 404);
});

/* ---- 5B.5 reviewer responses -------------------------------------------------------------------- */
test("reviewer responses: mandatory manuscript link, versioning, roles, isolation", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const c = await call(env, "POST", "v1/projects/" + p.id + "/reviewer-comments", "tok-alice",
    { round: 1, reviewerLabel: "Reviewer 1", text: "Please clarify the heterogeneity assessment.", sectionRef: "Results" });
  assert.equal(c.http, 201, JSON.stringify(c));
  assert.equal(c.comment.round, 1);
  await call(env, "POST", "v1/projects/" + p.id + "/reviewer-comments", "tok-alice",
    { round: 2, reviewerLabel: "Reviewer 2", text: "Second round comment." });
  const list = await call(env, "GET", "v1/projects/" + p.id + "/reviewer-comments", "tok-alice");
  assert.equal(list.comments.length, 2);
  const round1 = await call(env, "GET", "v1/projects/" + p.id + "/reviewer-comments?round=1", "tok-alice");
  assert.equal(round1.comments.length, 1);
  /* Response requires the manuscript version + section change link. */
  const base = { text: "We added the I2 interpretation.", manuscriptVersionId: "man_v2", sectionId: "results", changeNote: "Added heterogeneity paragraph." };
  assert.equal((await call(env, "POST", "v1/reviewer-comments/" + c.comment.id + "/responses", "tok-alice",
    { text: "x", sectionId: "results", changeNote: "y" })).http, 400);
  assert.equal((await call(env, "POST", "v1/reviewer-comments/" + c.comment.id + "/responses", "tok-alice",
    { text: "x", manuscriptVersionId: "man_v2", changeNote: "y" })).http, 400);
  assert.equal((await call(env, "POST", "v1/reviewer-comments/" + c.comment.id + "/responses", "tok-alice",
    { text: "x", manuscriptVersionId: "man_v2", sectionId: "results" })).http, 400);
  const r = await call(env, "POST", "v1/reviewer-comments/" + c.comment.id + "/responses", "tok-alice", base);
  assert.equal(r.http, 201, JSON.stringify(r));
  assert.equal(r.response.status, "draft");
  assert.equal(r.response.version, 1);
  assert.equal(r.response.manuscriptVersionId, "man_v2");
  /* Edit with version bump; stale -> 409 with current. */
  const upd = await call(env, "PUT", "v1/reviewer-responses/" + r.response.id, "tok-alice",
    { version: 1, text: "Revised response.", status: "final" });
  assert.equal(upd.http, 200);
  assert.equal(upd.response.version, 2);
  assert.equal(upd.response.status, "final");
  const stale = await call(env, "PUT", "v1/reviewer-responses/" + r.response.id, "tok-alice", { version: 1, text: "old" });
  assert.equal(stale.http, 409);
  assert.equal(stale.error.code, "stale_version");
  assert.equal(stale.current.response.version, 2);
  /* Lists. */
  const perComment = await call(env, "GET", "v1/reviewer-comments/" + c.comment.id + "/responses", "tok-alice");
  assert.equal(perComment.responses.length, 1);
  const perProject = await call(env, "GET", "v1/projects/" + p.id + "/reviewer-responses", "tok-alice");
  assert.equal(perProject.responses.length, 1);
  /* Roles + isolation. */
  await call(env, "POST", "v1/projects/" + p.id + "/members", "tok-alice", { uid: "u-bob", role: "viewer" });
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/reviewer-comments", "tok-bob")).http, 200);
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/reviewer-comments", "tok-bob",
    { reviewerLabel: "R", text: "x" })).http, 403);
  assert.equal((await call(env, "POST", "v1/reviewer-comments/" + c.comment.id + "/responses", "tok-bob", base)).http, 403);
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/reviewer-comments", "tok-eve")).http, 404);
  assert.equal((await call(env, "POST", "v1/reviewer-comments/rc_missing/responses", "tok-alice", base)).http, 404);
  assert.equal((await call(env, "PUT", "v1/reviewer-responses/rr_missing", "tok-alice", { version: 1, text: "x" })).http, 404);
});

/* ---- Outsider isolation sweep --------------------------------------------------------------------- */
test("phase 6 isolation: outsider 404 on every project route; anonymous 401", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p } = await ipdReady(env);
  const up = await uploadIpdCsv(env, p.id, "tok-alice");
  const c = await call(env, "POST", "v1/projects/" + p.id + "/reviewer-comments", "tok-alice",
    { reviewerLabel: "R1", text: "comment" });
  const attempts = [
    ["GET", "v1/projects/" + p.id + "/ipd-evidence"],
    ["GET", "v1/projects/" + p.id + "/ipd-config"],
    ["GET", "v1/projects/" + p.id + "/ipd-datasets"],
    ["GET", "v1/projects/" + p.id + "/ipd-access-log"],
    ["GET", "v1/projects/" + p.id + "/cost-report"],
    ["GET", "v1/projects/" + p.id + "/cost-report.csv"],
    ["GET", "v1/projects/" + p.id + "/reviewer-comments"],
    ["GET", "v1/projects/" + p.id + "/reviewer-responses"],
    ["GET", "v1/ipd-datasets/" + up.dataset.id],
    ["GET", "v1/ipd-datasets/" + up.dataset.id + "/snapshot"],
    ["GET", "v1/ipd-evidence/" + up.dataset.evidenceId],
    ["POST", "v1/projects/" + p.id + "/stats-jobs", { datasetId: up.dataset.id, model: { family: "km", time: "t", event: "e" }, idempotencyKey: "eve" }],
    ["POST", "v1/projects/" + p.id + "/ipd-config", IN_CONFIG],
    ["POST", "v1/projects/" + p.id + "/reviewer-comments", { reviewerLabel: "R", text: "x" }],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call(env, method, path, "tok-eve", body);
    assert.equal(r.http, 404, method + " " + path + " leaked: " + JSON.stringify(r));
    assert.equal((await call(env, method, path, null, body)).http, 401, method + " " + path + " anonymous");
  }
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/ipd-uploads", "tok-eve", csvForm(IPD_CSV))).http, 404);
  /* Institution routes: non-member 404. */
  const inst = await callAdmin(env, "POST", "v1/institutions", { name: "Iso" });
  assert.equal((await call(env, "GET", "v1/institutions/" + inst.institution.id, "tok-eve")).http, 404);
  assert.equal((await call(env, "POST", "v1/institutions/" + inst.institution.id + "/projects", "tok-eve", { title: "x" })).http, 404);
});
