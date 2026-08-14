# Adversarial verification — microcystic_adnexal_carcinoma.md

1. DOSE LEAK: none of the prohibited kinds found. Only numeric value in the file is "3 to 5" (cm, line 10 — surgical margin range, directly matching DeVita's own text "Margins reported in the literature for WLE vary from a few millimeters to 3 to 5 cm") and "12th ed." (edition number). No mg, mg/m2, AUC, Gy, %, or numbered chemo schedule anywhere. Notably the sidecar correctly OMITS DeVita's explicit RT dose ("doses of at least 50 Gy with wide margins") and the WLE-vs-MMS recurrence-rate percentages (40-60% vs 0-12%), both present in the source text — good discipline.

2. UNGROUNDED CLAIMS: none found that lack DeVita support or aren't flagged as general-standard.
   - All specific factual claims (local-recurrence-high/metastasis-low, head-and-neck/central-face predilection, PNI with microscopic extension beyond visible margin, WLE margin range, MMS lower recurrence than WLE, MRI's low sensitivity for microscopic disease, RT evidence limited to case reports/small series, rarity of metastatic disease and no systemic workup required, deep-biopsy necessity due to frequent misdiagnosis, lifelong skin/node surveillance for late recurrence) map directly to DeVita's "Prognosis and Management" paragraph (devita.txt lines ~226345-226365).
   - The two passages the draft agent itself flagged inline as "(general oncology standard, not from DeVita's section on this disease)" (line 20: individualized systemic therapy/trial referral for metastatic disease; line 33: individualized surveillance intervals) are honestly labeled as non-DeVita-sourced rather than presented as guideline fact — acceptable per the disclosed-uncertainty convention.
   - No named drug, regimen, or trial appears anywhere in the file (consistent with DeVita's section being silent on systemic therapy for MAC).

3. CITATION: present — line 40, "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." No page numbers. Correct format.

4. VERDICT: CLEAN — ready for R1.
