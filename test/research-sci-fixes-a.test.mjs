import "./helpers/json-import-attr.mjs";
/* Unit and integration tests for ResearchMD sci-fix-A (items 1-10).
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-sci-fixes-a.test.mjs
 */
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) {}
const SKIP_SQLITE = DatabaseSync ? false : "node:sqlite unavailable";

const require = createRequire(import.meta.url);

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
  "tok-eve": { sub: "u-eve", email: "eve@example.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifyFirebaseClaims: async (token) => CLAIMS[token] || null,
    verifiedClaimsFor: async (request) => CLAIMS[((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""))] || null,
  },
});

const llm = { calls: [], impl: async () => "{}" };
mock.module("../functions/api/ai/[[path]].js", {
  namedExports: {
    callGemini: async (env, parts, maxTokens, opts) => {
      llm.calls.push({ parts, maxTokens, opts });
      if (opts && opts.meta) {
        opts.meta.usage = { promptTokenCount: 50, candidatesTokenCount: 30, thoughtsTokenCount: 0 };
        opts.meta.model = opts.model;
      }
      return llm.impl(env, parts, maxTokens, opts);
    },
  },
});

mock.module("../functions/api/billing/[[path]].js", {
  namedExports: {
    onRequest: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    plans: () => ({ tokens: {} }),
    fulfilPurchase: async () => ({ ok: true }),
  },
});

const { onRequest } = await import("../functions/api/research/[[path]].js");
const { gateManuscript } = await import("../functions/api/research/_manuscript.js");
const { search: epmcSearch } = await import("../functions/api/research/_connectors/europepmc.js");
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
function r2Shim() {
  const objects = new Map();
  return {
    _objects: objects,
    async put(key, value) { objects.set(key, typeof value === "string" ? value : new TextDecoder().decode(value)); },
    async get(key) {
      if (!objects.has(key)) return null;
      const text = objects.get(key);
      return { text: async () => text, json: async () => JSON.parse(text) };
    },
  };
}
function freshEnv(extra) {
  const D = d1();
  D._db.exec(SCHEMA);
  const env = {
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_R2: r2Shim(),
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_CALLBACK_SECRET: "test-secret",
    MAIK_KV: kvShim(),
    ...(extra || {}),
  };
  env.MAIK_KV._m.set("maik:credit:em:alice@example.com", JSON.stringify({ balance: 100, day: "", chargedToday: 0 }));
  return env;
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

describe("Item 1: Forest plot single-exponentiation and non-overlapping columns", () => {
  test("generateForestPlotSvg keeps display-scale study CIs without double Math.exp and widens SVG", () => {
    globalThis.window = globalThis;
    globalThis.document = {
      head: { appendChild: () => {} },
      body: { contains: () => true },
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute: () => {}, getContext: () => null }),
    };
    const SMD = require("../research.js");
    globalThis.SMD_RESEARCH = SMD;
    globalThis.SMD_RESEARCH_ENGINE = require("../research-engine.js");
    require("../research-screen-run.js");
    const engine = globalThis.SMD_RESEARCH_ENGINE;
    const studies = [
      {
        id: "s1",
        label: "Aronson North American Infant BCG Trial 1948",
        inputs: { events1: 4, n1: 123, events2: 11, n2: 139 },
        verified: true,
      },
      {
        id: "s2",
        label: "Comstock 1976",
        inputs: { events1: 27, n1: 16913, events2: 29, n2: 17854 },
        verified: true,
      },
    ];
    const runOut = engine.run({ measure: "RR", model: "random_dl", test: "wald", level: 0.95, studies: studies.map((s) => Object.assign({ id: s.id, verified: true }, s.inputs)) });
    const svg = SMD.screens.run.generateForestPlotSvg(runOut, { measure: "RR", model: "random_dl", level: 0.95 }, studies);

    assert.match(svg, /viewBox="0 0 1040 /);
    // Comstock 1976 RR ~0.98 with single-exponentiated CI ~[0.58, 1.66], NOT [1.79, 5.26].
    assert.match(svg, /0\.98 \[0\.58, 1\.66\]/);
    assert.doesNotMatch(svg, /1\.79, 5\.26/);
    // Long labels are truncated to avoid overlapping data columns.
    assert.doesNotMatch(svg, /Aronson North American Infant BCG Trial 1948/);
    assert.match(svg, /\.\.\./);
  });
});

