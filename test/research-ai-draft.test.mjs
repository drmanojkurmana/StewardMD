import "./helpers/json-import-attr.mjs";
/* ResearchMD Ask MaiK drafts. SQLite D1 mock and a mocked provider.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-ai-draft.test.mjs
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
const llm = { calls: [], impl: async () => "{}" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      if (opts && opts.meta) {
        opts.meta.usage = { promptTokenCount: 80, candidatesTokenCount: 40, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
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
function fundWallet(env, email, inr) {
  env.MAIK_KV._m.set("maik:credit:em:" + email, JSON.stringify({ balance: inr, day: "", chargedToday: 0 }));
}
function resetLlm(impl) {
  llm.calls.length = 0;
  llm.impl = impl || (async () => "{}");
}
function sql(env) { return env.RESEARCH_DB._db; }
function n(env, table, pid) {
  const q = pid
    ? "SELECT COUNT(*) AS n FROM " + table + " WHERE project_id=?"
    : "SELECT COUNT(*) AS n FROM " + table;
  return pid ? sql(env).prepare(q).get(pid).n : sql(env).prepare(q).get().n;
}
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
  const r = await call(env, "POST", "v1/projects", "tok-alice", { title: "Ask MaiK", studyType: "systematic_review", researchQuestion: "Does BCG reduce hospital admission?" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
async function setRole(env, pid, role) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid: "u-bob", role });
  assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
}
async function makeStudy(env, pid, quote) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/studies", "tok-alice", {
    measure: "RR", label: "Smith 2020", quote: quote || "Allocation was concealed with envelopes.",
    inputs: { events1: 10, n1: 100, events2: 20, n2: 100 },
    locator: { kind: "manual", citation: "PMID 1" },
  });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.study;
}
function untouched(env, pid, drafts) {
  assert.equal(n(env, "research_protocols", pid), 0);
  assert.equal(n(env, "research_rob_assessments", pid), 0);
  assert.equal(n(env, "research_checklist_manual", pid), 0);
  assert.equal(n(env, "research_manuscript_sections"), 0);
  assert.equal(n(env, "research_ai_drafts", pid), drafts);
}

describe("research ai draft", { concurrency: false, skip: SKIP }, () => {
  test("each task stores an unverified draft and does not write protocol or rob rows", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;
    const study = await makeStudy(env, pid);
    const now = Date.now();
    sql(env).prepare("INSERT INTO research_runs (id,project_id,measure,result_json,created_by,created_ts) VALUES ('r1',?,'RR',?,'u-alice',?)")
      .run(pid, JSON.stringify({ effect: 0.49, i2: 72.8 }), now);
    sql(env).prepare("INSERT INTO research_manuscript_versions (id,project_id,version,title,status,created_by,created_ts) VALUES ('mv1',?,1,'T','draft','u-alice',?)")
      .run(pid, now);
    sql(env).prepare("INSERT INTO research_manuscript_sections (version_id,section_id,heading,level,text,sort_order,updated_by,updated_ts) VALUES ('mv1','results','Results',1,'Observed results.',0,'u-alice',?)")
      .run(now);

    resetLlm(async () => JSON.stringify({
      title: "BCG and hospital admission",
      pico: { population: "Adults", intervention: "BCG", comparison: "Placebo", outcome: "Hospital admission" },
      peco: null,
      eligibility: ["Adults admitted with tuberculosis"],
      outcomes: { primary: "Hospital admission", secondary: ["Death"] },
      analysis: { measure: "RR", model: "random-effects" },
    }));
    const protocol = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", { task: "protocol" });
    assert.equal(protocol.http, 200, JSON.stringify(protocol));
    assert.equal(protocol.requestId, undefined);
    assert.equal(protocol.draft.status, "unverified");
    assert.equal(protocol.draft.task, "protocol");
    assert.equal(protocol.draft.pico.population, "Adults");
    assert.equal(protocol.draft.eligibility.length, 1);
    assert.equal(protocol.draft.analysis.measure, "RR");
    assert.equal(protocol.draft.analysis.model, "random-effects");
    assert.equal(typeof protocol.costInr, "number");
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].maxTokens, 1200);
    assert.equal(llm.calls[0].opts.temperature, 0);
    assert.equal(n(env, "research_protocols", pid), 0);
    assert.equal(n(env, "research_ai_drafts", pid), 1);
    assert.equal(sql(env).prepare("SELECT status FROM research_ai_drafts WHERE project_id=?").get(pid).status, "unverified");

    resetLlm(async () => JSON.stringify({ pubmed: "(bcg[tiab]) AND (tuberculosis[mh])" }));
    const search = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", { task: "search_query" });
    assert.equal(search.http, 200, JSON.stringify(search));
    assert.equal(search.draft.pubmed, "(bcg[tiab]) AND (tuberculosis[mh])");
    assert.equal(search.draft.europePmc, "(bcg) AND (tuberculosis)");
    assert.equal(llm.calls[0].maxTokens, 500);
    assert.equal(llm.calls[0].opts.temperature, 0);

    resetLlm(async () => JSON.stringify({ studies: [{
      studyId: study.id,
      domains: [
        { key: "d1", judgement: "low", reason: "Envelopes were used.", quote: "concealed with envelopes" },
        { key: "d2", judgement: "high", reason: "Invented.", quote: "This sentence was invented." },
      ],
    }] }));
    const rob = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", { task: "rob" });
    assert.equal(rob.http, 200, JSON.stringify(rob));
    assert.equal(rob.draft.tool, "rob2");
    assert.equal(rob.draft.studies.length, 1);
    assert.equal(rob.draft.studies[0].domains.length, 5);
    assert.deepEqual(rob.draft.studies[0].domains[0], {
      key: "d1", judgement: "low", reason: "Envelopes were used.", quote: "concealed with envelopes",
    });
    assert.deepEqual(rob.draft.studies[0].domains[1], { key: "d2", judgement: "", reason: "", quote: "" });
    assert.equal(n(env, "research_rob_assessments", pid), 0);
    assert.equal(n(env, "research_studies", pid), 1);
    assert.equal(llm.calls[0].maxTokens, 1500);

    resetLlm(async () => JSON.stringify({ items: [
      { itemNum: "1a", status: "covered", section: "Results" },
      { itemNum: "2", status: "covered", section: "Not a section" },
      { itemNum: "999", status: "covered", section: "Results" },
    ] }));
    const checklist = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", { task: "checklist" });
    assert.equal(checklist.http, 200, JSON.stringify(checklist));
    assert.equal(checklist.draft.guidelineId, "strobe");
    assert.ok(checklist.draft.items.length > 10);
    const item1 = checklist.draft.items.find((item) => item.itemNum === "1a");
    const item2 = checklist.draft.items.find((item) => item.itemNum === "2");
    assert.equal(item1.status, "covered");
    assert.equal(item1.section, "Results");
    assert.equal(item2.status, "missing");
    assert.equal(item2.section, "");
    assert.equal(checklist.draft.items.some((item) => item.itemNum === "999"), false);
    assert.equal(n(env, "research_checklist_manual", pid), 0);
    assert.equal(llm.calls[0].maxTokens, 1500);

    resetLlm(async () => JSON.stringify({
      title: "BCG and tuberculosis",
      abstract: {
        background: "Background of the review.",
        methods: "",
        results: "Risk ratio (RR) was 0.49 {{run:r1.effect}}.",
        conclusions: "",
      },
    }));
    const title = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", { task: "title_abstract" });
    assert.equal(title.http, 200, JSON.stringify(title));
    assert.equal(title.draft.title, "BCG and tuberculosis");
    assert.equal(title.draft.abstract.results.includes("0.49"), false);
    assert.ok(title.draft.abstract.results.includes("{{run:r1.effect}}"));
    const prompt = llm.calls[0].parts[0].text + "\n" + (llm.calls[0].opts.system || "");
    assert.equal(prompt.includes("0.49"), false);
    assert.equal(prompt.includes("72.8"), false);
    assert.ok(prompt.includes("{{run:r1.effect}}"));
    assert.equal(llm.calls[0].maxTokens, 800);
    assert.equal(llm.calls[0].opts.temperature, 0);
    assert.equal(n(env, "research_manuscript_sections"), 1);
    assert.equal(n(env, "research_ai_drafts", pid), 5);
  });

  test("invalid search tags and a checklist with no manuscript stay unchecked", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;
    resetLlm(async () => JSON.stringify({ pubmed: "(bcg[zzz])" }));
    const bad = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", { task: "search_query" });
    assert.equal(bad.http, 422);
    assert.equal(bad.error.code, "invalid_draft");
    assert.equal(n(env, "research_ai_drafts", pid), 0);
    resetLlm(async () => JSON.stringify({ items: [{ itemNum: "1a", status: "covered", section: "Results" }] }));
    const checklist = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "checklist", input: { guidelineId: "strobe" },
    });
    assert.equal(checklist.http, 200, JSON.stringify(checklist));
    assert.ok(checklist.draft.items.every((item) => item.status === "missing"));
    assert.equal(n(env, "research_checklist_manual", pid), 0);
  });

  test("PHI blocks the provider, unknown task is 400, empty wallet is 402, viewer is 403", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;
    resetLlm(async () => "{\"title\":\"should not run\"}");
    const phi = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "protocol",
      input: { studies: [{ title: "Ward note", abstract: "Write to nurse@hospital.org today." }] },
    });
    assert.equal(phi.http, 422, JSON.stringify(phi));
    assert.equal(phi.error.code, "phi_blocked");
    assert.ok(phi.categories.includes("email"));
    assert.equal(llm.calls.length, 0);
    assert.equal(n(env, "research_ai_drafts", pid), 0);
    assert.equal(n(env, "research_protocols", pid), 0);

    const unknown = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", { task: "grade" });
    assert.equal(unknown.http, 400);
    assert.equal(unknown.error.code, "invalid_task");

    const empty = freshEnv();
    const poorProject = await makeProject(empty);
    resetLlm();
    const poor = await call(empty, "POST", "v1/projects/" + poorProject.id + "/ai-draft", "tok-alice", { task: "protocol" });
    assert.equal(poor.http, 402, JSON.stringify(poor));
    assert.equal(poor.error.code, "insufficient_credits");
    assert.equal(poor.error.message, "You need more MaiK tokens");
    assert.equal(llm.calls.length, 0);
    assert.equal(n(empty, "research_ai_drafts", poorProject.id), 0);

    await setRole(env, pid, "viewer");
    const viewer = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-bob", { task: "protocol" });
    assert.equal(viewer.http, 403);
    assert.equal(viewer.error.code, "not_member");
    await setRole(env, pid, "reviewer");
    const reviewer = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-bob", { task: "search_query" });
    assert.equal(reviewer.http, 403);
    const outsider = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-eve", { task: "protocol" });
    assert.equal(outsider.http, 404);
    assert.equal(outsider.error.code, "project_not_found");
    const bare = freshEnv();
    fundWallet(bare, "alice@example.com", 100);
    const bareProject = await makeProject(bare);
    resetLlm();
    const noStudy = await call(bare, "POST", "v1/projects/" + bareProject.id + "/ai-draft", "tok-alice", { task: "rob" });
    assert.equal(noStudy.http, 422);
    assert.equal(llm.calls.length, 0);
    assert.equal(n(bare, "research_rob_assessments", bareProject.id), 0);
    untouched(bare, bareProject.id, 0);
  });

  test("polish keeps run tokens, rejects a dropped token or a new number, and 402s on an empty wallet", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;
    const now = Date.now();
    const source = "The effect was {{run:run_1.ciLower}} to {{run:run_1.ciUpper}} and the same {{run:run_1.ciLower}} again. Patients improved.";
    sql(env).prepare("INSERT INTO research_manuscript_versions (id,project_id,version,title,status,created_by,created_ts) VALUES ('mv1',?,1,'T','draft','u-alice',?)")
      .run(pid, now);
    sql(env).prepare("INSERT INTO research_manuscript_sections (version_id,section_id,heading,level,text,sort_order,updated_by,updated_ts) VALUES ('mv1','discussion','Discussion',1,? ,0,'u-alice',?)")
      .run(source, now);

    const polished = "The effect was {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, and the same {{run:run_1.ciLower}} again. Patients improved.";
    resetLlm(async () => JSON.stringify({
      polished,
      changes: [{ before: "{{run:run_1.ciUpper}} and", after: "{{run:run_1.ciUpper}}, and", reason: "grammar" }],
    }));
    const ok = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish",
      input: { text: source, journalId: "bmj", sectionId: "discussion" },
    });
    assert.equal(ok.http, 200, JSON.stringify(ok));
    assert.equal(ok.draft.status, "unverified");
    assert.equal(ok.draft.task, "polish");
    assert.equal(ok.draft.polished, polished);
    assert.equal(ok.draft.spelling, "British");
    assert.equal(ok.draft.journalId, "bmj");
    assert.equal(ok.draft.sectionId, "discussion");
    assert.deepEqual(ok.draft.changes, [{
      before: "{{run:run_1.ciUpper}} and",
      after: "{{run:run_1.ciUpper}}, and",
      reason: "grammar",
    }]);
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].maxTokens, 2000);
    assert.equal(llm.calls[0].opts.temperature, 0);
    const sent = llm.calls[0].parts[0].text + "\n" + (llm.calls[0].opts.system || "");
    assert.ok(sent.includes("Spelling to follow: British"));
    assert.ok(sent.includes("{{run:run_1.ciLower}}"));
    assert.equal(sql(env).prepare("SELECT text FROM research_manuscript_sections WHERE version_id='mv1'").get().text, source);
    assert.equal(n(env, "research_ai_drafts", pid), 1);
    assert.equal(n(env, "research_protocols", pid), 0);

    resetLlm(async () => JSON.stringify({
      polished: "The effect was {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, and patients improved.",
      changes: [{ before: "Patients improved.", after: "patients improved.", reason: "grammar" }],
    }));
    const dropped = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish", input: { text: source, journalId: "bmj" },
    });
    assert.equal(dropped.http, 422, JSON.stringify(dropped));
    assert.equal(dropped.error.code, "invalid_draft");
    assert.match(dropped.error.message, /token/);
    assert.equal(n(env, "research_ai_drafts", pid), 1);

    const masked = "About {{run:r1.n12}} patients recovered in the cohort and the follow up was complete for every person enrolled.";
    resetLlm(async () => JSON.stringify({
      polished: masked.replace("recovered", "recovered, which is 12"),
      changes: [{ before: "patients recovered", after: "patients recovered, which is 12", reason: "clarity" }],
    }));
    const numbered = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish", input: { text: masked, journalId: "bmj" },
    });
    assert.equal(numbered.http, 422, JSON.stringify(numbered));
    assert.match(numbered.error.message, /number/);
    assert.equal(n(env, "research_ai_drafts", pid), 1);

    const plain = "The cohort improved during the scheduled follow up and every visit was complete.";
    resetLlm(async () => JSON.stringify({
      polished: plain.replace("The cohort improved", "The cohort improved [@smith2020]"),
      changes: [{ before: "The cohort improved", after: "The cohort improved [@smith2020]", reason: "clarity" }],
    }));
    const cited = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish", input: { text: plain, journalId: "bmj" },
    });
    assert.equal(cited.http, 422, JSON.stringify(cited));
    assert.match(cited.error.message, /citation/);
    assert.equal(n(env, "research_ai_drafts", pid), 1);

    resetLlm(async () => JSON.stringify({
      polished: "This polished paragraph is far longer than the short note it started from today.",
      changes: [{ before: "Short note.", after: "This polished paragraph is far longer than the short note it started from today.", reason: "clarity" }],
    }));
    const long = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish", input: { text: "Short note.", journalId: "bmj" },
    });
    assert.equal(long.http, 422, JSON.stringify(long));
    assert.match(long.error.message, /1\.2/);
    assert.equal(n(env, "research_ai_drafts", pid), 1);

    resetLlm(async () => JSON.stringify({
      polished: "The effect was {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, and the same {{run:run_1.ciLower}} again. Patients improved.",
      changes: [{ before: "and", after: ", and", reason: "American spelling" }],
    }));
    const wrongSpelling = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish", input: { text: source, journalId: "bmj" },
    });
    assert.equal(wrongSpelling.http, 422, JSON.stringify(wrongSpelling));
    assert.equal(n(env, "research_ai_drafts", pid), 1);

    resetLlm(async () => JSON.stringify({
      polished: "Color is used here.",
      changes: [{ before: "Colour is used here.", after: "Color is used here.", reason: "spelling" }],
    }));
    const american = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish", input: { text: "Colour is used here.", journalId: "jama" },
    });
    assert.equal(american.http, 200, JSON.stringify(american));
    assert.equal(american.draft.spelling, "American");
    assert.equal(american.draft.changes[0].reason, "American spelling");
    assert.ok((llm.calls[0].parts[0].text || "").includes("Spelling to follow: American"));
    assert.equal(sql(env).prepare("SELECT text FROM research_manuscript_sections WHERE version_id='mv1'").get().text, source);

    resetLlm(async () => JSON.stringify({
      polished: "The effect was {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, and the same {{run:run_1.ciLower}} again. The patients improved.",
      changes: [{ before: "Patients improved.", after: "The patients improved.", reason: "academic tone" }],
    }));
    const fromSection = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish", input: { sectionId: "discussion" },
    });
    assert.equal(fromSection.http, 200, JSON.stringify(fromSection));
    assert.equal(fromSection.draft.spelling, "British");
    assert.ok((llm.calls[0].parts[0].text || "").includes(source));
    assert.equal(sql(env).prepare("SELECT text FROM research_manuscript_sections WHERE version_id='mv1'").get().text, source);

    const phi = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "polish", input: { text: "Write to nurse@hospital.org about the effect.", journalId: "bmj" },
    });
    assert.equal(phi.http, 422, JSON.stringify(phi));
    assert.equal(phi.error.code, "phi_blocked");

    const poor = freshEnv();
    const poorProject = await makeProject(poor);
    resetLlm();
    const unpaid = await call(poor, "POST", "v1/projects/" + poorProject.id + "/ai-draft", "tok-alice", {
      task: "polish", input: { text: "The wording can be tighter.", journalId: "bmj" },
    });
    assert.equal(unpaid.http, 402, JSON.stringify(unpaid));
    assert.equal(unpaid.error.code, "insufficient_credits");
    assert.equal(unpaid.error.message, "You need more MaiK tokens");
    assert.equal(llm.calls.length, 0);
    assert.equal(n(poor, "research_ai_drafts", poorProject.id), 0);
  });

  test("iec_application drafts ICMR 2017 fields, strips invented phone/email, blocks PHI, 402 on empty wallet, 403 for viewer", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;

    const validIec = {
      title: "BCG and hospital admission trial",
      investigators: ["Dr. A. Sharma 9876543210 doc@example.com", "Dr. B. Patel"],
      background: "Tuberculosis remains a major health problem in India. Reach support@hospital.org or 9876543210 for queries.",
      objectives: ["To evaluate reduction in hospital admission rates"],
      design: "Randomised controlled trial",
      setting: "Tertiary care teaching hospital in New Delhi",
      duration: "18 months",
      sampleSize: "118 patients per group, total 236 patients",
      inclusion: ["Adults aged 18 to 65 years", "Confirmed diagnosis of tuberculosis"],
      exclusion: ["Severe immunosuppression", "Previous adverse reaction to BCG"],
      methodology: "Double blind randomised allocation with concealed envelopes",
      statisticalAnalysis: "Intention-to-treat analysis comparing risk ratios with 95% confidence intervals",
      risks: "Mild local pain and swelling at the injection site",
      benefits: "Potential reduced risk of severe complications and hospitalization",
      confidentiality: "All records coded and stored in encrypted databases",
      compensation: "Free medical management of trial related injuries",
      conflictOfInterest: "None declared by any investigator",
      funding: "Institutional research grant",
      consentProcess: "Written informed consent obtained in participant preferred language",
      vulnerablePopulations: "None included",
    };

    resetLlm(async () => JSON.stringify(validIec));
    const ok = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "iec_application",
      input: { sampleSize: { nPerGroup: 118, total: 236 } }
    });
    assert.equal(ok.http, 200, JSON.stringify(ok));
    assert.equal(ok.draft.status, "unverified");
    assert.equal(ok.draft.task, "iec_application");
    assert.equal(ok.draft.title, "BCG and hospital admission trial");
    assert.equal(ok.draft.design, "Randomised controlled trial");
    assert.equal(ok.draft.sampleSize, "118 patients per group, total 236 patients");
    // Invented email and phone must be stripped from text and arrays
    assert.equal(ok.draft.investigators[0].includes("doc@example.com"), false);
    assert.equal(ok.draft.investigators[0].includes("9876543210"), false);
    assert.ok(ok.draft.investigators[0].includes("Dr. A. Sharma"));
    assert.equal(ok.draft.background.includes("support@hospital.org"), false);
    assert.equal(ok.draft.background.includes("9876543210"), false);
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].maxTokens, 2000);
    assert.equal(llm.calls[0].opts.temperature, 0);
    assert.equal(n(env, "research_ai_drafts", pid), 1);

    // Bad JSON returns 422 invalid_draft
    resetLlm(async () => JSON.stringify({ title: "Incomplete", background: "" }));
    const bad = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "iec_application"
    });
    assert.equal(bad.http, 422);
    assert.equal(bad.error.code, "invalid_draft");

    // PHI in prompt refused
    resetLlm(async () => JSON.stringify(validIec));
    const phi = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "iec_application",
      input: { sampleSize: { note: "Patient John Doe john@hospital.org" } }
    });
    assert.equal(phi.http, 422);
    assert.equal(phi.error.code, "phi_blocked");

    // Viewer gets 403
    await setRole(env, pid, "viewer");
    const viewer = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-bob", {
      task: "iec_application"
    });
    assert.equal(viewer.http, 403);

    // Empty wallet gets 402
    const empty = freshEnv();
    const p2 = await makeProject(empty);
    resetLlm();
    const poor = await call(empty, "POST", "v1/projects/" + p2.id + "/ai-draft", "tok-alice", {
      task: "iec_application"
    });
    assert.equal(poor.http, 402);
    assert.equal(poor.error.code, "insufficient_credits");
  });

  test("consent_form returns participant info and consent form, returns both versions for non-English, strips phone/email, 402/403/PHI", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;

    const engForm = {
      participantInformationSheet: {
        title: "Information for participants",
        purpose: "This study aims to test if BCG vaccination reduces hospital stay.",
        procedures: "You will receive a single injection and 3 follow up visits.",
        duration: "12 months",
        risks: "Soreness at injection site. Call 9876543210 or email test@example.com for queries.",
        benefits: "You may have a lower chance of complications.",
        alternatives: "Standard care without vaccination.",
        confidentiality: "Your records are kept private with a code number.",
        voluntary: "Participation is completely voluntary. You can withdraw anytime.",
        contact: "Principal Investigator 9876543210 pi@hospital.org",
      },
      consentForm: {
        statements: [
          "I have read and understood the information sheet.",
          "I have had the opportunity to ask questions.",
          "I agree to participate in this study.",
        ],
        signatureBlock: "Participant signature: ________ Date: ________",
      },
      language: "English",
    };

    resetLlm(async () => JSON.stringify(engForm));
    const eng = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "consent_form",
      input: { language: "English" }
    });
    assert.equal(eng.http, 200, JSON.stringify(eng));
    assert.equal(eng.draft.status, "unverified");
    assert.equal(eng.draft.language, "English");
    assert.equal(eng.draft.participantInformationSheet.title, "Information for participants");
    assert.equal(eng.draft.participantInformationSheet.contact.includes("pi@hospital.org"), false);
    assert.equal(eng.draft.participantInformationSheet.contact.includes("9876543210"), false);
    assert.equal(eng.draft.participantInformationSheet.risks.includes("test@example.com"), false);
    assert.equal(eng.draft.consentForm.statements.length, 3);
    assert.equal(llm.calls[0].maxTokens, 2000);

    // Non-English (Telugu) must return BOTH englishVersion and translatedVersion
    const teluguForm = {
      englishVersion: engForm,
      translatedVersion: {
        participantInformationSheet: {
          title: "పాల్గొనేవారి సమాచార పత్రం",
          purpose: "ఈ అధ్యయనం BCG టీకా ఆసుపత్రిలో చేరికను తగ్గిస్తుందో లేదో పరీక్షిస్తుంది.",
          procedures: "మీరు ఒక ఇంజెక్షన్ మరియు 3 తదుపరి సందర్శనలను స్వీకరిస్తారు.",
          duration: "12 నెలలు",
          risks: "ఇంజెక్షన్ చేసిన ప్రదేశంలో నొప్పి.",
          benefits: "సమస్యల ప్రమాదం తగ్గే అవకాశం ఉంది.",
          alternatives: "టీకా లేకుండా ప్రామాణిక సంరక్షణ.",
          confidentiality: "మీ రికార్డులు కోడ్ నంబరుతో రహస్యంగా ఉంచబడతాయి.",
          voluntary: "పాల్గొనడం పూర్తిగా స్వచ్ఛందం. మీరు ఎప్పుడైనా వైదొలగవచ్చు.",
          contact: "ప్రధాన పరిశోధకుడు",
        },
        consentForm: {
          statements: [
            "నేను సమాచార పత్రాన్ని చదివి అర్థం చేసుకున్నాను.",
            "ప్రశ్నలు అడగడానికి నాకు అవకాశం లభించింది.",
            "నేను ఈ అధ్యయనంలో పాల్గొనడానికి అంగీకరిస్తున్నాను.",
          ],
          signatureBlock: "పాల్గొనేవారి సంతకం: ________ తేదీ: ________",
        },
        language: "Telugu",
      },
    };

    resetLlm(async () => JSON.stringify(teluguForm));
    const tel = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "consent_form",
      input: { language: "Telugu" }
    });
    assert.equal(tel.http, 200, JSON.stringify(tel));
    assert.equal(tel.draft.language, "Telugu");
    assert.ok(tel.draft.englishVersion, "must return englishVersion");
    assert.ok(tel.draft.translatedVersion, "must return translatedVersion");
    assert.equal(tel.draft.englishVersion.language, "English");
    assert.equal(tel.draft.translatedVersion.language, "Telugu");
    assert.equal(tel.draft.participantInformationSheet.title, "పాల్గొనేవారి సమాచార పత్రం");
    assert.equal(tel.draft.englishVersion.participantInformationSheet.title, "Information for participants");

    // Missing englishVersion on non-English request returns 422
    resetLlm(async () => JSON.stringify(teluguForm.translatedVersion));
    const badTrans = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "consent_form",
      input: { language: "Telugu" }
    });
    assert.equal(badTrans.http, 422);
    assert.equal(badTrans.error.code, "invalid_draft");

    // PHI in input blocked
    const phi = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "consent_form",
      input: { language: "English", notes: "Patient John Doe nurse@hospital.org" }
    });
    assert.equal(phi.http, 422);
    assert.equal(phi.error.code, "phi_blocked");

    // Viewer gets 403
    await setRole(env, pid, "viewer");
    const viewer = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-bob", {
      task: "consent_form"
    });
    assert.equal(viewer.http, 403);
  });

  test("ctri_fields drafts registry fields, leaves ethics/clearance empty, trims summary to 300 words, strips phone/email", async () => {
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;

    const summaryWords = Array(350).fill("clinical").join(" ");
    const ctriData = {
      publicTitle: "BCG trial in adults",
      scientificTitle: "Evaluation of BCG vaccine for prevention of hospitalization in pulmonary tuberculosis",
      studyType: "Interventional",
      phase: "Phase 3",
      condition: "Pulmonary tuberculosis",
      intervention: "BCG vaccine intradermal 0.1 mL",
      comparator: "Normal saline 0.1 mL placebo",
      inclusion: "Adults aged 18 to 65 years with diagnosed pulmonary tuberculosis",
      exclusion: "HIV positive, immunosuppressed, prior BCG allergy",
      primaryOutcome: {
        outcome: "Hospital admission due to tuberculosis complication",
        timepoint: "12 months post vaccination"
      },
      secondaryOutcomes: ["All-cause mortality at 12 months", "Adverse events at 30 days"],
      targetSampleSize: 262,
      sites: "Department of Medicine, AIIMS, New Delhi. Call 9876543210 or email ctri@hospital.org for recruitment.",
      recruitmentStatus: "Recruiting", // Model returned Recruiting; must be forced to Not Yet Recruiting
      ethicsCommittee: "IEC approval 2026/09/123", // Model invented approval; must be cleared to ""
      regulatoryClearance: "DCGI/CT/2026/456", // Model invented clearance; must be cleared to ""
      fundingSource: "Indian Council of Medical Research (ICMR)",
      briefSummary: summaryWords,
    };

    resetLlm(async () => JSON.stringify(ctriData));
    const res = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "ctri_fields",
      input: { sampleSize: { targetSampleSize: 262 } }
    });
    assert.equal(res.http, 200, JSON.stringify(res));
    assert.equal(res.draft.status, "unverified");
    assert.equal(res.draft.task, "ctri_fields");
    assert.equal(res.draft.publicTitle, "BCG trial in adults");
    assert.equal(res.draft.scientificTitle, "Evaluation of BCG vaccine for prevention of hospitalization in pulmonary tuberculosis");
    assert.equal(res.draft.recruitmentStatus, "Not Yet Recruiting");
    assert.equal(res.draft.ethicsCommittee, "");
    assert.equal(res.draft.regulatoryClearance, "");
    assert.equal(res.draft.targetSampleSize, 262);
    assert.equal(res.draft.sites.includes("ctri@hospital.org"), false);
    assert.equal(res.draft.sites.includes("9876543210"), false);
    // summary must be trimmed to <= 300 words
    const words = res.draft.briefSummary.trim().split(/\s+/).length;
    assert.ok(words <= 300, "briefSummary should be <= 300 words, got " + words);
    assert.equal(words, 300);

    // Bad JSON returns 422
    resetLlm(async () => JSON.stringify({ publicTitle: "", scientificTitle: "" }));
    const bad = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "ctri_fields"
    });
    assert.equal(bad.http, 422);
    assert.equal(bad.error.code, "invalid_draft");

    // PHI refusal
    const phi = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "ctri_fields",
      input: { sampleSize: { note: "Patient John Doe nurse@hospital.org" } }
    });
    assert.equal(phi.http, 422);
    assert.equal(phi.error.code, "phi_blocked");

    // Viewer gets 403
    await setRole(env, pid, "viewer");
    const viewer = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-bob", {
      task: "ctri_fields"
    });
    assert.equal(viewer.http, 403);
  });
});
