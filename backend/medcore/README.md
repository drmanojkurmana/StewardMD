# backend/medcore — the Medical Core training pipeline

Offline. Nothing here ships to a phone. It turns an extract into a feature matrix, trains the
baselines, runs the Phase 4 gates and exports an artifact the app may or may not be allowed to load.

```
extract (medcore-encounter/1)          SCHEMA.md
      |  synth/generate.mjs  or  adapters/<source>.mjs
      v
featurize.mjs      <- calls the SHIPPED medcore/medcore-state.js + medcore-features.js at asOf=t0
      v
train.mjs          <- threshold baseline, logistic regression, isotonic calibration, the gates
      v
export-artifact.mjs  -> artifact + parity vectors
      v
medcore/medcore-models.js   <- admits or refuses it, and refuses synthetic outright
```

One command: `node backend/medcore/run.mjs` (writes a dataset card, a report and an artifact).

## Why Node and not Python

There is no numpy or scikit-learn in this environment, and building the baseline here has the
advantage the plan wanted anyway: **the trainer calls the app's own feature code**, so train/serve
skew is not a class of bug that exists. A feature changed in one place changes in both or not at all.
When real data and a Python stack arrive, a gradient-boosted model belongs beside this one; the
matrix is already JSONL it can read, and the plan requires it to BEAT the logistic baseline on the
same split before it replaces it. Parity vectors are what will catch the two scorers drifting apart.

## The three things this pipeline exists to make impossible

1. **Seeing the future.** `asOf` is an argument everywhere, the state builder refuses anything later
   independently, and the split is by encounter then by time with a washout.
2. **Counting observations.** `medcore-features.js` throws on a count, an interval or a charting
   frequency. The shortcut is computed separately as a `probe`, trained on ALONE, and a model that
   cannot beat it by 0.05 AUROC fails the run (HAZ-ML-01). `--frequency-bias` injects the shortcut
   into the synthetic cohort so the control can be watched firing.
3. **Turning prevalent cases into negatives.** The risk set is `medcore-outcomes.js`, the same
   function the bedside uses. A patient already on the treatment leaves the cohort (HAZ-ML-02).

## The gates (all must pass, on test only)

| Gate | Threshold |
|---|---|
| missed events vs the incumbent, at the SAME alert count | >= 25% relative reduction |
| Expected Calibration Error | <= 0.05 |
| calibration slope | 0.9 to 1.1 |
| worst subgroup AUROC below overall | <= 0.10 |
| selective risk | error falls as coverage falls |
| margin over the frequency-only probe | >= 0.05 AUROC |

A failing artifact is still exported, because "it failed the calibration gate" is a result the next
person needs. It simply cannot be loaded.

## THE TEST SPLIT IS READ ONCE

Not a style preference. While fixing the calibration failure below I looked at one cohort's test
slope, changed the model, and looked again - four times. Every one of those looks leaked test
information into model selection, and by the fourth the number was partly a description of my own
tuning. Model decisions belong on train and validation; the test split is read to REPORT, not to
steer. When it has been read and the model then changes, the honest move is a fresh cohort (a new
seed here, a new site or period on real data), which is what the clean read below is.

## Current state, honestly

The only data available is synthetic.

**The failure, and what was wrong.** The first run failed the calibration gate at slope 0.69, and
the diagnosis had three parts:

1. **The calibrator collapsed.** Isotonic fitted on ~52 validation positives degenerated into a step
   function: 61 of 64 points mapped to exactly 0 and two to exactly 1. Twenty-one test points
   predicted at 0.99 had an observed event rate of 0.19.
2. **The slope estimator hid it.** Probabilities of exactly 0 have no logit, so those rows were
   dropped and the slope reported anyway - computed on 454 of 1126 rows. 60% of the test set
   silently excluded, and the number that came back was flattering.
3. **2.4 events per variable.** 132 positives against 55 features.

**The fixes.** Both calibrators are now fitted and the winner chosen by cross-validated log loss
inside validation; every probability is clamped away from 0 and 1. The slope estimator refuses to
report a biased estimate (>5% excluded) and carries a bootstrap interval. The feature count is
budgeted from the positives at ten per variable, and events-per-variable is its own gate, because
the precondition should fail directly rather than turn up later disguised as overconfidence. L2 is
tuned on a held-out slice of train rather than hardcoded at a 3 nobody had justified.

**The clean read** (seed 90210, a cohort never tuned against, read once):

```
AUROC 0.960  AUPRC 0.499  ECE 0.008  slope 1.037 (95% CI 0.968 to 1.078)
at the same alert budget as the incumbent: 19 missed vs 64, sensitivity 0.94
frequency-only probe 0.566
ALL 7 GATES PASS
```

**What that does and does not mean.** It means the pipeline is sound: it caught a real defect,
refused a real model, and passes once the defect is fixed. It does not mean anything clinical. The
data is synthetic, so the model recovered a latent variable the generator wrote in - a fact about
`synth/generate.mjs`, not about patients. No artifact built here may reach a clinician, by
construction rather than policy: see `medcore/medcore-models.js` and `test/medcore-models.test.mjs`.
