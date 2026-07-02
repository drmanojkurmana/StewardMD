# M2 Phase 3 — hard-variant gold cases

Adds a **second, non-classic presentation for every diagnosable engine disease** (140 cases, `gc_242`–`gc_381`): atypical, elderly/frail, comorbid, severity-variant, or with an overlapping mimic — each still unmistakably its target diagnosis, grounded with the exact engine `targetId`. **Validation data + QA only — the engine is byte-identical** (golden + main-engine green).

## Library size
Phase 1: 101 · Phase 2: 140 · **Phase 3: 140** · seed: 8 → **389 total (78% of the 500 target).**

## Integrity
140/140 valid JSON · **0 invalid finding-keys** · 5 invalid expected-ids dropped · **0 empty-acceptableIds** · 0 no-findings · citations society+year only · all `ai_drafted / clinicianApproved:false`.

## Accuracy (replayed through the real engine, post-M3)
| Tranche | n | top-1 | top-3 | antibiotic |
|---------|---|-------|-------|-----------|
| Phase 1 (priority) | 101 | 59% | 74% | 71% |
| Phase 2 (classic sweep) | 140 | 88% | 96% | 86% |
| **Phase 3 (hard variants)** | 140 | **57%** | **85%** | 67% |
| **All** | 389 | **69%** | **86%** | 76% |

Phase 3 is deliberately the hardest tranche: on atypical/comorbid presentations the engine ranks the target **#1 57%** of the time but keeps it **in the top-3 85%** — a realistic stress test of the ranking, and the concrete work-list for further M3 tuning. Phase 2 classics (88%/96%) confirm the engine is strong on textbook input; the drop on variants is the expected, honest signal.

## Method (unchanged, reproducible)
140-agent workflow (one per diagnosable disease); each agent read the finding vocabulary + diagnosable-id list + its brief from disk, grounded with `targetId`, and authored a full clinician record in the variant style. Gated by `gate-m2-cases.mjs`; replayed warm through `test/run-case-validation.mjs` and re-baselined over all 389.

## Safety
`golden` + `main-engine` GREEN (engine unchanged). `baseline.json` re-baselined to 389 for regression protection. All cases pending clinician sign-off.

## Toward 500
389/500. Phase 4 (~110) can add multi-system / comorbid-overlap cases and deeper infective-stewardship scenarios to complete the target.