describe("Item 2: PaperOrchestra ratio token scale and LaTeX/prose typography", () => {
  test("client buildTokenTable exponentiates nested engine log-scale ratio bounds & resolves aliases", () => {
    const PO = require("../research-po-gates.js");
    const runs = [{
      runId: "r1",
      measure: "RR",
      method: "random",
      result: {
        pooled: { effect: Math.log(0.49), ciLower: Math.log(0.34), ciUpper: Math.log(0.70), se: 0.18 },
        heterogeneity: { i2: 72.8, tau2: 0.36, q: 44.1, df: 12, p: 0.0001 },
        k: 13,
      },
    }];
    const table = PO.buildTokenTable(runs);
    assert.ok(Math.abs(table["r1.pooled.effect"].value - 0.49) < 0.01);
    assert.ok(Math.abs(table["r1.pooled.ciLower"].value - 0.34) < 0.01);
    assert.ok(Math.abs(table["r1.pooled.ciUpper"].value - 0.70) < 0.01);
    assert.ok(Math.abs(table["r1.estimate"].value - 0.49) < 0.01);
    assert.ok(Math.abs(table["r1.ciLower"].value - 0.34) < 0.01);

    const gateRes = PO.runGates([
      { id: "results", heading: "Results", text: "BCG significantly reduced TB risk (RR {{run:r1.estimate}}, 95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}, I2 {{run:r1.i2}})." },
    ], table, {}, { protocol: { outcomes: ["TB"] }, runs });
    assert.deepEqual(gateRes, []);
  });

  test("latexToText converts Greek symbols, normalizes double hyphens, keeps URLs/tables, and strips % after i2", () => {
    const PO = require("../research-po-gates.js");
    const out = PO.latexToText("Heterogeneity $\\tau^2$ was {{run:r1.i2}}%; effect -- see https://example.com/a--b --- overall.\n| a | b |\n| --- | --- |");
    assert.match(out, /τ\^2|τ/);
    assert.match(out, /\{\{run:r1\.i2\}\}[^%]/);
    assert.match(out, /https:\/\/example\.com\/a--b/);
    assert.match(out, /\| --- \| --- \|/);
    assert.doesNotMatch(out, /effect -- see/);
    assert.match(out, /b - overall/);
  });

  test("server gateManuscript resolves nested ratio runs and aliases cleanly", () => {
    const table = {
      "r1.pooled.effect": { value: 0.49, null: 1, measure: "RR", runId: "r1" },
      "r1.pooled.ciLower": { value: 0.34, null: 1, measure: "RR", runId: "r1" },
      "r1.pooled.ciUpper": { value: 0.70, null: 1, measure: "RR", runId: "r1" },
      "r1.pooled.p": { value: 0.0001, null: 1, measure: "RR", runId: "r1" },
      "r1.heterogeneity.i2": { value: 92.2, null: 1, measure: "RR", runId: "r1" },
      "r1.heterogeneity.p": { value: 0.0001, null: 1, measure: "RR", runId: "r1" },
    };
    const out = gateManuscript([
      { id: "results", heading: "Results", text: "BCG significantly reduced risk (RR {{run:r1.estimate}}, 95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}, p={{run:r1.p}}, I2 {{run:r1.i2}}%)." },
    ], [], table);
    assert.equal(out.gateFailures.length, 0, JSON.stringify(out.gateFailures));
    assert.equal(out.gatesPassed, true);
  });
});

