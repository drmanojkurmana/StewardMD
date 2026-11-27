import "./helpers/json-import-attr.mjs";
/**
 * Phase 04 API tests: monthly cloud fallback allowance, refunds, daily caps,
 * old-client bypass, POST /v1/jobs/:jobId/to-cloud, container-usage admin metric,
 * and 0010 migration/rollback.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CLAIMS = {
  "tok-free": { sub: "u_free", email: "free@example.com", name: "Dr Free" },
  "tok-student": { sub: "u_student", email: "student@example.com", name: "Dr Trainee" },
  "tok-cores": { sub: "u_cores", email: "cores@example.com", name: "Dr CoRes" },
  "tok-pro": { sub: "u_pro", email: "pro@example.com", name: "Dr Pro" },
  "tok-phys": { sub: "u_phys", email: "phys@example.com", name: "Dr Phys" },
  "tok-physpro": { sub: "u_physpro", email: "physpro@example.com", name: "Dr PhysPro" },
  "tok-founding": { sub: "u_founding", email: "founding@example.com", pro: true, name: "Dr Founding" },
  "tok-colleague": { sub: "u_colleague", email: "colleague@example.com", name: "Dr Colleague" },
  "tok-trial": { sub: "u_trial", email: "trial@example.com", pro: true, source: "trial", proExp: Date.now() + 86400000, name: "Dr Trial" },
  "tok-downgraded": { sub: "u_downgraded", email: "downgraded@example.com", pro: true, proExp: Date.now() + 86400000, name: "Dr Downgraded" },
  "tok-expired": { sub: "u_expired", email: "expired@example.com", pro: true, proExp: Date.now() + 86400000, name: "Dr Expired" },
  "tok-seat2": { sub: "u_seat2", email: "seat2@example.com", name: "Dr Seat2" },
  "tok-cores-exp": { sub: "u_cores_exp", email: "coresexp@example.com", name: "Dr CoResExp" },
  "tok-seat2-exp": { sub: "u_seat2_exp", email: "seat2exp@example.com", name: "Dr Seat2Exp" },
};

const ENTITLEMENTS = {
  u_free: { tier: "free" },
  u_student: { tier: "student" },
  u_cores: { tier: "coresident" },
  u_pro: { tier: "pro" },
  u_phys: { tier: "physician" },
  u_physpro: { tier: "physicianpro" },
  u_founding: null,
  u_colleague: { tier: "pro" },
  u_trial: null,
  u_downgraded: { tier: "free", tierExp: null },
  u_expired: { tier: "student", tierExp: Date.now() - 60000 },
  u_seat2: null,
  u_cores_exp: { tier: "coresident", tierExp: Date.now() - 60000 },
  u_seat2_exp: null,
};

const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifyFirebaseClaims: async (tok) => CLAIMS[tok] || null,
    verifiedClaimsFor: async (request) => CLAIMS[((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""))] || null,
  },
});

const realEnt = await import("../functions/_entitlements.js");
mock.module("../functions/_entitlements.js", {
  namedExports: {
    ...realEnt,
    getEntitlement: async (_env, uid) => (uid in ENTITLEMENTS ? ENTITLEMENTS[uid] : null),
  },
});

const realFbAdmin = await import("../functions/_fbadmin.js");
mock.module("../functions/_fbadmin.js", {
  namedExports: {
    ...realFbAdmin,
    lookupUidByEmail: async (_env, email) => {
      const e = String(email || "").trim().toLowerCase();
      for (const c of Object.values(CLAIMS)) {
        if (String(c.email || "").toLowerCase() === e) return { uid: c.sub, email: e, name: c.name || "" };
      }
      return null;
    },
  },
});

mock.module("../functions/api/ai/[[path]].js", {
  namedExports: { callGemini: async () => ({ text: "ok", inTok: 120, outTok: 60 }) },
});
mock.module("../functions/api/billing/[[path]].js", {
  namedExports: {
    onRequest: async () => new Response("{}", { status: 200 }),
    plans: () => ({ tokens: {} }),
    fulfilPurchase: async () => ({ ok: true }),
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { utcMonthRange, sanitizeFallbackMetadata, recordCloudFallbackUsed } = await import("../functions/api/research/_cloud_fallback.js");
const { CLOUD_FALLBACKS_PER_MONTH } = await import("../functions/api/research/_caps.js");
const { expireLostJobs, outstandingReserves, institutionBalance, LOST_JOB_MS } = await import("../functions/api/research/_credits.js");
const { mintJobToken } = await import("../functions/api/research/_gateway.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const SECRET = "test-cb-secret-p4";

function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  function stmt(sql, bound = []) {
    const s = db.prepare(sql);
    return {
      bind: (...v) => stmt(sql, v),
      run: async () => { const r = s.run(...bound); return { meta: { changes: r.changes } }; },
      first: async () => { const row = s.get(...bound); return row === undefined ? null : row; },
      all: async () => ({ results: s.all(...bound) }),
    };
  }
  return {
    _db: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      const out = [];
      for (const q of list) out.push(await q.run());
      return out;
    },
  };
}

function r2Shim() {
  const m = new Map();
  return {
    _m: m,
    put: async (k, body) => {
      const buf = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
      m.set(k, typeof buf === "string" ? buf : JSON.stringify(buf));
    },
    get: async (k) => {
      if (!m.has(k)) return null;
      const v = m.get(k);
      return { text: async () => v, json: async () => JSON.parse(v) };
    },
    delete: async (k) => { m.delete(k); },
  };
}

function queueShim() {
  const msgs = [];
  return { _msgs: msgs, send: async (m) => { msgs.push(m); } };
}

function kvShim() {
  const m = new Map();
  return {
    _m: m,
    get: async (k, type) => { if (!m.has(k)) return null; const v = m.get(k); return type === "json" ? JSON.parse(v) : v; },
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
  };
}

function freshEnv({ queue = true, r2 = true } = {}) {
  const D = d1();
  D._db.exec(SCHEMA);
  const env = {
    RESEARCH_MODE: "pilot",
    RESEARCH_PO_ENABLED: "1",
    RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_ADMIN_TOKEN: "admin-p4-tok",
    MAIK_KV: kvShim(),
    RESEARCH_CALLBACK_SECRET: SECRET,
  };
  if (r2) env.RESEARCH_R2 = r2Shim();
  if (queue) env.RESEARCH_QUEUE = queueShim();
  return env;
}

function fundWallet(env, email, inr = 5000) {
  env.MAIK_KV._m.set("maik:credit:em:" + email, JSON.stringify({ balance: inr, day: "", chargedToday: 0 }));
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
  const headers = token ? { Authorization: "Bearer " + token } : {};
  const req = new Request("https://stewardmd.in/api/research/" + path, { method: "POST", headers, body: form });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const res = await onRequest({ request: req, env, params: { path: parts } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}

function pdfForm(suffix = "p4", fallback = null) {
  const form = new FormData();
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic " + suffix);
  form.append("file", new File([bytes], "paper.pdf", { type: "application/pdf" }), "paper.pdf");
  if (fallback !== null) form.append("fallback", JSON.stringify(fallback));
  return form;
}

function hmac(secret, ts, raw) { return createHmac("sha256", secret).update(ts + "." + raw).digest("hex"); }

async function sendCallback(env, jobId, payload) {
  const rawBody = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = hmac(SECRET, ts, rawBody);
  const req = new Request("https://stewardmd.in/api/research/v1/jobs/" + jobId + "/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Research-Timestamp": ts, "X-Research-Signature": sig },
    body: rawBody,
  });
  const res = await onRequest({ request: req, env, params: { path: ["v1", "jobs", jobId, "callback"] } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}

async function makeProject(env, token, title = "P4 Project") {
  const r = await call(env, "POST", "v1/projects", token, { title, studyType: "systematic_review", researchQuestion: "Does X reduce Y in adults?" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}

/* Locked protocol + one analysis run: what a manuscript_draft job needs (same seed as research-po-device-api). */
function seedManuscriptReady(env, pid, uid) {
  const now = Date.now();
  const db = env.RESEARCH_DB._db;
  db.prepare(
    "INSERT INTO research_protocols (id,project_id,version,status,content_json,lock_hash,locked_at,created_by,created_ts) VALUES (?,?,1,'locked',?,?,?,?,?)")
    .run("proto_" + pid, pid, JSON.stringify({ pico: { population: "adults", intervention: "X", comparison: "placebo", outcome: "Y" } }), "a".repeat(64), now, uid, now);
  db.prepare(
    "INSERT INTO research_runs (id,project_id,measure,model,result_json,engine,engine_version,created_by,created_ts) VALUES (?,?,'OR','random_dl',?,'research-engine','rmd1',?,?)")
    .run("run_" + pid, pid, JSON.stringify({ estimate: 0.62, ciLower: 0.41, ciUpper: 0.93, p: 0.02, k: 12, i2: 35.2 }), uid, now);
}

