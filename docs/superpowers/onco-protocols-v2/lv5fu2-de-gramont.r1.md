# R1 Clinical-Safety Review — lv5fu2-de-gramont (Standard Protocol v2, DRAFT)

Reviewer: stewardmd-clinical-reviewer (R1, blocking gate)
Target: docs/superpowers/onco-protocols-v2/lv5fu2-de-gramont.json
Status of artifact: DRAFT, protocolVersion 0.1-draft, clinicalApprovalStatus null, NOT promoted, NOT selectable.
Confidence: 92

goldens changed: no (intended: n/a) — this is a new DRAFT protocol JSON, not wired into any engine or golden/regression suite; nothing selectable, no engine output path exercised.

## Verdict: REVISE

Doses, units, days, cycle length, and safety scaffolding are all clinically correct and safe. One
overstated evidence-currency claim (evidenceStatus "current") must be corrected before this leaves
DRAFT. No Critical (dose/safety) defects.

## Dose / unit / schedule verification — PASS

Regimen matches the published classic de Gramont LV5FU2 (bimonthly) regimen:
- Leucovorin 200 mg/m2 IV over 2 hr, days 1 and 2 — correct.
- 5-FU 400 mg/m2 IV bolus, days 1 and 2 — correct.
- 5-FU 600 mg/m2 IV continuous infusion over 22 hr, days 1 and 2 — correct.
- Cycle every 14 days — correct.
Source cited: DeVita 12th ed. Doses/units/days/cycle are internally consistent with that citation
and with the widely published de Gramont schedule. mg/m2 BSA basis correct; rounding increment 50
mg reasonable. Sequencing note (LV then 5-FU bolus then 22 hr infusion) is clinically correct.

## Cumulative / hard-cap checks — N/A (correctly absent)

- Vincristine 2 mg cap: N/A — no vincristine in this regimen. Correctly not present.
- Anthracycline cumulative dose cap: N/A — no anthracycline in this regimen. Correctly not present.
- Carboplatin AUC-based dosing: N/A — no carboplatin in this regimen. All drugs are BSA-based, which
  is correct for LV and 5-FU.
No missing cap creates a false negative here because none of those agents appear.

## Supportive care / monitoring — PASS (appropriate)

- Antiemetics: correctly classified LOW emetic risk for 5-FU/LV; single-agent 5-HT3 or
  dexamethasone prophylaxis noted as typical, deferred to institutional protocol. Appropriate.
- G-CSF: correctly NOT assigned as routine prophylaxis for a low-FN-risk regimen; left to
  patient-specific physician judgment. Appropriate.
- Monitoring: CBC before each cycle + periodic renal function (5-FU renal adjustment). Appropriate.
  Clearance checks (CBC/platelets, renal, liver, prior-cycle status) reasonable.
- Dose-modification rule (ANC<1000 / plt<100k day 1 -> delay, physician review) is conservative and
  safe (fails toward hold, not toward administering into cytopenia).

## Honest-VERIFY of unsourced fields — PASS (with one exception, Finding B)

- histology "VERIFY", stage ["VERIFY"], treatmentSetting "VERIFY", lineOfTherapy "VERIFY" — all
  honestly flagged, none invented. Correct.
- biomarkers {} and eligibilityCriteria [] — no clinical value fabricated; both listed in
  verifyFields. Encoding inconsistency only (Finding A), not fabrication.
- treatmentIntent ["palliative","curative"] — both plausible for LV5FU2 (metastatic + adjuvant), and
  the actual setting is gated behind treatmentSetting:VERIFY, so no unsourced setting is asserted.
  Acceptable.

## Endorsement / tenant-neutrality — PASS

- No endorsement claim. Source is a neutral textbook citation (DeVita 12th ed.); no "NCCN-approved"
  or equivalent assertion.
- evidence.institutional [], no hospital name, clinicalApprovalStatus null. No fabricated approval.
- No em dash in app-facing text.

## Findings

### Critical (blocking)
None. No dose error, no missed cap (none applicable), no false negative, no unintended golden shift,
no dismissable critical alert, no deprecated guideline shipped as authoritative (see Important).

### Important (fix before promotion out of DRAFT)
1. evidence.core[0].evidenceStatus = "current" is an unsourced currency upgrade. The upstream draft
   flags the NCCN guideline/appendix cross-check as "pending", so nothing yet establishes that the
   DeVita 12th-ed citation is the current standard-of-care reference. Set to "unknown" until the
   currency/guideline cross-check is actually performed. (Overstated-reference-currency = the
   honest-VERIFY principle applied to the evidence layer.)

### Advisory
2. Finding A (consistency): biomarkers {} and eligibilityCriteria [] are listed in verifyFields but
   do not carry a literal "VERIFY" sentinel like stage does. Document the convention ("listed in
   verifyFields + empty container = unresolved") or apply one consistent encoding, so downstream
   consumers of verifyFields also check empty containers.
3. The draft's NCCN appendix references (C/D/F/G) and "guideline pending" signal survive only as
   free text in supportiveCare; evidence.guideline is []. When the guideline layer is populated,
   carry that pending-check signal into structured evidence so [] does not read as "no guideline
   evidence exists."

## Gate decision
REVISE. Blocking only on the evidenceStatus overstatement (Important #1); doses and all
patient-safety-relevant content are correct and safe. No PHI touched (no security-reviewer chain).
Not AI-generated clinical reasoning requiring R2/AI-reviewer chain. Safe to promote out of DRAFT
once evidenceStatus is corrected to "unknown".
