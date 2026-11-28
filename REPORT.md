# ResearchMD Scientific Fixes D (`rmd-sci-fixes-d`) Report

- **Worktree**: `/Volumes/WD BLACK SN7100 1TB Media/po-wire/wt/scifixD`
- **Branch / Commit**: `rmd-sci-fixes-d` (`bf8d66c3b`) based on `origin/main` (`870db0852`)
- **External test script update**: `/Users/mkk/prep-data/assessment/rmd-live/e2e/06-scientist.mjs`

## 1. Root Causes & Fixes Implemented

### Issue 1: False PHI block on Meta-Analysis PaperOrchestra draft
- **Root cause (reproduced from `job_e010d5b03dcd4c36afdabb63317040c5` on `prj_64f21080635646d3802ef8062573c91e`)**:
  1. `scanPhi` / `scan` flagged 7 `patient_name` (`name_near_patient_label`) false positives inside the formatted `citation_map.json` reference library of `buildSectionPrompt`: `"Extracellular Vesicles From"`, `"Asymptomatic Tuberculosis Patients"`, `"Nieto Ramirez"` (on `\nAuthors:` across a newline from `Patients.`), `"Catheter Type"`, `"Patient Comfort"`, `"Intravesical Bacillus Calmette"`, and `"Bladder Cancer Patients"`.
  2. Additionally, formatting all 143 reference entries verbatim produced `63,984` chars (`16,997` estimated tokens with `GATEWAY_FRAMING_TOKENS = 1000`), which exceeded the T2 `16,000`-token input ceiling (`ceiling_input_tokens`).
  3. PaperOrchestra (`POST /jobs`, `POST /v1/internal/llm`, `POST /jobs/:id/device-result`, and on-device `research-ondevice-draft.js`) did not yet expose the single-button `"False detection, ignore and go ahead"` (`PHI_OVERRIDE_CONDITIONS = ["false_positive"]`) override used by Ask MaiK.
- **Fixes**:
  - Updated [research-po-gates.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-po-gates.js), [functions/api/research/_phi.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_phi.js), and [backend/research/paperorchestra/adapter/po_adapter/phi.py](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/backend/research/paperorchestra/adapter/po_adapter/phi.py) identically:
    - Removed plural `patients` from `PATIENT_LABEL` / `_PATIENT_LABEL` while keeping singular `patient`, honorifics (`Mr.`, `Mrs.`, `Ms.`), and clinical labels (`admitted`, `discharged`, `diagnosed`, `ward`, `bed no`, `IP no`, `OP no`).
    - Scoped `name_near_patient_label` to the same line and sentence (`phiSameLineSentence` / `sameLineSentence` / `_same_line_sentence`, preserving honorific abbreviations `Mr.`, `Mrs.`, `Ms.`, `Dr.`), and rejected Title Case noun phrases ending in `Patient`/`Patients` or starting with `Patient `/`Patients ` with fewer than 2 trailing words.
    - Added `{ allowCitationLibraryNames: true }` (`phiCitationLibrarySpans` / `citationLibrarySpans` / `_citation_library_spans`) suppressing `patient_name` hits inside delimited PaperOrchestra citation-library sections while keeping `phone`, `email`, `mrn`, `aadhaar`, `abha`, `ssn`, `nhs`, `dob`, `address`, and `dates` strictly blocked everywhere.
  - Enabled `{ allowCitationLibraryNames: true }` in [research-ondevice-draft.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-ondevice-draft.js), [functions/api/research/_gateway.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_gateway.js), and [backend/research/paperorchestra/adapter/po_adapter/llm.py](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/backend/research/paperorchestra/adapter/po_adapter/llm.py).
  - Updated `formatCitationLibrary`, `buildSectionPrompt`, and `buildRefinementPrompt` in [research-po-prompts.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-po-prompts.js) and [research-ondevice-draft.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-ondevice-draft.js) to omit redundant `"Abstract: No abstract available."` lines and compactly stay within the T2 `16,000`-token ceiling (real snapshot section prompt verified at `51,827` chars / `13,957` estimated tokens with `{ blocked: false, hits: [] }`).
  - Added consistent `false_positive` override support across [functions/api/research/_jobs.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_jobs.js), [functions/api/research/_gateway.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_gateway.js), [research-ondevice-draft.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-ondevice-draft.js), [research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-manuscript.js), and [research.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research.js) (high-risk categories and `patient_name` remain never-overridable).

