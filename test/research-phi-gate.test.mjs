/* Regression test for Bug H: published papers must skip the PHI gate entirely.
 * Owner decision: published papers are public. AI calls whose input is ONLY
 * published literature must never run the PHI gate. The gate stays ONLY where
 * the doctor types or pastes their own patient text (case report notes,
 * manuscript sections, thesis text, IEC/consent drafts, master-chart summaries).
 *
 * Fix: runUserAi gains opts.publicLiterature === true which skips the scan
 * entirely (caps, credits, usage log and audit stay), writing an audit note
 * "phi_gate_skipped_public_literature". Callers that send only published-paper
 * content (paper_card_explain, extraction_suggestion) pass the flag.
 * _phi.js scan() is restored to origin/main behaviour (no publicSpans).
 * The case_report_draft path scans user-typed text directly and still blocks.
 *
 * Synthetic data only. No em or en dashes.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-phi-gate.test.mjs
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
const { scan, phiCategories, verhoeffCheckDigit } = await import("../functions/api/research/_phi.js");
const { RESEARCH_FRAMING } = await import("../functions/api/research/_gateway.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const PHI_VECTORS = JSON.parse(readFileSync(new URL("../docs/research/contracts/phase-3/phi-vectors.json", import.meta.url), "utf8"));

/* Synthetic Cureus-style published paper (no real patient data). */
const TITLE = "Prognostic Accuracy of Lactate Clearance and Procalcitonin in Patients With Sepsis Admitted to the Intensive Care Unit: A Prospective Observational Study";
const ABSTRACT = "Background: Sepsis remains a leading cause of mortality in the Intensive Care Unit. " +
  "We enrolled 152 patients admitted to the Intensive Care Unit at King George Medical University, Lucknow, between January 2023 and December 2024. " +
  "Methods: This Prospective Observational Study measured Lactate Clearance and procalcitonin at 0, 24 and 72 hours. " +
  "Results: Mean age was 58.2 years; 96 patients were male. Lactate Clearance predicted survival (area under the curve 0.83, 95% CI 0.75-0.89). " +
  "Conclusions: Lactate Clearance is a useful prognostic marker in sepsis.";
const PMID = "40123456";
const SUMMARY = {
  population: "152 patients with sepsis in the Intensive Care Unit",
  intervention: "Lactate Clearance and procalcitonin measurement",
  comparison: "Survivors and non-survivors",
  outcome: "Survival prediction",
  design: "Prospective Observational Study",
  mainResult: "Area under the curve 0.83 (95% CI 0.75-0.89)",
  conclusion: "Lactate Clearance is a useful prognostic marker in sepsis",
};

