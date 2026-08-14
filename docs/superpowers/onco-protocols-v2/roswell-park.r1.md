# R1 Clinical-Safety Review — roswell-park.json (DRAFT)

Verdict: **APPROVE** (draft is clinically safe; two pre-promotion conditions below)
Status reviewed: `status: DRAFT`, `clinicalApprovalStatus: null`, not promoted, not selectable.
Goldens changed: **no** (intended: n/a — data-only protocol draft, no engine/rule change; no regression suite touches this non-selectable file).

## What this regimen is
Roswell Park weekly bolus 5-FU/LV for colorectal cancer:
- Leucovorin 500 mg/m2 IV (over 2 hr) weekly, days 1,8,15,22,29,36
- 5-Fluorouracil 500 mg/m2 IV bolus (1 hr into LV) weekly, days 1,8,15,22,29,36
- Cycle 56 days (6 weekly doses + 2 wk rest = 8 wk), cycles null

This matches the published Roswell Park / GI Intergroup (Haller/Petrelli) regimen: 5-FU 500 mg/m2 bolus + LV 500 mg/m2 weekly x6 every 8 weeks. Cited to DeVita 12th ed, Table 40.11 (Haller et al., 1998).

## Checklist

### Doses / units / days / cycles — PASS
- 5-FU 500 mg/m2 bolus and LV 500 mg/m2 are correct for this regimen. Units mg/m2, basis bsa — correct.
- Days [1,8,15,22,29,36] = 6 consecutive weekly doses; 56-day cycle is the correct 8-week repeat. Rest weeks 7-8 correctly implied by the day list vs cycle length.
- Rounding increment 50 mg is reasonable for these dose magnitudes.

### Vincristine 2 mg cap — N/A (no vincristine in regimen). No false negative: drug not present.
### Anthracycline cumulative cap — N/A (no anthracycline in regimen).
### Carboplatin AUC-based — N/A (no carboplatin in regimen).

### Supportive care / monitoring — PASS
- Emetic risk: bolus 5-FU is correctly classified low emetic risk; LV non-emetogenic. Correct.
- G-CSF not routine for this low-intensity regimen. Correct.
- Monitoring: CBC before each cycle + weekly during the 6-week block (appropriate for weekly myelosuppressive dosing), renal periodically. Adequate.
- Dose-mod: ANC <1000 / plt <100k day-1 delay — safe conservative gate.

### Unsourced fields honestly VERIFY — PASS
histology, stage, biomarkers, treatmentSetting, lineOfTherapy, eligibilityCriteria all VERIFY/empty and enumerated in `verifyFields`. treatmentIntent and disease label are faithful carry-overs from the draft, not invented.

### Endorsement / multi-tenant — PASS
No hospital name, no approved/endorsed/certified/official language. institutional layer empty. clinicalApprovalStatus null. No em/en dash.

## Findings

### Critical
None. No dose/unit/day/cycle error; no missing applicable cap (none apply); no false negative.

### Important
1. **`evidence.core[0].evidenceStatus: "current"` is an unsourced assertion.** The draft never states the DeVita 12th-ed table is current, and the schema default is `"unknown"`. This is the one place the mapping asserts a fact it cannot source. Per the honesty requirement, set to `"unknown"` before promotion.
2. **Dropped NCCN-pending signal.** The draft's `nccnTemplate/nccnGuideline: pending` was silently dropped rather than surfaced; `evidence.guideline` is `[]` with no `divergence` note. Before promotion, record that guideline-layer sourcing is outstanding so it isn't mistaken for "checked and none applies."

### Advisory
- Consider adding a DPD-deficiency caution to supportive care (standard for any fluoropyrimidine); not blocking for a draft.
- Schema strict-validation `oneOf` failure on the three `VERIFY` scalar fields is a schema defect (`oneOf` should be `anyOf`), not a data error — non-clinical, out of R1 scope but noted.

## Conditions before promotion to selectable
- Change `evidenceStatus` to `"unknown"` (or supply a source for "current").
- Surface the outstanding NCCN guideline-layer check.
- Resolve the six `VERIFY` fields (indication/eligibility) with sourced data — a colorectal regimen must not be selectable with histology/stage/setting/line unresolved.

Clinical content is safe and accurate for a non-selectable draft; the above are gating only for promotion.
