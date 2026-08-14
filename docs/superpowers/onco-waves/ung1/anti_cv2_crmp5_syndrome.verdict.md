# Adversarial re-verification — anti_cv2_crmp5_syndrome.md (after third revision)

## 1. DOSE LEAK
None. `grep -nE "[0-9]"` over the sidecar turns up only: ">70%" (x2, DeVita's
own risk-tier stat, lines 5 and 46), "12th ed." (citation edition, line 50).
No mg/g/mcg/AUC/m2 figures and no numbered dosing schedule anywhere. DeVita's
PNS Treatment passage (devita.txt ~323444-323464) carries heavy dosing
(methylprednisolone 1 g/day, IVIG 0.4-2 mg/kg/day, plasma exchange q-other-day
x5-7, rituximab 375 mg/m2 weekly x4 then monthly, azathioprine 2-3 mg/kg/day,
mycophenolate 500-1,000 mg BID, cyclophosphamide 1,000 mg/m2 IV monthly or
1-2 mg/kg PO daily, tocilizumab 8 mg/kg monthly) and all of it remains
correctly stripped to drug-class/drug-name-only in the sidecar. "roughly two
years" (line 13) is a screening-interval mention (matches DeVita's own
"repeated every 4 to 6 months for 2 years," with the month-interval number
dropped), not a drug dose. Clean.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Both previously-blocking items verified fixed, no new issues introduced.

- Line 9 heading now reads "## Tumor-directed therapy" (the "(mainstay)"
  qualifier is gone). It no longer contradicts the body text immediately
  below it, which correctly states (matching devita.txt line ~323096-323098
  verbatim: "the tumor-directed treatment is less effective in immune-mediated
  syndromes") that tumor-directed treatment is a necessary parallel track,
  not the dominant lever.
- Line 42 now reads "...so tumor-directed treatment can proceed in parallel
  with immunotherapy without delay" — the unlabelled superlative ("strongest
  lever on outcome") is gone, and the sentence is now consistent with the
  parallel-track framing established in the Tumor-directed-therapy section.
- Line 5's parenthetical no longer contains the self-contradictory dual
  attribution R1 flagged. It now states plainly: "DeVita's general PNS
  treatment discussion notes that antibodies against intracellular antigens
  as a class tend to respond less robustly to immunotherapy than antibodies
  against cell-surface antigens." Checked against devita.txt Treatment
  section: "PNS associated with antibodies to surface antigens respond
  better to immunotherapy than those with antibodies against intracellular
  antigens" — matches, and this is genuinely DeVita's own class-level point,
  so stating it plainly (no non-DeVita hedge) is correct, not an
  under-attribution.

Re-checked every remaining claim directly against devita.txt this pass:
- High-risk (>70%) tier, same tier as anti-Hu (line 5) — matches Table 89.1 /
  text (devita.txt ~323122-323124).
- Table phenotype "EM, SNN" + tumors SCLC/thymoma (lines 26, 46) — matches
  Table 89.1 CV2/CRMP5 row exactly.
- ~2-year repeat-screening recommendation (line 13) — matches devita.txt
  "Screening for Malignancies" section verbatim in substance.
- "Start treatment once viral/bacterial infection reasonably excluded" +
  escalating ladder: corticosteroid pulse / IVIG / plasma exchange first-line,
  rituximab / azathioprine / mycophenolate / cyclophosphamide second-line,
  tocilizumab in rituximab-refractory autoimmune encephalitis (lines 19-21) —
  matches devita.txt Treatment passage paragraph-for-paragraph, doses
  correctly stripped.
- CV2/CRMP5-vs-anti-Hu/anti-Yo outcome comparison (line 22) — explicitly
  hedged as "not a quantified or rigorously established finding" and labelled
  "(general neuro-oncology literature, not from DeVita's section on this
  disease, which does not report CV2/CRMP5 outcome data)." Correctly labelled;
  devita.txt has no CV2/CRMP5-specific outcome data to ground this against.
- SCLC/thymoma staging pathways (line 12), expanded phenotype list —
  cerebellar ataxia, chorea, cranial neuropathy, myelopathy, mixed
  sensorimotor neuropathy (line 26), chorea symptomatic Rx (line 28),
  ophthalmic phenotype (line 29), ataxia/myelopathy/neuropathy supportive
  care (line 30), anti-Hu/anti-amphiphysin coexistence (line 34) — all
  correctly tagged "(general oncology standard / general neuro-oncology
  literature, not from DeVita's section on this disease)" and none of this
  is in DeVita's CV2/CRMP5 table entry or general PNS passage, so the
  labelling is accurate.

No claim found mis-attributed to DeVita. No remaining unlabelled superlatives
or specific regimen/statistic claims lacking the non-DeVita tag.

## 3. CITATION
Present (line 50): "Sources: DeVita, Hellman, and Rosenberg's Cancer:
Principles & Practice of Oncology, 12th ed." Name + edition only, no page
numbers. Correct.

## 4. VERDICT: CLEAN — ready for R1 re-review.

- Dose leak: none.
- Em/en dashes: none found (`grep -n "—\|–"` zero hits); no residual
  "mainstay" or "strongest lever" strings anywhere in the file.
- Citation: correct format.
- R1 required fix #1 (self-contradictory "mainstay" heading vs. corrected
  body text): verified fixed.
- R1 required fix #2 (unlabelled "strongest lever on outcome" superlative):
  verified fixed.
- Optional cleanup (line 5's self-contradictory dual-attribution
  parenthetical): verified fixed, and the resulting plain statement checks
  out against devita.txt as genuinely DeVita's own point.
- All previously-approved groundings/labels (tocilizumab attribution, the
  five general-neuro-oncology-literature items, screening interval, table
  entry) left untouched and re-verified accurate this pass.
