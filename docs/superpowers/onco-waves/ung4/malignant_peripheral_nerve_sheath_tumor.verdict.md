# Verdict: malignant_peripheral_nerve_sheath_tumor (re-verification after revision)

## 1. DOSE LEAK
None. Grepped for mg, mg/m2, mg/kg, AUC, Gy, cycle counts, q-day/q-week schedules: zero hits. Only numbers present are the NF1 lifetime-risk range (8-13%, epidemiological, verbatim-grounded to DeVita's "8% to 13%") and the age range (20-50 years) — neither is a dose/schedule.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Both previously-flagged R1 issues are confirmed fixed and no new issues found on re-check:
- **Fixed (line 9):** "S100 staining is often only focal" now explicitly carries its own "(general pathology standard, not from DeVita's section on this disease)" tag, cleanly separated from the adjacent DeVita-grounded clause (weak S-100 -> 5x higher metastasis risk). No longer riding uncredited under the DeVita citation.
- **Fixed (line 19):** the near-restatement of DeVita's 21% ORR ("in the range of about one-fifth of patients") is gone. Now reads as purely qualitative: "Response rates to chemotherapy in MPNST are modest, with better outcomes reported when an alkylating agent (ifosfamide) is combined with an anthracycline-based regimen than with an anthracycline alone." No numeric echo of the omitted percentage remains.
- Re-spot-checked all other claims against DeVita devita.txt lines 213688-213781: age range, sites, NF1 lifetime risk, FDG-PET/heterogeneous-MRI screening for transformation, atypical-neurofibroma precursor, H3K27me3 marker pattern (95%/91%/60% correctly generalized to qualitative "most consistent in sporadic/radiation-associated, less consistent in NF1"), tumor size + margin status as the multivariate survival predictors, radiation-associated local recurrence being significantly higher (44% vs 18%, P=.02, correctly dropped to qualitative), neoadjuvant chemo controversy, ifosfamide+anthracycline vs anthracycline-alone response pattern, NF1/Ras/Raf/MAPK rationale, and the B-Raf-TKI (sorafenib) phase II trial (0/12 RECIST responses, 3 SD, 2 regressions, correctly generalized with no drug name, N, or percentages in the body text) — all trace cleanly.
- Sections explicitly tagged "(general oncology standard, not from DeVita's section on this disease)" — staging/chest-CT convention, adjuvant-RT rationale + MPNST radioresistance note, MDT sarcoma team, oligo-pulmonary metastasectomy, long-term surveillance — are honestly flagged as non-DeVita and are uncontroversial; none smuggle in an unlabelled statistic.
- Minor non-blocking observation (not a fabrication, no action needed): the "Deliberately omitted" footer names "the sorafenib trial" explicitly even though the body text only says "a B-Raf-targeting tyrosine kinase inhibitor" — a stylistic inconsistency, not a grounding or dose problem (sorafenib is in fact the correct DeVita-cited drug).

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1 re-review). No dose/mg/AUC/schedule leak. No fabricated drugs, trials, or statistics. Both prior R1-blocking issues verified fixed; all specific claims map to the DeVita MPNST section or are honestly labeled as general-oncology-standard rather than DeVita-sourced.
