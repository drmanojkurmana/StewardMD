# Adversarial verification verdict: serous_cystadenoma_ovary.md

## 1. DOSE LEAK
None. No mg, mg/m2, AUC, Gy, cycle count, or numbered drug schedule anywhere in the sidecar.
The only numeric clinical value present is "CA125 level greater than 200 U/mL" (ACOG/SGO
referral threshold, a lab cutoff, not a drug dose) — grep for dose-pattern numerics
(mg/mg-m2/AUC/Gy/units-IU/mL-min/q-interval/cycles/days) returns zero matches.

## 2. UNGROUNDED CLAIMS
None found that lack support. Spot-checked against DeVita (Chapter 52, Ovarian Cancer,
~lines 177530-178100 of devita.txt):
- WHO benign/borderline/malignant serous spectrum (Table 52.1) — confirmed verbatim (cystadenoma,
  SBOT, serous carcinoma tiers).
- CA125 expressed in ~75% of epithelial ovarian cancers, principally serous, not diagnostic alone,
  elevated in benign conditions — confirmed verbatim ("expressed in approximately 75% of cases...").
- CA125 "accepted uses" list, specifically "helping to determine whether a pelvic mass is
  malignant" — confirmed verbatim (5-item accepted-uses list in DeVita).
- Concerning sonographic/clinical features (bilateral disease, complex mass with solid areas,
  thick septations/mural nodules, persistent/enlarging complex mass premenopausal, complex mass
  any size postmenopausal, elevated tumor markers, symptomatic mass) — confirmed verbatim.
- ACOG/SGO 2002 referral criteria, premenopausal (CA125 >200 U/mL, ascites, abdominal/distant
  metastases, first-degree relative breast/ovarian cancer) and postmenopausal (any CA125
  elevation, ascites, nodularity/limited mobility, metastasis, family history) — confirmed
  verbatim, including the 200 U/mL cutoff.
- OVA1 (multivariate 5-biomarker index assay for adnexal-mass triage, not screening) — confirmed.
- ROMA (CA125 + HE4 combination for preoperative triage) — confirmed.
- BRCA1/2 mutation carriers: elevated rate of occult serous carcinoma at prophylactic
  (risk-reducing) surgery vs. non-carriers with strong family history — confirmed (GOG-0199:
  3.2% vs 0.5%).
- The sidecar's disclaimer that DeVita has no dedicated serous-cystadenoma management protocol,
  no surgical-technique comparison, and no surveillance-interval numbers is accurate — none of
  these exist in the chapter; the sidecar correctly labels all such statements "general oncology
  standard, not from DeVita."
- No drug regimen, trial name, or statistic was found asserted for the benign entity itself beyond
  what's listed above (all of which are DeVita-grounded, not invented).

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1).

Notes for R1: this is a benign-entity sidecar, correctly scoped as a triage/referral framework
rather than an oncologic-treatment protocol, since DeVita has no dedicated management section for
serous cystadenoma. Every DeVita-attributed claim checked against the source text matched
verbatim or near-verbatim (WHO classification, CA125 accepted-uses + 75% expression figure,
ACOG/SGO referral criteria incl. 200 U/mL threshold, OVA1, ROMA/HE4, GOG-0199 occult-carcinoma
rates). General-oncology-standard statements (surveillance intervals, surgical approach,
torsion/rupture emergency management) are explicitly and consistently flagged as non-DeVita
throughout, per the sourcing rule. No numeric dose, mg, mg/m2, AUC, or numbered schedule appears
anywhere in the document.
