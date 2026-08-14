# Adversarial verification verdict: nodular_lymphocyte_predominant_hodgkin.md

## 1. DOSE LEAK
None. Grepped the sidecar for all digits (`grep -nE '[0-9]'`); every hit is a
non-dose numeral: CD20/CD79a/CD... antigen names, "anti-PD-1", "Chapter 66",
"12th ed." No mg, mg/m2, AUC, cycle count, or numbered schedule anywhere.

## 2. UNGROUNDED CLAIMS
None found that need flagging beyond what the sidecar already self-labels.
Spot-checks against DeVita 12th ed. Chapter 66 (Hodgkin Lymphoma):
- B-cell phenotype (CD19/CD20/CD79a/PAX5), "popcorn"/LP cell terminology,
  NLPHL originating from mature B cells unlike HRS cells — verbatim match at
  lines 263546-263745.
- Atypical spread pattern (solitary neck node, distant dissemination without
  contiguous nodal progression, "more closely resembles a low-grade B-cell
  lymphoma") — verbatim match at lines 264023-264032.
- T-cell/histiocyte-rich large B-cell lymphoma (T/HRBCL) as a related/mimic
  entity — present in DeVita's Table 66.2 legend (line 264056) and discussed
  elsewhere in the chapter (lines 266610-268577), not fabricated.
- Consolidation-radiotherapy principle ("used as consolidation after primary
  chemotherapy... CR to initial treatment does not appear to benefit...
  more PET-guided/intensive chemo -> less radiotherapy needed") matches
  DeVita's "Consolidation Radiotherapy" section for classical HL (lines
  ~264866-264886 relative offset, i.e. absolute ~263500+1366-1387). This is
  CHL-context text; the sidecar presents it as a DeVita-sourced general
  principle rather than an NLPHL-specific claim, which is an accurate
  representation, not an invented one.
- Long-term-toxicity-avoidance-as-a-goal principle matches DeVita's
  early-stage-HL overview ("avoidance of preventable long-term side
  effects").
Every claim that is NLPHL-treatment-specific (RT alone for localized,
observation after complete excision, anti-CD20 +/- chemo backbone for
advanced disease, transplant/chemoimmunotherapy for relapse, R-CHOP-style
management of transformation, follow-up/re-biopsy triggers, referral
criteria) is explicitly and consistently tagged inline as "(general
oncology standard, not from DeVita's section on this disease)" — this
matches reality, since DeVita's Ch.66 treatment sections (ABVD, BEACOPP,
brentuximab, checkpoint inhibitors, RT trials) are written for classical
HL, not NLPHL. No regimen acronym, drug dose, response rate, or survival
statistic is asserted for NLPHL anywhere in the sidecar — confirmed absent.
No fabrication detected.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN (ready for R1)

Notes for R1: the sidecar is conservative to a fault — it correctly declines
to name rituximab/BR/R-CVP-style regimens even though rituximab monotherapy
for NLPHL is uncontroversial guideline-standard knowledge, opting instead for
generic "anti-CD20 monoclonal antibody therapy." That's a safe (if slightly
vague) choice, not an error.
