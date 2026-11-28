# ResearchMD One-Tap Thesis to Journal Paper Report (Brief L)

Branch: `rmd-thesis-auto`  
Worktree: `/Volumes/WD BLACK SN7100 1TB Media/po-wire/wt/scifixL`

## Overview & Implemented Architecture

### 1. Pure Engine Module (`research-thesis-auto.js`)
Dual-exported (`window.SMD_RESEARCH_THESIS_AUTO` and CommonJS `module.exports`) strict ES5 module providing deterministic journal matching, table condensation, reference verification, front-matter generation, format checks, cost estimation, and submission package builders:
- **12-Step Pipeline Definition (`STEP_ORDER`)**: `chapters`, `study_type`, `journals`, `draft`, `tables`, `references`, `title_page`, `abstract_keywords`, `declarations`, `checklist`, `format_check`, `cover_letter`.
- **Target Journal Matcher (`rankTargetJournals`, `inferSpecialty`, `FALLBACK_JOURNALS`)**: Scores the journal catalogue (falling back to 9 offline journals aligned with `JOURNALS_CATALOGUE` IDs) across specialty, study type, thesis length / word limits, reference/table caps, PubMed indexing, open access, and fee status. Returns Top 3 matches with limits (`wordLimit`, `abstractLimit`, `maxReferences`, `maxTables`, `referenceStyle`, `fitReason`) and preselects best fit.
- **Table Extraction, Condensation & Renumbering (`extractTableContent`, `condenseTables`)**: Parses table captions/headers/rows from thesis pages (filtering wrapped prose continuation lines), ranks importance, caps to journal `maxTables`, renumbers sequentially (`Table 1..Table N`), and rewrites in-text references (`renameMap`) across drafted sections.
- **Citation Filtering, Style Formatting & PubMed/Crossref Verification (`parseStructuredBibEntry`, `extractCitationsFromText`, `buildJournalReferences`, `formatJournalReference`, `verifyReferencesOnline`)**:
  - De-hyphenates PDF wrap splits, distinguishes publication years from years inside titles, and avoids expanding statistical IQR/score brackets (`[14-21]`, `[5-9]`) or matching decimal digits after periods (`0.17`) as citations.
  - Keeps only references actually cited in drafted prose, renumbers in-text citations for numbered styles (`vancouver`, `ama`), and sorts alphabetically for `apa`.
  - Verifies cited references against live PubMed (`eutils.ncbi.nlm.nih.gov`) and Crossref (`api.crossref.org`) APIs, rejecting non-matching hits via `refMatchesCandidate`, flagging unverified items with `needCheck: true`, and never inventing citations.
- **Title Page, Abstract & MeSH Keywords (`buildTitlePage`, `extractKeywordCandidates`, `verifyKeywordsMesh`)**: Pre-fills from signed-in user profile (`SMD_AUTH.currentUser` / local `smd_profile_v1`) and thesis header lines (rejecting clinical prose sentences from institutional extraction) with explicit `[Confirm ...]` placeholders, computes abstract/main/table/figure/reference counts, and checks keyword candidates against NCBI MeSH (`db=mesh`).
- **Declarations, CRediT, Checklist & Format Check (`extractThesisClues`, `buildDeclarationsAndCredit`, `prefillChecklist`, `runFormatCheck`)**: Detects IEC numbers (avoiding funding false positives), trial registration IDs (`CTRI`/`NCT`/`ISRCTN`), and genuine funding statements; generates editable consent/funding/conflicts/data/CRediT statements plus AI-use disclosure (`SMD.aiDisclosureText`); prefills reporting checklists (`strobe`, `consort2025`, `prisma2020`, `care`, `stard2015`); and runs deterministic format checks.
- **MaiK Token Estimator & Submission Package Export (`estimateAutoCost`, `buildCoverLetter`, `buildChecklistPdfBytes`, `buildReferencesRis`, `buildSubmissionPackageFiles`)**:
  - Shows pre-run MaiK token estimate using `MT_PER_INR = 2000`.
  - Exports `.zip` archive via `SMD.zipStore` / local CRC32 ZIP writer containing: `01-title-page.docx`, `02-manuscript.docx` (with OOXML `<w:lnNumType>` when `journal.lineNumbers` is set and XML 1.0 control chars stripped), `03-tables.docx`, `04-cover-letter.docx`, `05-reporting-checklist.docx`, `05-reporting-checklist.pdf` (`%PDF-1.4`), `06-references.ris`, and `submission-manifest.txt` (`Approved: No` until user clicks Approve).

