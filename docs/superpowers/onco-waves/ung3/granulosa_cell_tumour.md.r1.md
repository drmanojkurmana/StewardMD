# R1 CLINICAL-SAFETY REVIEW — granulosa_cell_tumour.md

VERDICT: APPROVE

goldens changed: no (intended: n/a — narrative KB content, no engine/rule/calculator touched)

## 1. SAFETY — PASS
No unsafe, misleading, or harmful directive. Every therapeutic statement is
hedged as an option ("reasonable option", "has a role mainly in", "can assist")
rather than a command. The one absolute-sounding line — ">80 percent of patients
with advanced-stage disease will die" — is a prognostic statistic used to
motivate accurate staging, not a treatment directive, and is grounded to DeVita.
Acceptable in decision-support. No claim would cause harm if followed:
- BEP has-activity-but-not-durable is correctly framed as modest, steering
  toward referral/trials rather than false reassurance.
- RT is explicitly flagged as NOT evidence-based here — a safe negative claim.

## 2. GROUNDING — PASS
Claims attributed to DeVita are consistent with 12th-ed standard of care and
match the adversarial-verify line-level check (DeVita ovarian sex cord-stromal
passage): mid-50s adult vs juvenile epidemiology, >80% advanced-disease
mortality, lymphadenectomy omission absent enlarged nodes, JGCT
fertility-preserving surgery, BEP activity without durability, serum inhibin
A/B for diagnosis and surveillance, and the absence of a defined RT role. No
fabricated regimen, trial name, or statistic. Non-DeVita claims (ranking as most
common malignant sex cord-stromal tumour, favourable early-stage prognosis,
staging salpingo-oophorectomy, endometrial sampling, platinum combination,
aromatase inhibitors in relapse, AMH monitoring, MDT referral) are each
explicitly tagged "general oncology standard, not from DeVita's section on this
disease." No claim is mis-attributed to DeVita.

## 3. DOSE-FREE — PASS
No numeric dose. Only digits present: "mid-50s" (age), "80 percent"
(DeVita mortality stat), "12th ed." (citation). No mg, mg/m2, AUC, Gy, cycle
count, or numbered schedule. BEP named without dosing — correct.

## 4. SCOPE — PASS
Appropriately hedged decision-support throughout, with an explicit
"What DeVita does not address" section delimiting the source's silence and a
refer-to-gyn-onc-MDT directive. Does not present a stage-by-stage algorithm the
source lacks.

## 5. ADVERSARIAL FLAGS — CLEARED
The .verdict.md (pass 3) returned CLEAN. The only prior residual ("often
unilateral" untagged) is fixed with its own explicit non-DeVita tag. The single
remaining nuance (endometrial-sampling bullet under-attributes DeVita — the
estrogen/endometrial-neoplasia biology IS in DeVita, only "sampling" is
DeVita-silent) is safe-direction (under-claims rather than over-claims the
source), non-blocking. No flagged claim over-attributes DeVita; nothing requires
REVISE.

## ADVISORY (non-blocking)
- The repeated inline "(general oncology standard, not from DeVita's section on
  this disease)" tags are correct for provenance but clutter reader-facing prose.
  If this text lands verbatim in the management field, consider a single
  provenance footnote plus clean sentences; keep the tags in the sidecar.
- Optional: relabel the endometrial-sampling bullet so the estrogen→endometrial
  biology is credited to DeVita and only the specific sampling action is marked
  general-standard.
