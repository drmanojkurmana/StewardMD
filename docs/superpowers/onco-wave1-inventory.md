# ONCQIS Wave-1 Protocol Inventory

Source: all 15 re-mapped Standard Protocol JSONs in `docs/superpowers/onco-protocols-v2/*.json`,
cross-checked against the DeVita/Harrison discovery candidate list at
`/Users/diwakarkumar/.claude/jobs/142278a7/tmp/regimen-candidates.json`. All 15 protocols are
`status: DRAFT`, `clinicalApprovalStatus: null`, `evidence.guideline: []` — none has an NCCN/guideline
layer or hospital sign-off yet. "Dose-completeness" = whether every drug's dose/unit/day-list and the
cycle length/count are concrete numbers (no `VERIFY`); "Indication/eligibility completeness" = count of
fields listed in the protocol's own `verifyFields[]` (histology, stage, biomarkers, treatmentSetting,
treatmentIntent, lineOfTherapy, eligibilityCriteria, and occasionally a dosing field) — lower is more
complete.

| disease | diseaseId | protocol | source (core evidence) | dose-completeness | indication/eligibility completeness | guideline status | clinical status | notes |
|---|---|---|---|---|---|---|---|---|
| Colorectal cancer | colorectal_cancer | Modified FOLFOX-6 | DeVita 12th ed. (Wolmark 2009) | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Most widely used current CRC backbone (mFOLFOX6); best frequency/completeness combination in the set. |
| Colorectal cancer | colorectal_cancer | FOLFOX-6 (Tournigand) | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Predecessor of mFOLFOX6, still in wide use. |
| Colorectal cancer | colorectal_cancer | FOLFIRI (Douillard) | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Standard irinotecan-based CRC backbone, high frequency. |
| Pancreatic cancer | pancreatic_cancer | FOLFIRINOX (PRODIGE 4/ACCORD 11) | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Standard first-line regimen for fit metastatic/locally-advanced pancreatic cancer patients; high frequency in that population. |
| Colorectal cancer | colorectal_cancer | FOLFOX-4 (de Gramont) | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Original FOLFOX schedule; largely superseded by FOLFOX-6/mFOLFOX6 but still cited/used. |
| Colorectal cancer | colorectal_cancer | LV5FU2 (de Gramont) | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Fluoropyrimidine backbone (no oxaliplatin/irinotecan); used standalone or as maintenance/bevacizumab partner. |
| Colorectal cancer | colorectal_cancer | Simplified LV5FU2 | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Practical 1-day variant of LV5FU2; moderate frequency. |
| Colorectal cancer | colorectal_cancer | FOLFIRI (simplified, Andre) | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Single-day-visit FOLFIRI variant; used but less often cited than classic FOLFIRI. |
| Colorectal cancer | colorectal_cancer | Roswell Park (weekly bolus 5-FU/LV) | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | Older weekly bolus regimen; still used in some settings but lower current frequency than infusional regimens. |
| Colorectal cancer | colorectal_cancer | FUFOX (Grothey weekly) | DeVita 12th ed. | All doses concrete | 5 VERIFY fields (best eligibility completeness in the set) | none yet | DRAFT | German weekly oxaliplatin regimen; niche/low current frequency outside that trial tradition. |
| Colorectal cancer | colorectal_cancer | FUFIRI (Douillard weekly) | DeVita 12th ed. | All doses concrete | 6 VERIFY fields | none yet | DRAFT | German weekly irinotecan regimen; niche/low current frequency. |
| Colorectal cancer | colorectal_cancer | AIO (weekly 24-hr infusion 5-FU/LV) | DeVita 12th ed. | All doses concrete | 7 VERIFY fields (worst eligibility completeness of the fully-dose-verified group) | none yet | DRAFT | Largely historical German weekly infusional regimen; low current frequency. |
| Acute myeloid leukemia | acute_myeloid_leukemia | 7+3 (cytarabine + anthracycline induction) | Harrison 22nd ed. | Per-drug doses concrete (100/60/12 mg/m2), but `cycleLengthDays`/`cycles` = VERIFY; daunorubicin vs idarubicin also printed only as a range/either-or choice | 7 VERIFY fields (incl. 2 dosing fields) | none yet | DRAFT | Standard AML induction backbone — high clinical frequency — but NOT fully dose-verified: induction duration/cycle count not printed in source. |
| Acute promyelocytic leukemia | acute_myeloid_leukemia | ATRA + ATO (low-risk APL) | Harrison 22nd ed. | Per-drug doses concrete (45 mg/m2, 0.15 mg/kg) but `days[]` empty and `cycleLengthDays`/`cycles` = VERIFY (source gives no fixed duration) | 6 VERIFY fields (incl. 2 dosing fields) | none yet | DRAFT | Standard low-risk APL induction — high clinical frequency for APL — but NOT fully dose-verified: total induction duration unresolved. |
| Acute myeloid leukemia | acute_myeloid_leukemia | HiDAC/IDAC consolidation | Harrison 22nd ed. | Per-drug doses concrete (3000/1500 mg/m2) but two alternate dosing strategies (HiDAC vs IDAC) are not disambiguated to one selected value, and `cycles` is a printed range ("2-4"), not a single number | 5 VERIFY fields | none yet | DRAFT | Standard AML postremission consolidation — high clinical frequency — but dose selection is not deterministic (physician chooses HiDAC/IDAC, and IDAC dose itself spans a 1-1.5 g/m2 range). |

