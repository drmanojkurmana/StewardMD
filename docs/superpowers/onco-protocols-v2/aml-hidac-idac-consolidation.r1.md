# R1 Clinical-Safety Review — aml-hidac-idac-consolidation (DRAFT)

Reviewer: stewardmd-clinical-reviewer (R1, blocking gate)
File: docs/superpowers/onco-protocols-v2/aml-hidac-idac-consolidation.json
Status reviewed: DRAFT, not promoted, not selectable (clinicalApprovalStatus: null)
Goldens changed: no (intended: n/a) — draft doc, not wired into the dose engine; test/onco-protocol-schema.test.mjs passes 3/3, no engine output shifts.

## VERDICT: APPROVE (as DRAFT only)

Safe to keep as an unselectable draft. Promotion to ACTIVE is gated by the checklist
items below (and by the schema's own "ACTIVE + unresolved VERIFY fails" rule, which
this file correctly cannot pass while VERIFY placeholders remain).

## Dose / unit / day / cycle correctness — PASS
- HiDAC: cytarabine 3000 mg/m2 (3 g/m2) IV over 1-3 h q12h on days 1,3,5 = 6 doses/cycle.
  Matches the classic CALGB HiDAC consolidation printed in Harrison 22nd ed. Unit,
  schedule, and q12h dosing correct and safe.
- IDAC: cytarabine 1500 mg/m2 (1.5 g/m2) IV q12h days 1-3 = 6 doses/cycle. Upper bound of
  the source's printed 1-1.5 g/m2 range; the notes honestly flag this and require order
  confirmation. ELN-consistent.
- Cycles 2-4: correct for AML postremission consolidation.
- HiDAC and IDAC are correctly documented as mutually-exclusive physician choices, not
  co-administered. Rounding increment 50 mg reasonable.

## Standard onco-safety caps — N/A (correctly absent)
- Vincristine 2 mg cap: N/A — no vincristine in regimen.
- Anthracycline cumulative cap: N/A — no anthracycline in regimen.
- Carboplatin AUC dosing: N/A — no carboplatin/platinum in regimen.
This is single-agent cytarabine; none of the three caps apply, and none are falsely implied.

## Supportive care / monitoring — PASS
- Ocular prophylaxis (corticosteroid eye drops) present — required for HiDAC
  keratoconjunctivitis.
- Neuro exam before EACH HiDAC dose present; cerebellar toxicity (ataxia/dysarthria/
  nystagmus) triggers a HARD hold of remaining doses (not dismissable) — correct, this is
  the key HiDAC safety gate and it is preserved.
- Renal function monitoring present (impaired ClCr raises cerebellar toxicity) — correct.
- Antiemetic tier sourced to Harrison line ref; G-CSF item honestly marked "verify before
  finalizing." Appropriate.

## Honesty of unsourced fields — PASS
- histology, stage, biomarkers.molecularProfile, lineOfTherapy, eligibilityCriteria all
  left as "VERIFY" and listed in verifyFields. No invented indication/eligibility values.
- provenanceNote correctly states textbook-only grounding, NCCN/institutional overlay
  pending. No endorsement / "approved by" / hospital string anywhere.

## Critical
- None.

## Important (resolve before ACTIVE promotion — not blocking for DRAFT)
1. HiDAC (3 g/m2) entry carries no explicit age/renal neurotoxicity caveat. HiDAC 3 g/m2
   q12h is conventionally restricted to patients ~<=60 y and adequate renal function due to
   severe/irreversible cerebellar toxicity in older/renally-impaired patients. Eligibility
   is honestly VERIFY, so this is not a false negative, but the age/renal gate must be
   populated (not left blank) before this becomes selectable. Add it to the HiDAC notes or
   eligibilityCriteria at promotion.

## Advisory
1. cycleLengthDays is null — honest (source did not print a fixed interval); acceptable to
   leave, but resolve to a value (recovery-based, ~28-35 d) before promotion.
2. treatmentSetting: "consolidation" is a concrete value for a field absent from the draft
   and not in verifyFields. Traceable to the protocol title, so not a fabricated clinical
   fact; add a one-line provenance note or mark VERIFY for strict auditability.
3. Schema authoring bug (non-clinical, schema owner): standard-protocol.schema.json
   "verifiable" $def uses oneOf where anyOf is needed, so a literal "VERIFY" matches both
   branches and fails strict jsonschema.validate() on single-value verifiable fields. Does
   not affect clinical content of this file; fix in the schema, not here.

Chaining: not required — no AI-assisted generation of dose values in scope, no PHI touched.
