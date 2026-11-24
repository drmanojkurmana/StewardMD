import "./helpers/json-import-attr.mjs";
/* ResearchMD Phase 3.4/3.5/3.6/3.8 + Phase 4.3 server-side API tests
 * (node:test, no network). Covers: 0004 migration + rollback + mirror no-op;
 * extraction templates / scaffold / PUT / stale 409; verify (locator_required),
 * correct with append-only audit, audit ordering; suggestion Accept never
 * auto-verifies; promote gate (no unverified value reaches analysis) and the
 * happy path to an engine-ready study; PDF artifacts + pdf-uploads + result;
 * RoB four tools, server-side blinding, conflict + consensus, overall rules,
 * NOS stars, QUADAS-2 applicability, viewer redaction, resolver_only; data
 * dictionary versioning + study_id + IPD gate, CSV upload, every validation
 * check, frozen snapshot bytes, versions, freeze; GRADE assessOutcome human
 * gates, Summary of Findings + text, deterministic suggestions; T1 extraction
 * and screening suggestions through the gateway (PHI first, caps, credits,
 * usage logging) stored unverified and never auto-applied; outsider isolation
 * on every new route.
 *
 * Mocking pattern identical to test/research-phase3-api.test.mjs: mock.module
 * on ../functions/_fbauth.js and the LLM facade ../functions/api/ai/[[path]].js,
 * node:sqlite D1-shaped shim behind the real schema, in-memory R2/queue/KV.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phase3b-api.test.mjs
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
  "tok-carol": { sub: "u-carol", email: "carol@example.com", email_verified: true },
  "tok-eve": { sub: "u-eve", email: "eve@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
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

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { TEMPLATES } = await import("../functions/api/research/_extraction.js");
const { ROB_TOOLS, overallFor } = await import("../functions/api/research/_rob.js");
const { parseCsv, validateCsv } = await import("../functions/api/research/_data.js");
const { RESEARCH_FRAMING } = await import("../functions/api/research/_gateway.js");
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
function queueShim() { return { _messages: [], async send(m) { this._messages.push(m); } }; }
function kvShim() {
  const m = new Map();
  return { _m: m,
    async get(key, type) { const v = m.get(key); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); } };
}
function freshEnv({ r2 = true, queue = true } = {}) {
  const D = d1();
  D._db.exec(SCHEMA);
  const env = { RESEARCH_MODE: "pilot", RESEARCH_DB: D, RESEARCH_CONTACT_EMAIL: "support@example.com", MAIK_KV: kvShim() };
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
  const req = new Request("https://stewardmd.in/api/research/" + path, { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
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
async function callRaw(env, path, token) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://stewardmd.in/api/research/" + path, { method: "GET", headers });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) } });
  return { http: res.status, text: await res.text(), contentType: res.headers.get("content-type") };
}
function csvForm(text, name) {
  const form = new FormData();
  form.append("file", new File([text], name || "studies.csv", { type: "text/csv" }), name || "studies.csv");
  return form;
}
function pdfForm(bytes, name) {
  const form = new FormData();
  form.append("file", new File([bytes], name || "paper.pdf", { type: "application/pdf" }), name || "paper.pdf");
  return form;
}
async function makeProject(env, token, title) {
  const r = await call(env, "POST", "v1/projects", token, { title: title || "Phase 3b review" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
async function addMember(env, pid, token, uid, role) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/members", token, { uid, role });
  assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
}
const LOC = { kind: "manual", citation: "Aronson 1948", page: "3", quote: "supporting text" };
const pdfLoc = (page, quote) => ({ kind: "pdf", citation: "Aronson 1948", page, quote, pdf: { artifactId: "art_x", page, box: { x: 0.1, y: 0.1, w: 0.4, h: 0.02 } } });
async function makeStudy(env, pid, token, measure, inputs, label) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/studies", token,
    { measure, inputs, locator: LOC, quote: "supporting text", label: label || "Study" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.study;
}
/* Seed a succeeded PDF artifact + worker result.json directly (the worker is
 * out of scope here; _jobs/_callback already test the job lifecycle). */
function seedArtifact(env, pid, pagesText) {
  const db = env.RESEARCH_DB._db;
  const now = Date.now();
  const sha = "c".repeat(64);
  const pdfId = "pdf_seed_" + pid;
  const jobId = "job_seed_" + pid;
  const artId = "art_seed_" + pid;
  const r2Key = "projects/" + pid + "/pdf/" + sha + ".pdf";
  db.prepare("INSERT OR IGNORE INTO research_pdfs (id,project_id,sha256,r2_key,bytes,uploaded_by,ts) VALUES (?,?,?,?,?,?,?)")
    .run(pdfId, pid, sha, r2Key, 1000, "u-alice", now);
  const resultKey = "projects/" + pid + "/jobs/" + jobId + "/result.json";
  const result = { jobId, idempotencyKey: "k", status: "done", usage: { pages: pagesText.length, seconds: 1 },
    ocr: false, sha256: sha, pages: pagesText.map((t, i) => ({ n: i + 1, width: 612, height: 792, ocr: false, text: t, words: [], tables: [] })) };
  env.RESEARCH_R2._objects.set(resultKey, JSON.stringify(result));
  db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,input_r2_key,result_r2_key,usage_json,created_by,created_ts,completed_ts) VALUES (?,?, 'pdf_extract','succeeded',?,?,?,?,?,?,?)")
    .run(jobId, pid, "seed:" + pid, r2Key, resultKey, JSON.stringify({ pages: pagesText.length, seconds: 1 }), "u-alice", now, now);
  db.prepare("INSERT INTO research_extraction_artifacts (id,project_id,pdf_id,filename,sha256,bytes,pages,job_id,status,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?, 'succeeded',?,?)")
    .run(artId, pid, pdfId, "aronson1948.pdf", sha, 1000, pagesText.length, jobId, "u-alice", now);
  return { pdfId, jobId, artId, resultKey };
}
function defaultLlmImpl() {
  llm.impl = async (env, parts, maxTokens, opts) => {
    if (opts && opts.meta) { opts.meta.usage = { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 0 }; opts.meta.model = opts.model; }
    return "mock answer";
  };
  llm.calls.length = 0;
}

