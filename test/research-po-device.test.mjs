/* ResearchMD PaperOrchestra on-device runner + Python parity tests.
 *
 * Covers:
 * - PHI scan parity against test_phi_vectors.py + test_po_phi.py (via test/fixtures/research/po/phi-vectors.json)
 * - Hard gates parity against test_po_gates.py
 * - LaTeX/IMRAD writer parity against test_po_writer.py
 * - Step runner: step order & stepIds, checkpoint after every step, resume from section 2,
 *   64-call ceiling, PHI pre-call block, 401 token refresh once, retry suffix (:r1),
 *   AI wait excluded from step timer, device-result shape
 * - UI integration: smd_rmd_ondevice_draft flag (default ON, "0" disables), progress text,
 *   "Continue draft" from saved checkpoint
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-po-device.test.mjs
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROMPTS = require("../research-po-prompts.js");
const GATES = require("../research-po-gates.js");
const CHECKPOINT = require("../research-ondevice-checkpoint.js");
const DRAFT = require("../research-ondevice-draft.js");

const PHI_FIXTURE = JSON.parse(
  fs.readFileSync(new URL("./fixtures/research/po/phi-vectors.json", import.meta.url), "utf8")
);

function makeManifest(overrides = {}) {
  return Object.assign({
    v: 1,
    projectId: "p1",
    jobId: "job_1",
    protocol: {
      title: "Intervention X for outcome Y: a systematic review",
      question: "Does X reduce Y in adults?",
      pico: { population: "adults", intervention: "X", comparator: "usual care", outcome: "Y" },
      design: "systematic review and meta-analysis",
      eligibility: "randomised trials in adults",
      outcomes: ["Y"],
      lockHash: "a".repeat(64),
      lockedAt: "2026-11-01T00:00:00Z",
    },
    evidence: [{
      studyId: "s1",
      label: "Trial One",
      source: { title: "Trial One report", doi: "10.1000/trial1", pmid: "11111111", authors: ["Smith J"], year: 2019 },
      values: [{
        field: "events_intervention", value: 12, verified: true,
        locator: { page: 4, table: "Table 2" }, quote: "12 events in the intervention arm",
      }],
    }],
    runs: [{
      runId: "r1",
      engine: "research-engine.js",
      engineVersion: "gold001",
      measure: "OR",
      method: "DL",
      result: { estimate: 0.62, ciLower: 0.41, ciUpper: 0.93, p: 0.02, k: 12, i2: 35.2 },
    }],
    references: [{
      key: "ref1", title: "Trial One report", authors: ["Smith J", "Doe A"],
      year: 2019, venue: "Journal of Examples", doi: "10.1000/trial1",
      pmid: "11111111", volume: "10", pages: "1-9",
    }],
  }, overrides);
}

const DRAFT_V0 =
  "\\section{Introduction} Outcome Y is common \\cite{ref1}.\n" +
  "\\section{Methods} We searched three databases. Two reviewers screened records.\n" +
  "\\section{Results} The intervention reduced mortality " +
  "(OR {{run:r1.estimate}}, 95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}; p {{run:r1.p}}).\n" +
  "\\section{Discussion} The pooled effect supports X \\cite{ref1}.\n";

function sectionObj(sid, text) {
  return { id: sid, heading: sid.charAt(0).toUpperCase() + sid.slice(1), text };
}

/* ==================== 1. PHI parity (test_phi_vectors.py + test_po_phi.py) ==================== */

describe("PHI scan parity with Python (test_phi_vectors.py + test_po_phi.py)", () => {
  test("shared vectors from test_phi_vectors.py produce identical verdicts", () => {
    assert.ok(PHI_FIXTURE.shared_vectors.length >= 90);
    for (const c of PHI_FIXTURE.shared_vectors) {
      const report = GATES.scanPhi(c.text, { mode: c.mode || "default" });
      if (c.expect === "block") {
        assert.equal(report.blocked, true, `${c.id} must block: ${c.text}`);
        if (!c.category.startsWith("near_miss")) {
          assert.ok(report.hits.some((h) => h.category === c.category),
            `${c.id} must hit category ${c.category}, got ${JSON.stringify(report.hits)}`);
        }
        for (const h of report.hits) {
          assert.deepEqual(Object.keys(h).sort(), ["category", "end", "rule", "start"]);
        }
      } else {
        assert.equal(report.blocked, false, `${c.id} must allow: ${c.text} hits=${JSON.stringify(report.hits)}`);
      }
    }
  });

  test("SYNTHETIC_PHI and CLEAN_TEXTS from test_po_phi.py match Python", () => {
    assert.ok(GATES.verhoeffValid(PHI_FIXTURE.valid_aadhaar));
    assert.ok(!GATES.verhoeffValid(PHI_FIXTURE.invalid_aadhaar));
    assert.ok(GATES.nhsMod11Valid("9999999999"));
    assert.ok(!GATES.nhsMod11Valid("1234567890"));

    for (const c of PHI_FIXTURE.po_phi_block) {
      const report = GATES.scanPhi(c.text, { mode: c.mode });
      assert.equal(report.blocked, true, `${c.id} must block: ${c.text}`);
      const gotCats = new Set(report.hits.map((h) => h.category));
      for (const want of c.categories) {
        assert.ok(gotCats.has(want), `${c.id} expected category ${want}, got ${[...gotCats]}`);
      }
    }
    for (const c of PHI_FIXTURE.po_phi_clean) {
      const report = GATES.scanPhi(c.text, { mode: c.mode });
      assert.equal(report.blocked, false, `${c.id} must pass: ${c.text} hits=${JSON.stringify(report.hits)}`);
    }

    const r = GATES.scanPhi("Email: ramesh.kumar@example.com, MRN 483920");
    assert.deepEqual(GATES.phiCategories(r.hits), ["email", "mrn"]);
    assert.equal(GATES.scanPhi(PHI_FIXTURE.invalid_aadhaar).blocked, false);
    assert.equal(GATES.scanPhi("MRN " + PHI_FIXTURE.invalid_aadhaar.slice(0, 8)).blocked, true);
  });
});

/* ==================== 2. Gates parity (test_po_gates.py) ==================== */

