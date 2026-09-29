# Tokós CTG review queue

Reviews are done in the app: Review Desk (Home > Add Tool > Review content), Tokós tab. Each case and each block of teaching text is one item there; Read it opens the case in Tokós. The reviewer approves, approves after minor edits, or asks for changes, then exports, and the owner applies the export with `node scripts/apply-reviews.mjs <file.json>`. This file remains the pipeline notes: the suggested labels, outcome and quality note per case, and the field reference below.

Tokós is on for all users while the app is in testing (owner decision 2026-09-29). Until a case has a complete review the app shows its labels as "Rule-based, pending obstetrician review".

## How a review is recorded

Approving a case in the Review Desk sets `review` on the case in `tokos/decks/ctg.json` to the suggested labels as approved (a correction goes through Needs changes, then an edit here by hand). Every field the app reads:

- `by`, `date` (`YYYY-MM-DD`): who reviewed and when.
- `uc`: `normal`, `tachysystole`. Contractions answer.
- `baselineClass`: `severe_bradycardia`, `bradycardia`, `normal`, `tachycardia`. Baseline answer.
- `variability`: `reduced`, `normal`, `increased`. Variability answer.
- `decels`: `none`, `present`, `prolonged`, `over5`. Decelerations answer.
- `decelType`: `early`, `late`, `variable`, `prolonged`. Setting it also turns on the Resident deceleration type question for this case.
- `figo`: `normal`, `suspicious`, `pathological`. Overall category; the Resident Next step answer follows it.
- `complete`: `true` only when every graded field above was checked for this case (a field left out means you agree with the suggested label). This is the only thing that removes the rule-based banner.

A field left out keeps the suggested label. A value not in its list is ignored and the suggested label is used.

## Content to review

- `tokos/rationale.json`: all 14 teaching points shown under Why on the reveal, English and Hindi: `baseline.tachycardia`, `baseline.bradycardia`, `baseline.severe_bradycardia`, `variability.reduced`, `variability.increased`, `decels.present`, `decels.prolonged`, `decels.over5`, `uc.tachysystole`, `acidosis.metabolic`, `acidosis.acidaemia_not_metabolic`, `risk.pyrexia`, `risk.preeclampsia`, `trace_vs_outcome`.
- `tokos-ctg.js`, `L10N.en.opts` and `L10N.hi.opts`: the checklist option labels, and under `action` the three FIGO next-step strings graded at Resident level.
- `tokos-calipers.js`, `WORDS`: the caliper verdict text (variability bands for a bpm range, deceleration length bands for a time span), English and Hindi.

## Units and fields

Please also confirm units: the sources do not state them for pCO2 and BDecf. The app shows pCO2 in kPa (header median 7.0, range 0.7 to 12.3) and BDecf in mmol/L. Risk-factor and Induced fields are not shown because their 0/1 coding is unconfirmed.

## 1031 (normal_trace_normal_outcome)
- Trace: `tokos/media/ctg/1031.svg`
- Suggested FIGO: normal; baseline 140 (normal); variability normal (median range 9.5 bpm, reduced 9 min); decelerations 27 s variable (suggested), 27 s variable (suggested), 64 s variable (suggested), 30 s variable (suggested), 91.5 s variable (suggested), 27.25 s variable (suggested), 38.25 s variable (suggested), 19.75 s variable (suggested), 55 s variable (suggested); contractions 0.3 per 10 min
- Outcome: pH 7.31, BDecf 1.88, acidosis normal
- Quality note: strip FHR loss 1.4%, UC present 97.8%; no artefact concern found by the checks. Features are computed on the 60 min window.

## 1020 (normal_trace_normal_outcome)
- Trace: `tokos/media/ctg/1020.svg`
- Suggested FIGO: normal; baseline 155 (normal); variability normal (median range 17.8 bpm, reduced 4 min); decelerations 18 s variable (suggested), 15.75 s variable (suggested), 24.75 s variable (suggested), 21.75 s variable (suggested); contractions 2.7 per 10 min
- Outcome: pH 7.37, BDecf 3.29, acidosis normal
- Quality note: strip FHR loss 2.2%, UC present 95.8%; no artefact concern found by the checks. Features are computed on the 60 min window.

## 1035 (normal_trace_normal_outcome)
- Trace: `tokos/media/ctg/1035.svg`
- Suggested FIGO: normal; baseline 145 (normal); variability normal (median range 21 bpm, reduced 0 min); decelerations 16.5 s variable (suggested), 141 s late (suggested), 44.25 s variable (suggested), 23 s variable (suggested); contractions 3.3 per 10 min
- Outcome: pH 7.28, BDecf 5.36, acidosis normal
- Quality note: strip FHR loss 5.6%, UC present 95.8%; 931 samples above 180 bpm in the strip (529 in the last 5 min). Features are computed on the 60 min window.

