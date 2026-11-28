# Sci-Fix J Report: Real Thesis to Journal Article Pipeline & Empty AI Guards

## Root Cause Analysis (Before)
1. **Tutorial + own upload trapped in sandbox (`research-tutorial.js`, `research.js`)**:
   - Uploading a real thesis inside `tut_thesis` kept `proj.tutorial === true`.
   - `research.js` `aiBarHtml` forced `cost = 0` (`"No MaiK tokens needed"`).
   - Clicking `Ask MaiK to draft it` called `POST /v1/projects/tut_thesis/ai-draft`, intercepted by `research-tutorial.js` `installApiWrapper`, which returned `{ draft: {}, model: "tutorial-demo", costInr: 0 }` for everything except `publication_consent`.
2. **Empty AI results displayed `"Drafted by MaiK, check it"` (`research-screen-thesis.js`, `research.js`, `research-screen-manuscript.js`, `research-doc-editor.js`, `research-screen-start.js`, `research-screen-grade.js`)**:
   - `applyDraft({})` initialized 5 empty sections (`0 words`) and returned `["draft"]`, so `aiBind` set `st.drafted["draft"] = 1` and displayed the drafted pill over empty boxes.
   - `research-screen-manuscript.js`, `research-doc-editor.js`, `research-screen-start.js` (IEC/Consent/CTRI), and `research-screen-grade.js` similarly lacked strict empty-draft guards or rendered pills without non-empty text.
3. **Narrow & TOC-sensitive study type suggestion (`research-screen-thesis.js`, `functions/api/research/_ai_draft.js`)**:
   - `PAPER_TYPES` only listed 4 broad types (`obs`, `rct`, `case`, `sr`), and `suggestPaperType` used simple `indexOf` checks fooled by Table of Contents lines, literature reviews, or future-trial mentions, without quoting thesis evidence or persisting the suggested type when advancing.
4. **Silent 20K truncation & missing Conclusion section (`research-screen-thesis.js`, `functions/api/research/_ai_draft.js`)**:
   - Server `thesisTask` sliced `maskedFull.slice(0, 20000)` (~10 pages), dropping later Methods/Results/Discussion/Conclusion chapters on 80-340 page theses, and omitted `conclusion` from `THESIS_SECTIONS` (5 sections only).
   - Client `SECTION_ORDER` omitted `conclusion`, sent the whole thesis in a single call, and lacked whole-thesis chapter segmentation, proportional compaction/chunking within T1 token ceilings (`maxInputTokens: 8000`), structured abstract word caps, or full-thesis table/reference extraction.

---

## Fixes Implemented (Branch `rmd-thesis-real`)
1. **Tutorial + Own Upload Conversion (`research-screen-thesis.js`, `research-tutorial.js`)**:
   - Any user file upload (`ownUpload: true`, `isTutorialSample: false`) inside a tutorial project blocks continuation in tutorial sandbox across all thesis screens (`thesis`, `thesis-type`, `thesis-journal`, `thesis-draft`, `thesis-tables`, `thesis-refs`).
   - Shows `"Tutorial drafts are practice only. Start a real project so Ask MaiK drafts from your thesis."` with one primary CTA `"Start a real project with this thesis"` (`#rmdThesisStartReal`) that creates a real server project via `POST /v1/projects`, carries the extracted thesis pages, filename, and PHI state directly to `"thesis-type"` (no re-upload), and clears the sandbox upload.
   - `research-tutorial.js` `installApiWrapper` rejects `ownUpload` `thesis_to_paper` calls cleanly and supplies a full 6-section worked example when using the built-in tutorial sample (`isTutorialSample: true`), reading from `thStore[pid]` safely.
   - Added localStorage `QuotaExceededError` handling with in-memory fallback (`memThesis`) and stale-page eviction so large multi-hundred-page theses persist reliably on mobile devices.
