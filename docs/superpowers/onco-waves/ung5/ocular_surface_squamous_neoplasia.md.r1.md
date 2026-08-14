# R1 Clinical-Safety Review — ocular_surface_squamous_neoplasia

VERDICT: APPROVE

goldens changed: no (intended: n/a — narrative content only, no engine/rule/data change)
Confidence: 90

## 1. SAFETY — pass
No unsafe, misleading, or absolute statements. Notable safety-positive points:
- Directs biopsy/histology before destructive or excisional treatment of any lesion suspicious
  for OSSN, including "atypical or recurrent pterygium" — this correctly guards against treating a
  malignancy as a benign pterygium.
- "Fixed to sclera / new leukoplakia / suspicious regrowth → repeat biopsy rather than assume
  superficial" is appropriately conservative.
- Radical surgery (enucleation/exenteration) framed as last resort — no overstatement toward
  aggressive intervention.
No definitive diagnostic or prescriptive directive that oversteps decision-support.

## 2. GROUNDING — pass
Every treatment claim is consistent with accepted ophthalmic-oncology standard of care:
- Intraepithelial disease: surgical (no-touch excision + cryotherapy to margins + alcohol
  epitheliectomy for corneal involvement) OR topical (interferon alfa-2b, mitomycin C, 5-FU) —
  standard (Shields/Kanski technique). Agents named as classes only.
- Invasive SCC: wider excision, escalation to enucleation/exenteration for deep orbital/intraocular
  invasion; plaque brachytherapy/EBRT for positive-close margins or recurrence — standard.
- No routine systemic chemo for localised disease; systemic reserved for rare nodal/distant spread
  managed as cutaneous/mucosal SCC via tumour board — correct.
- HIV/immunosuppression work-up for aggressive or young-onset disease — correct, well-established
  OSSN association.
No fabricated or outdated regimen. Crucially, the draft does NOT attribute any of this to DeVita —
it explicitly states DeVita 12th ed. was searched and contains no disease-specific management for
OSSN, and labels every section "general oncology standard, not from DeVita." This satisfies the
hard rule against citing DeVita for a claim not in DeVita.

## 3. DOSE-FREE — pass
No numeric dose leaked. Only digits present are "12th ed." (edition) and "alfa-2b" (drug name
suffix). Confirmed against the adversarial grep. No mg, mg/m2, AUC, or numbered schedule.

## 4. SCOPE — pass
Appropriately hedged as decision-support: "choice depends on...", "no claim about first-line
preference asserted as consensus, since practice varies", refers out to ophthalmic oncology /
medical oncology / tumour board at the correct decision points. Not a directive.

## 5. ADVERSARIAL FLAGS — resolved, no blocking issue
The .verdict.md returned CLEAN. Its only flag is a COVERAGE concern (effectively 0% DeVita-sourced
content), not a citation-integrity or ungrounded-claim problem. This is honest degradation: DeVita
genuinely lacks an OSSN section, and the draft self-discloses this rather than fabricating a
source. No flagged claim survives mis-attributed to DeVita, so the "REVISE on unresolved flags"
condition does not trigger.

Non-blocking note for the KB owner: because this entry carries no DeVita grounding, it rests on
ophthalmology standard-of-care (Kanski / WHO Eye Tumours / NCCN cutaneous-SCC-by-extension). That
is acceptable for a rare non-DeVita disease and the sidecar is transparent about it. Optional
future improvement: cite a primary ophthalmic-oncology source (e.g. Shields, or AAO Basic &
Clinical Science Course) in the reference entry so the general-standard claims have an explicit
anchor. Not required for approval.

## Critical: none
## Important: none
## Advisory: consider anchoring the general-standard claims to an explicit ophthalmic-oncology
reference in the KB entry, given zero DeVita coverage for this disease.
