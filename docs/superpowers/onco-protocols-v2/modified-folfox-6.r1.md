# R1 Clinical-Safety Review — modified-folfox-6.json (v2 remap)

**Scope:** DRAFT ONCQIS Standard Protocol, not promoted, not selectable (status=DRAFT;
no reference in `www/` or `functions/`; schema gate blocks ACTIVE while VERIFY unresolved).
**Verdict: APPROVE** (for continued DRAFT status). No Critical (blocking) findings.
Important items below MUST be resolved before promotion to ACTIVE.

**goldens changed: no (intended: n/a)** — no clinical engine/data path touched. Ran
`onco-dose`, `onco-dose-hardening`, `onco-protocol-schema` suites: 29/29 pass, outputs unchanged.

## Dose / units / days / cycles — CORRECT & SAFE
Matches standard mFOLFOX-6 (NCCN colon regimens / DeVita Table 40.13):
- Oxaliplatin 85 mg/m2 IV over 2 hr, day 1 — correct.
- Leucovorin 400 mg/m2 IV day 1 (Y-connector w/ oxaliplatin) — correct.
- 5-FU bolus 400 mg/m2 IV day 1 — correct.
- 5-FU continuous infusion 1200 mg/m2/day x 2 days (2400 mg/m2 over 46-48 hr) — correct.
- Cycle length 14 days; cycles=null (open-ended, physician-determined) — correct.
BSA basis, rounding increment 50 mg, caps.perDose=null are all appropriate for these agents
(none carry an absolute per-dose cap).

## Mandatory-cap checks — CORRECTLY N/A
- **Vincristine 2 mg cap:** N/A — no vincristine in this regimen. Correctly absent (not a
  missing cap). Global vincristine cap logic is independently verified live by the golden suite
  ("vincristine 2 mg per-dose cap fires in the lineage" — pass).
- **Anthracycline cumulative cap:** N/A — no anthracycline. Correctly absent. (cumulativeLifetime
  cap machinery verified live: doxorubicin warning test — pass.)
- **Carboplatin AUC:** N/A — no carboplatin. Oxaliplatin is correctly dosed by BSA (mg/m2), not
  AUC; oxaliplatin is not an AUC/Calvert agent. Correct.

## Supportive care / monitoring — APPROPRIATE
- Antiemetics: oxaliplatin = moderate emetogenic → moderate-tier prophylaxis — correct.
- G-CSF: FOLFOX = low febrile-neutropenia risk, not routinely recommended — correct.
- Monitoring: CBC, renal (oxaliplatin renally cleared), oxaliplatin neuropathy assessment — correct.
- clearanceChecks include liver + neuropathy grade — appropriate.
- doseModificationRules minimal (ANC<1000/plt<100k → delay, physician review) — acceptable for a
  DRAFT that defers reductions to the physician; fail-safe (delay), not fail-open.

## VERIFY honesty / no invention — HONEST
- histology, treatmentSetting, lineOfTherapy = literal "VERIFY" (unsourced → not invented). Good.
- stage=[], biomarkers={}, eligibilityCriteria=[] left empty, not fabricated. Good.
- No endorsement claim: NCCN cited as a sourcing reference only; no "NCCN-approved" / hospital
  endorsement; institutional=[]. Confirmed (matches endorsement-string golden guard). Good.

## Important (resolve before promotion to ACTIVE)
1. **treatmentIntent includes "curative"** while the cited source table (DeVita 40.13) lists
   mFOLFOX-6 only in the metastatic (palliative) setting. Adjuvant/curative use is real-world
   standard but is an extrapolation beyond the cited locator. It IS honestly disclosed in
   provenanceNote. Before ACTIVE: confirm curative intent against the per-disease NCCN template,
   or drop it. Not blocking at DRAFT (VERIFY gate prevents selection).
2. **evidence.core[0].evidenceStatus = "current"** is unsourced; schema default is "unknown".
   Set to "unknown" until edition currency is R1-confirmed (per verify.md §2).
3. **DPD deficiency:** consider adding a 5-FU DPYD/DPD-deficiency screening note to supportiveCare
   before ACTIVE (fluoropyrimidine safety). Advisory-to-Important.

## Advisory
- disease casing "Colorectal cancer" vs KB canonical "Colorectal Cancer" — normalize.
- Schema `$defs/verifiable` oneOf / verifyFields inconsistencies are per the verify.md; those are
  schema-layer, not clinical-safety, and do not affect this verdict.

## Chaining
No PHI touched → security reviewer not required. Not AI-generated dosing content → AI reviewer
not required.