/* Verhoeff-valid synthetic Aadhaar (12 digits, 4-4-4). */
const AADHAAR_BASE = "23456789012";
const AADHAAR = AADHAAR_BASE + verhoeffCheckDigit(AADHAAR_BASE);
const AADHAAR_FMT = AADHAAR.slice(0, 4) + " " + AADHAAR.slice(4, 8) + " " + AADHAAR.slice(8);

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
    RESEARCH_MODE: "pilot", RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_ADMIN_TOKEN: "admin-test-token",
    RESEARCH_CALLBACK_SECRET: "test-secret",
    MAIK_KV: kvShim(),
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
async function makeProject(env, token) {
  const r = await call(env, "POST", "v1/projects", token, { title: "Bug H regression" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
function seedCard(env, pmid, abstract) {
  const card = {
    pmid, doi: "", title: TITLE,
    sections: [{ label: "", text: abstract }],
    structured: false, findings: [],
  };
  env.RESEARCH_DB._db.prepare("INSERT INTO research_paper_cards (cache_key,card_json,created_ts) VALUES (?,?,?)")
    .run("pmid:" + pmid, JSON.stringify(card), Date.now());
}
function mockSummary() {
  llm.calls.length = 0;
  llm.impl = async (env, parts, maxTokens, opts) => {
    if (opts && opts.meta) {
      opts.meta.usage = { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 0 };
      opts.meta.model = opts.model;
      opts.meta.finishReason = "STOP";
    }
    return JSON.stringify(SUMMARY);
  };
}

/* ---- scanner unit: _phi.js scan() restored to origin/main ------------------- */

describe("Bug H scanner: scan() has no publicSpans parameter", () => {
  test("scan() does not accept publicSpans (reverted to origin/main)", () => {
    /* The abstract triggers patient_name in the unmarked scan; publicSpans has
     * no effect because the code was reverted. The abstract contains capitalised
     * phrases near 'patients'/'admitted' which fire the patient_name rule. */
    const system = RESEARCH_FRAMING + "\n\nTest system";
    const prompt = "Title: " + TITLE + "\nAbstract: " + ABSTRACT;
    const assembled = system + "\n\n" + prompt;
    const r1 = scan(assembled);
    assert.equal(r1.blocked, true, "abstract triggers patient_name in default scan");

    /* Even if someone passes publicSpans, _phi.js ignores them (reverted). */
    const r2 = scan(assembled, { publicSpans: [{ start: system.length + 2, end: assembled.length }] });
    assert.equal(r2.blocked, true, "publicSpans has no effect after revert");
  });

  test("default scan is unchanged: every shared phi-vector still holds", () => {
    for (const v of PHI_VECTORS.cases) {
      const r = scan(v.text);
      assert.equal(r.blocked, v.expect === "block", "vector " + v.id + " (" + v.expect + ")");
    }
  });
});

/* ---- route integration: paper-card explain with publicLiterature ------------ */

describe("Bug H route: paper-card explain skips PHI gate (publicLiterature)", () => {
  test("published paper summary succeeds (200), provider called once, audit note written", { skip: SKIP }, async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const project = await makeProject(env, "tok-alice");
    seedCard(env, PMID, ABSTRACT);
    mockSummary();
    const r = await call(env, "POST", "v1/projects/" + project.id + "/paper-card/explain", "tok-alice", { pmid: PMID });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1, "exactly one provider call");
    assert.ok(r.card && r.card.ai && r.card.ai.population, "summary returned");
    /* Verify audit note was written for skipping the PHI gate */
    const auditRow = env.RESEARCH_DB._db.prepare(
      "SELECT * FROM research_audit_events WHERE event_type='phi_gate_skipped_public_literature'"
    ).get();
    assert.ok(auditRow, "phi_gate_skipped_public_literature audit note present");
  });

  test("abstract full of capitalised phrases, patients, admitted, author names, dates succeeds", { skip: SKIP }, async () => {
    /* This is the scenario from the bug screenshots: a real published abstract
     * with institutional phrases like "Intensive Care Unit", author names like
     * "Ramesh Kumar", and clinical words like "patients", "admitted" near
     * capitalised bigrams. With publicLiterature the gate is skipped entirely. */
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const project = await makeProject(env, "tok-alice");
    const richAbstract = "Background: Sepsis remains a leading cause of mortality in the Intensive Care Unit. " +
      "Ramesh Kumar, Priya Sharma and John Doe conducted this study at Apollo Hospital Chennai. " +
      "We enrolled 152 patients admitted between January 2023 and December 2024. " +
      "Dr. Anand Krishnamurthy supervised the Prospective Observational Study. " +
      "Methods: Lactate Clearance was measured at 0, 24 and 72 hours. " +
      "Results: Among the 96 patients who survived, mean lactate was 2.1 mmol/L. " +
      "The mortality rate was 23.7% (36/152) in the Surgical Intensive Care Unit.";
    seedCard(env, PMID, richAbstract);
    mockSummary();
    const r = await call(env, "POST", "v1/projects/" + project.id + "/paper-card/explain", "tok-alice", { pmid: PMID });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1, "provider called: gate was skipped for published content");
  });

  test("standalone explain route also passes for the published paper", { skip: SKIP }, async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    await makeProject(env, "tok-alice");
    seedCard(env, PMID, ABSTRACT);
    mockSummary();
    const r = await call(env, "POST", "v1/paper-card/explain", "tok-alice", { pmid: PMID });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1);
  });
});

/* ---- route integration: ai_draft case_report_draft still blocks with PHI ---- */

describe("Bug H route: case_report_draft user text still runs PHI gate", () => {
  test("case_report_draft with a patient phone in user text is blocked (422 phi_blocked)", { skip: SKIP }, async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const project = await makeProject(env, "tok-alice");
    mockSummary();
    const caseText = "A 45-year-old male presented with chest pain. " +
      "Contact the patient at 9876543210 for follow-up.";
    const r = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "case_report_draft",
      input: { caseText },
    });
    assert.equal(r.http, 422, JSON.stringify(r));
    assert.equal(r.error.code, "phi_blocked", "user-typed case text with phone is blocked");
    assert.equal(llm.calls.length, 0, "no PHI may reach the provider");
    /* Matched text is never echoed in the response */
    assert.ok(!JSON.stringify(r).includes("9876543210"), "phone number never echoed");
  });

  test("case_report_draft with clean text succeeds", { skip: SKIP }, async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const project = await makeProject(env, "tok-alice");
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
    const caseText = "A 45-year-old male presented with chest pain and was treated with aspirin.";
    const r = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "case_report_draft",
      input: { caseText },
    });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.ok(llm.calls.length >= 1, "provider was called for clean case text");
  });
});