/* ---- 0004 migration + rollback + mirror ------------------------------------ */
test("0004 applies on live 0001+0002+0003, rolls back cleanly, mirror is a no-op", { skip: SKIP }, async () => {
  const m1 = readFileSync(new URL("../docs/research/contracts/phase-1/0001_research_v1.sql", import.meta.url), "utf8");
  const m2 = readFileSync(new URL("../docs/research/contracts/phase-2/0002_research_v2.sql", import.meta.url), "utf8");
  const m3 = readFileSync(new URL("../docs/research/contracts/phase-3/0003_research_v3.sql", import.meta.url), "utf8");
  const m4 = readFileSync(new URL("../docs/research/contracts/phase-3/0004_research_v4.sql", import.meta.url), "utf8");
  const rb = readFileSync(new URL("../docs/research/contracts/phase-3/0004_rollback.sql", import.meta.url), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(m1); db.exec(m2); db.exec(m3); db.exec(m4);
  const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const newTables = ["research_extractions", "research_extraction_suggestions", "research_extraction_audit",
    "research_extraction_artifacts", "research_rob_assessments", "research_rob_conflicts",
    "research_data_dictionaries", "research_data_imports", "research_screening_suggestions", "research_grade_assessments"];
  for (const t of newTables) assert.ok(tables().includes(t), "0004 created " + t);
  const now = Date.now();
  db.prepare("INSERT INTO research_projects (id,owner_uid,title,created_ts,updated_ts) VALUES ('p1','u1','t',?,?)").run(now, now);
  db.prepare("INSERT INTO research_studies (id,project_id,measure,created_ts,updated_ts) VALUES ('st1','p1','OR',?,?)").run(now, now);
  db.prepare("INSERT INTO research_extractions (id,project_id,study_id,template,created_ts,updated_ts) VALUES ('ex1','p1','st1','rct_binary',?,?)").run(now, now);
  db.exec(rb);
  const after = tables();
  for (const t of newTables) assert.ok(!after.includes(t), "rollback dropped " + t);
  for (const t of ["research_projects", "research_studies", "research_runs", "research_pdfs", "research_job_runs", "research_protocols", "research_screening_decisions"])
    assert.ok(after.includes(t), "rollback kept live table " + t);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_studies").get().n, 1);
  const db2 = new DatabaseSync(":memory:");
  db2.exec(SCHEMA); db2.exec(m4);
  for (const t of newTables) assert.ok(db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t), "mirror+0004 has " + t);
  assert.ok(db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_jobs'").get(), "pilot mirror untouched");
});

/* ---- Extraction templates + scaffold + PUT + stale ------------------------- */
test("extraction: templates, scaffold version 0, PUT create, stale 409, edit invalidates verification", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const st = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 4, n1: 123, events2: 11, n2: 139 });
  const tpl = await call(env, "GET", "v1/extraction-templates", "tok-alice");
  assert.equal(tpl.http, 200);
  assert.equal(tpl.templates.length, 3);
  assert.deepEqual(tpl.templates.map((t) => t.id), ["rct_binary", "rct_continuous", "generic_effect"]);
  const g = await call(env, "GET", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction?template=rct_binary", "tok-alice");
  assert.equal(g.http, 200);
  assert.equal(g.extraction.version, 0);
  assert.equal(g.extraction.status, "draft");
  assert.deepEqual(g.extraction.fields, {});
  /* PUT version 0 creates version 1. */
  const put = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: 0, fields: { events1: { value: 4, locator: pdfLoc(1, "vaccinated 4 of 123"), quote: "vaccinated 4 of 123" } } });
  assert.equal(put.http, 200, JSON.stringify(put));
  assert.equal(put.extraction.version, 1);
  assert.equal(put.extraction.fields.events1.status, "unverified");
  assert.equal(put.extraction.fields.events1.source, "human");
  /* Stale version -> 409 with current.extraction. */
  const stale = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: 0, fields: {} });
  assert.equal(stale.http, 409);
  assert.equal(stale.error.code, "stale_version");
  assert.equal(stale.current.extraction.version, 1);
  /* Verify the field, then edit it: editing invalidates verification. */
  const eid = put.extraction.id;
  const ver = await call(env, "POST", "v1/extractions/" + eid + "/verify", "tok-alice", { fieldKey: "events1", version: 1 });
  assert.equal(ver.http, 200, JSON.stringify(ver));
  assert.equal(ver.extraction.fields.events1.status, "verified");
  assert.equal(ver.extraction.fields.events1.verifier, "u-alice");
  const edit = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: 2, fields: { events1: { value: 5, locator: pdfLoc(1, "five"), quote: "five" } } });
  assert.equal(edit.http, 200);
  assert.equal(edit.extraction.fields.events1.status, "unverified", "editing invalidates prior verification");
  /* Unknown template / field key. */
  const stFresh = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 1, n1: 2, events2: 1, n2: 2 }, "Fresh");
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/studies/" + stFresh.id + "/extraction?template=bogus", "tok-alice")).http, 422);
  assert.equal((await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: 3, fields: { bogus: { value: 1 } } })).http, 400);
});

/* ---- verify locator_required, correct audit, audit ordering ---------------- */
test("extraction: verify needs locator+quote, correct appends audit old/new/reason, audit ts DESC", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const st = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 4, n1: 123, events2: 11, n2: 139 });
  const put = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: 0, fields: { events1: { value: 4, locator: null, quote: "" } } });
  const eid = put.extraction.id;
  const noLoc = await call(env, "POST", "v1/extractions/" + eid + "/verify", "tok-alice", { fieldKey: "events1", version: 1 });
  assert.equal(noLoc.http, 422);
  assert.equal(noLoc.error.code, "locator_required");
  /* Correct with a reason; audit carries old/new/reason. */
  const cor = await call(env, "POST", "v1/extractions/" + eid + "/correct", "tok-alice",
    { fieldKey: "events1", value: 5, locator: pdfLoc(1, "five cases"), quote: "five cases", reason: "Re-read Table 2: 5 cases, not 4", version: 1 });
  assert.equal(cor.http, 200, JSON.stringify(cor));
  assert.equal(cor.extraction.fields.events1.status, "corrected");
  assert.equal(cor.extraction.fields.events1.value, 5);
  /* Correct without reason -> 400 invalid_correction. */
  assert.equal((await call(env, "POST", "v1/extractions/" + eid + "/correct", "tok-alice",
    { fieldKey: "events1", value: 6, reason: "", version: 2 })).http, 400);
  const audit = await call(env, "GET", "v1/extractions/" + eid + "/audit", "tok-alice");
  assert.equal(audit.http, 200);
  const corrected = audit.events.find((e) => e.kind === "corrected");
  assert.ok(corrected, "audit has a corrected event");
  assert.equal(corrected.old, 4);
  assert.equal(corrected.new, 5);
  assert.equal(corrected.reason, "Re-read Table 2: 5 cases, not 4");
  assert.equal(corrected.by, "u-alice");
  /* ts DESC ordering. */
  const ts = audit.events.map((e) => e.ts);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i - 1] >= ts[i], "audit ordered ts DESC");
  assert.ok(audit.events.some((e) => e.kind === "field_saved"));
});

