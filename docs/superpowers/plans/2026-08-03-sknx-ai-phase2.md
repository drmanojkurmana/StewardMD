# SknX AI — Phase 2: Evidence Reasoning + Educational Report — Plan

> Mock-first, like Phase 1. The deterministic mock evidence + reasoner stand in for Cloudflare Vectorize + Gemini/Vertex with the swap-seams ready. No real cloud creds needed to build/test.

**Goal:** From a Phase-1 analysis, produce an evidence-grounded educational report (all sections, cited) rendered in the result screen, with Explain-Like re-leveling and Compare-Diseases, plus a `/api/sknx` server scaffold and a branded PDF export.

**Global constraints (inherit Phase 1):** ES5 IIFE + dual export; `window.SMD_SKNX_*` namespace; no em-dash in UI text; behind `smd_sknx` (off) + v2beta; NO prescription/Rx affordance in this phase (Rx is Phase 3 — the report is educational only); **never fabricate references — every citation must come from the provided evidence corpus** (a test asserts this); the reasoner never receives ONLY the raw image (always analysis + features + evidence). Tests: `node --test test/sknx-*.test.mjs`. Report render is validated by extending `test/run-sknx-ui.mjs`.

---

### Task 1: `sknx-evidence.js` — seed evidence corpus + retrieval (mock RAG)
**Files:** create `sknx-evidence.js`, `test/sknx-evidence.test.mjs`.
**Interface:** `SMD_SKNX_EVIDENCE.retrieve(labels[], opts) -> [{id, source, title, snippet, url, tags[]}]` (ranked by label/tag overlap; deterministic). `SMD_SKNX_EVIDENCE.CORPUS` (a small seeded array, ~12-20 entries covering the mock conditions: psoriasis, eczema, acne, tinea, melanoma, BCC etc.; each entry {id, source: "AAD|BAD|NICE|WHO|DermNet", title, snippet, url, tags:[condition labels]}). No network; this is the Vectorize stand-in.
**Tests:** retrieve(["psoriasis"]) returns >=1 entry all tagged psoriasis; retrieve for an unknown label returns []; every returned entry has a non-empty `source`+`url` (citation integrity).

### Task 2: `sknx-llm.js` — reasoning contract + deterministic mock reasoner
**Files:** create `sknx-llm.js`, `test/sknx-llm.test.mjs`.
**Interface:** `SMD_SKNX_LLM.buildReport({analysis, features, evidence, context}, deps) -> reportPayload` where reportPayload = `{ quality, visualFindings, differential:[{label, why, whyNot}], redFlags:[], discussion, guidelineSummary:[{point, source, url}], investigations:[], management:[], followup:[], references:[{source,title,url}], disclaimer }`. Also `SMD_SKNX_LLM.explainAs(reportPayload, audience) -> reportPayload'` (audience in "mbbs|intern|resident|consultant|patient" — re-levels the discussion text length/tone via templates). Phase 2 = deterministic mock: assemble sections from the analysis differential + the retrieved `evidence` (guidelineSummary + references are DERIVED FROM `evidence` only — never invented). The real swap: `deps.remote` (the `/api/sknx` call) when available, else the mock.
**Tests:** buildReport with a psoriasis analysis + psoriasis evidence -> references all come from the passed evidence (assert every reference.url is one of evidence[].url — the no-hallucination guarantee); redFlags populated when analysis.referral; NO `rx`/`prescription` key anywhere in the payload; explainAs("patient") returns a payload whose discussion differs from "consultant".

### Task 3: `functions/api/sknx/[[path]].js` — server scaffold (Gemini/Vertex proxy stub)
**Files:** create `functions/api/sknx/[[path]].js`, `test/sknx-api.test.mjs`.
**Interface:** POST `/api/sknx/report` accepts `{analysis, features, evidence, context}` (NOT the raw image — reject/ignore any `image` field with a 400 + a comment: the image never leaves the device / never goes to the LLM alone). Reuses the `kardiox-vertex.js` credential path; when creds are absent (dev/test) returns a deterministic mock payload from the same shape as `sknx-llm.buildReport`. Metering hooks mirror `functions/api/thorex` (`_usage`, `_aibudget`) but no-op if absent. Health-gated: falls back to the client mock if unreachable.
**Tests (node):** a `report` request without creds returns 200 + a valid payload shape; a request that includes an `image` field is rejected (400) — enforces "no raw-image-only to the LLM".

### Task 4: `sknx-report.js` — render the report + Explain-Like + Compare + PDF
**Files:** create `sknx-report.js`, `test/sknx-report.test.mjs` (logic-level: the HTML-builder returns strings; assert structure).
**Interface:** `SMD_SKNX_REPORT.html(reportPayload) -> string` (all sections in order: quality, visual findings, differential with why-fits/why-not, red flags, educational discussion, guideline summary WITH inline citation links, investigations, management [educational only], follow-up, references list). Every guideline/management claim shows its `source` as a clickable `url`. Fixed educational disclaimer block. `SMD_SKNX_REPORT.pdf(reportPayload)` -> triggers the branded PDF (reuse the ThoreX report/print pattern; a native WKWebView->PDF path where available, else print). `SMD_SKNX_REPORT.explainControls()` -> the Explain-Like segmented control markup (audiences).
**Tests:** html(payload) contains each section heading; contains a citation `<a href>` for every guidelineSummary entry; contains NO element with class `sknx-rx` and NO "prescription"/"prescribe" text; disclaimer present.

### Task 5: `sknx-compare.js` — Compare-Diseases
**Files:** create `sknx-compare.js`, `test/sknx-compare.test.mjs`.
**Interface:** `SMD_SKNX_COMPARE.compare(labelA, labelB, deps) -> { rows:[{feature, a, b}], sources:[] }` from the evidence corpus + a small curated feature matrix (clinical features, distribution, key differentiator). `SMD_SKNX_COMPARE.html(cmp) -> string` (a comparison table). Common pairs pre-seeded (psoriasis vs tinea, melanoma vs nevus, BCC vs SCC, rosacea vs acne).
**Tests:** compare("psoriasis","tinea") returns >=3 rows; html contains both labels and a table.

### Task 6: wire the report into the result screen + extend the e2e
**Files:** modify `sknx-screens.js` (result screen: after the differential, render an "Educational report" section built via providers->llm->report, an Explain-Like control that re-levels, and a Compare entry; still NO Rx affordance); modify `sknx-providers.js` or add a thin `sknx-report-bridge` so the screen gets `{analysis, evidence, reportPayload}` from one call (mock path); modify `index.html` (register the new sknx-evidence/llm/report/compare scripts in the correct load order — evidence before llm before report); extend `test/run-sknx-ui.mjs` with assertions: the report section renders with >=1 citation link, Explain-Like switches the discussion text, and there is STILL no `.sknx-rx` element.
**Tests:** `bash scripts/build-www.sh && node test/run-sknx-ui.mjs` passes with the new report assertions.

## Self-review checklist
- No-hallucination: references/guideline citations derive only from the evidence corpus (Task 2 + Task 4 tests).
- No Rx anywhere in Phase 2 (report is educational; Task 2/4 tests assert absence).
- Server never gets the raw image alone (Task 3 test).
- Load order in index.html: evidence -> llm -> report -> compare, after the Phase-1 sknx scripts.
- Educational disclaimer on every report.
