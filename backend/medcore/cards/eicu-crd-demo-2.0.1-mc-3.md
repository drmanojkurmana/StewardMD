# Dataset card: eicu-crd-demo-2.0.1 (MC-3, first vasopressor within 12 h)

Run 2026-09-20. Source: eICU Collaborative Research Database Demo v2.0.1, openly available, no
credentialing. Adapter: `backend/medcore/adapters/eicu-demo.mjs`.

## Provenance

Real patients. 2,477 ICU stays across **186 hospitals**, 6,353,242 observations, 225 stays with a
vasopressor start.

The DATES are synthetic. eICU de-identifies by storing offsets in minutes from unit admission and
no calendar at all, so each stay is anchored to a placeholder instant. Intervals and ordering are
real, which is all Medical Core uses; the calendar is not, and pretending otherwise would be the
one lie in this extract.

## Cohort

| | |
|---|---|
| prediction points | 23,936 (4 h grid) |
| train / val / test | 13,759 / 5,008 / 5,169 |
| positives | 109 train, 41 test |
| event rate | ~0.75% |
| excluded from the risk set | 5,975, all INSUFFICIENT_INFORMATION |
| events per variable | 10.9 (10 features, budgeted from the positives) |

## Result: FOUR OF SEVEN GATES FAIL. The model does not ship.

| Gate | Value | |
|---|---|---|
| beatsFrequencyProbe | model 0.785 vs probe **0.772**, margin 0.013 (needs 0.05) | **FAIL** |
| noSubgroupCollapse | site eicu-hosp-420 **0.248** vs 0.785 overall | **FAIL** |
| calibrationSlope | 1.56 (CI 0.98 to 1.97) | **FAIL** |
| missedEventsReduced25 | 5.9% (needs 25%) | **FAIL** |
| ece | 0.0038 | pass |
| eventsPerVariable | 10.9 | pass |
| selectiveRiskFalls | 0.0079 to 0.0023 | pass |

## The finding that matters

**A model that knows nothing except how often the patient was measured scores 0.772. The full
physiological model scores 0.785.** The measurement-frequency shortcut (HAZ-ML-01) is not a
theoretical risk in real ICU data - it is most of the apparent signal, and a model reporting 0.785
would have looked like a good deterioration model while being almost entirely a staffing detector.

On synthetic data the same probe scored 0.53 to 0.59, because the generator's observation schedule
was written by the same person as the control. No synthetic cohort can surface this. Only real
charting behaviour can, and it took one run to do it.

Second: at one hospital the model is **worse than chance** (0.248). A single-site evaluation would
have reported 0.785 and shipped.

## What this says about the pipeline

The gates worked. On synthetic data all seven passed and the numbers looked excellent; on real data
four failed and named exactly why. That difference is the entire argument for not trusting a model
until it has met real patients, and for keeping the gates strict enough to be inconvenient.
