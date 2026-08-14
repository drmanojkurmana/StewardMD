# R1 Clinical-Safety Review — epithelioid_sarcoma

VERDICT: APPROVE

## 1. Safety
No unsafe, misleading, or absolute directives. All actionable statements are hedged
("should be considered", "may carry prognostic value", "reserved for", "investigational
rather than standard"). The genotype-directed recommendation (tazemetostat) is correctly
gated on CONFIRMED INI1/SMARCB1 loss, and the EZH2i+anthracycline combination is explicitly
labelled investigational/trial-only. No false-negative risk (nodal spread, local recurrence,
and need for prolonged surveillance are all surfaced). No overstep of decision-support role.

## 2. Grounding (DeVita 12th ed / NCCN standard of care)
Consistent with standard of care. Spot-checked against the adversarial verdict:
- Nodal metastasis "roughly one in five" — DeVita states ~20%; correctly attributed to DeVita.
- Gross-node biopsy, complete LN dissection if node+/no distant mets, SLNB not outcome-changing
  but possibly prognostic — matches DeVita's ES paragraph.
- Proximal-type more aggressive / RT+chemo resistant — matches DeVita.
- Moderate chemosensitivity with short-lived responses; anthracycline-based cytotoxic as a
  standard option — consistent with DeVita STS chemotherapy discussion; correctly framed as
  general STS practice, not passed off as ES-specific evidence.
- Tazemetostat: near-universal SMARCB1/INI1 loss -> oncogenic EZH2 -> phase 2 basket study,
  minority objective response, accelerated approval for metastatic/unresectable ES, confirmatory
  frontline anthracycline-combination trial underway — matches DeVita targeted-therapy section.
  Specific N/ORR/PFS and the "doxorubicin" specifics are appropriately generalized (de-identified),
  not fabricated. tazemetostat accelerated approval is factually correct.
No fabricated or outdated regimen. No claim mis-attributed to DeVita.

## 3. Dose-free
Confirmed. grep of numeric/dose tokens returns only gene names (SMARCB1/EZH2/INI1),
"phase 2" (trial phase), and "12th ed" (citation). No mg, mg/m2, AUC, or numbered schedule.

## 4. Scope
Appropriately scoped as decision-support. MDT/referral framing throughout; explicit statement
that DeVita is silent on surveillance intervals and localized-disease adjuvant/neoadjuvant
chemo, and that those are intentionally not stated as recommendations — good boundary discipline.

## 5. Adversarial flags
Adversarial verdict = CLEAN (ready for R1). No ISSUES were flagged as still-present. Only a
non-blocking wording nit: intro says SMARCB1/INI1 loss is seen in "the large majority" while
DeVita/body text say "near-universal". This UNDERSTATES (safe direction) and is internally
inconsistent with line 34. Advisory only — not a safety or grounding failure.

Advisory (non-blocking): align intro "large majority" with the body's "near-universal" for
internal consistency with DeVita's strength of claim.

goldens changed: no (intended: n/a — KB narrative content, no engine/regression suite touched)
