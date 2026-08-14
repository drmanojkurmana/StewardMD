# R1 Clinical-Safety Review — Alveolar Soft Part Sarcoma (alveolar_soft_part_sarcoma)

VERDICT: APPROVE

goldens changed: no (intended: n/a — narrative content, no engine/rule change)
Adversarial-verify verdict file: NOT PRESENT at expected path.

## 1. SAFETY
No unsafe, harmful, or overstepping statements found.
- The two most "absolute" statements are protective, not hazardous:
  - "Cytotoxic chemotherapy is not effective in ASPS and should not be relied upon as a systemic treatment line" — steers clinicians AWAY from an ineffective option; consistent with established ASPS chemoresistance. The "should not be relied upon" phrasing keeps it as guidance, not a hard prohibition.
  - "Local recurrence after surgery is uncommon" — matches ASPS natural history (low local recurrence, high distant metastatic tendency).
- No definitive diagnostic/prognostic claim that oversteps decision-support. Prognostic language ("prolonged survival with metastatic disease in some series") is correctly hedged.

## 2. GROUNDING (DeVita 12th ed / NCCN standard of care)
All treatment claims are grounded; nothing fabricated or outdated:
- ASPSCR1-TFE3 fusion, TFE3 IHC / FISH / RT-PCR confirmation — correct defining feature.
- Early haematogenous spread to lung/bone/brain — correct.
- Antiangiogenic TKIs as standard systemic option, driven by HIF1-alpha/VEGF upregulation — correct biology and standard of care.
- MET inhibition explored (ASPS expresses MET) — correct, real approach.
- Immune checkpoint blockade with durable responses; ASPS grouped with UPS and cutaneous angiosarcoma as checkpoint-responsive — correct.
- Axitinib + pembrolizumab combination improving response over monotherapy — real, grounded (Wilky et al).
- Trial enrollment / sarcoma MDT referral emphasis — appropriate for a rare subtype.
- Radiotherapy explicitly flagged as extrapolation from general STS principles, not ASPS-specific — honest and correct.

Note (non-blocking): the narrative does not name the FDA-approved checkpoint inhibitor indication for ASPS specifically, but it correctly covers checkpoint blockade as a class benefit, so no grounding gap that misleads.

## 3. DOSE-FREE
Confirmed. No mg, mg/m2, AUC, numbered schedules, or any numeric dose. Drug names appear only as class exemplars (axitinib, pembrolizumab), no dosing.

## 4. SCOPE
Appropriately scoped as decision-support: repeated hedging ("individualised", "discussed at a sarcoma MDT tumour board", "where available", "consider trial", "extrapolation rather than ASPS-specific recommendation", "DeVita does not specify a fixed sequencing algorithm"). Not directive.

## Advisory (non-blocking)
- Line 16: "Reported response rates with these agents approach the range described for this class in ASPS" is circular/near-meaningless — safe, but could be deleted or made concrete without adding a dose.