### Issue 2: Meta DOCX export with no manuscript (`404 manuscript_not_found`)
- Handled `err.code === "manuscript_not_found"` / `err.status === 404` in `exportDocx()` ([research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-manuscript.js)) and `friendlyError()` ([research.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research.js)) to display `"Draft the manuscript first."` with a `44px`-tall `.rmd-btn-primary` button (`[data-rmd="draft-manuscript-first"]`) labeled `"Draft the manuscript"` that launches the study's drafting flow instead of `"Something went wrong on our side."`.

### Issue 3: Case Report Publication Consent
- Confirmed `persistRecord` in `research-screen-pubconsent.js` works when checkboxes `#rmd-pc-written`, `#rmd-pc-saw`, and `#rmd-pc-date` are completed and `[data-rmd="confirm-pubconsent"]` is clicked. The previous `06-scientist.mjs` failure occurred because the test script only saved `#rmd-maik-english` without completing the attestation or clicking `[data-rmd="confirm-pubconsent"]`.
- Updated `/Users/mkk/prep-data/assessment/rmd-live/e2e/06-scientist.mjs` to check both statements, set today's date, and tap `[data-rmd="confirm-pubconsent"]` before DOCX export.

### Issue 4: Thesis Ready screen empty
- **Root cause**: `saveDraft(container)` in [research-screen-thesis.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-thesis.js) unconditionally called `SMD.navigate("thesis-tables")` when its async `PUT` requests completed, tearing down the active `Ready` DOM container if the user had already navigated to `Ready` while `saveDraft` was still in-flight (causing `renderReady` in [research.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research.js) to write `.rmd-ready-screen` into the detached container).
- **Fixes**: Guarded `saveDraft` in [research-screen-thesis.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-thesis.js) with `isDomMounted(container)` so it never hijacks navigation when the user has moved away, and guarded `renderReady` in [research.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research.js) against screen changes and detached containers (re-binding `#rmdScreenBody` if still on `ready`).

### Cache-Busting & Bundle
- Bumped `?v=` tokens with `-scid1` in [index.html](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/index.html) and appended `-scid1` to `CACHE` in [sw.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/sw.js).
- Assembled `www/` cleanly via `bash scripts/build-www.sh`.

## 2. Verification Results

- **Syntax & em-dash checks**: `node --check` passed on all modified JS files; zero `—`/`–` added in client JS files.
- **Python PHI parity**: `python3` check over `docs/research/contracts/phase-3/phi-vectors.json` (133 cases) and `test/fixtures/research/po/phi-vectors.json` (18 block, 10 clean) passed (`PYTHON_PHI_OK`).
- **Node unit suites** (`node --experimental-test-module-mocks --experimental-sqlite test/research-*.test.mjs test/phi-india.test.mjs`): all suites passed after final edit, including updated tests in `test/research-po-device.test.mjs`, `test/research-phi-override.test.mjs`, `test/research-phi-override-ui.test.mjs`, and `test/research-po-job.test.mjs`. *(Note: an earlier full `npm test` before the final test fixes reported 14 failures: 2 expected assertion mismatches in `test/research-po-device.test.mjs` and `test/research-po-job.test.mjs` plus `test/research-ready-state.test.mjs` — all fixed and verified passing in the final run — along with unrelated pre-existing suite failures in `test/build-slim.test.mjs`, `test/edge-schemas.test.mjs`, `test/narke-drills.test.mjs`, `test/no-side-stripes.test.mjs`, `test/prep-ask-answers.test.mjs`, `test/remote-media.test.mjs`, `test/tokos-drill-core.test.mjs`, `test/tokos-learn-gyA.test.mjs`, `test/wardsynq-i18n-unwrapped.test.mjs`, `test/wardsynq-reachability.test.mjs` such as URL `%20` decoding on worktree paths containing spaces.)*
- **Headless CDP UI suites** (after final edit & `build-www.sh`):
  - `node test/run-research-manuscript-ui.mjs`: PASS (includes new `404 manuscript_not_found` -> `"Draft the manuscript first."` + 44px button regression)
  - `node test/run-research-thesis-ui.mjs`: PASS (includes new in-flight `saveDraft` -> immediate `Ready` navigation regression showing `.rmd-ready-screen` and `[data-rmd="format-check-card"]`)
  - `node test/run-research-compliance-ui.mjs`: PASS
  - `node test/run-research-rct-ui.mjs`: PASS
  - `node test/run-research-pubconsent-ui.mjs`: PASS
  - `node test/run-research-casereport-ui.mjs`: PASS
