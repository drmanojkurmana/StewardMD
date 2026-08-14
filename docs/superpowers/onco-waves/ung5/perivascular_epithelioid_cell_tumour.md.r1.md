# R1 Clinical-Safety Review - perivascular_epithelioid_cell_tumour (PEComa)

VERDICT: APPROVE

Goldens changed: no (intended: n/a - reference-content narrative, no engine/regression fixtures touched).
Adversarial verdict file: NONE present at sidecar path (.verdict.md absent) - no outstanding flags to reconcile.

## 1. Safety
No unsafe or harm-inducing directive. Statements are hedged and route dose/schedule detail to structured
templates. Nothing oversteps decision-support.

## 2. Grounding (DeVita/NCCN)
Accurate and, notably, scrupulously attributed:
- TSC1/TSC2 upstream of mTOR; mTOR-inhibitor sensitivity confirmed by a placebo-controlled phase III in the
  AML/TSC population - grounded (everolimus / EXIST-2 class of evidence).
- nab-sirolimus regulatory approval for advanced/metastatic malignant PEComa, benefit in most treated,
  durable partial/complete responses, responses enriched in TSC2-mutant disease - grounded (AMPECT phase II).
- TFE3-fusion subset called out as a biologically distinct group with NO DeVita-specific regimen -> correctly
  refuses to invent one and flags for the oncologist.
- Folpe-type malignancy criteria and monitoring cadence are explicitly labelled "general oncology standard,
  not from DeVita's section" - exactly the relabelling R1 requires. No claim is mis-attributed to DeVita.
No fabricated or outdated regimen. No chemo/RT claims are asserted (correctly noted as outside DeVita's text).

## 3. Dose-free
Confirmed. No mg / mg/m2 / AUC / numbered schedule. "over two and a half years" is a response-duration
descriptor, not a dose. nab-sirolimus is named as the approved agent only, with dose explicitly deferred.

## 4. Scope
Appropriately hedged throughout ("may be sufficient", "can be an effective", "should be flagged for the
treating oncologist"). Referral triggers are clear. Not directive.

## 5. Important (non-blocking) - recommend before final merge
- Line 12: "Angiomyolipoma does not metastasise and can safely be observed" is true for classic AML but the
  EPITHELIOID angiomyolipoma variant can behave malignantly and metastasise. The malignant end IS covered
  later via the malignant-potential assessment, so this is not a true false-negative, but add a short caveat
  (e.g. "classic angiomyolipoma; the epithelioid variant can behave malignantly") to remove the absolute tone.

## Advisory
- Consider naming Folpe explicitly (or "modified Folpe criteria") for the risk features, since it is the
  recognised framework - minor.

Rationale for APPROVE: clinically safe, grounded, no DeVita mis-attribution (careful general-vs-DeVita
labelling already present), dose-free, and appropriately scoped as decision-support. The single Important
item is a hedge refinement, not a factual/safety error, and the malignant pathway is already covered.
