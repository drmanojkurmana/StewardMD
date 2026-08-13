# Verdict: sertoli_cell_tumour.md

1. DOSE LEAK: none. Only numeric token in the file is "12th" (ed.) in the citation line; the one clinical number present, "five centimetres" / "greater than five centimetres" (tumor size threshold), is a pathology cutoff copied verbatim from DeVita's risk-factor list, not a dose/mg/AUC/schedule.

2. UNGROUNDED CLAIMS: none found that are left unlabeled. Every claim not directly in DeVita's "Leydig and Sertoli Cell Tumors" passage (devita.txt lines ~168187-168202) is explicitly tagged inline as "general oncology standard, not from DeVita's section on this disease" or similarly flagged:
   - Testis-sparing surgery as an alternative to orchiectomy (labeled).
   - Staging imaging (retroperitoneum/chest/abdomen) for adverse-feature or malignant cases (labeled).
   - RPLND-as-mainstay-for-nodal/oligometastatic-disease claim, built by explicit analogy to DeVita's adjacent Leydig cell tumor and adenocarcinoma-of-rete-testis passages — verified: DeVita (line ~168242-168246) does state adenocarcinoma of the rete testis is unresponsive to radiotherapy/chemotherapy and that RPLND is curative for selected low-volume metastatic disease, so the analogy is accurately drawn and correctly caveated as extrapolation, not fabricated.
   - Carney complex / Peutz-Jeghers association with large-cell calcifying subtype (labeled; confirmed NOT in DeVita's Sertoli section via grep — correctly flagged as outside-DeVita).
   - Hormone monitoring after orchiectomy, and surveillance cadence/imaging choice (both labeled).
   - Explicit refusal to invent a chemotherapy regimen for malignant Sertoli cell tumor, with reasoning given ("extrapolating a chemotherapy regimen from germ cell tumour protocols would not be grounded and is therefore omitted") — this is the correct behavior, not a gap.
   No claim was found stated as DeVita-sourced fact that isn't actually supported by the cited passage.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. Compliant.

4. VERDICT: CLEAN (ready for R1).

Spot-check notes: grepped devita.txt for "Sertoli" (single hit passage, lines 168187-168202) and for "rete testis" / "Carney" / "Peutz" to verify the two extrapolation claims and confirm the Carney/Peutz-Jeghers claim is correctly flagged as non-DeVita. All grounded bullets (radical orchiectomy as treatment, the 9-item metastatic-risk-factor list, retroperitoneal-first metastatic pattern, hormone hypersecretion + precocious puberty in boys) match DeVita's text closely, including phrasing. No dose numbers, no invented regimen, no invented trial/statistic anywhere in the file.