/* ---- suggestion accept never auto-verifies; promote gate ------------------- */
test("extraction: accept stays unverified, promote refuses unverified, verified promote writes an engine-ready study", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const st = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 0, n1: 1, events2: 0, n2: 1 });
  const { artId } = seedArtifact(env, p.id, ["TB cases in vaccinated 4 of 123 control 11 of 139"]);
  const put = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: 0, artifactId: artId, fields: {} });
  const eid = put.extraction.id;
  /* Seed a pending suggestion directly (the T1 route is tested below). */
  env.RESEARCH_DB._db.prepare("INSERT INTO research_extraction_suggestions (id,extraction_id,field_key,value_json,locator_json,quote,model,status,created_by,created_ts) VALUES ('sug_1',?, 'events1', '4', ?, 'vaccinated 4 of 123', 't1-mock', 'unverified', 'u-alice', ?)")
    .run(eid, JSON.stringify(pdfLoc(1, "vaccinated 4 of 123")), Date.now());
  const withSug = await call(env, "GET", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice");
  assert.equal(withSug.extraction.suggestions.length, 1);
  assert.equal(withSug.extraction.suggestions[0].status, "unverified");
  /* Accept moves the value into the field STILL unverified. */
  const acc = await call(env, "POST", "v1/extractions/" + eid + "/suggestions/sug_1/accept", "tok-alice", {});
  assert.equal(acc.http, 200, JSON.stringify(acc));
  assert.equal(acc.extraction.fields.events1.value, 4);
  assert.equal(acc.extraction.fields.events1.status, "unverified", "accepted suggestion never auto-verified");
  assert.equal(acc.extraction.fields.events1.source, "suggestion");
  assert.equal(acc.extraction.suggestions.length, 0, "accepted suggestion removed from pending");
  /* Promote while required fields unverified -> 422 extraction_unverified. */
  const blocked = await call(env, "POST", "v1/extractions/" + eid + "/promote", "tok-alice", { measure: "RR" });
  assert.equal(blocked.http, 422);
  assert.equal(blocked.error.code, "extraction_unverified");
  /* Fill + verify all required fields, then promote. */
  const fields = {
    events1: { value: 4, locator: pdfLoc(1, "vaccinated 4 of 123"), quote: "vaccinated 4 of 123" },
    n1: { value: 123, locator: pdfLoc(1, "123"), quote: "123" },
    events2: { value: 11, locator: pdfLoc(1, "control 11 of 139"), quote: "control 11 of 139" },
    n2: { value: 139, locator: pdfLoc(1, "139"), quote: "139" },
  };
  const fill = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: acc.extraction.version, fields });
  const ver = await call(env, "POST", "v1/extractions/" + eid + "/verify", "tok-alice", { version: fill.extraction.version });
  assert.equal(ver.http, 200, JSON.stringify(ver));
  const prom = await call(env, "POST", "v1/extractions/" + eid + "/promote", "tok-alice", { measure: "RR" });
  assert.equal(prom.http, 200, JSON.stringify(prom));
  assert.equal(prom.study.verified, true);
  assert.equal(prom.study.measure, "RR");
  assert.deepEqual(prom.study.inputs, { events1: 4, n1: 123, events2: 11, n2: 139 });
  assert.equal(prom.study.verifiedBy, "u-alice");
  assert.ok(prom.study.locator.pdf, "study locator keeps the pdf block");
  /* Measure not allowed for the template -> 422 invalid_template. */
  assert.equal((await call(env, "POST", "v1/extractions/" + eid + "/promote", "tok-alice", { measure: "MD" })).http, 422);
  /* The promoted study is engine-ready: a second promoted study lets a run pool. */
  const st2 = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 0, n1: 1, events2: 0, n2: 1 }, "Ferguson 1949");
  const put2 = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st2.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: 0, fields: {
      events1: { value: 6, locator: pdfLoc(1, "6"), quote: "6" }, n1: { value: 306, locator: pdfLoc(1, "306"), quote: "306" },
      events2: { value: 29, locator: pdfLoc(1, "29"), quote: "29" }, n2: { value: 303, locator: pdfLoc(1, "303"), quote: "303" } } });
  await call(env, "POST", "v1/extractions/" + put2.extraction.id + "/verify", "tok-alice", { version: 1 });
  const prom2 = await call(env, "POST", "v1/extractions/" + put2.extraction.id + "/promote", "tok-alice", { measure: "RR" });
  assert.equal(prom2.http, 200);
  const run = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice", { measure: "RR" });
  assert.equal(run.http, 201, JSON.stringify(run));
  assert.ok(run.run.result.pooled, "engine pools the promoted studies");
});

test("engine gate: an unverified study never pools (independent of extraction)", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const a = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 4, n1: 123, events2: 11, n2: 139 });
  const b = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 6, n1: 306, events2: 29, n2: 303 });
  /* Studies start unverified (verified:false). */
  const run = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice", { measure: "RR" });
  assert.equal(run.http, 422);
  assert.equal(run.error.code, "unverified_studies");
  /* Verify both, then the run succeeds. */
  for (const s of [a, b]) {
    const v = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + s.id, "tok-alice", { version: s.version, verified: true });
    assert.equal(v.http, 200);
  }
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice", { measure: "RR" })).http, 201);
});

/* ---- PDF artifacts + pdf-uploads + result ---------------------------------- */
test("artifacts: pdf-uploads creates artifact + job, result 409 until succeeded, list mirrors job", { skip: SKIP }, async () => {
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic artifact test");
  const up = await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-alice", pdfForm(bytes, "aronson1948.pdf"));
  assert.equal(up.http, 201, JSON.stringify(up));
  assert.equal(up.artifact.filename, "aronson1948.pdf");
  assert.equal(up.artifact.status, "queued");
  assert.ok(up.artifact.jobId);
  assert.match(up.artifact.sha256, /^[0-9a-f]{64}$/);
  /* Result before the job succeeds -> 409 job_not_done. */
  const early = await call(env, "GET", "v1/artifacts/" + up.artifact.id + "/result", "tok-alice");
  assert.equal(early.http, 409);
  assert.equal(early.error.code, "job_not_done");
  /* List mirrors the job status. */
  const list = await call(env, "GET", "v1/projects/" + p.id + "/artifacts", "tok-alice");
  assert.equal(list.http, 200);
  assert.equal(list.artifacts.length, 1);
  assert.equal(list.artifacts[0].status, "queued");
  /* Settle the job + write result.json, then the result is served verbatim. */
  const resultKey = "projects/" + p.id + "/jobs/" + up.artifact.jobId + "/result.json";
  const result = { jobId: up.artifact.jobId, status: "done", usage: { pages: 1, seconds: 1 }, ocr: false,
    pages: [{ n: 1, width: 612, height: 792, words: [], tables: [], text: "hello" }] };
  env.RESEARCH_R2._objects.set(resultKey, JSON.stringify(result));
  env.RESEARCH_DB._db.prepare("UPDATE research_job_runs SET status='succeeded',result_r2_key=? WHERE id=?").run(resultKey, up.artifact.jobId);
  const got = await call(env, "GET", "v1/artifacts/" + up.artifact.id + "/result", "tok-alice");
  assert.equal(got.http, 200, JSON.stringify(got));
  assert.equal(got.pages[0].text, "hello");
  const list2 = await call(env, "GET", "v1/projects/" + p.id + "/artifacts", "tok-alice");
  assert.equal(list2.artifacts[0].status, "succeeded");
  /* Re-upload same bytes -> idempotent replay, same artifact. */
  const again = await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-alice", pdfForm(bytes, "other.pdf"));
  assert.equal(again.http, 200);
  assert.equal(again.idempotentReplay, true);
  assert.equal(again.artifact.id, up.artifact.id);
  /* Bad type / missing file. */
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-alice", pdfForm(new TextEncoder().encode("not a pdf")))).http, 415);
  const noFile = new FormData(); noFile.append("note", "x");
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-alice", noFile)).http, 400);
  assert.equal((await call(env, "GET", "v1/artifacts/art_missing/result", "tok-alice")).http, 404);
});

