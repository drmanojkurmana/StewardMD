# Adversarial verification verdict: low_grade_fibromyxoid_sarcoma

1. DOSE LEAK: none. Every numeral in the file is part of a fusion-gene name (FUS-CREB3L2, FUS-CREB3L1, EWSR1-CREB3L1, MUC4) or the "12th ed" citation — no mg, mg/m2, AUC, cycle count, or numbered schedule anywhere.

2. UNGROUNDED CLAIMS: none found. Checked DeVita 12th ed's "Low-Grade Fibromyxoid Tumor/Sclerosing Epithelioid Fibrosarcoma" section (line ~212878, devita.txt) directly against every biology claim in the sidecar:
   - Presentation (slow-growing deep mass, trunk/extremities, 3rd-4th decades) — matches DeVita text verbatim in substance.
   - MUC4 IHC positivity, FUS-CREB3L2 fusion in >90% of cases, rarer FUS-CREB3L1/EWSR1-CREB3L1 — matches DeVita ("FUS-CREB2L... over 90%... rare cases... FUS-CREB3L1 or EWSR1-CREB3L1").
   - Late pulmonary metastasis, decades after resection, need for long-term chest follow-up — matches DeVita directly.
   - SEF: more aggressive, ~50% metastasis rate involving bone/pleura/brain — matches DeVita ("approximately 50% of cases... bone, pleura, and brain").
   - LGFMS-to-SEF spectrum / hybrid histology / progression risk — matches DeVita's discussion of FUS-CREB3L2 hybrid tumors suggesting a related form or progression.
   All treatment-modality claims (surgical margins, adjuvant RT, MDT referral, limited chemo role, pulmonary metastasectomy) are explicitly and correctly inline-flagged "(general oncology standard, not from DeVita's section on this disease)" — the sidecar does not claim these are DeVita-sourced, so they are not mis-cited. No specific drug, regimen, trial, or survival/recurrence statistic is asserted anywhere without either DeVita grounding or an explicit non-DeVita disclaimer. This is unusually conservative/well-hedged, not fabrication.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. Correct format.

4. VERDICT: CLEAN (ready for R1)