/* IN config + owner-approved ethics and consent evidence + one dataset: what a stats_model job needs. */
function seedIpdReady(env, pid, uid) {
  const now = Date.now();
  const db = env.RESEARCH_DB._db;
  const evId = "ev_" + pid, consentId = "evc_" + pid, dsId = "ds_" + pid;
  db.prepare(
    "INSERT INTO research_ipd_config (project_id,data_region,jurisdictions_json,identifiability_tier,legal_basis_json,attestation_json,agreements_json,locked_ts,updated_by,updated_ts) VALUES (?,'IN','[\"IN\"]','coded_pseudonymised','{\"IN\":\"consent\"}','{\"responsibility\":true}','{}',?,?,?)")
    .run(pid, now, uid, now);
  for (const [id, kind] of [[evId, "irb_approval"], [consentId, "consent_basis"]]) {
    db.prepare(
      "INSERT INTO research_ipd_evidence (id,project_id,kind,jurisdiction,title,r2_key,sha256,bytes,status,uploaded_by,approved_by,approved_ts,created_ts) VALUES (?,?,?,'IN','Evidence','k','a',100,'approved',?,?,?,?)")
      .run(id, pid, kind, uid, uid, now, now);
  }
  db.prepare(
    "INSERT INTO research_ipd_datasets (id,project_id,version,storage_key,sha256,bytes,row_count,identifiability_tier,jurisdictions_json,data_region,evidence_id,envelope_json,created_by,created_ts) VALUES (?,?,1,?,'abc',100,20,'coded_pseudonymised','[\"IN\"]','IN',?,?,?,?)")
    .run(dsId, pid, "projects/" + pid + "/data/snapshots/ds1.csv", evId,
      JSON.stringify({ alg: "AES-256-GCM", wrap: "AES-KW", iv: "AAAA", wrappedKey: "AAAA" }), uid, now);
  return dsId;
}