## Proposed Wave 1

Ranking basis: only protocols with **zero VERIFY anywhere in the dosing path** (drug dose/unit/days,
cycle length, cycle count) qualify as "fully dose-verified." Within that set, rank by
indication/eligibility completeness (fewer VERIFY fields first) and clinical frequency (how often the
regimen is actually prescribed today, not just historically named). That produces a clear top tier of
high-frequency, guideline-mainstay CRC/pancreatic regimens, all tied at 6 VERIFY eligibility fields:

- **modified-folfox-6** (Modified FOLFOX-6) — colorectal_cancer
- **folfox-6** (FOLFOX-6, Tournigand) — colorectal_cancer
- **folfiri** (FOLFIRI, Douillard) — colorectal_cancer
- **folfirinox** (FOLFIRINOX) — pancreatic_cancer
- **folfox-4** (FOLFOX-4, de Gramont) — colorectal_cancer
- **lv5fu2-de-gramont** (LV5FU2) — colorectal_cancer
- **simplified-lv5fu2** (Simplified LV5FU2) — colorectal_cancer

These 7 are the fully dose-verified, highest-frequency subset and are the candidates for first
promotion — pending owner, R1 clinical review, and hospital sign-off (none of that has happened yet;
`status` stays `DRAFT` / `clinicalApprovalStatus: null` until it does).

Not included but also fully dose-verified (lower current clinical frequency / more niche regimens —
folfiri-simplified, roswell-park, fufox, fufiri, aio-weekly-24h): keep as later-wave candidates, no
sourcing work needed, just lower priority given they're used less often than the mainstream CRC/pancreatic
backbones above.

## Needs sourcing before Wave 1

Heavy-VERIFY / not fully dose-verified — these are clinically high-frequency (AML/APL are standard-of-care
regimens) but the dosing path itself has unresolved gaps that must be sourced (institutional order set or
NCCN template) before they can be considered dose-complete, on top of the still-open eligibility VERIFY
fields shared by every protocol in this inventory:

- **aml-7-plus-3-induction** — cycle length/count not printed in Harrison; daunorubicin vs idarubicin and dose (60 vs up to 90 mg/m2) only given as a range/either-or.
- **apl-atra-ato** — total induction duration and per-drug `days[]` not printed in Harrison (dosed "continuously per day" with no fixed schedule).
- **aml-hidac-idac-consolidation** — HiDAC vs IDAC is a physician choice, IDAC dose itself spans a 1-1.5 g/m2 range, and `cycles` is a range ("2-4") rather than a single value.

All three also need an NCCN per-disease chemotherapy order template pass (their `evidence.guideline` is
empty like every other protocol here) before any promotion.
