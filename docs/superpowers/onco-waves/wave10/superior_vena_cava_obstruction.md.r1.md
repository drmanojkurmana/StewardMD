# R1 Clinical-Safety Review: superior_vena_cava_obstruction

VERDICT: REVISE

## Summary
Well-hedged, decision-support-framed, dose-free narrative. One grounding/accuracy
defect flagged by adversarial-verify is STILL present and blocks approval: the
germ-cell tumour / thymoma bullet (line 14). Per R1 rule, a persisting flagged
mis-attribution to DeVita cannot be APPROVED. The defect is NOT clinically
uncontroversial (it is wrong for thymoma), so it cannot be waived by relabelling.

## 1. SAFETY
- No unsafe or harmful directive. Good safety anchors: biopsy-before-steroids
  (lymphoma obscuring), biopsy-before-empirical-RT (specimen interpretability),
  emergency airway/vascular escalation "in parallel with, not instead of"
  diagnosis. All appropriate.
- One accuracy-driven safety concern (see grounding): line 14 states systemic
  chemotherapy is "definitive treatment" for thymoma. Thymoma management is
  surgery-led (stage-directed resection +/- RT). Presenting chemotherapy as
  definitive for thymoma could mislead. Blocking.

## 2. GROUNDING (vs DeVita / NCCN standard of care)
- BLOCKING: Line 14 (germ-cell tumours and thymoma) attributes to DeVita a
  "grouped ... among the chemosensitive causes for which systemic chemotherapy
  is definitive treatment" framework. Adversarial-verify confirmed DeVita's SVC
  chapter names thymic malignancies/mesothelioma/sarcoma/germ cell tumours only
  as rare causes and makes NO chemosensitivity or treatment claim for them.
  This is a mis-attribution to DeVita AND clinically wrong for thymoma. Fix:
  move germ-cell/thymoma into the same "named as a rare cause, no disease-
  specific management given" bucket as line 42, matching the sidecar's own
  closing section (which already handles thymic tumours/mesothelioma/sarcoma/
  breast met that way). The current draft treats germ-cell/thymoma
  inconsistently as an exception vs the closing "not specified" section.
- All other treatment claims verified grounded: SCLC chemo+RT survival benefit
  and immunotherapy caveat; NSCLC majority relief + salvage RT + stage III
  prognosis; NHL chemo-primary + bulky DLBCL consolidation + relapse; catheter-
  related management + rising incidence + better prognosis; endovascular
  stenting incl covered-vs-uncovered and combined-modality; RT field / no
  elective nodal / hypofractionation toxicity / upfront-RT survival in SCLC;
  surgery indications and graft patency; benign-cause natural history.
- The two inline "general oncology standard, not from DeVita" labels (PD-L1
  activity in ES-SCLC; standard staging/response follow-up) are honestly
  labelled, uncontroversial, and not mis-sourced. Acceptable.

## 3. DOSE-FREE
Confirmed. No mg, mg/m2, AUC, Gy, fraction count, percentage, or numbered
schedule. DeVita's numeric figures (7-10 days, response %, surgical mortality/
patency, stent success %, Gy hypofractionation) are correctly abstracted to
qualitative language. Only digits are "12th ed." in the citation. Pass.

## 4. SCOPE
Appropriately hedged as decision-support: histology-directed, MDT referral
emphasised, explicit "What DeVita's section does not specify" section avoiding
borrowed detail. Not directive. Pass (except line 14, which oversteps by
asserting a definitive-treatment claim not in source).

## 5. ADVERSARIAL FLAGS
.verdict.md (VERDICT: ISSUES) flagged the germ-cell/thymoma bullet as a
fabricated DeVita attribution. It remains unchanged in the sidecar. The claim
is not clinically uncontroversial (wrong for thymoma), so the relabel-and-
approve exception does not apply. Mandatory REVISE.

## Required change to reach APPROVE
Rewrite or delete line 14. Recommended: fold germ-cell tumours and thymoma into
the line 42 "named as a rare cause but no disease-specific management given"
statement, and drop the "chemosensitive causes / chemotherapy is definitive
treatment" DeVita attribution entirely.

goldens changed: no (intended: n/a — KB reference narrative, not engine logic)