### 2. One-Tap Screen & Orchestration (`research-screen-thesis.js`, `research.js`, `research-screen-manuscript.js`, `index.html`, `sw.js`)
- **Primary Upload Action (`renderUpload`)**: Shows `#rmdThesisAutoEstimate` before starting and `#rmdMakeJournalPaper` (`Make my journal paper`, switching to `Continue journal paper` when paused or `Review journal paper` when ready), while retaining the step-by-step path (`Edit step by step`) and enforcing the PHI consent gate (`openConsentSheet`) before navigating to `"thesis-auto"` with `{ autoStart: true }`.
- **Resilient Pipeline Execution (`renderThesisAuto`, `runAutoChain`, `runSingleAutoStep`, `orchestrateThesisDraft`)**:
  - `orchestrateThesisDraft` supports `resume` (skips already completed sections), `shouldStop()` (pauses cleanly), and deterministic `joinNotesFallback` if a multi-part section merge truncates on huge chapters (caught live on Campbell 341p Results & Lehr 175p Discussion).
  - Server `409 consent_needed` mid-pipeline opens `#rmdThesisConsentSheet` and automatically resumes `runAutoChain` at the draft step upon confirmation (caught live on synthetic 100p `.docx`).
  - `ts.auto` persists to `localStorage smd_rmd_thesis_v1` per project so Stop/Continue and full app restarts preserve completed steps and succeeded token counters.
  - Succeeded AI calls accumulate in `actualAiCalls`/`actualCostInr`/`actualMaikTokens`; 5xx/empty-draft failures never charge tokens and preserve any existing draft.
  - `429` / `402` / cap errors pause cleanly with progress intact.
- **Review & Approve + Journal Switching + Export**:
  - Stops once at `"Review and approve"` (`status = "review"`), collapsing the 12-step detail list inside `<details id="rmdAutoStepsDetails">` so the Target Journal switcher and Amber/Green readiness cards appear immediately on 390px screens.
  - Switching among Top 3 target journals re-runs steps `5..12` locally/online with zero additional AI calls.
  - Inline inputs and explicit confirmation checkboxes (`[data-rmd-auto-confirm]`) transition Author list, IEC/Ethics, Declarations/CRediT, and Unverified References from Amber (`Amber: Confirm`) to Green (`Green: Ready`).
  - Only clicking `#rmdAutoApproveBtn` (`Approve and mark final`) syncs sections and calls `POST /v1/projects/:id/manuscript/approval/approve`, marking `approved = true`.
  - `#rmdAutoExportPackBtn` exports the `.zip` package through `SMD.p2.downloadBytes` (`SMD.p2.saveFile` Capacitor Share sheet on native mobile), alongside individual file download buttons.
- **Cache-busting & Wiring**: Added `/research-thesis-auto.js?v=rmd1-scil1` to `index.html`, bumped `?v=` tokens on `research-screen-thesis.js`, `research-screen-manuscript.js`, and `research.js`, appended `-scil1` to `CACHE` in `sw.js`, and exported `SMD.aiDisclosureText` + `SMD.zipStore` on `research-screen-manuscript.js`.

---

## Live E2E Metrics (`http://127.0.0.1:8812` + `CDP_PORT=9473 ANY_USER=1`)

Outputs saved under `/Users/mkk/prep-data/assessment/rmd-live/e2e/outputs/thesis-auto-{1,2,3}` (including `.zip`, 8 individual package files, `metrics.json`, `editorial-review.txt`, and `390px` light/dark + `1024px` iPad screenshots):

| Run | Thesis Fixture (Pages) | Detected Type & Preselected Journal | Wall Time (ms) | Est. / Actual AI Calls | Actual MaiK Tokens | Main / Abstract Words | Tables Kept | Refs Cited (Verified) | Verbatim Numbers Checked (Missing) |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| `thesis-auto-1` | `obs-campbell-2017-heart-failure.pdf` (341p) | Cohort -> Indian Heart Journal (3,500w / 250w) | 61,185 | 17 / 18 | 5,860 MT | 2,738 / 250 | 5 | 8 (5 / 62.5% Crossref) | 244 (0 missing) |
| `thesis-auto-2` | `rct-lehr-2022-spinal-fusion.pdf` (175p) | RCT -> Indian J Orthopaedics (4,000w / 250w) | 74,395 | 18 / 20 | 7,360 MT | 2,892 / 200 | 6 | 14 (14 / 100.0% Crossref) | 295 (0 missing) |
| `thesis-auto-3` | `stewardmd-synthetic-100p-thesis.docx` (96p extracted / 100p doc) | Cohort -> Indian J Crit Care Med (3,000w / 350w) | 41,253 | 10 / 10 | 1,840 MT | 747 / 223 | 6 | 8 (6 / 75.0% Crossref) | 196 (0 missing) |

