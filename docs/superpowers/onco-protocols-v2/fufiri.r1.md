# R1 Clinical-Safety Review — fufiri.json (v2, DRAFT)

Reviewer: stewardmd-clinical-reviewer (R1, blocking gate)
Scope: /docs/superpowers/onco-protocols-v2/fufiri.json — re-mapped ONCQIS Standard Protocol.
Status of file: DRAFT, clinicalApprovalStatus null, not promoted, not selectable.
Regimen: FUFIRI (Douillard weekly) = irinotecan + leucovorin + infusional 5-FU, colorectal cancer, palliative.
Source of truth: DeVita 12th ed. lines 123599/123603 (Douillard et al., Lancet 2000).

## Goldens changed: no (intended: n/a — no engine/golden files touched; data-only draft)

## VERDICT: REVISE

Doses/units/days/cycles are numerically correct and byte-faithful to the sourced draft, and the
non-endorsement / no-fabrication posture is clean. One safety-critical administration gap must be
closed before this protocol can be promoted past DRAFT.

---

## CRITICAL (blocks promotion)

### C1 — 5-FU 2300 mg/m2 has no infusionDuration; route is bare "IV"
- Drug: fluorouracil, dosePerUnit 2300 mg/m2, route "IV", infusionDuration NOT SET (field left absent).
- The Douillard/AIO weekly regimen administers 5-FU 2300 mg/m2 as a 22-24 hour continuous IV
  infusion. At 2300 mg/m2 this dose is ONLY safe as a prolonged infusion. Bolus 5-FU tops out at
  ~400-600 mg/m2; 2300 mg/m2 given as (or misread as) an IV bolus/push is a lethal overdose.
- The schema explicitly provides `infusionDuration` (standard-protocol.schema.json line 40,
  type ["string","null"]). Leaving it unset on a 2300 mg/m2 fluoropyrimidine is a false-negative
  safety omission: the one datum that makes the dose safe is missing while the dangerous number is
  present.
- Source it should match: DeVita 12th ed. line 123603 / Douillard 2000 — 5-FU 2300 mg/m2 as
  22-24h continuous infusion, weekly x6, q7wk.
- Required fix: set fluorouracil.infusionDuration to the sourced 22-24h continuous infusion (verify
  exact wording against the DeVita line). Do not promote until present.

## IMPORTANT

### I1 — Irinotecan and leucovorin also lack infusionDuration
- Irinotecan 80 mg/m2 is given over ~30-90 min; leucovorin 500 mg/m2 over ~2h; sequence is
  irinotecan -> LV -> 5-FU (already captured correctly in the notes). Less acutely dangerous than
  C1 but should be populated for administration completeness and to match the sequencing the notes
  already describe. Mark durations VERIFY if the DeVita line does not state them.

### I2 — verifyFields over-claims (biomarkers / eligibilityCriteria)
- verifyFields lists "biomarkers" and "eligibilityCriteria" as VERIFY, but the fields are plain
  empty ({} / []) with no VERIFY sentinel at that path. Either write the placeholder
  ({"VERIFY":"VERIFY"} / [{"VERIFY":"VERIFY"}], matching the aio-weekly-24h.json v2 convention) or
  drop the two entries from verifyFields. Honest-VERIFY intent is fine; the representation is
  inconsistent. (Concurs with fufiri.verify.md finding #1.)

## ADVISORY

- A1 — disease casing "Colorectal cancer" vs canonical "Colorectal Cancer" in
  kb/reference/colorectal_cancer.json. Align.
- A2 — Schema defect (not this file's fault): $defs/verifiable uses oneOf where the "VERIFY"
  literal also satisfies the string branch, so strict Draft-2020-12 validation rejects valid VERIFY
  sentinels. Should be anyOf. Already logged in aio-weekly-24h.verify.md; fix in the schema, not here.

---

## Confirmations requested by the task

- Doses/units/days/cycles correct + safe: numerically YES (irinotecan 80, LV 500, 5-FU 2300 mg/m2,
  days 1/8/15/22/29/36 = weekly x6, cycleLengthDays 49 = 7-wk cycle, cycles null = open-ended
  palliative — all match Douillard/DeVita). SAFETY caveat: not safe to administer until C1
  (5-FU infusion duration) is fixed.
- Vincristine 2 mg cap: N/A — no vincristine in this regimen. Correctly absent.
- Anthracycline cumulative cap: N/A — no anthracycline in this regimen. Correctly absent.
- Carboplatin AUC-based dosing: N/A — no carboplatin (all three drugs are BSA-based, correct).
- Supportive care / monitoring appropriate: YES — antiemetics moderate-emetic tier (irinotecan-driven),
  G-CSF handled as risk-benefit judgment (honest, not overclaimed), CBC/renal/hepatic + irinotecan
  diarrhea assessment before each weekly dose. Reasonable and honestly sourced.
- Every unsourced indication/eligibility field honestly VERIFY (not invented): YES for histology,
  stage, treatmentSetting, lineOfTherapy. treatmentIntent ["palliative"] correctly preserved from
  sourced draft. See I2 for the biomarkers/eligibilityCriteria representation gap (no fabrication).
- No endorsement claim: CONFIRMED — no "NCCN-approved" or hospital-endorsement language; institutional
  evidence empty; no em/en dash.

Promote to selectable only after C1 is resolved and re-reviewed.
