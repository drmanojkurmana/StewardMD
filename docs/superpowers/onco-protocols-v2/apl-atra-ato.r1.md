# R1 Clinical-Safety Review — apl-atra-ato.json (v2 remap, DRAFT)

Verdict: **APPROVE** (as DRAFT — not promoted, not selectable)
Confidence: 90
Goldens changed: no (intended: n/a — data file not wired into any clinical engine; no golden/regression suite touched by this remap)

Scope reviewed: `docs/superpowers/onco-protocols-v2/apl-atra-ato.json` against its `apl-atra-ato.verify.md` and published dosing for low-risk APL (ATRA + ATO, Lo-Coco APML0406 / standard of care; Harrison 22nd ed. as cited core source).

## Confirmations (blocking checklist)

- **Doses / units / basis — CORRECT & SAFE.**
  - Tretinoin (ATRA) 45 mg/m2/day PO, basis `bsa` — matches standard low-risk APL induction.
  - Arsenic trioxide (ATO) 0.15 mg/kg/day IV, basis `weight` — matches standard.
  - Both dosed continuously (per-day); no numeric value fabricated.
- **Vincristine 2 mg cap — N/A, correctly absent.** No vincristine in regimen. No missing cap.
- **Anthracycline cumulative cap — N/A, correctly absent AND explicitly noted.** Low-risk APL ATRA+ATO is the anthracycline-sparing regimen; monitoring section correctly states "No anthracycline ... routine cardiac (LVEF) surveillance not triggered." No false negative.
- **Carboplatin AUC dosing — N/A, correctly absent AND explicitly noted.** No platinum agent; monitoring correctly states renal-clearance monitoring not triggered.
- **Supportive care / monitoring — APPROPRIATE for this regimen.**
  - Differentiation syndrome surveillance + management (glucocorticoids, cytoreduction, ATRA hold) present — this is the correct primary early toxicity.
  - ATO cardiac safety: ECG/QTc + potassium/magnesium before and during ATO present in both `monitoring` and `clearanceChecks` — the critical ATO toxicity is covered.
  - DIC/coagulopathy: coagulation panel in `clearanceChecks` — appropriate for APL early-death risk.
  - PML-RARA PCR response/relapse monitoring present.
  - Antiemetic / G-CSF reasoning correctly reflects that a differentiation regimen is not a myelosuppressive cytotoxic backbone.
- **Unsourced indication/eligibility honestly VERIFY — CONFIRMED.** `lineOfTherapy`, `eligibilityCriteria`, `cycleLengthDays`, `cycles`, both `days[]` are VERIFY/empty and all six are listed in `verifyFields`. `provenanceNote` honestly explains the continuous-dosing gap. No invented eligibility.
- **No endorsement claim — CONFIRMED.** No hospital, no "NCCN-approved"/"endorsed" language; citations only. `institutional: []`. Status `DRAFT`, `clinicalApprovalStatus: null`.

## Critical
None.

## Important
1. **Empty `days: []` with populated `dosePerUnit` must be resolved before promotion.** An empty days array alongside a live dose can be misread by a scheduler as "administer nothing." This is acceptable for a DRAFT and is gated by `status: DRAFT` + `verifyFields`, but `cycleLengthDays`, `cycles`, and both `days[]` MUST be filled (against NCCN per-disease template) and re-reviewed before this protocol is ever ACTIVE/selectable. Do not promote until then.

## Advisory
1. Supportive care could add explicit APL coagulopathy management targets (platelet/fibrinogen goals, cryo/FFP) given early hemorrhagic-death risk — currently only "coagulation panel" as a check.
2. ATO QTc/electrolyte control could be promoted from a monitoring line to a `doseModificationRules` hold trigger (hold ATO for QTc prolongation / hypokalemia-hypomagnesemia) on the next pass.
3. `histology` field carries "low-risk" (a risk stratum, not a histology) — move to `eligibilityCriteria` next pass (per verify.md nit).
4. `diseaseId` is generic `acute_myeloid_leukemia`, not APL-specific — pre-existing KB taxonomy gap, out of scope for this remap.

## Basis for verdict
No dose/unit/day value was changed or fabricated (verify.md byte-diff confirms). The three drug-class caps in the checklist (vincristine, anthracycline, carboplatin AUC) are genuinely N/A and their absence is explicitly and correctly reasoned in the file, not silently omitted. ATO's key safety monitoring (QTc, K/Mg) and APL's key toxicities (differentiation syndrome, DIC) are present. Every unsourced field is an honest VERIFY. As a non-selectable DRAFT this is safe to keep; promotion to ACTIVE is blocked until the VERIFY schedule fields are resolved and re-reviewed.
