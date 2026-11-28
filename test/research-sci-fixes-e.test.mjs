import "./helpers/json-import-attr.mjs";
/* ResearchMD sci-fix-E tests:
 * 1. Canonical reporting template section order across server API, DOCX export,
 *    and Manuscript sidebar/DOM.
 * 2. Master Chart "Use in my manuscript": human column labels (e.g. death_28d ->
 *    "death by 28 days"), group sizes + events (%) for categorical compares,
 *    means/SD or medians/IQR + n for numeric, and no duplicated chi-square sentence.
 * 3. AI draft input for primary studies includes Plan, Protocol, Randomise,
 *    CONSORT, IEC, and CTRI details without false PHI blocking and preserves
 *    strict number grounding.
 *
 * Run:
 *   node --test --experimental-test-module-mocks --experimental-sqlite test/research-sci-fixes-e.test.mjs
 */
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { fileURLToPath } from "node:url";

let SKIP_SQLITE = false;
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  SKIP_SQLITE = true;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const CLAIMS = {
  "tok-alice": { sub: "u-alice", email: "alice@example.com", email_verified: true },
  "tok-eve": { sub: "u-eve", email: "eve@example.com", email_verified: true },
};
const llm = { calls: [], impl: async () => "{}" };

if (!SKIP_SQLITE) {
  const realAuth = await import("../functions/_fbauth.js");
  mock.module("../functions/_fbauth.js", {
    namedExports: { ...realAuth, verifyFirebaseClaims: async (token) => CLAIMS[token] || null },
  });
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
}

const { onRequest } = SKIP_SQLITE ? { onRequest: null } : await import("../functions/api/research/[[path]].js");

function makeMemoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(read("functions/db/research_schema.sql"));
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
  const D = makeMemoryDb();
  const env = {
    RESEARCH_MODE: "pilot",
    RESEARCH_DB: D,
    RESEARCH_CONTACT_EMAIL: "support@example.com",
    RESEARCH_CALLBACK_SECRET: "test-secret",
    MAIK_KV: kvShim(),
  };
  env.MAIK_KV._m.set("maik:credit:em:alice@example.com", JSON.stringify({ balance: 100, day: "", chargedToday: 0 }));
  return env;
}

async function call(env, method, sub, token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const req = new Request("https://stewardmd.in/api/research/" + sub, {
    method,
    headers,
    ...(payload !== undefined ? { body: payload } : {}),
  });
  const res = await onRequest({ request: req, env, params: { path: sub.split("?")[0].split("/").filter(Boolean) } });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { http: res.status, ...(data || {}) };
}