Note: After observing `thesis-auto-3` during editorial review, fixed `supRe` in `research-thesis-auto.js` so decimal numbers like `0.17` are not parsed as superscript citations, and re-verified on `thesis-auto-3` section text that `extractCitationsFromText` returns `[1..7]` only (excluding uncited ref #8).

---

## Automated Verification Summary

- **Syntax checks**: `node --check` passed on `research-thesis-auto.js`, `research-screen-thesis.js`, `research-screen-manuscript.js`, `research.js`, and `sw.js`.
- **Unit tests**:
  - `test/research-thesis-auto.test.mjs` (9 tests covering ranking, table condensation, bib parsing/renumbering, online ref verification, MeSH keywords, declarations/CRediT, checklists, format check, cost estimation, `.docx`/`.pdf`/`.ris`/`.zip` builders, ES5/dash/side-stripe invariants) — passed after final edit.
  - `test/research-thesis.test.mjs`, `test/research-thesis-chapters.test.mjs`, `test/research-thesis-render.test.mjs`, `test/research-journey.test.mjs`, `test/research-tutorial-cost-copy.test.mjs` — all passed (`0` failures) after final edit.
  - Note on repo-wide `npm test` run (executed prior to the final 1-line `supRe` fix): 9 pre-existing suite failures in unrelated/worktree-path tests (`test/no-side-stripes.test.mjs` fails scanning 0 files when the worktree path contains spaces due to un-decoded `%20` in `new URL`, plus pre-existing `build-slim.test.mjs`, `edge-schemas.test.mjs`, `narke-drills.test.mjs`, `remote-media.test.mjs`, `tokos-drill-core.test.mjs`, `tokos-learn-gyA.test.mjs`, `wardsynq-i18n-unwrapped.test.mjs`, `wardsynq-reachability.test.mjs`). Direct regex scan inside `test/research-thesis-auto.test.mjs` verified zero CSS side stripes (`>= 2px`) and zero em/en dashes in `research-thesis-auto.js` and `research-screen-thesis.js`.
- **Headless UI harnesses (`test/run-research-*-ui.mjs`)**:
  - `test/run-research-thesis-auto-ui.mjs`: All **30** checks passed after final edit (upload token estimate, Stop & Continue, reload persistence, 500 non-charge, single-step Re-run, journal switch with 0 AI calls, Amber->Green checklist, manual Approve & `.zip` export, 390px light/dark & 1024px iPad zero overflow, >=44px touch targets, 0 dashes, 0 page errors).
  - `test/run-research-thesis-ui.mjs`: All checks passed (`0` failures) after final edit.
  - All 34 other `test/run-research-*-ui.mjs` scripts passed (`EXIT=0`) when run sequentially (after re-running `run-research-compliance-ui.mjs` & `run-research-ipad-ui.mjs` standalone cleanly: `COMPLIANCE=0`, `IPAD=0`).
- **Bundle assembly**: `scripts/build-www.sh` (`build: #1414`, 17,285 files) assembled `www/` cleanly after final edit.

### Modern Web Guidance (UI Compliance)
- **Progress (`progress`)**: `#rmdAutoStepsList` uses a semantic ordered list with `role="progressbar"` (`aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext`), live status badges, tabular numbers (`font-variant-numeric: tabular-nums`), non-jarring layout without full-page blocking after completion, and `@media (prefers-reduced-motion: reduce)` disabling bar transitions.
- **Accessibility (`accessibility`)**: Explicit `<label for="...">` bindings on every title page / declaration input and confirmation checkbox, `aria-pressed` on Top-3 journal selection buttons, `>= 44px` minimum interactive touch targets (`min-height: 47px` rule yielding `~44.6px` rendered height), high-contrast light/dark palette (`#136d45`/`#e6f5ec` light, `#42cdb5`/`#103239` dark on `#0a1230`/`#111c44`), `1px` full borders without side stripes, and verified `0` horizontal overflow at `390px` and `1024px`.
