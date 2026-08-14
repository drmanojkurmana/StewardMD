# R1 CLINICAL-SAFETY REVIEW — atypical_teratoid_rhabdoid_tumour

VERDICT: APPROVE

goldens changed: no (intended: n/a — reference-narrative content, no engine/rule/golden touched)

## 1. SAFETY — PASS
No unsafe, misleading, or absolute directives. Curative intent is qualified ("whenever
feasible"), radiotherapy is correctly flagged for age-gated neurocognitive toxicity in infants
(deferral rationale is standard and protective, not harmful), and high-dose chemo + autologous
stem-cell rescue is scoped to "appropriately selected, fit patients." Nothing here would cause
harm if followed as decision-support. No dosing, no scheduling, no definitive-diagnosis or
stop-med overstep.

## 2. GROUNDING — PASS
Every AT/RT-specific treatment claim (surgery as foundation, multi-agent chemo, HDC + stem-cell
rescue, age-deferred RT, IT/CNS-directed therapy, neuraxis surveillance) is explicitly labelled
"(general oncology standard, not from DeVita's section on this disease)" and NOT attributed to
DeVita. The only claims attributed to DeVita — SMARCB1/INI1 loss → SWI/SNF dysregulation + EZH2
elevation, and EZH2-targeting agents in trials across SMARCB1-deficient neoplasms including
malignant rhabdoid tumour — are genuinely in DeVita's chordoma section and are represented
accurately (confirmed against the adversarial verdict's four-passage spot-check and re-read here).
Crucially the draft correctly states these are trial-stage/investigational and that DeVita does
NOT describe their use in AT/RT specifically. No fabricated or outdated regimen; no regimen names,
trial numbers, or survival statistics invented to fill the DeVita gap. The Sourcing note honestly
declares the DeVita coverage gap rather than papering over it.

## 3. DOSE-FREE — PASS
Grepped all numeric occurrences: every hit is a gene/complex name (SMARCB1, INI1, SMARCA4, BRG1,
EZH2) or the "12th ed" citation. No mg, mg/m2, AUC, cycle count, or numbered schedule anywhere.

## 4. SCOPE — PASS
Framed throughout as decision-support: multidisciplinary referral emphasized, relapse managed
"case-by-case, often through clinical trial enrolment," germline predisposition routed to genetic
counselling. Appropriately hedged, non-directive.

## 5. ADVERSARIAL FLAGS — CLEAR
Adversarial verdict returned CLEAN (no dose leak, no ungrounded/mis-attributed claim, citation
present). Re-verified independently: no DeVita mis-attribution remains, and no flagged issue
persists. No relabelling required — the general-standard claims are already labelled as such and
the DeVita-cited claims are correctly the EZH2/SMARCB1 biology that DeVita actually contains.

## Advisory (non-blocking)
- The inline "(general oncology standard, not from DeVita's section on this disease)" tag repeats
  ~10 times and will render verbatim in the KB management field. Consider collapsing to a single
  header disclaimer before ingest so the patient-facing/clinician-facing text reads cleanly. Cosmetic only.
- Sourcing note's FLAG (needs manual sourcing vs COG/SIOP or a paediatric neuro-onc text) should
  be tracked so the general-standard claims eventually get a primary paediatric source; content is
  safe to ship now on standard-of-care grounds.
