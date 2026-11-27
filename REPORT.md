# ResearchMD Brief A (`sci-fix-A`) Report

Branch: `rmd-sci-fixes-a`
Worktree: `/Volumes/WD BLACK SN7100 1TB Media/po-wire/wt/scifixA`

---

## Item-by-Item Summary

### 1. Forest plot PNG + results CSV (`research-screen-run.js`)
- **Root cause**: `research-engine.js` (`effectFromRaw`, `effectFromCI`, `effectFromGeneric`) already returns display-scale `r.calc.effect`, `r.calc.ciLower`, and `r.calc.ciUpper` (exponentiated once via `withDisplay` for ratio measures), while keeping `r.calc.yi` and `result.pooled.*` on log scale. `research-screen-run.js` called `Math.exp(r.calc.ciLower)` / `Math.exp(r.calc.ciUpper)` again in `generateForestPlotSvg()` (both axis bounds and row labels) and in `exportCsv()`, double-exponentiating per-study CIs (e.g. Comstock 1976 showed `0.98 [1.79, 5.26]` instead of `[0.58, 1.66]`). Additionally, the SVG layout (`totalWidth = 840`, `colDataX = 185`, `colEffectX = 310`) let long `Data` strings (`"29/17854..."`) collide into `RR [95% CI]`.
- **Fix**: Updated `research-screen-run.js` to read display-scale `r.calc.ciLower`, `r.calc.ciUpper`, and `r.calc.effect` without calling `Math.exp()` a second time (exponentiating only `result.pooled.*` / `result.predictionInterval.*` / `yi` fallback once). Widened the SVG canvas (`totalWidth = 1040`, `colDataX = 205`, `colEffectX = 390`, `plotLeft = 580`, `plotRight = 955`, `colWeightX = 1025`) and truncated long study labels (26 chars) and `Data` strings (24 chars) so columns cannot overlap.
- **Test**: `test/research-sci-fixes-a.test.mjs` ("Item 1: Forest plot single-exponentiation and non-overlapping columns") using `research-engine.js` on Comstock 1976 (`27/16913 vs 29/17854`) and a long study label; `test/run-research-ui.mjs`.
- **Result**: PASS (`0.98 [0.58, 1.66]` rendered, `[1.79, 5.26]` absent, `viewBox="0 0 1040 ..."`, long label truncated).

### 2. PaperOrchestra / manuscript tokens & typography (`backend/research/`, `functions/api/research/_manuscript.js`, `research-po-gates.js`, `research-screen-manuscript.js`)
- **Root cause**: `research-engine.js` stores `pooled.effect`, `pooled.ciLower`, `pooled.ciUpper`, `wald.*`, `hksj.*`, and `predictionInterval.*` on log scale for ratio measures (`RR`/`OR`/`HR`/`ROM`/`IRR`/`RRR`). `loader.py`, `render_tokens.py`, `functions/api/research/_manuscript.js`, `research-po-gates.js`, and `research-screen-manuscript.js` passed or read nested log-scale values raw (`-0.71`) and lacked short-to-nested aliases (`estimate` -> `pooled.effect`, `ciLower` -> `pooled.ciLower`, etc.). In prose cleanup, `latex_to_text` (`writer.py` and `research-po-gates.js`) lacked Greek math symbols (`\tau`, `\chi`, `\alpha`, `\beta`, `\mu`, `\sigma`, `\Delta`), stripped `\tau` leaving `^2=0.31`, did not normalize LaTeX `--`/`---` dashes, and left `{{run:...i2}}%` (`92.2%%`) and `p=< .001`.
- **Fix**:
  - Exponentiated `LOG_RATIO_PATHS` once for ratio engine runs (`scale !== "ratio"`) and added alias resolution (`estimate`, `effect`, `ciLower`, `ciUpper`, `p`, `i2`, `tau2`, `q`, `df`) in `backend/research/paperorchestra/adapter/po_adapter/loader.py`, `gates.py`, `backend/research/manuscript/render_tokens.py`, `functions/api/research/_manuscript.js`, `research-po-gates.js`, and `research-screen-manuscript.js`.
  - Updated `_render_log` in `loader.py` and `renderLog` in `research-po-gates.js` to label ratio display scale (`ratio display scale (null 1.0)`) and instruct on `i2` `%` and `p < .001` formatting.
  - Added Greek symbols (`tau`, `chi`, `alpha`, `beta`, `mu`, `sigma`, `Delta`), URL/table-safe `--`/`---` normalization, `{{run:...i2}}%` deduplication, and `p=< .001` -> `p < .001` cleanup in `writer.py`, `render_tokens.py`, `research-po-gates.js`, and `research-screen-manuscript.js`. Updated `writer.render_tokens` to respect `formatted` / field formatting.
