# Adversarial verification verdict: plasma_cell_leukemia.md

1. DOSE LEAK: none. No mg, mg/m2, AUC, or numbered schedule anywhere in the sidecar. (Diagnostic threshold "5% circulating plasma cells" from DeVita's PCL definition was correctly omitted rather than included.)

2. UNGROUNDED CLAIMS: none rise to fabrication.
   - Core PCL-specific claim ("approach similar to MM," "multiagent combination chemotherapy...initial therapy since rapid and reliable disease control is essential") is a near-verbatim match to DeVita line ~288038-288049 ("Treatment of Plasma Cell Leukemia" section). Confirmed.
   - "Later lines / relapsed disease" regimen list (dexamethasone/methylprednisolone palliation, IV melphalan, bendamustine, panobinostat + proteasome inhibitor, bortezomib + pegylated liposomal doxorubicin, VDT-PACE) matches DeVita's MM-chapter relapsed-disease text verbatim in substance (confirmed at lines ~288030-288037, immediately preceding the PCL section). Correctly labeled as extrapolated from the MM chapter, not PCL-specific.
   - All induction/transplant/maintenance/supportive-care/monitoring bullets are explicitly tagged inline "(general oncology standard, not from DeVita's section on this disease)" — these are uncontroversial guideline-standard MM/PCL supportive care (bisphosphonate/denosumab for bone disease, ESA for anemia, vaccination/PJP prophylaxis, hypercalcemia hydration+bisphosphonate, cord compression steroids+RT) and not presented as DeVita-sourced. Acceptable per labeling convention.
   - No specific trial names/statistics (e.g., skeletal-event percentages, pamidronate vs zoledronic acid numbers) were imported despite being visible nearby in the source — correctly left out as MM-general, not PCL-specific, avoiding over-claiming.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. Correct format.

4. VERDICT: CLEAN (ready for R1).
