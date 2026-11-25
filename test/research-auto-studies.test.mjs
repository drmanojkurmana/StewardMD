import "./helpers/json-import-attr.mjs";
/* ResearchMD find-studies and auto-add. SQLite D1 mock, mocked fetch, mocked provider.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-auto-studies.test.mjs
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
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");

const SENTENCES = [
  "Hospital admission was 237/2373 (10.0%) vs 326/2371 (13.7%).",
  "Hospital admission occurred in 237 of 2373 versus 326 of 2371.",
  "Hospital admission risk ratio 0.72 (95% CI 0.65 to 0.80).",
  "For hospital admission the risk ratio was 0.49 (95% CI 0.34-0.70).",
  "Hospital admission risk ratio 1.20 (95% CI 1.01, 1.48), p = 0.04.",
];
const AI_ABSTRACT = "Group A had 11 events. Group B had 22 events. Totals were 100 and 90. The outcome was hospital admission.";

const net = {
  calls: [],
  searchPmids: ["111", "222"],
  epmcSearch: [],
  byPmid: new Map(),
  xml: new Map(),
};

function jsonRes(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
}
function textRes(s) {
  return new Response(s, { status: 200, headers: { "content-type": "application/xml" } });
}
function esummary(ids) {
  const result = { uids: ids };
  for (const pmid of ids) {
    const rec = net.byPmid.get(pmid) || {};
    result[pmid] = {
      uid: pmid,
      title: rec.title || ("Study " + pmid),
      fulljournalname: rec.journal || "Lancet",
      pubdate: String(rec.year || 2020),
      authors: [{ name: (rec.authors && rec.authors[0]) || "Smith A" }],
      elocationid: "",
      articleids: rec.doi ? [{ idtype: "doi", value: rec.doi }] : [],
    };
  }
  return { result };
}
function epmcRaw(rec) {
  return {
    source: "MED",
    id: rec.pmid,
    pmid: rec.pmid,
    doi: rec.doi || "",
    title: rec.title || ("Study " + rec.pmid),
    authorString: (rec.authors && rec.authors[0]) || "Smith A",
    pubYear: String(rec.year || 2020),
    journalTitle: rec.journal || "Lancet",
    abstractText: rec.epmcAbstract || rec.abstract || "",
    isOpenAccess: rec.oa ? "Y" : "N",
    pmcid: rec.pmcid || "",
    license: rec.license || "",
  };
}
globalThis.fetch = async (url) => {
  const u = String(url);
  net.calls.push(u);
  const parsed = new URL(u);
  if (u.includes("efetch.fcgi")) {
    const ids = (parsed.searchParams.get("id") || "").split(",").filter(Boolean);
    const xml = ids.map((pmid) => {
      const rec = net.byPmid.get(pmid) || {};
      return "<PubmedArticle><PMID>" + pmid + "</PMID><AbstractText>" + (rec.abstract || "") + "</AbstractText></PubmedArticle>";
    }).join("");
    return textRes(xml);
  }
  if (u.includes("esummary.fcgi")) {
    const ids = (parsed.searchParams.get("id") || "").split(",").filter(Boolean);
    return jsonRes(esummary(ids));
  }
  if (u.includes("esearch.fcgi")) {
    const retmax = Number(parsed.searchParams.get("retmax") || "20");
    return jsonRes({ esearchresult: { idlist: net.searchPmids.slice(0, retmax) } });
  }
  if (u.includes("/fullTextXML")) {
    const id = (u.match(/PMC\d+/) || [""])[0];
    return textRes(net.xml.get(id) || "<article></article>");
  }
  if (u.includes("ebi.ac.uk/europepmc/webservices/rest/search")) {
    const q = parsed.searchParams.get("query") || "";
    if (q.includes("EXT_ID:") || q.includes("DOI:")) {
      const m = q.match(/EXT_ID:(\d+)/);
      const rec = m ? net.byPmid.get(m[1]) : null;
      if (!rec || !rec.lookup) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: [epmcRaw(rec)] } });
    }
    return jsonRes({ resultList: { result: net.epmcSearch } });
  }
  return jsonRes({});
};

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
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_CALLBACK_SECRET: "test-secret",
    MAIK_KV: kvShim(),
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
function studyCount(env, pid) {
  return sql(env).prepare("SELECT COUNT(*) AS n FROM research_studies WHERE project_id=?").get(pid).n;
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
  return { http: res.status, requestHeader: res.headers.get("x-request-id"), ...(data || {}) };
}
async function makeProject(env, title) {
  const r = await call(env, "POST", "v1/projects", "tok-alice", { title: title || "Auto studies" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
async function setRole(env, pid, role) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid: "u-bob", role });
  assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
}
function seedPmid(pmid, extra) {
  net.byPmid.set(pmid, Object.assign({
    pmid, title: "Study " + pmid, year: 2020, authors: ["Smith A"],
    doi: "10.1000/test." + pmid, journal: "Lancet", abstract: "", oa: false, lookup: false,
  }, extra));
}

describe("research auto studies", { concurrency: false, skip: SKIP }, () => {
  test("0007 applies after 0001-0006, rolls back, mirror is a no-op", () => {
    const files = ["phase-1/0001_research_v1.sql", "phase-2/0002_research_v2.sql",
      "phase-3/0003_research_v3.sql", "phase-3/0004_research_v4.sql", "phase-6/0005_research_v5.sql",
      "phase-5/0006_research_v6.sql", "phase-5/0007_research_v7.sql"];
    const db = new DatabaseSync(":memory:");
    for (const f of files) db.exec(readFileSync(new URL("../docs/research/contracts/" + f, import.meta.url), "utf8"));
    const now = Date.now();
    db.prepare("INSERT INTO research_projects (id,owner_uid,title,created_ts,updated_ts) VALUES ('p1','u1','t',?,?)").run(now, now);
    db.prepare("INSERT INTO research_paper_numbers (cache_key,measure,value_json,created_ts) VALUES ('k','RR','{}',?)").run(now);
    db.prepare("INSERT INTO research_ai_drafts (id,project_id,task,draft_json,created_by,created_ts) VALUES ('d1','p1','protocol','{}','u1',?)").run(now);
    for (const t of ["research_paper_numbers", "research_ai_drafts"])
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t), t);
    db.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0007_rollback.sql", import.meta.url), "utf8"));
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(!names.includes("research_paper_numbers"));
    assert.ok(!names.includes("research_ai_drafts"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_projects").get().n, 1);
    assert.throws(() => db.prepare("INSERT INTO research_ai_drafts (id,project_id,task,draft_json,created_by,created_ts) VALUES ('d2','p1','protocol','{}','u1',?)").run(now));
    const mirror = new DatabaseSync(":memory:");
    mirror.exec(SCHEMA);
    mirror.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0007_research_v7.sql", import.meta.url), "utf8"));
    assert.equal(mirror.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='research_paper_numbers'").get().n, 1);
  });

  test("find-studies merges PubMed and Europe PMC and de-duplicates by DOI", async () => {
    resetLlm();
    net.calls.length = 0;
    net.searchPmids = ["111", "222"];
    seedPmid("111", { doi: "10.1000/same.1", abstract: "P".repeat(1300), title: "BCG and hospital admission" });
    seedPmid("222", { doi: "10.2000/only.222", abstract: "Second abstract", title: "Second trial" });
    net.epmcSearch = [
      { source: "MED", id: "111", pmid: "111", doi: "10.1000/same.1", title: "BCG and hospital admission", authorString: "Smith A", pubYear: "2020", journalTitle: "Lancet", abstractText: "EPMC abstract text", isOpenAccess: "Y" },
      { source: "MED", id: "444", pmid: "444", doi: "10.3000/only.444", title: "Another trial", authorString: "Patel R", pubYear: "2021", journalTitle: "BMJ", abstractText: "Unique abstract", isOpenAccess: "N" },
    ];
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const r = await call(env, "POST", "v1/projects/" + project.id + "/find-studies", "tok-alice", { q: "bcg tuberculosis", limit: 50 });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(r.requestId, undefined);
    assert.ok(r.requestHeader);
    assert.equal(llm.calls.length, 0);
    assert.equal(r.results.length, 3);
    const merged = r.results.find((row) => row.pmid === "111");
    assert.equal(merged.source, "pubmed");
    assert.equal(merged.doi, "10.1000/same.1");
    assert.equal(merged.freeFullText, true);
    assert.equal(merged.year, 2020);
    assert.deepEqual(merged.authors, ["Smith A"]);
    assert.ok(merged.abstract.length <= 1200);
    assert.equal(merged.abstract, "P".repeat(1200));
    assert.equal(r.results.filter((row) => row.doi === "10.1000/same.1").length, 1);
    assert.ok(r.results.some((row) => row.pmid === "444" && row.source === "europe_pmc"));
    assert.ok(r.results.some((row) => row.pmid === "222" && row.source === "pubmed"));
  });

  test("find-studies read role, validation, and outsider 404", async () => {
    resetLlm();
    net.searchPmids = ["111"];
    net.epmcSearch = [];
    seedPmid("111", { abstract: "Short abstract." });
    const env = freshEnv();
    const project = await makeProject(env);
    const pid = project.id;
    await setRole(env, pid, "viewer");
    const ok = await call(env, "POST", "v1/projects/" + pid + "/find-studies", "tok-bob", { q: "bcg" });
    assert.equal(ok.http, 200, JSON.stringify(ok));
    assert.equal(ok.results.length, 1);
    assert.equal(llm.calls.length, 0);
    const outsider = await call(env, "POST", "v1/projects/" + pid + "/find-studies", "tok-eve", { q: "bcg" });
    assert.equal(outsider.http, 404);
    assert.equal(outsider.error.code, "project_not_found");
    const badLimit = await call(env, "POST", "v1/projects/" + pid + "/find-studies", "tok-alice", { q: "bcg", limit: 51 });
    assert.equal(badLimit.http, 400);
    const missing = await call(env, "POST", "v1/projects/" + pid + "/find-studies", "tok-alice", { limit: 10 });
    assert.equal(missing.http, 400);
    env.RESEARCH_CONTACT_EMAIL = "";
    const unconfigured = await call(env, "POST", "v1/projects/" + pid + "/find-studies", "tok-alice", { q: "bcg" });
    assert.equal(unconfigured.http, 503);
    assert.equal(unconfigured.error.code, "search_unconfigured");
  });

  test("parser fills five abstract sentences and does not call the provider", async () => {
    resetLlm();
    net.calls.length = 0;
    net.epmcSearch = [];
    SENTENCES.forEach((abstract, i) => seedPmid(String(1001 + i), { abstract, lookup: false }));
    const env = freshEnv();
    const project = await makeProject(env);
    const pid = project.id;
    const r = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission",
      measure: "RR",
      items: SENTENCES.map((_, i) => ({ pmid: String(1001 + i) })),
    });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(llm.calls.length, 0);
    assert.ok(net.calls.length > 0);
    assert.equal(r.results.length, 5);
    const expect = [
      { format: "counts", events1: 237, total1: 2373, events2: 326, total2: 2371 },
      { format: "counts", events1: 237, total1: 2373, events2: 326, total2: 2371 },
      { format: "estimate", estimate: 0.72, ciLower: 0.65, ciUpper: 0.8 },
      { format: "estimate", estimate: 0.49, ciLower: 0.34, ciUpper: 0.7 },
      { format: "estimate", estimate: 1.2, ciLower: 1.01, ciUpper: 1.48 },
    ];
    r.results.forEach((row, i) => {
      assert.equal(row.status, "filled", JSON.stringify(row));
      assert.equal(row.method, "parser");
      assert.equal(row.message, undefined);
      assert.equal(row.study.verified, false);
      assert.equal(row.study.measure, "RR");
      assert.equal(row.study.locator.aiSuggested, true);
      assert.equal(row.study.locator.method, "parser");
      assert.equal(row.study.locator.kind, "manual");
      assert.ok(row.quote.includes(SENTENCES[i].slice(0, 40)));
      if (expect[i].format === "counts") {
        assert.equal(row.fields.events1, expect[i].events1);
        assert.equal(row.fields.total1, expect[i].total1);
        assert.equal(row.fields.events2, expect[i].events2);
        assert.equal(row.fields.total2, expect[i].total2);
        assert.equal(row.study.inputs.n1, expect[i].total1);
        assert.equal(row.study.inputs.events1, expect[i].events1);
      } else {
        assert.equal(row.fields.estimate, expect[i].estimate);
        assert.equal(row.fields.ciLower, expect[i].ciLower);
        assert.equal(row.fields.ciUpper, expect[i].ciUpper);
        assert.equal(row.study.inputs.effect, expect[i].estimate);
      }
    });
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_studies WHERE project_id=? AND verified=1").get(pid).n, 0);
    const fetches = net.calls.length;
    const again = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "1001" }],
    });
    assert.equal(again.http, 200, JSON.stringify(again));
    assert.equal(again.results[0].method, "cache");
    assert.equal(again.results[0].status, "filled");
    assert.equal(net.calls.length, fetches);
    assert.equal(llm.calls.length, 0);
    assert.equal(studyCount(env, pid), 6);
  });

  test("parser succeeds with an empty wallet; AI path returns 402 and does not call the provider", async () => {
    resetLlm();
    seedPmid("3001", { abstract: SENTENCES[0] });
    seedPmid("3002", { abstract: AI_ABSTRACT });
    const env = freshEnv();
    const project = await makeProject(env);
    const pid = project.id;
    const parsed = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "3001" }],
    });
    assert.equal(parsed.http, 200, JSON.stringify(parsed));
    assert.equal(parsed.results[0].method, "parser");
    assert.equal(llm.calls.length, 0);
    const before = studyCount(env, pid);
    const poor = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "3002" }],
    });
    assert.equal(poor.http, 402, JSON.stringify(poor));
    assert.equal(poor.error.code, "insufficient_credits");
    assert.equal(poor.error.message, "You need more MaiK tokens");
    assert.equal(llm.calls.length, 0);
    assert.equal(studyCount(env, pid), before);
  });

  test("AI runs only when the parser fails, and a quote outside the snippet is needs_pdf", async () => {
    seedPmid("4001", { abstract: AI_ABSTRACT });
    seedPmid("4002", { abstract: AI_ABSTRACT });
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;
    resetLlm(async () => JSON.stringify({
      measure: "RR", format: "counts", events1: 11, total1: 100, events2: 22, total2: 90,
      quote: AI_ABSTRACT, location: "abstract", confidence: 0.8,
    }));
    const filled = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "4001" }],
    });
    assert.equal(filled.http, 200, JSON.stringify(filled));
    assert.equal(filled.results[0].status, "filled");
    assert.equal(filled.results[0].method, "ai");
    assert.equal(filled.results[0].fields.events1, 11);
    assert.equal(filled.results[0].fields.total1, 100);
    assert.equal(filled.results[0].study.verified, false);
    assert.equal(filled.results[0].study.inputs.n1, 100);
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].maxTokens, 300);
    assert.equal(llm.calls[0].opts.temperature, 0);
    const before = studyCount(env, pid);
    resetLlm(async () => JSON.stringify({
      measure: "RR", format: "counts", events1: 11, total1: 100, events2: 22, total2: 90,
      quote: "This sentence was invented.", location: "abstract", confidence: 0.4,
    }));
    const rejected = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "4002" }],
    });
    assert.equal(rejected.http, 200, JSON.stringify(rejected));
    assert.equal(rejected.results[0].status, "needs_pdf");
    assert.equal(rejected.results[0].study, null);
    assert.equal(rejected.results[0].method, "");
    assert.equal(rejected.results[0].message, "The abstract did not contain a complete result. Upload the PDF (the full paper) so the numbers can be read from a table.");
    assert.equal(llm.calls.length, 1);
    assert.equal(studyCount(env, pid), before);
  });

  test("open-access table row is parsed with no AI call; protocol measure defaults to OR", async () => {
    resetLlm();
    seedPmid("5001", {
      abstract: "Background only.",
      oa: true, lookup: true, pmcid: "PMC5001", license: "cc-by",
    });
    net.xml.set("PMC5001", "<article><table><caption>Table 2. Outcomes</caption><tr><td>Hospital admission was 10/100 (10.0%) vs 20/100 (20.0%).</td></tr></table></article>");
    const env = freshEnv();
    const project = await makeProject(env);
    const pid = project.id;
    const now = Date.now();
    sql(env).prepare("INSERT INTO research_protocols (id,project_id,version,status,content_json,created_by,created_ts) VALUES ('pr1',?,1,'draft',?, 'u-alice',?)")
      .run(pid, JSON.stringify({ measure: "OR" }), now);
    const oa = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission", items: [{ pmid: "5001" }],
    });
    assert.equal(oa.http, 200, JSON.stringify(oa));
    assert.equal(oa.results[0].status, "filled", JSON.stringify(oa.results[0]));
    assert.equal(oa.results[0].method, "parser");
    assert.equal(oa.results[0].study.measure, "OR");
    assert.equal(oa.results[0].location, "Table 2");
    assert.equal(oa.results[0].fields.events1, 10);
    assert.equal(oa.results[0].fields.total2, 100);
    assert.equal(llm.calls.length, 0);
    seedPmid("5002", { abstract: "Hospital admission hazard ratio 0.75 (95% CI 0.65 to 0.86)." });
    const hr = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission", measure: "HR", items: [{ pmid: "5002" }],
    });
    assert.equal(hr.http, 200, JSON.stringify(hr));
    assert.equal(hr.results[0].method, "parser");
    assert.equal(hr.results[0].fields.estimate, 0.75);
    assert.equal(hr.results[0].fields.ciLower, 0.65);
    assert.equal(hr.results[0].fields.ciUpper, 0.86);
    assert.equal(llm.calls.length, 0);
  });

  test("outsider is 404 and viewer or reviewer cannot auto-add", async () => {
    seedPmid("6001", { abstract: SENTENCES[0] });
    const env = freshEnv();
    const project = await makeProject(env);
    const pid = project.id;
    const outsider = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-eve", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "6001" }],
    });
    assert.equal(outsider.http, 404);
    assert.equal(outsider.error.code, "project_not_found");
    await setRole(env, pid, "viewer");
    const viewer = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-bob", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "6001" }],
    });
    assert.equal(viewer.http, 403);
    assert.equal(viewer.error.code, "not_member");
    await setRole(env, pid, "reviewer");
    const reviewer = await call(env, "POST", "v1/projects/" + pid + "/studies/auto-add", "tok-bob", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "6001" }],
    });
    assert.equal(reviewer.http, 403);
    assert.equal(reviewer.error.code, "not_member");
    assert.equal(studyCount(env, pid), 0);
  });

  test("a cache row written in one project is a hit in another project", async () => {
    resetLlm();
    seedPmid("7001", { abstract: SENTENCES[2] });
    const env = freshEnv();
    const first = await makeProject(env, "One");
    const second = await makeProject(env, "Two");
    await setRole(env, second.id, "analyst");
    const added = await call(env, "POST", "v1/projects/" + first.id + "/studies/auto-add", "tok-alice", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "7001" }],
    });
    assert.equal(added.results[0].method, "parser");
    const fetches = net.calls.length;
    const hit = await call(env, "POST", "v1/projects/" + second.id + "/studies/auto-add", "tok-bob", {
      outcome: "hospital admission", measure: "RR", items: [{ pmid: "7001" }],
    });
    assert.equal(hit.http, 200, JSON.stringify(hit));
    assert.equal(hit.results[0].method, "cache");
    assert.equal(hit.results[0].fields.estimate, 0.72);
    assert.equal(net.calls.length, fetches);
    assert.equal(llm.calls.length, 0);
  });
});