2. **Empty AI Draft Error + Retry & Per-Section Pill Guard**:
   - `research.js`: added `empty_draft` handling in `friendlyError`, live `.rmd-ai-progress` (`smd-books-keep`) + `.rmd-ai-pbar`, `[data-rmd="ai-retry"]` binding, and `aiBind` zero-key rejection when `!keys.length`.
   - `research-screen-thesis.js`: per-section `"Drafted by MaiK, check it"` pill renders ONLY when `countWords(sec.text) > 0`; if all sections are 0 words or any section returns 0 words, displays `.rmd-banner-error` + `"Try again"`.
   - Fixed the same empty-draft / empty-pill invariants across `research-screen-manuscript.js`, `research-doc-editor.js`, `research-screen-start.js` (IEC, Consent, CTRI), and `research-screen-grade.js`.
3. **Zone-Aware Study Type Suggestion (`research-screen-thesis.js`, `_ai_draft.js`)**:
   - Expanded `PAPER_TYPES` to 9 clinical designs (`obs`, `rct`, `cohort`, `case_control`, `cross_sectional`, `diagnostic`, `case`, `sr`, `qualitative`).
   - Added `suggestPaperType(pagesOrText)` skipping Table of Contents / List of Tables pages, weighting title/summary/methods zones, discounting literature citations (`"Chapter 2 systematic review"`, `"future randomised controlled trial"`), returning a verbatim `#rmdThesisTypeQuote` (`smd-books-keep`) with page number, and persisting the suggested `paperType` and reporting checklist.
4. **Whole-Paper 6-Section Draft & Long-Thesis Segmentation (`research-screen-thesis.js`, `_ai_draft.js`)**:
   - Expanded `SECTION_ORDER` and `THESIS_SECTIONS` to 6 sections: `Abstract` (structured: `Background:`, `Methods:`, `Results:`, `Conclusion:`), `Introduction`, `Methods`, `Results`, `Discussion`, `Conclusion`.
   - Added pure exported helpers `segmentThesisChapters`, `chunkPagesByChars`, `condenseLongBucket`, `extractThesisTables`, `extractThesisReferences`, `abstractLimitOf`, and updated `enforceWordLimit` (keeps `Abstract` within `abstractLimit`, trims `Discussion`/`Introduction` before touching `Conclusion`, and preserves `saveDraft` `isDomMounted(btn)` guard).
   - Client orchestrates 6 section-scoped calls (`<= 13,000` chars per unified chapter pass covering every page proportionally, synthesizing `Abstract` last from front pages + grounded Methods/Results/Conclusion, falling back cleanly if an un-deployed server returns HTTP 400 on `section: "conclusion"`, verifying every number across all `ts.pages`).
   - Server `_ai_draft.js` also chunks `> 17,500`-char chapter buckets cleanly inside `TIER_CEILINGS.T1` and preserves `Conclusion` when trimming excess words.

---

## Real-World Live Verification (CDP `9473` against `http://127.0.0.1:8812` + `stewardmd.in` API)
Sources documented in `/Users/mkk/prep-data/assessment/rmd-live/e2e/theses/SOURCES.md` (zero PHI findings via `_phi.js scanAndMaskThesis`).

| Case | Thesis | Pages | True Design | Suggested + Checklist | Journal (Main / Abs Limit) | Words by Section (Abs / Intro / Meth / Res / Disc / Conc) | Main Words | Unverified Numbers | Exported DOCX |
|---|---|---:|---|---|---|---|---:|---:|---|
| `thesis-real-1` | Campbell 2017 (`obs-campbell-2017-heart-failure.pdf`) | 341 | Observational cohort | `cohort` (STROBE), Page 2 quote | IJCCM (`3000` / `350`) | 290 / 320 / 508 / 225 / 479 / 89 | 1,621 | 0 (`50` verified locators, `0` flags) | `16,253` bytes |
| `thesis-real-2` | Lehr 2022 (`rct-lehr-2022-spinal-fusion.pdf`) | 175 | Randomized controlled trial | `rct` (CONSORT), Page 1 quote | IJCCM (`3000` / `350`) | 241 / 240 / 346 / 201 / 484 / 53 | 1,324 | 0 (`46` verified locators, `0` flags) | `13,788` bytes |

