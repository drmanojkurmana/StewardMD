# R1 Clinical-Safety Review — folfiri-simplified.json

**Verdict: APPROVE (as DRAFT).** Confidence: 92.
**Goldens changed: no (intended: n/a — draft is not promoted, not selectable, referenced nowhere in kb/, www/, functions/, or any regression suite).**

Scope: `docs/superpowers/onco-protocols-v2/folfiri-simplified.json`, a re-mapped ONCQIS Standard Protocol DRAFT (`status: DRAFT`, `clinicalApprovalStatus: null`). Not runtime-reachable.

## Dose / unit / day / cycle correctness — PASS
Matches FOLFIRI-simplified (Andre et al. 1999; DeVita 12th ed. Table 40.12):
- Irinotecan 180 mg/m2 IV over 90 min, day 1 — correct.
- Leucovorin 400 mg/m2 day 1 — correct.
- 5-FU bolus 400 mg/m2 day 1 — correct.
- 5-FU infusion 1200 mg/m2/day x 2 = 2400 mg/m2 over 46-48 hr — correct; total math and days [1,2] semantics are documented in the notes and consistent whether the engine multiplies per-day rate by days or treats each day discretely (both yield 2400 total).
- Cycle length 14 days, cycles null (continue-to-progression, palliative) — correct.
No dose was rounded, altered, or reinterpreted vs. the source (verify.md field diff confirms zero mismatches).

## Mandatory chemo safety caps — N/A, correctly absent
- **Vincristine 2 mg cap:** N/A — no vincristine in this regimen. Correctly absent.
- **Anthracycline cumulative cap:** N/A — no anthracycline in this regimen. Correctly absent.
- **Carboplatin AUC dosing:** N/A — no carboplatin. The only BSA agents (irinotecan, 5-FU, leucovorin) are correctly `basis: bsa`, not AUC.
No capped/AUC agent is present, so no missing-cap false negative exists.

## Supportive care / monitoring — PASS
- Antiemesis: irinotecan correctly classified moderate emetic risk; 5-FU/LV low/minimal — accurate per NCCN framework.
- G-CSF: correctly framed as risk-benefit discussion, not a default order (FOLFIRI is not a designated high-FN-risk regimen) — accurate.
- Monitoring: CBC pre-cycle, hepatic/renal function, UGT1A1-linked irinotecan toxicity, and irinotecan-associated diarrhea/dehydration all present and appropriate.
- Dose-modification rule defers protocol-specific delay/reduce thresholds to physician — safe (does not invent unsourced thresholds).

## Honesty of unsourced fields — PASS
`histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`, `eligibilityCriteria` are all VERIFY/empty and enumerated in `verifyFields`. Nothing fabricated. `treatmentIntent: ["palliative"]` is a legitimate carry-over, not an invention.

## Endorsement claim — PASS
No endorsement language. `provenanceNote` correctly states "textbook-grounded draft... NCCN template / clinical / institutional approval pending." `evidence.institutional` empty, no `hospitalId`. No em-dash in file.

## Critical
None.

## Important
None blocking. Schema-validation caveat (from verify.md) is a **schema defect, not a document defect**: the `$defs.verifiable` `oneOf` makes literal `"VERIFY"` unsatisfiable on scalar `$ref: verifiable` fields (`histology`, `treatmentSetting`, `lineOfTherapy`). Fix belongs in `kb/schema/standard-protocol.schema.json` (`oneOf` -> `anyOf`), not here. Flagging so promotion is not blocked by a false schema failure.

## Advisory
- `evidence.core[0].evidenceStatus: "current"` is an editorial assertion, not source-stated (schema default is `"unknown"`). Accurate (DeVita 12th ed. is the current edition) but consider `"unknown"` or a one-line justification for a stricter sign-off.
- `disease: "Colorectal cancer"` is a mechanical humanization of `diseaseId` (required field), not invented clinical content. Fine.

## Gate note
APPROVE is contingent on `status: DRAFT` remaining until NCCN-template mapping, R1 clinical sign-off, and institutional approval are complete. The six VERIFY fields (esp. `lineOfTherapy`, `treatmentSetting`, `eligibilityCriteria`) MUST be resolved before this protocol is ever promoted to selectable — do not promote with VERIFY placeholders live.
