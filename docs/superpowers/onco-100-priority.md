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

## B. Lung & thoracic (7-13)  [batch 4 - STAGED (R1-approved DRAFT) b2e3c08b]
18 regimens (lung-*/sclc-*/meso-*), serve #7-13 via histology/biomarker tags. 2 dose-verifiers + R1 = zero wrong doses; the verify layer caught + fixed a fabricated topotecan narrative. 17 fully-grounded; VERIFY-bearing: lung-egfr-tki-earlygen (afatinib dose not in corpus). Covers NSCLC platinum doublets + KEYNOTE-189/407 + pembro-mono + durvalumab-PACIFIC, EGFR TKIs (osimertinib/erlotinib/gefitinib), ALK TKIs (alectinib/brigatinib/lorlatinib/crizotinib), SCLC platinum/etoposide + atezo/durva + topotecan, meso cis/pemetrexed + nivo/ipi.

## C. GI (14-31)  [batch 5 - STAGED (R1-approved DRAFT) d6b4af1c; colon/rectal/pancreatic backbones from Wave-1]
27 gi-* regimens, serve #14-31. 3 dose-verifiers + R1 = zero wrong doses. 17 fully-grounded, 10 VERIFY-bearing (NCCN HCC/biliary print no dose tables; IO/TKI doses honest VERIFY, refused to cross-import cytotoxic doses). Covers gastric/GEJ/eso (FLOT/CAPOX/FOLFOX/ToGA/KEYNOTE-859/CROSS/adj-nivo), hepatobiliary (sorafenib/tremelimumab/gem-cis/ampullary), GIST TKIs, NET (SSA/everolimus/Lu-177/CAPTEM), anal (Nigro/carbo-pac), CRC-MSI pembro. Safety fixes: sorafenib albumin guard mg/dL->g/dL; Lu-177 mCi unit (schema enum extended). Pre-ACTIVE: gi-net-ssa either/or, hepatobiliary IO cross-source closures.

## D. Head & neck (32-41)  [India priority - oral cavity #2]  [batch 2 - STAGED (R1-approved DRAFT) 5063a555]
14 regimens (hn-*), serve sites #32-41 via site/HPV/setting tags. 2 dose-verifiers + R1 = zero wrong doses. Fully grounded: cisplatin-rt, cisplatin-weekly-rt, pf, cetuximab-rt, extreme, pembro-mono, nivolumab, cetuximab. VERIFY-bearing (NCCN H&N prints no dose tables): tpf-induction, npc-gem-cisplatin, npc-chemort(adjuvant), carbo-5fu(days), pembro-chemo(cycles), salivary(all doses).

## E. Gynecologic (42-51)  [India priority - cervical #3]  [batch 3 - STAGED (R1-approved DRAFT) 8cc168c3]
17 regimens (gyn-*), serve #42-51. 2 dose-verifiers + R1 = zero wrong doses. Fully grounded (10): carbo-paclitaxel, dose-dense-paclitaxel, carbo-paclitaxel-bev, olaparib-maint, niraparib-maint, endometrial-carbo-paclitaxel, uterine-lms-doxorubicin, uterine-lms-gem-docetaxel, gtn-methotrexate, gtn-emaco (GTN fully per-day dosed, vinCRIStine 2mg cap). VERIFY-bearing (7): cervical-cisplatin-rt(cycles), cervical-pac-cis-bev(GOG-240 doses), cervical-pembro-chemo(backbone), vulvar/vaginal-cisplatin-rt(cisplatin dose), endometrial-pembro-lenvatinib(lenvatinib), endometrial-io-dmmr(dostarlimab).

## F. Genitourinary (52-62)  [batch 6 - STAGED (R1-approved DRAFT) b093e9ab]
30 gu-* regimens, serve #52-62. 3 dose-verifiers + R1 = zero wrong doses (the 3 lethal-trap doses - nivo/ipi ratio, cabo & lenvatinib mono-vs-combo - all correct). 22 fully-grounded, 8 VERIFY-bearing (axitinib/CLEAR-lenvatinib/9ER-cabo/erdafitinib/carbo-AUC combo-specific; radium schema-gap kBq/kg; penile 5FU cycles). Prostate (ADT/mCSPC/mCRPC incl radium-223 + Lu-177-PSMA + olaparib), RCC clear-cell TKI+IO, urothelial (gem-cis/ddMVAC/avelumab/EV/erdafitinib), testicular BEP/EP/VIP + seminoma, penile TIP.

## G. CNS (63-69)
63. Glioblastoma · 64. Diffuse astrocytic glioma · 65. Oligodendroglioma · 66. Ependymoma · 67. Medulloblastoma · 68. Primary CNS lymphoma · 69. Brain metastases - pending

## H. Hematologic (70-88)  [batch 7 - STAGED (R1-approved DRAFT) c06c6e92; + existing 7+3/HiDAC/ATRA-ATO/R-CHOP]
31 heme-* regimens, serve #70,72-88. 3 dose-verifiers + R1 = zero wrong doses; 7 fully-grounded, 24 VERIFY-bearing. Key safety catch: venetoclax flat-400 would be fatal-TLS if promoted -> dose VERIFY-gated (ramp not yet structurally encodable). CHOP backbone closed via rchop.json for Pola-R-CHP/CHOEP/BV-CHP. #71 ALL was missed in the fan-out (no adult-ALL NCCN PDF; grounds from DeVita/Harrison) - being added separately (hyper-CVAD / Ph+ TKI / blinatumomab / inotuzumab).

## I. Melanoma & skin (89-92)
89. Cutaneous melanoma · 90. Merkel cell · 91. Basal-cell · 92. Cutaneous SCC - pending

## J. Endocrine/thyroid (93-96)
93. Papillary thyroid · 94. Follicular thyroid · 95. Medullary thyroid · 96. Anaplastic thyroid - pending

## K. Sarcoma & rare-critical (97-100)
97. Soft-tissue sarcoma · 98. Osteosarcoma · 99. Ewing sarcoma · 100. Kaposi sarcoma - pending

## BEYOND-100 (owner: "do everything")
- **Batch 9 - adult rare (22, STAGED b71aecd1):** Waldenstrom, hairy-cell, Castleman, AL-amyloidosis, MLNe, systemic mastocytosis, histiocytic (LCH/ECD), thymic, uveal melanoma, DFSP, peritoneal-meso, occult primary. 3 dose-verifiers + R1 = zero wrong doses; cross-indication traps avoided (SM/AML, histiocytic/melanoma, HIPEC).
- **Batch 10 - pediatric (8, STAGED 852cc5cf):** neuroblastoma, Wilms, rhabdomyosarcoma, ALL, B-cell(COPADM), Hodgkin(ABVE-PC), medulloblastoma, LGG. Weight/BSA + COG-specific -> mostly VERIFY; neuroblastoma/COPADM/ABVE-PC grounded. dose-verify + R1 = zero wrong doses; pediatric anthracycline cap 350, ped-b-cell scoped Group B (Group-C needs HD-MTX 8g/m2 escalation), bleomycin d8 split.
Total library: 230 Standard Protocol DRAFTs. Schema extended: mcg unit + liposomal-doxorubicin cap exemption. All flags OFF; nothing ACTIVE.
