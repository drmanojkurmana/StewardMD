# Dataset card: medcore-synth-v1 (MC-3)

Generated 2026-09-19T14:31:21.713Z by `backend/medcore/run.mjs`.

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
| encounters | 3000 |
| prediction points | 38268 (grid 4 h) |
| train / val / test | 23110 / 7450 / 7708 |
| event rate | train 4.53%, val 4.44%, test 4.48% |
| excluded from the risk set | 3509 {"EXCLUDED_FROM_RISK_SET":3509} |
| injected prevalent cases | 242 (must be excluded, HAZ-ML-02) |
| injected rescued cases | 187 (the treatment paradox, labelled negative by construction) |
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

Gates: missedEventsReduced25 PASS, ece PASS, calibrationSlope FAIL, eventsPerVariable PASS, noSubgroupCollapse PASS, selectiveRiskFalls PASS, beatsFrequencyProbe PASS.
**Gated. This model does not ship.**

Model AUROC 0.9579, AUPRC 0.4977, ECE 0.0089,
calibration slope 0.8996.
Baseline (threshold, NOT NEWS2) AUROC 0.9141.
Frequency-only probe AUROC 0.5911.
Events per variable 19.0545.