describe("Gates parity with Python (test_po_gates.py)", () => {
  const manifest = makeManifest();
  const tokenTable = GATES.buildTokenTable(manifest.runs);
  const citationMap = { ref1: { title: "Trial One report", doi: "10.1000/trial1", pmid: "11111111" } };

  test("numbers gate: untokenised, tokenised, years/reviewers/thresholds, unknown, non-gated sections", () => {
    const v1 = GATES.checkNumbers([sectionObj("results", "The intervention reduced mortality (OR 0.62).")], tokenTable);
    assert.ok(v1.some((v) => v.gate === "untokenised_number" && v.number === "0.62"));

    assert.deepEqual(GATES.checkNumbers([sectionObj("results",
      "The intervention reduced mortality (OR {{run:r1.estimate}}, 95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}; p {{run:r1.p}})."
    )], tokenTable), []);

    assert.deepEqual(GATES.checkNumbers([sectionObj("results",
      "Since 2018, two reviewers screened records; 3 reviewers assessed risk of bias. " +
      "The significance level was 0.05 and the heterogeneity cutoff was 50%."
    )], tokenTable), []);

    const vUnk = GATES.checkNumbers([sectionObj("results", "Effect {{run:r9.estimate}} was reported.")], tokenTable);
    assert.ok(vUnk.some((v) => v.gate === "unknown_token"));

    assert.deepEqual(GATES.checkNumbers([sectionObj("methods", "We searched 3 databases and included 12 trials.")], tokenTable), []);

    const vMal = GATES.checkNumbers([sectionObj("results", "Effect {{run:r1:estimate}} was reported.")], tokenTable);
    assert.ok(vMal.some((v) => v.gate === "malformed_token"));

    assert.deepEqual(GATES.checkNumbers([sectionObj("results", "OR {{run:r1.estimate}} {{run:r1.ci}}.")], tokenTable), []);

    const noBounds = { ...tokenTable };
    delete noBounds["r1.ciLower"];
    delete noBounds["r1.ciUpper"];
    assert.ok(GATES.checkNumbers([sectionObj("results", "OR {{run:r1.ci}}.")], noBounds).some((v) => v.gate === "unknown_token"));

    assert.equal(GATES.checkNumbers([sectionObj("abstract",
      "The pooled estimate was {{run:r1.estimate}} (95\\% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}})."
    )], tokenTable).some((v) => v.number === "95"), false);

    assert.equal(GATES.checkNumbers([sectionObj("abstract",
      "The pooled estimate was {{run:r1.estimate}} (95\\%~CI {{run:r1.ciLower}} to {{run:r1.ciUpper}})."
    )], tokenTable).some((v) => v.number === "95"), false);

    assert.equal(GATES.checkNumbers([sectionObj("abstract",
      "The pooled estimate was {{run:r1.estimate}} (95 \\% confidence interval {{run:r1.ciLower}} to {{run:r1.ciUpper}})."
    )], tokenTable).some((v) => v.number === "95"), false);

    assert.ok(GATES.checkNumbers([sectionObj("abstract", "There was a reduction of 95 cases.")], tokenTable)
      .some((v) => v.gate === "untokenised_number" && v.number === "95"));
  });

  test("citations gate: unknown, no_doi_or_pmid, not_in_manifest, resolved", () => {
    const vGhost = GATES.checkCitations([sectionObj("introduction", "Background \\cite{ghost}.")], citationMap, manifest);
    assert.ok(vGhost.some((v) => v.gate === "unresolved_citation" && v.key === "ghost"));

    const vNoId = GATES.checkCitations([sectionObj("introduction", "Background \\cite{ref2}.")], { ref2: { title: "Mystery paper" } }, manifest);
    assert.ok(vNoId.some((v) => v.reason === "no_doi_or_pmid"));

    const vOut = GATES.checkCitations([sectionObj("introduction", "Background \\cite{ref2}.")], { ref2: { title: "Outside paper", doi: "10.9999/outside" } }, manifest);
    assert.ok(vOut.some((v) => v.reason === "not_in_manifest"));

    assert.deepEqual(GATES.checkCitations([sectionObj("introduction", "Background \\cite{ref1}.")], citationMap, manifest), []);
  });

  test("claim_links and direction/significance gates", () => {
    assert.ok(GATES.checkClaimLinks([sectionObj("discussion", "The intervention significantly improved outcomes.")])
      .some((v) => v.gate === "claim_without_source"));
    assert.deepEqual(GATES.checkClaimLinks([sectionObj("discussion",
      "The intervention reduced mortality ({{run:r1.estimate}}). Prior work agrees \\cite{ref1}."
    )]), []);
    assert.deepEqual(GATES.checkClaimLinks([sectionObj("abstract",
      "\\noindent\\textbf{Background and objective.} This systematic review and meta-analysis addresses whether BCG vaccination reduces tuberculosis in infants."
    )]), []);
    assert.deepEqual(GATES.checkClaimLinks([sectionObj("abstract",
      "Our objective was to quantify how BCG reduces tuberculosis."
    )]), []);
    assert.ok(GATES.checkClaimLinks([sectionObj("abstract", "BCG vaccination reduces tuberculosis in infants.")])
      .some((v) => v.gate === "claim_without_source"));

    const crossing = {
      ...tokenTable,
      "r1.ciLower": { ...tokenTable["r1.ciLower"], value: 0.8 },
      "r1.ciUpper": { ...tokenTable["r1.ciUpper"], value: 1.3 },
    };
    assert.ok(GATES.checkDirection([sectionObj("results",
      "The intervention significantly reduced mortality ({{run:r1.estimate}}, {{run:r1.ciLower}} to {{run:r1.ciUpper}})."
    )], crossing).some((v) => v.gate === "significance_mismatch" && v.claim === "significant"));

    assert.deepEqual(GATES.checkDirection([sectionObj("results",
      "The intervention significantly reduced mortality ({{run:r1.estimate}}, {{run:r1.ciLower}} to {{run:r1.ciUpper}})."
    )], tokenTable), []);

    const aboveNull = {
      ...tokenTable,
      "r1.estimate": { ...tokenTable["r1.estimate"], value: 1.4 },
    };
    assert.ok(GATES.checkDirection([sectionObj("results",
      "The intervention reduced mortality ({{run:r1.estimate}})."
    )], aboveNull).some((v) => v.gate === "direction_mismatch"));

    assert.ok(GATES.checkDirection([sectionObj("results",
      "The effect was not significant ({{run:r1.ciLower}} to {{run:r1.ciUpper}})."
    )], tokenTable).some((v) => v.gate === "significance_mismatch" && v.claim === "not significant"));

    assert.throws(() => GATES.enforce([sectionObj("results", "OR 0.62 was observed.")], tokenTable), (err) => {
      return err.code === "gate_failed" && err.violations.length > 0;
    });

    const splitV = GATES.checkPaper("\\section{Results} OR 0.62 was observed.\n\\section{Methods} We searched 3 databases.\n",
      tokenTable, citationMap, manifest);
    assert.ok(splitV.some((v) => v.gate === "untokenised_number" && v.section === "results"));
    assert.equal(splitV.some((v) => v.section === "methods"), false);
  });
});

/* ==================== 3. Writer parity (test_po_writer.py) ==================== */

