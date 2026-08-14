# Adversarial verification verdict: rhabdomyosarcoma.md

1. DOSE LEAK: none. Grepped all digit-containing lines in the sidecar (lines 10, 13, 23, 42) — all are gene/fusion names (PAX3-FOXO1, PAX7-FOXO1, MYOD1) or the edition number ("12th ed"), no mg/mg-m2/AUC/numbered schedule anywhere. Chemo backbone is named generically (vincristine-dactinomycin-cyclophosphamide) with explicit note that dosing "lives only in structured protocol templates, not in this narrative."

2. UNGROUNDED CLAIMS: none found. Cross-checked every specific clinical claim against DeVita 12th ed, "Rhabdomyosarcomas" subsection (lines 213437-213548):
   - Multimodal therapy (surgery+radiation+chemo), VAC backbone — matches line ~213440.
   - Embryonal: orbit/GU tract site in children, chemo/RT very effective even metastatic, adult regression but worse OS, metastasis-at-presentation/poor response = worse adult prognosis — matches lines ~213447-213462.
   - Alveolar: more common in adolescents/adults, worse prognosis than embryonal in young children, PAX3-FOXO1/PAX7-FOXO1 fusion, PAX3 fusion worse prognosis than PAX7, FISH/molecular testing to optimize treatment — matches lines ~213502-213519.
   - Pleomorphic: most common adult subtype, prior radiation association, poor prognosis, surgical treatment + adjuvant RT/chemo for eligible patients, less sensitive to systemic therapy but some response to anthracycline+ifosfamide and anecdotal gemcitabine sensitivity — matches lines ~213537-213548.
   - Spindle cell/sclerosing subtype tied to MYOD mutation or VGLL2 fusions, small minority of cases (DeVita: "only 5%") — matches line ~213445-213446 (sidecar correctly declines to repeat the 5% figure, softens to "small minority" — conservative, not fabrication).
   - Every claim NOT found verbatim in this DeVita section (risk-stratified treatment algorithms, referral triggers, surveillance intervals, site-specific radiation indications, second-line/relapse regimens) is explicitly and correctly flagged inline as "general oncology standard, not from DeVita's section on this disease" or as an acknowledged gap — no false DeVita-sourcing.
   - Minor terminology note (not a fabrication): DeVita's spindle-cell/sclerosing line says "MYOD mutation," sidecar writes "MYOD1 mutation" — MYOD1 is the standard gene symbol for MyoD, so this is a defensible normalization, not an invented fact.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. Correct format.

4. VERDICT: CLEAN (ready for R1).