describe("Item 1: Canonical reporting template section order", () => {
  test("client sortSections and DOCX export order IMRaD and Case Report sections canonically", () => {
    const win = {
      document: {
        head: { appendChild: () => {} },
        body: { contains: () => true },
        getElementById: () => null,
        createElement: () => ({ style: {}, setAttribute: () => {} }),
      },
      SMD_RESEARCH: {
        screens: {},
        store: { getProject: () => null, getActiveProject: () => null, getState: () => ({ runs: {} }) },
        api: { request: () => Promise.resolve({}) },
      },
    };
    win.window = win;
    win.self = win;
    vm.runInNewContext(read("research-screen-manuscript.js"), win);
    const manScreen = win.SMD_RESEARCH.screens.manuscript;

    // 1. Out-of-order IMRaD (Results saved before Abstract; Discussion before Methods)
    const sortedImrad = manScreen._sortSections([
      { id: "results", heading: "Results", level: 1, text: "R" },
      { id: "discussion", heading: "Discussion", level: 1, text: "D" },
      { id: "abstract", heading: "Abstract", level: 1, text: "A" },
      { id: "methods", heading: "Methods", level: 1, text: "M" },
      { id: "introduction", heading: "Introduction", level: 1, text: "I" },
    ]);
    assert.deepEqual(Array.from(sortedImrad.map((s) => s.id)), ["abstract", "introduction", "methods", "results", "discussion"]);

    // 2. Out-of-order Case Report with Title + Case Presentation + Timeline + Conclusion
    const sortedCase = manScreen._sortSections([
      { id: "conclusion", heading: "Conclusion", level: 1, text: "C" },
      { id: "timeline", heading: "Timeline", level: 1, text: "T" },
      { id: "discussion", heading: "Discussion", level: 1, text: "D" },
      { id: "casePresentation", heading: "Case Presentation", level: 1, text: "CP" },
      { id: "abstract", heading: "Abstract", level: 1, text: "A" },
      { id: "title", heading: "Title Page", level: 1, text: "TP" },
      { id: "introduction", heading: "Introduction", level: 1, text: "I" },
    ]);
    assert.deepEqual(
      Array.from(sortedCase.map((s) => s.id)),
      ["title", "abstract", "introduction", "casePresentation", "timeline", "discussion", "conclusion"]
    );

    // 3. Level-2 subsections stay attached under their parent
    const sortedWithSub = manScreen._sortSections([
      { id: "results", heading: "Results", level: 1, text: "R" },
      { id: "methods", heading: "Methods", level: 1, text: "M" },
      { id: "methods-stats", heading: "Statistical Analysis", level: 2, text: "MS" },
      { id: "abstract", heading: "Abstract", level: 1, text: "A" },
    ]);
    assert.deepEqual(Array.from(sortedWithSub.map((s) => s.id)), ["abstract", "methods", "methods-stats", "results"]);

    // 4. DOCX bytes contain sections in template order even when input array is reversed
    const docxBytes = win.SMD_RESEARCH.docxFromSections("Test Paper", [
      { id: "results", heading: "Results", text: "MARKER_RESULTS" },
      { id: "discussion", heading: "Discussion", text: "MARKER_DISCUSSION" },
      { id: "abstract", heading: "Abstract", text: "MARKER_ABSTRACT" },
      { id: "methods", heading: "Methods", text: "MARKER_METHODS" },
      { id: "introduction", heading: "Introduction", text: "MARKER_INTRO" },
    ]);
    const xmlStr = Buffer.from(docxBytes).toString("utf8");
    const iAbs = xmlStr.indexOf("MARKER_ABSTRACT");
    const iInt = xmlStr.indexOf("MARKER_INTRO");
    const iMet = xmlStr.indexOf("MARKER_METHODS");
    const iRes = xmlStr.indexOf("MARKER_RESULTS");
    const iDis = xmlStr.indexOf("MARKER_DISCUSSION");
    assert.ok(iAbs > 0 && iAbs < iInt && iInt < iMet && iMet < iRes && iRes < iDis, "DOCX sections must be in IMRaD order");
  });

  test("server GET /manuscript returns sections in reporting template order regardless of PUT save order", { skip: SKIP_SQLITE }, async () => {
    const env = freshEnv();
    const pr = await call(env, "POST", "v1/projects", "tok-alice", { title: "RCT Save Order", studyType: "rct" });
    assert.equal(pr.http, 201, JSON.stringify(pr));
    const pid = pr.project.id;

    // Save Results first (like Master Chart "Use in my manuscript"), then Discussion, Methods, Introduction, Abstract
    for (const [sid, heading, text] of [
      ["results", "Results", "Outcome occurred in 10 of 50."],
      ["discussion", "Discussion", "Interpretation."],
      ["methods", "Methods", "Trial design."],
      ["introduction", "Introduction", "Background."],
      ["abstract", "Abstract", "Summary."],
    ]) {
      const r = await call(env, "PUT", `v1/projects/${pid}/manuscript/sections/${sid}`, "tok-alice", { version: 1, heading, text });
      assert.equal(r.http, 200, JSON.stringify(r));
    }

    const man = await call(env, "GET", `v1/projects/${pid}/manuscript`, "tok-alice");
    assert.equal(man.http, 200);
    assert.deepEqual(
      man.manuscript.sections.map((s) => s.id),
      ["abstract", "introduction", "methods", "results", "discussion"]
    );
  });
});