test("GET /v1/me/research-cloud returns allowances for all six plans plus founding Pro", { skip: SKIP }, async () => {
  const env = freshEnv();
  const cases = [
    ["tok-free", "free", 0],
    ["tok-student", "student", 15],
    ["tok-cores", "coresident", 15],
    ["tok-pro", "pro", 25],
    ["tok-phys", "physician", 30],
    ["tok-physpro", "physicianpro", 100],
    ["tok-founding", "pro", 25],
  ];
  assert.equal(CLOUD_FALLBACKS_PER_MONTH.free, 0);
  assert.equal(CLOUD_FALLBACKS_PER_MONTH.student, 15);
  assert.equal(CLOUD_FALLBACKS_PER_MONTH.coresident, 15);
  assert.equal(CLOUD_FALLBACKS_PER_MONTH.pro, 25);
  assert.equal(CLOUD_FALLBACKS_PER_MONTH.physician, 30);
  assert.equal(CLOUD_FALLBACKS_PER_MONTH.physicianpro, 100);

  for (const [tok, expectedPlan, expectedAllow] of cases) {
    const r = await call(env, "GET", "v1/me/research-cloud", tok);
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(r.plan, expectedPlan);
    assert.equal(r.allowance, expectedAllow);
    assert.equal(r.used, 0);
    assert.equal(r.remaining, expectedAllow);
    assert.match(r.resetsAt, /^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  }
});

test("month rollover: prior month usage does not reduce current UTC month allowance", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { month } = utcMonthRange(Date.now());
  const [yr, mo] = month.split("-").map(Number);
  const prevMonth = mo === 1 ? `${yr - 1}-12` : `${yr}-${String(mo - 1).padStart(2, "0")}`;

  // Insert 15 used rows in the PREVIOUS month for u_student
  for (let i = 0; i < 15; i++) {
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_cloud_fallbacks (id,uid,project_id,kind,job_id,month,status,reason_json,created_ts) VALUES (?,'u_student','p','pdf',?,?,'used','{}',?)")
      .run("prev_" + i, "j_prev_" + i, prevMonth, Date.now() - 40 * 86400 * 1000);
  }
  const r = await call(env, "GET", "v1/me/research-cloud", "tok-student");
  assert.equal(r.http, 200);
  assert.equal(r.allowance, 15);
  assert.equal(r.used, 0);
  assert.equal(r.remaining, 15);
});

test("402 on free and on limit, checked BEFORE accepting upload or enqueueing", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "free@example.com");
  fundWallet(env, "student@example.com");

  const pFree = await makeProject(env, "tok-free", "Free Proj");
  const fbMeta = { reasons: [{ try: 1, rule: "ocr-failed" }, { try: 2, rule: "ocr-failed" }, { try: 3, rule: "ocr-failed" }], device: { model: "iPhone16,1" } };

  // 1. Free plan PDF upload via /pdf-uploads with fallback -> 402 BEFORE R2 write
  const upFree = await callForm(env, "v1/projects/" + pFree.id + "/pdf-uploads", "tok-free", pdfForm("free1", fbMeta));
  assert.equal(upFree.http, 402);
  assert.equal(upFree.error.code, "cloud_fallback_free");
  assert.match(upFree.error.message, /Cloud fallback comes with the paid plans/);
  assert.equal(env.RESEARCH_R2._m.size, 0, "R2 must remain untouched when allowance is 0");
  assert.equal(env.RESEARCH_QUEUE._msgs.length, 0);

  // 2. Free plan PDF upload via /pdfs with fallback -> 402 BEFORE R2 write
  const upPdfRoute = await callForm(env, "v1/projects/" + pFree.id + "/pdfs", "tok-free", pdfForm("free2", fbMeta));
  assert.equal(upPdfRoute.http, 402);
  assert.equal(upPdfRoute.error.code, "cloud_fallback_free");
  assert.equal(env.RESEARCH_R2._m.size, 0);

  // 3. Paid plan at monthly limit (15/15 used) -> 402 BEFORE upload/enqueue on pdf, stats-jobs, and manuscript container job
  const pStud = await makeProject(env, "tok-student", "Stud Proj");
  const { month } = utcMonthRange(Date.now());
  for (let i = 0; i < 15; i++) {
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_cloud_fallbacks (id,uid,project_id,kind,job_id,month,status,reason_json,created_ts) VALUES (?,'u_student',?,'pdf',?,?,'used','{}',?)")
      .run("s_" + i, pStud.id, "js_" + i, month, Date.now());
  }

  const upLim = await callForm(env, "v1/projects/" + pStud.id + "/pdf-uploads", "tok-student", pdfForm("lim1", fbMeta));
  assert.equal(upLim.http, 402);
  assert.equal(upLim.error.code, "cloud_fallback_limit");
  assert.match(upLim.error.message, /You've used this month's cloud fallbacks/);
  assert.equal(env.RESEARCH_R2._m.size, 0);

  const dsId = seedIpdReady(env, pStud.id, "u_student");
  const statsLim = await call(env, "POST", "v1/projects/" + pStud.id + "/stats-jobs", "tok-student", {
    datasetId: dsId,
    model: { family: "cox", time: "follow_up_time", event: "event", covariates: ["age"] },
    idempotencyKey: "st-lim",
    fallback: fbMeta,
  });
  assert.equal(statsLim.http, 402);
  assert.equal(statsLim.error.code, "cloud_fallback_limit");
  assert.equal(env.RESEARCH_QUEUE._msgs.length, 0);

  seedManuscriptReady(env, pStud.id, "u_student");
  const poLim = await call(env, "POST", "v1/projects/" + pStud.id + "/jobs", "tok-student", {
    kind: "manuscript_draft",
    runner: "container",
    idempotencyKey: "po-lim",
    fallback: fbMeta,
  });
  assert.equal(poLim.http, 402, JSON.stringify(poLim));
  assert.equal(poLim.error.code, "cloud_fallback_limit");
  assert.equal(env.RESEARCH_R2._m.size, 0);
  assert.equal(env.RESEARCH_QUEUE._msgs.length, 0);
});

