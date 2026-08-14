# Adversarial verification verdict — enteropathy_associated_t_cell_lymphoma.md

## 1. DOSE LEAK
None. All numeric tokens in the sidecar are: HLA allele designations
(DQA1*0501/DQB1*0201), CD-marker numbers (CD3, CD103, CD4/CD8, CD30),
epidemiologic/outcome percentages (39% EATL-in-refractory-celiac, 15% of SB
lymphomas, 8-20% 5-year survival), and the "12th ed" citation. No mg, mg/m2,
AUC, cycle count, day number, or named-drug dose anywhere.

## 2. UNGROUNDED CLAIMS
None found. Spot-checked every specific/numeric claim against DeVita 12th ed
(text at /Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt):

- "up to roughly 39 percent" of severe/refractory celiac develop EATL —
  matches line ~115402-115403 verbatim ("EATL occurs in up to 39% of
  patients with severe or refractory CS").
- "roughly 15 percent of small bowel lymphomas," equal M:F ratio, jejunum/
  proximal ileum predominance — matches the SB-lymphoma table at
  ~116960-116975 ("Accounts for ~15% of SB lymphomas... Equal male:female
  ratio; most common in the jejunum and proximal ileum").
- "5-year survival in the range of roughly 8 to 20 percent" — matches same
  table row exactly ("5-year survival rate is 8%-20%").
- "surgery followed by adjuvant chemotherapy using an anthracycline-based
  regimen" — matches same table row exactly ("Surgery followed by adjuvant
  chemotherapy, anthracycline based"). This is the single strongest EATL-
  specific grounding point in the sidecar.
- EATL immunophenotype (CD3+/CD103+, CD4/CD8 variable, CD30+ subset) vs.
  MEITL (CD8+/CD56+, no celiac association) — matches DeVita's EATL section
  (~269055-269090) and genetics table.
- PTCL-NOS treatment principles used as explicit extrapolation (CHOP-type
  regimens lack proven advantage over alternatives; CHP+brentuximab
  [ESCHELON-2] superior PFS/OS in CD30+ PTCL and became first-line for
  CD30+ subtypes; ASCT in first remission for fit patients; relapsed-disease
  options — antifolate [pralatrexate], HDAC inhibitors [romidepsin/
  belinostat], allo-SCT, salvage-then-ASCT with limited benefit) — all
  matches DeVita's PTCL-NOS Treatment section (~269000-269053), correctly
  abstracted to drug-class level (no specific numbers like "48m vs 21m" or
  "25-30% RR" imported) and explicitly and correctly flagged in the sidecar
  as extrapolation from the broader PTCL group rather than EATL-specific
  evidence.
- Gluten-free diet halting celiac->EATL progression — matches DeVita's EATL
  intro line directly ("Treatment of celiac disease with a gluten-free diet
  prevents the development of lymphoma").

Minor observation (not an error): the sidecar names "CHOP-type combination
chemotherapy" once, in the context of the general PTCL-class comparative
statement (not as an EATL-specific regimen recommendation). This is a
regimen-class name, not a dose, and is uncontroversial/guideline-standard —
not a leak, not a fabrication.

No named trial, statistic, or regimen in the sidecar lacks a DeVita anchor.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN (ready for R1)

No dose leak, no ungrounded specific claims, citation present and correctly
formatted. The draft agent's self-reported omissions (no named regimen
beyond "anthracycline-based," no EATL-specific transplant-outcome stats, no
EATL-specific surveillance interval, no EATL-specific relapse trial data)
are consistent with what DeVita actually contains — DeVita itself does not
provide EATL-specific data beyond the SB-lymphoma table row, and the sidecar
correctly labels all PTCL-class extrapolations as such rather than
presenting them as EATL-specific evidence.
