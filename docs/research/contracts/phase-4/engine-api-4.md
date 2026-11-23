# research-engine.js Phase 4 API (4.1 and 4.2)

File: repo-root `research-engine.js`. Pure ES5 IIFE, no DOM, no Date, no
Math.random, no I/O. Dual export unchanged: browser global
`SMD_RESEARCH_ENGINE` and CommonJS `module.exports`. Engine name
`research-engine`, version `rmd1` (unchanged; Phase 4 adds functions, not a
new engine version). All errors are `Error("research: ...")`.

Phase 4.1 functions take the SAME project shape as `run(project)`:
`{measure, model?, test?, level?, studies, createdAt?}` with every study
`verified === true`. Ratio measures stay on the log scale: every `effect`,
`yi` and CI below is on the ANALYSIS scale (log OR / log RR / log HR for
ratio measures); display code exponentiates. Defaults: model `random_dl`,
test `wald`, level 0.95.

Pinned metafor references are recorded in CI by `scripts/research-parity.R`
under the `phase4` key of `test/fixtures/research/parity.json` and compared
by `test/research-parity.test.mjs` at the section-12 gate (abs diff <= 1e-4
OR rel diff <= 1e-4).

## subgroup(project, key) -> subgroup result

`key` is a study field name (string, for example `"alloc"`). Every study
needs a string or number value there; grouping is by `String(value)`.
Throws on a missing/empty key, a missing field value, fewer than two
groups, or any subgroup with fewer than two INCLUDED studies (double-zero
drops do not count).

Each subgroup is pooled with `run()` on its subset using the project's own
measure/model/test/level, so subgroup results are full run results with
manifests.

Returns:

- `key`, `measure`, `model`, `test`: echoed settings.
- `groups: [{group, k, result}]` in first-appearance order; `group` is the
  original field value, `k` the included-study count, `result` the run
  result (pooled, wald, hksj, predictionInterval, heterogeneity, weights,
  excluded, notices, manifest).
- `between: {q, df, p, method}`: the test for subgroup differences.

**Exactly which between-group test is implemented:** the FIXED-EFFECT
between-group Q on the subgroup estimates,

```
w_g = 1 / se_g^2          (se_g = subgroup's reported pooled.se)
theta_bar = sum(w_g * theta_g) / sum(w_g)
Q_between = sum(w_g * (theta_g - theta_bar)^2)
df = G - 1,  p = chi-square upper tail
```

With `model: "fixed"` and `test: "wald"` this equals metafor
`rma(yi, vi, mods = ~ factor(g), method = "FE")` `QM` / `QMdf` / `QMp`
exactly (the pinned parity call). Under random models the subgroup
estimates come from the chosen model, but the between-group Q stays this
fixed-effect form: a random-effects QM with a common tau2 is NOT
implemented. Under `test: "knha"` the reported HKSJ SE feeds `w_g`.
`method` is the string `"fixed-effect between-group Q on the subgroup
estimates"` so the UI can label it.

## leaveOneOut(project) -> array of refit records

One refit per omitted INCLUDED study, matching metafor
`leave1out(rma(yi, vi, method = "FE"))` and `leave1out(rma(...,
method = "DL"))` (pinned parity calls; record order = fit order = study
order). Needs at least three included studies so every refit keeps two;
throws otherwise. Double-zero dropped studies are not iterated.

Each record: `{id, effect, se, ciLower, ciUpper, q, df, p, tau2, i2,
tau2Estimator}`. `effect` is the pooled analysis-scale estimate of the
remaining studies; CI follows the project test (Wald or untruncated HKSJ).
`tau2`/`i2` follow the engine convention: the reported DL (or REML)
heterogeneity estimate, labelled by `tau2Estimator`, even under model
`fixed` (which pools with tau2 0). Parity therefore compares the FE
records' tau2/i2 against the DL leave1out records, the same rule as the
Phase 1 FE checks.

## sensitivity(project, exclude) -> {run, excluded}

