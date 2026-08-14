# R1 Clinical-Safety Review: chordoma.md

**VERDICT: APPROVE**

Clinically safe, grounded in DeVita/NCCN standard of care, dose-free, and appropriately
scoped as decision-support. The adversarial verdict (chordoma.verdict.md, round 3) returned
CLEAN with both prior issues verified fixed; I independently confirm no flagged issue remains.

## 1. SAFETY — PASS
No unsafe, misleading, or absolute directive. Key checks:
- Chondrosarcoma surveillance-vs-immediate-RT (line 7, 33) is correctly hedged ("reasonable,
  safe strategy") and scoped to LOW-GRADE SKULL BASE chondrosarcoma only, with the equivalence
  attributed to successful salvage at progression. Not generalised to chordoma. Safe.
- Systemic therapy (line 23-29) is explicitly confined to advanced/recurrent/metastatic disease
  and labelled limited/investigational; no suggestion of routine primary systemic use that could
  displace surgery + RT.
- ivosidenib is correctly walled off to IDH1-mutant CHONDROSARCOMA with the explicit disclaimer
  "this applies to chondrosarcoma, not chordoma" (line 25) — prevents a harmful cross-application.
- Reoperation-on-recurrence framed with its higher complication risk (line 11), not oversold.
- No false-negative risk: surgery is stated as backbone, particle-beam RT as preferred adjuvant,
  and MDT referral from diagnosis is emphasised. No red flag omitted.

## 2. GROUNDING — PASS
Treatment claims are consistent with DeVita 12th ed. Ch. 64. Every claim is either textually
supported or explicitly relabelled "(general oncology standard, not from DeVita's section on
this disease: ...)" — brachyury/TBXT drug hedge (line 29), germline TBXT susceptibility (line 41),
late-recurrence/late-metastasis natural history (line 33), and surveillance interval/duration
(line 33). No regimen is fabricated; no claim is mis-attributed to DeVita. The two round-3 fixes
(chordoma prognostic-factor list no longer borrowing chondrosarcoma's "brain stem" abutment,
line 17; chest-x-ray-as-baseline logic corrected, line 33) are present and correct.

## 3. DOSE-FREE — PASS
Independent grep: only numeric tokens are "S100" (IHC marker), "10-year" (survival timeframe),
"12th ed." (citation). No mg, mg/m2, AUC, Gy, CGE, %, or numbered schedule. Clean.

## 4. SCOPE — PASS
Decision-support register throughout ("reasonable," "often," "typically," "should be sought,"
"recommended"). No directive commands, no definitive prognostic promises. The "no validated
prognostic factors" framing (line 5) and the investigational labelling of PARP/checkpoint/
brachyury approaches keep it advisory, not prescriptive.

## 5. ADVERSARIAL FLAGS — CLEARED
chordoma.verdict.md flagged two issues in a prior round (line 17 borrowed brain-stem prognostic
factor; line 33 chest-imaging suspicion-logic inversion). Both are verified fixed in the current
sidecar. No still-present flagged claim; no DeVita mis-attribution. Nothing forces REVISE.

goldens changed: no (intended: n/a — narrative KB content, no engine/rule/golden touched)
