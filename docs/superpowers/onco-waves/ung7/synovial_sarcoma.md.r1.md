# R1 Clinical-Safety Review: synovial_sarcoma.md

VERDICT: APPROVE

## 1. Safety
No unsafe, misleading, or absolute statements. Every therapeutic claim is hedged as an
option/consideration ("should be considered", "reasonable option", "may be required",
"is associated with prolonged survival" - correctly correlational for metastasectomy, not
causal). No claim, if followed, drives a clinician toward harm. Surgery-first / MDT-before-biopsy
framing is protective. No definitive diagnostic or prescriptive overstep.

## 2. Grounding (DeVita/NCCN standard of care)
Consistent with standard SS management: multimodality surgery+RT for localized high-risk disease,
ifosfamide-based perioperative chemo for the chemo-responsive subtype, anthracycline+/-ifosfamide
first-line for advanced disease, gem/docetaxel-ifosfamide-pazopanib-dacarbazine-trabectedin later
lines, and NY-ESO-1/MAGE-A4 TCR cell therapy + trials as emerging. No fabricated regimen, drug, or
trial. Adversarial verify (synovial_sarcoma.verdict.md) spot-checked each specific claim against
devita.txt and found no ungrounded or mis-attributed statement (verdict: CLEAN). The only
citation-range gap it noted (pulmonary metastasectomy) is confirmed genuinely within the DeVita STS
chapter, not a fabrication - non-blocking.

## 3. Dose-free
Confirmed. Numeric content is limited to tumor-size thresholds (5 cm, 10 cm), genetic notation
(t(X;18)), and follow-up horizons (5-year, 15-year). No mg, mg/m2, AUC, cycle count, or numbered
schedule. DeVita's high-dose ifosfamide figure and epirubicin/ifosfamide cycle count are correctly
omitted.

## 4. Scope
Appropriately decision-support, not directive. Repeatedly defers to specialist sarcoma MDT and
clinical-trial referral; language is advisory throughout.

## 5. Adversarial flags
The .verdict.md returned CLEAN with zero flagged ungrounded/mis-sourced/scope-creep claims still
present. Critically, the two claims that are general-oncology standard rather than DeVita-SS-section
specific (anthracycline monotherapy/doublet as general perioperative option; >5-year surveillance
horizon) are EXPLICITLY self-labeled in the sidecar as "general oncology standard, not from DeVita's
section on this disease." No claim is mis-attributed to DeVita. Requirement satisfied.

goldens changed: no (intended: n/a - reference narrative, no engine/golden impact)