describe("Item 3: RCT/cohort RR-first vs case-control OR-only", () => {
  test("compare chooses RR-first + secondary OR for RCT/cohort and OR-only for case-control", () => {
    const STATS = require("../research-stats.js");
    const EXPLAIN = require("../research-explain.js");
    const y = ["yes","yes","yes","no","no","no","no","no","no","no","yes","no","no","no","no","no","no","no","no","no"];
    const g = ["tx","tx","tx","tx","tx","tx","tx","tx","tx","tx","ctrl","ctrl","ctrl","ctrl","ctrl","ctrl","ctrl","ctrl","ctrl","ctrl"];

    const rct = STATS.compare(y, g, { outcomeType: "binary", studyType: "rct" });
    assert.equal(rct.effect.measure, "RR");
    assert.ok(rct.effect.or > 0 && rct.effect.orCiLower > 0 && rct.effect.orCiUpper > 0);
    const rctText = STATS.resultsSentence(rct, { outcome: "events", groupLabels: ["tx", "ctrl"], studyType: "rct" });
    assert.match(rctText, /risk ratio/);
    assert.match(rctText, /odds ratio/);

    const cc = STATS.compare(y, g, { outcomeType: "binary", studyType: "case-control" });
    assert.equal(cc.effect.measure, "OR");
    assert.equal(cc.studyDesign, "case-control");
    assert.equal(cc.effect.rr, undefined);
    const ccText = STATS.resultsSentence(cc, { outcome: "exposure", groupLabels: ["tx", "ctrl"], studyType: "case-control" });
    assert.match(ccText, /cases vs controls/i);
    assert.doesNotMatch(ccText, /risk ratio/i);

    const ccExplain = EXPLAIN.effect({ measure: "OR", estimate: 2.5, ciLower: 1.2, ciUpper: 5.2, caseControl: true, outcome: "smoking" });
    assert.match(ccExplain, /cases vs controls/i);
    assert.doesNotMatch(ccExplain, /who got the treatment/i);
  });
});