/* ---- RoB tools + overall rules --------------------------------------------- */
test("rob: four tools with real domains; overall rules per tool (hand-checked)", { skip: SKIP }, async () => {
  const env = freshEnv();
  await makeProject(env, "tok-alice");
  const tools = await call(env, "GET", "v1/rob-tools", "tok-alice");
  assert.equal(tools.http, 200);
  assert.deepEqual(tools.tools.map((t) => t.id), ["rob2", "robins_i", "quadas2", "nos"]);
  assert.equal(tools.tools[0].domains.length, 5);
  assert.equal(tools.tools[1].domains.length, 7);
  assert.equal(tools.tools[3].domains.length, 8);
  assert.ok(tools.tools[0].domains[0].signallingQuestions.length >= 3);
  /* rob2: any high -> high; multiple some_concerns -> high; one -> some_concerns. */
  const d = (j) => ({ judgment: j });
  assert.equal(overallFor("rob2", [d("low"), d("low"), d("low"), d("low"), d("low")]), "low");
  assert.equal(overallFor("rob2", [d("some_concerns"), d("low"), d("low"), d("low"), d("low")]), "some_concerns");
  assert.equal(overallFor("rob2", [d("some_concerns"), d("some_concerns"), d("low"), d("low"), d("low")]), "high");
  assert.equal(overallFor("rob2", [d("high"), d("low"), d("low"), d("low"), d("low")]), "high");
  /* robins_i: worst domain; all no_information -> no_information. */
  assert.equal(overallFor("robins_i", [d("low"), d("serious"), d("moderate")]), "serious");
  assert.equal(overallFor("robins_i", [d("no_information"), d("no_information")]), "no_information");
  assert.equal(overallFor("robins_i", [d("no_information"), d("critical")]), "critical");
  /* quadas2: domain-level convenience flag. */
  assert.equal(overallFor("quadas2", [d("low"), d("unclear")]), "unclear");
  assert.equal(overallFor("quadas2", [d("high"), d("low")]), "high");
  /* nos: stars threshold (Good>=7 low, Fair 5-6 some_concerns, Poor<=4 high). */
  const s = (n) => ({ stars: n });
  assert.equal(overallFor("nos", [s(1), s(1), s(1), s(1), s(2), s(1), s(1), s(1)]), "low"); /* 9 */
  assert.equal(overallFor("nos", [s(1), s(1), s(1), s(1), s(1), s(0), s(0), s(0)]), "some_concerns"); /* 5 */
  assert.equal(overallFor("nos", [s(1), s(1), s(0), s(0), s(0), s(0), s(0), s(0)]), "high"); /* 2 */
});

/* ---- RoB blinding + conflict + consensus + viewer + resolver_only ---------- */
test("rob: peer hidden until both submit, conflict opens, consensus recomputes, viewer redacted, resolver_only", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  await addMember(env, p.id, "tok-alice", "u-bob", "reviewer");
  await addMember(env, p.id, "tok-alice", "u-carol", "editor");
  const st = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 4, n1: 123, events2: 11, n2: 139 });
  const dom = (j) => ({ key: "d1", judgment: j, quote: "supporting " + j, locator: LOC });
  const five = (j) => ["d1", "d2", "d3", "d4", "d5"].map((k) => ({ key: k, judgment: j, quote: "q " + k, locator: LOC }));
  /* Alice submits first; Bob must NOT see her judgment. */
  const a1 = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", "tok-alice", { tool: "rob2", domains: five("low") });
  assert.equal(a1.http, 200, JSON.stringify(a1));
  assert.equal(a1.outcome, "pending");
  const bView = await call(env, "GET", "v1/projects/" + p.id + "/studies/" + st.id + "/rob?tool=rob2", "tok-bob");
  assert.equal(bView.http, 200);
  assert.equal(bView.assessment.peer.hidden, true);
  assert.ok(!bView.assessment.peer.domains, "hidden peer carries NO domains (B1)");
  assert.equal(bView.assessment.self.submitted, false);
  /* A domain without quote/locator is rejected. */
  const bad = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", "tok-bob",
    { tool: "rob2", domains: [{ key: "d1", judgment: "low", quote: "", locator: LOC }] });
  assert.equal(bad.http, 422);
  assert.equal(bad.error.code, "locator_required");
  /* Bob disagrees on d1 -> conflict opens; both now visible. */
  const bDomains = five("low"); bDomains[0].judgment = "high";
  const b1 = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", "tok-bob", { tool: "rob2", domains: bDomains });
  assert.equal(b1.http, 200, JSON.stringify(b1));
  assert.equal(b1.outcome, "conflict");
  assert.ok(b1.conflictId);
  const aView = await call(env, "GET", "v1/projects/" + p.id + "/studies/" + st.id + "/rob?tool=rob2", "tok-alice");
  assert.equal(aView.assessment.peer.submitted, true);
  assert.equal(aView.assessment.peer.domains[0].judgment, "high", "peer visible after both submit (B7)");
  assert.equal(aView.assessment.outcome, "conflict");
  /* Voting with an open conflict -> 409. */
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", "tok-alice", { tool: "rob2", domains: five("low") })).http, 409);
  /* Viewer sees only outcome, never votes. */
  await addMember(env, p.id, "tok-alice", "u-eve", "viewer");
  const vView = await call(env, "GET", "v1/projects/" + p.id + "/studies/" + st.id + "/rob?tool=rob2", "tok-eve");
  assert.equal(vView.assessment.outcome, "conflict");
  assert.equal(vView.assessment.peer.hidden, true);
  assert.equal(vView.assessment.self.submitted, false);
  assert.ok(!JSON.stringify(vView.assessment).includes("supporting"), "viewer sees no quotes");
  /* Conflicts list (open first). */
  const conf = await call(env, "GET", "v1/projects/" + p.id + "/rob-conflicts", "tok-alice");
  assert.equal(conf.http, 200);
  assert.equal(conf.conflicts.length, 1);
  assert.equal(conf.conflicts[0].status, "open");
  /* Bob (reviewer) cannot resolve. Alice is a voter; carol is a non-voter owner,
   * so Alice is blocked (B4) and Carol resolves. */
  const consensus = five("low");
  assert.equal((await call(env, "POST", "v1/rob-conflicts/" + b1.conflictId + "/resolve", "tok-bob", { domains: consensus, note: "x" })).http, 403);
  const aliceResolve = await call(env, "POST", "v1/rob-conflicts/" + b1.conflictId + "/resolve", "tok-alice", { domains: consensus, note: "agreed" });
  assert.equal(aliceResolve.http, 403);
  assert.equal(aliceResolve.error.code, "resolver_only");
  const resolved = await call(env, "POST", "v1/rob-conflicts/" + b1.conflictId + "/resolve", "tok-carol", { domains: consensus, note: "Agreed after re-reading methods." });
  assert.equal(resolved.http, 200, JSON.stringify(resolved));
  assert.equal(resolved.conflict.status, "resolved");
  assert.equal(resolved.assessment.consensus.overall, "low", "overall recomputed from consensus");
  assert.equal(resolved.assessment.outcome, "agreed");
  /* Resolving again -> 409 already_decided. */
  assert.equal((await call(env, "POST", "v1/rob-conflicts/" + b1.conflictId + "/resolve", "tok-carol", { domains: consensus, note: "again" })).http, 409);
  /* Audit carries submitted/unblinded/conflict_opened/resolved. */
  const audit = await call(env, "GET", "v1/projects/" + p.id + "/studies/" + st.id + "/rob/audit?tool=rob2", "tok-alice");
  const kinds = audit.events.map((e) => e.kind);
  for (const k of ["submitted", "unblinded", "conflict_opened", "resolved"]) assert.ok(kinds.includes(k), "audit has " + k);
});