- **Test**: `backend/research/tests/test_manuscript_tokens.py`, `test_po_gates.py`, `test_po_loader.py`, `test_po_writer.py`; `test/research-sci-fixes-a.test.mjs` (Item 2); `test/research-po-device.test.mjs`; `test/run-research-manuscript-ui.mjs`.
- **Result**: PASS.

### 3. Master Chart binary outcome compare (`research-stats.js`, `research-screen-masterchart.js`, `research-explain.js`)
- **Root cause**: `compareCategorical` in `research-stats.js` hardcoded `effect.measure = "OR"`, ignoring study design and dropping RR from the primary display, results paragraph, and CSV even when RR was computed. `research-explain.js` phrased case-control ORs as `"people who got Case"`.
- **Fix**:
  - Added `binaryEffectForDesign(wk, opts)` in `research-stats.js`: RCT/cohort/survival designs emit `measure: "RR"` primary with secondary `or`/`orCiLower`/`orCiUpper`; case-control designs emit `measure: "OR"` only (`rr` omitted) and tag `studyDesign: "case-control"`.
  - Updated `resultsSentence` in `research-stats.js`, `compareText`/`exportCsv`/`drawCompareItem` in `research-screen-masterchart.js` (including passing `studyDesign` from active project), and `effect` in `research-explain.js` to show RR first + secondary OR for RCT/cohort and `"cases vs controls had higher/lower odds of <outcome>"` for case-control.
- **Test**: `test/research-sci-fixes-a.test.mjs` (Item 3), `test/research-stats.test.mjs`, `test/run-research-masterchart-ui.mjs`, `test/run-research-walk-rct-ui.mjs`, `test/run-research-walk-cohort-ui.mjs`, `test/run-research-walk-case-control-ui.mjs`.
- **Result**: PASS.

### 4. AI `manuscript_draft` strips user numbers (`functions/api/research/_ai_draft.js`)
- **Root cause**: `stripBareNumbers()` in `_ai_draft.js` stripped every standalone number in `title`, `abstract`, and `results` regardless of whether it came from the user's title, research question, protocol, studies, or saved Master Chart results (turning `"COVID-19"` into `"COVID-"`, `"6 mg"` into `"mg"`, `"28-day"` into `"-day"`). Also AI output could emit em-dashes (`\u2014`).
- **Fix**: Added `extractAllowedNumbers()` over user/project inputs (`input.title`, `researchQuestion`, `notes`, `resultsText`, `savedResults`, `project.title`, `project.research_question`, protocol, studies, and saved results section when no meta-analysis run exists) and updated `stripBareNumbers(text, allowedNumbers)` to preserve hyphenated identifiers (`[A-Za-z]-$`) and numbers present in `allowedNumbers`, while still stripping ungrounded numbers. Added `noEmDash()` normalization in `manuscriptDraft` and `caseReportDraft`.
- **Test**: `test/research-sci-fixes-a.test.mjs` (Items 4, 5, 8) and `test/research-phase5-api.test.mjs`.
- **Result**: PASS (`COVID-19`, `6 mg`, `28-day`, `12/80` survive; ungrounded `0.49` and em-dash stripped).

### 5. "Use in my manuscript" results ignored by "Ask MaiK to draft it" & gate-blocked export copy (`research-screen-manuscript.js`, `functions/api/research/_ai_draft.js`, `functions/api/research/_manuscript.js`, `research.js`)
- **Root cause**: `startManuscriptDraft()` in `research-screen-manuscript.js` did not send the saved `results` section (`resultsText`) to `POST /ai-draft`, and `_ai_draft.js` did not include saved primary-study results in the prompt. Primary studies with zero meta-analysis runs were also gated as if they required `{{run:...}}` tokens in `_manuscript.js` `gatesFor()`, causing 422 `gate_failed` on DOCX export. On `gate_failed`, `friendlyError` fell back to `"Something went wrong on our side."`, and `Promise.all([pMan, pVers])` in `load()` checked `res.manuscript` instead of `res[0].manuscript`.
- **Fix**:
  - `startManuscriptDraft()` now extracts saved `results` text (checking both `st.manuscript` and `localManuscript`) and sends `input.resultsText`.
  - `_ai_draft.js` injects `Saved study analysis results` into the `manuscript_draft` prompt and adjusts the numbering rule when no `{{run:...}}` tokens exist.
  - `applyManuscriptDraft()` syncs drafted sections to the server (`PUT .../manuscript/sections/:id`) and `exportDocx()` awaits `st.draftSyncPromise` before calling `/manuscript/export`.
  - `_manuscript.js` `gatesFor()` only requires `{{run:...}}` tokens for systematic reviews / meta-analyses or projects with runs/tokens, allowing grounded primary-study manuscripts to pass export gates.
  - `research.js` `friendlyError()` maps `gate_failed` to plain guidance, and `exportDocx()` displays `gateCopy(failures[0])` in plain words.
  - Fixed `load()` in `research-screen-manuscript.js` to read `res[0].manuscript` and `res[1].versions`.
