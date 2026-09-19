# Dataset card: medcore-synth-v1 (MC-3)

Generated 2026-09-19T14:19:12.804Z by `backend/medcore/run.mjs`.

## THIS DATA IS SYNTHETIC

There are no patients in it. It contains exactly the physiology `backend/medcore/synth/generate.mjs`
was written to contain, so every number below is a statement about the PIPELINE, never about people.
`provenance.synthetic` is true on every row and `medcore/medcore-models.js` refuses any artifact
built from it for every clinical purpose, with no override.

Not modelled: comorbidity, drug effects, diurnal variation, seasonality, any real missingness
mechanism, any site effect, and the atypical presentation that is the entire reason this project
exists.

## Cohort

| | |
|---|---|
| encounters | 400 |
| prediction points | 5283 (grid 4 h) |
| train / val / test | 3090 / 1067 / 1126 |
| event rate | train 4.27%, val 4.87%, test 2.93% |
| excluded from the risk set | 473 {"EXCLUDED_FROM_RISK_SET":473} |
| injected prevalent cases | 32 (must be excluded, HAZ-ML-02) |
| injected rescued cases | 30 (the treatment paradox, labelled negative by construction) |
| frequency bias | off |

## Splitting

By encounter first, then time: the earliest 60% of admissions train, the next 20% validate, the
latest 20% test, with the boundary encounter of each block dropped as a washout. No encounter
appears on both sides of a split.

## Leakage controls applied

- The state at each point is built with `asOf = t0` through the shipped `medcore-state.js`;
  nothing recorded later is visible, and the builder refuses it independently.
- Prevalent cases are excluded from the risk set, never labelled negative (`medcore-outcomes.js`).
- The declared blanking window before the event is dropped from the features.
- No observation count, interval or charting-frequency feature can enter the matrix
  (`medcore-features.js` throws). The shortcut is computed separately as a probe and trained on
  alone, as the adversarial check.

## Result

Gates: missedEventsReduced25 PASS, ece PASS, calibrationSlope FAIL, noSubgroupCollapse PASS, selectiveRiskFalls PASS, beatsFrequencyProbe PASS.
**Gated. This model does not ship.**

Model AUROC 0.9558, AUPRC 0.3028, ECE 0.0259,
calibration slope 0.6902.
Baseline (threshold, NOT NEWS2) AUROC 0.9313.
Frequency-only probe AUROC 0.628.
Events per variable 2.4.