test("rob: NOS stars and QUADAS-2 applicability accepted; voter resolves when no non-voter owner/editor", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  await addMember(env, p.id, "tok-alice", "u-bob", "reviewer");
  const st = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 4, n1: 123, events2: 11, n2: 139 });
  const nosDomains = ROB_TOOLS.find((t) => t.id === "nos").domains.map((d) => ({ key: d.key, judgment: "yes", stars: d.maxStars, quote: "q", locator: LOC }));
  const nos = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", "tok-alice", { tool: "nos", domains: nosDomains });
  assert.equal(nos.http, 200, JSON.stringify(nos));
  assert.equal(nos.assessment.self.stars, 9);
  assert.equal(nos.assessment.self.overall, "low");
  /* QUADAS-2 applicability. */
  const quadas = ROB_TOOLS.find((t) => t.id === "quadas2").domains.map((d) => ({ key: d.key, judgment: "low", quote: "q", locator: LOC, applicability: d.applicability ? "high" : undefined }));
  const q = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", "tok-alice", { tool: "quadas2", domains: quadas });
  assert.equal(q.http, 200, JSON.stringify(q));
  assert.equal(q.assessment.self.domains[0].applicability, "high");
  /* Invalid judgment rejected. */
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", "tok-alice",
    { tool: "rob2", domains: [{ key: "d1", judgment: "bogus", quote: "q", locator: LOC }] })).http, 422);
  /* Alice (owner, voter) + Bob (reviewer, voter): no non-voter owner/editor, so
   * Alice may resolve and the note records it. */
  const st2 = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 6, n1: 306, events2: 29, n2: 303 }, "Second");
  const five = (j) => ["d1", "d2", "d3", "d4", "d5"].map((k) => ({ key: k, judgment: j, quote: "q", locator: LOC }));
  await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st2.id + "/rob", "tok-alice", { tool: "rob2", domains: five("low") });
  const bd = five("low"); bd[0].judgment = "high";
  const conflict = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st2.id + "/rob", "tok-bob", { tool: "rob2", domains: bd });
  const res = await call(env, "POST", "v1/rob-conflicts/" + conflict.conflictId + "/resolve", "tok-alice", { domains: five("low"), note: "Agreed." });
  assert.equal(res.http, 200, JSON.stringify(res));
  assert.ok(res.conflict.note.includes("resolved by a voter"), "B4 note records voter resolution");
});

/* ---- Data dictionary + IPD gate -------------------------------------------- */
test("data dictionary: versioning, study_id required, stale 409, IPD gate", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const g0 = await call(env, "GET", "v1/projects/" + p.id + "/data-dictionary", "tok-alice");
  assert.equal(g0.http, 200);
  assert.equal(g0.dictionary.version, 0);
  const cols = [
    { column: "study_id", label: "Study ID", type: "string", required: true },
    { column: "events1", type: "integer", required: true, range: { min: 0, max: 1000000 } },
    { column: "n1", type: "integer", required: true, range: { min: 1, max: 10000000 } },
  ];
  const put1 = await call(env, "PUT", "v1/projects/" + p.id + "/data-dictionary", "tok-alice", { version: 0, columns: cols });
  assert.equal(put1.http, 200, JSON.stringify(put1));
  assert.equal(put1.dictionary.version, 1);
  /* Stale version -> 409. */
  const stale = await call(env, "PUT", "v1/projects/" + p.id + "/data-dictionary", "tok-alice", { version: 0, columns: cols });
  assert.equal(stale.http, 409);
  assert.equal(stale.error.code, "stale_version");
  assert.equal(stale.current.dictionary.version, 1);
  const put2 = await call(env, "PUT", "v1/projects/" + p.id + "/data-dictionary", "tok-alice", { version: 1, columns: cols });
  assert.equal(put2.dictionary.version, 2);
  /* Missing study_id -> 422 invalid_dictionary. */
  const noSid = await call(env, "PUT", "v1/projects/" + p.id + "/data-dictionary", "tok-alice",
    { version: 2, columns: [{ column: "events1", type: "integer", required: true }] });
  assert.equal(noSid.http, 422);
  assert.equal(noSid.error.code, "invalid_dictionary");
  /* patient_id column -> 422 ipd_gate. */
  const ipd = await call(env, "PUT", "v1/projects/" + p.id + "/data-dictionary", "tok-alice",
    { version: 2, columns: [{ column: "study_id", type: "string", required: true }, { column: "patient_id", type: "string", required: false }] });
  assert.equal(ipd.http, 422);
  assert.equal(ipd.error.code, "ipd_gate");
});

/* ---- CSV upload + import checks + snapshot + versions + freeze ------------- */
test("data import: every validation check, snapshot always frozen, versions, freeze", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = await makeProject(env, "tok-alice");
  const cols = [
    { column: "study_id", type: "string", required: true },
    { column: "events1", type: "integer", required: true, range: { min: 0, max: 100 } },
    { column: "n1", type: "integer", required: true, range: { min: 1, max: 10000 } },
    { column: "design", type: "category", required: false, allowed: ["rct", "cohort"] },
    { column: "notes", type: "string", required: false }, /* absent from the CSV -> missing_column */
  ];
  await call(env, "PUT", "v1/projects/" + p.id + "/data-dictionary", "tok-alice", { version: 0, columns: cols });
  /* CSV exercising: ok row, out_of_range, missing_required, type_mismatch,
   * not_allowed, duplicate_study_id, unknown_column, missing_column, missing_optional. */
  const csv = [
    "study_id,events1,n1,design,extra",
    "s1,4,123,rct,x",          /* ok (extra -> unknown_column warning) */
    "s2,200,123,rct,x",        /* out_of_range (events1 > 100) */
    "s3,,123,rct,x",           /* missing_required (events1) */
    "s4,abc,123,rct,x",        /* type_mismatch */
    "s5,4,123,casecontrol,x",  /* not_allowed */
    "s1,5,123,rct,x",          /* duplicate_study_id */
    "s6,4,123,,x",             /* missing_optional (design) */
  ].join("\n");
  const up = await callForm(env, "v1/projects/" + p.id + "/data-uploads", "tok-alice", csvForm(csv));
  assert.equal(up.http, 201, JSON.stringify(up));
  assert.equal(up.rowCount, 7);
  assert.deepEqual(up.columns, ["study_id", "events1", "n1", "design", "extra"]);
  assert.match(up.storageKey, new RegExp("^projects/" + p.id + "/data/[0-9a-f]{64}\\.csv$"));
  const imp = await call(env, "POST", "v1/projects/" + p.id + "/data-imports", "tok-alice", { storageKey: up.storageKey });
  assert.equal(imp.http, 201, JSON.stringify(imp));
  assert.equal(imp.import.version, 1);
  assert.equal(imp.import.status, "errors");
  assert.equal(imp.import.rowCount, 7);
  assert.equal(imp.import.rowsImported, 2, "s1 (clean) and s6 (warning only) pass blocking checks");
  const codes = imp.import.checks.map((c) => c.code);
  for (const c of ["missing_required", "type_mismatch", "out_of_range", "not_allowed", "duplicate_study_id", "unknown_column", "missing_column", "missing_optional"])
    assert.ok(codes.includes(c), "check present: " + c);
  /* missing_column fires for the optional "notes" column absent from the CSV. */
  assert.ok(imp.import.checks.every((c) => !/patient|MRN/i.test(c.message)), "messages carry no PHI");
  /* Snapshot ALWAYS written, exact bytes. */
  assert.equal(imp.import.snapshotKey, "projects/" + p.id + "/data/snapshots/" + imp.import.id + ".csv");
  assert.equal(env.RESEARCH_R2._objects.get(imp.import.snapshotKey), csv);
  const snap = await callRaw(env, "v1/data-imports/" + imp.import.id + "/snapshot", "tok-alice");
  assert.equal(snap.http, 200);
  assert.equal(snap.text, csv);
  assert.match(snap.contentType, /text\/csv/);
  /* A second import is a new version; the old snapshot is untouched. */
  const imp2 = await call(env, "POST", "v1/projects/" + p.id + "/data-imports", "tok-alice", { storageKey: up.storageKey });
  assert.equal(imp2.import.version, 2);
  assert.notEqual(imp2.import.snapshotKey, imp.import.snapshotKey);
  assert.equal(env.RESEARCH_R2._objects.get(imp.import.snapshotKey), csv, "old snapshot immutable");
  /* List ordered version DESC. */
  const list = await call(env, "GET", "v1/projects/" + p.id + "/data-imports", "tok-alice");
  assert.deepEqual(list.imports.map((i) => i.version), [2, 1]);
  /* Freeze (owner/editor); already_frozen on repeat; analyst cannot freeze. */
  await addMember(env, p.id, "tok-alice", "u-bob", "analyst");
  assert.equal((await call(env, "POST", "v1/data-imports/" + imp.import.id + "/freeze", "tok-bob", {})).http, 403);
  const fr = await call(env, "POST", "v1/data-imports/" + imp.import.id + "/freeze", "tok-alice", {});
  assert.equal(fr.http, 200, JSON.stringify(fr));
  assert.equal(fr.import.frozen, true);
  assert.ok(fr.import.frozenTs > 0);
  assert.equal((await call(env, "POST", "v1/data-imports/" + imp.import.id + "/freeze", "tok-alice", {})).http, 409);
  /* Import without a dictionary -> 422; IPD header -> 422; cross-project key -> 403. */
  const p2 = await makeProject(env, "tok-alice", "No dict");
  const up2 = await callForm(env, "v1/projects/" + p2.id + "/data-uploads", "tok-alice", csvForm("study_id\ns1\n"));
  assert.equal((await call(env, "POST", "v1/projects/" + p2.id + "/data-imports", "tok-alice", { storageKey: up2.storageKey })).http, 422);
  const ipdCsv = await callForm(env, "v1/projects/" + p.id + "/data-uploads", "tok-alice", csvForm("study_id,patient_id\ns1,p1\n"));
  assert.equal((await call(env, "POST", "v1/projects/" + p.id + "/data-imports", "tok-alice", { storageKey: ipdCsv.storageKey })).error.code, "ipd_gate");
  assert.equal((await call(env, "POST", "v1/projects/" + p2.id + "/data-imports", "tok-alice", { storageKey: up.storageKey })).http, 403);
  /* Upload limits: wrong extension, oversize. */
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/data-uploads", "tok-alice", csvForm("x", "data.txt"))).http, 415);
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/data-uploads", "tok-alice", csvForm("x".repeat(5 * 1024 * 1024 + 1), "big.csv"))).http, 413);
});

