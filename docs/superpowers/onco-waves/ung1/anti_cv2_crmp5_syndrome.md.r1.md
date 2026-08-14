# R1 Clinical-Safety Review — anti_cv2_crmp5_syndrome (management narrative)

VERDICT: APPROVE

Clinically safe, grounded in DeVita/general standard of care with accurate inline attribution, dose-free, and appropriately scoped as decision-support. The prior adversarial .verdict.md returned CLEAN; both previously-blocking items (self-contradictory "(mainstay)" heading; unlabelled "strongest lever on outcome" superlative) are confirmed removed in this sidecar and no still-present flagged claim remains. No claim is mis-attributed to DeVita.

## 1. SAFETY — pass
- No absolute/curative claims. Immunotherapy framed as stabilisation more than reversal ("improvement...is more often partial stabilization than full reversal", line 36) — honest and non-misleading.
- "Start treatment once viral and bacterial infectious mimics have been reasonably excluded" (line 19) is the correct, safe sequencing and matches DeVita; it does not endorse empiric immunosuppression without excluding infection.
- Symptomatic drug guidance is class-level only (dopamine-depleting/antidopaminergic agents for chorea, line 28) — no agent-specific directive that could misfire.
- Urgent-referral and vision-threatening-optic-neuritis warnings (lines 40-42) are appropriately safety-forward, not alarmist. No statement would cause harm if followed.

## 2. GROUNDING — pass
DeVita-attributed claims all correspond to DeVita content: high-risk >70% tier / same tier as anti-Hu (line 5), table phenotype encephalomyelitis + sensory neuronopathy with SCLC/thymoma (lines 26, 46), ~2-year repeat malignancy screening (line 13), intracellular- vs surface-antigen immunotherapy responsiveness (line 5), and the escalating first-/second-line ladder incl. tocilizumab in rituximab-refractory autoimmune encephalitis (lines 19-21). Every non-DeVita claim (expanded phenotype, chorea Rx, ophthalmic phenotype, anti-Hu/anti-amphiphysin coexistence, CV2-vs-Hu/Yo outcome comparison) is explicitly tagged "general neuro-oncology / general oncology standard, not from DeVita's section on this disease." The one comparative-outcome claim (line 22) is doubly hedged as "not a quantified or rigorously established finding." No fabricated or outdated regimen.

## 3. DOSE-FREE — pass
grep of all numeric tokens returns only "70%" (x2, DeVita's risk-tier stat) and "12th ed." (citation). No mg/mg-m2/AUC/mcg/g and no numbered schedule. "roughly two years" is a surveillance interval, not a dose. The heavy DeVita dosing (steroid pulse, IVIG, PLEX, rituximab, cyclophosphamide, tocilizumab) is correctly reduced to drug-class/name only.

## 4. SCOPE — pass
Consistently decision-support register: "should trigger", "consider testing", "is reasonable", "warrants prompt referral", "can be managed symptomatically". The dedicated "What DeVita's section does not specify" section (lines 44-46) transparently bounds the source and prevents over-reading. Not directive.

## 5. ADVERSARIAL FLAGS — clear
.verdict.md verdict is CLEAN; no ISSUES remain unaddressed. No DeVita mis-attribution present.

goldens changed: no (intended: n/a — reference KB narrative, no engine/golden output touched)
