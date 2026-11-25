import "./helpers/json-import-attr.mjs";
/* ResearchMD thesis_to_paper. SQLite D1 mock and a mocked provider.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-thesis.test.mjs
 */
import { test, mock, describe } from "node:test";
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
  namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
});
const llm = { calls: [], impl: async () => "{\"text\":\"\"}" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      if (opts && opts.meta) {
        opts.meta.usage = { promptTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");
const PAGE = "Table 7. The mean age was 54 years in 120 patients. Smith 2019 BCG. Colditz 1994 doi 10.1001/jama.1994.03510370074034.";

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
    batch: async (list) => {
      db.exec("BEGIN");
      try { list.forEach((s) => s._exec()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
      return [];
    },
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
    RESEARCH_MODE: "pilot", RESEARCH_DB: D, RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_CALLBACK_SECRET: "test-secret", MAIK_KV: kvShim(),
  };
}
function fundWallet(env) {
  env.MAIK_KV._m.set("maik:credit:em:alice@example.com", JSON.stringify({ balance: 100, day: "", chargedToday: 0 }));
}
function resetLlm(impl) {
  llm.calls.length = 0;
  llm.impl = impl || (async () => "{\"text\":\"Short line.\"}");
}
function sql(env) { return env.RESEARCH_DB._db; }
async function call(env, method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const req = new Request("https://stewardmd.in/api/research/" + path,
    { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { http: res.status, ...(data || {}) };
}
async function makeProject(env) {
  const r = await call(env, "POST", "v1/projects", "tok-alice", { title: "Thesis" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
async function setRole(env, pid, role) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid: "u-bob", role });
  assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
}
function words(text) {
  return String(text || "").trim() ? String(text).trim().split(/\s+/).length : 0;
}

describe("research thesis to paper", { concurrency: false, skip: SKIP }, () => {
  test("PHI on the thesis blocks the provider and names the page", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    resetLlm();
    const r = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: {
        section: "results",
        pages: [
          { n: 3, text: "Table 1. The mean age was 54 years." },
          { n: 54, text: "Write to nurse@hospital.org about this ward list." },
        ],
      },
    });
    assert.equal(r.http, 422, JSON.stringify(r));
    assert.equal(r.error.code, "phi_blocked");
    assert.equal(r.error.message, "Patient identifiers (protected health information, PHI) were found. Remove them before MaiK reads this thesis.");
    assert.ok(r.categories.includes("email"));
    assert.deepEqual(r.pages, [54]);
    assert.equal(llm.calls.length, 0);
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_ai_drafts").get().n, 0);
  });

  test("an invented number is removed and flagged, and locators name the page and table", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    resetLlm(async () => JSON.stringify({
      text: "The mean age was 54 years in 120 patients and 999 were lost.",
      references: [
        { citation: "Smith 2019 BCG", doi: "", pmid: "" },
        { citation: "Colditz 1994", doi: "10.1001/jama.1994.03510370074034", pmid: "000" },
        { citation: "Not in the thesis", doi: "10.1000/missing" },
      ],
    }));
    const r = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: {
        section: "results",
        wordLimit: 80,
        pages: [{ n: 54, text: PAGE }],
      },
    });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].maxTokens, 1200);
    assert.equal(llm.calls[0].opts.temperature, 0);
    const section = r.draft.sections[0];
    assert.equal(section.id, "results");
    assert.equal(section.text.includes("999"), false);
    assert.ok(section.text.includes("check this number"));
    assert.deepEqual(section.flags, ["check this number"]);
    const values = section.numbers.map((item) => item.value).sort();
    assert.deepEqual(values, ["120", "54"]);
    for (const item of section.numbers) {
      assert.equal(item.locator.page, 54);
      assert.equal(item.locator.table, "Table 7");
      assert.equal(item.locator.label, "From your thesis, page 54, Table 7");
    }
    assert.equal(r.draft.references.length, 2);
    const smith = r.draft.references.find((item) => item.citation === "Smith 2019 BCG");
    const colditz = r.draft.references.find((item) => item.citation === "Colditz 1994");
    assert.equal(smith.flag, "check this reference");
    assert.equal(smith.doi, "");
    assert.equal(colditz.flag, "");
    assert.equal(colditz.doi, "10.1001/jama.1994.03510370074034");
    assert.equal(colditz.pmid, "");
    assert.equal(r.draft.suggestedTables[0].id, "Table 7");
    assert.equal(r.draft.status, "unverified");
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_protocols").get().n, 0);
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_manuscript_sections").get().n, 0);
  });

  test("word limit is respected, design is suggested, and five sections are five calls", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    const long = "alpha beta gamma delta epsilon zeta eta theta iota";
    resetLlm(async () => JSON.stringify({ text: long }));
    const one = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: {
        section: "discussion",
        wordLimit: 8,
        text: "This randomised placebo trial compared two arms. " + long,
      },
    });
    assert.equal(one.http, 200, JSON.stringify(one));
    assert.ok(one.draft.wordCount <= 8);
    assert.equal(words(one.draft.sections[0].text), one.draft.wordCount);
    assert.equal(one.draft.trimmedToWordLimit, true);
    assert.equal(one.draft.suggestion.paperType, "rct");
    assert.equal(one.draft.suggestion.checklist, "CONSORT");
    assert.ok(one.draft.suggestion.label.startsWith("Randomised controlled trial (RCT)"));
    assert.equal(llm.calls.length, 1);

    resetLlm(async () => JSON.stringify({ text: long + " kappa lambda" }));
    const many = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: { wordLimit: 12, text: "A systematic review and meta-analysis of the reports. " + long },
    });
    assert.equal(many.http, 200, JSON.stringify(many));
    assert.equal(llm.calls.length, 5);
    assert.equal(many.draft.sections.length, 5);
    assert.ok(many.draft.wordCount <= 12);
    assert.equal(many.draft.suggestion.paperType, "systematic_review");
    assert.equal(many.draft.suggestion.checklist, "PRISMA");
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_ai_drafts WHERE project_id=?").get(project.id).n, 2);
  });

  test("journal word limit, DOCX tip, and viewer refusal", async () => {
    const env = freshEnv();
    fundWallet(env);
    const project = await makeProject(env);
    const now = Date.now();
    sql(env).prepare("INSERT INTO research_journals (id,name,issn,created_ts,word_limit_main) VALUES ('j-india','Indian Journal','',?,12)")
      .run(now);
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen";
    resetLlm(async () => JSON.stringify({ text: long }));
    const limited = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: { section: "abstract", journalId: "j-india", text: "A case series of similar patients. " + long },
    });
    assert.equal(limited.http, 200, JSON.stringify(limited));
    assert.equal(limited.draft.wordLimit, 12);
    assert.ok(limited.draft.wordCount <= 12);
    assert.equal(limited.draft.suggestion.paperType, "case_series");
    assert.equal(limited.draft.suggestion.checklist, "CARE");

    resetLlm();
    const docx = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-alice", {
      task: "thesis_to_paper",
      input: { format: "docx", filename: "thesis.docx", docxBase64: "abc" },
    });
    assert.equal(docx.http, 422, JSON.stringify(docx));
    assert.equal(docx.error.code, "docx_needs_pdf");
    assert.equal(docx.error.message, "This file is a DOCX (Word document). Export it as PDF (in Word: File, then Save As, then PDF) and upload the PDF.");
    assert.equal(llm.calls.length, 0);

    await setRole(env, project.id, "viewer");
    const viewer = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-bob", {
      task: "thesis_to_paper",
      input: { text: "An observational cohort with no assignment.", section: "introduction" },
    });
    assert.equal(viewer.http, 403);
    assert.equal(viewer.error.code, "not_member");
    const outsider = await call(env, "POST", "v1/projects/" + project.id + "/ai-draft", "tok-eve", {
      task: "thesis_to_paper",
      input: { text: "An observational cohort.", section: "introduction" },
    });
    assert.equal(outsider.http, 404);
    assert.equal(outsider.error.code, "project_not_found");
  });
});