describe("Item 2: Master Chart human labels, group sizes/events, and no duplicated chi-square", () => {
  function loadMasterChartSandbox() {
    const ls = new Map();
    const win = {
      document: {
        head: { appendChild: () => {} },
        getElementById: () => null,
        createElement: () => ({ style: {}, setAttribute: () => {} }),
      },
      localStorage: {
        getItem: (k) => (ls.has(k) ? ls.get(k) : null),
        setItem: (k, v) => ls.set(k, String(v)),
      },
      SMD_RESEARCH: {
        screens: {},
        store: { getProject: () => ({ id: "p1", title: "Test", studyType: "rct" }), getActiveProject: () => null },
      },
    };
    win.window = win;
    win.self = win;
    vm.runInNewContext(read("research-stats.js"), win);
    vm.runInNewContext(read("research-screen-masterchart.js"), win);
    return win;
  }

  test("humanColumnLabel converts underscores and units cleanly", () => {
    const win = loadMasterChartSandbox();
    const lbl = win.SMD_RESEARCH.screens.masterchart._humanColumnLabel;
    assert.equal(lbl("death_28d"), "death by 28 days");
    assert.equal(lbl("mortality_30d"), "mortality by 30 days");
    assert.equal(lbl("smoking"), "smoking");
    assert.equal(lbl("creatinine_mg_dl"), "creatinine (mg/dL)");
    assert.equal(lbl("hospital_stay_days"), "hospital stay (days)");
    assert.equal(lbl("HbA1c at 12 weeks"), "HbA1c at 12 weeks");
  });

  test("categorical RCT and case-control manuscriptText include group counts/percentages without duplicated chi-square", () => {
    const win = loadMasterChartSandbox();
    const S = win.SMD_RESEARCH_STATS;
    const mc = win.SMD_RESEARCH.screens.masterchart;
    const lbl = mc._humanColumnLabel;

    // RECOVERY RCT: 482/2104 vs 1110/4321
    const rctY = Array(482).fill("yes").concat(Array(1622).fill("no"), Array(1110).fill("yes"), Array(3211).fill("no"));
    const rctG = Array(2104).fill("Dexamethasone").concat(Array(4321).fill("Usual care"));
    const rctRes = S.compare(rctY, rctG, { outcomeType: "binary", paired: false, studyType: "rct" });
    const rctSent = S.resultsSentence(rctRes, { outcome: lbl("death_28d"), groupLabels: ["Dexamethasone", "Usual care"], studyType: "rct", includeN: true });
    const rctText = mc._manuscriptTextFor({
      kind: "compare",
      group: "arm",
      items: [{ name: "death_28d", label: lbl("death_28d"), result: rctRes, sentence: rctSent, studyDesign: "rct" }],
      paragraph: rctSent,
    });
    assert.match(rctText, /death by 28 days/i);
    assert.doesNotMatch(rctText, /death_28d/);
    assert.match(rctText, /482 of 2104 \(22\.9%\)/);
    assert.match(rctText, /1110 of 4321 \(25\.7%\)/);
    assert.match(rctText, /risk ratio 0\.89/);
    assert.equal((rctText.match(/Chi-square/gi) || []).length, 1, "no duplicated chi-square sentence");

    // Case-Control: 647/649 vs 622/649
    const ccY = Array(647).fill("yes").concat(Array(2).fill("no"), Array(622).fill("yes"), Array(27).fill("no"));
    const ccG = Array(649).fill("Case").concat(Array(649).fill("Control"));
    const ccRes = S.compare(ccY, ccG, { outcomeType: "binary", paired: false, studyType: "case-control" });
    const ccSent = S.resultsSentence(ccRes, { outcome: lbl("smoking"), groupLabels: ["Case", "Control"], studyType: "case-control", includeN: true });
    const ccText = mc._manuscriptTextFor({
      kind: "compare",
      group: "group",
      items: [{ name: "smoking", label: lbl("smoking"), result: ccRes, sentence: ccSent, studyDesign: "case-control" }],
      paragraph: ccSent,
    });
    assert.match(ccText, /647 of 649 \(99\.7%\)/);
    assert.match(ccText, /622 of 649 \(95\.8%\)/);
    assert.match(ccText, /odds ratio 14\.04/);
    assert.equal((ccText.match(/Chi-square|chi2/gi) || []).length, 1, "no duplicated chi-square sentence in case-control");

    // Numeric compare with includeN: true keeps means/SD and adds group sizes
    const numRes = S.compare([10, 12, 14, 20, 22, 24], ["A", "A", "A", "B", "B", "B"], { outcomeType: "numeric" });
    const numSent = S.resultsSentence(numRes, { outcome: lbl("hospital_stay_days"), groupLabels: ["A", "B"], includeN: true });
    assert.match(numSent, /hospital stay \(days\)/);
    assert.match(numSent, /n = 3/);
    assert.match(numSent, /12\.0/);
  });
});