describe("Items 4, 5, 8: Grounded user numbers, Primary manuscript gating & GET /manuscript 200 null", { skip: SKIP_SQLITE }, () => {
  test("GET /manuscript returns 200 null on fresh project, AI draft keeps user numbers (COVID-19, 6 mg, 28-day), and primary cohort manuscript passes export gates", async () => {
    const env = freshEnv();
    const pr = await call(env, "POST", "v1/projects", "tok-alice", {
      title: "Dexamethasone in COVID-19",
      studyType: "Cohort study",
    });
    assert.equal(pr.http, 201);
    const pid = pr.project.id;

    // Item 8: empty project returns 200 { manuscript: null }, while nonexistent explicit version stays 404.
    const initMan = await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-alice");
    assert.equal(initMan.http, 200);
    assert.equal(initMan.manuscript, null);
    const badVer = await call(env, "GET", "v1/projects/" + pid + "/manuscript?version=99", "tok-alice");
    assert.equal(badVer.http, 404);
    assert.equal(badVer.error.code, "manuscript_not_found");
    const outsider = await call(env, "GET", "v1/projects/" + pid + "/manuscript", "tok-eve");
    assert.equal(outsider.http, 404);

    // Item 4 & 5: AI manuscript draft receives user resultsText, keeps grounded user numbers, strips em-dash & ungrounded hallucination.
    llm.calls.length = 0;
    llm.impl = async () => JSON.stringify({
      title: "Dexamethasone 6 mg in COVID-19 cohort",
      sections: [
        { id: "abstract", heading: "Abstract", text: "We evaluated dexamethasone 6 mg in 160 COVID-19 patients over 28-day follow-up. Mortality was 15% vs 25%, though a fake trial showed 0.49." },
        { id: "introduction", heading: "Introduction", text: "COVID-19 severity guided 6 mg therapy\u2014including severe cases." },
        { id: "methods", heading: "Methods", text: "Retrospective cohort comparing 6 mg dexamethasone vs standard care over 28-day follow-up." },
        { id: "results", heading: "Results", text: "Of 160 patients, mortality at 28-day was 15% (12/80) vs 25% (20/80), p = 0.11." },
        { id: "discussion", heading: "Discussion", text: "Our 6 mg cohort observed lower mortality without reaching significance." },
      ],
    });
    const draftRes = await call(env, "POST", "v1/projects/" + pid + "/ai-draft", "tok-alice", {
      task: "manuscript_draft",
      input: {
        title: "Dexamethasone in COVID-19",
        researchQuestion: "Does 6 mg dexamethasone lower 28-day mortality?",
        resultsText: "160 patients, 12/80 (15%) vs 20/80 (25%), p = 0.11",
      },
    });
    assert.equal(draftRes.http, 200, JSON.stringify(draftRes));
    assert.match(draftRes.draft.sections[0].text, /COVID-19/);
    assert.match(draftRes.draft.sections[0].text, /6 mg/);
    assert.match(draftRes.draft.sections[0].text, /28-day/);
    assert.doesNotMatch(draftRes.draft.sections[0].text, /0\.49/);
    assert.equal(draftRes.draft.sections[1].text.indexOf("\u2014"), -1);
    assert.match(llm.calls[0].parts[0].text, /12\/80/);

    // Save manuscript sections and export DOCX as primary study (zero meta-analysis runs -> grounded text passes export gates!).
    for (const sec of draftRes.draft.sections) {
      const saveRes = await call(env, "PUT", "v1/projects/" + pid + "/manuscript/sections/" + sec.id, "tok-alice", {
        version: 1,
        heading: sec.heading,
        text: sec.text,
      });
      assert.equal(saveRes.http, 200, JSON.stringify(saveRes));
    }

    const expRes = await call(env, "POST", "v1/projects/" + pid + "/manuscript/export", "tok-alice", { version: 1, format: "docx" });
    assert.equal(expRes.http, 202, JSON.stringify(expRes));
    assert.equal(expRes.gatesPassed, true);
  });
});

describe("Item 6 & 9: No Drafted by MaiK prefix in text & publication consent friendlyError", () => {
  test("research-screen-manuscript source never inserts 'Drafted by MaiK' prose prefix", () => {
    const manSrc = readFileSync(new URL("../research-screen-manuscript.js", import.meta.url), "utf8");
    assert.doesNotMatch(manSrc, /markPrefix\s*=\s*"Drafted by MaiK/);
    assert.match(manSrc, /rmd-drafted-by-maik/);
  });

  test("friendlyError & errHtml map publication_consent_required and gate_failed cleanly without dashes", () => {
    const SMD = require("../research.js");
    const consentErr = SMD.p2.friendlyError({ code: "publication_consent_required", status: 409 });
    assert.equal(consentErr.message, "Confirm the patient's written consent first.");
    assert.equal(consentErr.action, "pubconsent");
    assert.equal(consentErr.actionLabel, "Open Publication consent");
    const html = SMD.p2.errHtml({ code: "publication_consent_required", status: 409 });
    assert.match(html, /data-rmd-action="pubconsent"/);
    assert.match(html, /Open Publication consent/);
    assert.equal(html.indexOf("\u2014"), -1);

    const gateErr = SMD.p2.friendlyError({ code: "gate_failed", status: 422 });
    assert.notEqual(gateErr.message, "Something went wrong on our side.");
  });
});

describe("Item 7: Offline/online study queue refuses empty-input study_create", () => {
  test("createStudy without numeric inputs does not queue study_create or post {} to /studies", () => {
    const storeSrc = {};
    globalThis.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storeSrc, k) ? storeSrc[k] : null),
      setItem: (k, v) => { storeSrc[k] = String(v); },
      removeItem: (k) => { delete storeSrc[k]; },
    };
    globalThis.window = globalThis;
    const SMD = require("../research.js");
    const STORE = require("../research-store.js");
    const reqs = [];
    SMD.api.request = async (method, path, body) => { reqs.push({ method, path, body }); return {}; };
    STORE.adoptServerProject({ id: "prj_q7", title: "Queue check", studyType: "Systematic Review" });
    STORE.createStudy("prj_q7", { label: "RefOnly 2020", inputs: {}, locator: { citation: "RefOnly 2020" } });
    const queued = STORE.getQueue().filter((item) => item.type === "study_create");
    assert.equal(queued.length, 0);
    assert.equal(reqs.filter((r) => /\/studies$/.test(r.path)).length, 0);
  });
});

