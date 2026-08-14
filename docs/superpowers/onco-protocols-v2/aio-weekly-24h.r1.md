# R1 Clinical-Safety Review — aio-weekly-24h.json

Status of artifact: DRAFT, not promoted, not selectable (`status: "DRAFT"`, `clinicalApprovalStatus: null`, `protocolVersion: "0.1-draft"`).

Verdict: **APPROVE** (draft may remain as a non-selectable draft; must NOT be promoted to selectable until the Important items below are closed).

goldens changed: no (intended: n/a — this is a non-promoted data file; no clinical engine, calculator, or golden logic changed).

## Regimen identity
AIO weekly high-dose 5-FU / folinic acid 24-hr infusion (Köhne regimen), colorectal cancer.

## Critical (blocking) — NONE
No false negatives, wrong doses, or unsourced-invented clinical values found.

Cap checks:
- Vincristine 2 mg cap — N/A, no vincristine in regimen (confirmed not silently omitted).
- Anthracycline cumulative cap — N/A, no anthracycline in regimen.
- Carboplatin AUC dosing — N/A, no carboplatin in regimen.

## Dose / unit / schedule verification — PASS
- Leucovorin 500 mg/m2 IV over 2 hr, day 1, weekly (7-day cycle). Matches DeVita 12th ed. / Köhne 1998. Correct and safe.
- 5-Fluorouracil 2600 mg/m2 IV over 24 hr, day 1, weekly, given immediately after LV. Matches the established AIO weekly regimen. Correct and safe. The 24-hr infusion route (not bolus) is essential at this dose and is correctly specified.
- cycleLengthDays 7; cycles null (continue-to-progression, physician-decided) — appropriate for a palliative fluoropyrimidine backbone.
- Rounding increment 50 mg — reasonable, no safety concern.

## Supportive care / monitoring — appropriate
- Emetic risk: low tier for 5-FU/LV — correct per NCCN antiemesis categories.
- G-CSF not routinely indicated — correct; AIO weekly 5-FU/LV is not intermediate/high FN-risk.
- Monitoring: CBC before each cycle + renal function — adequate baseline.
- Dose-mod rule (ANC <1000 / plt <100k -> delay, physician review) — safe, conservative.

## VERIFY honesty / endorsement — PASS
- histology, stage, biomarkers, treatmentSetting, treatmentIntent, lineOfTherapy, eligibilityCriteria all set to the VERIFY sentinel; no fabricated concrete indication/eligibility values. Honest.
- verifyFields lists all 7 VERIFY occurrences, matches body 1:1.
- evidence.guideline / evidence.institutional empty (not fabricated). evidence.core cites DeVita 12th ed. with line locators.
- provenanceNote explicitly states "no endorsement is implied." No "NCCN-approved" or institutional endorsement claim anywhere. PASS.

## Important (must close before promotion to selectable)
1. DPD (dihydropyrimidine dehydrogenase) deficiency is a recognized fatal-toxicity red flag for all fluoropyrimidines. Before this protocol becomes selectable, pre-treatment DPD-deficiency consideration should appear in eligibilityCriteria (currently VERIFY placeholder) and/or clearanceChecks. Not blocking the DRAFT, since eligibility is honestly VERIFY pending guideline-layer sourcing.
2. treatmentIntent fidelity: the source draft carried a sourced `intentOptions: ["palliative"]`; v2 replaced it with `["VERIFY"]`. This is safe (conservative) but loses a sourced value — restore `["palliative"]` when sourcing the indication layer.

## Advisory
- `disease` string "Colorectal cancer" vs KB canonical "Colorectal Cancer" — align casing to KB.
- Schema `$defs/verifiable` uses `oneOf` where `anyOf` is needed; the literal "VERIFY" string matches both branches and fails strict validation. Schema-owner bug, not a content defect in this file. Flag for schema owner.

## Chaining
- No PHI touched -> stewardmd-security-reviewer not required.
- No AI-assisted generation logic in this artifact -> stewardmd-ai-reviewer not required.

Confidence: 90.
