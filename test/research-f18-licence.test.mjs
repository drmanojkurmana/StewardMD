import "./helpers/json-import-attr.mjs";
/* F-18: Europe PMC licence gate. Synthetic records and mocked fetch.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-f18-licence.test.mjs
 */
import { test, mock, describe } from "node:test";
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
const { fullTextAllowed } = await import("../functions/api/research/_fulltext_licence.js");
const SCHEMA = readFileSync(new URL("../functions/db/research_schema.sql", import.meta.url), "utf8");

const ABSTRACT = "Adults were followed for one year. The outcome was stable in most people.";
const FULLTEXT_SECRET = "FULLTEXT-SECRET-0.995";
const AI_REPLY = JSON.stringify({
  population: "Adults", intervention: "Usual care", comparison: "Control",
  outcome: "Recovery", design: "Cohort", mainResult: "No clear difference",
  conclusion: "No clear difference",
});

const net = { calls: [], epmc: new Map(), fullTextXml: new Map() };

function jsonRes(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
}
function textRes(s, status = 200) {
  return new Response(s, { status, headers: { "content-type": "application/xml" } });
}
globalThis.fetch = async (url) => {
  const u = String(url);
  net.calls.push(u);
  const parsed = new URL(u);
  if (u.includes("idconv")) return jsonRes({ status: "ok", records: [] });
  if (u.includes("esearch.fcgi")) return jsonRes({ esearchresult: { idlist: [] } });
  if (u.includes("ebi.ac.uk/europepmc/webservices/rest/search")) {
    const query = parsed.searchParams.get("query") || "";
    const doi = (query.match(/DOI:"([^"]+)"/) || [])[1] || "";
    const pmid = (query.match(/EXT_ID:(\d+)/) || [])[1] || "";
    const rec = net.epmc.get(doi) || net.epmc.get(pmid) || null;
    return jsonRes({ resultList: { result: rec ? [rec] : [] } });
  }
  if (u.includes("api.crossref.org/works")) return jsonRes({ message: { items: [] } });
  if (u.includes("/fullTextXML")) {
    const pmcid = (u.match(/\/(PMC\d+)\/fullTextXML/i) || ["", ""])[1].toUpperCase();
    return net.fullTextXml.has(pmcid) ? textRes(net.fullTextXml.get(pmcid)) : textRes("no", 404);
  }
  if (u.includes("efetch.fcgi")) {
    if (parsed.searchParams.get("db") === "pmc") {
      const id = String(parsed.searchParams.get("id") || "").toUpperCase();
      return net.fullTextXml.has(id) ? textRes(net.fullTextXml.get(id)) : textRes("no", 404);
    }
    return textRes("<PubmedArticleSet></PubmedArticleSet>");
  }
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
  llm.impl = impl || (async () => AI_REPLY);
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
  const r = await call(env, "POST", "v1/projects", "tok-alice", { title: "Licence gate" });
  assert.equal(r.http, 201, JSON.stringify(r));
  return r.project;
}
function putCard(env, card) {
  const now = Date.now();
  const payload = JSON.stringify(card);
  if (card.pmid) sql(env).prepare("INSERT INTO research_paper_cards (cache_key,card_json,created_ts) VALUES (?,?,?)").run("pmid:" + card.pmid, payload, now);
  if (card.doi) sql(env).prepare("INSERT INTO research_paper_cards (cache_key,card_json,created_ts) VALUES (?,?,?)").run("doi:" + card.doi, payload, now);
}
function seededEpmc(overrides) {
  return Object.assign({
    pmid: "9001", pmcid: "PMC9009001", doi: "10.1000/blocked.1",
    title: "Licence blocked study", journalTitle: "Synthetic Journal", pubYear: "2025",
    abstractText: ABSTRACT, isOpenAccess: "Y", license: "cc by-nc",
  }, overrides);
}

