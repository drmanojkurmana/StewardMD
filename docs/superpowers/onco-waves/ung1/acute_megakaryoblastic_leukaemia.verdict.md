# Verdict: acute_megakaryoblastic_leukaemia.md (re-verification after REVISE)

1. DOSE LEAK: none. Grepped for mg / mg-m2 / AUC / numbered day-cycle schedules — zero hits. Only
   digits present are M7 (subtype name), 12th ed. (citation), and gene/fusion identifiers
   (RBM15-MKL1, CBFA2T3-GLIS2, GATA1). No em/en dashes.

2. UNGROUNDED / MISLABELLED CLAIMS: none found.
   - Re-grepped devita.txt for "megakaryocytic leukemia"/"megakaryoblastic": one hit only, in the
     mediastinal germ-cell-tumour chapter (~line 168128), as an incidental second-malignancy
     association, not treatment guidance — matches the Sourcing note's own disclosure.
   - The claims still attributed to DeVita (cytarabine + anthracycline "7+3" induction backbone;
     fitness/comorbidity-driven treatment selection) are genuinely present in DeVita's general AML
     chapter (~lines 275024, 283621, 283710) — accurate grounding.
   - All AMKL-specific claims not in DeVita (Down-syndrome reduced-intensity/GATA1 chemosensitivity,
     RBM15-MKL1/CBFA2T3-GLIS2 fusions, transplant escalation for non-DS high-risk disease,
     transient-abnormal-myelopoiesis surveillance, trephine/reticulin dry-tap monitoring) are now
     correctly hedged and captured under the closing NCCN/general-heme-onc attribution rather than
     DeVita. No claim is mis-attributed to DeVita anywhere in the body or closing line.

3. CITATION: present, name only, no page numbers. Closing line now lists two named sources with an
   explicit parenthetical split (DeVita = general-AML induction backbone + fitness-driven selection
   only; NCCN Guidelines = AMKL-specific content DeVita does not cover). Correct format.

4. VERDICT: CLEAN — ready for R1 re-review. Both R1-required fixes are resolved:
   (a) the sole-source mislabelling is fixed — DeVita is no longer implied as the authority for
       AMKL-specific content it doesn't cover; NCCN is now named as the second source for that
       content, with the split stated explicitly.
   (b) the self-declared "FLAG: needs manual sourcing ... before clinical use" sentence has been
       removed and replaced by the Sourcing-note paragraph's explicit dual-attribution model — no
       in-body not-ready marker remains.
   No new defects introduced by the rewrite; no content was deleted that shouldn't have been.