`exclude` is either an array of study ids or an EXCLUSION predicate:
`filterFn(study) === true` drops the study (returning true means exclude,
not keep). Unknown ids are ignored. Re-runs `run()` on the kept studies
with the same settings and caller `createdAt`.

Returns `{run: <full run result>, excluded: [ids actually removed, in study
order]}`. Throws when fewer than two studies remain, or when `exclude` is
neither an array nor a function. No pinned metafor call: this is a
deterministic re-run, checked against `run()` on the subset.

## egger(project) -> Egger test result

Classic Egger regression test, pinned to metafor
`regtest(rma(yi, vi, method = "FE"), model = "lm", predictor = "sei")`:
weighted least squares of `yi` on `sei` with weights `1/vi`, t test of the
`sei` coefficient against 0 on k - 2 df (algebraically the classic Egger
intercept). Returns `{slope, se, t, df, p, est, k, predictor, model}`; `est` is
the WLS intercept, the limit estimate at `sei = 0`. The model/test of the project do not
change the regression (it is always the lm/sei form); the project only
supplies the studies.

**Refuses k < 10** included studies (plan: publication bias only at 10+
studies): `research: Egger test needs at least 10 studies (got N)`. Also
throws when all SEs are equal (no predictor variation) or yi is an exact
linear function of se (zero residual variance); both guards are relative
to floating-point scale.

Returns `{slope, se, t, df, p, est, k, predictor: "sei", model: "lm"}`
where `se` is the sei coefficient's standard error, `t = slope / se`,
`df = k - 2`, and `p` is the two-sided Student-t p-value (regularised
incomplete beta, same machinery as tQuantile).

## funnel(project) -> funnel data (no drawing)

Included-study points plus the pseudo 95% limit lines for the FIXED-EFFECT
estimate (metafor `funnel()` default region), independent of the project's
model. Needs at least two included studies.

Returns:

- `points: [{id, yi, se}]` in study order, analysis scale.
- `fe: {effect, se}`: the FE reference estimate and its SE.
- `limits: {level, z, seFrom: 0, seTo, lower, upper}` where `seTo` is the
  largest study SE and `lower`/`upper` are two-point segments
  `[{se: 0, yi: theta_FE}, {se: seTo, yi: theta_FE -/+ z * seTo}]`.
  At any standard error s the pseudo limits are `theta_FE +/- z * s` with
  `z = qnorm((1 + level) / 2)`. Data only; the screen draws it.

Parity pins `fe.effect`, `fe.se` and `seTo` against the R FE fit; the
limit endpoints are checked against `feEst +/- qnorm(0.975) * seMax`.

## splitSharedControl(arms) -> comparisons

Multi-arm trial helper, Cochrane Handbook 23.3.4: divide the shared control
group's events and n evenly across the treatment comparisons.

`arms = {control: {events, n}, treatments: [{id?, events, n}, ...]}` with
at least one treatment arm. All counts are integers >= 0, n >= 1,
events <= n (validated per arm).

**Integer handling (stated):** each of events and n is split as evenly as
possible: share i gets `floor(value / t) + 1` for the first
`value mod t` comparisons and `floor(value / t)` for the rest. Shares sum
exactly to the original control totals; the first comparisons receive the
odd units; events never exceed n in any share. No fractional counts, no
rounding of effects.

Returns study-shaped comparisons `[{id?, events1, n1, events2, n2}]` in
treatment order: treatment arm as arm 1, control share as arm 2, ready for
`effectFromRaw` / `run`. `id` is copied from the treatment arm when present.
No pinned metafor call (Handbook formula; unit-tested by hand arithmetic).

## clusterAdjust(study, icc, meanClusterSize) -> adjusted study

Cluster-randomised adjustment, Cochrane Handbook 23.1.4: design effect
`DE = 1 + (m - 1) * ICC` with mean cluster size m.

- Binary study `{events1, n1, events2, n2}`: BOTH events and n are divided
  by DE in each arm (event rates are preserved).
- Continuous study `{mean1, sd1, n1, mean2, sd2, n2}`: n only is divided;
  means and SDs are unchanged.

Validation: `0 <= icc <= 1`, `m >= 1`, counts integer, n >= 1,
events <= n, SDs > 0; anything else throws.