describe("Writer parity with Python (test_po_writer.py)", () => {
  test("parseLatexSections, vancouver, buildManuscript, renderTokens, latexToText", () => {
    const manifest = makeManifest();
    const table = GATES.buildTokenTable(manifest.runs);

    const secs = GATES.parseLatexSections(DRAFT_V0);
    assert.deepEqual(secs.map((s) => s.id), ["introduction", "methods", "results", "discussion"]);
    assert.ok(secs[2].text.includes("{{run:r1.estimate}}"));
    assert.ok(!secs[2].text.includes("\\section"));

    const sub = GATES.parseLatexSections("\\section*{Abstract} Structured text.\n\\section{Methods}\n\\subsection{Search} Details.");
    assert.deepEqual(sub.map((s) => s.id), ["abstract", "methods", "search"]);
    assert.equal(sub[2].level, 2);

    const cit = GATES.vancouver({
      authors: ["Smith J", "Doe A"], title: "Trial One report", venue: "Journal of Examples",
      year: 2019, volume: "10", pages: "1-9", doi: "10.1000/trial1", pmid: "11111111",
    }, 1);
    assert.ok(cit.startsWith("1. Smith J, Doe A. Trial One report."));
    assert.ok(cit.includes("Journal of Examples. 2019;10:1-9."));
    assert.ok(cit.includes("doi:10.1000/trial1"));
    assert.ok(cit.includes("PMID:11111111"));

    const etAl = GATES.vancouver({ authors: Array.from({ length: 8 }, (_, i) => `Author ${i}`), title: "T", year: 2020 }, 2);
    assert.ok(etAl.includes("et al") && !etAl.includes("Author 7"));

    const model = GATES.buildManuscript({
      title: "Test review", sections: secs, tokenTable: table, references: manifest.references, manifest,
    });
    assert.equal(model.v, 1);
    assert.deepEqual(model.sections.map((s) => s.id), ["introduction", "methods", "results", "discussion"]);
    assert.equal(model.references.length, 1);
    assert.equal(model.references[0].number, 1);
    assert.equal(model.references[0].key, "ref1");
    assert.equal(model.references[0].resolved, true);
    assert.equal(model.provenance.protocolHash, "a".repeat(64));
    assert.deepEqual(model.provenance.runIds, ["r1"]);
    assert.ok(model.sections[2].text.includes("{{run:r1.estimate}}"));

    assert.equal(GATES.renderTokens("OR {{run:r1.estimate}} ({{run:r1.ciLower}} to {{run:r1.ciUpper}})", table), "OR 0.62 (0.41 to 0.93)");
    assert.equal(GATES.renderTokens("{{run:r9.x}}", table), "{{run:r9.x}}");

    const unres = GATES.buildManuscript({
      title: "T", sections: [{ id: "introduction", heading: "Introduction", level: 1, text: "Background \\cite{ghost}." }], tokenTable: {},
    });
    assert.equal(unres.references[0].resolved, false);

    /* Live-like LaTeX conversion */
    const liveTex =
      "\\section*{Abstract}\n" +
      "\\noindent\\textbf{Background and objective.} To assess intervention X " +
      "on outcome Y (OR {{run:r1.estimate}}, 95\\% CI {{run:r1.ciLower}} to " +
      "{{run:r1.ciUpper}}; p {{run:r1.p}}).\n\n" +
      "\\section{Introduction}\n" +
      "This \\emph{systematic review} and \\textit{meta-analysis} evaluates X " +
      "\\cite{ref1}. Study details appear in Table~\\ref{tab:study-data}.\n\n" +
      "\\section{Methods}\n" +
      "\\subsection{Protocol and eligibility}\n" +
      "\\label{sec:protocol}\n" +
      "\\begin{itemize}\n" +
      "  \\item Adults aged 18 or older\n" +
      "  \\item Randomised trials only\n" +
      "\\end{itemize}\n" +
      "Steps followed:\n" +
      "\\begin{enumerate}\n" +
      "  \\item Screen titles and abstracts\n" +
      "  \\item Extract verified outcomes\n" +
      "\\end{enumerate}\n" +
      "\\subsection{Data and outcome definition}\n" +
      "Extracted from \\texttt{run\\_7f09c578d6214e4ba6928f9b40e8ffdd} " +
      "(95\\% CI, Smith \\& Doe, item \\#1, cost \\$50).\n" +
      "\\subsection{Statistical analysis}\n" +
      "Thresholds were $p \\le 0.05$, $p \\leq 0.01$, $n \\ge 10$, $k \\geq 2$, " +
      "difference $1.2 \\pm 0.3$, scale $2 \\times 3$, and $p \\approx 0.02$.\n\n" +
      "\\section{Results}\n" +
      "\\subsection{Included evidence}\n" +
      "Characteristics are in Table~\\ref{tab:study-data}, outcomes in " +
      "Table~\\ref{tab:outcomes}, and plots in Figure~\\ref{fig:forest}.\n" +
      "\\begin{table}[t]\n\\centering\n\\caption{Summary of included studies.}\n\\label{tab:study-data}\n" +
      "\\begin{tabular}{@{}lcc@{}}\n\\toprule\nStudy & Year & Events \\\\\n\\midrule\nTrial One & 2019 & 12 \\\\\n\\hline\n\\bottomrule\n\\end{tabular}\n\\end{table}\n" +
      "\\subsection{Pooled analysis and heterogeneity}\n" +
      "\\textbf{Pooled effect:} OR {{run:r1.estimate}} ({{run:r1.ciLower}} to {{run:r1.ciUpper}}).\n" +
      "\\subsection{Reporting}\n" +
      "Checklist at \\url{https://example.com/~user/a_b} per \\mbox{PRISMA 2020}.\n\n" +
      "\\section{Discussion}\nFindings in Table~\\ref{tab:study-data} support intervention X \\cite{ref1}.\n\n" +
      "\\section*{Acknowledgements}\nWe thank the reviewers.\n\n" +
      "\\section*{References}\nSee reference list.\n";

    const liveModel = GATES.buildManuscript({
      title: "Test review", sections: GATES.parseLatexSections(liveTex),
      tokenTable: table, references: manifest.references, manifest,
    });
    assert.deepEqual(liveModel.sections.map((s) => s.id), [
      "abstract", "introduction", "methods", "protocol-and-eligibility",
      "data-and-outcome-definition", "statistical-analysis", "results",
      "included-evidence", "pooled-analysis-and-heterogeneity", "reporting",
      "discussion", "acknowledgements", "references",
    ]);
    const byId = Object.fromEntries(liveModel.sections.map((s) => [s.id, s]));
    assert.equal(byId.methods.text, "");
    assert.equal(byId.results.text, "");
    assert.ok(byId.abstract.text.startsWith("**Background and objective.** To assess"));
    assert.ok(byId.introduction.text.includes("*systematic review*"));
    assert.ok(byId.introduction.text.includes("Table 1"));
    assert.ok(byId["included-evidence"].text.includes("Table 2"));
    assert.ok(byId["included-evidence"].text.includes("Figure 1"));
    assert.ok(byId["included-evidence"].text.includes("Study | Year | Events"));
    assert.ok(byId["included-evidence"].text.includes("Trial One | 2019 | 12"));
    assert.ok(byId["data-and-outcome-definition"].text.includes("95% CI, Smith & Doe, item #1, cost $50"));
    assert.ok(byId["protocol-and-eligibility"].text.includes("- Adults aged 18 or older"));
    assert.ok(byId["protocol-and-eligibility"].text.includes("1. Screen titles and abstracts"));
    assert.ok(byId["protocol-and-eligibility"].text.includes("2. Extract verified outcomes"));
    for (const sym of ["\u2264", "\u2265", "\u00b1", "\u00d7", "\u2248"]) {
      assert.ok(byId["statistical-analysis"].text.includes(sym));
    }
    assert.ok(byId.reporting.text.includes("https://example.com/~user/a_b"));
    for (const sec of liveModel.sections) {
      const stripped = sec.text.replace(/\\cite\{[^}]+\}/g, "");
      assert.ok(!stripped.includes("\\"), `Leftover backslash in ${sec.id}: ${stripped}`);
    }

    const edge = GATES.latexToText(
      "\\maketitle\\centering\\smallskip\\medskip\\bigskip\n" +
      "First\\par Second \\customcmd{kept} \\barecmd \\{braced\\} " +
      "na\\\"ive \\textbf{{{run:r1.estimate}}} \\textbf{\\noindent}."
    );
    assert.ok(!edge.includes("\\") && edge.includes("First") && edge.includes("Second"));
    assert.ok(edge.includes("{braced}") && edge.includes("naive") && edge.includes("**{{run:r1.estimate}}**"));
    assert.ok(!edge.includes("****"));
  });
});