test("old-client jobs without fallback are unaffected even on free plan", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "free@example.com");
  const p = await makeProject(env, "tok-free", "Legacy Client");

  const up = await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-free", pdfForm("legacy1", null));
  assert.equal(up.http, 201, JSON.stringify(up));
  assert.equal(env.RESEARCH_QUEUE._msgs.length, 1);

  const fbCount = env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_cloud_fallbacks").get().n;
  assert.equal(fbCount, 0);
});

test("refund on our-side failures via callbacks and expireLostJobs; no refund on user/data error", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "student@example.com");
  const p = await makeProject(env, "tok-student", "Refund Proj");
  const fbMeta = { reasons: [{ try: 1, rule: "ocr-failed" }], device: { model: "iPad14,1" } };

  // 1. PDF upload fallback succeeds creation -> remaining drops 15 -> 14
  const up = await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-student", pdfForm("ref1", fbMeta));
  assert.equal(up.http, 201);
  const jobId1 = up.artifact.jobId;
  let quota = await call(env, "GET", "v1/me/research-cloud", "tok-student");
  assert.equal(quota.used, 1);
  assert.equal(quota.remaining, 14);

  // Worker callback fails with our-side error (worker_crash) -> refunded!
  const qMsg1 = env.RESEARCH_QUEUE._msgs[0];
  const cb1 = await sendCallback(env, jobId1, {
    jobId: jobId1,
    idempotencyKey: qMsg1.idempotencyKey,
    status: "failed",
    error: "worker_crash",
    usage: { pages: 0, seconds: 1 },
  });
  assert.equal(cb1.http, 200);
  quota = await call(env, "GET", "v1/me/research-cloud", "tok-student");
  assert.equal(quota.used, 0);
  assert.equal(quota.remaining, 15);

  // 2. Second PDF upload fails due to data error (password) -> NOT refunded!
  const up2 = await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-student", pdfForm("ref2", fbMeta));
  assert.equal(up2.http, 201);
  const jobId2 = up2.artifact.jobId;
  const qMsg2 = env.RESEARCH_QUEUE._msgs[1];
  await sendCallback(env, jobId2, {
    jobId: jobId2,
    idempotencyKey: qMsg2.idempotencyKey,
    status: "failed",
    error: "password",
    usage: { pages: 0, seconds: 1 },
  });
  quota = await call(env, "GET", "v1/me/research-cloud", "tok-student");
  assert.equal(quota.used, 1);
  assert.equal(quota.remaining, 14);

  // 3. Stats job fallback expires via expireLostJobs -> refunded!
  const dsId = seedIpdReady(env, p.id, "u_student");
  const sj = await call(env, "POST", "v1/projects/" + p.id + "/stats-jobs", "tok-student", {
    datasetId: dsId,
    model: { family: "cox", time: "follow_up_time", event: "event", covariates: ["age"] },
    idempotencyKey: "sj-lost",
    fallback: fbMeta,
  });
  assert.equal(sj.http, 202, JSON.stringify(sj));
  quota = await call(env, "GET", "v1/me/research-cloud", "tok-student");
  assert.equal(quota.used, 2);

  // Force expiration well past LOST_JOB_MS
  await expireLostJobs(env.RESEARCH_DB, () => "u_" + Date.now(), Date.now() + LOST_JOB_MS + 60 * 1000);
  quota = await call(env, "GET", "v1/me/research-cloud", "tok-student");
  assert.equal(quota.used, 1, "expired stats job must be refunded while password-failed stays used");
  assert.equal(quota.remaining, 14);
});

test("daily caps still apply after cloud fallback allowance passes", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "pro@example.com", 50000);
  const p = await makeProject(env, "tok-pro", "Daily Cap Proj");
  seedManuscriptReady(env, p.id, "u_pro");

  // PO project daily cap is 3. With 25 monthly fallbacks, 4th fallback manuscript job hits 429 cap_po_project_daily.
  for (let i = 0; i < 3; i++) {
    const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-pro", {
      kind: "manuscript_draft",
      runner: "container",
      idempotencyKey: "po-cap-" + i,
      fallback: { reasons: [{ try: 1, rule: "device_failed" }] },
    });
    assert.equal(r.http, 202, JSON.stringify(r));
    // Mark succeeded so active job guard allows creating the next one
    env.RESEARCH_DB._db.prepare("UPDATE research_job_runs SET status='succeeded', completed_ts=? WHERE id=?")
      .run(Date.now(), r.job.id);
  }
  const fourth = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-pro", {
    kind: "manuscript_draft",
    runner: "container",
    idempotencyKey: "po-cap-3",
    fallback: { reasons: [{ try: 1, rule: "device_failed" }] },
  });
  assert.equal(fourth.http, 429);
  assert.equal(fourth.error.code, "cap_po_project_daily");
});