- **Test**: `test/research-sci-fixes-a.test.mjs` (Items 4, 5, 8, 9), `test/run-research-manuscript-ui.mjs`.
- **Result**: PASS.

### 6. `"Drafted by MaiK, check it:"` leaked into saved section text (`research-screen-manuscript.js`)
- **Root cause**: Case report drafting prepended `var markPrefix = "Drafted by MaiK, check it:\n"` directly into `sec.text`, persisting UI badge text into saved manuscript sections and exports.
- **Fix**: Removed `markPrefix` injection from section prose in `research-screen-manuscript.js`; tracked AI-drafted section IDs in `st.aiDraftedSections`, `st.manuscript.ai.draftedSectionIds`, and local draft metadata so the `"Drafted by MaiK, check it"` banner/pill renders purely as UI chrome (`isSectionAiDrafted`).
- **Test**: `test/research-sci-fixes-a.test.mjs` (Item 6), `test/run-research-manuscript-ui.mjs`, `test/run-research-casereport-ui.mjs`.
- **Result**: PASS.

### 7. Reference-only records sent `inputs: {}` to `POST /studies` (`research-screen-novelty.js`, `research-screen-search.js`, `research-store.js`)
- **Root cause**: `research-screen-novelty.js` and `research-screen-search.js` called `SMD.store.createStudy()` with `inputs: {}`, which queued/posted to `/studies` and failed with 400 `invalid_study` while the UI reported `"Added to your references"` without awaiting or checking server errors.
- **Fix**: Updated `research-screen-novelty.js` ("Add to my references") and `research-screen-search.js` ("+ Add to Studies") to persist reference records via `POST /v1/projects/:id/records` (`createDirectRecord`), wait for server completion, and display errors (`st.addError` / `st.topicError`) on failure instead of faking success. Updated `research-store.js` `createStudy` to never queue or POST `study_create` when `inputs` is empty.
- **Test**: `test/research-sci-fixes-a.test.mjs` (Item 7), `test/run-research-novelty-ui.mjs`, `test/run-research-phase2-ui.mjs`.
- **Result**: PASS.

### 8. `GET /manuscript` 404 console error on fresh projects (`functions/api/research/_manuscript.js`, callers, `test/research-phase5-api.test.mjs`)
- **Root cause**: `getManuscript()` returned HTTP `404 manuscript_not_found` when a project had no manuscript yet, causing 404 console/network errors on every fresh project.
- **Fix**: Audited all callers (`research-screen-manuscript.js`, `research-doc-editor.js`, `research-screen-checklist.js`, `research-screen-thesis.js`, `research.js`, `research-tutorial.js`). Updated `getManuscript()` in `functions/api/research/_manuscript.js` to return `200 { manuscript: null }` when no explicit `?version=` is requested and no manuscript exists yet, while keeping `404 manuscript_not_found` for nonexistent explicit `?version=N` and outsider access.
- **Test**: `test/research-sci-fixes-a.test.mjs` (Item 8), `test/research-phase5-api.test.mjs`, `test/run-research-manuscript-ui.mjs`.
- **Result**: PASS.

### 9. DOCX export `409 publication_consent_required` & consent sync (`research.js`, `research-screen-manuscript.js`, `research-screen-pubconsent.js`)
- **Root cause**: `research-screen-pubconsent.js` saved the consent document only to local `RMDStore` unless the separate `"Confirm consent"` card below was submitted, and `research.js` `friendlyError()` did not map `publication_consent_required`, causing export to show `"Something went wrong on our side."`.
- **Fix**:
  - Added `publication_consent_required` mapping in `research.js` `friendlyError()` (`"Confirm the patient's written consent first."`, action `"pubconsent"`, label `"Open Publication consent"`) and `errHtml()` button handler in `research.js`.
  - Updated `exportDocx()` in `research-screen-manuscript.js` to set `st.consentBlocked = true`, display `"Confirm the patient's written consent first."`, and render an `"Open Publication consent"` button that navigates to `"pubconsent"`.
  - Updated `persistRecord()` in `research-screen-pubconsent.js` so saving the main consent form also calls `POST /v1/projects/:id/publication-consent` automatically when both confirmation statements are ticked and a valid consent date is filled.