## 1028 (decelerations)
- Trace: `tokos/media/ctg/1028.svg`
- Suggested FIGO: suspicious; baseline 140 (normal); variability increased (median range 34.5 bpm, reduced 0 min); decelerations 35.5 s variable (suggested), 54.75 s variable (suggested), 79.25 s variable (suggested), 36.25 s variable (suggested), 142.5 s late (suggested), 26.75 s variable (suggested), 116.75 s variable (suggested), 41.75 s variable (suggested), 31 s variable (suggested), 60 s variable (suggested), 44.5 s variable (suggested), 45.25 s variable (suggested), 85.75 s variable (suggested), 21.75 s variable (suggested); contractions 2 per 10 min
- Outcome: pH 7.25, BDecf 4.66, acidosis normal
- Quality note: strip FHR loss 1.3%, UC present 81.7%; 101 samples above 180 bpm in the strip (19 in the last 5 min). Features are computed on the 60 min window.

## 1495 (decelerations)
- Trace: `tokos/media/ctg/1495.svg`
- Suggested FIGO: suspicious; baseline 155 (normal); variability normal (median range 11.3 bpm, reduced 1 min); decelerations 21.25 s variable (suggested), 107.5 s variable (suggested), 15.75 s variable (suggested), 196.25 s prolonged (suggested), 110 s late (suggested), 48.25 s variable (suggested), 26.25 s variable (suggested), 27.5 s variable (suggested), 40.75 s variable (suggested), 42 s variable (suggested), 293.5 s prolonged (suggested), 29.25 s variable (suggested), 20 s variable (suggested), 43.5 s late (suggested); contractions 1 per 10 min
- Outcome: pH 7.03, BDecf 6.58, acidosis acidaemia_not_metabolic
- Quality note: strip FHR loss 2.1%, UC present 99.9%; strip baseline 125 differs from the 60 min baseline 155; 86 samples above 180 bpm in the strip. Features are computed on the 60 min window.

## 1048 (pathological_trace)
- Trace: `tokos/media/ctg/1048.svg`
- Suggested FIGO: pathological; baseline 135 (normal); variability increased (median range 34 bpm, reduced 1 min); decelerations 27 s variable (suggested), 20.5 s variable (suggested), 25.25 s variable (suggested), 16.25 s variable (suggested), 18.25 s variable (suggested), 23.25 s variable (suggested); contractions 3.3 per 10 min
- Outcome: pH 7.2, BDecf 4.88, acidosis normal
- Quality note: strip FHR loss 12.5%, UC present 90.8%; 77 samples above 180 bpm in the strip (36 in the last 5 min). Features are computed on the 60 min window.

## 1418 (metabolic_acidosis)
- Trace: `tokos/media/ctg/1418.svg`
- Suggested FIGO: suspicious; baseline 135 (normal); variability normal (median range 22.5 bpm, reduced 0 min); decelerations 21.25 s variable (suggested), 39.5 s variable (suggested), 41.25 s early (suggested), 15.5 s variable (suggested), 17.25 s variable (suggested), 15.5 s variable (suggested), 25.5 s variable (suggested), 17.75 s variable (suggested), 51 s variable (suggested), 20.25 s variable (suggested); contractions 2.7 per 10 min
- Outcome: pH 6.98, BDecf 14.39, acidosis metabolic
- Quality note: strip FHR loss 13.7%, UC present 91.6%; strip baseline 145 differs from the 60 min baseline 135. Features are computed on the 60 min window.

## 1241 (metabolic_acidosis)
- Trace: `tokos/media/ctg/1241.svg`
- Suggested FIGO: suspicious; baseline 140 (normal); variability increased (median range 29.3 bpm, reduced 0 min); decelerations 16 s variable (suggested), 19.75 s variable (suggested), 22.25 s variable (suggested), 22 s variable (suggested), 15.75 s variable (suggested), 29.25 s variable (suggested), 16 s variable (suggested), 25.75 s variable (suggested), 23.25 s variable (suggested); contractions 2.7 per 10 min
- Outcome: pH 6.99, BDecf 12.12, acidosis metabolic
- Quality note: strip FHR loss 13.2%, UC present 97.4%; no artefact concern found by the checks. Features are computed on the 60 min window.

