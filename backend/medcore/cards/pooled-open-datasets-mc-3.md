# Dataset card: pooled open ICU datasets (MC-3, first vasopressor within 12 h)

Run 2026-09-20. Every row real, openly licensed, no credentialing. Built by
`backend/medcore/pool.mjs`.

| Source | Encounters | With an MC-3 event |
|---|---|---|
| eICU-CRD Demo v2.0.1 (186 hospitals) | 2,477 | 225 |
| MIMIC-IV Clinical Database Demo v2.2 | 140 | 36 |
| MIMIC-III Clinical Database Demo v1.4 | 136 | 23 |
| **Total** | **2,753** | **284** |

28,029 prediction points on a 4 h grid; 16,112 train / 4,966 val / 6,951 test; 113 training
positives; 10.3 events per variable. 6,108 points excluded from the risk set for insufficient inputs.

## Result: FOUR OF SEVEN GATES FAIL. The model does not ship.

| | AUROC |
|---|---|
| deterministic threshold baseline | **0.7229** |
| the learned model | **0.7244** |
| frequency-only probe (knows only how often the patient was measured) | **0.6769** |

| Gate | Value | |
|---|---|---|
| missedEventsReduced25 | **-5.4%** - the model misses 39 events where the baseline misses 37, at the same alert budget | **FAIL** |
| beatsFrequencyProbe | margin 0.0476, needs 0.05 | **FAIL** |
| calibrationSlope | 0.71 (CI 0.55 to 0.89), overconfident | **FAIL** |
| noSubgroupCollapse | completeness q1: **0.3945** against 0.7244 overall | **FAIL** |
| ece | 0.0039 | pass |
| eventsPerVariable | 10.3 | pass |
| selectiveRiskFalls | 0.0134 to 0.0060 | pass |

## What this says

**The learned model adds nothing.** 0.7244 against a threshold rule's 0.7229, and at an equal alert
budget it misses MORE events than the rule does. The plan's order - beat the deterministic baseline
before any ML is worth having - was not a formality, and on this data the answer is no.

**Most of what it does have is the shortcut.** A model knowing only the observation schedule scores
0.677 of the 0.724. The physiology is worth about 0.05 AUROC over a staffing detector, which is why
that gate exists and why it fails here by 0.0024.

**Where the data is thinnest it is worse than chance.** Completeness quartile 1 scores 0.3945 - the
patients with the fewest recorded observations are the ones it gets backwards.

**It does not transfer evenly.** eICU 0.822, MIMIC-III 0.713, MIMIC-IV 0.683 - a 0.14 spread across
three sources of the same kind of patient, in one country. StewardMD ships to US and Indian wards.

## Honest limits of this run

284 events is small; every number here has a wide interval. The demos are subsets chosen for
teaching, not samples designed to be representative. eICU's dates are synthetic offsets. MC-3's
label is "a vasopressor was started", which is a treatment decision and therefore partly a fact
about the clinician. None of that is fixed by more careful modelling; it is fixed by more data and a
clinician-owned label definition.
