# ResearchMD plan v2 re-audit: Gemini Neon, High thinking (2026-11-23)

Score: **8.0/10** (up from 6.5). Earlier 22 gaps: 12 fully fixed, 10 partly fixed, 0 not fixed. Summary of Gemini's reply, condensed.

## Partly fixed (earlier numbering)
1 form factor (needs a tablet-first rule for heavy editing + WebView PDF memory caps); 4 worker queue pattern; 6 OTA-to-API version skew, D-4 too late; 11 5B/5C still prose; 13 single `research.js` file; 14 JS vs Python engine boundary; 17 number gate; 20 three section 12 gates flawed; 21 terms check after connectors; 22 flag-off export.

## Tablet answer
Right call within the mobile-only rule. Guardrails: phone is view/screen/verify/approve only for Phase 3 PDF extraction and 5A editing; cap pdf.js rendering (current page plus or minus 1, max 3 canvases, destroy offscreen) to avoid iOS WebView memory kills.

## New gaps in v2

### Critical
1. Three section 12 gates are wrong: "0 free-typed numbers" blocks every real paper (years, "two reviewers", p < 0.05) and misses claim polarity; "re-run returns stored count" fails because databases change daily; flat 1e-4 parity is too loose near zero and too strict for large Q.
2. One `research.js` file: Pages Functions cannot cleanly import a browser IIFE with DOM code, and three builders would collide on one file.
3. Queue relay pattern is broken: a push consumer calling the container hits Worker limits; a 202 hand-off acks the message and skips retries and the DLQ. Use a Cloudflare pull queue polled by the container (lease, visibility timeout, ack on complete, DLQ).
4. REML, HKSJ and prediction intervals need the exact `metafor::rma()` arguments pinned (method="REML", test="knha", truncation choice, PI formula), or the JS and R parity will disagree on edge cases.
5. `.gitignore` excluding `research/` will silently drop contracts, the adapter and fixtures; fix it in Phase 0.

### High
6. PHI gate has 100% recall but no false-positive limit; it would block author names, hospitals, dates and age brackets in real papers.
7. Flag OFF strands data with no screen to export it; add a Settings "Export my research data" path.
8. D-1 listed as needed by Phase 2 while Phase 1.2 already builds tablet layouts; database-terms review (2.7) after connectors (2.3).
9. Engine boundary: JS canonical for univariate meta-analysis (Phases 1 to 4); Python canonical for regression, survival, diagnostic models (5C); both stamp engine name and version.

### Medium
10. Offline conflict policy missing (optimistic concurrency with version and HTTP 409); headless tests must cover 375, 768 and 1024 px.
11. 5B and 5C lack package tables; mark provisional; split 5C into compliance/IPD and advanced designs.
12. Garbled characters (mojibake): caused by the clipboard transfer, not the file. The plan file is valid UTF-8.

## Route to 10/10 on paper
- Gates: numbers = 100% of statistical outputs in Abstract/Results are tokens, 0 untokenised numeric claims in Results, deterministic polarity/significance check against the CI; search = date-bounded query, API version, timestamp and full returned ID list archived in R2, re-run matches at least 99% (or replays 100% from the snapshot); parity = abs diff <= 1e-4 OR rel diff <= 1e-4 on estimates, SEs, CIs, Q, I², tau², exact on boundary cases; PHI gate adds false-positive rate < 2% on the 25-PDF clean benchmark.
- Split: pure zero-DOM `research-engine.js` (dual export) shared by the app and `functions/api/research/`; UI in `research/store.js` and `research/screens/*.js`. Fix `.gitignore` in Phase 0.
- Lock specs: pull-queue protocol; pinned metafor call; offline optimistic concurrency, 375/768/1024 px tests, pdf.js canvas cap.
- Loose ends: lock D-1 now; terms review to 2.0b; Settings export escape hatch; JS vs Python engine boundary; 5B/5C provisional.

## Only real use can prove
Tablet heavy work without WebView memory crashes; real PDF extraction and PHI-gate friction; PaperOrchestra value vs a lean pipeline (D-5); unit economics and willingness to pay; buildless ES5 maintainability past Phase 3.