- **Live `06-scientist.mjs` run (`CDP_PORT=9473 ANY_USER=1 RMD_BASE_URL=http://127.0.0.1:8812 node 06-scientist.mjs`, 5 AI calls used <= 6 cap)**:
  - `[rct]`: all PASS
  - `[casecontrol]`: all PASS
  - `[casereport]`: all PASS (including `[pubconsent] Publication consent save + DOCX export` and `[manuscript] Export manuscript DOCX`)
  - `[thesis]`: all PASS (including `[ready] Journal format & readiness checks -> hasFormatCard=true`)
  - `[meta]`: cleared client-side `scanPhi` and `outline` (2 calls to `/v1/internal/llm` succeeded with 200), then failed on live **undeployed server** code at `section 1 of 7` where live `stewardmd.in` `/api/research/v1/internal/llm` still runs old `_phi.js`/`_gateway.js` and returned `422 phi_blocked` (`categories: ["patient_name"]`).
    - **Rows depending on undeployed server code (`functions/api/research/{_phi,_gateway,_jobs}.js`)**:
      1. `[manuscript] [meta] PaperOrchestra full manuscript draft` (needs deployed `_phi.js` + `_gateway.js` on `stewardmd.in`)
      2. `[manuscript] [meta] Export manuscript DOCX` (blocked on `#rmdPhiOverrideModal` that opened on non-overridable gateway 422 before the final post-run refinement in `bf8d66c3b`; Issue 2 UI independently verified PASS in `test/run-research-manuscript-ui.mjs`)
      3. `[checklist] [meta] Checklist () + Export CSV` (cascaded from modal overlay during that run prior to `bf8d66c3b`).

---

# Brief E: Manuscript Quality for Primary Studies (`rmd-sci-fixes-d`)

## 1. Fixes Implemented

### Issue 1: Canonical section order everywhere + Thesis sequential save
- **Server (`functions/api/research/`)**:
  - Added `TEMPLATE_SECTION_RANK`, `sectionTemplateRank`, and `sortSectionsInTemplateOrder` in [functions/api/research/_manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_manuscript.js), preserving `level > 1` subsections beneath their parent section, and applied it in `loadSections(db, versionId)`.
  - Imported and applied `sortSectionsInTemplateOrder` in [functions/api/research/_format_check.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_format_check.js) (`formatCheck`) and [functions/api/research/_checklists.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_checklists.js) (`checklistSnapshot`).
- **Client ([research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-manuscript.js))**:
  - Added `TEMPLATE_SECTION_RANK`, `sectionTemplateRank`, and `sortSections` (keeping `level > 1` subsections under parent), applied across `sectionSidebarItems`, `load`, `showDraftPreviewModal`, `applyManuscriptDraft`, `buildDocxBytes`, `localManuscript`, and `appendManuscriptResults`.
- **Thesis parallel save race ([research-screen-thesis.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-thesis.js))**:
  - Updated `saveDraft` to chain `PUT /manuscript/sections/:id` sequentially in `draft.sections` order instead of `Promise.all` (fixing `Discussion` previously saving before `Methods`).

