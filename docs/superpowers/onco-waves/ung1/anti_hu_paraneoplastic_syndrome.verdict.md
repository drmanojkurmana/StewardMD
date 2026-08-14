# Adversarial RE-verification: anti_hu_paraneoplastic_syndrome.md (post-revision)

## 1. DOSE LEAK
None. Grepped for digits in the current file — only hits are "70 percent" (antibody-cancer
association rate, an epidemiologic fact, not a dose), list markers "(1)"/"(2)", section
numbers, and "12th ed." No mg/mg-m2/AUC/numbered-schedule tokens anywhere. Section 3 still
correctly says "over several days" instead of DeVita's stated steroid/IVIG/PLEX doses;
section 4 still names rituximab/azathioprine/mycophenolate/cyclophosphamide/tocilizumab as
drug classes only, with doses correctly omitted. Dose-free rule holds.

## 2. UNGROUNDED / MISLABELLED CLAIMS
All three previously-flagged items are fixed:
- "(or, in children, neuroblastoma)" — confirmed deleted from Section 2 (grepped, not present).
- "pseudo-obstruction carries a real risk of malnutrition and bowel perforation" — now correctly
  suffixed with "(general oncology standard, not from DeVita's section on this disease)".
- "cardiac dysautonomia with arrhythmia risk" — now softened to "dysautonomia" and carries the
  same general-standard caveat.

One NEW unflagged claim survives in Section 2 that should have been caught:
- **"Successful tumour treatment tends to help paraneoplastic syndromes driven by ectopic
  hormone production more reliably than immune-mediated neurological syndromes such as this
  one, where tumour-directed treatment is less effective at reversing deficits even though it
  remains the priority."** This is a cross-chapter synthesis (DeVita's neuro-PNS treatment
  paragraph, ~line 323444, only says tumor treatment is "in addition to" immunotherapy for
  neuro-PNS; the ectopic-hormone/SIADH comparison lives in a completely separate part of Ch.
  89, ~line 323480, and never states this comparative reliability claim). Plausible general
  oncology teaching, but it is not stated in the cited DeVita excerpt and is not tagged with
  the "(general oncology standard, not from DeVita's section on this disease)" caveat the file
  correctly uses elsewhere (Section 1, Section 2's staging bullet, Section 5, Section 6).
- Adjacent bullet, same section — "the intervention most likely to halt neurological
  progression" is a reasonable paraphrase of DeVita's "addressing the primary tumor when
  detected" framing and is lower-risk, but is also asserted with more certainty than the
  source text and is unlabelled. Minor; flagging for completeness, not blocking on its own.

Everything else re-checked and still grounded: >70% high-risk antibody classification, SCLC
dominant association, EM/LE/SNN/GI-pseudo-obstruction phenotype list, intracellular-antigen/
CD8 T-cell mechanism, surface- vs intracellular-antigen immunotherapy-responsiveness gradient,
serum+CSF testing rationale, 4-6 month/2-year rescreening interval, treat-before-antibody-
confirmation-once-infection-excluded, first-line steroid/IVIG/PLEX and second-line rituximab/
azathioprine/MMF/cyclophosphamide/tocilizumab-refractory-to-rituximab drug-class lists,
sensory neuronopathy = dorsal root ganglionopathy, antibody-titre-not-a-response-marker point.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." Name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES
The three R1-flagged items are genuinely fixed. One new/previously-overlooked unlabelled
comparative claim remains in Section 2 (ectopic-hormone vs. immune-mediated-neuro tumor-
treatment-reliability comparison) — either delete it or append the same
"(general oncology standard, not from DeVita's section on this disease)" caveat used
throughout the rest of the file. Not a dose leak, not a drug/regimen error, not a safety
issue — a labelling gap only. Recommend one more small revise-and-relabel pass before this
is CLEAN for R1 re-review.
