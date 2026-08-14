# Verdict: sdh_deficient_gist.md

1. DOSE LEAK: none. Grepped the sidecar for digits — the only numeric token in the whole file is
   "12th ed." in the citation line. No mg, mg/m2, AUC, cycle counts, or schedule numbers anywhere
   (notably the sidecar correctly omits DeVita's own dosing detail from this chapter — e.g. imatinib
   400 mg standard / 800 mg for exon 9, 3-year adjuvant duration, 6-12 month neoadjuvant window —
   none of which leaked in).

2. UNGROUNDED CLAIMS: none material found. Spot-checked against DeVita Ch.39 (GIST), lines
   ~117455-117530, 117660-117730, 118140-118330:
   - Young girls/women, gastric, multifocal, lymph-node mets, indolent course → matches text almost
     verbatim ("tend to arise in children and young adults of the female sex, are gastric and
     multifocal, can metastasize to lymph nodes... indolent evolution").
   - SDHB-negative IHC as the diagnostic marker → matches ("negative stain for SDHB identifies the
     subgroup of SDH-deficient GISTs").
   - Wedge/segmental resection as primary, extensive resection only when needed, no routine
     lymphadenectomy → matches directly.
   - Not selected for adjuvant TKI therapy → matches near-verbatim ("these patients are not
     currently selected for any adjuvant treatment").
   - Sunitinib/regorafenib "some activity" in SDH-deficient GIST specifically → matches directly
     ("Sunitinib and regorafenib are alternative options because they were shown to have some
     activity in SDH-deficient GISTs").
   - Carney triad (SDHC promoter hypermethylation) and Carney-Stratakis (germline SDH, AD) →
     matches directly, correct attribution of which syndrome links to which mechanism.
   - Annual whole-body MRI for paraganglioma risk in all SDH-deficient patients → matches directly
     ("could justify annual whole-body magnetic resonance imaging").
   - PET can show TKI response within weeks → matches directly, and the sidecar correctly labels
     this as extrapolated general-GIST monitoring rather than SDH-specific.
   - Minor non-fabricated extrapolations, appropriately hedged as general oncology standard rather
     than DeVita-sourced (radiotherapy has no role, sarcoma MDT referral, cascade testing of
     relatives) — these are flagged inline by the draft itself as "not from DeVita's section," which
     is honest labeling, not fabrication.
   - The "observation or staged, judicious surgery for individual metastatic lesions" framing blends
     two adjacent DeVita passages (delayed-imatinib-via-resection-of-oligometastases, and
     judicious-surgery-given-indolent-course-of-syndromic-GIST) — a reasonable synthesis, not an
     invented claim.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed." Name only, no page numbers. Correct.

4. VERDICT: CLEAN (ready for R1).