## 1036 (baseline_abnormal)
- Trace: `tokos/media/ctg/1036.svg`
- Suggested FIGO: suspicious; baseline 165 (tachycardia); variability normal (median range 17.3 bpm, reduced 5 min); decelerations 17 s variable (suggested), 31.25 s variable (suggested), 47.75 s variable (suggested), 20 s variable (suggested), 27.75 s variable (suggested), 103 s variable (suggested), 52.25 s variable (suggested), 21.75 s variable (suggested), 59 s variable (suggested), 30.75 s variable (suggested), 37.25 s variable (suggested), 28 s variable (suggested), 16.25 s variable (suggested); contractions 3.3 per 10 min
- Outcome: pH 7.08, BDecf 8.11, acidosis acidaemia_not_metabolic
- Quality note: strip FHR loss 10.3%, UC present 83.7%; strip baseline 155 differs from the 60 min baseline 165; 622 samples above 180 bpm in the strip (359 in the last 5 min). Features are computed on the 60 min window.

## 1097 (fill)
- Trace: `tokos/media/ctg/1097.svg`
- Suggested FIGO: normal; baseline 150 (normal); variability normal (median range 10.8 bpm, reduced 16 min); decelerations 22.5 s variable (suggested), 18.5 s variable (suggested), 28 s variable (suggested), 23.5 s variable (suggested); contractions 1.3 per 10 min
- Outcome: pH 7.18, BDecf 4.31, acidosis acidaemia_not_metabolic
- Quality note: strip FHR loss 3.3%, UC present 96.3%; 2 samples above 180 bpm in the strip. Features are computed on the 60 min window.

## 1022 (fill)
- Trace: `tokos/media/ctg/1022.svg`
- Suggested FIGO: suspicious; baseline 135 (normal); variability normal (median range 20 bpm, reduced 0 min); decelerations 29 s variable (suggested), 40.75 s variable (suggested), 16.25 s variable (suggested), 30.75 s variable (suggested), 18.75 s variable (suggested), 23.75 s variable (suggested), 20.5 s variable (suggested), 15.5 s variable (suggested), 37.75 s late (suggested), 26 s variable (suggested), 21.75 s variable (suggested), 111.75 s late (suggested), 59.75 s variable (suggested), 73 s variable (suggested), 27.25 s variable (suggested), 28 s variable (suggested); contractions 4.7 per 10 min
- Outcome: pH 7.28, BDecf 1.53, acidosis normal
- Quality note: strip FHR loss 3.3%, UC present 87.4%; no artefact concern found by the checks. Features are computed on the 60 min window.

## 1033 (fill)
- Trace: `tokos/media/ctg/1033.svg`
- Suggested FIGO: suspicious; baseline 150 (normal); variability increased (median range 29.5 bpm, reduced 0 min); decelerations 23.5 s variable (suggested), 24.25 s variable (suggested), 24.5 s variable (suggested), 41.25 s variable (suggested), 35.25 s variable (suggested), 25.75 s variable (suggested), 32 s variable (suggested), 48.5 s variable (suggested), 16 s variable (suggested), 82.75 s variable (suggested), 21 s variable (suggested), 78 s variable (suggested), 19 s variable (suggested); contractions 1 per 10 min
- Outcome: pH 7.32, BDecf 0.89, acidosis normal
- Quality note: strip FHR loss 3.6%, UC present 60.7%; no artefact concern found by the checks. Features are computed on the 60 min window.

<!-- hand-maintained below: tools/tokos-ctg-prep.mjs keeps this section on regeneration -->
## Pipeline check of the rendered traces (not clinical sign-off)

All 12 SVGs were rendered and looked at on 2026-09-29. Candidates now also need, on the 30 min strip, FHR loss of at most 15% and UC present (finite and above 0) in at least 50% of samples. Grid, band, lines, ticks and paths all draw; no clipped scale.

- Archetypes not found in the pool: tachysystole, reduced_variability. Filled by 1097, 1022 and 1033.
- 1035 (labelled normal): FHR climbs to 180 to 200 bpm from 13 min on, with gaps and a dip to 55 to 60 bpm at 19 to 22 min. Sustained high values may be artefact or a real tachycardia episode; the 60 min baseline (145) hides it. Confirm the label.
- 1036 (tachycardia): 359 samples above 180 bpm in the last 5 min; FHR is at the top of the scale there, check it is not a signal artefact.
- 1033: UC is low and noisy from 5.5 to 20 min, so contraction counts are less reliable.
- 1048 (pathological): spikes above 180 bpm and short dropouts in the last 6 min; FHR looks normal before that. Confirm the label is not driven by artefact.
- 1495: strip baseline 125 differs from the 60 min baseline 155; the last third of the strip sits at 70 to 90 bpm.
- 1022: clean, regular contractions, late deceleration-like dips and a bradycardic stretch near the end, good teaching trace.
- 1241 and 1418: no FHR for the first 3 min (1241) and moderate dropout; otherwise clean.
