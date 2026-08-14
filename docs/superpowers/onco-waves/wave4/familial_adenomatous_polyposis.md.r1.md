# R1 Clinical-Safety Review: familial_adenomatous_polyposis

VERDICT: APPROVE

goldens changed: no (intended: n/a — this is a KB reference narrative, no engine/golden output affected)

## 1. SAFETY — PASS
No unsafe, misleading, or harmful directive. Key checks:
- "essentially all affected patients eventually progress to colorectal cancer" — accurate for
  classic FAP with colon in situ; correctly frames colectomy as the definitive intervention.
- Chemoprevention is explicitly bounded: "adjunct to surgery and surveillance, not as a
  substitute for risk-reducing colectomy." This prevents the dangerous misread that NSAID/COX-2
  chemoprevention replaces colectomy.
- No absolute treatment command; all actions are framed as surveillance/referral/consideration.
- Referral triggers (rapidly increasing polyp burden, discrete mass, enlarging desmoid with
  bowel/ureteric compromise, duodenal/periampullary adenoma with advanced histology, new
  neurological features) are appropriate red-flag prompts, not over-reach.

## 2. GROUNDING — PASS
Consistent with DeVita/NCCN standard of care. No fabricated or outdated regimen. Claims sourced
to DeVita's FAP/colon-cancer content are left unlabelled; claims NOT in DeVita's FAP section are
each inline-tagged "(general oncology standard, not from DeVita's section on this disease)":
desmoid/surgery association, desmoid imaging surveillance, sulindac/COX-2 chemoprevention,
PTC/ultrasound thyroid detail. No claim is mis-attributed to DeVita. The "What DeVita does not
specify" section correctly declines to invent duodenal-surveillance start age/interval or a
systemic regimen for polyposis itself.

## 3. DOSE-FREE — PASS
Only numerics are screening ages/intervals (10-12 y sigmoidoscopy start; 1-3 y upper endoscopy)
and the edition number (12th). No mg, mg/m2, AUC, or numbered drug-cycle schedule. Clean.

## 4. SCOPE — PASS
Appropriately hedged as decision-support: prevention-oriented framing, explicit deferral of
established-CRC management to the standard CRC track, explicit statement that no line-of-therapy
sequence is asserted, and a dedicated "what the source does not specify" disclosure. Not a
directive.

## 5. ADVERSARIAL FLAGS — RESOLVED
The .verdict.md (2nd pass) returned CLEAN. The two residual gaps from the prior pass
(desmoid-formation-after-surgery; desmoid imaging surveillance) are now consistently relabelled
as general-oncology-standard rather than DeVita-specific. Both claims are clinically
uncontroversial, and the relabelling is exactly the corrective this review requires. No DeVita
mis-citation remains, so the APPROVE gate is satisfied.

## Advisory (non-blocking)
- Line 5: "essentially all" is defensible for classic FAP but consider "nearly all" for softer
  phrasing consistency with decision-support tone. Optional, not a safety issue.
