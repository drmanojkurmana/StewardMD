# Adversarial verification verdict — mediastinal_large_b_cell_lymphoma.md

Grounded against DeVita 12th ed., "Primary Mediastinal Large B-cell Lymphoma" subsection, devita.txt lines ~268672–268746 (Pathology / Immunophenotype and Genetics / Clinical Features / Treatment).

## 1. DOSE LEAK
None. Grepped the sidecar for `[0-9]` (full output reviewed) — only non-dose numerics found: "40 years" (median age, matches DeVita's "median age of 40"), "9p24" (genomic locus, matches DeVita's "chromosome 9p"), antigen names CD19/CD20/CD22/CD30 (not doses), and "12th ed." in the citation. No mg, mg/m2, AUC, cycle counts, or numbered schedule anywhere. Note the sidecar also correctly *omitted* every efficacy percentage DeVita gives (PFS 93%/OS 100% for DA-EPOCH-R, brentuximab RR 13.3%, pembrolizumab RR 41%, nivo+brentuximab ORR 73%/CR 37%), replacing them with qualitative language ("outstanding," "low response rate," "meaningful ORR," "notable efficacy") — correct behavior for this sidecar's constraint.

## 2. UNGROUNDED CLAIMS
- Line 16 ("Radiotherapy is not required for patients who receive the dose-adjusted EPOCH-based regimen and achieve a complete response") is an inferential add — DeVita states the DA-EPOCH-R study was conducted without RT and had excellent outcomes, but does not explicitly frame CR as a condition for omitting RT. Defensible clinical inference, not a citation-worthy DeVita statement; should probably be softened or hedged, but not a fabrication (no invented drug/trial/stat).
- Line 23 ("shown notably better efficacy than either agent alone") — DeVita's PMBL paragraph gives the combo ORR/CR only; it does not make an explicit head-to-head comparative statement to the monotherapy arms in that same passage (the monotherapy numbers appear one sentence earlier in the same paragraph, so the comparison is a reasonable same-source synthesis, not an external import).
- Everything else (DA-EPOCH-R as de facto standard, R-CHOP+RT vs DA-EPOCH-R retrospective parity, CD19 CAR-T [axi-cel/liso-cel] approval basis, brentuximab/pembrolizumab single-agent activity, nivo+brentuximab combo, 9p24/JAK2/PD-L1/PD-L2/GEP overlap with cHL, demographics/clinical features) is directly traceable to the DeVita passage.
- All items explicitly labeled "general oncology standard, not from DeVita's section on this disease" (lines 7, 27, 28, 29, 32, 33) are honestly flagged as outside the source rather than passed off as DeVita content — correct practice, and each is uncontroversial standard-of-care content (biopsy-only diagnosis, PET-CT response assessment, SVC-syndrome monitoring, referral pathways).

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN (ready for R1)
No dose leak, no fabricated drugs/trials/stats, citation present in correct format. Two minor inferential extrapolations (radiotherapy-omission-conditional-on-CR framing; "better than either agent alone" comparative framing) are flagged above for R1's awareness but do not rise to fabrication — both are reasonable syntheses of facts stated in the same DeVita passage, not invented content. Recommend R1 spot-check those two lines for hedging language but no blocking issue.
