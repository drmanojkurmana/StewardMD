# Verdict: immature_teratoma.md

1. DOSE LEAK: none. Grepped for mg/mg-m2/AUC/numbered-cycle/day-schedule patterns — zero hits in the sidecar.

2. UNGROUNDED CLAIMS: none. Every clinical claim traces to DeVita 12th ed. Ch. 52 (malignant ovarian GCT passage, lines ~78348-78570 and ~178370-178414 of devita.txt):
   - 5% of ovarian malignancies, median age late teens-early 20s, unilateral, exquisitely chemosensitive — matches text verbatim ("approximately 5%... median age of presentation between 19 and 21... almost always unilateral and are exquisitely chemosensitive").
   - Fertility-sparing surgery an option even with metastases — matches ("fertility-preserving surgery is always an option for this disease, even when metastases are present").
   - Norris grading based on neuroepithelial rosettes/immature neuroepithelial tissue — matches ("forms neuroepithelial rosettes that serve as the basis for the Norris grading system").
   - AFP + hCG markers — matches ("elaborates both alpha-fetoprotein and human chorionic gonadotropin").
   - Stage IA grade 1/2 observation exception — matches verbatim ("Except for FIGO surgical stage IA dysgerminoma and stage IA, grade 1 or 2 immature teratoma, patients... should be treated with adjuvant bleomycin-etoposide-cisplatin").
   - Adjuvant BEP for all other stages/grades, extrapolated from testicular GCT experience — matches ("Therapy for malignant germ cell tumors mirrors and has been extrapolated from the more common testicular germ cell cancer experience").
   - Excellent prognosis, return of menses, successful pregnancies — matches verbatim.
   - Growing teratoma syndrome and peritoneal/nodal implant grading — correctly flagged inline as "(general oncology standard, not from DeVita's section on this disease)"; verified these concepts do appear in DeVita but only in the testicular GCT chapter (RPLND passage, lines ~167550-167900), not the ovarian section, confirming the draft agent's tagging is accurate rather than a citation-laundering move.
   - No numeric survival statistics were imported (correctly omitted per the draft agent's own note).

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." (name only, no page numbers). Correct format.

4. VERDICT: CLEAN — ready for R1.
