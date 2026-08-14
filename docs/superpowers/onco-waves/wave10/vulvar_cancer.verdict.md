# Verdict: vulvar_cancer.md

## 1. DOSE LEAK
None. Grepped for mg, mg/m2, AUC, Gy, numbered schedules — zero hits. All numbers present are
survival/recurrence percentages (e.g. "90% to 50%", "20-30%"), tumor size cutoffs in cm (2 cm, 4 cm),
depth-of-invasion in mm (1 mm), a treatment-time interval in weeks (15 weeks), staging labels
(T2, T3/T4, PD-1, PD-(L)1), and the edition number (12th ed.) — none are drug doses, mg/m2,
AUC, or RT Gy figures, and none are numbered chemo cycles/schedules. DeVita's own text for this
chapter is full of specific RT Gy doses (e.g. 47.6 Gy, 56-59.9 Gy, GOG dose tables) and the sidecar
correctly omits all of them.

## 2. UNGROUNDED CLAIMS
None found. Cross-checked every specific claim against DeVita 12th ed. Ch. 49 (lines ~172751-173751
of devita.txt, "Carcinoma of the Vulva" section) including the "Molecular Factors and Treatment of
Metastatic Disease" subsection (~lines 173772-173808 / offset 1022-1057 of the extracted chapter):

- Epidemiology/pathology (VSCC = large majority of invasive vulvar cancers, HPV+/dVIN dichotomy,
  p53 and prognosis, hybrid FIGO staging, nodal status as dominant prognostic factor, 90%->50% OS
  drop) — verbatim-level match.
- VIN/HSIL management (excision preferred, unsuspected invasion in a meaningful minority of
  specimens, skinning vulvectomy, CO2 laser/argon beam, imiquimod first-line vs. 5-FU rarely used,
  recurrence ~20-30% and progression risk) — matches DeVita's HSIL treatment paragraph closely.
- Invasive local treatment (radical local excision for small/<2cm lesions, <1mm DOI managed with
  local excision alone, T2/≤4cm managed with WLE or modified radical vulvectomy via separate
  incisions, locally advanced disease with no consensus approach incl. exenteration vs. CRT,
  margin management, adjuvant RT risk factors, the >15-week treatment-time survival finding,
  10-year LR risk factors) — all directly traceable to DeVita's "Treatment of the Vulva" section.
- Nodal management (SLNB standard-of-care criteria: node-negative clinically/radiographically,
  unifocal <4cm, no prior altering surgery; sensitivity/NPV and morbidity reduction vs IFLND;
  bilateral SLNB / contralateral IFLND rules; ITC/micromet managed with nodal RT alone,
  macromets generally IFLND +/- adjuvant RT/CRT; adjuvant nodal RT indications — 2+ positive nodes,
  fixed/ulcerated node, ECE, high nodal ratio; single-node-without-ECE benefit "not settled";
  chemo-added-to-RT survival benefit in registry/NCDB data) — matches DeVita's regional-disease
  section (GROINSS-V I/II, AGO-CaRE-1, NCDB study) closely, including the framing as registry
  (not RCT) data.
- Chemoradiation for locoregionally advanced disease (bulky T2/T3/T4/fixed-ulcerated nodes
  definition, platinum + fluoropyrimidine or single radiosensitizing agent, preoperative vs.
  definitive choice individualized, cCR frequently tracking with pCR, IMRT preferred over
  conformal RT for sparing skin/bladder/rectum/bowel) — matches DeVita's CRT section and Table 49.5
  discussion (with all specific Gy/regimen numbers correctly stripped out).
- Recurrent/metastatic systemic therapy (platinum/taxane, cisplatin/vinorelbine, cisplatin/
  gemcitabine, or single-agent taxane; modest response rates; PD-1 checkpoint inhibitor —
  nivolumab/pembrolizumab — encouraging early results in HPV+ disease with emerging predictive
  biomarkers; EGFR inhibitors explored in small studies, relevant to HPV-negative EGFR-high
  disease, not an established standard; bevacizumab extrapolated from cervical cancer GOG 240,
  included in VSCC systemic options) — this is a near word-for-word match to DeVita's "Molecular
  Factors and Treatment of Metastatic Disease" subsection. The sidecar's own inline flag that the
  bevacizumab regimen is "general oncology standard, not from DeVita's section" is actually overly
  cautious/mislabeled — DeVita's vulvar chapter *does* state this extrapolation explicitly — but this
  under-claims grounding rather than fabricating it, so it is not a fabrication risk, just a minor
  citation-conservatism quirk worth noting to R1.
- Vulvovaginal melanoma (WLE +/- adjuvant RT standard, morbid surgery avoided given poor prognosis,
  SLNB role not established, KIT-mutated tumors candidates for KIT/MAPK-pathway therapy) — matches
  DeVita's VVM paragraph almost verbatim.
- Monitoring/follow-up section is explicitly and correctly self-flagged inline as general-oncology
  practice, not DeVita-sourced (DeVita's chapter has no surveillance-interval protocol) — honest
  labeling, not a fabrication.

No regimen, drug, trial, or statistic in the sidecar was found unsupported by the source text or in
conflict with it.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN — ready for R1.

Minor non-blocking note for R1: the bevacizumab bullet's inline disclaimer ("general oncology
standard, not from DeVita's section on this disease") is inaccurately scoped — the core claim
(bevacizumab extrapolated from cervical cancer GOG 240, included in VSCC systemic options) is
directly stated in DeVita's vulvar chapter; only the generic anti-VEGF side-effect list (bleeding/
hypertension/fistula) is the actual general-oncology add-on. Cosmetic wording issue only, does not
affect grounding or the dose-free rule.
