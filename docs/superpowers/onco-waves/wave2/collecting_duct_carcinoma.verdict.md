# Adversarial verification verdict: collecting_duct_carcinoma.md

## 1. DOSE LEAK
None. Grepped for digits, mg, mg/m2, AUC, Gy, numbered schedules. Only numeric tokens in the file are "mid-50s" (age description, not a dose) and "12th ed" (citation edition number). No dose/mg/AUC/schedule numbers present. PASS.

## 2. UNGROUNDED CLAIMS
Verified against DeVita (grepped "collecting duct" — only 3 hits in the whole text: Table 43.1 entry (~line 149014), the VHL-negativity line (~line 149753), and the classification-overview line (~148938). DeVita has zero CDC-specific treatment/trial text, confirmed by the draft agent's own disclosure.

- **Epidemiology/pathology claims (male preponderance, mid-50s, high-grade/urothelial-resembling, VHL-negative, highly variable genetics with multi-chromosomal losses)** — all directly supported by DeVita Table 43.1 and the explicit line "VHL gene mutation is not found in papillary, chromophobe, collecting duct, medullary, or other types of kidney cancer." GROUNDED.
- **Adjuvant RCC-wide trial summary (mixed clear-cell/non-clear-cell enrollment, mostly negative DFS/OS, one trial with modest DFS-only benefit)** — matches DeVita's ASSURE/SORCE/EVEREST (mixed histology eligible) and S-TRAC (positive DFS, explicit "lack of benefit in overall survival") narrative and Table 43.7. GROUNDED, though PROTECT's 800 mg-subgroup positive DFS result is glossed over — a defensible simplification since PROTECT's headline ITT result was split/mixed, not a clean second positive trial.
- **"Adjuvant immunotherapy ... have not shown a survival benefit in the adjuvant RCC setting historically"** — this is imprecise against the source. DeVita reports KEYNOTE-564 (adjuvant pembrolizumab) achieved a *significant DFS benefit* (HR 0.68, P=0.002) leading to FDA approval; the source's caveat is specifically that *OS* benefit is not yet shown ("In the absence of an improvement in OS, it remains to be seen if adjuvant with pembrolizumab may lead to a significant change in RCC survival"). By lumping immunotherapy in with hormone therapy/radiotherapy/vaccines as uniformly "not shown a survival benefit historically," the sidecar erases the DFS win and FDA approval that DeVita itself reports. Not a dose/fabrication issue, but a real mismatch with the nuance of the source — should be tightened (e.g., "no adjuvant immunotherapy trial has yet shown an overall-survival benefit, though pembrolizumab showed a disease-free-survival benefit").
- **"Platinum-based cytotoxic combination chemotherapy is the systemic treatment most commonly used for advanced/metastatic CDC"** — not sourced in DeVita at all (DeVita is silent on CDC-specific therapy). This is uncontroversial real-world NCCN/guideline-consistent practice (urothelial-type regimens for CDC given its urothelial-like biology), and the sidecar explicitly flags in its closing section that DeVita has no CDC-specific regimen data. Acceptable given the explicit disclosure, but worth noting it is guideline-extrapolation, not DeVita-grounded.
- No specific drug names, trial names, or statistics for CDC itself are asserted — consistent with the draft agent's stated omissions. No fabrication found.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. PASS.

## 4. VERDICT
**ISSUES (minor, non-blocking for R1 but should be tightened):**
- Reword the "adjuvant immunotherapy ... have not shown a survival benefit historically" sentence so it doesn't erase KEYNOTE-564's DFS benefit/FDA approval reported in DeVita — restrict the "no survival benefit" claim to OS, or explicitly carve out pembrolizumab's DFS result as DeVita does.
- Everything else (epidemiology, VHL-negative status, RCC-wide adjuvant trial summary, absence of CDC-specific dosing/regimens, citation format) checks out against DeVita and contains no dose leak.
