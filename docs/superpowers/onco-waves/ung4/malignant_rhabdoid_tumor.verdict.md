# Adversarial verification verdict — malignant_rhabdoid_tumor.md

1. DOSE LEAK: none. Digit-by-digit scan of the sidecar finds only digits embedded in gene/marker
   names (SMARCB1, SMARCA4, EZH2, INI1, INI-1) and the citation's "12th ed." No mg, mg/m2, AUC,
   cycle number, or numbered schedule anywhere in the file.

2. UNGROUNDED CLAIMS: none that are both specific AND unsupported. The sidecar is unusually
   disciplined — every sentence that isn't the one DeVita-sourced fact is explicitly tagged inline
   "(general oncology standard, not from DeVita's section on this disease)," and all of those tagged
   claims (multimodality Rx with curative intent, surgery+chemo+RT for localised disease, intensified
   therapy for metastatic/CNS-involved disease, RT-timing caution in infants, high-dose chemo +
   autologous stem-cell rescue for high-risk/relapsed disease, clinical-trial referral, staging/
   surveillance imaging of primary+chest+neuraxis, germline SMARCB1/SMARCA4 testing for rhabdoid
   tumour predisposition syndrome, long-term neurodevelopmental/endocrine follow-up) are
   uncontroversial, well-established pediatric-oncology standard-of-care statements, not invented
   regimens/trials/statistics. No named chemo agents, no regimen acronyms, no survival/response
   percentages, no trial names beyond the one EZH2-inhibitor class mention.

   Verified the one DeVita-grounded claim directly: devita.txt line 221213 (chordoma chapter,
   SMARCB1-deficient neoplasm discussion) states "EZH2-targeting agents are used in clinical trials
   in SMARCB1-deficient neoplasms that include malignant rhabdoid tumor, epithelioid sarcoma, and
   poorly differentiated chordoma (Clinicaltrials.gov NCT02601937 and NCT02601950)." The sidecar's
   paraphrase is accurate and appropriately conservative (correctly omits the NCT identifiers, which
   the sidecar wasn't asked to include and which risk misread as an endorsement).

   Confirmed by independent grep that DeVita has no dedicated management section for malignant
   rhabdoid tumour / AT/RT: only 5 case-insensitive hits for "rhabdoid tumor(s)" / "atypical teratoid"
   in the whole text (lines 212075, 221213, 241040, 241895, 241919), all incidental mentions
   (differential-diagnosis lists, pediatric CNS-tumor overview naming AT/RT among embryonal tumors),
   none a treatment/management discussion. The sidecar's "Content gaps" section accurately reflects
   this.

3. CITATION: present — final line reads "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles
   & Practice of Oncology, 12th ed." Name only, no page numbers. Correct format.

4. VERDICT: CLEAN (ready for R1).
