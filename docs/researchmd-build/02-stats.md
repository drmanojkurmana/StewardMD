# Phase 02: statistics on the device, checked against R
Branch: rmd-od-2-stats (from rmd-od-1-ocr). Writer: Gemini Hydrogen, agy account 2. Reviewer: Claude Opus 5.5, agy account 4.

## Rules
Read CLAUDE.md and vault/modules/ResearchMD.md first. StewardMD is a mobile app (iPhone, iPad, Mac, Android). App files are ES5 IIFEs. No em or en dashes in app-facing text. No secrets or patient data in code, tests, logs or URLs. Every new behaviour is ON by default (Manoj, 27 Nov): its flag exists only as a kill switch, read as on unless localStorage holds "0". Edit only the files listed under "Files". No commit, no push, no PR, no merge, no deploy.

## Goal
research-stats.js (window.SMD_RESEARCH_STATS, ES5, runs on the device) already has t-tests, ANOVA, non-parametric tests, chi-square, Fisher, logistic, Kaplan-Meier, log-rank and Cox, used by research-screen-masterchart.js. Port the three models the Python reference has and JavaScript lacks, make every model match R to the same tolerance the Python CI uses, and run models in a Web Worker so the screen never freezes. Python (backend/research/stats/) stays as the cloud fallback and the reference.

## Reference to match
- Python: backend/research/stats/regression.py (linear_regression with robust "HC3"), survival.py (cox_ph Schoenfeld PH test), diagnostic.py (per_study_accuracy, reitsma). Read them fully; copy their algorithms, defaults, warnings, error codes and output field names.
- R: scripts/research-parity-5d.R writes test/fixtures/research/parity-5d.json in CI (never committed). Pinned calls are listed at the top of that script: lm(mpg ~ wt + hp, mtcars) with HC3 from the hat matrix; glm binomial; survfit; survdiff; coxph efron; cox.zph(fit, transform = "km"); mada::reitsma defaults (correction 0.5, correction.control "all", REML); mada::sroc ruttergatsonis and naive on fpr 1:99/100.
- Gate: abs diff <= 1e-4 OR rel diff <= 1e-4 (same closeGate as test/research-parity.test.mjs and backend/research/tests/test_stats_parity.py).

## Files
1. `research-stats.js`: add `linear(rows, columns, outcome, predictors, types, opts)` (OLS; opts.robust "HC3"; coefficients, se, t, p, CI, R2, adj R2, F, AIC exactly as regression.py returns), `coxPh` Schoenfeld test (`schoenfeld(coxResult, rows, spec, {transform: "km"})` returning per-term chisq, df, p and global, like cox.zph), `diagnosticPerStudy(counts, opts)` and `reitsma(counts, opts)` plus `sroc(fit, fpr, type)`. Reuse existing matrix helpers (from logistic) and REML/optimiser code in research-engine.js where it exists; if you need BFGS, write a small one inside research-stats.js. Keep the existing exports unchanged.
2. NEW `research-stats-worker.js`: a dedicated Web Worker that importScripts the same research-stats.js and answers `{id, fn, args}` with `{id, ok, result}` or `{id, ok:false, error:{code,message}}`.
3. NEW `research-ondevice-stats.js` (window.SMD_RMD_ONDEVICE_STATS, dual export): `run(spec, rows, opts) -> Promise<result>` where spec uses the stats_model job model specs from backend/research/stats/job.py docstring (families linear, logistic, km, logrank, cox, diagnostic). It runs in the worker when Worker exists, else on the main thread (node tests). Result: the same aggregate shape job.py writes to result.json (read job.py `_result`/output code), plus `engine: "js"`, `engineVersion` (from a constant in research-stats.js), `dataHash` (sha256 of the canonical CSV of the rows used, like job.py), never rows. Timeout opts.maxSeconds (default 120) -> error code "ceiling_seconds". Max 100000 rows -> "ceiling_rows". Model errors keep the Python codes (invalid_formula, zero_cell, no_events, ...).
4. `research-screen-masterchart.js`: behind flag `rmd_ondevice_stats_v2` (DEFAULT ON: on unless localStorage "smd_rmd_ondevice_stats_v2" === "0"): (a) run logistic, KM, log-rank and Cox through SMD_RMD_ONDEVICE_STATS (worker) instead of the main thread; (b) add a "Linear regression" option next to logistic for numeric outcomes, with an "HC3 robust errors" toggle; (c) show the PH test under the Cox result ("Proportional hazards check" with per-term p and global p, and a plain sentence when p < 0.05). Each result shows a small "On this device" label. With the flag off, nothing changes.
5. If any research screen already shows diagnostic accuracy studies (grep for TP/FN/FP/TN or "sensitivity" in research-screen-*.js and research-engine.js), add the Reitsma summary there behind the same flag. If none does, only export the functions; do not build a new screen. Say which in a NOTE.
6. `index.html` script tag for research-ondevice-stats.js (?v=rod2) after research-stats.js; scripts/build-www.sh copies research-stats-worker.js and research-ondevice-stats.js into www/.
7. NEW `test/research-stats-parity-5d.test.mjs`: loads test/fixtures/research/parity-5d.json; SKIPS with a message when absent (same pattern as test/research-parity.test.mjs, never fakes the fixture); checks linear (coefficients, se, t, p, AIC, hc3Se), logistic (coefficients, Wald CI, AIC), KM steps and median CI, log-rank chisq and p, Cox coefficients, PH per-term and global, Reitsma coefficients and psi, SROC both types, on the datasets embedded in the JSON.
8. `.github/workflows/research-ci.yml`: in the parity-5d job, after the R fixture step, add setup-node (22) and run `node --test test/research-stats-parity-5d.test.mjs`. Add research-stats.js to the workflow's path filters.
9. NEW `test/research-ondevice-stats.test.mjs`: spec validation, ceilings, error codes, result has no row data, dataHash stable for the same rows in a different order only if job.py sorts (match job.py), engine fields present; small hand-checked cases (2x2 OLS with known answer).

## Don't
- Don't add a new blocking ethics gate to the masterchart screen in this phase (it would stop users mid-thesis). If you think one is needed, say so in a NOTE.
- Don't change backend/research/stats/*.py.
- Don't add encryption of the local dataset here (separate decision; note it if you see plaintext patient data at rest).

## Run
node --test --experimental-test-module-mocks --experimental-sqlite test/research-stats.test.mjs test/research-stats-edge.test.mjs test/research-stats-survival.test.mjs test/research-ondevice-stats.test.mjs test/research-stats-parity-5d.test.mjs
If R with survival and mada is installed on this Mac, first run `Rscript scripts/research-parity-5d.R` so the parity test does not skip, and say whether it ran or skipped.
