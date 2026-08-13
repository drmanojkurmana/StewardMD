# Adversarial verification verdict — Leiomyosarcoma sidecar

Checked against: DeVita, Hellman & Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed.
(`/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt`, Chapter 50 "Uterine Leiomyosarcoma"
subsection, ~lines 175677-176135, plus a spot-check of the general soft-tissue-sarcoma chapter and
Ch. 43 esophageal-cancer section for the extra-uterine/esophageal mentions).

## 1. DOSE LEAK
None. Grepped the sidecar for digits (`grep -n -E '[0-9]'`): the only hits are the "1" in "PD-1/PD-L1"
(line 28) and "12th ed." in the source line (line 41) — neither is a dose, AUC, mg/m2, or numbered
schedule. No response-rate/PFS/OS statistics, no drug doses anywhere in the body text. Clean.

## 2. UNGROUNDED CLAIMS
- **Line 23 — "topoisomerase-targeting or microtubule-targeting agents" as having "reported activity
  in pretreated leiomyosarcoma in the trials cited"**: NOT SUPPORTED as written. DeVita's actual
  LMS-specific evidence table (Table 50.7, "Advanced or Recurrent Uterine Leiomyosarcoma with Prior
  Systemic Therapy") lists only temozolomide, paclitaxel, gemcitabine, gemcitabine+docetaxel,
  sunitinib, and aflibercept. Topotecan (topoisomerase I inhibitor) and ixabepilone
  (microtubule/epothilone agent) appear only in the *adjacent* Table 50.6, which is explicitly headed
  "Selected Phase II and III Trials of Systemic Therapy in **Uterine Carcinosarcoma** with Prior
  Systemic Therapy" — a different histology/disease entity, not leiomyosarcoma. The sidecar has
  cross-attributed carcinosarcoma-trial agents to leiomyosarcoma. This is a real grounding error
  (table conflation), not a fabricated drug name, but it misstates what DeVita's LMS section actually
  supports and should be corrected or removed before R1.
- All other specific claims (surgery/BSO standard, no routine lymph node dissection, EORTC adjuvant
  RT trial finding no benefit, GOG-277 closing early, gemcitabine+docetaxel needing G-CSF support and
  pulmonary toxicity risk, GeDDiS doxorubicin-vs-gem/doc finding no difference across all endpoints,
  olaratumab/anti-PDGFR trial with uterine LMS patients showing no benefit, trabectedin vs dacarbazine
  superiority with a uLMS subgroup PFS benefit but similar RR/OS, pazopanib PALETTE PFS benefit over
  placebo across sarcoma subtypes, PR/ER expression and prognostic association, letrozole phase II
  trial with no objective responses but a PFS signal labeled hypothetical, nivolumab monotherapy trial
  with no LMS responders despite PD-1/PD-L1 expression, existence of a validated prognostic nomogram,
  0.5%→generalized "meaningful proportion," 10%→generalized lung-mets-at-diagnosis, morcellation FDA
  boxed-warning rationale) all check out against the DeVita text, correctly stripped of the underlying
  numbers.
- The extra-uterine/soft-tissue claims (wide excision as curative-intent standard, referral rationale,
  surveillance-imaging rationale) are honestly labeled "(general oncology standard, not from DeVita's
  section on this disease)" — appropriately hedged, not presented as DeVita-sourced.
- The esophageal-LMS mention (line 3) is actually grounded in DeVita (Ch. 43, "Leiomyosarcoma is the
  most common mesenchymal tumor that affects the esophagus... <1% of esophageal malignancies") even
  though the draft agent's report only credited Chapter 50 as its source — true claim, just from a
  chapter the draft agent didn't disclose using.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." — name only, no page numbers. Compliant.

## 4. VERDICT: ISSUES
- Fix/remove the line-23 claim attributing topotecan/ixabepilone ("topoisomerase-targeting or
  microtubule-targeting agents") activity data to leiomyosarcoma trials — in DeVita that evidence
  table (50.6) is for uterine carcinosarcoma, a different disease, not the leiomyosarcoma table
  (50.7). Either drop this clause or replace it with what Table 50.7 actually supports (sunitinib,
  temozolomide — already implicitly covered by "a menu of subsequent-line options exists").
- Everything else (dose-freedom, remaining clinical claims, hedging labels, citation format) is
  clean and ready for R1 once the above is fixed.
