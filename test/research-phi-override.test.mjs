/* ResearchMD PHI override contract (server side), owner decision 27 Nov 2026.
 *
 * Only POST /v1/projects/{id}/ai-draft accepts body.phiOverride = {
 * accepted: true, termsVersion: "rmd-phi-override-v2",
 * condition: "false_positive" }. The override is ONE action: the doctor
 * confirming that the flag is a false detection. "anonymised" and "consent"
 * are rejected. Older terms versions are rejected. A patient name and every
 * high-risk category (aadhaar, abha, ssn, nhs, mrn, phone) are never
 * overridable: overridable false, allowedConditions []. Everything else that
 * is flagged (dates, addresses, other lower-risk hits) may be overridden with
 * false_positive. The kill switch RESEARCH_PHI_OVERRIDE is ON unless it is
 * exactly "0". The 422 body reports overridable and allowedConditions and
 * never echoes the text. The audit event carries categories, condition,
 * termsVersion and the channel, never the text and no consent fields. Any
 * other route (jobs, suggestions) ignores the field.
 *
 * Synthetic data only. No em or en dashes.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phi-override.test.mjs
 */
import "./helpers/json-import-attr.mjs";
import { test, describe, mock } from "node:test";
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
  namedExports: {
    ...realAuth,
    verifyFirebaseClaims: async (token) => CLAIMS[token] || null,
    verifiedClaimsFor: async (request) => CLAIMS[((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""))] || null,
  },
});
mock.module("../functions/api/billing/[[path]].js", {
  namedExports: {
    onRequest: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    plans: () => ({ tokens: {} }),
    fulfilPurchase: async () => ({ ok: true }),
  },
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
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const TERMS = "rmd-phi-override-v2";
const OLD_V1_TERMS = "rmd-phi-override-v1";
const OLD_V0_TERMS = "rmd-phi-override-v0";
const ALLOWED_CONDITIONS = ["false_positive"];

function override(condition) {
  return { accepted: true, termsVersion: TERMS, condition };
}

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
/* The kill switch is ON by default, so the default env leaves it unset. */
function freshEnv(extra = {}) {
  const D = d1();
  D._db.exec(SCHEMA);
  return {
    ...extra,
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_ADMIN_TOKEN: "admin-test-token",
    RESEARCH_CALLBACK_SECRET: "test-secret",
    RESEARCH_PO_ENABLED: "1",
    MAIK_KV: kvShim(),
    RESEARCH_R2: r2Shim(),
    RESEARCH_QUEUE: queueShim(),
  };
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
async function makeProject(env, token, studyType, title, question) {
  const body = { title: title || "PHI override" };
  if (studyType) body.studyType = studyType;
  if (question) body.researchQuestion = question;
  const r = await call(env, "POST", "v1/projects", token, body);
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
function lockProtocol(env, pid, population) {
  const now = Date.now();
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_protocols (id,project_id,version,status,content_json,lock_hash,locked_at,created_by,created_ts) VALUES (?,?,1,'locked',?,?,?,?,?)")
    .run("prot_" + pid, pid, JSON.stringify({
      pico: { population: population || "Adults at risk", intervention: "BCG", comparison: "Placebo", outcome: "TB" },
      eligibility: ["Randomised controlled trials"],
      outcomes: { primary: "Tuberculosis", secondary: [] },
    }), "a".repeat(64), now, "u-alice", now);
}
function addRun(env, pid) {
  const now = Date.now();
  env.RESEARCH_DB._db.prepare(
    "INSERT INTO research_runs (id,project_id,measure,model,result_json,engine,engine_version,created_by,created_ts) VALUES (?,?,'RR','random_dl',?,'research-engine','rmd1','u-alice',?)")
    .run("run_" + pid, pid, JSON.stringify({ estimate: 0.5, ciLower: 0.3, ciUpper: 0.8, p: 0.01, k: 2 }), now);
}
function auditRows(env, type) {
  return env.RESEARCH_DB._db.prepare("SELECT * FROM research_audit_events WHERE event_type=?").all(type);
}
function overrideAudit(env) {
  return auditRows(env, "ai_phi_override");
}
function overrideMeta(env) {
  const rows = overrideAudit(env);
  assert.equal(rows.length, 1, "exactly one ai_phi_override audit");
  return JSON.parse(rows[0].metadata_json);
}
function defaultLlm() {
  llm.calls.length = 0;
  llm.impl = async (env, parts, maxTokens, opts) => {
    if (opts && opts.meta) {
      opts.meta.usage = { promptTokenCount: 100, candidatesTokenCount: 60, thoughtsTokenCount: 0 };
      opts.meta.model = opts.model;
    }
    return JSON.stringify({
      title: "Chest Pain in a Middle-Aged Male",
      abstract: "A case report of a 45-year-old male presenting with chest pain.",
      introduction: "Chest pain is a common emergency presentation.",
      casePresentation: "A 45-year-old male presented with acute substernal chest pain.",
      discussion: "This case illustrates the importance of rapid triage.",
      conclusion: "Early aspirin administration improves outcomes.",
      learningPoints: ["Early aspirin is beneficial"],
    });
  };
}
/* Synthetic user-typed case text. */
const PHONE_TEXT = "A 45-year-old male presented with chest pain. Contact the patient at 9876543210 on 12/03/2023 for follow-up.";
const DATE_TEXT = "The patient was reviewed on 12/03/2023 and improved.";
const AADHAAR_TEXT = "Aadhaar 1111 2222 3333 was recorded.";
const ABHA_TEXT = "ABHA 12-3456-7890-1234 was recorded.";
const MRN_TEXT = "MRN: 123456 was noted.";
const NAME_TEXT = "Patient Ramesh Kumar was admitted with chest pain.";

function draftBody(text, ovr) {
  const body = { task: "case_report_draft", input: { caseText: text } };
  if (ovr !== undefined) body.phiOverride = ovr;
  return body;
}

describe("ai-draft PHI override: one action, false detection", () => {
  test("blocked without override -> 422 with the policy for the hit, AI not called", { skip: SKIP }, async () => {
    defaultLlm();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const p = await makeProject(env, "tok-alice");
    const r = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice", draftBody(PHONE_TEXT));
    assert.equal(r.http, 422, JSON.stringify(r));
    assert.equal(r.error.code, "phi_blocked");
    assert.equal(r.overridable, false, "a phone hit is never overridable");
    assert.deepEqual(r.allowedConditions, []);
    assert.ok(r.categories.includes("phone") && r.categories.includes("dates"), JSON.stringify(r.categories));
    assert.ok(!JSON.stringify(r).includes("9876543210"), "text never echoed");
    assert.ok(!JSON.stringify(r).includes("12/03/2023"), "date never echoed");
    assert.equal(llm.calls.length, 0, "no provider call on a PHI hit");
    assert.equal(auditRows(env, "ai_phi_blocked").length, 1);
    assert.equal(overrideAudit(env).length, 0);
  });

  test("old terms, removed conditions and malformed requests are rejected", { skip: SKIP }, async () => {
    const bad = [
      { accepted: true, termsVersion: OLD_V1_TERMS, condition: "false_positive" },
      { accepted: true, termsVersion: OLD_V0_TERMS, condition: "false_positive" },
      { accepted: true, termsVersion: TERMS },
      { accepted: true, termsVersion: TERMS, condition: "unknown" },
      { accepted: true, termsVersion: TERMS, condition: "anonymised" },
      { accepted: true, termsVersion: TERMS, condition: "consent" },
      { accepted: false, termsVersion: TERMS, condition: "false_positive" },
      { accepted: "true", termsVersion: TERMS, condition: "false_positive" },
      { termsVersion: TERMS, condition: "false_positive" },
      "not-an-object",
    ];
    for (const ovr of bad) {
      defaultLlm();
      const env = freshEnv();
      fundWallet(env, "alice@example.com", 10000);
      const p = await makeProject(env, "tok-alice");
      const r = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice", draftBody(DATE_TEXT, ovr));
      assert.equal(r.http, 422, JSON.stringify(ovr) + " -> " + JSON.stringify(r));
      assert.equal(r.error.code, "phi_blocked");
      assert.equal(r.overridable, true, "low-risk text remains overridable");
      assert.deepEqual(r.allowedConditions, ALLOWED_CONDITIONS);
      assert.equal(llm.calls.length, 0, "no provider call for an invalid override");
      assert.equal(overrideAudit(env).length, 0);
    }
  });

  test("false_positive is accepted for a low-risk date hit, with the exact audit meta", { skip: SKIP }, async () => {
    defaultLlm();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const p = await makeProject(env, "tok-alice");
    const r = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
      draftBody(DATE_TEXT, override("false_positive")));
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1, "provider called under a valid override");
    const meta = overrideMeta(env);
    assert.deepEqual(meta.categories, ["dates"]);
    assert.equal(meta.route, "ai-draft");
    assert.equal(meta.task, "case_report_draft");
    assert.equal(meta.termsVersion, TERMS);
    assert.equal(meta.condition, "false_positive");
    assert.equal(meta.channel, "app_override_dialog");
    assert.deepEqual(Object.keys(meta).sort(),
      ["categories", "channel", "condition", "route", "task", "termsVersion"]);
    assert.ok(!JSON.stringify(meta).includes("12/03/2023"), "flagged date never in audit");
    assert.ok(!JSON.stringify(meta).includes("consent"), "no consent fields in the audit");
    assert.equal(auditRows(env, "ai_phi_blocked").length, 0, "override path does not log a block");
  });

  test("name, aadhaar, abha, mrn and phone are never overridable, even with false_positive", { skip: SKIP }, async () => {
    const samples = [
      [NAME_TEXT, "patient_name", "Ramesh Kumar"],
      [AADHAAR_TEXT, "aadhaar", "1111 2222 3333"],
      [ABHA_TEXT, "abha", "12-3456-7890-1234"],
      [MRN_TEXT, "mrn", "123456"],
      [PHONE_TEXT, "phone", "9876543210"],
    ];
    for (const [sample, category, secret] of samples) {
      for (const ovr of [undefined, override("false_positive")]) {
        defaultLlm();
        const env = freshEnv();
        fundWallet(env, "alice@example.com", 10000);
        const p = await makeProject(env, "tok-alice");
        const r = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
          draftBody(sample, ovr));
        assert.equal(r.http, 422, category + " " + JSON.stringify(ovr) + " -> " + JSON.stringify(r));
        assert.equal(r.error.code, "phi_blocked");
        assert.equal(r.overridable, false, category + " is never overridable");
        assert.deepEqual(r.allowedConditions, [], category + " has no allowed condition");
        assert.ok(r.categories.includes(category), JSON.stringify(r.categories));
        assert.ok(!JSON.stringify(r).includes(secret), category + " never echoed");
        assert.equal(llm.calls.length, 0, "no provider call for " + category);
        assert.equal(overrideAudit(env).length, 0, "no override audit for " + category);
      }
    }
  });

  test("an aadhaar hit stays never-overridable when mixed with an allowed category", { skip: SKIP }, async () => {
    defaultLlm();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const p = await makeProject(env, "tok-alice");
    const r = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
      draftBody("Aadhaar 1111 2222 3333. Contact 9876543210.", override("false_positive")));
    assert.equal(r.http, 422, JSON.stringify(r));
    assert.equal(r.overridable, false, "aadhaar still refuses when mixed with an allowed category");
    assert.deepEqual(r.allowedConditions, []);
    assert.equal(llm.calls.length, 0);
    assert.equal(overrideAudit(env).length, 0);
  });

  test("the audit never contains the request body or the flagged text", { skip: SKIP }, async () => {
    defaultLlm();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const p = await makeProject(env, "tok-alice");
    const r = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
      draftBody(DATE_TEXT, override("false_positive")));
    assert.equal(r.http, 200, JSON.stringify(r));
    const row = overrideAudit(env)[0];
    assert.ok(!row.metadata_json.includes("12/03/2023"));
    assert.ok(!row.metadata_json.includes("reviewed"));
    assert.ok(!row.metadata_json.includes("chest pain"));
    const meta = JSON.parse(row.metadata_json);
    assert.equal(meta.condition, "false_positive");
    assert.equal(meta.channel, "app_override_dialog");
  });

  test("phiOverride on POST /jobs manuscript_draft is ignored -> 422 phi_blocked", { skip: SKIP }, async () => {
    defaultLlm();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 500);
    const p = await makeProject(env, "tok-alice", "systematic_review", "BCG review", "Does BCG reduce TB?");
    lockProtocol(env, p.id, "Call patient coordinator at 9876543210 for enrolment");
    addRun(env, p.id);
    const r = await call(env, "POST", "v1/projects/" + p.id + "/jobs", "tok-alice", {
      kind: "manuscript_draft",
      idempotencyKey: "k-override-ignored",
      phiOverride: override("false_positive"),
    });
    assert.equal(r.http, 422, JSON.stringify(r));
    assert.equal(r.error.code, "phi_blocked");
    assert.ok(r.categories.includes("phone"), JSON.stringify(r));
    assert.equal(r.overridable, undefined, "override is /ai-draft only, never jobs");
    assert.equal(r.allowedConditions, undefined, "jobs never report allowed conditions");
    assert.equal(env.RESEARCH_QUEUE._messages.length, 0);
    assert.equal(env.RESEARCH_R2._objects.size, 0);
    assert.equal(overrideAudit(env).length, 0);
  });

  test("phiOverride on a suggestion route is ignored (no override audit, literature skip)", { skip: SKIP }, async () => {
    defaultLlm();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const p = await makeProject(env, "tok-alice");
    const now = Date.now();
    env.RESEARCH_DB._db.prepare(
      "INSERT INTO research_records (id,project_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES (?,?,'pubmed','4001','Asthma trial','[]',2024,'',?,?)")
      .run("rec_phi_override", p.id, JSON.stringify({ abstract: "Adults with asthma. Call 98765 43210 for the data." }), now);
    llm.impl = async (env, parts, maxTokens, opts) => {
      if (opts && opts.meta) {
        opts.meta.usage = { promptTokenCount: 80, candidatesTokenCount: 40, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
      return JSON.stringify({ decision: "include", reasonCode: "", rationale: "Published trial." });
    };
    const r = await call(env, "POST", "v1/projects/" + p.id + "/records/rec_phi_override/screening-suggestions", "tok-alice", {
      phiOverride: override("false_positive"),
    });
    assert.equal(r.http, 201, JSON.stringify(r));
    assert.equal(llm.calls.length, 1);
    assert.equal(overrideAudit(env).length, 0, "suggestion routes never write an override audit");
  });
});

