# R1 Clinical-Safety Review — folfox-4.json (v2 re-mapped draft)

**Verdict: APPROVE (as DRAFT only).** Blocks promotion/selectability until gating conditions below are met.
**Goldens changed: no (intended: yes)** — file lives in `docs/superpowers/onco-protocols-v2/`, a staging area; not in `kb/`, not wired into any engine, `status: "DRAFT"`, `clinicalApprovalStatus: null`. No engine output or golden fixture is affected.

Confidence: 95.

## Scope
Re-mapped ONCQIS Standard Protocol, FOLFOX-4 (de Gramont), colorectal cancer. DRAFT, not promoted, not selectable. Reviewed doses/units/days/cycles, mandated caps, carboplatin AUC rule, supportive care/monitoring, VERIFY honesty, endorsement language.

## Critical
None.

## Important
1. **`evidenceStatus: "current"` is an unsourced inference.** The DeVita citation in the draft does not assert currentness. Schema default for unspecified is `"unknown"`. Either source the currentness claim or revert to `"unknown"`. Low clinical risk (standard actively-cited textbook), but it is a provenance assertion not present in the source — an audit-trail accuracy issue.
2. **Promotion gate (not a defect in the draft, a condition on its future use).** `histology`, `stage`, `treatmentSetting`, `lineOfTherapy`, `eligibilityCriteria`, `biomarkers` are all honestly VERIFY/empty. This is correct for a draft, but the protocol MUST NOT be promoted or made selectable until those are clinically resolved and `clinicalApprovalStatus` is set. Selecting a protocol with unresolved setting/line/eligibility is a patient-safety risk (e.g. adjuvant vs. metastatic dosing/duration decisions).

## Advisory
1. **Schema strict-validation fails on 3 VERIFY fields** (`histology`, `treatmentSetting`, `lineOfTherapy`) because `$defs/verifiable` uses `oneOf` and `"VERIFY"` satisfies both branches. This is a pre-existing schema bug (should be `anyOf`), not a mapping error, and non-clinical. Fix `standard-protocol.schema.json` repo-wide. Does not affect this file's clinical correctness.
2. `doseModificationRules` is thin (single ANC/platelet delay rule deferring to physician). Fails safe (delay/review), acceptable for a draft; expand before promotion.

## Verification against published source (FOLFOX-4, de Gramont; DeVita 12th ed, cited)
Every value matches the canonical de Gramont FOLFOX-4 regimen:

| Drug | Protocol | Published FOLFOX-4 | OK |
|---|---|---|---|
| Oxaliplatin | 85 mg/m2 IV 2 hr, day 1 | 85 mg/m2 IV 2 hr, day 1 | yes |
| Leucovorin | 200 mg/m2 IV, days 1-2 | 200 mg/m2 IV, days 1-2 (racemic) | yes |
| 5-FU bolus | 400 mg/m2 IV, days 1-2 | 400 mg/m2 bolus, days 1-2 | yes |
| 5-FU infusion | 600 mg/m2 over 22 hr, days 1-2 | 600 mg/m2 22-hr infusion, days 1-2 | yes |
| Cycle | 14 days | q2 weeks | yes |

Units (mg/m2, BSA basis), route sequencing (LV/oxali via Y-connector, then bolus, then 22-hr infusion), rounding increments — all clinically sound.

## Mandated-cap checks
- **Vincristine 2 mg cap:** N/A — no vincristine in FOLFOX-4. Correctly absent, not a missing cap.
- **Anthracycline cumulative cap:** N/A — no anthracycline in FOLFOX-4. Correctly absent.
- **Carboplatin AUC-based dosing:** N/A — no carboplatin. The one platinum present (oxaliplatin) is correctly BSA-based (85 mg/m2), which is the correct basis for oxaliplatin. No oxaliplatin absolute cumulative cap exists; the appropriate control is neuropathy monitoring, which IS present.

## Supportive care / monitoring
- Antiemetics: moderate emetogenic tier for an oxaliplatin-based regimen — correct.
- G-CSF: not routinely indicated, intermediate-risk assessment deferred — correct (FOLFOX-4 is not high FN risk).
- Monitoring: CBC each cycle, renal function (platinum), peripheral neuropathy each cycle (oxaliplatin) — appropriate and complete for this regimen.

## VERIFY honesty / endorsement
- No unsourced indication/eligibility value invented; all such fields are literal VERIFY or empty and listed in `verifyFields`. Honest.
- No endorsement/approval claim. NCCN references are factual pointers, not endorsement. `evidence.institutional: []`. No hospital identifiers. No em/en-dash.

## Conditions on APPROVE
1. Resolve `evidenceStatus` (source it or set `"unknown"`).
2. Do NOT promote/select until VERIFY fields resolved + `clinicalApprovalStatus` set + `review` populated.
3. Schema `oneOf`->`anyOf` fix is advisory (non-clinical) but needed for the validation gate.