describe("Item 3: Primary study AI draft includes Plan/Protocol/Randomise/CONSORT/IEC/CTRI & stays number-grounded", () => {
  test("startManuscriptDraft gathers Plan, IEC, CTRI, Randomise, and CONSORT without full dates", async () => {
    const ls = new Map();
    ls.set("smd_research_plan_p1", JSON.stringify({
      aim: "two_proportions",
      ssInputs: { p1: 0.229, p2: 0.257, alpha: 0.05, power: 0.80, ratio: 1, dropout: 0.10 },
      iecData: { design: "Open-label factorial RCT", inclusion: "Hospitalised adults with COVID-19" },
      ctriData: { intervention: "Dexamethasone 6 mg daily", comparator: "Usual care", primaryOutcomeName: "28-day mortality" },
    }));
    const rmdRecords = {
      "iec|iec": { status: "approved", reference: "IEC/2021/REC-01", date: "2020-03-19" },
      "ctri|registration": { status: "registered", ctriNumber: "CTRI/2020/03/024100", date: "2020-03-19" },
      "randomfingerprint|main": { arms: ["Dexamethasone", "Usual care"], n: 100, ratio: "1:1", blockSizes: "4, 6" },
      "blinding|blinding": { unblinded: true, reason: "open-label pragmatic trial", paragraph: "Nobody was blinded, because open-label pragmatic trial." },
      "consort|flow": { assessed: 150, excluded: 50, randomised: 100, nameA: "Dexamethasone", allocatedA: 50, analysedA: 50, nameB: "Usual care", allocatedB: 50, analysedB: 50 },
    };
    const posted = [];
    const win = {
      document: {
        head: { appendChild: () => {} },
        body: { contains: () => true },
        getElementById: () => null,
        createElement: () => ({ style: {}, setAttribute: () => {} }),
      },
      localStorage: {
        getItem: (k) => (ls.has(k) ? ls.get(k) : null),
        setItem: (k, v) => ls.set(k, String(v)),
      },
      RMDStore: {
        get: async (_pid, kind, id) => rmdRecords[kind + "|" + id] || null,
      },
      SMD_RESEARCH: {
        screens: {},
        store: {
          getProject: () => ({ id: "p1", serverId: "p1", title: "RECOVERY RCT", studyType: "Randomized Controlled Trial" }),
          getActiveProject: () => ({ id: "p1", serverId: "p1", title: "RECOVERY RCT", studyType: "Randomized Controlled Trial" }),
          getState: () => ({ runs: {} }),
        },
        api: {
          request: async (method, url, body) => {
            posted.push({ method, url, body });
            return { draft: { title: "RECOVERY RCT", sections: [{ id: "methods", heading: "Methods", text: "OK" }] } };
          },
        },
      },
    };
    win.window = win;
    win.self = win;
    vm.runInNewContext(read("research-samplesize.js"), win);
    vm.runInNewContext(read("research-screen-manuscript.js"), win);

    await win.SMD_RESEARCH.screens.manuscript._startManuscriptDraft();
    assert.equal(posted.length, 1);
    const inp = posted[0].body.input;
    assert.equal(inp.plan.aim, "two_proportions");
    assert.ok(inp.plan.sampleSize.totalWithDropout > 0, "sample size computed from Plan");
    assert.equal(inp.iec.reference, "IEC/2021/REC-01");
    assert.equal(inp.iec.approvalDate, "March 2020");
    assert.equal(inp.ctri.ctriNumber, "CTRI/2020/03/024100");
    assert.equal(inp.ctri.registrationDate, "March 2020");
    assert.equal(inp.randomise.ratio, "1:1");
    assert.equal(inp.consort.randomised, 100);
    assert.doesNotMatch(JSON.stringify(inp), /2020-03-19/, "no full YYYY-MM-DD dates sent in AI input");
    assert.match(inp.notes, /IEC\/2021\/REC-01/);
    assert.match(inp.notes, /CTRI\/2020\/03\/024100/);
    assert.match(inp.notes, /Sample size:/);
  });

  test("server manuscript_draft includes Plan/IEC/CTRI/Randomise/CONSORT in prompt, passes PHI gate, and grounds numbers", { skip: SKIP_SQLITE }, async () => {
    const env = freshEnv();
    const pr = await call(env, "POST", "v1/projects", "tok-alice", {
      title: "Dexamethasone in hospitalised COVID-19: RCT report",
      studyType: "Randomized Controlled Trial",
    });
    assert.equal(pr.http, 201, JSON.stringify(pr));
    const pid = pr.project.id;
    llm.calls.length = 0;

    llm.impl = async () => JSON.stringify({
      title: "Dexamethasone in hospitalised COVID-19: RCT report",
      sections: [
        { id: "abstract", heading: "Abstract", text: "With 80% power and 0.05 alpha, mortality was 482 of 2104 (22.9%) vs 1110 of 4321 (25.7%), though fake 999 appeared." },
        { id: "introduction", heading: "Introduction", text: "Background." },
        { id: "methods", heading: "Methods", text: "Approved by IEC/2021/REC-01 and registered on CTRI/2020/03/024100. Block randomisation 1:1 with blocks 4, 6." },
        { id: "results", heading: "Results", text: "Mortality was 482 of 2104 (22.9%) vs 1110 of 4321 (25.7%), RR 0.89 (95% CI 0.81 to 0.98, p = 0.017)." },
        { id: "discussion", heading: "Discussion", text: "Lower 28-day mortality." },
      ],
    });

    const res = await call(env, "POST", `v1/projects/${pid}/ai-draft`, "tok-alice", {
      task: "manuscript_draft",
      input: {
        title: "Dexamethasone in hospitalised COVID-19: RCT report",
        studyType: "Randomized Controlled Trial",
        researchQuestion: "Does dexamethasone 6 mg daily reduce 28-day mortality?",
        resultsText: "The risk of death by 28 days was 482 of 2104 (22.9%) in Dexamethasone vs 1110 of 4321 (25.7%) in Usual care (risk ratio 0.89, 95% CI 0.81 to 0.98; Chi-square test, p = 0.017).",
        plan: { aim: "two_proportions", ssInputs: { p1: 0.229, p2: 0.257, alpha: 0.05, power: 0.80, dropout: 0.10 }, sampleSize: { totalWithDropout: 11520 } },
        iec: { status: "approved", reference: "IEC/2021/REC-01", approvalDate: "2020-03-19" },
        ctri: { status: "registered", ctriNumber: "CTRI/2020/03/024100", registrationDate: "2020-03-19" },
        randomise: { arms: ["Dexamethasone", "Usual care"], ratio: "1:1", blockSizes: "4, 6" },
        consort: { assessed: 6500, excluded: 75, randomised: 6425 },
      },
    });

    assert.equal(res.http, 200, JSON.stringify(res));
    assert.equal(llm.calls.length, 1);
    const sentPrompt = llm.calls[0].parts[0].text;
    assert.match(sentPrompt, /IEC\/2021\/REC-01/);
    assert.match(sentPrompt, /CTRI\/2020\/03\/024100/);
    assert.match(sentPrompt, /two_proportions/);
    assert.match(sentPrompt, /6425/);
    assert.doesNotMatch(sentPrompt, /2020-03-19/, "server scrubs full dates before PHI scan/prompt");

    const abs = res.draft.sections.find((s) => s.id === "abstract");
    assert.match(abs.text, /80%/, "grounded power from Plan kept in Abstract");
    assert.match(abs.text, /482/, "grounded event count kept in Abstract");
    assert.doesNotMatch(abs.text, /999/, "ungrounded number stripped from Abstract");
  });
});
