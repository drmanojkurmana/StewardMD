# Adversarial re-verification verdict — mediastinal_large_b_cell_lymphoma.md (post-revision)

Grounded against DeVita 12th ed., "Primary Mediastinal Large B-cell Lymphoma" subsection, devita.txt lines ~268672–268746 (Pathology / Immunophenotype and Genetics / Clinical Features / Treatment) plus the Gray Zone Lymphoma subsection (~268828–268902) for the cHL-overlap/9p24 claim.

## 1. DOSE LEAK
None. Full digit grep of the file: only non-dose numerics — "40" (median age, matches DeVita's "median age of 40"), "9p24" (genomic locus), antigen names CD19/CD20/CD30/PD-1/PD-L1/PD-L2 (not doses), and "12th ed." in the citation. No mg, mg/m2, AUC, Gy, %, or numbered cycle schedule anywhere. Every DeVita efficacy percentage (DA-EPOCH-R PFS 93%/OS 100%, brentuximab RR 13.3%, pembrolizumab RR 41%, nivo+brentuximab ORR 73%/CR 37%) remains correctly omitted in favor of qualitative language.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Both previously-flagged items are now fixed:
- Line 16 (radiotherapy-omission-on-CR framing): the "studied without RT, excellent outcomes" fact stays correctly attributed to DeVita. The absolute claim ("RT is not required after CR") has been replaced with hedged, response-adapted language: "omitting radiotherapy after this regimen is generally guided by a response-adapted, PET-based assessment showing complete metabolic response, rather than treated as an automatic rule (general clinical inference, not from DeVita's section on this disease)." No longer an unlabelled inference.
- Line 23 (nivolumab + brentuximab): the implicit head-to-head superiority claim is gone. Now reads "higher response rates in single-arm data than those reported for either agent alone... (cross-study observation, not a head-to-head comparison)." This is in fact well grounded — DeVita states pembrolizumab (41% ORR), brentuximab alone (13.3% RR), and nivo+brentuximab (73% ORR/37% CR) within the same paragraph — and the hedge correctly avoids overclaiming trial-level comparative superiority.

No new fabrications or mislabelling introduced by the rewrite. Everything else remains directly traceable to the DeVita passage: DA-EPOCH-R as de facto standard, R-CHOP+RT vs DA-EPOCH-R retrospective parity, CD19 CAR-T (axi-cel/liso-cel) approval basis, brentuximab/pembrolizumab single-agent activity, 9p24/JAK2/PD-L1/PD-L2 biological overlap with cHL, demographics/clinical features. All items explicitly labeled "(general oncology standard, not from DeVita's section on this disease)" (lines 7, 27, 28, 29, 32, 33) remain honestly flagged as outside the source. The "What DeVita does not address" section (line 36) accurately scopes omissions rather than filling gaps with invented specifics.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN (ready for R1 re-review)
Both R1-required edits verified as correctly applied. No dose leak, no fabricated drugs/trials/stats, no mis-attribution to DeVita remaining, citation present in correct format. No blocking issues.
