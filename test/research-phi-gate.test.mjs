/* Regression test for Bug A: the Read Study paper-card MaiK summary was refused
 * by the server PHI gate ("Patient identifiers detected; the AI call was
 * blocked.") on a PUBLISHED paper. The gate scanned the whole assembled prompt
 * and the patient_name context rule flagged capitalized institutional/clinical
 * phrases ("Intensive Care Unit", "Prospective Observational Study") sitting
 * next to the generic plural "patients" / the methods verb "admitted".
 *
 * Fix: the server marks the paper-card explain prompt (assembled from a public
 * connector cache; the client sends only a validated pmid/doi) as published
 * bibliographic text. In a public span the patient_name rule keeps only names
 * explicitly ascribed to a patient; hard identifiers (mrn/aadhaar/ssn/nhs/
 * phone/email) are never relaxed. Default scan() is unchanged (shared vectors).
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
const SYSTEM = "You summarise one study for a clinician. Return ONLY JSON with keys population, intervention, comparison, outcome, design, mainResult, conclusion. " +
  "Each value is a short string. mainResult may contain only numbers copied from the abstract. Do not invent a number.";
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

function promptFor(abstract, title) {
  return ("Title: " + (title === undefined ? TITLE : title) + "\nAbstract: " + abstract).slice(0, 3000);
}
function assembledFor(prompt) {
  const finalSystem = RESEARCH_FRAMING + "\n\n" + SYSTEM;
  return { assembled: finalSystem + "\n\n" + prompt, spans: [{ start: finalSystem.length + 2, end: finalSystem.length + 2 + prompt.length }] };
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
  const r = await call(env, "POST", "v1/projects", token, { title: "Bug A regression" });
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

/* ---- scanner unit: public-span marking -------------------------------------- */

describe("Bug A scanner: public bibliographic spans", () => {
  test("published abstract prompt passes when marked public, blocks when unmarked", () => {
    const { assembled, spans } = assembledFor(promptFor(ABSTRACT));
    assert.equal(scan(assembled).blocked, true, "unmarked prompt reproduces the original false positive");
    assert.ok(phiCategories(scan(assembled).hits).includes("patient_name"));
    const marked = scan(assembled, { publicSpans: spans });
    assert.equal(marked.blocked, false, "marked public abstract must pass: " + JSON.stringify(phiCategories(marked.hits)));
  });

  test("hard identifiers and explicit patient ascriptions still block inside a public span", () => {
    const plants = [
      ["phone", " Contact 9876543210.", "phone"],
      ["aadhaar", " Aadhaar " + AADHAAR_FMT + ".", "aadhaar"],
      ["mrn", " MRN 483920.", "mrn"],
      ["patient_name", " Patient: Ramesh Kumar was reviewed.", "patient_name"],
    ];
    for (const [label, plant, category] of plants) {
      const { assembled, spans } = assembledFor(promptFor(ABSTRACT + plant));
      const r = scan(assembled, { publicSpans: spans });
      assert.equal(r.blocked, true, "planted " + label + " must block");
      assert.ok(phiCategories(r.hits).includes(category), "planted " + label + " category present");
    }
  });

  test("institutional phrases are not patient names; ascribed names are (public span)", () => {
    const allow = [
      "We enrolled 152 patients admitted to the Intensive Care Unit.",
      "A Prospective Observational Study of Lactate Clearance.",
      "Department of Medicine, Apollo Hospital, Chennai.",
      "Ramesh Kumar, Priya Sharma and John Doe.",
    ];
    for (const t of allow) {
      const r = scan(t, { publicSpans: [{ start: 0, end: t.length }] });
      assert.equal(r.blocked, false, "public bibliographic text must pass: " + t);
    }
    const block = [
      "Patient Ramesh Kumar",
      "Mr.John Smith",
      "Mrs. Jane Doe was admitted",
      "Ms. Alice Brown diagnosed with asthma",
      "Ramesh Kumar, ward 4 bed no 12",
      "The patient Priya Sharma is stable",
      "Patient: Ramesh Kumar was reviewed.",
    ];
    for (const t of block) {
      const r = scan(t, { publicSpans: [{ start: 0, end: t.length }] });
      assert.equal(r.blocked, true, "explicit patient ascription must block even in public text: " + t);
    }
  });

  test("default scan is unchanged: every shared phi-vector still holds", () => {
    for (const v of PHI_VECTORS.cases) {
      const r = scan(v.text);
      assert.equal(r.blocked, v.expect === "block", "vector " + v.id + " (" + v.expect + ")");
    }
  });
});

/* ---- route integration: real explain path, D1 mock + mocked provider -------- */

describe("Bug A route: paper-card explain PHI gate", () => {
  test("published paper summary succeeds (200), provider called once", { skip: SKIP }, async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 10000);
    const project = await makeProject(env, "tok-alice");
    seedCard(env, PMID, ABSTRACT);
    mockSummary();
    const r = await call(env, "POST", "v1/projects/" + project.id + "/paper-card/explain", "tok-alice", { pmid: PMID });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1, "exactly one provider call");
    assert.ok(r.card && r.card.ai && r.card.ai.population, "summary returned");
  });

  const plants = [
    ["phone", " Contact 9876543210.", "phone"],
    ["aadhaar", " Aadhaar " + AADHAAR_FMT + ".", "aadhaar"],
    ["mrn", " MRN 483920.", "mrn"],
    ["patient_name", " Patient: Ramesh Kumar was reviewed.", "patient_name"],
  ];
  for (const [label, plant, category] of plants) {
    test("planted " + label + " in the abstract blocks (422 phi_blocked), no provider call", { skip: SKIP }, async () => {
      const env = freshEnv();
      fundWallet(env, "alice@example.com", 10000);
      const project = await makeProject(env, "tok-alice");
      seedCard(env, PMID, ABSTRACT + plant);
      mockSummary();
      const r = await call(env, "POST", "v1/projects/" + project.id + "/paper-card/explain", "tok-alice", { pmid: PMID });
      assert.equal(r.http, 422, JSON.stringify(r));
      assert.equal(r.error.code, "phi_blocked");
      assert.ok(Array.isArray(r.categories) && r.categories.includes(category), "categories include " + category);
      assert.equal(llm.calls.length, 0, "no PHI may reach the provider");
      assert.ok(!JSON.stringify(r).includes("9876543210"), "matched text never echoed");
      assert.ok(!JSON.stringify(r).includes("Ramesh Kumar"), "matched name never echoed");
    });
  }

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