**Effective counts are kept FRACTIONAL (no rounding).** The engine's
raw-count path requires integers, so feed the effective study to generic
inverse-variance input (compute yi/vi from the effective counts) or round
explicitly first; the contract does not round silently.

Returns `{study, designEffect, icc, meanClusterSize}` where `study` carries
the effective fields plus `id` when present. ICC 0 or m 1 gives DE 1 and
the unchanged study. No pinned metafor call (Handbook formula).

## crossoverAdjust(input) -> paired effect

Crossover trial paired analysis, Cochrane Handbook 23.2.6 approach. Two
shapes:

1. `{md, se}`: the reported PAIRED mean difference and its SE are used
   as-is. `method: "paired-reported"`.
2. `{mean1, sd1, mean2, sd2, n, corr}`: arm summaries plus the
   within-patient correlation r between periods. Formula (stated):
   `Var(MD) = (s1^2 + s2^2 - 2 * r * s1 * s2) / n`, i.e.
   `SD_diff = sqrt(s1^2 + s2^2 - 2 r s1 s2)` and `SE = SD_diff / sqrt(n)`.
   `method: "paired-imputed-corr"`. r = 0 reproduces the unpaired MD
   variance; the correlation must be supplied, never assumed.

Validation: finite inputs, se > 0 (shape 1), SDs > 0, integer n >= 1,
`-1 <= corr <= 1` (shape 2); a non-positive paired variance throws.

Returns `{id?, yi, vi, se, method}` on the natural scale, ready for generic
inverse-variance pooling. No pinned metafor call (Handbook formula).

## medianToMean(q1, median, q3, n) -> {mean, sd, method}

Wan et al. 2014 (BMC Med Res Methodol 14:135), scenario S2 (median and
quartiles), assuming an approximately normal underlying distribution:

```
mean = (q1 + median + q3) / 3
SD   = (q3 - q1) / (2 * Phi^-1((0.75 n - 0.125) / (n + 0.25)))
```

`method: "wan2014-s2-iqr"` so the UI can show the formula used. Validation:
finite values, integer n >= 2, `q1 <= median <= q3`, `q3 > q1`.
`Phi^-1` is the engine's Acklam inverse normal (|err| < 1.2e-9, exposed as
`normalQuantile`).

## rangeToMean(min, median, max, n) -> {mean, sd, method}

Wan et al. 2014 scenario S1 (minimum, median, maximum):

```
mean = (min + 2 * median + max) / 4
SD   = (max - min) / (2 * Phi^-1((n - 0.375) / (n + 0.25)))
```

`method: "wan2014-s1-range"`. Validation: finite values, integer n >= 2,
`min <= median <= max`, `max > min`.

## normalQuantile(p) -> number

Newly exposed helper (already used internally): inverse standard-normal
CDF, Acklam approximation, |err| < 1.2e-9. Throws outside 0 < p < 1. Used
by the Wan denominators; exposed for screens and tests.

## Parity coverage (CI, dat.bcg RR, 13 trials)

Recorded by `scripts/research-parity.R` under `parity.json.phase4`:

- `leaveOneOut.FE` / `leaveOneOut.DL`: `leave1out(rma FE)` /
  `leave1out(rma DL)` estimate, se, ci.lb, ci.ub, Q, Qp, tau2, I2 per
  omitted study, in fit order.
- `egger`: `regtest(rma FE, model="lm", predictor="sei")` sei coefficient and se
  (from `$fit`), limit estimate (`$est`), t (`zval`), p (`pval`), df (`dfs`), k.
- `subgroup.between`: `rma(yi, vi, mods=~factor(alloc), method="FE")`
  QM / QMdf / QMp; `subgroup.groups`: per-alloc FE and DL fits.
- `funnel`: FE estimate, FE se, max study se.

Same gate as Phase 1 (abs or rel <= 1e-4), exact df/k, tiny-p rule below
1e-6, exact tau2 = 0 boundary. The DL subgroup between-group Q is NOT
pinned (no common-tau2 random-effects QM is implemented).