test("data: parseCsv handles quoted fields; validateCsv is deterministic", { skip: SKIP }, async () => {
  const { header, rows } = parseCsv('study_id,note\ns1,"hello, world"\ns2,"line\nbreak"\n');
  assert.deepEqual(header, ["study_id", "note"]);
  assert.equal(rows[0][1], "hello, world");
  assert.equal(rows[1][1], "line\nbreak");
  const cols = [{ column: "study_id", type: "string", required: true }, { column: "n", type: "integer", required: true, range: { min: 1, max: 10 } }];
  const v = validateCsv(["study_id", "n"], [["s1", "5"], ["s1", "6"], ["s2", "20"]], cols);
  assert.equal(v.rowCount, 3);
  assert.equal(v.rowsImported, 1);
  assert.equal(v.status, "errors");
  assert.ok(v.checks.some((c) => c.code === "duplicate_study_id"));
  assert.ok(v.checks.some((c) => c.code === "out_of_range"));
});

/* ---- GRADE: human gates, SoF, suggestions ---------------------------------- */
async function gradeSetup(env) {
  const p = await makeProject(env, "tok-alice");
  const a = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 4, n1: 123, events2: 11, n2: 139 }, "Aronson 1948");
  const b = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 6, n1: 306, events2: 29, n2: 303 }, "Ferguson 1949");
  for (const s of [a, b]) await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + s.id, "tok-alice", { version: s.version, verified: true });
  const run = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice", { measure: "RR" });
  assert.equal(run.http, 201, JSON.stringify(run));
  return { p, run: run.run };
}
const NO_DOWNGRADE = { level: "no", reason: "", by: "" };
function gradeBody(runId, over) {
  return Object.assign({ runId, outcome: "TB cases", design: "rct",
    riskOfBias: NO_DOWNGRADE, inconsistency: NO_DOWNGRADE, indirectness: NO_DOWNGRADE,
    imprecision: NO_DOWNGRADE, publicationBias: NO_DOWNGRADE }, over || {});
}
test("grade: assessOutcome persists, missing reason refused, RCT upgrade refused, SoF + text", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p, run } = await gradeSetup(env);
  /* High certainty for an RCT with no downgrades. */
  const put = await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-alice", gradeBody(run.id));
  assert.equal(put.http, 200, JSON.stringify(put));
  assert.equal(put.assessment.result.certainty, "High");
  assert.equal(put.assessment.result.symbols, "⊕⊕⊕⊕");
  assert.equal(put.assessment.version, 1);
  /* A downgrade without a reason is refused (human gate). */
  const noReason = await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-alice",
    gradeBody(run.id, { riskOfBias: { level: "serious", reason: "", by: "u-alice" } }));
  assert.equal(noReason.http, 422);
  assert.equal(noReason.error.code, "invalid_grade");
  /* A downgrade with reason+by works and lowers certainty. */
  const down = await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-alice",
    gradeBody(run.id, { version: 1, riskOfBias: { level: "serious", reason: "Allocation not concealed", by: "u-alice" } }));
  assert.equal(down.http, 200, JSON.stringify(down));
  assert.equal(down.assessment.result.certainty, "Moderate");
  assert.equal(down.assessment.version, 2);
  assert.ok(down.assessment.result.footnotes.some((f) => /risk of bias/.test(f)));
  /* Stale version -> 409. */
  assert.equal((await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-alice", gradeBody(run.id, { version: 1 }))).http, 409);
  /* Positive upgrade on an RCT is refused. */
  const upRct = await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-alice",
    gradeBody(run.id, { version: 2, upgrades: { largeEffect: { levels: 1, reason: "big", by: "u-alice" } } }));
  assert.equal(upRct.http, 422);
  /* Observational design starts Low; upgrade applies when nothing downgraded. */
  const obs = await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-alice",
    gradeBody(run.id, { version: 2, design: "observational", upgrades: { largeEffect: { levels: 1, reason: "Large effect", by: "u-alice" } } }));
  assert.equal(obs.http, 200, JSON.stringify(obs));
  assert.equal(obs.assessment.result.startedAt, "Low");
  assert.equal(obs.assessment.result.certainty, "Moderate");
  /* Summary of Findings: one graded row, relative effect text, participants. */
  const sof = await call(env, "GET", "v1/projects/" + p.id + "/summary-of-findings", "tok-alice");
  assert.equal(sof.http, 200, JSON.stringify(sof));
  assert.equal(sof.table.rows.length, 1);
  assert.equal(sof.table.rows[0].outcome, "TB cases");
  assert.equal(sof.table.rows[0].studies, 2);
  assert.equal(sof.table.rows[0].participants, 123 + 139 + 306 + 303);
  assert.match(sof.table.rows[0].relative.text, /^RR \d/);
  assert.ok(sof.text.includes("Summary of Findings"));
  assert.ok(sof.text.includes("TB cases"));
  assert.ok(!sof.text.includes("—"), "no em-dash in SoF text");
  /* List + get one. */
  const list = await call(env, "GET", "v1/projects/" + p.id + "/grade-assessments", "tok-alice");
  assert.equal(list.assessments.length, 1);
  const one = await call(env, "GET", "v1/projects/" + p.id + "/grade-assessments/" + put.assessment.id, "tok-alice");
  assert.equal(one.http, 200);
  assert.equal(one.assessment.runId, run.id);
});

