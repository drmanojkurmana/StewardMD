# R1 Clinical-Safety Review — aml-7-plus-3-induction (DRAFT)

Reviewer: stewardmd-clinical-reviewer (R1, hard gate)
Status of artifact: DRAFT, `clinicalApprovalStatus: null`, not promoted, not selectable.
Goldens changed: **no** (intended: n/a — data-only draft, not wired into any engine path; no regression suite touches an unpromoted protocol).

## Verdict: REVISE

Doses/units/days are clinically correct and honestly sourced; every unsourced
indication/eligibility field is VERIFY; no endorsement claim. Two clinical items must be
corrected before this can be promoted or made selectable.

---

## Critical (blocking for promotion)

### C1. Idarubicin cumulative-lifetime cap carries the doxorubicin-equivalent value (latent false-negative dose-limit)
- File: `regimen.drugs[idarubicin].caps.cumulativeLifetime = { warn 450, hard 550, mg/m2 }`.
- Idarubicin's own cardiotoxic cumulative threshold is roughly ~150 mg/m2 (commonly cited
  90–150), NOT the doxorubicin 450/550. At 12 mg/m2 x 3 days = 36 mg/m2 per cycle, a `hard: 550`
  cap would permit ~15 cycles before firing — it would never warn within any realistic
  cardiotoxic range. If this cap is ever enforced as-is, it is a missed dose-limit (false
  negative).
- Example: patient receives idarubicin 12 mg/m2 x3 x4 cycles = 144 mg/m2 (already near the true
  idarubicin ceiling) — engine would show green against a 450/550 cap.
- Mitigation present: `notes` honestly flags "conventional doxorubicin-equivalent... not printed
  in this source for idarubicin specifically - verify institutional doxorubicin-equivalent
  conversion before enforcing." Because it is caveated, draft, and not enforced, this is REVISE,
  not REJECT — but the wrong number must not sit in a `hard` cap field at promotion.
- Required fix: set idarubicin `cumulativeLifetime` to an idarubicin-specific value (or
  `"VERIFY"`) rather than the doxorubicin-equivalent 450/550. Source it against a
  drug-specific cardiotoxicity reference before enforcing.
- Daunorubicin cap (warn 450 / hard 550 mg/m2) is clinically defensible (daunorubicin lifetime
  limit conventionally ~550 mg/m2) — leave as-is but keep the "verify conversion" note.

## Important

### I1. G-CSF "prophylaxis" framing misapplies solid-tumor FN logic to AML induction
- File: `regimen.supportiveCare[1]` — "AML induction is conventionally high febrile-neutropenia
  risk - prophylactic G-CSF per NCCN Hematopoietic Growth Factors guideline (appendix C
  high-risk tier)."
- Routine prophylactic G-CSF during AML *induction* is not standard solid-tumor-style
  FN-risk prophylaxis; the deep, expected marrow aplasia is the therapeutic goal and growth
  factors are used selectively/post-nadir per hematology practice, not as a solid-tumor
  high-FN-risk auto-prophylaxis. Asserting "prophylactic G-CSF" here imports the wrong paradigm.
- Required fix: reword to VERIFY / "per hematology protocol" and drop the solid-tumor
  high-FN-risk tier framing, or gate it behind the pending per-disease NCCN template as
  explicitly VERIFY.

### I2. `evidence.core[0].evidenceStatus: "current"` is unsourced
- Draft source object states no currency status; schema default is `"unknown"`. Set to
  `"unknown"` (or justify by the 2025 edition explicitly) — a currency claim should not be
  asserted without an evidence-currency review.

### I3. Dropped NCCN appendices F/G (from adversarial verify)
- Draft `source.nccnAppendices ["C","D","F","G"]`: C/D resurface in supportiveCare; F/G appear
  nowhere. If F/G encoded vesicant/extravasation handling for the anthracyclines or other
  safety content, it was silently lost rather than VERIFY-flagged. Confirm with the appendix
  owner before sign-off.

## Advisory

- A1. `biomarkers: {"VERIFY":"VERIFY"}` — prefer `{}` for "none sourced"; the placeholder key is
  an unusual idiom.
- A2. Consider a tumor-lysis-syndrome monitoring line for high-blast-count AML (draft-optional).
- A3. Schema-file bug noted in verify.md (`$defs.verifiable` `oneOf` should be `anyOf`) is a
  schema-owner issue, not this document's fault.

---

## Confirmations requested (all checked)

- Doses/units/days correct + safe: **YES** — cytarabine 100 mg/m2/day CIV d1–7; daunorubicin 60
  mg/m2 IV d1–3; idarubicin 12 mg/m2 IV d1–3; daunorubicin/idarubicin correctly documented as
  either/or (not additive). cycleLengthDays/cycles are honestly VERIFY.
- Vincristine 2 mg cap: **N/A** — no vincristine in 7+3 (correctly absent).
- Anthracycline cumulative caps present: **YES**, but see C1 (idarubicin value wrong).
- Carboplatin AUC-based: **N/A** — no carboplatin in 7+3 (correctly absent).
- Supportive-care/monitoring appropriate: **PARTIAL** — antiemetic tier reasonable; monitoring
  (CBC, cardiac) appropriate; G-CSF framing needs fix (I1).
- Every unsourced indication/eligibility field honestly VERIFY: **YES** — histology, stage,
  biomarkers, lineOfTherapy, eligibilityCriteria, cycleLengthDays, cycles all VERIFY; verifyFields
  covers all 8 literal VERIFYs.
- No endorsement claim: **YES** — provenanceNote/notes stay descriptive ("pending", "verify",
  "confirm"); no "NCCN-approved".

## Gate decision
REVISE — fix C1 (idarubicin cumulative cap) and I1 (G-CSF framing) before promotion or
selectability; I2/I3 to resolve at sign-off. No PHI touched; not AI-assisted content generation
beyond textbook transcription, so no downstream reviewer chaining required.
