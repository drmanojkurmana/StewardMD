# PrepNucleus Layer B source packs, 2026-10-06

Built by `tools/prep-packs.mjs` (no model call, $0). Plan: [[PrepNucleus]] 6.3. Module note: [[modules/PrepNucleus]].
Threshold 0.3 (normalised BM25), word target per module = 140 x questions needed, clamped 1,500 to 6,000.

## Coverage (898 shortfall modules without a hand-made pack; the 9 pilot packs are untouched)

| Source | Modules | Pack root |
|---|---|---|
| KB only | 194 | `prep/fill/packs/<module>/` (committed) |
| StatPearls only | 167 | `~/prep-data/packs-statpearls/<module>/` (not in the repo) |
| KB + StatPearls | 530 | `~/prep-data/packs-statpearls/<module>/` (not in the repo) |
| Uncovered | 7 | none |

Distinct sources used: 1504 KB documents, 835 StatPearls chapters.
Modules at or above their word target: 49 of 891 covered.

| Subject | KB only | StatPearls only | Both | Uncovered |
|---|---|---|---|---|
| anaesthesia | 1 | 0 | 2 | 0 |
| anatomy | 0 | 1 | 0 | 0 |
| community-medicine | 1 | 4 | 0 | 0 |
| dermatology | 2 | 1 | 1 | 0 |
| ent | 1 | 0 | 0 | 0 |
| medicine | 4 | 1 | 0 | 0 |
| paediatrics | 0 | 1 | 0 | 0 |
| psychiatry | 0 | 1 | 0 | 0 |
| ss-biostatistics | 0 | 6 | 0 | 0 |
| ss-cardiology | 8 | 7 | 18 | 0 |
| ss-critical-care | 5 | 23 | 35 | 0 |
| ss-endocrinology | 12 | 2 | 31 | 0 |
| ss-gastroenterology | 4 | 2 | 21 | 0 |
| ss-general-medicine | 70 | 32 | 120 | 0 |
| ss-haematology | 1 | 0 | 23 | 0 |
| ss-hepatology | 4 | 2 | 22 | 0 |
| ss-infectious-diseases | 24 | 16 | 41 | 2 |
| ss-medical-oncology | 6 | 28 | 51 | 4 |
| ss-nephrology | 8 | 16 | 36 | 0 |
| ss-neurology | 16 | 13 | 56 | 0 |
| ss-pulmonology | 6 | 3 | 22 | 0 |
| ss-rheumatology-immunology | 21 | 8 | 51 | 1 |

## Words per pack

All covered packs: n 891, min 837, p25 2100, median 5571, p75 5922, max 6000.
KB part: n 724, min 253, p25 2050, median 2779, p75 4643, max 6000.
StatPearls part: n 697, min 102, p25 1213, median 2262, p75 4253, max 6000.

| Words | Packs |
|---|---|
| 0 to 999 | 1 |
| 1000 to 1999 | 26 |
| 2000 to 2999 | 213 |
| 3000 to 3999 | 11 |
| 4000 to 4999 | 16 |
| 5000 to 6000 | 624 |

## Matching precision (KB to module)

Measured by hand on 2026-10-06 (each pair judged: does the document teach part of this module's scope?).

- Calibration, 60 random module to document pairs across all scores (floor 0.05, seed 11): above 0.30, 32 of 34
  relevant (misses: septic bursitis for septic arthritis, enthesitis-related arthritis for spondyloarthritis
  treatment); 0.25 to 0.30, 11 of 15; below 0.25 mostly wrong. Threshold set at **0.30**.
- Check, 30 fresh random accepted pairs at 0.30 (seed 2026): **28 of 30 clearly relevant (93%)**, 2 borderline but
  usable (SLE protocol for pregnancy in rheumatic disease, vesicoureteric reflux for obstructive uropathy), 0 wrong.
- StatPearls chapter choice (title re-rank after esearch), 30 random module to chapter pairs (seed 99): **26 of 30
  relevant (87%)**; misses: male breast cancer for triple-negative breast cancer, adult DKA for mucormycosis, liver
  transplantation for cholangiocarcinoma, adolescent idiopathic scoliosis for school health.
- Every KB document is used only with its module's other matches (relative cut 0.5 x the top score), at most 6.


## Uncovered modules (7)

- `son-trial-design` Clinical trial design and evidence in oncology (need 15)
- `son-nsclc-driver` Oncogene addicted NSCLC (need 80)
- `son-geriatric-aya` Geriatric oncology, AYA and cancer in pregnancy (need 15)
- `son-cardio-oncology` Cardio-oncology (need 15)
- `srh-outcome-measures` Disease activity and outcome measures (need 15)
- `sid-newer-agents` Newer antibacterials and the pipeline (need 15)
- `sid-hsct-id` Infections in HSCT and cellular therapy (need 40)

## Fill dry run for the covered modules (no call made)

`node tools/prep-fill.mjs --dry-run --shortfall <covered rows of prep/fill/shortfall.json> --packs-extra ~/prep-data/packs-statpearls`
(`--module` was not used: with `--module` the dry run takes need 0 for every module, so it would price nothing.)

`total need 40639: in 67.88M out 26.78M  $28.57 (Rs 2743)`
