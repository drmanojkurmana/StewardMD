# R1 Clinical-Safety Review — folfiri.json (v2 re-mapped Standard Protocol)

Status of artifact: DRAFT, not promoted, not clinician-selectable (`status: "DRAFT"`, `clinicalApprovalStatus: null`). This gate reviews clinical correctness/safety of the draft content, not fitness to go live.

goldens changed: no (intended: n/a) — this is a new draft data file, no clinical engine/golden fixture touched.

## Verdict: APPROVE (with 1 Important + 2 Advisory to clear before promotion)

Clinical content is correct and safe. No Critical (no false negative, no wrong dose/score, no missing mandatory cap, no deprecated guideline, no unintended golden shift).

## Dose / unit / day / cycle verification — PASS

Regimen matches the canonical Douillard FOLFIRI (LV5FU2 backbone), q14d:
| drug | dose | unit | days | route | verdict |
|---|---|---|---|---|---|
| Irinotecan | 180 | mg/m2 | 1 | IV over 2 hr | correct (Douillard 2000) |
| Leucovorin | 200 | mg/m2 | 1,2 | IV | correct (authentic Douillard l-LV value; 400 = racemic variant, 200 is legitimate) |
| 5-FU bolus | 400 | mg/m2 | 1,2 | IV bolus | correct |
| 5-FU infusion | 600 | mg/m2 | 1,2 | IV over 22 hr | correct (2 x 600 over 2 days = the classic de Gramont infusion) |

Cycle length 14 days: correct. `cycles: null` (continue-to-progression) appropriate for palliative CRC. Sequence (irinotecan+LV concurrent via Y-connector -> 5-FU bolus -> 22-hr infusion) is correct and safe.

## Mandatory-cap checks — N/A, correctly absent

- Vincristine 2 mg cap: N/A — no vincristine in FOLFIRI. Correct that it is not present.
- Anthracycline cumulative cap: N/A — no anthracycline in this regimen.
- Carboplatin AUC dosing: N/A — no carboplatin. All 4 agents are correctly `basis: "bsa"` (mg/m2), which is the right basis for each.

No capped/AUC agent is missing from a regimen that requires it, so no false-negative risk here.

## Supportive care / monitoring — PASS (appropriate, honestly hedged)

- Emetic risk: irinotecan = moderate tier, antiemetic premed present. Honest note that the per-regimen NCCN table was not in the source excerpt -> VERIFY. Acceptable.
- G-CSF: honestly flagged as risk-level-not-printed / VERIFY rather than asserting a category. Good.
- Monitoring: CBC pre-cycle, renal + hepatic function, and pre-cycle diarrhea assessment (irinotecan) — all appropriate. Dose-hold rule for ANC<1000/plt<100k present.

Advisory only: irinotecan-specific diarrhea management (atropine for acute cholinergic syndrome, loperamide for delayed diarrhea) is not spelled out. Not required for a DRAFT and the protocol does not fabricate it; add before promotion.

## Honesty of unsourced fields — PASS

`histology`, `stage`, `treatmentSetting`, `lineOfTherapy`, `eligibilityCriteria`, `biomarkers` all left VERIFY/empty and listed in `verifyFields`. No indication or eligibility fact invented. `treatmentIntent: ["palliative"]` carried from draft, not fabricated.

## Endorsement / multi-tenant — PASS

No "NCCN-approved"/endorsement language. No hospital hard-coding. `evidence.institutional: []`, `clinicalApprovalStatus: null`. No em/en dash.

## Important (clear before promotion, non-blocking for a DRAFT)

1. `evidence.core[0].evidenceStatus: "current"` is asserted without editor confirmation; schema default is `"unknown"`. DeVita 12th ed. (2023) is in fact the latest edition, so this is not a deprecated-guideline (not Critical) — but an unverified currency assertion should read `"unknown"` until an editor signs off. Set to `"unknown"`.

## Advisory

1. `disease: "Colorectal cancer"` is a mechanical humanization of `diseaseId`, not sourced verbatim — cosmetic, not a clinical claim.
2. Schema defect (not this file): `$defs/verifiable` `oneOf` is unsatisfiable for a bare `"VERIFY"` string (matches both branches). Route to schema owner; `oneOf` -> `anyOf`. Does not affect clinical correctness.

## Chaining

No PHI touched -> security reviewer not required. Not AI-generated inference output requiring the AI reviewer for this data file.
