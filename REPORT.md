# Brief G Report: Meta-analysis PaperOrchestra draft completion and verified references (`rmd-sci-fixes-g`)

Branch: `rmd-sci-fixes-g` (from `rmd-sci-fixes-d`, merged with `origin/main`)
Worktree: `/Volumes/WD BLACK SN7100 1TB Media/po-wire/wt/scifixG`

## 1. Root Cause Findings (`job_23a3bd68f741461580d23635ce417a8f`)

Reconstructing the exact prompts from `~/prep-data/assessment/rmd-live/e2e/outputs/meta/network.json` identified two distinct failures:

1. **`ceiling_input_tokens` (> 16,000 T2 ceiling) at whole-manuscript refinement (`refine:1`)**:
   - Steps `outline`, `abstract` (with retries), `introduction`, `methods`, `results`, `discussion`, `5-references`, and `refine:0` succeeded (`inputTokens` 9,130 to ~14,225).
   - `GATES.checkPaper` in `research-po-gates.js` flagged `2` from `I\textsuperscript{2}` as an `untokenised_number` because `allowedNumbers` was missing `EXPONENT_RE` (already present in `functions/api/research/_manuscript.js` and `po_adapter/gates.py`).
   - That sent the manuscript into `refine:1` where `PROMPTS.buildRefinementPrompt` (`research-po-prompts.js`) accidentally concatenated `curTex` twice (`curTex + "\n\n" + userPromptText` on top of `CURRENT LATEX SOURCE`), adding 13,152 duplicate chars plus ~19,189 chars of unscreened citation library JSON (~64,061 chars total, ~17,016 estimated tokens > 16,000 T2 ceiling).
   - Additionally, `buildReviewPrompt` and `buildRefinementPrompt` lacked a section-summarized review path and per-section refinement fallback when a full draft genuinely exceeds the tier budget.

2. **Missing verified references in `\section*{References}`**:
   - `buildManuscriptSnapshot` (`functions/api/research/_jobs.js`) left `study.source` null for manually entered Colditz trials (which carry their verified citation in `study.values[*].locator.citation`, e.g. `"Aronson JD, Am Rev Tuberc 1948; 58:255-281"`), and `renderIdea` skipped `loc.citation`.
   - `formatCitationLibrary` filled its character budget in insertion order with the first ~38 of 143 unscreened `rec_*` search hits, starving out the 13 included studies and screened `include` records.
   - Because `IMRAD_TEMPLATE` / outlines included `5. References`, Step 3 spent a section-writing LLM call on `5. References`, which refused to guess missing records (`"The supplied materials do not include complete bibliographic records..."`).

## 2. Changes Implemented

- **Client PaperOrchestra prompts (`research-po-prompts.js`)**:
  - Removed duplicate `curTex` concatenation in `buildRefinementPrompt`.
  - Updated `buildSectionPrompt`, `buildRefinementPrompt`, and `buildSectionRefinementPrompt` to account for `sectionTitle` and `retryReason` inside budget calculation so gate retries never push prompts past `maxPromptChars`.
  - Added `compactOutlineForSection` so section drafting only carries full plan details for the active section plus sibling titles.
  - Updated `formatCitationLibrary` and `compactCitationJson` to prioritize `priorityKeys` -> verified included studies (`isIncludedStudy`) -> `screeningDecision === "include"` -> unscreened -> excluded, ensuring all 13 Colditz studies and screened records always appear with keys (`aronson_1948`, etc.).
  - Added `summarizeLatexSection`, `buildSectionRefinementPrompt`, `buildSummarizedReviewPrompt`, and `estimatePromptTokens`.
  - Updated `GUIDELINES` and `buildSectionPrompt` to cite included trials by study label (e.g. `Aronson 1948`) when no DOI/PMID is attached, and with `\cite{key}` when a verified DOI/PMID exists.

- **Client gates & manifest assembly (`research-po-gates.js`)**:
  - Added `EXPONENT_RE` to `allowedNumbers` (`I\textsuperscript{2}`).
  - Added `slugCiteKey`, `extractStudyLocatorInfo`, and `collectMergedReferences` so verified included studies (including manual `locator.citation` entries) merge into `inputs.references` with deterministic keys (`aronson_1948`, etc.) and render in `renderIdea`.
  - Updated `vancouver()` to format `entry.citation` cleanly when `entry.title` is absent.
  - Updated `buildManuscript()` to include all verified `isIncludedStudy` entries (deduped by key/DOI/PMID/studyId) in `manuscript.references` and deterministically populate any `References` section from verified records only.

- **Client on-device draft runner (`research-ondevice-draft.js`)**:
  - Added pre-flight token ceiling validation in `validate` BEFORE spending any gateway calls, throwing `ceiling_input_tokens` with concrete trim guidance (`trimAdviceMessage`) if inputs exceed the tier limit (`T2 = 16,000`; tier ceilings unchanged).
  - Skipped LLM generation on `References` sections (`isReferencesSection`), emitting `\section*{References}` for deterministic assembly in Step 5.
  - Added `stripNonDoiStudyCitations()` so any `\cite{study_key}` lacking a DOI/PMID converts cleanly to its study label `(Aronson 1948)` before hard-gate and server `_manuscript.js` checks.
  - Added fallback to `PROMPTS.buildSummarizedReviewPrompt` when full review exceeds ceiling, and per-section refinement (`runPerSectionRefinement` with `buildSectionRefinementPrompt` + `skipRoundCount` on sections 2..N) when whole-manuscript refinement exceeds ceiling.
  - Added bounded post-refinement gate repair (`repair:1..2`) before Step 5 `GATES.enforce`.