test("POST /v1/jobs/:jobId/to-cloud converts device job preserving jobId + step cache, enforces owner and allowance", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "pro@example.com", 50000);
  fundWallet(env, "free@example.com", 50000);
  const p = await makeProject(env, "tok-pro", "Convert Proj");
  seedManuscriptReady(env, p.id, "u_pro");

  // Invite tok-colleague as editor so they are project member (for 403 non-owner test)
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_members (project_id,uid,role,created_ts) VALUES (?,'u_colleague','editor',?)")
    .run(p.id, Date.now());

  const dev = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-pro", {
    kind: "manuscript_draft",
    runner: "device",
    idempotencyKey: "dev-to-cloud",
  });
  assert.equal(dev.http, 202);
  assert.equal(dev.job.runner, "device");

  // Cache one completed step (simulating phase 03 device step progress before failure)
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_job_steps (job_id,step_id,project_id,text,model,tokens_in,tokens_out,created_ts) VALUES (?,'outline',?,'{}','gemini-2.5-flash',10,20,?)")
    .run(dev.job.id, p.id, Date.now());

  // Non-owner gets 403
  const forbidden = await call(env, "POST", "v1/jobs/" + dev.job.id + "/to-cloud", "tok-colleague", {});
  assert.equal(forbidden.http, 403);

  // Fail device job on 3rd try and convert to cloud -> converts to container, preserves jobId, re-reserves & enqueues!
  const df = await call(env, "POST", "v1/jobs/" + dev.job.id + "/device-fail", "tok-pro", {
    code: "device_failed",
    step: "section:methods",
  });
  assert.equal(df.http, 200);

  const conv = await call(env, "POST", "v1/jobs/" + dev.job.id + "/to-cloud", "tok-pro", {
    fallback: { reasons: [{ try: 1, rule: "device_failed" }], device: { model: "iPhone16,1" } },
  });
  assert.equal(conv.http, 202, JSON.stringify(conv));
  assert.equal(conv.job.id, dev.job.id);
  assert.equal(conv.job.runner, "container");
  assert.equal(conv.job.status, "queued");
  assert.equal(env.RESEARCH_QUEUE._msgs.length, 1);
  assert.equal(env.RESEARCH_QUEUE._msgs[0].jobId, dev.job.id);

  // Step cache still intact for the preserved jobId
  const cached = env.RESEARCH_DB._db.prepare("SELECT step_id FROM research_job_steps WHERE job_id=?").get(dev.job.id);
  assert.equal(cached.step_id, "outline");

  // Allowance charged once (25 -> 24)
  const quota = await call(env, "GET", "v1/me/research-cloud", "tok-pro");
  assert.equal(quota.used, 1);
  assert.equal(quota.remaining, 24);

  // Free plan user cannot convert their device job to cloud -> 402
  const pf = await makeProject(env, "tok-free", "Free Dev Proj");
  seedManuscriptReady(env, pf.id, "u_free");
  const fdev = await call(env, "POST", "v1/projects/" + pf.id + "/jobs", "tok-free", {
    kind: "manuscript_draft", runner: "device", idempotencyKey: "free-dev",
  });
  assert.equal(fdev.http, 202);
  const fconv = await call(env, "POST", "v1/jobs/" + fdev.job.id + "/to-cloud", "tok-free", {});
  assert.equal(fconv.http, 402);
  assert.equal(fconv.error.code, "cloud_fallback_free");
});

test("container-usage helper/endpoint exposes monthly minutes and 6h/100h alerts", { skip: SKIP }, async () => {
  const env = freshEnv();
  const now = Date.now();
  const db = env.RESEARCH_DB._db;
  const p = await makeProject(env, "tok-pro", "Cost Proj");

  // Seed 2 container wakes totaling 400 min (6.67 h -> triggers 6h alert, not 100h)
  db.prepare(
    "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts,started_ts,completed_ts,output_json) VALUES ('jc1',?,'pdf_extract','succeeded','k1','u_pro',?,?,?,?)")
    .run(p.id, now - 250 * 60000, now - 200 * 60000, now, "{}");
  db.prepare(
    "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts,started_ts,completed_ts,output_json) VALUES ('jc2',?,'pdf_extract','succeeded','k2','u_pro',?,?,?,?)")
    .run(p.id, now - 250 * 60000, now - 198 * 60000, now, "{}");

  // Also seed an on-device job that must NOT count toward container minutes
  db.prepare(
    "INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,created_by,created_ts,started_ts,completed_ts,output_json) VALUES ('jdev',?,'manuscript_draft','succeeded','k3','u_pro',?,?,?,?)")
    .run(p.id, now - 250 * 60000, now - 200 * 60000, now, JSON.stringify({ runner: "device" }));

  const res = await call(env, "GET", "v1/admin/container-usage", null, undefined, { "x-research-admin-token": "admin-p4-tok" });
  assert.equal(res.http, 200, JSON.stringify(res));
  assert.equal(res.wakes, 2);
  // 200 + 1 + 198 + 1 = 400 min
  assert.equal(res.minutes, 400);
  assert.deepEqual(res.thresholdsExceededHours, [6]);
});