describe("fullTextAllowed", () => {
  test("allows only open access with a commercial-reuse licence", () => {
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", license: "cc-by" }), true);
    assert.equal(fullTextAllowed({ isOpenAccess: true, license: "CC BY 4.0" }), true);
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", license: "cc-by-sa" }), true);
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", licence: "cc0" }), true);
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", license: "public domain" }), true);
  });

  test("blocks NC, ND, missing, unknown and non-open-access records", () => {
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", license: "cc-by-nc" }), false);
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", license: "cc-by-nd" }), false);
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", license: "cc-by-nc-sa" }), false);
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", license: "" }), false);
    assert.equal(fullTextAllowed({ isOpenAccess: "Y" }), false);
    assert.equal(fullTextAllowed({ isOpenAccess: "Y", license: "open access" }), false);
    assert.equal(fullTextAllowed({ isOpenAccess: "N", license: "cc-by" }), false);
    assert.equal(fullTextAllowed({ license: "cc-by" }), false);
    assert.equal(fullTextAllowed(null), false);
  });
});

describe("paper card licence gate", { concurrency: false, skip: SKIP }, () => {
  test("a blocked record makes no fullTextXML request and its AI prompt has no full text", async () => {
    resetLlm();
    net.calls.length = 0;
    net.epmc.set("10.1000/blocked.1", seededEpmc());
    net.fullTextXml.set("PMC9009001", "<article><body><sec sec-type=\"results\"><title>Results</title><p>" + FULLTEXT_SECRET + "</p></sec></body></article>");
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);

    const cardRes = await call(env, "POST", "v1/projects/" + project.id + "/paper-card", "tok-alice", {
      link: "https://doi.org/10.1000/blocked.1",
    });
    assert.equal(cardRes.http, 200, JSON.stringify(cardRes));
    assert.equal(cardRes.card.isOpenAccess, true);
    assert.equal(cardRes.card.license, "cc by-nc");
    assert.equal(cardRes.card.fullTextResults, "");
    assert.equal(cardRes.card.findings.some((f) => f.source === "Full text"), false);
    assert.equal(net.calls.some((u) => u.includes("/fullTextXML")), false, "blocked record must not fetch full text");

    const exp = await call(env, "POST", "v1/projects/" + project.id + "/paper-card/explain", "tok-alice", {
      doi: "10.1000/blocked.1",
    });
    assert.equal(exp.http, 200, JSON.stringify(exp));
    assert.equal(llm.calls.length, 1);
    const prompt = llm.calls[0].parts[0].text;
    assert.equal(prompt.includes("Full text Results:"), false);
    assert.equal(prompt.includes(FULLTEXT_SECRET), false);
    assert.equal(exp.card.fullTextResults, "");
    assert.equal(net.calls.some((u) => u.includes("/fullTextXML")), false, "explain must not fetch blocked full text");
  });

  test("cached full text for a blocked record is not used or served", async () => {
    resetLlm();
    net.calls.length = 0;
    net.fullTextXml.set("PMC9100", "<article><body><sec sec-type=\"results\"><title>Results</title><p>" + FULLTEXT_SECRET + "</p></sec></body></article>");
    const env = freshEnv();
    fundWallet(env, "alice@example.com", 100);
    const project = await makeProject(env);
    putCard(env, {
      pmid: "9100", pmcid: "PMC9100", doi: "10.1000/cached.blocked",
      title: "Cached but blocked study", journal: "Synthetic Journal", year: 2025, authors: ["Doe J"],
      url: "https://pubmed.ncbi.nlm.nih.gov/9100/", freeFullText: true,
      isOpenAccess: true, license: "",
      design: null, sampleSize: null, structured: false,
      sections: [{ label: "", text: ABSTRACT }],
      findings: [{ format: "metric", kind: "auc", label: "AUC", value: FULLTEXT_SECRET, numbers: [0.995], quote: FULLTEXT_SECRET, source: "Full text" }],
      conclusion: ABSTRACT,
      fullTextResults: FULLTEXT_SECRET,
      mesh: [], keywords: [], extractorVersion: 2, method: "api", tokensUsed: 0,
    });

    const exp = await call(env, "POST", "v1/projects/" + project.id + "/paper-card/explain", "tok-alice", { pmid: "9100" });
    assert.equal(exp.http, 200, JSON.stringify(exp));
    assert.equal(llm.calls.length, 1);
    const prompt = llm.calls[0].parts[0].text;
    assert.equal(prompt.includes("Full text Results:"), false);
    assert.equal(prompt.includes(FULLTEXT_SECRET), false);
    assert.equal(exp.card.fullTextResults, "");
    assert.equal(exp.card.findings.some((f) => f.source === "Full text"), false);
    assert.equal(net.calls.some((u) => u.includes("/fullTextXML")), false);
  });
});