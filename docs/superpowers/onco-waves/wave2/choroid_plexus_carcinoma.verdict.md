# Verdict: choroid_plexus_carcinoma.md

1. DOSE LEAK: none. Grepped for mg/mg-m2/AUC/Gy/cGy/numbered-schedule patterns and scanned every
   line containing a digit — the only digits in the file are "TP53" (gene name) and "12th" (edition
   number in the citation). No dose, no fractionation number, no schedule.

2. UNGROUNDED CLAIMS:
   - Moderate concern (not fabrication, but a grade-conflation): the "Residual, recurrent, or
     progressive disease" section states RT (fractionated EBRT/SRS) is used for CPC residual/recurrent
     disease "particularly after a subtotal resection, where poor local control has been observed
     without adjuvant treatment," and that "higher fractionated doses have correlated with better
     local control in reported series." In DeVita (12th ed, Ch. 64, "Radiation Therapy" subsection,
     refs 570-572), this specific evidence (41-patient retrospective review, "≥50 Gy" local-control
     correlation) is stated for choroid plexus **papilloma (CPP, grade I/II)** recurrence, not for
     carcinoma (CPC, grade III). Likewise "Repeat surgery is a reasonable option..." echoes DeVita's
     CPP-specific recurrence-options sentence. The sidecar imports this CPP-derived recurrence
     framework into a CPC-only document without flagging that the source evidence is grade-mismatched.
     Clinically reasonable extrapolation (same tumor family, same anatomic constraints), but as
     written it reads as CPC-specific evidence when DeVita's text backing it is CPP-specific.
   - Everything else checks out against DeVita Ch. 64 (CHOROID PLEXUS TUMORS, "Chemotherapy" and
     "Radiation Therapy" subsections): GTR vs STR outcome/location/vascularity rationale (matches
     "Radiation Therapy" intro), CSI vs whole-brain+tumor-bed PFS advantage (matches ref 573, numbers
     correctly omitted), chemo drug classes — platinum, alkylating agents, etoposide, methotrexate,
     possibly anthracyclines (verbatim match to text), "chemo not used for CPP but attempted for CPC"
     (verbatim), pooled/meta-analysis showing statistically better survival with chemo (matches Wrede
     et al., ref 575, with the n=104 correctly omitted), infant radiotherapy-deferral strategy (matches
     POG 8-infant study, number correctly omitted), SRS "including some grade III cases" (accurately
     hedged — source study had only 2/20 grade III), TP53/Li-Fraumeni association (matches ref 568).
   - "Consider referral... clinical trial enrollment" and general genetics-referral language are
     uncontroversial standard-of-care boilerplate, not attributed to DeVita as a specific claim.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed." Name only, no page numbers. Correct.

4. VERDICT: ISSUES (minor) — no dose leak, no invented drugs/trials/stats, citation correct, but the
   residual/recurrent-disease RT paragraph borrows CPP-specific (grade I/II) evidence and presents it
   under a CPC (grade III)-only document without a grade caveat. R1 should either add an explicit
   "this local-control/dose-fractionation data comes from CPP series, extrapolated to CPC" caveat, or
   soften the wording so it doesn't read as CPC-specific evidence.
