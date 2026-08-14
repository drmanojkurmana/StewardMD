# R1 Clinical-Safety Review: histiocytic_sarcoma

VERDICT: APPROVE

## 1. Safety
No unsafe, misleading, or absolute statements. Every recommendation is hedged and
decision-support framed (surgery-first for localised/resectable disease, anthracycline-based
combination first-line for systemic disease, BRAF/MEK-directed therapy only where a MAPK-pathway
driver is identified, secondary-HLH surveillance, MDT/expert-haematopathology referral). Intent
is correctly split curative vs disease-control by extent. Nothing here would cause harm if followed
by a clinician. No definitive diagnostic/prognostic overstep.

## 2. Grounding
No claim is mis-attributed to DeVita. This is the pivotal check: DeVita 12th ed. has NO section on
histiocytic sarcoma (the draft and the adversarial verdict both confirm the only "histiocyt-" hits
are unrelated entities). The draft does NOT cite DeVita for any claim - it explicitly disclaims
DeVita sourcing at every line and in the closing Sources note. The clinical content is consistent
with standard of care for this ultra-rare entity (WHO Haematolymphoid / NCCN Histiocytic Neoplasms
framing): no fabricated regimen, no invented trial, no response/survival statistics, nothing
outdated. Adversarial .verdict.md returned CLEAN with zero still-present ungrounded/mis-sourced
claims, so the mandatory-REVISE trigger does not fire.

## 3. Dose-free
Confirmed. No mg, mg/m2, AUC, cycle/day numbering, or numbered schedules. Drug/approach named at
class level only ("anthracycline-based", "BRAF/MEK-directed"). Matches verdict grep.

## 4. Scope
Appropriately scoped as decision-support: extrapolation from case series is stated, trial enrolment
is recommended given absence of a controlled-trial standard, referral triggers are explicit. Not a
directive.

## Advisory (non-blocking)
- The top FLAG block, the repeated inline "(general oncology standard, not from DeVita's section on
  this disease)" tags, and the Sources paragraph are reviewer meta-commentary. Before this text
  populates the clinician-facing management field, strip the meta-tags while keeping ONE clear
  general-standard / non-DeVita provenance label, and resolve the "needs manual sourcing" flag
  against a histiocytic/dendritic-neoplasm source (WHO Haematolymphoid Tumours or NCCN Histiocytic
  Neoplasms). Provenance must remain "general standard", never relabelled as DeVita-specific.

goldens changed: no (intended: n/a - narrative content, no engine/rule change)
Confidence: 90
