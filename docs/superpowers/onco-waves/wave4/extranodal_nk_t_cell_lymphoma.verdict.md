# Verdict: extranodal_nk_t_cell_lymphoma.md

1. DOSE LEAK: none. Grepped for all digits — only occurrences are "age 60 or younger" (a risk-factor
   age cutoff, not a dose; correctly matches DeVita's "age 60 years and younger") and "12th ed." in
   the citation line. All actual doses in the source (RT 50-55 Gy, methotrexate 2 gm/m2, and every
   response-rate/survival percentage: 88.8% OS, 72.2%/58.3%/59.6% OS, 83% RR, 85%/86% PFS/OS, 30% CR,
   4.3-month OS, 79% RR/45% CR, 53%/55% 1-yr PFS/OS, 10%/<2% CNS risk) were correctly omitted/paraphrased
   qualitatively (e.g. "favorable long-term survival," "materially higher risk," "substantial ...
   rates"). No numbered schedules (cycle counts, day-numbers) leaked either.

2. UNGROUNDED CLAIMS:
   - **Transplant recommendations** ("Consolidative autologous or allogeneic stem cell transplantation
     should be considered in eligible responders with high-risk or relapsed/refractory disease" and
     "Refer for transplant evaluation in high-risk, relapsed, or refractory disease"). I grepped the
     entire DeVita "Extranodal NK/T-cell lymphoma, nasal type" section (lines ~269240-269310) and the
     term "transplant"/"SCT" does not appear there at all — it's absent from the disease-specific
     text. The sidecar is honest about this (explicitly labels it "per general lymphoma consolidation
     principles," "disease-specific transplant evidence base ... is limited," "individualized with a
     transplant-capable ... service"), so it isn't presented as DeVita-sourced fact, but it is still a
     specific management recommendation not supported by the cited source for this disease. Flagging
     per instructions even though it's a defensible general-oncology inference, not fabricated data.
   - **"Role of surgery" section** (limited to diagnostic biopsy + management of local complications,
     no curative role) — no surgery/biopsy sentence exists anywhere in the DeVita passage for this
     disease. This is uncontroversial standard-of-care knowledge (lymphomas are staged/diagnosed by
     biopsy, not resected) but is not textually grounded in the cited DeVita excerpt.
   - Minor: "Early, adequately dosed radiotherapy is a consistent theme across the localized-disease
     literature; delaying radiation ... is associated with worse outcomes" is placed under the
     *low-risk* subgroup bullet, but DeVita's "early use of RT ... is critical to optimal treatment"
     statement is specifically drawn from the *risk-factor* subgroup's sequencing comparison (RT->chemo
     72.2% vs chemo->RT 58.3% vs RT-alone 59.6%). The generalization to "localized-disease literature"
     broadly is a plausible but slightly loose extrapolation, not a fabricated number.
   - All other clinical claims (prognostic index factors, CNS-risk-by-factor-count, EBV viral load
     prognostic value, extranasal site list, extranasal-worse-prognosis-stage-for-stage, low-risk
     criteria, RT-alone outcome in low-risk, combined-modality sequencing benefit in risk-factor group,
     concurrent chemoRT phase II activity, anthracycline/CHOP inferiority in disseminated disease,
     asparaginase/SMILE-style regimen activity, intermediate-dose methotrexate lowering CNS relapse
     risk) were directly matched, sentence-for-sentence, against the DeVita "Treatment" paragraph
     (lines 269277-269310) and its preceding "Clinical Features" paragraph — all grounded with doses/
     percentages correctly stripped.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed." — name only, no page numbers. Correct format.

4. VERDICT: ISSUES (minor, non-blocking)
   - Transplant-related bullets (2 locations: Treatment > Disseminated section, and When to refer)
     are extrapolated from general lymphoma principles, not the disease-specific DeVita text for this
     entity — should be double-checked by R1 or re-labeled more explicitly as "general lymphoma
     practice, not disease-specific evidence" rather than sitting alongside DeVita-grounded bullets
     with equal weight.
   - "Role of surgery" section has no DeVita textual anchor at all (uncontroversial content, but
     not verifiable against the cited source).
   - No dose leak, citation format correct, the great majority of substantive claims are well-grounded
     and appropriately de-numbered. Recommend R1 spot-check the transplant bullets specifically;
     otherwise ready to proceed.