- **UI & DOCX export (`research-screen-manuscript.js`)**:
  - Updated `sectionTemplateRank()` to strip leading numeric outline prefixes (`5-references` -> rank 99).
  - Updated `mapPoError` & `PO_ERROR_MESSAGES` to surface `ceiling_input_tokens` trim guidance verbatim.
  - Updated `buildDocxBytes` to append `man.references` under a `References` heading if no populated `references` section exists.

- **Server snapshot & PHI allowances (`functions/api/research/_jobs.js` — needs deploy to `stewardmd.in` for live server parity)**:
  - `buildManuscriptSnapshot` now populates `study.source.citation` (plus DOI/PMID/title/year/authors/venue when present) from verified study `locator` JSON and annotates `screeningDecision` on `manifest.references` from `research_screening_decisions`.
  - `submitDeviceResult` PHI scan allows citation library author names on `references` sections (`{ allowCitationLibraryNames: true }`).

- **Python adapter mirror (`backend/research/paperorchestra/adapter/po_adapter/{loader.py,writer.py,pipeline.py}`)**:
  - Mirrored `collect_merged_references`, `_render_idea`, `vancouver`, `build_manuscript` (`isIncludedStudy` + deterministic `References` fill), and `run_section_draft` skipping LLM calls on `References`.

- **Cache-busting & bundle**:
  - Appended `-scig1` to edited script tags in `index.html` and `CACHE` in `sw.js`. Rebuilt `www/` with `bash scripts/build-www.sh`.

## 3. Verification Results

- **Syntax & em/en-dash check**:
  - `node --check` passed on `research-po-prompts.js`, `research-po-gates.js`, `research-ondevice-draft.js`, `research-screen-manuscript.js`, and `functions/api/research/_jobs.js`.
  - Zero U+2013/U+2014 dashes across the four edited client JS files.
- **Real Colditz BCG snapshot simulation** (reconstructed `job_23a3bd68f741461580d23635ce417a8f` manifest from `network.json`):
  - `buildInputs` extracted all 13 included Colditz studies alongside 143 search records (156 total references) with keys (`aronson_1948`, `ferguson_simes_1949`, etc.).
  - Every prompt (`outline` 9,135 tokens; sections 15,382-15,384; reviews 3,428-10,698; refinements 15,225-15,410 including `+1000` gateway framing) remained `<= 16,000` T2 ceiling across normal and large per-section refinement runs.
  - `5-references` consumed 0 LLM calls and assembled all 13 Vancouver citations in `\section*{References}` with 0 PHI hits.
  - Oversized pre-flight input rejected with `ceiling_input_tokens` and trim guidance after 0 gateway calls.
- **Python pytest**:
  - `pytest tests/test_po_*.py`: 138 passed, 0 failed.
- **Targeted Research PO & PHI unit tests**:
  - `node --test --experimental-test-module-mocks test/research-po-device.test.mjs test/research-po-job.test.mjs test/research-po-button.test.mjs test/research-po-device-api.test.mjs test/research-phi-false-positive.test.mjs`: 63 passed, 0 failed across 7 suites.
- **Full `npm test`**:
  - All `test/research-*.test.mjs` and `rx-build.test.mjs` (12/12) passed.
  - The same 9 pre-existing non-research worktree-path tests documented in `scifixD/REPORT.md` failed due to `%20` in `/Volumes/WD BLACK SN7100 1TB Media/...`: `test/build-slim.test.mjs`, `test/edge-schemas.test.mjs`, `test/narke-drills.test.mjs`, `test/no-side-stripes.test.mjs`, `test/remote-media.test.mjs`, `test/tokos-drill-core.test.mjs`, `test/tokos-learn-gyA.test.mjs`, `test/wardsynq-i18n-unwrapped.test.mjs`, `test/wardsynq-reachability.test.mjs`.
- **Headless UI harnesses (`test/run-research-*-ui.mjs`)**:
  - All 34/34 harnesses passed (`pass=34 fail=0`).
- **Live E2E (`CDP_PORT=9473 ANY_USER=1 RMD_BASE_URL=http://127.0.0.1:8812 node 06-scientist.mjs`)**:
  - `meta` (steps 1-10 + PRISMA + RoB + Checklist), `rct`, `casecontrol`, `casereport`, and `thesis` (including all AI drafts and DOCX exports) all **PASSED**.
  - **`[meta] PaperOrchestra full manuscript draft` and `[meta] Export manuscript DOCX` FAILED/BLOCKED** before job creation because the live test account on `stewardmd.in` returned **HTTP 429 `cap_po_user_daily`** (`"You have reached today's manuscript drafting limit. Try again tomorrow."`, req `req_55030f3e57fb450bae4f0de0e6f5352f`) due to earlier drafts run today on the same live account. Only 1 PO trigger attempt was made during this run (0 gateway calls spent).
  - Server-side `functions/api/research/_jobs.js` changes (carrying `study.source.citation` when `research_reports` is unlinked, `screeningDecision`, and `allowCitationLibraryNames` on `references` in `submitDeviceResult`) require deployment to `stewardmd.in` before live API requests reflect them, though client `buildInputs()` already falls back cleanly to `value.locator.citation` present in live snapshots.
