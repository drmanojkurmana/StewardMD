# R1 Clinical-Safety Review (BLOCKING) — folfox-6.json

- Artifact: `docs/superpowers/onco-protocols-v2/folfox-6.json`
- Status of artifact: DRAFT, not promoted, not selectable (`status: "DRAFT"`, `clinicalApprovalStatus: null`)
- Reference: FOLFOX-6 (Tournigand et al., 2004), as cited via Cancer: Principles & Practice of Oncology, 12th ed.
- goldens changed: no (intended: n/a — draft doc, not wired to any engine/calculator/selectable protocol list; no regression suite covers it)

## Verdict: REVISE

Doses/units/days/cycle length all match published FOLFOX-6. One agent-identity defect blocks approval, plus the `stage` encoding issue already raised in the verify.md. Neither is promoted, but R1 is a hard gate and the leucovorin defect would ship an agent/dose mismatch if promoted as-is.

## Critical

1. Leucovorin agent-name vs dose mismatch (drug id `leucovorin`).
   - File: `name: "LEVOleucovorin"`, `dosePerUnit: 400`, `unit: "mg/m2"`. Notes quote source as "LV 400 mg/m2".
   - Problem: 400 mg/m2 is the RACEMIC leucovorin (folinic acid, d,l-leucovorin) dose. LEVOleucovorin (l-leucovorin, the active isomer) is dosed at HALF = 200 mg/m2 in FOLFOX. The source ("LV 400 mg/m2", Tournigand FOLFOX-6) is racemic leucovorin 400 mg/m2. The name was changed to LEVOleucovorin while the racemic dose was kept.
   - Concrete harm: taken at face value this orders levoleucovorin 400 mg/m2 = 2x the active-isomer dose. Excess folinate potentiates 5-FU cytotoxicity (worsened mucositis/diarrhea/myelosuppression).
   - Should match: FOLFOX-6 uses leucovorin (racemic) 400 mg/m2 day 1 (Tournigand 2004; NCCN Colon/Rectal regimens). Fix: rename to `"Leucovorin"` (folinic acid) at 400 mg/m2 — OR, if levoleucovorin is genuinely intended, change dose to 200 mg/m2. Source supports the racemic-400 reading, so rename to Leucovorin.

## Important

2. `stage: []` should be `["VERIFY"]` (concurs with folfox-6.verify.md §2).
   - `[]` asserts a resolved claim ("not stage-scoped / applies to all stages"), which the draft never supported, while `stage` is simultaneously listed in `verifyFields` as unresolved — self-contradictory. Sibling remaps (`folfiri.json`, `folfox-4.json`) use `["VERIFY"]`. Fix to match.

## Advisory

3. Oxaliplatin cold-sensitivity/acute-neuropathy patient counseling and infusion-reaction precautions are not called out in supportiveCare (only cumulative neuropathy monitoring is). Optional to add when promoted.

## Confirmations requested by task

- Doses/units/days/cycles: oxaliplatin 100 mg/m2 d1 (correct for FOLFOX-6, not mFOLFOX6's 85), 5-FU 400 mg/m2 bolus d1, 5-FU 1200 mg/m2/day x2 (2400 over 46-48h), q14d — all CORRECT vs source. Leucovorin dose value 400 is correct for racemic agent (see Critical #1 re: name).
- Vincristine 2 mg cap: N/A — regimen contains no vincristine.
- Anthracycline cumulative cap: N/A — regimen contains no anthracycline.
- Carboplatin AUC-based dosing: N/A — no carboplatin. Oxaliplatin correctly dosed BSA (mg/m2), not AUC. Correct.
- Supportive care/monitoring: appropriate — moderate emetic-risk antiemetic tier (oxaliplatin is moderate risk), G-CSF not routine for FOLFOX, CBC + renal (platinum) + cumulative neuropathy monitoring. Adequate.
- Unsourced indication/eligibility honesty: histology / treatmentSetting / lineOfTherapy correctly "VERIFY"; biomarkers {} / eligibilityCriteria [] are schema-forced empties, both flagged in verifyFields — honest, not invented. Only `stage` is mis-encoded (Important #2). No fabricated concrete clinical claim found.
- Endorsement claim: none. NCCN cited only as evidentiary basis inside notes/supportiveCare; no "NCCN-approved"/StewardMD-endorsement language.

## Required to move to APPROVE
Fix Critical #1 (leucovorin agent/dose) and Important #2 (stage). No AI-assisted generation flagged in-file and no PHI present, so no chaining to stewardmd-ai-reviewer / stewardmd-security-reviewer required.
