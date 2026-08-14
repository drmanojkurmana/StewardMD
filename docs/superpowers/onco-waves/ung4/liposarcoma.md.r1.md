# R1 CLINICAL-SAFETY REVIEW - liposarcoma.md (ung4)

Verdict: APPROVE
Confidence: 90
Goldens changed: no (intended: n/a - KB reference narrative, no engine/golden touched)

## 1. SAFETY - PASS
No unsafe, misleading, or harm-inducing statement. Every actionable claim is hedged as
decision-support ("generally aiming for", "should be considered", "within a trial context",
"per standard multidisciplinary algorithms"). No absolute directive a clinician could follow
to patient harm. Subtype-specific caveats (WD/ALT-of-extremity minimal-margin exception,
amputation reserved for otherwise-unresectable non-metastatic disease with rehab potential)
are correctly bounded. The pazopanib statement ("not an evidence-supported option for this
disease group") is accurate and conservative (PALETTE excluded adipocytic tumors), not
misleading.

## 2. GROUNDING - PASS
Treatment claims are consistent with DeVita 12th ed / NCCN standard of care. The
adversarial-verify verdict (liposarcoma.verdict.md) traced each specific claim to DeVita ch.60
with line references and found no mis-attribution:
- Surgical margins, amputation criteria, wide en-bloc resection - match.
- Retroperitoneal completeness/grade as strongest predictors, liposarcoma's elevated local
  recurrence - match.
- Myxoid radiosensitivity + investigational reduced-dose preop RT - match, numbers withheld.
- Anthracycline +/- ifosfamide first-line; trabectedin and eribulin randomized-trial /
  subtype-selective claims - match, no numeric endpoints.
- CDK4/MDM2 amplification + palbociclib activity attributed to DeVita's own sarcoma-chapter
  discussion (not the general CDK4/6 chapter) - verified accurate, not mislabelled.
- Metastatic patterns (extremity->lung, retroperitoneal/visceral->liver, myxoid/round-cell
  fat-pad + bone without pulmonary) - near-verbatim match.
Claims not in DeVita's disease section are explicitly tagged "(general oncology standard, not
from DeVita's section on this disease)" - the referral criteria, surveillance cadence,
chemosensitivity/downstaging aside, and out-of-trial MDM2/CDK4 caveat. No DeVita citation for a
claim absent from DeVita.

## 3. DOSE-FREE - PASS
No mg, mg/m2, AUC, Gy, or numbered schedule anywhere. Drug names appear (doxorubicin,
ifosfamide, trabectedin, eribulin, pazopanib, palbociclib) which is appropriate for a
management narrative and carries no dosing. RT dose-reduction referenced qualitatively with an
explicit "Exact dose levels are protocol-specific and are not reproduced here."

## 4. SCOPE - PASS
Framed throughout as decision-support, not directive. Dedicated "When to refer" section routes
subtype/grade assignment and treatment selection to a specialist sarcoma MDT; retroperitoneal
and high-grade components flagged for early referral.

## 5. ADVERSARIAL FLAGS - RESOLVED
The single prior R1 blocking issue (Monitoring bullet 1 inverting DeVita's beyond-5-year
recurrence/mortality finding) is fixed. Current text (lines 72-78) states high-grade recurs
earliest/most frequently while low-grade WD/myxoid accrues risk latest with highest
beyond-5-year disease-specific death - consistent with DeVita and with the sidecar's own
Surgical-management bullet 4 (lines 25-28). No residual flagged issue remains in the sidecar.

## Notes
- No em-dash/en-dash in app-facing text (hyphens only). Compliant.
- Citation present as name-only line, no page numbers. Compliant.

APPROVE - clinically safe, grounded (no claim mis-attributed to DeVita), dose-free, and
appropriately scoped as decision-support.