test("0010 migration applies cleanly over 0001..0009, matches schema, and rolls back", { skip: SKIP }, () => {
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
    "../docs/research/contracts/phase-5/0010_research_v10.sql",
  ];
  for (const m of migrations) {
    db.exec(readFileSync(new URL(m, import.meta.url), "utf8"));
  }
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_cloud_fallbacks'").get());

  // Mirror is idempotent
  const db2 = new DatabaseSync(":memory:");
  db2.exec(SCHEMA);
  db2.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0010_research_v10.sql", import.meta.url), "utf8"));
  assert.ok(db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_cloud_fallbacks'").get());

  db.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0010_rollback.sql", import.meta.url), "utf8"));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_cloud_fallbacks'").get(), undefined);
});

test("item 3: client _fallbackPrechecked ignored and batch pdfIds enforces remaining >= fresh.length", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "free@example.com", 50000);
  fundWallet(env, "student@example.com", 50000);
  const fbMeta = { reasons: [{ try: 1, rule: "ocr-failed" }] };

  // Seed a stored PDF on free account (uploaded without fallback)
  const pf = await makeProject(env, "tok-free", "Free Precheck");
  const upFree = await callForm(env, "v1/projects/" + pf.id + "/pdfs", "tok-free", pdfForm("pre-free", null));
  assert.equal(upFree.http, 201);

  // Client spoofing _fallbackPrechecked: true in body MUST NOT bypass 402 check
  const spoof = await call(env, "POST", "v1/projects/" + pf.id + "/jobs", "tok-free", {
    kind: "pdf_extract",
    pdfId: upFree.pdf.id,
    idempotencyKey: "spoof-precheck",
    fallback: fbMeta,
    _fallbackPrechecked: true,
  });
  assert.equal(spoof.http, 402);
  assert.equal(spoof.error.code, "cloud_fallback_free");
  assert.equal(env.RESEARCH_QUEUE._msgs.length, 0);

  // Student with 13/15 used (remaining = 2): batch of 3 PDFs with fallback MUST 402 without queueing any
  const ps = await makeProject(env, "tok-student", "Batch Quota");
  const { month } = utcMonthRange(Date.now());
  for (let i = 0; i < 13; i++) {
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_cloud_fallbacks (id,uid,project_id,kind,job_id,month,status,reason_json,created_ts) VALUES (?,'u_student',?,'pdf',?,?,'used','{}',?)")
      .run("b_" + i, ps.id, "jb_" + i, month, Date.now());
  }
  const pdfIds = [];
  for (let i = 0; i < 3; i++) {
    const up = await callForm(env, "v1/projects/" + ps.id + "/pdfs", "tok-student", pdfForm("batch-" + i, null));
    assert.equal(up.http, 201);
    pdfIds.push(up.pdf.id);
  }
  const batch3 = await call(env, "POST", "v1/projects/" + ps.id + "/jobs", "tok-student", {
    kind: "pdf_extract",
    pdfIds,
    idempotencyKey: "batch-3",
    fallback: fbMeta,
  });
  assert.equal(batch3.http, 402, JSON.stringify(batch3));
  assert.equal(batch3.error.code, "cloud_fallback_limit");
  assert.equal(env.RESEARCH_QUEUE._msgs.length, 0);

  // Batch of 2 PDFs fits remaining=2 -> 202 and drops remaining to 0
  const batch2 = await call(env, "POST", "v1/projects/" + ps.id + "/jobs", "tok-student", {
    kind: "pdf_extract",
    pdfIds: pdfIds.slice(0, 2),
    idempotencyKey: "batch-2",
    fallback: fbMeta,
  });
  assert.equal(batch2.http, 202, JSON.stringify(batch2));
  assert.equal(env.RESEARCH_QUEUE._msgs.length, 2);
  const q = await call(env, "GET", "v1/me/research-cloud", "tok-student");
  assert.equal(q.used, 15);
  assert.equal(q.remaining, 0);
});

test("item 4: trial, downgraded, expired entitlements stay free; coresident seat #2 resolves pool owner per-seat", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "seat2@example.com", 50000);
  await env.MAIK_KV.put("ai:pool:em:seat2@example.com", "em:cores@example.com");
  await env.MAIK_KV.put("ai:pool:em:seat2exp@example.com", "em:coresexp@example.com");

  for (const tok of ["tok-trial", "tok-downgraded", "tok-expired", "tok-seat2-exp"]) {
    const r = await call(env, "GET", "v1/me/research-cloud", tok);
    assert.equal(r.http, 200, tok + ": " + JSON.stringify(r));
    assert.equal(r.plan, "free", tok + " must resolve to free");
    assert.equal(r.allowance, 0, tok + " allowance must be 0");
  }

  // Co-Resident seat #2 gets 15/month from active pool owner, metered per seat uid
  const s2 = await call(env, "GET", "v1/me/research-cloud", "tok-seat2");
  assert.equal(s2.http, 200);
  assert.equal(s2.plan, "coresident");
  assert.equal(s2.allowance, 15);
  assert.equal(s2.remaining, 15);

  const p2 = await makeProject(env, "tok-seat2", "Seat2 Proj");
  const up2 = await callForm(env, "v1/projects/" + p2.id + "/pdf-uploads", "tok-seat2",
    pdfForm("seat2-1", { reasons: [{ try: 1, rule: "ocr-failed" }] }));
  assert.equal(up2.http, 201, JSON.stringify(up2));

  const s2After = await call(env, "GET", "v1/me/research-cloud", "tok-seat2");
  const ownerAfter = await call(env, "GET", "v1/me/research-cloud", "tok-cores");
  assert.equal(s2After.used, 1);
  assert.equal(s2After.remaining, 14);
  assert.equal(ownerAfter.used, 0, "usage must be metered per seat uid, not owner uid");
  assert.equal(ownerAfter.remaining, 15);
});