- **Test**: `test/research-sci-fixes-a.test.mjs` (Item 9), `test/run-research-pubconsent-ui.mjs`, `test/run-research-manuscript-ui.mjs`, `test/run-research-casereport-ui.mjs`.
- **Result**: PASS.

### 10. Literature search: Quick search input loss & Europe PMC 524 timeout (`research-screen-search.js`, `functions/api/research/_auto_studies.js`, `functions/api/research/[[path]].js`, `functions/api/research/_connectors/*.js`)
- **Root cause**:
  - In `research-screen-search.js`, background `loadTrialsAvailability()` called `render(container)` after render, resetting `#rmd_topic_q` if DOM text wasn't preserved across re-renders. Also `#rmd_search_query` needed per-database tracking (`data-rmd-query-db`) so switching databases didn't overwrite the target DB's query.
  - On the server, `findStudies()` (`_auto_studies.js`) used `Promise.allSettled` with a 60s ceiling and no per-source timeout/abort; `pubmed.js`, `pubmed_efetch.js`, `crossref.js` did not forward `timeoutMs`/`maxRetries`/`signal` to `fetchWithRetry`; and `createSearchRun()` (`[[path]].js`) + `europepmc.js` paged through all cursor pages (thousands of hits, e.g. `4360`) and fetched `resultType=core` for every ID until Cloudflare timed out with HTTP 524 (>120s, confirmed in `outputs/meta/network.json`).
- **Fix**:
  - `research-screen-search.js`: preserved `#rmd_topic_q` and `#rmd_search_query` values across `render()` / `runTopicSearch()` / `runSearch()` (using `data-rmd-query-db` and non-empty check so programmatic `oninput` stubs remain intact), prevented redundant re-renders in `loadTrialsAvailability()`, and rendered `data.notice` for partial search results.
  - `_auto_studies.js` & `_connectors/`: added `runSourceWithTimeout` (default `10000`ms per source, configurable via `RESEARCH_SOURCE_TIMEOUT_MS`), forwarded `timeoutMs`/`maxRetries`/`signal` through `pubmed.js`, `pubmed_efetch.js`, `crossref.js`, `europepmc.js`, and returned `200` partial results with `partial: true`, `failedSources`, and `notice` when one source times out.
  - `[[path]].js` `createSearchRun()` + `europepmc.js`: added a 50s total budget (`22000`ms per-request timeout, `maxRetries: 1`, `partialOnBudget: true`) for Europe PMC searches, capping `search()` cursor paging at ~55% of budget, capping `core` fetch at 200 IDs with `liteRecords` fallback, and returning `201` with `partial: true` and `notice`.
- **Test**: `test/research-sci-fixes-a.test.mjs` (Item 10), `test/research-f20-sources.test.mjs`, `test/run-research-phase2-ui.mjs`, `test/run-research-live-fixes-ui.mjs`.
- **Result**: PASS.

---

## Verification Summary
- **Client syntax checks (`node --check`)**: all 11 modified client JS files passed.
- **Em-dash check**: zero `\u2014` in all 11 modified client JS files.
- **ResearchMD unit/integration suite (`test/research*.test.mjs`, flagged)**: **95/95 test files passed** (including `test/research-sci-fixes-a.test.mjs`, `test/research-phase5-api.test.mjs`, `test/research-f20-sources.test.mjs`).
- **Headless Chrome UI harnesses (`test/run-research-ui.mjs` + all `test/run-research-*-ui.mjs`)**: **34/34 passed**.
- **Python backend suite (`/Volumes/WD BLACK SN7100 1TB Media/po-wire/venv/bin/pytest backend/research/tests/`)**: **434 passed, 1 skipped**; 17 failed solely in `test_worker_app.py`, `test_worker_extract.py`, and `test_worker_jobs.py` due to missing native `libresearch_pdf.so` binary in this macOS worktree (`RustPdfUnavailable`). All PaperOrchestra, token, PHI, and manuscript API tests passed.
- **Full `npm test`**: ran after the final code edit; **all ResearchMD tests passed** (0 failures across `test/research*.test.mjs`). Outside ResearchMD, 9 pre-existing unrelated tests failed in this worktree (`test/build-slim.test.mjs`, `test/edge-schemas.test.mjs`, `test/narke-drills.test.mjs`, `test/no-side-stripes.test.mjs`, `test/remote-media.test.mjs`, `test/tokos-drill-core.test.mjs`, `test/tokos-learn-gyA.test.mjs`, `test/wardsynq-i18n-unwrapped.test.mjs`, `test/wardsynq-reachability.test.mjs` — e.g. missing gitignored `prep/figures/` assets or `%20`-encoded spaces in the worktree path).
