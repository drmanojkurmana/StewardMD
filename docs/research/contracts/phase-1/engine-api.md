# research-engine.js public API (Phase 1.1b, for the Phase 1.2 screen builder)

File: repo-root `research-engine.js`. Pure ES5 IIFE, no DOM, no Date, no
Math.random, no I/O. Dual export: browser global `SMD_RESEARCH_ENGINE` and
CommonJS `module.exports`; Pages Functions load the same file through
`functions/api/research/_engine.js`. Engine name `research-engine`, version
`rmd1` (in every manifest). Ratio measures (OR, RR, HR) pool on the log
scale: `pooled.effect` is a log OR / log RR / log HR and display code
exponentiates it. All CIs and the prediction interval are two-sided at
`level` (default 0.95).

## version: string

`"rmd1"`.

## effectFromRaw(study, measure, level?) -> study result or exclusion

`measure`: OR, RR, RD, MD, SMD. HR throws: a hazard ratio has no raw-count
form, pass a reported effect instead. `level` defaults to 0.95.

- OR/RR/RD from `{events1, n1, events2, n2}` (Cochrane 2x2; 0.5 added to all
  four cells when any cell is zero). OR/RR drop double-zero studies:
  `{excluded: true, reason: "double-zero"}`. RD keeps them (finite variance
  via the same 1/2 correction); the only RD exclusion is a study with no
  variation at all (`{excluded: true, reason: "zero-variance"}`).
- MD/SMD from `{mean1, sd1, n1, mean2, sd2, n2}`; SMD is Hedges' g with the
  Hedges-Olkin variance.
- Success returns `{id?, yi, vi, se, effect, ciLower, ciUpper}` where
  effect/CI are display-scale at `level` (exponentiated for OR/RR).

## effectFromCI(study, measure) -> study result

From `{effect, ciLower, ciUpper, ciLevel?}` (ciLevel defaults to 0.95). The
SE is recovered with the study's OWN ciLevel. OR/RR/HR inputs must be
positive and are logged. Throws on `ciLower >= effect`, `effect >=
ciUpper`, non-positive ratios, and non-finite inputs.

## effectFromGeneric(study, measure, level?) -> study result

Generic inverse variance. Two shapes: `{yi, se | sei | vi}` already on the
analysis scale (for OR/RR/HR the caller passes the logged yi, for example a
log HR with its SE), or `{effect, ciLower, ciUpper, ciLevel?}` which follows
the effectFromCI path. When both shapes are present the effect/CI shape
wins, matching run(). Display fields follow the same rule as effectFromRaw.

## pool(rows, opts?) -> result

`rows`: analysis-scale `[{id, yi, vi}]`, plus pass-through
`{id, excluded: true, reason}` rows. `opts`: `{model, test, level}` with
`model` fixed | random_dl | random_reml (default random_dl), `test` wald |
knha (default wald), `level` (default 0.95).

Returns:

- `model`, `test`: the fitted combination.
- `pooled: {effect, ciLower, ciUpper, se}`: Wald (normal) CI, or the
  untruncated HKSJ CI (t on k-1 df) under test knha.
- `wald: {se, ciLower, ciUpper}`: always the normal-theory CI.
- `hksj`: null under wald; under knha `{se, ciLower, ciUpper, df: k-1,
  truncated}` where `truncated` is null unless the HKSJ CI is narrower than
  the Wald CI, in which case `{se, ciLower, ciUpper,
  reason: "hksj-narrower-than-wald"}` (t critical value with the larger Wald
  SE; the UI notes it).
- `predictionInterval`: null when k < 3, else `{lower, upper, level, df}`
  following predict(rma_fit): t on k-2 df under knha, normal otherwise,
  width from sqrt(tau2 + se^2) with the reported se. Under fixed the pooling
  tau2 is 0, so the interval collapses to the CI width.
- `heterogeneity: {q, df, p, i2, tau2, tau2Estimator, iterations?,
  converged?}`: Q with chi-square upper-tail p; I2 is the Higgins-Thompson
  `tau2 / (tau2 + s2)` from the reported tau2 (0 when it is 0); tau2 is the
  DL estimate except under random_reml (REML by Fisher scoring, stepadj 0.5,
  step-halving, clamped at 0, maxiter 1000; `iterations`/`converged` only
  then). Fixed runs pool with tau2 0 but still report the DL tau2 labelled.
- `weights`: per-study percentages summing to 100.
- `excluded`: `[{id, reason}]` for dropped studies.
- `notices`: UI strings. `DL-only: ...` when model is random_dl with a Wald
  CI; `REML-did-not-converge: ...` when REML hits a limit; `hksj-truncated:
  ...` when the truncated variant is reported.

Throws when fewer than two rows, fewer than two included studies, bad yi/vi,
or unknown model/test/level.

## run(project) -> pool result plus manifest

`project: {measure, model?, test?, level?, studies, createdAt}`. Every study
needs `verified === true` or run throws listing the ids. Routing per study:
`effect` present uses effectFromCI, else `yi` present uses effectFromGeneric,
else effectFromRaw at the run level. `createdAt` is caller-supplied (offline
queue time allowed); the engine never calls Date. Adds
`manifest: {engine: "research-engine", engineVersion, measure, model, test,
level, inputs: [{id, values}], createdAt}` where values echo the study
inputs for re-pooling.

## tQuantile(p, df) -> number

Inverse Student-t CDF, ES5 with no dependencies (exact Cauchy form at df 1,
incomplete-beta inversion otherwise, normal limit past df 10000). Used
internally for knha CIs and prediction intervals; exposed for screens and
tests.
