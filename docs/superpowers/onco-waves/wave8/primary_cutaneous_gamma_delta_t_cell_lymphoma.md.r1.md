# R1 Clinical-Safety Review — primary_cutaneous_gamma_delta_t_cell_lymphoma

VERDICT: APPROVE

Goldens changed: no (intended: n/a — reference-content narrative, not engine/rule logic).
Adversarial verdict file (.verdict.md): NOT PRESENT — no prior flagged issues to reconcile.

## 1. Safety
No unsafe, misleading, or harmful directive. The narrative correctly frames PCGD-TCL as an
aggressive, disseminated systemic disease and explicitly warns against relying on skin-directed
measures alone (lines 6, 9, 20). Prognostic honesty (poor outcome, ~15-month median) is stated as
expectation-setting, not as a self-fulfilling limit of care. HLH is flagged as a red-flag
complication with concrete triggers (high fever, cytopenias, elevated ferritin) prompting prompt
evaluation (line 23) — a safety-positive addition. No absolute/definitive claim that oversteps
decision-support.

## 2. Grounding
DeVita-attributed claims are consistent with the cutaneous T-cell lymphoma section of DeVita PPO
and are correctly scoped: disseminated/mucosal/extranodal pattern, HLH association, histopathology
(dermis/epidermis/fat involvement, adipocyte rimming, angioinvasion), the alpha/beta SPTCL
contrast (~80% 5-yr survival, steroids/single-agent/RT), the ~15-month median in a 33-patient
series, and the allo-/auto-HSCT series figures (10 PCGD-TCL + 4 SPTCL; 7 allo, 4/57% alive; 2 auto).
Crucially, every claim NOT in DeVita's PCGD-TCL passage is explicitly relabelled as
"general oncology standard, not from DeVita's section on this disease" — named regimens
(CHOP-like/etoposide, line 11), transplant timing (line 16), palliative RT (line 20), HLH-directed
therapy (line 24), monitoring cadence (lines 27-28), and trial enrolment (line 33). No regimen or
outcome figure is fabricated or mis-attributed to DeVita. No outdated approach shipped.

## 3. Dose-free
Confirmed. No mg, mg/m2, AUC, or numbered schedule. All numerals are survival statistics,
patient counts, or follow-up durations — not doses. "single-agent chemotherapy" and the named
regimen families carry no dosing.

## 4. Scope
Appropriately hedged throughout ("should be considered", "reasonable", "warranted", MDT
management, early transplant referral). Reads as decision-support, not a directive. The closing
"what DeVita does not specify" section (lines 35-36) is good discipline — declines to invent
regimen/conditioning detail.

## Advisory (non-blocking)
- Em-dash usage: the narrative uses em-dashes throughout (title + body). CLAUDE.md forbids em-dash
  in app-facing text; this content lands in the reference file's management field (app-facing).
  Replace with commas/parentheses before merge. Non-clinical, does not gate this R1 approval.
- Style: the repeated verbatim "general oncology standard, not from DeVita's section on this
  disease" is grounding-correct but verbose; could be tightened for reader clarity without
  changing meaning.