### Issue 2: Master Chart "Use in my manuscript" result text
- **[research-screen-masterchart.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-masterchart.js)**:
  - Added `humanColumnLabel` (respecting `varLabels`, converting `death_28d` -> `"death by 28 days"`, expanding `_` and trailing lab/time units) and used it in `runAnalysis`, `t1Label`, `drawCompareItem`, `compareText`, and `manuscriptText`.
  - Removed the duplicated chi-square summary block appended after `r.paragraph` in `manuscriptText` for `compare` / `related`.
- **[research-stats.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-stats.js)**:
  - Added `categoricalGroupSummary` and updated `resultsSentence` when `opts.includeN` is truthy so categorical compares include group counts and percentages (e.g. `482 of 2104 (22.9%) in Dexamethasone vs 1110 of 4321 (25.7%) in Usual care`) and numeric compares include group `n` and summary dispersion.

### Issue 3: Primary-study structured inputs for AI drafting without PHI false positives
- **[research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-manuscript.js)** & **[research-screen-randomise.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-randomise.js)**:
  - Extended `randomise` saved fingerprint (`ratio`, `blockSizes`, `strata`) and updated `startManuscriptDraft` to load Plan (`smd_research_plan_*` + `SMD_RESEARCH_SAMPLESIZE`), IEC, CTRI, Randomise (`randomfingerprint` + `blinding`), and CONSORT from `RMDStore`, scrubbing `YYYY-MM-DD` dates to `Month YYYY` (`formatMonthYear`) and passing both structured fields and a concise `input.notes` summary.
- **[functions/api/research/_ai_draft.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_ai_draft.js)**:
  - Added `scrubFullDatesForPrompt`, `cleanPromptObj`, and `planProportionPctStrings`, and updated `manuscript_draft` system instructions, prompt formatting, and `extractAllowedNumbers` to ground all Plan/sample-size/allocation/IEC/CTRI/CONSORT numbers.

### Cache-Busting, Tests & Bundle
- Appended `-scie1` to affected `?v=` tokens in [index.html](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/index.html) and to `CACHE` in [sw.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/sw.js).
- Added [test/research-sci-fixes-e.test.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/test/research-sci-fixes-e.test.mjs) and updated slow-save wait timing in [test/run-research-thesis-ui.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/test/run-research-thesis-ui.mjs).
- Rebuilt `www/` via `bash scripts/build-www.sh` (`build: #1386`).

## 2. Verification Results

- **Unit suite (`npm test`)**: All 102 `test/research-*.test.mjs` test files passed (`0` failures across all `research-*` suites, including `test/research-sci-fixes-e.test.mjs`). The overall `npm test` run reported 9 pre-existing non-research failures caused by URL-encoded `%20` spaces in the worktree directory path (`test/build-slim.test.mjs`, `test/edge-schemas.test.mjs`, `test/narke-drills.test.mjs`, `test/no-side-stripes.test.mjs`, `test/remote-media.test.mjs`, `test/tokos-drill-core.test.mjs`, `test/tokos-learn-gyA.test.mjs`, `test/wardsynq-i18n-unwrapped.test.mjs`, `test/wardsynq-reachability.test.mjs`).
- **Headless CDP UI suites**: All 34 `test/run-research-*-ui.mjs` scripts ran sequentially and exited `0` (`ALL_RESEARCH_UI_PASSED`).
- **Live `06-scientist.mjs` run (`CDP_PORT=9473 ANY_USER=1 RMD_BASE_URL=http://127.0.0.1:8812 node 06-scientist.mjs`)**:
  - `[rct]`: all steps PASS (`masterchart` result uses `"death by 28 days"`, `"482 of 2104 (22.9%) in Dexamethasone vs 1110 of 4321 (25.7%) in Usual care"`, no duplicate chi-square sentence; `Ask MaiK` drafted Methods with sample size, IEC, and CTRI numbers and 0 PHI blocks; exported `-draft.docx` section order: `Abstract -> Introduction -> Methods -> Results -> Discussion`).
  - `[casecontrol]`: all steps PASS (`masterchart` result uses `"smoking"`, `"647 of 649 (99.7%) in Case vs 622 of 649 (95.8%) in Control (odds ratio 14.04, 95% CI 3.33 to 59.30; Chi-square test, p < 0.001)."`, no duplicate chi-square sentence; exported `-draft.docx` section order: `Abstract -> Introduction -> Methods -> Results -> Discussion`).
  - `[casereport]`: all steps PASS (exported `-draft.docx`: `Abstract -> Introduction -> Case Presentation -> Timeline -> Discussion -> Conclusion`).
  - `[thesis]`: all steps PASS (`thesis/manuscript.md` server API order: `Abstract -> Introduction -> Methods -> Results -> Discussion`).
  - *Undeployed server caveat*: In `outputs/rct/manuscript.md` and `outputs/casecontrol/manuscript.md`, `06-scientist.mjs` snapshots `GET /api/research/projects/:id/manuscript` (`Source: server API`) from remote `stewardmd.in`, which does not yet have Brief E's server-side `_manuscript.js` sort deployed (hence `## Results` appears first in those two `manuscript.md` snapshots while the local-bundle `-draft.docx` exports are in canonical order). The `[meta]` track also failed on the undeployed remote PaperOrchestra server (`Input exceeds tier token ceiling` / `Draft the manuscript first.`).

