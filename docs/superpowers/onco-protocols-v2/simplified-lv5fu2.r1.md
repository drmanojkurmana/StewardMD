# R1 Clinical-Safety Review — simplified-lv5fu2.json (DRAFT)

Scope: re-mapped ONCQIS Standard Protocol, status DRAFT, clinicalApprovalStatus null, not promoted, not selectable.
Confidence: 92. Goldens changed: no (intended: n/a — data file, no engine/rule change; no golden/regression suite touches this draft).

## Verdict: APPROVE (draft only; two items MUST be resolved before promotion/selectable)

## Clinical correctness — PASS
Matches published simplified LV5FU2 / de Gramont (DeVita 12th ed., cited lines 123481/123486/123487):
- Leucovorin 400 mg/m2 IV over 2 hr, day 1 — correct.
- 5-FU 400 mg/m2 IV bolus, day 1 — correct.
- 5-FU 1200 mg/m2/day × days 1-2 = 2400 mg/m2 continuous over 46-48 hr — correct.
- Cycle length 14 days (q2wk) — correct. cycles null (open-ended palliative) — acceptable.
All units mg/m2, BSA-based, rounding 50 mg — sane for these agents.

## Drug-class safety caps — N/A, correctly absent
- Vincristine 2 mg cap: regimen contains no vincristine → not applicable, correctly absent.
- Anthracycline cumulative cap: no anthracycline → not applicable, correctly absent.
- Carboplatin AUC dosing: no carboplatin → not applicable, correctly absent.
No missing cap for any drug actually present.

## Supportive care / monitoring — PASS
- Emesis: 5-FU bolus+infusion = low emetic risk, PRN antiemetic — correct per NCCN Antiemesis.
- G-CSF: not routinely indicated for this low-FN-risk regimen — correct.
- Monitoring CBC pre-cycle; clearance checks CBC/platelets, renal, liver, prior-cycle status — appropriate.

## Honesty of unsourced fields — PASS with one exception
histology, stage, biomarkers, treatmentSetting, lineOfTherapy, eligibilityCriteria all left VERIFY / empty and enumerated in verifyFields. No fabricated clinical values. No endorsement/"NCCN-approved"/"certified" language anywhere.

## Important (resolve before promotion — NOT blocking the draft)
1. `treatmentIntent: ["palliative"]` is a concrete unverified indication claim that is NOT marked VERIFY and NOT listed in verifyFields. LV5FU2 is used in both adjuvant and palliative settings; scoping it to palliative-only is a clinical assertion. Confirm it is sourced from the draft; if not sourced, it must be VERIFY like the sibling indication fields.
2. Schema validation currently FAILS: `$defs/verifiable` oneOf rejects the literal "VERIFY" sentinel (per verify.md, batch-wide schema defect, not this file's fault). A protocol that cannot pass its own schema must not be promoted to selectable until the schema is fixed. Not a clinical error in this file.

## Advisory
- `evidence.core[0].evidenceStatus: "current"` is a mild unsourced inference (schema default would be "unknown"); low risk for a standard textbook citation.
- Draft's nccnAppendices letters (justifying emesis/G-CSF tiering) dropped from a structured field, now only in supportiveCare prose — traceability loss, not a safety issue.
- doseModificationRules are thin ("physician decides"); acceptable for a fail-to-human draft.

No false negative, no wrong dose/score, no dismissable critical alert, no deprecated guideline shipped.
