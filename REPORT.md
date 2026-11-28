# ResearchMD Thesis Chapters & Performance Audit Report (Brief K)

Branch: `rmd-thesis-chapters`  
Worktree: `/Volumes/WD BLACK SN7100 1TB Media/po-wire/wt/scifixK`

## Part 1: Chapter-Aware Thesis-to-Paper

### Architecture & Implementation (`research-screen-thesis.js`)
- **Hierarchical Heading Detection (`detectThesisHeadings`, `buildChapterTree`, `sliceChapterPages`)**:
  - Consumes `SMD_RUST_PDF.lines()` (`{ tx, size, bold, italic, caps }`) for PDFs (`<= 500` pages), `.docx` Word styles (`Heading 1`/`2`/`3`, `outlineLvl`, `<w:b/>` bold in `parseDocx`), and `pdf.js` font-size transforms (`joinPdfTextItemsWithLines`) as fallback.
  - Dynamically infers median body font size per thesis and uses font size ratio, `line.bold` (with graceful size/pattern degradation when `line.bold` is absent), all-caps + next-line wrapped title merging (`CHAPTER N` + multi-line title as in Leiden/Utrecht PhD theses), Roman/decimal numbering (`3.1`, `3.1.2`), and Indian MD/MS canonical headings (`Introduction`, `Aims and Objectives`, `Review of Literature`, `Materials and Methods`, `Observations and Results`, `Discussion`, `Summary`, `Conclusion`, `Bibliography/References`, `Annexures/Proforma/Consent/Master chart`).
  - Filters out running page headers/numbers, TOC dot-leader lines, and small bold table-column headers (`size < bodySize * 0.98`).
- **Chapter-to-Journal Mapping (`mapChaptersToJournal`) & User Override UI**:
  - Automatically skips front matter (`Certificates`, `Declaration`, `Acknowledgement`, `Contents`, `List of Tables/Abbreviations`) and back matter/appendices (`Annexures`, `Proforma`, `Consent`, `Master chart`) by mapping them to `excluded` with an explicit reason — nothing is silently dropped (`#rmdExcludedSummary` lists excluded chapters).
  - Maps `Introduction` + `Aims and Objectives` + condensed `Review of Literature` (`condenseReview: true`, 3–5 points with citations) to Introduction; `Materials and Methods` to Methods; `Observations and Results` to Results (referencing detected thesis tables); `Discussion` to Discussion; `Conclusion`/`Summary` to Conclusion; `Bibliography/References` to References (filtering down to cited references via `extractThesisReferences(allPages, { refPages, citedText })`).
  - Supports multi-study PhD subheading auto-splitting (`auto` option when a chapter embeds `Introduction / Methods / Results / Discussion`).
  - Renders a compact `#rmdChapterMap` card on the Draft step with a `44px+` **Adjust mapping** toggle (`#rmdChapterMapToggle`) and per-chapter target selectors (`[data-rmd-chapter-id]`) persisted in `thesis.chapterMap`.
  - Fixed a real DOM interaction bug caught on live screenshot verification: `emoji-icons.js` was rewriting `"pp. 62-77"` inside `#rmdChapterMap` via its textbook citation scrubber into `"Standard textbooks: Harrison's..."`. Added `.smd-books-keep` on `#rmdChapterMap` and switched labels to `"Pages X to Y"` / `"Page X"`.
  - Fixed `refIsCitedInText` to parse multi-reference citations like `[1, 2]` and `[1-3]` cleanly in addition to `[1]` / `(1)`.
- **Bounded Parallel Section Drafting & Single-Section Retry**:
  - `orchestrateThesisDraft` feeds each target section (`Introduction`, `Methods`, `Results`, `Discussion`, `Conclusion`) only its mapped chapter pages, sub-chunking chapters > 13,000 chars (up to 4 parts within T1 ceiling), drafting with bounded concurrency (`runBoundedPool(tasks, 3)`), merging multi-part notes, synthesizing `Abstract` last from drafted body + front summary, and enforcing journal word limits deterministically after merge.
  - Preserves existing fast path (`<= 13,500` chars and no manual overrides) as a single consented AI call.
  - `#rmdDraftProgressList` renders live per-section status (`Done (N words)`, `Drafting...`, `Failed`, `Skipped`) and per-section **Retry** buttons (`[data-rmd-retry-section]`) to re-run only a failed section without redoing completed sections (`retrySingleSection`).