## 3. New RCT & Case-Control Methods and Results (`06-scientist.mjs`)

### RCT (`/Users/mkk/prep-data/assessment/rmd-live/e2e/outputs/rct/manuscript.md`)

#### Methods

This study was described as a randomized controlled trial comparing dexamethasone 6 mg daily with usual care. The supplied sample-size note states that, assuming complication rates of 22.9% in Group 1 and 25.7% in Group 2, with 5% significance and 80% power, 3683 patients per group were estimated to be needed; allowing for 10% loss to follow-up, the planned enrolment was 4092 per group (8184 total). The supplied notes state that ethics approval was granted under reference IEC/2021/REC-01, but the approval date is unspecified. Trial registration is reported as CTRI/2020/03/024100; the registration date is unspecified. The protocol field was empty. Further methodological details were not provided.

#### Results

The risk of death by 28 days was 482 of 2104 (22.9%) in Dexamethasone vs 1110 of 4321 (25.7%) in Usual care (risk ratio 0.89, 95% CI 0.81 to 0.98; odds ratio 0.86, 95% CI 0.76 to 0.97; Chi-square test, p = 0.017).

### Case-Control (`/Users/mkk/prep-data/assessment/rmd-live/e2e/outputs/casecontrol/manuscript.md`)

#### Methods

A case-control study compared smoking status between men with lung carcinoma (cases) and men without lung carcinoma (controls). The available study record does not provide further details about participant selection, smoking measurement, or analysis procedures.

#### Results

Cases vs controls had higher odds of smoking: 647 of 649 (99.7%) in Case vs 622 of 649 (95.8%) in Control (odds ratio 14.04, 95% CI 3.33 to 59.30; Chi-square test, p < 0.001).

---

# Brief F: Remaining Live Button-Suite Fixes (`rmd-sci-fixes-d`)

## 1. Root Causes & Fixes Implemented

### Issue 1: Case Report on tablet (1024x1366) Ask MaiK draft + section save + DOCX export
- **Root causes**:
  1. `openCaseReportDraftModal` in [research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-manuscript.js) only saved the drafted Case Report sections to `localStorage` (`saveLocalManuscript`) and never synced them to the server, leaving the project without a server manuscript (`404 manuscript_not_found` on `POST /manuscript/export`).
  2. `load()` did not mark `manuscriptMissing[mpid] = true` on `200 { manuscript: null }`, `saveCurrentSection` did not wait on `st.draftSyncPromise` or retry `stale_version` or sync other locally drafted sections when the manuscript was missing on the server, and `bindBreakpoint()` re-rendered on any `resize` event (including when viewport height changed or before breakpoint flipped).
  3. Sequential `PUT`s for all 7+ drafted sections took ~15 s over live network, exceeding the 15 s wait in [02-case-report-and-series.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/02-case-report-and-series.mjs).
