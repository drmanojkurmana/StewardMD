# R1 Clinical-Safety Review — salivary_gland_tumor (management narrative)

VERDICT: APPROVE

Reviewed against DeVita 12th ed / NCCN standard of care, with the adversarial-verify
verdict (.verdict.md = CLEAN) cross-checked. Confidence: 90.

## 1. Safety
No unsafe, misleading, or harm-causing statement. Absolute-sounding claims are the
correct standard of care and are safely scoped:
- "all ACC is treated with surgery plus irradiation" (line 7/21) — accurate: ACC's
  perineural spread mandates adjuvant RT regardless of grade. Not a harmful overstatement.
- Systemic-therapy recommendations are uniformly biomarker-gated (HER2, AR, NTRK) or
  explicitly individualised, so no directive pushes a clinician toward an inappropriate
  drug. Recurrent/metastatic advice correctly leads with "no standard therapy; prioritise
  a clinical trial" and endorses observation for indolent ACC — conservative and safe.
- Facial-nerve-weakness-as-red-flag (line 48) and MDT routing (line 47) are correct.

## 2. Grounding
Consistent with DeVita/NCCN/ASCO. The adversarial pass spot-checked every specific
regimen, trial (RTOG 1008), registry finding, and generalization (CAP -> "anthracycline-
based platinum"; vinorelbine±cisplatin; taxane-avoidance in ACC; multitargeted TKI;
checkpoint-blockade modest activity; NTRK inhibitor in MASC) against DeVita Ch.29 and
found none fabricated or mis-attributed. No regimen/statistic lacks source support.

## 3. Dose-free
Confirmed. No mg, mg/m2, AUC, Gy, or numbered chemo-cycle schedule. The only numerics
are receptor/trial names (HER2, RTOG 1008, phase 2) and the surveillance follow-up cadence
("every 2 to 3 months", etc.), which is a clinical visit schedule, not a drug dose.

## 4. Scope
Appropriately hedged as decision-support: "controversial", "retrospective data",
"extrapolating from...", "individualised", "should be prioritised where available",
"evidence here is limited". Reads as guidance, not a directive.

## 5. Adversarial flags
.verdict.md returned CLEAN — no ungrounded/mis-sourced/scope-creep claim was flagged as
still present, so the mandatory-REVISE condition does not trigger.

## Advisory (non-blocking)
- Line 30 is internally inconsistent on histology: it introduces salivary duct carcinoma
  as "the" receptor-overexpressing subtype, then attributes the HER2-directed and
  androgen-deprivation adjuvant regimens to "mucoepidermoid carcinoma", then names SDC
  again for the ongoing HER2 trial. The adversarial pass confirmed DeVita specifies MEC
  for that cohort, so grounding stands and the therapy is biomarker-gated (clinically
  safe either way), but the SDC/MEC flip-flop is confusing to read. Recommend reconciling
  the naming for clarity in a later polish. Not a safety or grounding defect; does not
  block.

goldens changed: no (intended: n/a — reference-content narrative, no engine/golden output)
