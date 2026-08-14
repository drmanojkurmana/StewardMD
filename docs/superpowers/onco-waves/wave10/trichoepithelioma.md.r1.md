# R1 Clinical-Safety Review — trichoepithelioma (management narrative)

VERDICT: APPROVE

Confidence: 92

## Context
- Adversarial `.verdict.md` sidecar: NOT PRESENT at the expected path. No outstanding
  adversarial ISSUES to reconcile. Reviewed the draft on its own merits.

## 1. Safety
No unsafe, misleading, or harmful statement. Core clinical claims are correct and
conservative:
- Trichoepithelioma is benign; management driven by diagnostic certainty, cosmetic
  burden, and surveillance — correct.
- Solitary lesion: complete surgical excision is diagnostic + curative — correct.
- Multiple familial (Brooke-Spiegler / CYLD): ablative/destructive modalities (CO2 laser,
  electrosurgery, dermabrasion) for cosmesis, recurrence expected — correct and honestly
  framed as palliative-for-cosmesis, not curative.
- No role for radiotherapy or systemic therapy — correct for a benign tumour.
- Strong, safe emphasis on the BCC mimic: low threshold for rebiopsy on
  enlargement/ulceration/infiltration — this is the key safety point and is handled well
  (avoids false reassurance).
No absolute/directive overreach that could cause harm if followed.

## 2. Grounding
The draft's central integrity move is correct: it states up front that DeVita 12th ed.
carries NO dedicated management section for this disease (only a passing mention of
desmoplastic trichoepithelioma as a histologic differential near the microcystic adnexal
carcinoma discussion), and therefore attributes NOTHING substantive to DeVita. Every
treatment claim is explicitly relabelled "general oncology/dermatology standard, not from
DeVita's section on this disease." No fabricated or outdated regimen. No mis-attribution —
which is the exact failure mode this gate guards against. Claims are consistent with
standard derm/oncology care.

## 3. Dose-free
CONFIRMED. No mg, mg/m2, AUC, numbered schedules, or any numeric dose. Modalities named
without settings/parameters.

## 4. Scope
Appropriately hedged as decision-support. Uses "guided by," "often needed," "should
prompt," "consider." Refer-out guidance (dermatology/dermatopathology, CYLD genetic
counselling, plastic surgery, psychological support) is appropriate and non-directive.

## 5. Adversarial flags
None on file (no `.verdict.md`). Nothing to carry forward.

## Notes (advisory, non-blocking)
- The parenthetical "general oncology standard, not from DeVita's section on this disease"
  is repeated on nearly every bullet. It is accurate and safe, but heavy. Consider a single
  header disclaimer (already present in the FLAG block) and trimming the inline repeats for
  readability. Not required for approval.
- The leading "FLAG: needs manual sourcing" line is a build/provenance note; ensure the
  ingestion step routes the actual management prose (Overview onward) to the management
  field and does not surface the FLAG/Sources scaffolding to clinicians.

goldens changed: no (intended: n/a — reference narrative, no engine/golden output)