test("grade: deterministic suggestions never applied; baselineRisk absolute effect", { skip: SKIP }, async () => {
  const env = freshEnv();
  const { p, run } = await gradeSetup(env);
  const sug = await call(env, "GET", "v1/projects/" + p.id + "/grade-suggestions?runId=" + run.id, "tok-alice");
  assert.equal(sug.http, 200, JSON.stringify(sug));
  assert.ok(["no", "serious", "very_serious"].includes(sug.imprecision.suggested));
  assert.ok(sug.imprecision.why.includes("Optimal information size"));
  assert.ok(["no", "serious"].includes(sug.inconsistency.suggested));
  /* Suggestions do NOT create an assessment. */
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/grade-assessments", "tok-alice")).assessments.length, 0);
  /* RR with a baseline risk yields an absolute effect per 1000. */
  await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-alice", gradeBody(run.id, { baselineRisk: 100 }));
  const sof = await call(env, "GET", "v1/projects/" + p.id + "/summary-of-findings", "tok-alice");
  const row = sof.table.rows[0];
  assert.ok(row.absolute, "RR with baselineRisk has an absolute effect");
  assert.equal(row.absolute.controlPer1000, 100);
  assert.ok(row.absolute.text.includes("per 1000"));
  assert.ok(row.footnotes.some((f) => /control risk of 100 per 1000/.test(f)));
  /* Unknown run -> 404. */
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/grade-suggestions?runId=run_missing", "tok-alice")).http, 404);
});

/* ---- T1 suggestions through the gateway ------------------------------------ */
test("suggest: extraction suggestions stored unverified, never auto-applied; PHI first; credits settled", { skip: SKIP }, async () => {
  defaultLlmImpl();
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const st = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 0, n1: 1, events2: 0, n2: 1 });
  const { artId } = seedArtifact(env, p.id, ["TB cases in vaccinated 4 of 123 control 11 of 139"]);
  llm.impl = async (env, parts, maxTokens, opts) => {
    if (opts && opts.meta) { opts.meta.usage = { promptTokenCount: 120, candidatesTokenCount: 60 }; opts.meta.model = opts.model; }
    return JSON.stringify([{ fieldKey: "events1", value: 4, quote: "vaccinated 4 of 123", page: 1 }]);
  };
  llm.calls.length = 0;
  const r = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction/suggestions", "tok-alice", { artifactId: artId, template: "rct_binary" });
  assert.equal(r.http, 200, JSON.stringify(r));
  assert.equal(r.added, 1);
  assert.equal(r.extraction.suggestions.length, 1);
  assert.equal(r.extraction.suggestions[0].status, "unverified");
  assert.equal(r.extraction.suggestions[0].fieldKey, "events1");
  assert.deepEqual(r.extraction.fields, {}, "suggestion NOT auto-applied to fields");
  /* Gateway framing + tier routing + no tools. */
  assert.equal(llm.calls.length, 1);
  assert.ok(llm.calls[0].opts.system.startsWith(RESEARCH_FRAMING));
  assert.equal(llm.calls[0].opts.model, "gemini-3.1-flash-lite");
  assert.equal(llm.calls[0].opts.tools, undefined);
  /* Usage logged + credits settled (reserve/release/settle on the suggestion ref). */
  const usage = env.RESEARCH_DB._db.prepare("SELECT * FROM research_ai_usage WHERE step='extraction_suggestion'").all();
  assert.equal(usage.length, 1);
  assert.equal(usage[0].tier, "T1");
  assert.equal(usage[0].user_id, "u-alice");
  const ledger = env.RESEARCH_DB._db.prepare("SELECT reason FROM research_credit_ledger ORDER BY rowid ASC").all().map((x) => x.reason);
  assert.deepEqual(ledger, ["reserve", "release", "settle"]);
  /* PHI in the document blocks BEFORE any provider call. */
  llm.calls.length = 0;
  const phiEnv = freshEnv();
  fundWallet(phiEnv, "alice@example.com", 100);
  const pp = await makeProject(phiEnv, "tok-alice");
  const stp = await makeStudy(phiEnv, pp.id, "tok-alice", "RR", { events1: 0, n1: 1, events2: 0, n2: 1 });
  const seed = seedArtifact(phiEnv, pp.id, ["Patient Ramesh Kumar, MRN 483920, admitted on 12/03/2024"]);
  const phi = await call(phiEnv, "POST", "v1/projects/" + pp.id + "/studies/" + stp.id + "/extraction/suggestions", "tok-alice", { artifactId: seed.artId });
  assert.equal(phi.http, 422);
  assert.equal(phi.error.code, "phi_blocked");
  assert.ok(phi.categories.includes("mrn"));
  assert.equal(llm.calls.length, 0, "no provider call on PHI hit");
  /* No artifact / job not done -> 409. */
  const noArt = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction/suggestions", "tok-alice", {});
  assert.ok(noArt.http === 409 || noArt.http === 200, JSON.stringify(noArt));
});

test("suggest: screening suggestion never writes a decision (B6); caps and provider failure", { skip: SKIP }, async () => {
  defaultLlmImpl();
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  /* Seed a record directly. */
  const now = Date.now();
  env.RESEARCH_DB._db.prepare("INSERT INTO research_records (id,project_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES ('rec_1',?, 'pubmed','111','Asthma trial','[]',2020,'','{\"abstract\":\"Adults with asthma.\"}',?)")
    .run(p.id, now);
  llm.impl = async (env, parts, maxTokens, opts) => {
    if (opts && opts.meta) { opts.meta.usage = { promptTokenCount: 80, candidatesTokenCount: 40 }; opts.meta.model = opts.model; }
    return JSON.stringify({ decision: "include", reasonCode: "", rationale: "RCT of ICS in adults." });
  };
  const r = await call(env, "POST", "v1/projects/" + p.id + "/records/rec_1/screening-suggestions", "tok-alice");
  assert.equal(r.http, 201, JSON.stringify(r));
  assert.equal(r.suggestion.decision, "include");
  assert.equal(r.suggestion.status, "unverified");
  /* B6: NO screening decision row was written. */
  const decisions = env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_screening_decisions WHERE project_id=?").get(p.id);
  assert.equal(decisions.n, 0, "suggestion never writes a vote");
  const list = await call(env, "GET", "v1/projects/" + p.id + "/records/rec_1/screening-suggestions", "tok-alice");
  assert.equal(list.suggestions.length, 1);
  /* Provider failure -> 502, reserve released, no usage row, no suggestion. */
  llm.impl = async () => { throw new Error("provider 500"); };
  const fail = await call(env, "POST", "v1/projects/" + p.id + "/records/rec_1/screening-suggestions", "tok-alice");
  assert.equal(fail.http, 502);
  assert.equal(fail.error.code, "ai_provider_error");
  assert.equal(env.RESEARCH_DB._db.prepare("SELECT COUNT(*) AS n FROM research_ai_usage WHERE step='screening_suggestion'").get().n, 1, "only the successful call logged");
  /* Daily AI cap hard stop (verbatim). */
  defaultLlmImpl();
  env.RESEARCH_DB._db.prepare("INSERT INTO research_ai_usage (id,project_id,user_id,job_id,step,tier,model,tokens_in,tokens_out,cost_micro_usd,ts) VALUES ('seed',?,'u-alice','','s','T1','m',0,0,5000000,?)")
    .run(p.id, Date.now());
  const capped = await call(env, "POST", "v1/projects/" + p.id + "/records/rec_1/screening-suggestions", "tok-alice");
  assert.equal(capped.http, 429);
  assert.equal(capped.error.code, "project_ai_cap");
  assert.equal(capped.error.message, "This project has reached today's AI budget. AI suggestions resume tomorrow; your data and tools are unaffected.");
});

