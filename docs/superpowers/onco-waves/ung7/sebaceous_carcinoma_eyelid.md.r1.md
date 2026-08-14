# R1 Clinical-Safety Review — sebaceous_carcinoma_eyelid

APPROVE — Clinically safe, grounded, dose-free, and appropriately scoped for KB decision-support. Confidence: 88.

## Verdict basis
- No `.verdict.md` adversarial file present at the sidecar path, so there are no unresolved adversarial flags to reconcile. Reviewed on merits.

## 1. Safety
No unsafe, misleading, or harm-inducing statements. Recommendations (margin-controlled excision, Muir-Torre screening, referral pathways) match accepted periocular-SC practice and would not lead a clinician astray. No overreaching definitive claims; treatment is framed as "mainstay"/"preferred where feasible," not mandated.

## 2. Grounding
Claims are consistent with DeVita/NCCN standard of care and are carefully attributed. The draft explicitly separates DeVita-sourced facts (margin-recurrence data, MMS vs WLE recurrence/mortality figures) from general-oncology-standard recommendations (preference for margin-controlled technique, adjuvant/definitive RT indications, long-term follow-up, deferral of systemic lines to NCCN). No regimen is fabricated; systemic therapy is explicitly declined for lack of grounding in the source — correct and honest. No claim is mis-attributed to DeVita.

## 3. Dose-free
Confirmed. No mg, mg/m2, AUC, mg/kg, or numbered chemotherapy schedules. Numeric values present are surgical margins (5-6 mm), a Mayo MTS risk-score threshold (>=3), staging (T2c), and epidemiologic percentages — none are drug doses. Token scan returned NO_DOSE_TOKENS.

## 4. Scope
Appropriately hedged as decision-support. Uses "may be needed," "can be considered," "generally reserved," "should be individualized in a multidisciplinary tumor board." Systemic and line-of-therapy sequencing are deferred to NCCN + tumor board rather than directed. When-to-refer section is advisory, not prescriptive.

## 5. Adversarial flags
None to reconcile (no verdict file). The draft's own self-labelling ("general oncology standard, not from DeVita's section on this disease") pre-empts the most likely scope/attribution objections and is the correct pattern.

## Advisory (non-blocking)
- The unlabelled "Wide local excision with 5 mm to 6 mm margins" reads as source-attributed; consider tagging it consistently with the other margin claims for provenance clarity. Not a safety issue.

goldens changed: no (intended: n/a — narrative KB content, no engine/golden outputs touched)
