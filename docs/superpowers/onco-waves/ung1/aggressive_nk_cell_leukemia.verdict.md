# Adversarial verification — aggressive_nk_cell_leukemia.md

1. DOSE LEAK: none. Full-file digit scan finds only "12th ed." (edition number) and the sourcing/footer line. No mg, mg/m2, AUC, Gy, or numbered schedule anywhere in the body.

2. UNGROUNDED CLAIMS: none found. ANKL has no dedicated DeVita section (confirmed: `grep -n -i "aggressive NK"` on devita.txt returns exactly one hit, line 266710, inside the WHO classification table of mature T/NK-cell neoplasms — no prose section). Every specific claim the sidecar makes is either (a) explicitly labeled "general oncology standard, not from DeVita's section on this disease," or (b) explicitly labeled as borrowed from DeVita's separate extranodal NK/T-cell lymphoma, nasal-type section, and those borrowed claims check out against that section's text (lines ~269240-269330):
   - "anthracycline-containing CHOP produces low complete-response rates" → matches "only 30% of patients achieve a CR with CHOP chemotherapy with median OS of 4.3 months."
   - "asparaginase-containing regimens have shown promise ... for relapsed/refractory disease" → matches "Regimens with L-asparaginase have shown promising results in relapsed disease" (ref 373, AspaMetDex) and the SMILE regimen description.
   - "combining asparaginase with ... a folate antagonist and a corticosteroid backbone" (no drug/regimen names used) → matches AspaMetDex (asparaginase+methotrexate+dexamethasone) / SMILE without naming them, consistent with the no-specific-regimen-name discipline.
   - RT flagged as a nasal-type-only, not-ANKL, therapy → matches DeVita's RT discussion (RT alone / RT+chemo for stage IE/IIE nasal-type disease) which is entity-specific and correctly fenced off.
   - No relapsed/refractory regimen names, response-rate statistics, or RT dosing were imported for ANKL itself — correctly omitted per the draft agent's report.
   HLH-as-emergency, DIC/coagulopathy support, EBV DNA/ferritin/triglyceride/fibrinogen monitoring, and allo-SCT-only-realistic-cure framing are uncontroversial guideline-standard hematology/oncology management, consistent with general knowledge of this disease even though not textually in DeVita's ANKL section (which doesn't exist).

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." at file end, plus an inline sourcing-note paragraph up top. Name only, no page numbers.

4. VERDICT: CLEAN (ready for R1), with the pre-existing FLAG carried forward: ANKL has no DeVita-dedicated management section, so all borrowed content is by necessity extrapolated from a biologically related but distinct entity (extranodal NK/T-cell lymphoma, nasal type). The sidecar discloses this transparently and fences off the one claim that must NOT cross entities (RT role), so the flag is a sourcing-provenance caveat for R1's awareness, not a defect requiring rework.
