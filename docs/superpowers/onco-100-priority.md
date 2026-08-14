# ONCQIS Protocol Library - 100 high-priority cancers (owner directive 2026-08-14)

Owner-prioritized build list. India-critical emphasis: **oral cavity is #2 by incidence (GLOBOCAN 2022), cervical #3 (127,526 new cases)**. "This should not be missed - no clinical wrong doses or info." Priority does NOT mean other cancers are dropped.

## Method (non-negotiable)
Every regimen is a StewardMD **Standard Protocol** (`kb/schema/standard-protocol.schema.json`), `status: DRAFT`, flags OFF, staged in `docs/superpowers/onco-protocols-v2/`. Pipeline: **grounded draft (DeVita 12th ed / Harrison 22nd ed / owner-licensed Standard Guidelines = NCCN PDFs) -> adversarial dose-verify -> R1 clinical gate -> stage only R1-approved.** Doses come ONLY from a cited source; anything unsourced is the literal `VERIFY` (never invented). Subtypes are served by biomarker/stage/setting tagging on shared regimens, not duplicated. No NCCN endorsement claim; PDFs never committed.

Sources on hand: `devita.txt` (16MB), `harrison.txt` (29MB), 69 NCCN PDFs (job tmp, not committed).

## Status legend
`pending` -> `drafting` -> `verify` -> `R1` -> `staged` (R1-approved DRAFT) -> `promoted` (owner+hospital+human gate; not autonomous)

## A. Breast (1-6)  [batch 1 - STAGED (R1-approved DRAFT), 2026-08-14]
20 regimens staged, biomarker/stage-tagged to serve all 6 subtypes. Doses grounded to Standard Guidelines (NCCN Breast v6.2026) for chemo/antibody + DeVita 12th ed for endocrine/T-DM1; zero VERIFY. Two adversarial dose-verifiers = zero wrong / zero unsourced (incl. the T-DXd gastric-6.4 vs breast-5.4 trap, correctly excluded). R1 clinical = APPROVE all 20.
- Curative/adjuvant chemo (IDC/ILC #1/#2 + TNBC #3, not biomarker-restricted): breast-ac, breast-ddac-t, breast-tc, breast-tac, breast-cmf
- Endocrine (HR+ #5): breast-tamoxifen, breast-anastrozole, breast-letrozole, breast-exemestane, breast-fulvestrant
- HER2-directed (#4): breast-tch, breast-tchp, breast-ac-th, breast-paclitaxel-trastuzumab, breast-tdm1, breast-tdxd
- HR+/HER2- + metastatic/targeted (TNBC #3): breast-cdk46-ai, breast-capecitabine, breast-carbo-paclitaxel, breast-pembro-chemo-tnbc
Pre-activation gates (R1 IMPORTANT, NOT staging blockers): v1 engine enforces the anthracycline cumulative cap as warning-only; BID (capecitabine/abemaciclib) + multi-phase sequencing (ddac-t/ac-th/pembro-tnbc, "trastuzumab never with anthracycline") live in drug notes, not structured frequency/phase fields - any administration/scheduling layer must honor them before activation.

## B. Lung & thoracic (7-13)
7. NSCLC adenocarcinoma · 8. NSCLC squamous · 9. NSCLC large-cell/other · 10. EGFR-mutated NSCLC · 11. ALK-positive NSCLC · 12. Small-cell lung cancer · 13. Malignant pleural mesothelioma - pending

## C. GI (14-31)
14. Colon [have: FOLFOX/FOLFIRI family, DRAFT] · 15. Rectal · 16. Anal · 17. Gastric adenoca · 18. GEJ · 19. Esophageal SCC · 20. Esophageal adenoca · 21. Pancreatic [have: FOLFIRINOX, DRAFT] · 22. HCC · 23. Intrahepatic cholangio · 24. Extrahepatic cholangio · 25. Gallbladder · 26. Ampullary · 27. Small-intestinal adenoca · 28. Appendiceal adenoca · 29. GIST · 30. GI-NET · 31. CRC MSI-H/dMMR - mostly pending

## D. Head & neck (32-41)  [India priority - oral cavity #2]
32. Oral cavity SCC · 33. Tongue · 34. Lip · 35. Oropharyngeal · 36. HPV+ oropharyngeal · 37. Nasopharyngeal · 38. Hypopharyngeal · 39. Laryngeal · 40. Salivary gland · 41. Sinonasal - pending

## E. Gynecologic (42-51)  [India priority - cervical #3]
42. Cervical · 43. Endometrial · 44. Ovarian epithelial · 45. HGSOC · 46. Fallopian tube · 47. Primary peritoneal · 48. Vulvar · 49. Vaginal · 50. GTN · 51. Uterine sarcoma - pending

## F. Genitourinary (52-62)
52. Prostate · 53. mCSPC · 54. mCRPC · 55. RCC · 56. ccRCC · 57. Urothelial bladder · 58. Upper-tract urothelial · 59. Testicular GCT · 60. Seminoma · 61. NSGCT · 62. Penile - pending

## G. CNS (63-69)
63. Glioblastoma · 64. Diffuse astrocytic glioma · 65. Oligodendroglioma · 66. Ependymoma · 67. Medulloblastoma · 68. Primary CNS lymphoma · 69. Brain metastases - pending

## H. Hematologic (70-88)
70. AML [have: 7+3 induction, HiDAC/IDAC consolidation, DRAFT] · 71. ALL · 72. CML · 73. CLL · 74. Hodgkin · 75. DLBCL [have: R-CHOP] · 76. Follicular · 77. Mantle-cell · 78. Marginal-zone · 79. Burkitt · 80. PTCL · 81. ALCL · 82. Multiple myeloma · 83. Smoldering myeloma · 84. MDS · 85. MPN · 86. Polycythemia vera · 87. Essential thrombocythemia · 88. Primary myelofibrosis - mostly pending

## I. Melanoma & skin (89-92)
89. Cutaneous melanoma · 90. Merkel cell · 91. Basal-cell · 92. Cutaneous SCC - pending

## J. Endocrine/thyroid (93-96)
93. Papillary thyroid · 94. Follicular thyroid · 95. Medullary thyroid · 96. Anaplastic thyroid - pending

## K. Sarcoma & rare-critical (97-100)
97. Soft-tissue sarcoma · 98. Osteosarcoma · 99. Ewing sarcoma · 100. Kaposi sarcoma - pending