### Part 1 Benchmarks (Chrome Headless 390x844, 4x CPU Throttling, 1200 ms per AI call)

| Thesis Fixture | Pages | Chapters (Excluded) | Rust `lines()` (ms) | Tree + Map (ms) | Read + Split Total (ms) | Brief J Seq Calls / Wall Time | Brief K Calls / Parallel Wall Time | Speedup vs Brief J |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| Synthetic 100p thesis | 100 | 10 (3) | 207.6 | 31.1 | **238.7 ms** | 20 calls / 24,000 ms | 20 calls / **10,866.2 ms** | **2.21x** |
| Real RCT (`rct-lehr-2022-spinal-fusion.pdf`, 13.7 MB) | 175 | 17 (9) | 325.5 | 76.9 | **402.4 ms** | 23 calls / 27,600 ms | 17 calls / **8,435.6 ms** | **3.27x** |
| Real Cohort (`obs-campbell-2017-heart-failure.pdf`, 9.97 MB) | 341 | 18 (7) | 846.5 | 181.6 | **1,028.1 ms** | 44 calls / 52,800 ms | 20 calls / **12,080.5 ms** | **4.37x** |

- Target check: Read+split of 100p PDF is **238.7 ms** (12.6x under `< 3,000 ms` target). Parallel wall time is **2.21x–4.37x** faster than Brief J sequential drafting (`>= 2x` target met on all three).

---

## Part 2: Speed Audit (Measured on Chrome 390px 4x CPU Throttle + Python Backend)

### Top 15 Measured Hotspots

Recurrence classifications:  
`(a)` algorithmic fix in place · `(b)` offload to Web Worker · `(c)` existing Rust API (`SMD_RUST_PDF` / `rust/research-stats`) · `(d)` new Rust port proposal

