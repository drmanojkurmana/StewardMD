# Adversarial verification verdict — mantle_cell_lymphoma

**Grounding used:** DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed., dedicated "Mantle Cell Lymphoma (MCL)" section, Chapter 67 Non-Hodgkin Lymphoma (source lines 267990-268186 of devita.txt), plus corroborating cross-chapter material on BTK-inhibitor toxicity (lines ~280464-280481).

## 1. DOSE LEAK
None. Grepped the sidecar for all digits; the only numeric-looking tokens are gene/receptor names (CD19, CD20, TP53), a cytogenetic locus (11;14 = t(11;14) translocation), and the edition number ("12th ed."). No mg, mg/m2, AUC, Gy, cycle count, or numbered schedule appears anywhere in the file.

## 2. UNGROUNDED CLAIMS
None found requiring flagging beyond what the sidecar itself already discloses. Every regimen/drug/trial-level claim traces to the DeVita MCL section:
- RCHOP vs BR (PFS 35 vs 22 mo, age ~70) — matches DeVita line 268070-268074.
- Bortezomib+CHOP (VR-CAP) improved PFS/RR/OS vs RCHOP, extra toxicity limited adoption — matches 268082-268088.
- Lenalidomide+rituximab upfront (92% ORR, 64% CR, 2-yr PFS 85%) — matches 268089-268092.
- R-HyperCVAD / Nordic (cytarabine+ASCT) regimens, cytarabine-before-transplant improves remission but not OS, high non-completion rates (39%, 63%) — matches 268093-268131.
- Maintenance rituximab post-induction/post-ASCT improves PFS+OS (LYSA trial) — matches 268138-268146.
- Ibrutinib RR/duration, progression-on-ibrutinib poor survival, acalabrutinib/zanubrutinib higher RR/CR — matches 268150-268157; "more favorable toxicity than ibrutinib" for 2nd-gen BTKi is not explicit for acalabrutinib in the MCL section itself but is directly supported elsewhere in DeVita (CLL chapter, ~280464-280471, "reduced toxicities with second-generation BTKi... versus ibrutinib") — grounded, not fabricated.
- Brexucabtagene autoleucel (ZUMA-2), high ORR/CR in high-risk subgroups, CRS/ICANS rates comparable to axi-cel in LBCL — matches 268158-268171.
- Bortezomib/lenalidomide relapsed RR ~25-30%, venetoclax 75% RR/PFS 14mo, radiosensitivity at low dose, ASCT-at-relapse limited benefit, non-myeloablative alloSCT 3-yr PFS/OS 30%/40% — all matches 268147-268185.
- MIPI, Ki-67 refinement, TP53 adverse marker, blastic variant survival, CNS involvement rarity — matches prognostic paragraphs 268030-268055.

The draft agent's own disclosures are accurate and appropriately conservative: it correctly flagged the TP53-treatment-choice recommendation, the SOX11-negative surveillance line, and the surgery-role statement as general-oncology-standard rather than verbatim-DeVita. (Note: the SOX11-negative/indolent-course association is actually present in DeVita's Immunophenotype/Genetics subsection, line 268019-268020, just not in the "Treatment"/"Clinical Features" paragraphs — so the disclosure is overly cautious, not wrong; no fabrication risk either way.)

No orphan statistics, no invented trial names, no drug not named in the DeVita section.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN — ready for R1.

No dose/schedule leak, no unsupported regimen/trial/statistic claims, citation line present and properly formatted, no em dashes found.
