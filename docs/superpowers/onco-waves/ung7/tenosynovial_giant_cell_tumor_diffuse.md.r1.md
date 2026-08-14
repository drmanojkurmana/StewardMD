# R1 Clinical-Safety Review — tenosynovial_giant_cell_tumor_diffuse

VERDICT: APPROVE

Confidence: 88

Note on adversarial verdict: no `.verdict.md` present at the sidecar path, so there are no
outstanding adversarial flags to reconcile. Reviewed the narrative directly.

## 1. Safety
No unsafe, misleading, or harmful-if-followed statements. No absolute "always/never/cure"
directives. Clinically sound guidance:
- Surgery-as-mainstay, high recurrence in diffuse form, and MDT referral are correct and safe.
- The malignant-component off-ramp ("manage as high-grade sarcoma, complete resection is the
  backbone; can metastasise to lung/lymph nodes") is the correct safety net and well placed.
- CSF1R-inhibitor hepatotoxicity is called out with LFT monitoring. Minor: pexidartinib carries a
  boxed warning for serious/fatal hepatotoxicity (REMS); "standard precaution" slightly understates
  it, but this is a dose-free narrative and the caution is present — not blocking. (Advisory)

## 2. Grounding (DeVita/NCCN standard of care)
Treatment claims are consistent with standard of care:
- Diffuse-type biology (COL6A3-CSF1 fusion, macrophage recruitment) — correct; correctly labelled
  "general TGCT biology, not from DeVita's section".
- Recurrence 18-50% (diffuse) vs 10-20% (nodular) — within accepted literature range.
- Radiotherapy reduces local recurrence (<10%) but reserved for recurrent/incompletely resectable
  disease due to fibrosis/secondary-malignancy risk — consistent, and the reserved-use judgement is
  flagged as general standard.
- Imatinib (CSF1R activity) ~75% disease stabilisation — consistent with pooled data (Cassier).
- Pexidartinib phase III vs placebo, ~39% response — consistent with ENLIVEN. Correctly hedged that
  metastatic-setting benefit is unclear given few metastatic patients enrolled.
No fabricated or outdated regimen. No claim is mis-attributed: the draft explicitly demarcates every
general-standard claim from DeVita-specific ones, and the DeVita-implied claims (surgery, recurrence
rates, RT efficacy, imatinib/pexidartinib activity) are all plausibly within the source's soft-tissue
sarcoma/TGCT coverage. No DeVita citation attached to a non-DeVita claim.

## 3. Dose-free
Confirmed. grep for mg / mcg / g / units / mL / mg/m2 / AUC / mg/kg / q_h / "day 1" returned no
matches. Percentages present are recurrence and response RATES, not drug doses — permitted.

## 4. Scope
Appropriately hedged as decision-support: "as complete a synovectomy as possible", "when the benefit
is judged to outweigh", "generally reserved", "remains unclear", plus explicit referral triggers. No
directive prescribing. Reads as guidance, not orders.

## 5. Adversarial flags
None outstanding (no verdict file). The source-attribution discipline (per-claim general-vs-DeVita
labels) is exactly what the anti-mis-sourcing rule requires and is already applied throughout.

goldens changed: no (intended: n) — reference-content narrative only; no engine/rule/calculator code.

## Advisory (non-blocking)
- Consider strengthening the pexidartinib hepatotoxicity line to reflect its boxed-warning severity
  (serious/potentially fatal DILI) rather than "standard precaution".
- "Imatinib, an inhibitor of the CSF1 receptor" is accurate but reads as if that is its primary
  target; optional to note it is a multi-kinase inhibitor with CSF1R activity.
