# M2 Phase 1 — Gold-Standard Validation Library (report)

101 clinician-grade cases (AI-drafted, `clinicianApproved:false` — pending sign-off), added
to `kb/validation/cases/`, executable by `test/run-case-validation.mjs`. Engine unchanged
(golden green); this is validation DATA + QA tooling only.

## Coverage (16 specialties)
Critical Care 12 · Cardiology 12 · Respiratory 11 · Endocrinology 10 · Neurology 9 ·
Nephrology 8 · Gastroenterology 7 · Rheumatology 5 · Hematology 5 · Toxicology 5 ·
Tropical Medicine 4 · Genitourinary 3 · Hepatology 3 · Dermatology 3 · Infectious 2 · Oncology 2.
Priority conditions covered (sepsis, CAP, HAP/VAP, UTI, AKI, CKD, DKA, HHS, ACS, HF, stroke,
PE, COPD, asthma, cirrhosis, GI bleed, pancreatitis, meningitis, endocarditis, electrolytes,
shock, ICU emergencies) plus specialty breadth.

## Diagnostic accuracy (replayed through the real deterministic engine)
- **All 101:** top-1 44% · top-3 63%
- **Diagnosable subset (84 — target ∈ the 140-disease engine): top-1 52% · top-3 76% · avg confidence 88**
- **Antibiotic correctness: 65%**  (of cases with an antibiotic expectation)
- **17 coverage gaps** — target diagnosis not yet in the diagnosable set (HHS, lower GI bleed,
  electrolyte combos, ARDS, septic arthritis, GPA, sickle crisis, TLS, COVID, DRESS, opioid/TCA
  overdose, appendicitis, limb ischaemia, heat stroke, DTs, B12 deficiency). These auto-miss and
  are a documented work-list for a future diagnostic-coverage expansion.

## Integrity
101/101 valid JSON · 1 invalid finding-key + 5 invalid ids dropped by the gate · 0 cases with
no valid findings · finding-keys validated against the engine vocabulary · expected ids validated
against the diagnosable set · no scoring/treatment fields · society-level citations only.

## Interpretation
The 8 production archetypes still score 88% top-1 / 100% antibiotic (unchanged). This new
library is deliberately harder and multi-specialty; **52% top-1 / 76% top-3 on the diagnosable
subset is the baseline M3 (ranking) will improve against**, and the 17 gaps scope future
diagnostic expansion. All cases require clinician review before being treated as authoritative.

## Notes / limitations
- Cases are `ai_drafted`; clinician sign-off pending (per requirement).
- `run-case-validation` hardened: `buildPackage` is timeout-raced so a stall can't lose a
  case's diagnosis metrics (fixed the earlier false-"regression" flakiness).
- `baseline.json` re-baselined over the full set for regression protection.
