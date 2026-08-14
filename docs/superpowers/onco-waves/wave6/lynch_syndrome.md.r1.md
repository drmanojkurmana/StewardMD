# R1 Clinical-Safety Review - lynch_syndrome

VERDICT: APPROVE

goldens changed: no (intended: n/a - reference-content review, no engine/rule change)
Adversarial .verdict.md: not present at expected path (no persisting flags to reconcile).
Confidence: 90

## 1. SAFETY - PASS
No unsafe, misleading, or absolute directives. Language is consistently decision-support
("backbone", "favoured", "reasonable", "appropriate"), never mandatory. No statement would
cause harm if followed:
- Aspirin chemoprevention is framed as trial-rationale (CAPP2), not a blanket order.
- Risk-reducing TAH-BSO is correctly conditioned on "childbearing complete" and paired with
  a counselling caveat on surgically induced menopause / sexual side effects - a genuine
  safety-relevant hedge, not slop.
- The "do not reassure on a recent negative surveillance test alone" line is protective
  (guards against a real false-negative harm pattern).

## 2. GROUNDING - PASS
Treatment claims are consistent with DeVita 12th ed / NCCN standard of care:
- MSI-hi = up to ~1/3 of CRC, endoscopic surveillance/polypectomy backbone: standard, in DeVita.
- CAPP2 aspirin RCT in confirmed Lynch, reduced CRC incidence, no significant excess GI
  bleeding: accurately reflects DeVita's framing of CAPP2.
- Gene-specific endometrial risks (MLH1/MSH2 40-60%, MSH6 16-20%, PMS2 ~15%), ~15% ovarian
  risk, younger age at presentation: consistent with published gene-stratified estimates and
  DeVita's text.
- dMMR/MSI-hi CRC resists adjuvant fluoropyrimidine and responds better to PD-1 blockade:
  well-established standard, correctly attributed.
- Upper-tract urothelial 6% lifetime risk, 3rd most common association, evaluate Lynch if
  <60-65 or suggestive history: standard case-finding point.
No fabricated or outdated regimen. Attribution discipline is strong: every claim NOT located
in the DeVita passages is explicitly relabelled "general oncology standard, not from DeVita's
section" or attributed to NCCN Genetic/Familial High-Risk Assessment (extended colectomy for
metachronous risk; dMMR-immunotherapy extrapolation to non-CRC Lynch cancers; prophylactic
specimen serial-sectioning; extracolonic UGI/urinary surveillance and cascade testing). This
is exactly the required behaviour - no DeVita citation for a claim not in DeVita.

## 3. DOSE-FREE - PASS
Token scan (mg, mg/m2, AUC, qN, day N, cycle, units) returns none. Percentages are risk
figures and ages are ages, not doses. Notably the CAPP2 aspirin dose is correctly omitted even
where tempting.

## 4. SCOPE - PASS
Appropriately hedged as decision-support throughout; the closing "What DeVita did not address"
section flags the gap (no systemic regimen / line sequencing / RT role found) and defers to
NCCN + clinician review rather than inventing directives.

## 5. ADVERSARIAL FLAGS - N/A
No .verdict.md exists, so there are no still-present flagged claims to block on. The sidecar's
own self-labelling of non-DeVita claims pre-empts the mis-attribution failure mode.

## Recommendation
Approve for the reference disease `management` field as-is. Optional (non-blocking) polish:
"Roughly 15% of Lynch syndrome patients carry meaningful ovarian cancer risk" reads as
percent-of-patients when it means lifetime ovarian risk magnitude - could be reworded, but it
is not unsafe or ungrounded.
