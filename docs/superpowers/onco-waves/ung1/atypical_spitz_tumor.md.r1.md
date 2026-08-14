# R1 Clinical-Safety Review: atypical_spitz_tumor.md

VERDICT: APPROVE (with one non-blocking relabel note)

Confidence: 90

Goldens changed: no (intended: n/a — reference-content narrative, no engine/rule/calculator touched)

## 1. SAFETY — PASS
No unsafe, misleading, or absolute directive that could harm a clinician who followed it.
- Management is framed as conservative/uncertainty-driven, which matches the real risk of this entity being over- or under-called.
- The highest-risk-to-misread statement — "a positive [sentinel] node in this context does not carry the same ominous prognosis it does in conventional melanoma" — is correctly hedged ("interpreted cautiously", "not automatically trigger... completion lymphadenectomy or adjuvant systemic therapy") and is consistent with the accepted Spitz/atypical-Spitz literature. It does not tell a clinician to skip management, only to avoid reflexive melanoma-grade escalation. Acceptable.
- Reclassification-to-melanoma pathway is explicit and correctly routes aggressive/reclassified lesions into standard melanoma staging. No false-negative safety gap.

## 2. GROUNDING — PASS
Claims attributed to DeVita (Pathway IV biology, driver list HRAS/ALK/ROS1/NTRK1/NTRK3/MET/RET/BRAF/MAP3K8, full-thickness vs thin-shave biopsy, cytogenetic advances aiding differentiation, skin-melanocytoma indolent-course follow-up wording, pediatric excisional-biopsy-infeasibility dilemma) are all consistent with DeVita 12th ed Ch. 63 per the adversarial verdict's line-level spot check, and are standard-of-care. Every treatment-level claim not in DeVita's diagnostic/biologic text (surgical margins, re-excision, SLNB interpretation, targeted-therapy-by-extrapolation, lines-of-therapy framing, no-RT) is inline-labeled "general oncology standard, not from DeVita's section on this disease." No fabricated or outdated regimen. Importantly, DeVita's 1–2 mm biopsy margin figure was NOT imported as a treatment margin — correct, that would have been both a dose leak and a misattribution.

## 3. DOSE-FREE — PASS
No mg, mg/m2, AUC, or numbered cycle schedule anywhere. Confirmed independently; matches verdict.

## 4. SCOPE — PASS
Appropriately decision-support, not directive: "may be considered", "could be considered by extrapolation", "should prompt referral". No definitive diagnostic or prescriptive overstep.

## 5. ADVERSARIAL FLAGS
The verdict returned CLEAN and raised exactly one residual item: the phrase "distinct from the driver profile of conventional melanoma" (line 9) is a reasonable inference, not a verbatim DeVita quote in the cited lines, sitting in a bullet without an inline source tag among DeVita-cited material.

Per R1 policy this residual flag is permitted to APPROVE because the claim is clinically uncontroversial (Spitz-pathway kinase-fusion/HRAS biology vs conventional BRAF/NRAS CSD-pathway melanoma is textbook), AND I note here it must be relabeled: line 9 should not read as DeVita-attributed. Recommend appending "(general oncology standard)" to that bullet so it is not implicitly sourced to DeVita's disease section. Non-blocking — uncontroversial fact, low materiality.

## Summary
- Critical: none.
- Important: none blocking. (Relabel line 9's "distinct from the driver profile of conventional melanoma" as general-standard so nothing unlabeled sits among DeVita-cited claims.)
- Advisory: none.

APPROVE for the reference management field, conditional only on the line-9 relabel above, which is editorial not clinical.