test("item 5: no double credit release after gateway settle, no repeated /to-cloud retries, daily cap uses conversion time", { skip: SKIP }, async () => {
  const env = freshEnv();
  const db = env.RESEARCH_DB._db;
  const p = await makeProject(env, "tok-pro", "Credit Safety");
  seedManuscriptReady(env, p.id, "u_pro");

  // Grant 2,000,000 micro-USD to an institution with u_pro as member
  const instId = "inst_item5";
  const initialGrant = 2000000;
  db.prepare("INSERT INTO research_institutions (id,name,created_by,created_ts) VALUES (?,'Inst 5','admin',?)").run(instId, Date.now());
  db.prepare("INSERT INTO research_institution_members (institution_id,uid,created_ts) VALUES (?,'u_pro',?)").run(instId, Date.now());
  db.prepare("INSERT INTO research_credit_ledger (id,owner_type,owner_id,delta,reason,job_id,ts) VALUES ('g1','institution',?,?,'grant','',?)")
    .run(instId, initialGrant, Date.now());

  const dev = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-pro", {
    kind: "manuscript_draft", runner: "device", idempotencyKey: "dev-gw-settle",
  });
  assert.equal(dev.http, 202, JSON.stringify(dev));

  // Simulate 1 gateway LLM call during device run (writes -actual 'settle' row)
  const tok = await mintJobToken(SECRET, dev.job.id, Math.floor(Date.now() / 1000) + 600);
  const gwReq = new Request("https://stewardmd.in/api/research/v1/internal/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify({
      jobId: dev.job.id, projectId: p.id, userId: "u_pro",
      tier: "T2", model: "researchmd-writer", prompt: "Draft outline", purpose: "write", stepId: "outline",
    }),
  });
  const gwRes = await onRequest({ request: gwReq, env, params: { path: ["v1", "internal", "llm"] } });
  assert.equal(gwRes.status, 200);

  const settleRow = db.prepare("SELECT COALESCE(SUM(delta),0) AS s FROM research_credit_ledger WHERE job_id=? AND reason='settle'").get(dev.job.id);
  assert.ok(settleRow.s < 0, "gateway call recorded negative settle delta");

  // Device fails -> releases initial quote64 hold; hold_net is now 0 even though net ledger < 0
  const df = await call(env, "POST", "v1/jobs/" + dev.job.id + "/device-fail", "tok-pro", { code: "device_failed", step: "section:methods" });
  assert.equal(df.http, 200);

  // Convert to cloud -> MUST re-reserve fresh quote64 (and NOT skip reservation)
  const conv = await call(env, "POST", "v1/jobs/" + dev.job.id + "/to-cloud", "tok-pro", {
    fallback: { reasons: [{ try: 1, rule: "device_failed" }] },
  });
  assert.equal(conv.http, 202, JSON.stringify(conv));
  const reservesAfterConv = db.prepare("SELECT COUNT(*) AS n FROM research_credit_ledger WHERE job_id=? AND reason='reserve'").get(dev.job.id).n;
  // 1 initial + 1 gateway + 1 fresh conversion reserve = 3
  assert.equal(reservesAfterConv, 3);
  const outstanding = await outstandingReserves(env.RESEARCH_DB, "institution", instId);
  const quote64 = JSON.parse(db.prepare("SELECT ceilings_json FROM research_job_runs WHERE id=?").get(dev.job.id).ceilings_json).quoteMicroUsd;
  assert.equal(outstanding, quote64, "outstandingReserves must equal single active quote64 hold");

  // Calling /to-cloud again while queued MUST be rejected 409 already_converted
  const retryWhileQueued = await call(env, "POST", "v1/jobs/" + dev.job.id + "/to-cloud", "tok-pro", {});
  assert.equal(retryWhileQueued.http, 409);
  assert.equal(retryWhileQueued.error.code, "already_converted");

  // Container fails with gate_failed (non-refundable) -> settles/releases ONLY the single active reserve
  const cbFail = await sendCallback(env, dev.job.id, {
    jobId: dev.job.id,
    idempotencyKey: dev.job.idempotencyKey,
    status: "failed",
    error: "gate_failed",
    usage: { pages: 0, seconds: 10 },
  });
  assert.equal(cbFail.http, 200);
  const balEnd = await institutionBalance(env.RESEARCH_DB, instId);
  assert.equal(balEnd, initialGrant + settleRow.s, "no double credit release may mint free credits");

  // Calling /to-cloud again on failed container job MUST be rejected 409 already_converted
  const retryAfterFail = await call(env, "POST", "v1/jobs/" + dev.job.id + "/to-cloud", "tok-pro", {});
  assert.equal(retryAfterFail.http, 409);
  assert.equal(retryAfterFail.error.code, "already_converted");

  // Daily cap bypass check: 3 yesterday device jobs converted today fill today's 3/project cap
  const pCap = await makeProject(env, "tok-pro", "Yesterday Cap");
  seedManuscriptReady(env, pCap.id, "u_pro");
  const yesterday = Date.now() - 30 * 3600 * 1000;
  for (let i = 0; i < 3; i++) {
    const dJob = await call(env, "POST", "v1/projects/" + pCap.id + "/jobs", "tok-pro", {
      kind: "manuscript_draft", runner: "device", idempotencyKey: "yest-" + i,
    });
    assert.equal(dJob.http, 202);
    db.prepare("UPDATE research_job_runs SET created_ts=? WHERE id=?").run(yesterday, dJob.job.id);
    const cRes = await call(env, "POST", "v1/jobs/" + dJob.job.id + "/to-cloud", "tok-pro", {});
    assert.equal(cRes.http, 202, JSON.stringify(cRes));
    assert.ok(cRes.job.createdTs > yesterday + 1000, "createdTs updated to conversion time");
    db.prepare("UPDATE research_job_runs SET status='succeeded', completed_ts=? WHERE id=?").run(Date.now(), dJob.job.id);
  }
  const capHit = await call(env, "POST", "v1/projects/" + pCap.id + "/jobs", "tok-pro", {
    kind: "manuscript_draft", runner: "container", idempotencyKey: "today-4th",
  });
  assert.equal(capHit.http, 429);
  assert.equal(capHit.error.code, "cap_po_project_daily");
});

