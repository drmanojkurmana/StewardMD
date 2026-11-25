import "./helpers/json-import-attr.mjs";
/* ResearchMD paste-a-link study card. SQLite D1 mock, mocked fetch, synthetic text.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-paper-card.test.mjs
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
        opts.meta.usage = { promptTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { resolveLink } = await import("../functions/api/research/_paper_card.js");
const { parseFindings } = await import("../functions/api/research/_auto_studies.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");

const RESULTS = "Death was 386/2373 vs 502/2371. The hazard ratio was 0.74 (95% CI 0.65 to 0.85), p < 0.001.";
const CONCLUSIONS = "Drug A lowered the chance of death.";

function articleXml(opts) {
  const authors = (opts.authors || []).map((a) => {
    const [last, initials] = a.split(" ");
    return "<Author><LastName>" + last + "</LastName><Initials>" + (initials || "") + "</Initials></Author>";
  }).join("");
  const types = (opts.types || []).map((t) => "<PublicationType>" + t + "</PublicationType>").join("");
  const mesh = (opts.mesh || []).map((t) => "<MeshHeading><DescriptorName>" + t + "</DescriptorName></MeshHeading>").join("");
  const keywords = (opts.keywords || []).map((t) => "<Keyword>" + t + "</Keyword>").join("");
  const sections = (opts.sections || []).map((s) => {
    const label = s.label ? " Label=\"" + s.label + "\"" : "";
    return "<AbstractText" + label + ">" + s.text + "</AbstractText>";
  }).join("");
  return "<PubmedArticle><MedlineCitation><PMID>" + opts.pmid + "</PMID><Article>" +
    "<Journal><Title>" + (opts.journal || "Synthetic Journal") + "</Title>" +
    "<JournalIssue><PubDate><Year>" + (opts.year || 2020) + "</Year><Month>Jan</Month></PubDate></JournalIssue></Journal>" +
    "<ArticleTitle>" + (opts.title || "Study") + "</ArticleTitle>" +
    "<Abstract>" + sections + "</Abstract><AuthorList>" + authors + "</AuthorList>" +
    "<PublicationTypeList>" + types + "</PublicationTypeList></Article>" +
    "<MeshHeadingList>" + mesh + "</MeshHeadingList><KeywordList>" + keywords + "</KeywordList>" +
    "</MedlineCitation><PubmedData><ArticleIdList>" +
    "<ArticleId IdType=\"pubmed\">" + opts.pmid + "</ArticleId>" +
    (opts.pmcid ? "<ArticleId IdType=\"pmc\">" + opts.pmcid + "</ArticleId>" : "") +
    (opts.doi ? "<ArticleId IdType=\"doi\">" + opts.doi + "</ArticleId>" : "") +
    "</ArticleIdList></PubmedData></PubmedArticle>";
}

const net = { calls: [], articles: new Map(), idconv: new Map(), crossref: new Map(), pages: new Map() };

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
function textRes(s, status = 200) {
  return new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
globalThis.fetch = async (url) => {
  const u = String(url);
  net.calls.push(u);
  const parsed = new URL(u);
  if (u.includes("idconv")) {
    const id = parsed.searchParams.get("ids") || "";
    const hit = net.idconv.get(id);
    return jsonRes({ status: "ok", records: hit ? [hit] : [] });
  }
  if (u.includes("esearch.fcgi")) {
    const term = parsed.searchParams.get("term") || "";
    const m = term.match(/"([^"]+)"\[doi\]/i);
    const rec = m ? net.idconv.get(m[1]) : null;
    const pmid = rec && rec.pmid ? rec.pmid : "";
    return jsonRes({ esearchresult: { idlist: pmid ? [pmid] : [] } });
  }
  if (u.includes("efetch.fcgi")) {
    const ids = (parsed.searchParams.get("id") || "").split(",").filter(Boolean);
    const xml = ids.map((id) => net.articles.get(id) || "").join("");
    return textRes("<PubmedArticleSet>" + xml + "</PubmedArticleSet>");
  }
  if (u.includes("api.crossref.org/works")) {
    const filter = parsed.searchParams.get("filter") || "";
    const doi = decodeURIComponent((filter.match(/doi:(.+)$/) || [])[1] || "");
    const item = net.crossref.get(doi);
    return jsonRes({ message: { items: item ? [item] : [] } });
  }
  if (net.pages.has(u)) return textRes(net.pages.get(u));
  return textRes("no", 404);
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
  const r = await call(env, "POST", "v1/projects", "tok-alice", { title: "Link card" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
async function setRole(env, pid, role) {
  const r = await call(env, "POST", "v1/projects/" + pid + "/members", "tok-alice", { uid: "u-bob", role });
  assert.ok(r.http === 200 || r.http === 201, JSON.stringify(r));
}
function seedTrial() {
  const authors = ["Smith JA", "Patel RB", "Lee QC", "Garcia MD", "Nguyen TL", "Brown KE", "Extra ZZ"];
  net.articles.set("31535829", articleXml({
    pmid: "31535829", pmcid: "PMC7654321", doi: "10.1000/SYNTH.1",
    title: "Drug A in adults", journal: "Synthetic Journal", year: 2020, authors,
    types: ["Randomized Controlled Trial", "Journal Article"],
    mesh: ["Heart Failure"],
    keywords: [],
    sections: [
      { label: "BACKGROUND", text: "Adults with condition X." },
      { label: "METHODS", text: "We enrolled 4744 adults. A smaller pilot used n = 40." },
      { label: "RESULTS", text: "Death was 386/2373 vs 502/2371. The hazard ratio was 0.74 (95% CI 0.65 to 0.85), p &lt; 0.001." },
      { label: "CONCLUSIONS", text: CONCLUSIONS },
    ],
  }));
}
function putCard(env, card) {
  const now = Date.now();
  const payload = JSON.stringify(card);
  if (card.pmid) sql(env).prepare("INSERT INTO research_paper_cards (cache_key,card_json,created_ts) VALUES (?,?,?)").run("pmid:" + card.pmid, payload, now);
  if (card.doi) sql(env).prepare("INSERT INTO research_paper_cards (cache_key,card_json,created_ts) VALUES (?,?,?)").run("doi:" + card.doi, payload, now);
}
function plainCard() {
  return {
    pmid: "42", pmcid: "", doi: "10.1000/plain.42", title: "A plain abstract", journal: "Letters",
    year: 2021, authors: ["Kim SL"], url: "https://pubmed.ncbi.nlm.nih.gov/42/", freeFullText: false,
    design: null, sampleSize: null, structured: false,
    sections: [{ label: "", text: "Adults received drug A. The outcome was recovery in 12 of 30." }],
    findings: [], conclusion: "The outcome was recovery in 12 of 30.",
    mesh: ["Should Not Be Sent"], keywords: [], method: "api", tokensUsed: 0,
  };
}

describe("resolveLink", () => {
  test("reads each link form and rejects junk", () => {
    assert.deepEqual(resolveLink("31535829"), { pmid: "31535829" });
    assert.deepEqual(resolveLink("PMID: 123"), { pmid: "123" });
    assert.deepEqual(resolveLink("https://pubmed.ncbi.nlm.nih.gov/31535829/"), { pmid: "31535829" });
    assert.deepEqual(resolveLink("https://www.ncbi.nlm.nih.gov/pubmed/31535829"), { pmid: "31535829" });
    assert.deepEqual(resolveLink("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6814877/"), { pmcid: "PMC6814877" });
    assert.deepEqual(resolveLink("https://pmc.ncbi.nlm.nih.gov/articles/PMC6814877"), { pmcid: "PMC6814877" });
    assert.deepEqual(resolveLink("https://europepmc.org/article/PMC/PMC6814877"), { pmcid: "PMC6814877" });
    assert.deepEqual(resolveLink("https://europepmc.org/article/MED/31535829"), { pmid: "31535829" });
    assert.deepEqual(resolveLink("https://europepmc.org/abstract/MED/31535829"), { pmid: "31535829" });
    assert.deepEqual(resolveLink("https://doi.org/10.1056/NEJMoa1911303"), { doi: "10.1056/nejmoa1911303" });
    assert.deepEqual(resolveLink("https://dx.doi.org/10.1056/NEJMoa1911303"), { doi: "10.1056/nejmoa1911303" });
    assert.deepEqual(resolveLink("doi:10.1056/NEJMoa1911303"), { doi: "10.1056/nejmoa1911303" });
    assert.deepEqual(resolveLink("doi:10.1056/NEJMoa1911303."), { doi: "10.1056/nejmoa1911303" });
    assert.deepEqual(resolveLink("https://doi.org/10.1002/art.12345/full"), { doi: "10.1002/art.12345" });
    assert.deepEqual(resolveLink("https://www.nejm.org/doi/full/10.1056/NEJMoa1911303"), { doi: "10.1056/nejmoa1911303" });
    assert.deepEqual(resolveLink("https://onlinelibrary.wiley.com/doi/10.1002/art.12345"), { doi: "10.1002/art.12345" });
    assert.equal(resolveLink("https://journal.example/view/1"), null);
    assert.equal(resolveLink("not a study link"), null);
    assert.equal(resolveLink("1234567890"), null);
  });

  test("parser keeps every quote and stops at 5", () => {
    const lines = [];
    for (let i = 1; i <= 6; i++) lines.push("The hazard ratio was 0.7" + i + " (95% CI 0.10 to 0.90).");
    lines.push("The risk difference was 1.20 (95% CI 0.40 to 2.00).");
    const rows = parseFindings(lines.join(" "));
    assert.equal(rows.length, 5);
    assert.equal(rows[0].quote, lines[0]);
    assert.equal(rows[0].measure, "HR");
    assert.equal(rows[0].estimate, 0.71);
    assert.equal(rows.some((row) => row.quote === lines[5]), false);
    const rd = parseFindings("The risk difference was 1.20 (95% CI 0.40 to 2.00).");
    assert.equal(rd.length, 1);
    assert.equal(rd[0].measure, "RD");
    assert.equal(rd[0].estimate, 1.2);
    assert.equal(rd[0].quote, "The risk difference was 1.20 (95% CI 0.40 to 2.00).");
  });
});

describe("research paper card", { concurrency: false, skip: SKIP }, () => {
  test("0007 creates the card cache and the rollback drops it", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    db.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0007_research_v7.sql", import.meta.url), "utf8"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='research_paper_cards'").get().n, 1);
    db.exec(readFileSync(new URL("../docs/research/contracts/phase-5/0007_rollback.sql", import.meta.url), "utf8"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='research_paper_cards'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='research_projects'").get().n, 1);
  });

  test("structured abstract becomes a card, then a cache hit does no fetch", async () => {
    resetLlm();
    net.calls.length = 0;
    seedTrial();
    const env = freshEnv();
    const project = await makeProject(env);
    const pid = project.id;
    const before = net.calls.length;
    const r = await call(env, "POST", "v1/projects/" + pid + "/paper-card", "tok-alice", {
      link: "https://pubmed.ncbi.nlm.nih.gov/31535829/",
    });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(r.requestId, undefined);
    assert.ok(net.calls.length > before);
    assert.equal(llm.calls.length, 0);
    const card = r.card;
    assert.equal(card.pmid, "31535829");
    assert.equal(card.pmcid, "PMC7654321");
    assert.equal(card.doi, "10.1000/synth.1");
    assert.equal(card.title, "Drug A in adults");
    assert.equal(card.journal, "Synthetic Journal");
    assert.equal(card.year, 2020);
    assert.equal(card.authors.length, 6);
    assert.equal(card.authors[0], "Smith JA");
    assert.equal(card.authors.includes("Extra ZZ"), false);
    assert.equal(card.url, "https://pubmed.ncbi.nlm.nih.gov/31535829/");
    assert.equal(card.freeFullText, true);
    assert.deepEqual(card.design, {
      key: "rct",
      label: "Randomized controlled trial (RCT) (people were assigned to groups by chance)",
      source: "publication_type",
    });
    assert.equal(card.sampleSize.n, 4744);
    assert.equal(card.sampleSize.quote, "4744 adults");
    assert.equal(card.structured, true);
    assert.deepEqual(card.sections.map((s) => s.label), ["Background", "Methods", "Results", "Conclusions"]);
    assert.equal(card.sections[3].text, CONCLUSIONS);
    assert.equal(card.conclusion, CONCLUSIONS);
    assert.equal(card.findings.length, 2);
    assert.deepEqual(card.findings[0], {
      format: "counts", events1: 386, total1: 2373, events2: 502, total2: 2371,
      quote: "Death was 386/2373 vs 502/2371.",
    });
    assert.equal(card.findings[1].measure, "HR");
    assert.equal(card.findings[1].format, "estimate");
    assert.equal(card.findings[1].estimate, 0.74);
    assert.equal(card.findings[1].ciLower, 0.65);
    assert.equal(card.findings[1].ciUpper, 0.85);
    assert.equal(card.findings[1].p, "<0.001");
    assert.equal(card.findings[1].quote, "The hazard ratio was 0.74 (95% CI 0.65 to 0.85), p < 0.001.");
    assert.deepEqual(card.mesh, ["Heart Failure"]);
    assert.deepEqual(card.keywords, []);
    assert.equal(card.method, "api");
    assert.equal(card.tokensUsed, 0);
    assert.equal(sql(env).prepare("SELECT COUNT(*) AS n FROM research_ai_usage").get().n, 0);
    const keys = sql(env).prepare("SELECT cache_key FROM research_paper_cards ORDER BY cache_key").all().map((row) => row.cache_key);
    assert.deepEqual(keys, ["doi:10.1000/synth.1", "pmid:31535829"]);
    const audit = sql(env).prepare("SELECT metadata_json FROM research_audit_events WHERE event_type='paper_card.viewed'").get();
    assert.deepEqual(Object.keys(JSON.parse(audit.metadata_json)).sort(), ["doi", "pmcid", "pmid"]);

    const fetched = net.calls.length;
    const again = await call(env, "POST", "v1/projects/" + pid + "/paper-card", "tok-alice", {
      link: "PMID: 31535829",
    });
    assert.equal(again.http, 200, JSON.stringify(again));
    assert.equal(again.card.method, "cache");
    assert.equal(again.card.tokensUsed, 0);
    assert.equal(again.card.title, "Drug A in adults");
    assert.equal(net.calls.length, fetched);
    assert.equal(llm.calls.length, 0);

    const byDoi = await call(env, "POST", "v1/projects/" + pid + "/paper-card", "tok-alice", {
      link: "https://doi.org/10.1000/SYNTH.1",
    });
    assert.equal(byDoi.http, 200, JSON.stringify(byDoi));
    assert.equal(byDoi.card.method, "cache");
    assert.equal(net.calls.length, fetched);
  });

  test("a page with no id is read only for citation meta; IP literals are not fetched", async () => {
    resetLlm();
    net.calls.length = 0;
    net.articles.set("777", articleXml({
      pmid: "777", title: "Meta page study", year: 2022, authors: ["Adeyemi FO"],
      sections: [{ label: "", text: "A short note with no numbers." }],
      doi: "10.1000/meta.1",
    }));
    net.pages.set("https://journal.example/view/1",
      "<html><head><meta name=\"citation_doi\" content=\"10.1000/meta.1\">" +
      "<meta name=\"dc.identifier\" content=\"doi:10.9999/ignore\">" +
      "<meta name=\"citation_pmid\" content=\"777\"></head>" +
      "<body>The body mentions 10.8888/body.only and must be ignored.</body></html>");
    const env = freshEnv();
    const project = await makeProject(env);
    const blocked = [
      "https://127.0.0.1/paper",
      "https://localhost/secret",
      "https://8.8.8.8/x",
      "https://192.168.1.5/a",
      "https://[::1]/a",
    ];
    for (const link of blocked) {
      const before = net.calls.length;
      const r = await call(env, "POST", "v1/projects/" + project.id + "/paper-card", "tok-alice", { link });
      assert.equal(r.http, 400, link + " " + JSON.stringify(r));
      assert.equal(r.error.code, "link_unrecognised");
      assert.equal(net.calls.length, before, link);
    }
    const junk = await call(env, "POST", "v1/projects/" + project.id + "/paper-card", "tok-alice", { link: "not a study link" });
    assert.equal(junk.http, 400);
    assert.equal(junk.error.code, "link_unrecognised");
    assert.equal(junk.error.message, "Paste a PubMed, DOI, PMC or journal article link (a link to one study).");

    const page = await call(env, "POST", "v1/projects/" + project.id + "/paper-card", "tok-alice", {
      link: "https://journal.example/view/1",
    });
    assert.equal(page.http, 200, JSON.stringify(page));
    assert.equal(page.card.pmid, "777");
    assert.equal(page.card.doi, "10.1000/meta.1");
    assert.equal(page.card.title, "Meta page study");
    assert.equal(page.card.method, "api");
    assert.equal(page.card.tokensUsed, 0);
    assert.ok(net.calls.some((u) => u === "https://journal.example/view/1"));
    assert.equal(net.calls.filter((u) => u.includes("10.8888") || u.includes("10.9999")).length, 0);
  });

  test("no PMID falls through to Crossref and strips JATS tags", async () => {
    resetLlm();
    net.calls.length = 0;
    net.crossref.set("10.1000/only.crossref", {
      DOI: "10.1000/only.crossref",
      title: ["Crossref only study"],
      author: [{ family: "Okoye", given: "Ada" }],
      published: { "date-parts": [[2019]] },
      "container-title": ["Crossref Journal"],
      abstract: "<jats:p>We included 80 patients. The risk ratio was 0.50 (95% CI 0.30 to 0.70).</jats:p>",
    });
    const env = freshEnv();
    const project = await makeProject(env);
    const r = await call(env, "POST", "v1/projects/" + project.id + "/paper-card", "tok-alice", {
      link: "doi:10.1000/only.crossref",
    });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(r.card.pmid, "");
    assert.equal(r.card.doi, "10.1000/only.crossref");
    assert.equal(r.card.title, "Crossref only study");
    assert.equal(r.card.journal, "Crossref Journal");
    assert.equal(r.card.year, 2019);
    assert.deepEqual(r.card.authors, ["Okoye Ada"]);
    assert.equal(r.card.structured, false);
    assert.equal(r.card.design, null);
    assert.equal(r.card.sampleSize.n, 80);
    assert.equal(r.card.sections[0].text.includes("<jats"), false);
    assert.equal(r.card.sections[0].text.includes("80 patients"), true);
    assert.equal(r.card.findings.length, 1);
    assert.equal(r.card.findings[0].measure, "RR");
    assert.equal(r.card.findings[0].estimate, 0.5);
    assert.equal(r.card.findings[0].quote, "The risk ratio was 0.50 (95% CI 0.30 to 0.70).");
    assert.equal(r.card.method, "api");
    assert.equal(r.card.tokensUsed, 0);
    assert.equal(llm.calls.length, 0);
  });

  test("mesh cohort is used when publication type has no design", async () => {
    net.articles.set("888", articleXml({
      pmid: "888", title: "Followed over time", year: 2018, authors: ["Iyer PS"],
      types: ["Journal Article"], mesh: ["Cohort Studies"],
      sections: [{ label: "BACKGROUND", text: "People were followed." }],
    }));
    const env = freshEnv();
    const project = await makeProject(env);
    const r = await call(env, "POST", "v1/projects/" + project.id + "/paper-card", "tok-alice", { link: "888" });
    assert.equal(r.http, 200, JSON.stringify(r));
    assert.equal(r.card.design.key, "cohort");
    assert.equal(r.card.design.source, "mesh");
    assert.equal(r.card.design.label.includes("Cohort study"), true);
    assert.equal(r.card.structured, true);
  });

  test("outsider is 404 and a viewer can read but cannot explain", async () => {
    resetLlm();
    seedTrial();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    fundWallet(env, "bob@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;
    const out = await call(env, "POST", "v1/projects/" + pid + "/paper-card", "tok-eve", { link: "31535829" });
    assert.equal(out.http, 404);
    assert.equal(out.error.code, "project_not_found");
    const outExplain = await call(env, "POST", "v1/projects/" + pid + "/paper-card/explain", "tok-eve", { pmid: "31535829" });
    assert.equal(outExplain.http, 404);
    assert.equal(outExplain.error.code, "project_not_found");
    assert.equal(llm.calls.length, 0);

    await setRole(env, pid, "viewer");
    const read = await call(env, "POST", "v1/projects/" + pid + "/paper-card", "tok-bob", { link: "31535829" });
    assert.equal(read.http, 200, JSON.stringify(read));
    assert.equal(read.card.pmid, "31535829");
    const denied = await call(env, "POST", "v1/projects/" + pid + "/paper-card/explain", "tok-bob", { pmid: "31535829" });
    assert.equal(denied.http, 403, JSON.stringify(denied));
    assert.equal(denied.error.code, "not_member");
    assert.equal(llm.calls.length, 0);
  });

  test("explain is refused when the card is already summarised, 402s on an empty wallet, and drops a number that is not in the abstract", async () => {
    resetLlm();
    seedTrial();
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    const pid = project.id;
    const card = await call(env, "POST", "v1/projects/" + pid + "/paper-card", "tok-alice", { link: "31535829" });
    assert.equal(card.http, 200, JSON.stringify(card));
    const refused = await call(env, "POST", "v1/projects/" + pid + "/paper-card/explain", "tok-alice", { pmid: "31535829" });
    assert.equal(refused.http, 400, JSON.stringify(refused));
    assert.equal(refused.error.code, "not_needed");
    assert.equal(refused.error.message, "This study is already summarised for free.");
    assert.equal(llm.calls.length, 0);

    const poor = freshEnv();
    const poorProject = await makeProject(poor);
    putCard(poor, plainCard());
    const unpaid = await call(poor, "POST", "v1/projects/" + poorProject.id + "/paper-card/explain", "tok-alice", { pmid: "42" });
    assert.equal(unpaid.http, 402, JSON.stringify(unpaid));
    assert.equal(unpaid.error.code, "insufficient_credits");
    assert.equal(unpaid.error.message, "You need more MaiK tokens");
    assert.equal(llm.calls.length, 0);

    const paid = freshEnv();
    fundWallet(paid, "alice@example.com", 100);
    const paidProject = await makeProject(paid);
    const stored = plainCard();
    stored.sections[0].text = stored.sections[0].text + " " + ("word ".repeat(2000));
    putCard(paid, stored);
    resetLlm(async () => JSON.stringify({
      population: "Adults",
      intervention: "Drug A",
      comparison: "Usual care",
      outcome: "Recovery",
      design: "A plain series",
      mainResult: "Recovery was 99 percent, and 12 of 30 improved.",
      conclusion: "Drug A was associated with recovery.",
    }));
    const explained = await call(paid, "POST", "v1/projects/" + paidProject.id + "/paper-card/explain", "tok-alice", {
      doi: "10.1000/plain.42",
    });
    assert.equal(explained.http, 200, JSON.stringify(explained));
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].maxTokens, 350);
    assert.equal(llm.calls[0].opts.temperature, 0);
    const prompt = llm.calls[0].parts[0].text;
    assert.ok(prompt.length <= 3000);
    assert.ok(prompt.includes("Adults received drug A"));
    assert.equal(prompt.includes("Should Not Be Sent"), false);
    assert.equal(explained.card.ai.population, "Adults");
    assert.equal(explained.card.ai.mainResult, undefined);
    assert.equal(explained.card.ai.conclusion, "Drug A was associated with recovery.");
    assert.equal(explained.card.tokensUsed, 0);
    assert.equal(typeof explained.model, "string");
    assert.equal(typeof explained.costInr, "number");
    const saved = JSON.parse(sql(paid).prepare("SELECT card_json FROM research_paper_cards WHERE cache_key='pmid:42'").get().card_json);
    assert.equal(saved.ai.mainResult, undefined);
    assert.equal(saved.ai.population, "Adults");

    resetLlm(async () => "{\"population\":\"Again\"}");
    const second = await call(paid, "POST", "v1/projects/" + paidProject.id + "/paper-card/explain", "tok-alice", { pmid: "42" });
    assert.equal(second.http, 200, JSON.stringify(second));
    assert.equal(llm.calls.length, 0);
    assert.equal(second.costInr, 0);
    assert.equal(second.card.ai.population, "Adults");
  });
});