describe("kill switch RESEARCH_PHI_OVERRIDE (on unless \"0\")", () => {
  test("unset or \"1\" -> the override is available", { skip: SKIP }, async () => {
    for (const extra of [{}, { RESEARCH_PHI_OVERRIDE: "1" }]) {
      defaultLlm();
      const env = freshEnv(extra);
      fundWallet(env, "alice@example.com", 10000);
      const p = await makeProject(env, "tok-alice");
      const blocked = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
        draftBody(DATE_TEXT));
      assert.equal(blocked.http, 422, JSON.stringify(blocked));
      assert.equal(blocked.overridable, true, "override available: " + JSON.stringify(extra));
      assert.deepEqual(blocked.allowedConditions, ALLOWED_CONDITIONS);

      const passed = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
        draftBody(DATE_TEXT, override("false_positive")));
      assert.equal(passed.http, 200, JSON.stringify(extra) + " -> " + JSON.stringify(passed));
      assert.equal(llm.calls.length, 1);
      const meta = overrideMeta(env);
      assert.equal(meta.condition, "false_positive");
      assert.equal(meta.channel, "app_override_dialog");
    }
  });

  test("\"0\" -> 422 not overridable and a valid override is ignored", { skip: SKIP }, async () => {
    for (const sample of [PHONE_TEXT, DATE_TEXT, NAME_TEXT]) {
      defaultLlm();
      const env = freshEnv({ RESEARCH_PHI_OVERRIDE: "0" });
      fundWallet(env, "alice@example.com", 10000);
      const p = await makeProject(env, "tok-alice");
      const r = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
        draftBody(sample));
      assert.equal(r.http, 422, JSON.stringify(r));
      assert.equal(r.error.code, "phi_blocked");
      assert.equal(r.overridable, false, "no override offered while the switch is off");
      assert.deepEqual(r.allowedConditions, []);

      const o = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
        draftBody(sample, override("false_positive")));
      assert.equal(o.http, 422, "override ignored: still blocked");
      assert.equal(o.overridable, false);
      assert.deepEqual(o.allowedConditions, []);
      assert.equal(llm.calls.length, 0, "no provider call");
      assert.equal(overrideAudit(env).length, 0, "no override audit");
    }
  });
});

describe("date mode on ai-draft", () => {
  test("a day-level date in user input blocks without override and passes with one", { skip: SKIP }, async () => {
    defaultLlm();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const p = await makeProject(env, "tok-alice");
    const blocked = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
      draftBody(DATE_TEXT));
    assert.equal(blocked.http, 422, JSON.stringify(blocked));
    assert.ok(blocked.categories.includes("dates"), JSON.stringify(blocked));
    assert.deepEqual(blocked.allowedConditions, ALLOWED_CONDITIONS, "a date is low-risk");
    assert.equal(llm.calls.length, 0);

    const passed = await call(env, "POST", "v1/projects/" + p.id + "/ai-draft", "tok-alice",
      draftBody(DATE_TEXT, override("false_positive")));
    assert.equal(passed.http, 200, JSON.stringify(passed));
    assert.equal(llm.calls.length, 1);
    const meta = overrideMeta(env);
    assert.deepEqual(meta.categories, ["dates"]);
    assert.equal(meta.condition, "false_positive");
    assert.deepEqual(Object.keys(meta).sort(),
      ["categories", "channel", "condition", "route", "task", "termsVersion"]);
  });
});