- **Tutorial sample verification (`tut_01_sample_draft`)**: 6/6 sections rendered cleanly, `"Drafted by MaiK, check it"` pill shown cleanly, `"No MaiK tokens needed"`, `0` errors.
- **Tutorial + own upload verification (`tut_02_own_upload_gate` -> `tut_03_converted_type`)**: uploading `rct-lehr-2022-spinal-fusion.pdf` inside `tut_thesis` displayed `"Start a real project with this thesis"`, created synced real project `prj_0fe48b8f...` (and `prj_ac7f72ae...` on final `-scij4`/`-scij5` audit) carrying all 175 pages cleanly to `thesis-type` with `rct` (`CONSORT`) suggested and Page 1 quote displayed.

### Before / After Visual Evidence
- **Before**: `/Users/mkk/prep-data/po-wire/briefs/thesis-tutorial-owner.png` (tutorial sandbox showed `"No MaiK tokens needed"`, `"Drafted by MaiK, check it"` pill above 5 sections all at `0 words`).
- **After (Live CDP 9473 screenshots)**:
  - Tutorial + own thesis conversion gate: `/Users/mkk/prep-data/assessment/rmd-live/e2e/outputs/thesis-tutorial-check/shots/tut_02_own_upload_gate.png`
  - Tutorial sample 6-section draft: `/Users/mkk/prep-data/assessment/rmd-live/e2e/outputs/thesis-tutorial-check/shots/tut_01_sample_draft.png`
  - Real RCT converted & classified (Light 390px, `-scij4` uniform border): `/Users/mkk/prep-data/assessment/rmd-live/e2e/outputs/thesis-real-2/shots/real2_type_scij4_light.png`
  - Real RCT converted & classified (Dark 390px, `-scij4`): `/Users/mkk/prep-data/assessment/rmd-live/e2e/outputs/thesis-real-2/shots/real2_type_scij4_dark.png`

---

## Automated Tests & UI Compliance Checks
- **Syntax checks**: `node --check` passed on all 8 edited `.js` files; `[\u2013\u2014]` scan passed (0 UI em/en dashes).
- **ResearchMD Unit Tests (`node --test --experimental-test-module-mocks --experimental-sqlite test/research*.test.mjs`)**: `871 passed, 0 failed, 6 skipped`.
  - Thesis + Error + Doc-editor targeted run after final `-scij5` edit: `20/20` passed (`0` failed).
- **Headless Browser ResearchMD UI Suites (`test/run-research-*-ui.mjs`)**: **34 / 34 suites passed** (`fails=[]`).
  - Re-ran `test/run-research-thesis-ui.mjs` and `test/run-research-tutorial-ui.mjs` after final `-scij5` build: **ALL CHECKS PASSED**.
- **Full `npm test` run**: Passed all ResearchMD, Connect, MaiK, and `rx-build` suites; caught `test/no-side-stripes.test.mjs` against our initial `border-left: 3px solid` on `.rmd-thesis-quote` (subsequently fixed to uniform `border: 1px solid var(--rmd-line)` in `-scij4`!). Pre-existing non-ResearchMD worktree directory failures in 9 unrelated suites (`build-slim`, `edge-schemas`, `narke-drills`, `no-side-stripes` `>100 files` sparse worktree check, `remote-media`, `tokos-*`, `wardsynq-*`) reflect un-checked-out sibling directories in the worktree (`prep/`, `tokos/`, `wardsynq/`).
- **UI & Accessibility Compliance (`auditDom` + `_ui-rules.md`)**:
  - `aGate: []`, `aTypeL: []`, `aTypeD: []`, `aType1024: []`, `auditTut: []` — verified `0` horizontal overflow at `375px`, `390x844`, and `1024x1366`; `>= 44px` interactive targets; `>= 4.5:1` contrast in light & dark modes; `prefers-reduced-motion` support; no side stripes (`no-side-stripes`); scientific term + plain explanation maintained.