/* ==================== 4. On-device runner (research-ondevice-draft.js) ==================== */

const FULL_OUTLINE = {
  plotting_plan: [],
  intro_related_work_plan: {},
  section_plan: [
    { section_title: "Abstract", subsections: [] },
    { section_title: "Introduction", subsections: [] },
    { section_title: "Methods", subsections: [] },
    { section_title: "Results", subsections: [] },
    { section_title: "Discussion", subsections: [] },
    { section_title: "Conclusion", subsections: [] },
  ],
};

function sectionLatexFor(stepId) {
  if (stepId === "section:abstract") return "\\section*{Abstract}\nPooled OR {{run:r1.estimate}} (95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}; p {{run:r1.p}}).";
  if (stepId === "section:introduction") return "\\section{Introduction}\nOutcome Y is common \\cite{ref1}.";
  if (stepId === "section:methods") return "\\section{Methods}\nTwo reviewers screened 12 trials.";
  if (stepId === "section:results") return "\\section{Results}\nIntervention X significantly reduced Y (OR {{run:r1.estimate}}, 95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}).";
  if (stepId === "section:discussion") return "\\section{Discussion}\nPrior work agrees \\cite{ref1}.";
  return "\\section{Conclusion}\nIntervention X reduces Y \\cite{ref1}.";
}

function reviewJson(overall) {
  return {
    Summary: "Systematic review.", Strengths: ["Clear."], Weaknesses: ["Minor."],
    Originality: 3, Quality: 3, Clarity: 3, Significance: 3,
    Questions: [], Limitations: [], "Ethical Concerns": false,
    Soundness: 3, Presentation: 3, Contribution: 3,
    Overall: overall, Confidence: 4, Decision: "Accept",
  };
}

