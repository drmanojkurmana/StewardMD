# Verdict: penile_cancer.md (Wave 8) — adversarial re-verification

## 1. DOSE LEAK
None. Grepped for `mg`, `mg/m2`, `AUC`, `Gy`, numbered cycle counts — zero hits. Bare numbers present:
- "95 percent" SCC prevalence (line 4) — matches DeVita "More than 95% of penile cancers are SCC."
- "2-cm proximal margin" (line 17) — surgical margin, matches DeVita "traditionally with a 2-cm margin."
- "12 to 18 months" relapse window (lines 19, 55) — matches DeVita verbatim: "Most relapses occur within the first 12 to 18 months."
- "five years" late-recurrence window (line 56) — matches DeVita "18% of recurrences occurred after 5 years."
- Stage labels (T1-T4, cN0-cN3, pN0-pN3) — staging nomenclature, not dosing.
None of these are drug doses, mg/m2, AUC, or cycle counts. Clean.

## 2. UNGROUNDED / MISLABELLED CLAIMS
The single blocking item from the prior (R1 + adversarial) pass is fixed:

- **Line 43, chemotherapy-guideline claim** — previously stated a national-consensus-vs-EAU
  "disagreement" on adjuvant chemo, which DeVita does not support (DeVita: national consensus
  *and* EAU agree on chemo for pN2-3). The rewrite now states exactly what DeVita says: national
  consensus and European guidance agree on adjuvant chemo for pN2-3, and the actual controversy is
  reattributed to individual retrospective series questioning benefit in more limited nodal disease
  (pN0-N2) — this matches DeVita's 743-patient retrospective series finding "little or no benefit
  ... in men with limited disease (N0-N2)" while national consensus + EAU still recommend chemo for
  pN2-3. The guideline-body split (national consensus recommends, EAU does not) remains correctly
  scoped to adjuvant RT only, at line 45, which DeVita supports verbatim. No cross-contamination
  between the two paragraphs remains.

Re-checked everything else on this pass, nothing new found:
- TIP (platinum/taxane/ifosfamide) trial description — matches DeVita's 30-pt cN2/3 study (ORR 50%,
  CR 10%, median OS 17.1 mo), described qualitatively with no numbers leaked.
- TPF (platinum/taxane/fluoropyrimidine) adjuvant use — matches DeVita's 21-pt retrospective series.
- cN0 risk stratification, DSNB + inguinal-ultrasound detection improvement, modified vs. complete
  ILND, bilateral-vs-unilateral dissection logic, ENE/>2-node -> pelvic LND + adjuvant therapy,
  surgery-superior-to-RT-for-nodal-control rationale — all match DeVita's text closely.
- Verrucous carcinoma RT-avoidance rationale, T1-T3 margin/grade rationale, metastatic prognosis and
  second-line chemo toxicity/EGFR-inhibitor statements ("another anti-EGFR antibody" = cetuximab,
  distinct from the dacomitinib trial) — all grounded.
- PD-L1/checkpoint-inhibitor claim (line 52): the "48%"-equivalent characterization ("substantial
  minority... particularly HPV-negative") is in fact directly from DeVita's section (DeVita: "PD-L1
  is expressed in 48% of histologically examined penile cancers, predominantly in those negative for
  high-risk HPV infection"). The attached "(general oncology standard, not from DeVita's section on
  this disease...)" label is over-broad — it hedges the PD-L1/HPV-negative fact along with the
  generic "active investigational area across squamous cancers" clause, when only the latter clause
  actually needs the hedge. This is a labeling nit (over-cautious, not a fabrication or
  misattribution) and does not block.
- Line 55's hedge label is correctly scoped: DeVita gives the 12-18-month recurrence-timing fact but
  not an explicit follow-up-interval/schedule recommendation, so labeling that specific inference as
  general-oncology-standard is appropriate.

No claim remains mis-attributed to DeVita.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN (ready for R1 re-review)

The one blocking item (chemo guideline-consensus misattribution) is fixed and now matches DeVita's
actual text. No dose leak. No remaining fabricated or mis-attributed regimen/trial/statistic.
Citation correctly formatted. One trivial, non-blocking labeling nit noted above (line 52's hedge
is broader than strictly necessary) — cosmetic only, does not warrant another revision cycle.