- **Fixes**:
  - Added `syncDraftSectionsToServer(sectionsList)` in [research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-manuscript.js) (creates the server manuscript with the first section PUT, then syncs remaining sections in parallel, handling `stale_version` retries and chaining onto any in-flight `st.draftSyncPromise`) and invoked it from `openCaseReportDraftModal` and `applyManuscriptDraft`.
  - Updated `saveCurrentSection` and `exportDocx` to await `st.draftSyncPromise`, retry `stale_version`, and backfill non-empty local sections if `wasMissing` was true.
  - Guarded `bindBreakpoint()` in [research-screen-manuscript.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-screen-manuscript.js) to re-render only when `isPhone()` changes and sync editor text first.
  - Updated [02-case-report-and-series.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/02-case-report-and-series.mjs) to wait for tablet editor readiness after `setViewport(1024, 1366)` and wait for `Saved.` / export completion instead of fixed sleeps.
  - Added UI regression test `11c` in [test/run-research-manuscript-ui.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/test/run-research-manuscript-ui.mjs).

### Issue 2: Plan screen "CTRI fields Ask MaiK" 422 (`invalid_draft`)
- **Root cause**: `MAX_OUT.ctri_fields` (`1500`) could truncate JSON when sparse Plan inputs caused verbose CTRI JSON, and `ctriDraft()` in [functions/api/research/_ai_draft.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/functions/api/research/_ai_draft.js) rejected wrapped objects, snake_case/synonym keys, array-valued criteria/outcomes, or flat `primaryOutcomeName` without retrying.
- **Fixes**:
  - Raised `MAX_OUT.ctri_fields` to `2000`, strengthened the `ctri_fields` system prompt to infer clinical trial placeholders from sparse Plan inputs while keeping required-field validation (`publicTitle`, `scientificTitle`, `primaryOutcome.outcome`), added `unwrapCtriObject`/`pickProp`/`ctriText` to normalize realistic model shapes, and added a single repair retry in `aiDraft` when the first reply fails shape validation.
  - Added unit test `"ctri_fields accepts realistic model variants and retries once on a bad shape"` in [test/research-ai-draft.test.mjs](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/test/research-ai-draft.test.mjs).

### Issue 3: `auditDom` `em_dash` check on OpenAlex `.rmd-enrich-link`
- **Fix**: Added `DEFAULT_EM_DASH_EXEMPT_SELECTORS` in [lib/audit.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/lib/audit.mjs) exempting external bibliographic elements (`.rmd-enrich-related` containing `.rmd-enrich-link`, `.rmd-papercard-title`, `.rmd-papercard-meta`, `.rmd-papercard-abstract`, `.rmd-find-*`, `.rmd-nv-*`, `.rmd-trial-card`, `.rmd-study-loc-str`) while preserving the `em_dash` check for all app copy.

### Issue 4: `04b` CARE checklist Approve + 1800 s timeout
- **Root causes**:
  1. [04b-po-and-checklist-recheck.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/04b-po-and-checklist-recheck.mjs) had a negated selector typo (`!document.querySelector('.rmd-checklist-approve-error')`) in `waitFor` so it returned in 0 ms while `"Saving approval..."` was still saving 32 manual entries, and never clicked `[data-doc-save]` or waited for `[data-rmd-approve]` to enable.
  2. Both [04b-po-and-checklist-recheck.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/04b-po-and-checklist-recheck.mjs) and [04-systematic-review-and-po.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/04-systematic-review-and-po.mjs) tapped `[data-rmd="full-draft-po"]` without clicking the confirmation button `[data-rmd="po-start"]`, leaving `finalPoStatus` empty and spinning in the 30-minute poll loop until the 1800 s timeout killed the suite.
