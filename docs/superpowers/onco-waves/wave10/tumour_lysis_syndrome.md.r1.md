# R1 Clinical-Safety Review — tumour_lysis_syndrome

**VERDICT: APPROVE** (confidence 90)

Reviewed: sidecar management narrative + adversarial `.verdict.md` (verdict: CLEAN).
Goldens changed: no (intended: n/a — reference KB narrative, no engine/regression outputs touched).

## 1. SAFETY — pass
No unsafe, misleading, or absolute directive statements. Spot-checked the high-risk claims:
- Urinary alkalinisation "not recommended" (worsens Ca-phosphate deposition) — correct, matches
  current TLS consensus; a genuine safety improvement over the old bicarbonate-load practice.
- Allopurinol/febuxostat "do not lower an already-elevated uric acid load" — mechanistically correct;
  prevents the clinically dangerous error of relying on a xanthine oxidase inhibitor to rescue
  established hyperuricaemia.
- Rasburicase avoided in G6PD deficiency (haemolysis/methaemoglobinaemia) — critical safety carve-out
  present and correct.
- Hypocalcaemia corrected only when symptomatic (supplemental calcium worsens metastatic Ca-phosphate
  deposition) — correct, avoids harm.
- Hyperkalaemia bundle (calcium gluconate, insulin/dextrose, resin, ± bicarb/loop, dialysis for
  refractory) — standard and safe. No false-negative red flag: dialysis escalation for refractory
  hyperkalaemia/renal impairment is explicitly stated and "should not be delayed."

## 2. GROUNDING — pass
Treatment claims consistent with DeVita 12e Ch. 82 / NCCN supportive-care standard of care per the
adversarial grep. 4-tier risk stratification, rasburicase mechanism (urate oxidase → soluble
allantoin) and its high-risk/cost-based reservation, and derangement management all trace to source.
No fabricated or outdated regimen. The three inferences beyond the verbatim excerpt (G6PD
contraindication, avoid-routine-calcium caution, cardiac-monitoring individualisation) are each
INLINE-disclosed as "general oncology standard, not from DeVita's section" — i.e. NOT mis-attributed
to DeVita. This satisfies the adversarial-flag rule: the non-DeVita claims are clinically
uncontroversial AND are correctly relabelled as general standard rather than DeVita-specific.
The nephrology/critical-care referral line (verdict's minor note) is undisclosed inference but is
uncontroversial general practice consistent with DeVita's "haemodialysis as fallback" framing — not
blocking, and I do not require a rewrite for it.

## 3. DOSE-FREE — pass
No numeric dose leaked. Only numeral is "12th ed" (edition). "roughly a day before" and "twice
daily"/"daily" are de-precisioned timing/monitoring cadence, not drug doses or numbered schedules.
Rasburicase/allopurinol/febuxostat mg/kg, mg/m2, AUC, day-count arms, and brand/trial names all
correctly omitted.

## 4. SCOPE — pass
Appropriately hedged as decision-support: "considered on an individual basis," "generally
sufficient," "individualised," "should have oncology/haematology coordinating." No directive dosing
or absolute commands. The closing "what DeVita does not address" section is good scope discipline.

## 5. ADVERSARIAL FLAGS — cleared
The `.verdict.md` returned CLEAN with only one minor non-blocking note (nephrology referral inference),
no ISSUES of ungrounded/mis-sourced/scope-creep claims left unaddressed. No DeVita-attributed claim is
absent from DeVita. Nothing requires REVISE.

Critical: none. Important: none. Advisory: optionally inline-flag the nephrology/critical-care referral
trigger as general standard (as done for G6PD/calcium) for full consistency — not required for merge.
