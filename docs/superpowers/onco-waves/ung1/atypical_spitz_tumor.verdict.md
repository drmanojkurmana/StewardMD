# Verdict: atypical_spitz_tumor.md

1. DOSE LEAK: none. No mg / mg/m2 / AUC / numbered-cycle-schedule anywhere in the file.

2. UNGROUNDED CLAIMS: none found that aren't already inline-labeled as general-oncology-standard/not-DeVita. Spot-checked against DeVita 12th ed, Ch. 63 (Cutaneous Melanoma):
   - "Pathway IV: Spitz Melanoma" paragraph (line ~227677-227687): driver list (HRAS; ALK/ROS1/NTRK1/NTRK3/MET/RET/BRAF fusions; MAP3K8), "atypical Spitz tumor" = intermediate genetic/histopathologic features, age distribution (Spitz nevi childhood vs. atypical Spitz tumor/Spitz melanoma older age) — all verbatim-supported.
   - Full-thickness biopsy vs. thin shave paragraph (line ~229080-229090): "critical for differentiation of melanoma from Spitz nevus," thin-shave under-recognition risk — supported (note: DeVita's 1-2mm biopsy margin figure exists in this paragraph but the sidecar correctly did NOT import it as a treatment margin, which would have been a leak/misattribution).
   - "Recent advances in cytogenetics... aided in the diagnosis and especially in differentiating between melanomas and Spitz nevi" (line ~228748-228750) — supports the sidecar's parenthetical about cytogenetic/molecular ancillary testing.
   - "grouped together as skin melanocytomas... tend to have benign or indolent courses but deserve ongoing attention in follow-up" (line ~228752-228754) — directly supports the Monitoring section's wording.
   - Melanoma-in-children biopsy-feasibility paragraph (line ~228644-228651): excisional biopsy often infeasible under local anesthesia in young children, incomplete shave biopsy leaves a diagnostic dilemma between melanoma and Spitz nevus — supported.
   - Everything else (surgical margins, SLNB interpretation, targeted-therapy-by-extrapolation, lines-of-therapy framing) is explicitly flagged inline as "general oncology standard, not from DeVita's section on this disease" — draft agent's own disclosure is accurate; DeVita's Spitz-pathway text is diagnostic/biological, not a treatment algorithm, and the sidecar does not pretend otherwise.
   - Minor stylistic overreach only: "distinct from the driver profile of conventional melanoma" (para 3 under Diagnostic foundation) is a reasonable inference from context (BRAF/NRAS-driven CSD pathway vs. this pathway) but isn't a direct DeVita quote in the cited lines — low materiality, not a fabrication.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." (name only, no page numbers). Correct format.

4. VERDICT: CLEAN (ready for R1).