describe("On-device draft runner (research-ondevice-draft.js)", () => {
  beforeEach(async () => {
    await CHECKPOINT._setBackend({ records: {} });
  });

  test("step order, stepIds, checkpoint after every step, AI wait excluded from timer, device-result shape", async () => {
    const manifest = makeManifest();
    const calls = [];
    const apiCalls = [];
    let fakeClock = 10000;
    const cpEvents = [];
    const origPut = CHECKPOINT.put;
    const cpSpy = {
      get: CHECKPOINT.get,
      put: (k, v) => {
        cpEvents.push({ key: k, step: v.lastCompletedStep, calls: v.callCount });
        return origPut(k, v);
      },
    };

    const progressLabels = [];
    const manuscript = await DRAFT.run({
      job: { id: "job_dev_1", projectId: "p1", createdBy: "u1", ceilings: { maxCalls: 64, maxSeconds: 600 } },
      manifest,
      token: "tok-1",
    }, {
      checkpoint: cpSpy,
      now: () => fakeClock,
      sleep: () => Promise.resolve(),
      onProgress: (info) => progressLabels.push(info.label),
      gatewayRequest: async (_url, payload, tok) => {
        calls.push({ stepId: payload.stepId, purpose: payload.purpose, tok });
        fakeClock += 30000; // 30 s per AI call -> must NOT count toward device step timer!
        if (payload.stepId === "outline") {
          return { status: 200, data: { text: "```json\n" + JSON.stringify(FULL_OUTLINE) + "\n```", model: "m", usage: { inputTokens: 100, outputTokens: 50 } } };
        }
        if (payload.stepId.startsWith("section:")) {
          return { status: 200, data: { text: "```latex\n" + sectionLatexFor(payload.stepId) + "\n```", model: "m", usage: { inputTokens: 100, outputTokens: 50 } } };
        }
        if (payload.purpose === "review") {
          const overall = payload.stepId.startsWith("refine:0") ? 5 : (payload.stepId.startsWith("refine:1") ? 7 : 8);
          return { status: 200, data: { text: "```json\n" + JSON.stringify(reviewJson(overall)) + "\n```", model: "m", usage: { inputTokens: 80, outputTokens: 40 } } };
        }
        if (payload.purpose === "refinement") {
          const full = FULL_OUTLINE.section_plan.map((s) => sectionLatexFor("section:" + s.section_title.toLowerCase())).join("\n\n");
          return { status: 200, data: { text: "```json\n{\"actions\":[\"improved\"]}\n```\n```latex\n" + full + "\n```", model: "m", usage: { inputTokens: 120, outputTokens: 80 } } };
        }
        throw new Error("Unexpected stepId " + payload.stepId);
      },
      apiRequest: async (method, path, body) => {
        apiCalls.push({ method, path, body });
        return { ok: true };
      },
    });

    assert.equal(calls[0].stepId, "outline");
    assert.deepEqual(calls.slice(1, 7).map((c) => c.stepId), [
      "section:abstract", "section:introduction", "section:methods",
      "section:results", "section:discussion", "section:conclusion",
    ]);
    assert.ok(calls.some((c) => c.stepId === "refine:1" && c.purpose === "refinement"));
    assert.ok(calls.some((c) => c.stepId === "refine:2" && c.purpose === "refinement"));

    assert.ok(progressLabels.includes("Drafting on this device: outline"));
    assert.ok(progressLabels.includes("Drafting on this device: section 2 of 6"));
    assert.ok(progressLabels.includes("Drafting on this device: review round 1 of 2"));

    /* Checkpoint saved after validate, outline, each of 6 sections, refine:0:review, refine:1, refine:2, final. */
    assert.deepEqual(cpEvents.map((e) => e.step), [
      "validate", "outline",
      "section:abstract", "section:introduction", "section:methods",
      "section:results", "section:discussion", "section:conclusion",
      "section:conclusion", "refine:1", "refine:2", "final",
    ]);

    const finalCp = await CHECKPOINT.get("draft:job_dev_1");
    assert.equal(finalCp.status, "succeeded");
    assert.equal(finalCp.callCount, calls.length);
    assert.ok(finalCp.stepElapsedMs < 5000, "AI wait time (30s * calls) was excluded from stepElapsedMs=" + finalCp.stepElapsedMs);

    const submit = apiCalls.find((a) => a.path === "/v1/jobs/job_dev_1/device-result");
    assert.ok(submit, "device-result posted");
    assert.equal(submit.body.manuscript.v, 1);
    assert.equal(submit.body.manuscript.sections.length, 6);
    assert.equal(submit.body.manuscript.references.length, 1);
    assert.equal(submit.body.manuscript.provenance.protocolHash, "a".repeat(64));
    assert.ok(submit.body.usage.seconds < 5, "AI wait excluded from submitted usage.seconds");
    assert.equal(manuscript.v, 1);
  });

  test("resume from section:2 does not repeat outline or section 1", async () => {
    const manifest = makeManifest();
    const firstCalls = [];
    await assert.rejects(() => DRAFT.run({
      job: { id: "job_res_1", projectId: "p1", createdBy: "u1" },
      manifest, token: "tok-1",
    }, {
      checkpoint: CHECKPOINT,
      maxRefinementRounds: 0,
      sleep: () => Promise.resolve(),
      gatewayRequest: async (_url, payload) => {
        firstCalls.push(payload.stepId);
        if (payload.stepId === "outline") {
          return { status: 200, data: { text: "```json\n" + JSON.stringify(FULL_OUTLINE) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        if (payload.stepId === "section:abstract") {
          return { status: 200, data: { text: "```latex\n" + sectionLatexFor("section:abstract") + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        return { status: 500, data: { error: { code: "boom" } } };
      },
      apiRequest: async () => ({ ok: true }),
    }), (e) => e.code === "device_failed" && e.step === "section:introduction");

    assert.deepEqual(firstCalls.slice(0, 3), ["outline", "section:abstract", "section:introduction"]);

    const resumedCalls = [];
    const ms = await DRAFT.run({
      job: { id: "job_res_1", projectId: "p1", createdBy: "u1" },
      manifest, token: "tok-2",
    }, {
      resume: true,
      checkpoint: CHECKPOINT,
      maxRefinementRounds: 0,
      sleep: () => Promise.resolve(),
      gatewayRequest: async (_url, payload) => {
        resumedCalls.push(payload.stepId);
        return { status: 200, data: { text: "```latex\n" + sectionLatexFor(payload.stepId) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
      },
      apiRequest: async () => ({ ok: true }),
    });

    assert.equal(resumedCalls[0], "section:introduction", "resumed at section 2, skipping outline and section 1");
    assert.ok(!resumedCalls.includes("outline"));
    assert.ok(!resumedCalls.includes("section:abstract"));
    assert.equal(ms.sections.length, 6);
  });

  test("64-call ceiling stops with ceiling_calls and calls device-fail", async () => {
    const manifest = makeManifest();
    const apiCalls = [];
    let count = 0;
    const manySections = {
      section_plan: Array.from({ length: 70 }, (_, i) => ({ section_title: "Part " + (i + 1), subsections: [] })),
    };

    await assert.rejects(() => DRAFT.run({
      job: { id: "job_cap_64", projectId: "p1", createdBy: "u1" },
      manifest, token: "tok-1",
    }, {
      checkpoint: CHECKPOINT,
      maxRefinementRounds: 0,
      sleep: () => Promise.resolve(),
      gatewayRequest: async (_url, payload) => {
        count++;
        if (payload.stepId === "outline") {
          return { status: 200, data: { text: "```json\n" + JSON.stringify(manySections) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        return { status: 200, data: { text: "\\section{" + payload.stepId + "} Text \\cite{ref1}.", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
      },
      apiRequest: async (method, path, body) => {
        apiCalls.push({ method, path, body });
        return { ok: true };
      },
    }), (err) => err.code === "ceiling_calls" && err.step === "section:part-64");

    assert.equal(count, 64);
    const fail = apiCalls.find((a) => a.path === "/v1/jobs/job_cap_64/device-fail");
    assert.ok(fail);
    assert.equal(fail.body.code, "ceiling_calls");
  });

  test("PHI hit stops before gateway call and reports phi_blocked", async () => {
    const manifest = makeManifest({
      protocol: {
        title: "Patient Ramesh Kumar, MRN 483920",
        question: "Does X work?",
        lockHash: "a".repeat(64),
      },
    });
    let gwCalls = 0;
    const apiCalls = [];

    await assert.rejects(() => DRAFT.run({
      job: { id: "job_phi", projectId: "p1", createdBy: "u1" },
      manifest, token: "tok-1",
    }, {
      checkpoint: CHECKPOINT,
      gatewayRequest: async () => { gwCalls++; return { status: 200, data: {} }; },
      apiRequest: async (method, path, body) => { apiCalls.push({ method, path, body }); return { ok: true }; },
    }), (err) => err.code === "phi_blocked" && err.step === "outline");

    assert.equal(gwCalls, 0, "no gateway call made when PHI detected");
    const fail = apiCalls.find((a) => a.path === "/v1/jobs/job_phi/device-fail");
    assert.ok(fail);
    assert.equal(fail.body.code, "phi_blocked");
  });

  test("401 refreshes token once and retries, and gate retry uses :r1 suffix", async () => {
    const manifest = makeManifest();
    const seen = [];
    let tokRefreshCount = 0;
    let firstOutline401 = true;
    let badResultsOnce = true;

    const ms = await DRAFT.run({
      job: { id: "job_401", projectId: "p1", createdBy: "u1" },
      manifest, token: "tok-expired",
    }, {
      checkpoint: CHECKPOINT,
      maxRefinementRounds: 0,
      sleep: () => Promise.resolve(),
      gatewayRequest: async (_url, payload, tok) => {
        seen.push({ stepId: payload.stepId, tok });
        if (payload.stepId === "outline" && firstOutline401) {
          firstOutline401 = false;
          return { status: 401, data: { error: { code: "unauthorized" } } };
        }
        if (payload.stepId === "outline") {
          return { status: 200, data: { text: "```json\n" + JSON.stringify(FULL_OUTLINE) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        if (payload.stepId === "section:results" && badResultsOnce) {
          badResultsOnce = false;
          return { status: 200, data: { text: "```latex\n\\section{Results}\nOR was 0.62.\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        return { status: 200, data: { text: "```latex\n" + sectionLatexFor(payload.stepId.replace(/:r1$/, "")) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
      },
      apiRequest: async (_method, path) => {
        if (path.endsWith("/token")) {
          tokRefreshCount++;
          return { token: "tok-fresh" };
        }
        return { ok: true };
      },
    });

    assert.equal(tokRefreshCount, 1);
    assert.equal(seen[0].tok, "tok-expired");
    assert.equal(seen[1].tok, "tok-fresh");
    assert.ok(seen.some((s) => s.stepId === "section:results"));
    assert.ok(seen.some((s) => s.stepId === "section:results:r1"));
    assert.equal(ms.sections.length, 6);
  });
});

/* ==================== 5. UI integration (research-screen-manuscript.js) ==================== */

describe("UI integration with smd_rmd_ondevice_draft", () => {
  test("creates device job, shows progress labels, and offers Continue draft on reopen", async () => {
    const storageMap = {};
    globalThis.window = globalThis;
    globalThis.document = {
      head: { appendChild: () => {} },
      body: { contains: () => true },
      getElementById: () => ({ id: "rmdManuscriptCss" }),
      createElement: () => ({ style: {}, setAttribute: () => {} }),
    };
    globalThis.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : null),
      setItem: (k, v) => { storageMap[k] = String(v); },
      removeItem: (k) => { delete storageMap[k]; },
    };

    await CHECKPOINT._setBackend({ records: {} });
    globalThis.SMD_RMD_CHECKPOINT = CHECKPOINT;
    globalThis.SMD_RMD_PO_PROMPTS = PROMPTS;
    globalThis.SMD_RMD_PO_GATES = GATES;
    globalThis.SMD_RMD_ONDEVICE_DRAFT = {
      run: async (_bundle, opts) => {
        opts.onProgress({ label: "Drafting on this device: outline" });
        opts.onProgress({ label: "Drafting on this device: section 2 of 6" });
        opts.onProgress({ label: "Drafting on this device: review round 1 of 2" });
        return { v: 1, title: "Done", sections: [], references: [], tokens: {}, provenance: {} };
      },
    };

    const apiCalls = [];
    globalThis.SMD_RESEARCH = {
      ai: { state: () => ({ busy: false, error: null, drafted: {} }), barHtml: () => "", noteHtml: () => "", bind: () => {} },
      store: {
        getActiveProject: () => ({ id: "prj_1", serverId: "prj_1", title: "SR", studyType: "systematic_review" }),
        getState: () => ({ runs: {} }),
      },
      api: {
        request: async (method, path, body) => {
          apiCalls.push({ method, path, body });
          if (method === "POST" && path.endsWith("/jobs")) {
            return {
              job: { id: "job_ui_1", projectId: "prj_1", status: "queued", runner: "device" },
              manifest: makeManifest(),
              token: "tok-ui",
            };
          }
          return { versions: [], manuscript: { title: "SR", version: 1, sections: [] } };
        },
      },
    };

    const src = fs.readFileSync(new URL("../research-screen-manuscript.js", import.meta.url), "utf8");
    new Function("window", "global", src)(globalThis, globalThis);

    let html = "";
    const container = {
      _nodes: [],
      get innerHTML() { return html; },
      set innerHTML(v) {
        html = v;
        this._nodes = [];
        const btnRe = /<button\s+([^>]*?)>([\s\S]*?)<\/button>/gi;
        let m;
        while ((m = btnRe.exec(html)) !== null) {
          const attrs = {};
          const are = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
          let am;
          while ((am = are.exec(m[1])) !== null) attrs[am[1]] = am[2] !== undefined ? am[2] : true;
          this._nodes.push({ tagName: "BUTTON", attrs, textContent: m[2].trim(), onclick: null });
        }
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const m = sel.match(/\[([^=]+)="([^"]+)"\]/);
        if (!m) return [];
        return this._nodes.filter((n) => n.attrs[m[1]] === m[2]);
      },
    };

    globalThis.SMD_RESEARCH.screens.manuscript.render(container);
    await new Promise((r) => setTimeout(r, 20));
    container.querySelector('[data-rmd="full-draft-po"]').onclick();
    await new Promise((r) => setTimeout(r, 20));
    container.querySelector('[data-rmd="po-start"]').onclick();
    await new Promise((r) => setTimeout(r, 30));

    const jobCreate = apiCalls.find((c) => c.method === "POST" && c.path.endsWith("/jobs"));
    assert.equal(jobCreate.body.runner, "device", "runner:'device' sent by default");

    /* Saved unfinished checkpoint offers Continue draft on reopen. */
    await CHECKPOINT.put("draft:job_paused_1", {
      jobId: "job_paused_1",
      projectId: "prj_1",
      status: "running",
      manifest: makeManifest(),
      updatedAt: new Date().toISOString(),
    });
    globalThis.SMD_RESEARCH.screens.manuscript.render(container);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(container.querySelector('[data-rmd="po-continue"]'), "Continue draft button offered for unfinished checkpoint");

    /* Kill switch "0" disables on-device runner. */
    globalThis.localStorage.setItem("smd_rmd_ondevice_draft", "0");
    globalThis.SMD_RESEARCH.screens.manuscript.render(container);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(container.querySelector('[data-rmd="po-continue"]'), null, "Continue draft hidden when kill switch is 0");
  });

  test("published bibliography titles/authors/trial labels from BCG snapshot pass cleanly while real PHI stays blocked", () => {
    const metaRefs = [
      {
        key: "rec_tb_ev",
        title: "Optimized Mass Spectrometry to Uncover M. tuberculosis Biomarkers in Extracellular Vesicles From Asymptomatic Tuberculosis Patients.",
        authors: ["Nieto Ramirez LM", "Shelton K", "Belisle JT"],
        year: 2026,
        pmid: "41234567",
      },
      {
        key: "rec_cath",
        title: "Effect of Catheter Type and Size on Patient Comfort and Complications in Intravesical Bacillus Calmette-Guerin and Chemotherapy Administration: A Randomized Trial.",
        authors: ["Buisan O", "Gomez A"],
        year: 2025,
        doi: "10.1000/cath.2025",
      },
      {
        key: "rec_rutivac",
        title: "Safety and Immunogenicity of RUTI Vaccination in Non-muscle-invasive Bladder Cancer Patients: Phase 1 RUTIVAC-1 Trial.",
        authors: ["Perez M"],
        year: 2025,
        pmid: "40987654",
      },
    ];
    const refsMap = {};
    for (const r of metaRefs) refsMap[r.key] = r;
    const manifest = makeManifest({
      protocol: {
        title: "Efficacy of BCG Vaccination Against Tuberculosis: Systematic Review",
        question: "Does BCG reduce tuberculosis across Colditz trials including TPT Madras 1980?",
        pico: { population: "Adults and infants", intervention: "BCG vaccine", comparator: "Placebo", outcome: "TB incidence" },
        design: "systematic review and meta-analysis",
        eligibility: "TPT Madras 1980, Aronson 1958, Hart 1977",
        outcomes: ["TB incidence"],
        lockHash: "b".repeat(64),
        lockedAt: "2026-11-01T00:00:00Z",
      },
      evidence: [{
        studyId: "s_madras",
        label: "TPT Madras 1980",
        source: { title: "Tuberculosis Prevention Trial Madras 1980", doi: "10.1000/madras", pmid: "7001122", authors: ["Baily GV"], year: 1980 },
        values: [{ field: "events_intervention", value: 260, verified: true, locator: { page: 2, table: "Table 1" }, quote: "260 cases in TPT Madras 1980" }],
      }],
      references: metaRefs,
    });
    const inputs = GATES.buildInputs(manifest);
    const secPrompt = PROMPTS.buildSectionPrompt({
      ...inputs,
      citationMap: refsMap,
      outlineJsonStr: "{}",
      sectionTitle: "Introduction",
    });
    const assembled = secPrompt.system + "\n\n" + secPrompt.prompt;
    const cleanReport = GATES.scanPhi(assembled, { allowCitationLibraryNames: true });
    assert.equal(cleanReport.blocked, false, "published citation titles/authors and TPT Madras pass: " + JSON.stringify(cleanReport.hits));

    /* Real identifiers injected into user data or reference block remain blocked. */
    assert.equal(GATES.scanPhi(assembled.replace("TPT Madras 1980", "Call +91 9876543210"), { allowCitationLibraryNames: true }).blocked, true);
    assert.equal(GATES.scanPhi(assembled + "\nPatient Ramesh Kumar, MRN 483920", { allowCitationLibraryNames: true }).blocked, true);
    assert.equal(GATES.scanPhi(assembled + "\ndob 12/03/1980, email test@example.com, Address: 12 MG Road, Bengaluru", { allowCitationLibraryNames: true }).blocked, true);

    /* Large 150-reference library stays under T2 16000-token limit. */
    const bigMap = {};
    for (let i = 0; i < 150; i++) {
      bigMap["rec_" + i] = { ...metaRefs[i % metaRefs.length], key: "rec_" + i, pmid: String(40000000 + i) };
    }
    const bigSec = PROMPTS.buildSectionPrompt({ ...inputs, citationMap: bigMap, outlineJsonStr: "{}", sectionTitle: "Introduction" });
    const bigFull = bigSec.system + "\n\n" + bigSec.prompt;
    assert.ok(DRAFT.estimateTokens(bigFull) + 1000 < DRAFT.TIER_CEILINGS.T2.maxInputTokens, "150-ref section prompt fits T2 ceiling");
  });

  test("on-device draft allows false_positive override for low-risk hits when onPhiOverride confirms, never for high-risk", async () => {
    await CHECKPOINT._setBackend({ records: {} });
    const manifest = makeManifest();
    const sentPayloads = [];
    let overridePrompts = 0;
    const ms = await DRAFT.run({
      job: { id: "job_ovr_ok", projectId: "p1", createdBy: "u1" },
      manifest,
      token: "tok-1",
    }, {
      checkpoint: CHECKPOINT,
      maxRefinementRounds: 0,
      sleep: () => Promise.resolve(),
      onPhiOverride: async (cats, canOverride) => {
        overridePrompts += 1;
        assert.deepEqual(cats, ["address"]);
        assert.equal(canOverride, true);
      },
      gatewayRequest: async (_url, payload) => {
        sentPayloads.push(payload);
        if (!payload.phiOverride) {
          return {
            status: 422,
            data: { error: { code: "phi_blocked", message: "blocked" }, categories: ["address"], overridable: true, allowedConditions: ["false_positive"] },
          };
        }
        if (payload.stepId === "outline") {
          return { status: 200, data: { text: "```json\n" + JSON.stringify(FULL_OUTLINE) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        return { status: 200, data: { text: "```latex\n" + sectionLatexFor(payload.stepId) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
      },
      apiRequest: async () => ({ ok: true }),
    });
    assert.equal(overridePrompts, 1);
    assert.equal(ms.v, 1);
    assert.ok(sentPayloads.some((p) => p.phiOverride && p.phiOverride.condition === "false_positive"));

    let highRiskModalOpened = false;
    await assert.rejects(() => DRAFT.run({
      job: { id: "job_ovr_never", projectId: "p1", createdBy: "u1" },
      manifest: makeManifest({
        protocol: {
          title: "SR",
          question: "Call 9876543210",
          pico: { population: "adults", intervention: "X", comparator: "usual", outcome: "Y" },
          design: "systematic review",
          eligibility: "adults",
          outcomes: ["Y"],
          lockHash: "a".repeat(64),
          lockedAt: "2026-11-01T00:00:00Z",
        },
      }),
      token: "tok-1",
    }, {
      checkpoint: CHECKPOINT,
      maxRefinementRounds: 0,
      sleep: () => Promise.resolve(),
      onPhiOverride: async () => {
        highRiskModalOpened = true;
        throw new Error("must not prompt for high-risk");
      },
      gatewayRequest: async () => { throw new Error("must not call gateway"); },
    }), (err) => err && err.code === "phi_blocked");
    assert.equal(highRiskModalOpened, false);
  });

  test("included Colditz-style studies and screened records populate citation library and References without LLM call", async () => {
    await CHECKPOINT._setBackend({ records: {} });
    const manifest = makeManifest({
      evidence: [
        {
          studyId: "st_aron",
          label: "Aronson 1948",
          values: [{
            field: "events1",
            value: 4,
            verified: true,
            locator: { kind: "manual", citation: "Aronson JD, Am Rev Tuberc 1948; 58:255-281", section: "Results" },
            quote: "4/123 vaccinated vs 11/139 control"
          }]
        },
        {
          studyId: "st_ferg",
          label: "Ferguson & Simes 1949",
          values: [{
            field: "events1",
            value: 6,
            verified: true,
            locator: { kind: "manual", citation: "Ferguson RG, Simes AB, Tubercle 1949; 30:5-11", section: "Results" },
            quote: "6/306 vs 29/303"
          }]
        }
      ],
      references: [
        {
          key: "ref1",
          title: "Primary randomized trial of BCG vaccination",
          authors: ["Doe J"],
          year: 2020,
          doi: "10.1000/trial1",
          screeningDecision: "include"
        },
        ...Array.from({ length: 60 }, (_, idx) => ({
          key: "rec_unscr_" + idx,
          title: "Background cohort " + idx + " on general thoracic epidemiology with extended abstract filler prose",
          authors: ["Author A" + idx],
          year: 2010 + (idx % 10),
          doi: "10.1000/bg." + idx,
          abstract: "Extended background abstract filler sentence. ".repeat(15)
        })),
        {
          key: "rec_inc_screened",
          title: "BCG trial included during abstract screening",
          authors: ["Colditz GA", "Brewer TF"],
          year: 1994,
          doi: "10.1001/jama.1994.03510330076038",
          screeningDecision: "include"
        }
      ]
    });

    const inputs = GATES.buildInputs(manifest);
    assert.ok(inputs.ideaMd.includes("citeKey:aronson_1948"), "idea.md includes deterministic study citeKey");
    assert.ok(inputs.ideaMd.includes("Aronson JD, Am Rev Tuberc 1948; 58:255-281"), "idea.md includes locator citation");
    const citMap = {};
    for (const r of inputs.references) citMap[r.key] = r;
    const compactLib = PROMPTS.formatCitationLibrary(citMap, { maxChars: 2400 });
    assert.ok(compactLib.includes("aronson_1948"), "included study prioritized under tight budget");
    assert.ok(compactLib.includes("ferguson_simes_1949"), "second included study prioritized under tight budget");
    assert.ok(compactLib.includes("rec_inc_screened"), "screened include record kept under tight budget");

    assert.equal(
      GATES.checkNumbers([{ id: "abstract", heading: "Abstract", text: "Heterogeneity I\\textsuperscript{2}={{run:r1.ciUpper}}." }], inputs.tokenTable).length,
      0,
      "I\\textsuperscript{2} exponent not flagged as untokenised number"
    );

    const outlineWithRefs = {
      ...FULL_OUTLINE,
      section_plan: [
        ...FULL_OUTLINE.section_plan,
        { section_title: "5. References", description: "Included references", key_points: [] }
      ]
    };
    const seenSteps = [];
    const ms = await DRAFT.run({
      job: { id: "job_refs_1", projectId: "p1", createdBy: "u1" },
      manifest,
      token: "tok-1",
    }, {
      checkpoint: CHECKPOINT,
      maxRefinementRounds: 0,
      sleep: () => Promise.resolve(),
      gatewayRequest: async (_url, payload) => {
        seenSteps.push(payload.stepId);
        if (payload.stepId === "outline") {
          return { status: 200, data: { text: "```json\n" + JSON.stringify(outlineWithRefs) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        if (payload.stepId === "section:results") {
          return { status: 200, data: { text: "```latex\n\\section{Results}\nAcross trials \\cite{aronson_1948, rec_inc_screened}, pooled effect was {{run:r1.estimate}}.\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        return { status: 200, data: { text: "```latex\n" + sectionLatexFor(payload.stepId) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
      },
      apiRequest: async () => ({ ok: true }),
    });

    assert.ok(!seenSteps.some((s) => s.includes("references")), "References section must not consume an LLM step");
    const refSec = ms.sections.find((s) => s.id === "references");
    assert.ok(refSec && refSec.text.includes("Aronson JD, Am Rev Tuberc 1948"), "References section lists Aronson 1948");
    assert.ok(refSec.text.includes("Ferguson RG, Simes AB"), "References section lists Ferguson & Simes 1949");
    assert.ok(refSec.text.includes("10.1001/jama.1994.03510330076038"), "References section lists cited record");
    assert.ok(ms.references.length >= 3, "manuscript.references populated");
  });

  test("per-section refinement avoids T2 16000-token ceiling and preflight rejects oversized inputs cleanly", async () => {
    await CHECKPOINT._setBackend({ records: {} });
    const manifest = makeManifest();

    /* buildRefinementPrompt must never duplicate currentTex */
    const refPrompt = PROMPTS.buildRefinementPrompt({
      currentTex: "UNIQUE_SECTION_MARKER_XYZ",
      currentReview: { Overall: 6, Weaknesses: ["w1"], Questions: [] },
      currentScore: 6,
      citationMap: { [manifest.references[0].key]: manifest.references[0] },
      maxPromptChars: 12000
    });
    assert.equal(refPrompt.prompt.split("UNIQUE_SECTION_MARKER_XYZ").length - 1, 1, "currentTex appears exactly once");

    /* Pre-flight over-ceiling fails BEFORE spending any gateway call */
    const hugeManifest = makeManifest({
      evidence: [{
        studyId: "s1",
        label: "LongStudy 2024",
        source: { title: "S1", doi: "10.1000/trial1" },
        values: [{
          field: "effect",
          value: 0.62,
          verified: true,
          locator: { page: 1 },
          quote: "Very long verbatim quote sentence for trimming test. ".repeat(1400)
        }]
      }]
    });
    let gwCalls = 0;
    await assert.rejects(() => DRAFT.run({
      job: { id: "job_preflight_big", projectId: "p1", createdBy: "u1" },
      manifest: hugeManifest,
      token: "tok-1",
    }, {
      checkpoint: CHECKPOINT,
      sleep: () => Promise.resolve(),
      gatewayRequest: async () => { gwCalls += 1; throw new Error("must not spend gateway calls"); },
      apiRequest: async () => ({ ok: true }),
    }), (err) => {
      assert.equal(err.code, "ceiling_input_tokens");
      assert.match(err.message, /Trim/i);
      assert.match(err.message, /16000/);
      return true;
    });
    assert.equal(gwCalls, 0, "pre-flight ceiling rejection spends zero gateway calls");

    /* Large drafted sections trigger per-section refinement while staying <= 16,000 tokens per call */
    await CHECKPOINT._setBackend({ records: {} });
    const seenSteps = [];
    let reviewTurn = 0;
    const longFiller = "Additional clinical subgroup methodological elaboration sentence without digits. ".repeat(145);
    const ms = await DRAFT.run({
      job: { id: "job_persec_refine", projectId: "p1", createdBy: "u1" },
      manifest,
      token: "tok-1",
    }, {
      checkpoint: CHECKPOINT,
      maxRefinementRounds: 1,
      sleep: () => Promise.resolve(),
      gatewayRequest: async (_url, payload) => {
        seenSteps.push({ stepId: payload.stepId, chars: (payload.system || "").length + (payload.prompt || "").length });
        const est = DRAFT.estimateTokens((payload.system || "") + "\n\n" + (payload.prompt || "")) + 1000;
        assert.ok(est <= 16000, `step ${payload.stepId} est ${est} must fit T2 16,000 ceiling`);
        if (payload.stepId === "outline") {
          return { status: 200, data: { text: "```json\n" + JSON.stringify(FULL_OUTLINE) + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        if (payload.purpose === "review") {
          reviewTurn += 1;
          return {
            status: 200,
            data: {
              text: "<THOUGHT>ok</THOUGHT><JSON>" + JSON.stringify({
                Summary: "ok", Strengths: ["s"], Weaknesses: reviewTurn <= 3 ? ["Clarify."] : [],
                Originality: 3, Quality: 3, Clarity: 3, Significance: 3,
                Questions: [], Limitations: [], "Ethical Concerns": false,
                Soundness: 3, Presentation: 3, Contribution: 3,
                Overall: reviewTurn <= 3 ? 6 : 8, Confidence: 4, Decision: "Accept"
              }) + "</JSON>",
              model: "m",
              usage: { inputTokens: 10, outputTokens: 10 }
            }
          };
        }
        if (payload.purpose === "refinement") {
          const m = String(payload.prompt || "").match(/SECTION-SCOPED REVISION:\s*([^\)\n]+)/);
          assert.ok(m, "oversized manuscript must invoke section-scoped refinement");
          const heading = m[1].trim();
          const secKey = heading.toLowerCase().includes("abstract") ? "abstract" : ("section:" + heading.toLowerCase().replace(/[^a-z]+/g, ""));
          return {
            status: 200,
            data: {
              text: JSON.stringify({ addressed_weaknesses: ["Clarified"] }) + "\n```latex\n" + sectionLatexFor(secKey) + "\n```",
              model: "m",
              usage: { inputTokens: 10, outputTokens: 10 }
            }
          };
        }
        if (payload.stepId === "abstract") {
          return { status: 200, data: { text: "```latex\n" + sectionLatexFor("abstract") + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } } };
        }
        return {
          status: 200,
          data: { text: "```latex\n" + sectionLatexFor(payload.stepId) + "\n" + longFiller + "\n```", model: "m", usage: { inputTokens: 10, outputTokens: 10 } }
        };
      },
      apiRequest: async () => ({ ok: true }),
    });
    assert.equal(ms.v, 1);
    assert.ok(seenSteps.some((s) => String(s.stepId).startsWith("refine:1:")), "per-section refinement stepIds used");
  });
});