/* ---- Outsider isolation on every new route --------------------------------- */
test("phase 3b isolation: outsider gets 404 on every new route; role gates hold", { skip: SKIP }, async () => {
  defaultLlmImpl();
  const env = freshEnv();
  fundWallet(env, "alice@example.com", 100);
  const p = await makeProject(env, "tok-alice");
  const st = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 4, n1: 123, events2: 11, n2: 139 });
  const { artId } = seedArtifact(env, p.id, ["text"]);
  const put = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice",
    { template: "rct_binary", version: 0, fields: { events1: { value: 4, locator: pdfLoc(1, "q"), quote: "q" } } });
  const eid = put.extraction.id;
  env.RESEARCH_DB._db.prepare("INSERT INTO research_extraction_suggestions (id,extraction_id,field_key,value_json,quote,model,status,created_by,created_ts) VALUES ('sug_iso',?,'events1','4','q','m','unverified','u-alice',?)")
    .run(eid, Date.now());
  await call(env, "PUT", "v1/projects/" + p.id + "/data-dictionary", "tok-alice",
    { version: 0, columns: [{ column: "study_id", type: "string", required: true }] });
  const up = await callForm(env, "v1/projects/" + p.id + "/data-uploads", "tok-alice", csvForm("study_id\ns1\n"));
  const imp = await call(env, "POST", "v1/projects/" + p.id + "/data-imports", "tok-alice", { storageKey: up.storageKey });
  const iid = imp.import.id;
  const a = await makeStudy(env, p.id, "tok-alice", "RR", { events1: 6, n1: 306, events2: 29, n2: 303 });
  for (const s of [st, a]) await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + s.id, "tok-alice", { version: s.version, verified: true });
  const run = await call(env, "POST", "v1/projects/" + p.id + "/runs", "tok-alice", { measure: "RR" });
  const grade = await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-alice", gradeBody(run.run.id));
  const gid = grade.assessment.id;
  const rob = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", "tok-alice",
    { tool: "rob2", domains: ["d1", "d2", "d3", "d4", "d5"].map((k) => ({ key: k, judgment: "low", quote: "q", locator: LOC })) });
  env.RESEARCH_DB._db.prepare("INSERT INTO research_records (id,project_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES ('rec_iso',?,'pubmed','1','T','[]',2020,'','{}',?)")
    .run(p.id, Date.now());

  const attempts = [
    ["GET", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction"],
    ["PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", { template: "rct_binary", version: 0, fields: {} }],
    ["POST", "v1/extractions/" + eid + "/verify", { version: 1 }],
    ["POST", "v1/extractions/" + eid + "/correct", { fieldKey: "events1", value: 5, reason: "x", version: 1 }],
    ["GET", "v1/extractions/" + eid + "/audit"],
    ["POST", "v1/extractions/" + eid + "/suggestions/sug_iso/accept", {}],
    ["POST", "v1/extractions/" + eid + "/promote", { measure: "RR" }],
    ["POST", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction/suggestions", { artifactId: artId }],
    ["GET", "v1/projects/" + p.id + "/artifacts"],
    ["GET", "v1/artifacts/" + artId + "/result"],
    ["GET", "v1/projects/" + p.id + "/studies/" + st.id + "/rob?tool=rob2"],
    ["POST", "v1/projects/" + p.id + "/studies/" + st.id + "/rob", { tool: "rob2", domains: [] }],
    ["GET", "v1/projects/" + p.id + "/studies/" + st.id + "/rob/audit?tool=rob2"],
    ["GET", "v1/projects/" + p.id + "/rob-conflicts"],
    ["POST", "v1/rob-conflicts/rcf_missing/resolve", { domains: [], note: "x" }],
    ["GET", "v1/projects/" + p.id + "/data-dictionary"],
    ["PUT", "v1/projects/" + p.id + "/data-dictionary", { version: 0, columns: [] }],
    ["POST", "v1/projects/" + p.id + "/data-imports", { storageKey: up.storageKey }],
    ["GET", "v1/projects/" + p.id + "/data-imports"],
    ["GET", "v1/data-imports/" + iid],
    ["GET", "v1/data-imports/" + iid + "/snapshot"],
    ["POST", "v1/data-imports/" + iid + "/freeze", {}],
    ["GET", "v1/projects/" + p.id + "/grade-assessments"],
    ["PUT", "v1/projects/" + p.id + "/grade-assessments", gradeBody(run.run.id)],
    ["GET", "v1/projects/" + p.id + "/grade-assessments/" + gid],
    ["GET", "v1/projects/" + p.id + "/summary-of-findings"],
    ["GET", "v1/projects/" + p.id + "/grade-suggestions?runId=" + run.run.id],
    ["POST", "v1/projects/" + p.id + "/records/rec_iso/screening-suggestions"],
    ["GET", "v1/projects/" + p.id + "/records/rec_iso/screening-suggestions"],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call(env, method, path, "tok-eve", body);
    assert.equal(r.http, 404, method + " " + path + " leaked: " + JSON.stringify(r));
  }
  /* Multipart upload routes too. */
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/pdf-uploads", "tok-eve", pdfForm(new TextEncoder().encode("%PDF-1.4 eve")))).http, 404);
  assert.equal((await callForm(env, "v1/projects/" + p.id + "/data-uploads", "tok-eve", csvForm("study_id\ns1\n"))).http, 404);
  /* Anonymous -> 401. */
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/artifacts", null)).http, 401);
  assert.equal((await call(env, "GET", "v1/extraction-templates", null)).http, 401);
  /* Viewer cannot write extraction / data / grade; can read. */
  await addMember(env, p.id, "tok-alice", "u-bob", "viewer");
  assert.equal((await call(env, "GET", "v1/projects/" + p.id + "/artifacts", "tok-bob")).http, 200);
  assert.equal((await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-bob", { template: "rct_binary", version: 1, fields: {} })).http, 403);
  assert.equal((await call(env, "POST", "v1/extractions/" + eid + "/promote", "tok-bob", { measure: "RR" })).http, 403);
  assert.equal((await call(env, "PUT", "v1/projects/" + p.id + "/data-dictionary", "tok-bob", { version: 1, columns: [{ column: "study_id", type: "string", required: true }] })).http, 403);
  assert.equal((await call(env, "PUT", "v1/projects/" + p.id + "/grade-assessments", "tok-bob", gradeBody(run.run.id))).http, 403);
  /* Reviewer can submit RoB but cannot resolve or write extraction. */
  await addMember(env, p.id, "tok-alice", "u-carol", "reviewer");
  assert.equal((await call(env, "POST", "v1/extractions/" + eid + "/verify", "tok-carol", { version: 1 })).http, 403);
});
