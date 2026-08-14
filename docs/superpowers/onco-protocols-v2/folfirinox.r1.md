# R1 Clinical-Safety Review — folfirinox.json (v2, DRAFT)

Reviewer: stewardmd-clinical-reviewer (R1, hard gate)
Scope: `docs/superpowers/onco-protocols-v2/folfirinox.json`
Status of artifact: `DRAFT`, `clinicalApprovalStatus: null`, not promoted, not selectable.
Confidence: 90.

**Goldens changed: no (intended: n/a).** The v2 draft dir is not wired to any
runtime engine — `grep` shows it is referenced only by `kb/tools/validate-protocols.mjs`
(a tool), `test/onco-protocol-schema.test.mjs` (uses synthetic fixtures, not these
files), and an inventory doc. `node --test test/onco-protocol-schema.test.mjs` → 3/3 pass.
No dose/score-producing code path consumes this file, so no golden/regression output moves.

## VERDICT: APPROVE for DRAFT merge — PROMOTION TO SELECTABLE BLOCKED until the two Important items below are resolved.

No Critical (patient-safety / false-negative / wrong-dose) issue found. All 5 drug
doses are clinically correct and safe for FOLFIRINOX per PRODIGE 4/ACCORD 11.

## Gate checklist

- **Doses/units/days/cycles correct & safe — PASS.** Matches standard FOLFIRINOX
  (metastatic pancreatic cancer, PRODIGE 4/ACCORD 11):
  - oxaliplatin 85 mg/m2 IV d1 ✓
  - irinotecan 180 mg/m2 IV d1 ✓
  - leucovorin 400 mg/m2 IV d1 ✓
  - 5-FU 400 mg/m2 IV bolus d1 ✓
  - 5-FU 2400 mg/m2 CIVI over 46 h (d1→d2) ✓
  - cycle 14 d, q2w ✓. `cycles: null` (continue-to-progression) appropriate for palliative intent.
  - `treatmentIntent: ["palliative"]` correct for this specific trial mapping (metastatic).
- **Vincristine 2 mg cap — N/A (correct absence).** Regimen contains no vincristine.
- **Anthracycline cumulative caps — N/A (correct absence).** No anthracycline present.
- **Carboplatin AUC-based — N/A (correct absence).** No carboplatin; the platinum here
  is oxaliplatin, correctly `basis: "bsa"` (mg/m2), not AUC. Correct.
- **Supportive care / monitoring appropriate — PASS.** Antiemetic (moderate-high emetic
  risk, honestly hedged "verify per-disease NCCN tier"), G-CSF discussion citing the
  trial FN 5.4% / gr3-4 neutropenia 45% and explicitly deferring the risk-tier to
  confirmation. Monitoring covers CBC, renal (platinum), oxaliplatin neuropathy,
  irinotecan diarrhea/GI. Clearance checks + day-1 ANC/plt hold present.
- **Unsourced indication/eligibility honestly VERIFY — PASS.** `histology`,
  `stage`, `treatmentSetting`, `lineOfTherapy` = `"VERIFY"`; `biomarkers: {}`,
  `eligibilityCriteria: []` empty and enumerated in `verifyFields`. Nothing invented.
- **No endorsement claim — PASS.** No hospital / "approved by" / "NCCN-approved" string.
  `evidence.institutional: []`. No em/en-dash.

## Important (must fix before promotion to selectable)

1. **`evidence.core[0].evidenceStatus: "current"` is unsupported.** The draft does not
   assert edition currency and the schema default for the enum is `"unknown"`. Asserting
   `"current"` is a currency claim with no source — set to `"unknown"` until an editor
   confirms the 12th-ed citation is not superseded. Systemic across the v2 batch (same as
   folfiri.json); fix batch-wide.
2. **`roundingRule.increment: 50` is too coarse for chemo dosing.** Rounding to the
   nearest 50 mg can exceed the conventional ±5% tolerance for small-BSA patients.
   Example: BSA 1.4 → oxaliplatin 85×1.4 = 119 mg; nearest-50 = 100 mg = **−16%
   underdose** (or, at a break-point, an over-round). Confirm the engine's rounding
   semantics for `increment` and tighten to a clinically safe step (e.g. 5 mg or an
   institution-tolerance rule) before this protocol can be selected to produce a real
   dose. Carried over from the draft but should not ship selectable as-is.

## Advisory

- `doseModificationRules` is sparse (only day-1 ANC<1000/plt<100k → delay). Acceptable
  for DRAFT since it errs to physician review; expand with oxaliplatin-neuropathy and
  irinotecan-diarrhea/UGT1A1 reductions before promotion.
- `disease: "Pancreatic cancer"` is a mechanical humanization of `diseaseId` (not sourced
  verbatim). Low severity; consistent with folfiri.json.
- Schema `$defs/verifiable` `oneOf` rejects the literal `"VERIFY"` sentinel it exists to
  document (matches both branches). Schema-wide defect, not a defect of this file — route
  to schema owner (change `oneOf`→`anyOf`).

## Chaining
- Not AI-assisted content → stewardmd-ai-reviewer not required.
- No PHI touched → stewardmd-security-reviewer not required.