describe("Item 10: Partial results on Europe PMC slow timeout + budget cap", { skip: SKIP_SQLITE }, () => {
  test("findStudies returns 200 partial results with notice when one source times out", async () => {
    const env = freshEnv({ RESEARCH_SOURCE_TIMEOUT_MS: "60" });
    const pr = await call(env, "POST", "v1/projects", "tok-alice", { title: "BCG search timeout test" });
    const pid = pr.project.id;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const s = String(url);
      if (s.includes("eutils.ncbi.nlm.nih.gov") && s.includes("esearch.fcgi")) {
        return new Response(JSON.stringify({ esearchresult: { idlist: ["111"] } }), { status: 200 });
      }
      if (s.includes("eutils.ncbi.nlm.nih.gov") && s.includes("esummary.fcgi")) {
        return new Response(JSON.stringify({
          result: { uids: ["111"], "111": { uid: "111", title: "BCG infant RCT", fulljournalname: "Lancet", pubdate: "2020", authors: [{ name: "Aronson J" }], articleids: [] } },
        }), { status: 200 });
      }
      if (s.includes("eutils.ncbi.nlm.nih.gov") && s.includes("efetch.fcgi")) {
        return new Response("<PubmedArticleSet></PubmedArticleSet>", { status: 200 });
      }
      if (s.includes("api.crossref.org")) {
        return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 });
      }
      if (s.includes("europepmc")) {
        return new Promise((_, reject) => {
          if (init && init.signal) {
            if (init.signal.aborted) return reject(new Error("Aborted"));
            init.signal.addEventListener("abort", () => reject(new Error("Aborted")));
          }
        });
      }
      return new Response("{}", { status: 404 });
    };
    try {
      const res = await call(env, "POST", "v1/projects/" + pid + "/find-studies", "tok-alice", { q: "bcg trial", limit: 20 });
      assert.equal(res.http, 200, JSON.stringify(res));
      assert.equal(res.partial, true);
      assert.deepEqual(res.failedSources, ["europe_pmc"]);
      assert.ok(res.results.length >= 1);
      assert.match(res.notice, /Europe PMC/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("europepmc.search partialOnBudget stops before deadline and preserves hitCount/liteRecords", async () => {
    let clock = 1000;
    let calls = 0;
    const res = await epmcSearch("bcg tuberculosis", {}, null, {
      contactEmail: "test@example.com",
      partialOnBudget: true,
      timeoutMs: 5000,
      now: () => clock,
      deadline: 1500,
      fetch: async () => {
        calls++;
        clock += 600; // exceed 1500ms budget after page 1
        return new Response(JSON.stringify({
          hitCount: 4360,
          nextCursorMark: "next_cursor_2",
          resultList: {
            result: [{ pmid: "111", title: "EPMC Trial 1", pubYear: "2020" }],
          },
        }), { status: 200 });
      },
    });
    assert.equal(calls, 1);
    assert.equal(res.partial, true);
    assert.equal(res.totalCount, 4360);
    assert.equal(res.ids.length, 1);
    assert.equal(res.liteRecords.length, 1);
  });
});
