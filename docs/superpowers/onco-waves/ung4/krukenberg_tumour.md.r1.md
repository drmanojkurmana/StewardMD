# R1 Clinical-Safety Review — krukenberg_tumour

VERDICT: APPROVE

Goldens changed: no (intended: n/a — reference-content review, no engine/rule change)

## 1. SAFETY — PASS
No unsafe, misleading, or absolute directive. Core clinical framing is correct and safe:
- Krukenberg = metastatic (secondary) signet-ring cell carcinoma to the ovary, usually gastric primary → treat the primary, not the ovarian deposit in isolation. Correct.
- Systemic palliative intent as default (it signals stage IV disease) with cure the rare exception, deferred to MDT. Correctly hedged, no false promise of cure.
- Surgery on the ovary framed as palliative (pain, torsion, obstruction, hormonal bleeding/virilisation), not curative. Safe.
- No absolute "always/never" that could harm; each recommendation routes decisions to a multidisciplinary board / performance-status + organ-function assessment.

## 2. GROUNDING — PASS
Treatment claims are consistent with standard of care:
- First-line gastric/GEJ primary = fluoropyrimidine + platinum backbone. Standard.
- Biomarker-directed therapy (HER2, MMR/MSI, PD-L1) for gastric/GI primaries. Current standard.
- Palliative RT for localised pelvic symptom control only; no established primary RT role for the ovarian metastasis. Accurate.
- Monitoring with primary-appropriate markers (CA19-9/CEA, CA125 given ovarian involvement) and surveillance for obstruction/ascites/VTE. Reasonable.
No fabricated or outdated regimen. Crucially, the draft does NOT mis-attribute anything to DeVita: it discloses up front that DeVita has no dedicated Krukenberg management section, and every specific therapeutic claim is inline-labelled "(general oncology standard, not from DeVita's section on this disease)." This satisfies the adversarial-flag rule — no claim is cited to DeVita that is not in DeVita.

## 3. DOSE-FREE — PASS
Grep for mg / mg/m2 / AUC / Gy / numbered schedules returned NO_DOSE_TOKENS. Only digit occurrences are gene/marker names (CK7, CK20, CDX2, HER2, CA19-9, CEA, CA125) and "12th ed." Confirmed dose-free.

## 4. SCOPE — PASS
Consistently framed as decision-support, not a directive: repeated deferral to tumour board, "considered," "typically," "generally," and explicit early palliative/supportive-care referral given poor prognosis. No definitive diagnostic or prescriptive overreach.

## 5. ADVERSARIAL FLAGS — none outstanding
The .verdict.md returned CLEAN with no unresolved ISSUES (no dose leak, no ungrounded/mis-sourced claim, citation present and honestly qualified). Nothing to carry forward. No DeVita-attributed claim requires relabelling — the draft already labels its general-standard claims as such.

APPROVE — clinically safe, grounded, no mis-attribution to DeVita, dose-free, appropriately scoped as decision-support.
