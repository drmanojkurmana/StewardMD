# R1 Clinical-Safety Review — anti_hu_paraneoplastic_syndrome (management narrative)

VERDICT: APPROVE (with advisory relabel; conditions below)

goldens changed: no (intended: n/a — reference-KB narrative, no engine/golden path touched)

adversarial-verify verdict file: NOT PRESENT at the given path (.verdict.md). No prior flagged
issues to cross-check, so the mandatory-REVISE-on-still-present-flag rule does not trigger.

## 1. SAFETY — pass
- No unsafe or harmful directive. "Start acute immunotherapy without waiting for antibody results
  (once infection is excluded)" is correctly gated on excluding viral/bacterial infection first,
  matching standard practice — no harm risk.
- Expectations are honestly framed: T-cell-mediated neuronal loss is largely irreversible, goal is
  stabilisation not reversal. This prevents overtreatment/false-hope harm.
- Red flags (bulbar/respiratory brainstem involvement, dysautonomia with arrhythmia risk,
  pseudo-obstruction -> perforation/malnutrition) are called out for escalation. Good.
- "Antibody titre is not a validated way to track response" is correct for an intracellular-antigen
  syndrome and prevents a misleading monitoring practice. Safe.
- No absolute/definitive diagnostic or curative overclaim.

## 2. GROUNDING — pass, one attribution nit
- Core claims align with DeVita/standard paraneoplastic care: anti-Hu ~SCLC dominance, intracellular
  antigen -> poor response to antibody-directed immunotherapy, tumour treatment as primary
  intervention, steroids/IVIG/PLEX first line, rituximab/azathioprine/MMF/cyclophosphamide second
  line. No fabricated or outdated regimen.
- The draft is unusually disciplined about attribution: it repeatedly labels non-DeVita statements
  as "general oncology standard, not from DeVita's section on this disease." That satisfies the
  "do not cite DeVita for a claim not in DeVita" bar for those items.
- NIT (advisory, not blocking): Section 4 tocilizumab ("IL-6-directed antibody ... refractory to
  rituximab") is drawn from autoimmune-encephalitis literature and is likely NOT in DeVita's
  paraneoplastic section, yet it lacks the "general standard, not from DeVita" disclaimer that
  neighbouring non-DeVita claims carry. It is clinically uncontroversial and hedged ("may be
  considered"), so per the review rule it is acceptable ONLY if relabelled as general-standard
  (AE literature), not DeVita-specific. ACTION: add the same non-DeVita disclaimer to the
  tocilizumab line before publish.

## 3. DOSE-FREE — pass
- No mg, mg/m2, AUC, or numbered schedule. Numeric strings present are epidemiology/surveillance
  intervals only (">70 percent" association; "every four to six months for up to two years"),
  not drug doses.
- Advisory: "oral prednisone-class dosing over several days" — no number leaks, but the word
  "dosing" plus "over several days" edges toward schedule language. Recommend trimming to
  "corticosteroid therapy (IV methylprednisolone or oral prednisone-class), with IVIG and plasma
  exchange as alternative/add-on" and let the structured template own duration.

## 4. SCOPE — pass
- Consistently decision-support, not directive: "realistic goal," "may be considered," "belongs in
  the structured protocol/regimen template, not in this narrative," multidisciplinary/referral
  framing. Appropriately hedged.

## 5. ADVISORY
- The inline "(general oncology standard, not from DeVita...)" parentheticals are correct for
  internal grounding transparency but read as editorial/review annotations inside a
  clinician-facing management field. Consider consolidating source caveats into a single note or
  moving them out of the reader-facing prose.

## Conditions for merge
Non-blocking. APPROVE stands provided the tocilizumab line gets the same "general standard, not
DeVita-specific" relabel as its neighbours (item 2 nit). The "dosing"/parenthetical items are
advisory polish and do not block.