| # | Hotspot | Input Size & Frequency | Before (ms) | After (ms) | Blocks UI? | Rec | Notes & Fix Summary |
| ---: | --- | --- | ---: | ---: | --- | --- | --- |
| 1 | Pure-JS SHA-256 fallback (`research-ondevice-pdf.js`) | 25 MB PDF; per upload when `crypto.subtle` absent | 1,153.1 (1,327.0) | 1,153.1 | Yes | `(b)` | Normal devices use async WebCrypto (`74.8 ms`). Move pure-JS fallback into a Web Worker if targeting insecure/legacy WebViews. |
| 2 | Rust WASM `SMD_RUST_PDF.lines()` on 341p thesis (`vendor/rust-pdf/rust-pdf.js`) | 341p / 9.97 MB; once per PDF upload | 777.3–846.5 | 777.3–846.5 | Yes | `(c)` / `(b)` | Already uses Rust WASM `(c)`; wrap calls in a dedicated Web Worker `(b)` to keep 60fps scroll uninterrupted on 300+ page theses. |
| 3 | JS Cox PH + Schoenfeld (`research-stats.js` `coxPartial`, `schoenfeld`) | 10k rows: 365 ties (4x Chrome) / 2k unique ties (Node) | **544.7** (4x 365t) / **908.4** (Node 2kt) | **40.8** (4x 365t) / **16.0 + 9.4** (Node 2kt) | Main in fallback/Node | **`(a)` FIXED** | Replaced O(B * N) risk-set rescan with O(N) backward suffix cumulative scan when `eta span <= 600`: **13.4x–56.8x speedup**. |
| 4 | pdf.js text extraction (`syn100` / `lehr175`) | 100p / 175p PDF; fallback when Rust skips (`>500p`) | 393.6 / 329.2 | 393.6 / 329.2 | Partial | `(c)` | Decodes in pdf.js worker; bypassed on text PDFs `<= 500p` by `SMD_RUST_PDF.lines()`. |
| 5 | Rust WASM `SMD_RUST_PDF.lines()` on 175p thesis | 175p / 13.7 MB; once per upload | 215.6–325.5 | 215.6–325.5 | Yes | `(c)` / `(b)` | Move Rust WASM execution to a Web Worker `(b)` (proposal). |
| 6 | Chapter tree + mapping on 341p thesis (`buildChapterTree`, `mapChaptersToJournal`) | 341p (~12k lines); once per upload | 129.7–181.6 | 129.7–181.6 | Yes | `(b)` | Single-pass over lines; co-locate in the PDF Web Worker if moved off main thread. |
| 7 | Client ROC + DeLong CI (`research-stats.js` `roc` + `research-screen-masterchart.js` `runRoc`) | 10,000 rows x 2 markers; per ROC click | **85.0–106.7** UI block | **7.3 UI block** (147.8 Worker) | Was Yes | **`(b)` FIXED** | Added `roc`/`aucBand` to `research-stats-worker.js`, synced stale `?v=` importScripts token, added `SMD_RMD_ONDEVICE_STATS.roc()`, offloaded `rows >= 250` cleanly. |
| 8 | Python Cox PH + Schoenfeld (`backend/research/stats/survival.py`) | 10k rows x 3 covs (365 ties / 2k unique ties) | **106.13** (365t) | **69.01** (365t) / **88.95** (2kt) | No (server) | **`(a)` FIXED** | Added vectorized `np.cumsum` suffix cumulative scan in `_efron_terms` and `_schoenfeld_ph_test` replacing `X[start:]` per-block slice loops. |
| 9 | JS Table 1 summary (`research-stats.js` `table1`) | 10k rows x 6 variables; per Table 1 click | 104.7 (Node) | 104.7 | Yes | `(b)` | `table1` is already allowlisted in `research-stats-worker.js`; route `>= 500` row runs off main thread in a follow-up. |
| 10 | JS Logistic IRLS (`research-stats.js` `logistic`) | 10k rows x 5 predictors; per regression run | 93.7–138.2 | 93.7–138.2 | Worker when OD on | `(d)` | Runs in `research-stats-worker.js` when `onDeviceV2` is active; propose Rust linear-algebra port in `rust/research-stats` for 50k–100k cohorts. |
| 11 | Client/Worker WebCrypto `sha256` (`research-ondevice-pdf.js` / `research-ondevice-stats.js`) | 25 MB buffer; once per upload/job | 74.8–76.0 | 74.8–76.0 | No (async) | `(a)` FIXED | Added `TextEncoder` fast path in `research-ondevice-stats.js` before `crypto.subtle.digest` to skip JS byte-array growth on big CSV strings. |
| 12 | Python PHI scanner (`po_adapter/phi.py` `scan`) | 300k chars; per cloud job | 58.55–67.98 | 58.55–67.98 | No (server) | `(a)` / `(d)` | Combine rule regexes into a fast prefilter or propose Rust Aho-Corasick binding for multi-MB corpora. |
| 13 | Thesis number grounder (`research-screen-thesis.js` `verifyNumbers`, `findNumber`) | 2k-word draft (500 tokens) vs 341p Campbell | **46.7** (4x Chrome) | **7.8** (4x Chrome) | Yes | **`(a)` FIXED** | Added per-call `tokCache` for duplicate tokens plus binary-search cached table offsets in `findNumber`: **6.0x speedup**. |
| 14 | Record deduplication (`functions/api/research/_dedup.js` `dedupRecords`) | 5,000 RIS records; per search merge | 46.0–94.8 | 46.0–94.8 | No (CF Worker) | `(a)` / `(d)` | Flatten inner `[key, seen]` array allocations, or propose Rust WASM dedup+parser for 20k+ Systematic Review imports. |
| 15 | Client DOCX ZIP parse (`parseDocx`, 12 MB) & Python `docx_export` (10k words) | 12 MB client `.docx` / 10k-word export | 43.7–46.9 / 33.45–43.06 | 43.7–46.9 / 33.45–43.06 | Client parse yes | `(d)` | Fast today; propose Rust WASM streaming ZIP+XML extractor only if targeting 50+ MB `.docx` theses with embedded media on memory-tight devices. |

