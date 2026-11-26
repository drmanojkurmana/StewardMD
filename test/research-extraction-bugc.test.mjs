import "./helpers/json-import-attr.mjs";
/* Bug C server-side reproduction & regression tests:
 * - _suggest.js: no PDF attached -> pdf_not_attached (409) with plain guidance;
 *   running/queued job -> job_not_done (409) with jobId/jobStatus for polling;
 *   failed/cancelled job -> job_failed (409) with plain guidance.
 * - _extraction.js: promoteExtraction with unverified required field -> 422
 *   extraction_unverified naming the field label ("Verify Events (intervention) first...");
 *   artifactResult while job is running -> 409 job_not_done with jobId/jobStatus.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-extraction-bugc.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP = DatabaseSync ? false : "node:sqlite unavailable";

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
});
const llm = { calls: [], impl: async () => "[]" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
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
function kvShim() {
  const m = new Map();
  return {
    _m: m,
    async get(key, type) { const v = m.get(key); if (v == null) return null; return type === "json" ? JSON.parse(v) : v; },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
  };
}
function freshEnv() {
  const D = d1();
  D._db.exec(SCHEMA);
  return {
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    MAIK_KV: kvShim(),
    RESEARCH_R2: r2Shim(),
    RESEARCH_QUEUE: { _messages: [], async send(m) { this._messages.push(m); } },
  };
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
const LOC = { kind: "manual", citation: "Comstock 1976", page: "702", quote: "27 cases among 16913 vaccinated" };

test("suggest: distinguishes no PDF, running job (with jobId/jobStatus), and failed job", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = (await call(env, "POST", "v1/projects", "tok-alice", { title: "Bug C test" })).project;
  const st = (await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-alice", {
    measure: "RR", inputs: { events1: 27, n1: 16913, events2: 29, n2: 17854 }, locator: LOC, quote: LOC.quote, label: "Comstock et al 1976"
  })).study;

  /* 1. No PDF attached -> pdf_not_attached with Page tab guidance */
  const noPdf = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction/suggestions", "tok-alice", { template: "rct_binary" });
  assert.equal(noPdf.http, 409);
  assert.equal(noPdf.error.code, "pdf_not_attached");
  assert.match(noPdf.error.message, /Attach the study PDF on the Page tab first/i);

  /* 2. Running job -> job_not_done with jobId and jobStatus so client can poll */
  const now = Date.now();
  const sha = "d".repeat(64);
  const r2Key = "projects/" + p.id + "/pdf/" + sha + ".pdf";
  env.RESEARCH_DB._db.prepare("INSERT INTO research_pdfs (id,project_id,sha256,r2_key,bytes,uploaded_by,ts) VALUES ('pdf_run',?,?,?,?,?,?)")
    .run(p.id, sha, r2Key, 1024, "u-alice", now);
  env.RESEARCH_DB._db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,input_r2_key,created_by,created_ts) VALUES ('job_run',?,'pdf_extract','running','k_run',?,'u-alice',?)")
    .run(p.id, r2Key, now);
  env.RESEARCH_DB._db.prepare("INSERT INTO research_extraction_artifacts (id,project_id,pdf_id,filename,sha256,bytes,job_id,status,created_by,created_ts) VALUES ('art_run',?,'pdf_run','comstock1976.pdf',?,1024,'job_run','running','u-alice',?)")
    .run(p.id, sha, now);

  const running = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction/suggestions", "tok-alice", {
    template: "rct_binary", artifactId: "art_run"
  });
  assert.equal(running.http, 409);
  assert.equal(running.error.code, "job_not_done");
  assert.equal(running.jobId, "job_run");
  assert.equal(running.jobStatus, "running");

  /* artifactResult also returns jobId/jobStatus while job is running */
  const resEarly = await call(env, "GET", "v1/artifacts/art_run/result", "tok-alice");
  assert.equal(resEarly.http, 409);
  assert.equal(resEarly.error.code, "job_not_done");
  assert.equal(resEarly.jobId, "job_run");
  assert.equal(resEarly.jobStatus, "running");

  /* 3. Failed job -> job_failed with plain guidance */
  env.RESEARCH_DB._db.prepare("UPDATE research_job_runs SET status='failed' WHERE id='job_run'").run();
  const failed = await call(env, "POST", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction/suggestions", "tok-alice", {
    template: "rct_binary", artifactId: "art_run"
  });
  assert.equal(failed.http, 409);
  assert.equal(failed.error.code, "job_failed");
  assert.match(failed.error.message, /Page tab/i);
});

test("extraction: promote with unverified required field returns plain field label message", { skip: SKIP }, async () => {
  const env = freshEnv();
  const p = (await call(env, "POST", "v1/projects", "tok-alice", { title: "Bug C promote" })).project;
  const st = (await call(env, "POST", "v1/projects/" + p.id + "/studies", "tok-alice", {
    measure: "RR", inputs: { events1: 0, n1: 1, events2: 0, n2: 1 }, locator: LOC, quote: LOC.quote, label: "Comstock et al 1976"
  })).study;
  const put = await call(env, "PUT", "v1/projects/" + p.id + "/studies/" + st.id + "/extraction", "tok-alice", {
    template: "rct_binary", version: 0, fields: { events1: { value: 27, locator: null, quote: "" } }
  });
  assert.equal(put.http, 200);
  const blocked = await call(env, "POST", "v1/extractions/" + put.extraction.id + "/promote", "tok-alice", { measure: "RR" });
  assert.equal(blocked.http, 422);
  assert.equal(blocked.error.code, "extraction_unverified");
  assert.equal(blocked.fieldKey, "events1");
  assert.equal(blocked.fieldLabel, "Events (intervention)");
  assert.match(blocked.error.message, /Verify Events \(intervention\) first: capture its quote or correct it/);
});