test("item 14: atomic conditional insert enforces monthly quota under concurrent fallback calls", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "student@example.com", 50000);
  const p = await makeProject(env, "tok-student", "Atomic Quota");
  const { month } = utcMonthRange(Date.now());
  for (let i = 0; i < 14; i++) {
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_cloud_fallbacks (id,uid,project_id,kind,job_id,month,status,reason_json,created_ts) VALUES (?,'u_student',?,'pdf',?,?,'used','{}',?)")
      .run("at_" + i, p.id, "jat_" + i, month, Date.now());
  }
  // Concurrent direct calls to recordCloudFallbackUsed when remaining=1 -> strictly 1 succeeds, 1 returns 402
  const [r1, r2] = await Promise.all([
    recordCloudFallbackUsed(env.RESEARCH_DB, { uid: "u_student", projectId: p.id, kind: "pdf", jobId: "j_race_1", fallback: {}, allowance: 15 }),
    recordCloudFallbackUsed(env.RESEARCH_DB, { uid: "u_student", projectId: p.id, kind: "pdf", jobId: "j_race_2", fallback: {}, allowance: 15 }),
  ]);
  const oks = [r1, r2].filter((r) => r.ok);
  const fails = [r1, r2].filter((r) => !r.ok);
  assert.equal(oks.length, 1);
  assert.equal(fails.length, 1);
  assert.equal(fails[0].http, 402);
  assert.equal(fails[0].code, "cloud_fallback_limit");
  const totalUsed = env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_cloud_fallbacks WHERE uid='u_student' AND month=? AND status='used'").get(month).n;
  assert.equal(totalUsed, 15);
});

test("item 15: uploadPdf idempotent replay succeeds with fallback metadata even when quota is 0", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-student", "Idem Upload");
  const fbMeta = { reasons: [{ try: 1, rule: "ocr-failed" }] };

  // First upload succeeds (remaining 15 -> 14 after job, here /pdfs only stores PDF)
  const first = await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-student", pdfForm("idem-same", fbMeta));
  assert.equal(first.http, 201);

  // Exhaust remaining monthly fallback quota to 0
  const { month } = utcMonthRange(Date.now());
  for (let i = 0; i < 15; i++) {
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_cloud_fallbacks (id,uid,project_id,kind,job_id,month,status,reason_json,created_ts) VALUES (?,'u_student',?,'pdf',?,?,'used','{}',?)")
      .run("exh_" + i, p.id, "jexh_" + i, month, Date.now());
  }

  // Retry upload of same PDF with fallback metadata -> 200 idempotentReplay: true (not 402!)
  const replay = await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-student", pdfForm("idem-same", fbMeta));
  assert.equal(replay.http, 200, JSON.stringify(replay));
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.pdf.id, first.pdf.id);

  // New PDF with fallback at limit still returns 402 BEFORE R2 write
  const r2Before = env.RESEARCH_R2._m.size;
  const freshUp = await callForm(env, "v1/projects/" + p.id + "/pdfs", "tok-student", pdfForm("idem-new", fbMeta));
  assert.equal(freshUp.http, 402);
  assert.equal(freshUp.error.code, "cloud_fallback_limit");
  assert.equal(env.RESEARCH_R2._m.size, r2Before);
});

test("item 16: sanitizeFallbackMetadata strips free-form detail field", { skip: SKIP }, () => {
  const clean = sanitizeFallbackMetadata({
    reasons: [{ try: 2, rule: "ocr-failed", code: "ocr_err", detail: "Patient Ramesh MRN 9912 col=dob" }],
    device: { model: "iPhone16,1" },
  });
  assert.equal(clean.reasons.length, 1);
  assert.equal(clean.reasons[0].try, 2);
  assert.equal(clean.reasons[0].rule, "ocr-failed");
  assert.equal(clean.reasons[0].code, "ocr_err");
  assert.equal("detail" in clean.reasons[0], false);
});