*(Additional fast baselines measured `< 30 ms`: `po_gates_scanPhi_user_300k` `27.9–36.1 ms`, `po_gates_scanPhi_strict_300k` `21.2–25.7 ms`, `linear_10k` `18.8 ms` Node, `client_docx_export_10k` `11.6–13.6 ms`, `research_phi_scan_300k` `12.2–17.2 ms`, `py_po_adapter.latex_to_manuscript_10k` `10.17–12.46 ms`, `stats_km_10k` `6.8–9.8 ms`, `stats_logrank_10k` `7.6–8.3 ms`, `meta_analysis_100_studies` `6.4–11.9 ms`, `gate_manuscript_10k` `5.3–5.5 ms`, `parseCsv_10k` `5.0 ms` Node, `forest_plot_svg_100` `2.1–2.2 ms`, `prisma_render` `1.1–2.2 ms`.)*

### Proposals for New Rust Ports (`(d)` — Not Implemented Here)
1. **`rust/research-stats` WASM completion**: Port `logistic`, `roc` (DeLong), and `table1`, and ship compiled WASM alongside `cox`/`schoenfeld` for 50k–100k row clinical cohorts inside `research-stats-worker.js`.
2. **Systematic Review WASM parser + dedup + Aho-Corasick PHI**: Handle 20k+ RIS/PubMed records and 300k+ char PHI multi-pattern scans in a single zero-GC Rust pass under Cloudflare Worker CPU limits.
3. **Mobile `.docx` streaming ZIP/XML + image-stripping reader**: Avoid holding large compressed media entries in JS `ArrayBuffer` memory on low-RAM phones.

---

## Verification & Compliance
- **Unit suites**:
  - `test/research-thesis-chapters.test.mjs`, `test/research-thesis.test.mjs`, `test/research-thesis-render.test.mjs` — 24/24 passed after final edit.
  - `test/research-stats-survival.test.mjs`, `test/research-ondevice-stats.test.mjs`, `test/rust-pdf-reader.test.mjs` — passed (including 600-row unique-time Cox + Schoenfeld test and `OD.roc` Web Worker test).
  - `backend/research/tests/test_stats_survival.py` — 12/12 passed (`uv run ... pytest -o addopts="" --noconftest`).
  - Full `npm test`: note `test/no-side-stripes.test.mjs` fails only on `"scanned the app source"` when run from a path containing spaces (`/Volumes/WD BLACK...`) because `new URL("..", import.meta.url).pathname` keeps `%20`; a direct regex scan confirmed zero side-stripe hits in all modified UI files.
- **UI harness suites**: All **35** ResearchMD UI harness scripts (`test/run-research-*-ui.mjs` + `test/run-research-ui.mjs`) passed in headless Chrome (extending `test/run-research-thesis-ui.mjs` for chapter mapping overrides, multi-chapter bounded parallel drafting, single-section retry, `44px` targets, zero overflow, zero em/en dashes, and zero page errors).
- **Live `www/` bundle verification**: Rebuilt `www/` via `scripts/build-www.sh` (`build: #1407`), served on `127.0.0.1:8812`, drove headless Chrome on `CDP_PORT=9473` across live `-scik1` scripts, ROC Web Worker execution, and real 175p Lehr PDF chapter mapping at 390px in both light and dark modes (zero overflow, zero dashes).

### Modern Web Guidance (UI Checks)
- **Accessibility**: Interactive chapter mapping toggle (`#rmdChapterMapToggle`), chapter destination selects (`[data-rmd-chapter-id]` with explicit `<label for="rmdChSel_...">`), and per-section retry buttons (`[data-rmd-retry-section]`) all meet `>= 44px` tap targets, preserve semantic focus/button roles, maintain `>= 4.5:1` contrast in light & dark themes, and respect `@media (prefers-reduced-motion: reduce)`.
- **Forms**: Labels sit directly with their `<select>` controls inside `.rmd-chapter-row` with `overflow-wrap: anywhere`, explicit status feedback (`#rmdExcludedSummary`, `#rmdDraftProgressList` with `tabular-nums`), and non-destructive per-chapter adjustment before AI drafting.