- **Fixes**:
  - Updated `saveNow()` in [research-doc-editor.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/research-doc-editor.js) to flush `state.changeTimer` and fire `options.onChange` immediately on Save.
  - Updated [04b-po-and-checklist-recheck.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/04b-po-and-checklist-recheck.mjs) to fill empty `.rmd-doc-body` sections, tap `[data-doc-save]`, wait for `[data-rmd-approve]` to enable, tap Approve, and wait for `#rmdChecklistApproved`.
  - Updated [04b-po-and-checklist-recheck.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/04b-po-and-checklist-recheck.mjs) and [04-systematic-review-and-po.mjs](file:///Users/mkk/prep-data/assessment/rmd-live/e2e/04-systematic-review-and-po.mjs) to tap `[data-rmd="po-start"]`, remove the `|| (Date.now() > 0)` no-op wait, poll every 3 s (cap 600 s), and exit early if no active job started within 20 s.

### Cache-Busting & Bundle
- Appended `-scif1` to `research-screen-manuscript.js` and `research-doc-editor.js` `?v=` tokens in [index.html](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/index.html) and `CACHE` in [sw.js](file:///Volumes/WD%20BLACK%20SN7100%201TB%20Media/po-wire/wt/scifixD/sw.js).
- Rebuilt `www/` cleanly via `bash scripts/build-www.sh` (`build: #1387`).

## 2. Verification Results

- **Syntax & em-dash checks**: `node --check` passed on `research-screen-manuscript.js`, `research-doc-editor.js`, `functions/api/research/_ai_draft.js`, and `sw.js`; `0` em/en dashes in `research-screen-manuscript.js` and `research-doc-editor.js`.
- **Unit suite (`npm test`)**: Ran after final edit; all 102 `test/research-*.test.mjs` files (including `test/research-ai-draft.test.mjs`: 9/9 passed), `test/connect/**`, and `rx-build.test.mjs` passed. The full `npm test` run reported only the 9 pre-existing non-research failures caused by `%20`-encoded spaces in the worktree directory path (`test/build-slim.test.mjs`, `test/edge-schemas.test.mjs`, `test/narke-drills.test.mjs`, `test/no-side-stripes.test.mjs`, `test/remote-media.test.mjs`, `test/tokos-drill-core.test.mjs`, `test/tokos-learn-gyA.test.mjs`, `test/wardsynq-i18n-unwrapped.test.mjs`, `test/wardsynq-reachability.test.mjs`).
- **Headless CDP UI suites**: All 34 `test/run-research-*-ui.mjs` scripts passed after the final edit (`ALL_RESEARCH_UI_PASSED`).
- **Live checks against `http://127.0.0.1:8812` (`CDP_PORT=9473 ANY_USER=1`, 4 live AI drafts used total)**:
  - `02-case-report-and-series.mjs` (2 AI drafts: `pubconsent` + `case_report_draft`): `Download Word file (DOCX)` passed (`"Saved. | Your file is ready to save or share."`), `CARE checklist` passed (`approved=true`), `Submit` passed (`hasFormatCard=true`). *(During that run prior to the `syncDraftSectionsToServer` parallelization edit, `Section edit + Save` showed `"Saving..."` at 15.0 s while 9 sequential PUTs completed 200 ms later; `syncDraftSectionsToServer` was then parallelized after the 1st section and verified in `test/run-research-manuscript-ui.mjs`.)*
  - `04` `read-study` OpenAlex (`10.1056/NEJMoa2007764`, 0 AI drafts): **PASS** (`Cited by 7,595`, `Open access`, `Related works`, 0 DOM `em_dash` issues).
  - `04b-po-and-checklist-recheck.mjs` (1 Case Report Ask MaiK + 1 PaperOrchestra draft = 2 drafts, completed in ~3 min instead of 1800 s timeout): `CARE checklist` **PASS** (`disAfter=false, approved=true`), `Submit` **PASS** (`Done The reporting checklist`), `Case Report Ask MaiK` **PASS**, `PaperOrchestra after UI Run Calculate` **PASS** (`serverRunsAfterUiCalc=1, poStatus="Queued"`), `PaperOrchestra Cancel on 2nd job` **PASS** (`post="Cancelled"`). (PO Job #1 ran `outline -> section 1..6 -> review 1..2` in 165 s and hit the expected `integrity checks` gate on the minimal 3-study synthetic fixture.)
  - *Undeployed server caveat*: `03` `CTRI fields Ask MaiK` lives in `functions/api/research/_ai_draft.js`, which is not yet deployed to live `stewardmd.in`; verified locally via unit tests in `test/research-ai-draft.test.mjs`.

