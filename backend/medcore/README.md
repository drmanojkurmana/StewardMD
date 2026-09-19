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

## Current state, honestly

The only data available is synthetic. On it the pipeline runs end to end and the model **fails the
calibration gate** (slope ~0.69, overconfident, at ~2.4 events per variable). That is the system
working: it produced a model and refused it. No artifact built here may reach a clinician, by
construction rather than by policy - see `medcore/medcore-models.js` and `test/medcore-models.test.mjs`.
