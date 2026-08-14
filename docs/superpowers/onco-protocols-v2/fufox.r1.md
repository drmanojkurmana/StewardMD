# R1 Clinical-Safety Review — fufox.json (FUFOX, Grothey weekly)

**Status of artifact:** DRAFT, `clinicalApprovalStatus: null`, not promoted, not selectable.
**Verdict: APPROVE (draft clinical content is safe + source-faithful). Promotion remains gated.**
**Confidence: 90.**
**Goldens changed: no (intended: n/a — DRAFT, non-selectable, no engine output path exercises this file).**

## Scope confirmed
Colorectal, palliative intent. 3 drugs: oxaliplatin 50 mg/m2, leucovorin 500 mg/m2, 5-FU 2000 mg/m2/24h;
days [1,8,15,22,29]; cycle 42 d; cycles null. Cross-checked every dose/unit/day/route/basis against the
DeVita 12th ed. citation carried in each drug's `notes` (lines 123742-123743). Faithful, verbatim.

## Required safety checks
- **Doses/units/days/cycle correct + safe:** PASS. Values match the cited source exactly. Oxaliplatin
  cumulative exposure ~250 mg/m2 per 6-wk cycle — neuropathy monitoring present (see below).
- **5-FU route is safety-critical:** PASS. 2000 mg/m2 is delivered as `IV over 24 hr` (continuous
  infusion). This dose as a bolus would be lethal; the infusional route is correctly and explicitly
  encoded. Load-bearing — must not regress to bolus.
- **Vincristine 2 mg cap:** N/A — no vincristine in this regimen. (Requirement fires only if present.)
- **Anthracycline cumulative caps:** N/A — no anthracycline in this regimen.
- **Carboplatin AUC-based:** N/A — no carboplatin. Oxaliplatin is correctly `basis: "bsa"`, `mg/m2`
  (oxaliplatin is NOT AUC-dosed). PASS.
- **Supportive care / monitoring appropriate:** PASS. Moderate emetic-risk antiemetic tier is correct
  (oxaliplatin-driven; 5-FU/LV alone low). CBC before each dose, renal function, and cumulative
  peripheral-neuropathy assessment (the dose-limiting toxicity here) all present. G-CSF "not routinely
  indicated" is defensible for this weekly regimen.
- **Unsourced indication/eligibility honestly VERIFY:** PASS. `histology`, `stage`, `treatmentSetting`,
  `lineOfTherapy`, `eligibilityCriteria` all left as VERIFY sentinels; `verifyFields` enumerates exactly
  those. No invented clinical values. `treatmentIntent: ["palliative"]` is sourced from the draft.
- **No endorsement claim:** PASS. No hospital, no "NCCN-approved"/"endorsed by". `institutional: []`.
  NCCN Appendix references are descriptive citations, not endorsements. No em-dash.

## Findings

### Critical
None.

### Important
- **Schema validation fails (3x `oneOf` on histology/treatmentSetting/lineOfTherapy).** Per the verify
  report this is a pre-existing `$defs/verifiable` bug (`oneOf` should be `anyOf`) affecting nearly every
  VERIFY-using v2 file, not a defect of this mapping. Not a clinical-safety failure, but the file cannot
  be promoted while invalid. Hand off to schema owner; fix once at the schema, do not re-map this file.

### Advisory
- **`evidenceStatus: "current"` is a mild unsourced inference** — the draft did not assert currentness.
  DeVita 12th ed. is in fact the current edition (no deprecated guideline shipped), so the claim is
  defensible, but ideally it should be author-confirmed rather than derived. Not blocking.
- **No DPD-deficiency screening note for 5-FU** and no oxaliplatin cold-sensitivity / D5W-not-saline
  dilution note. These are standard 5-FU/oxaliplatin safety adjuncts; consider adding at promotion.
  Not required for a draft mapping.
- `doseModificationRules` is thin (single ANC/platelet delay deferring to physician). Defer-to-physician
  is fail-safe, acceptable for a non-selectable draft; expand before promotion.

## Gate
Clinical content of the DRAFT is safe and source-faithful — **APPROVE**. Promotion to selectable must
still clear: (1) schema `verifiable` fix so the file validates, (2) clinician sign-off resolving every
VERIFY field. DRAFT status already enforces this gate.
