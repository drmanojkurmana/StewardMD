# Verdict: anti_amphiphysin_syndrome.md

**1. DOSE LEAK:** none. Scanned every line with a digit (`grep -nE '[0-9]'`) — hits are only
list markers ("1.", "2.", "3.") and "12th ed." in the source line. All DeVita numeric doses
(methylprednisolone 1 g/day, prednisone 1-1.25 g/day, IVIG 0.4-2 mg/kg/day, rituximab 375 mg/m2,
azathioprine 2-3 mg/kg, MMF 500-1000 mg BID, cyclophosphamide 1000 mg/m2 or 1-2 mg/kg,
tocilizumab 8 mg/kg) are correctly omitted; the sidecar names the same drug list with no numbers
attached. "four to six months for up to two years" is spelled out in words, matching DeVita's own
"4 to 6 months for 2 years" screening-interval language — acceptable as a screening cadence, not
a dose/schedule leak.

**2. UNGROUNDED CLAIMS:**
- "Watch for progression of rigidity/spasms into ventilatory compromise, and for evolution into
  encephalomyelitis or myelopathy, which carries a worse prognosis than isolated stiff-person
  disease" (Monitoring section) — no support in DeVita Ch.89. The amphiphysin table lists EM/SNN/SPS
  as phenotypes but the chapter never states a prognosis ranking between them, never uses the word
  "myelopathy," and never discusses ventilatory/respiratory compromise as a complication of SPS.
  Unlike every other non-DeVita-sourced statement in this sidecar (surgery/RT paragraph, symptomatic
  care bullet), this claim is presented with NO "(general oncology standard, not from DeVita...)"
  caveat — it reads as if grounded in the source chapter when it isn't.
- The same claim is repeated near-verbatim in "When to refer" ("rapidly progressive encephalomyelitis
  or myelopathy... severe truncal or respiratory spasms") — same gap, same missing caveat.
  Both are plausible generic neurology knowledge (severe axial SPS spasms can impair ventilation)
  but they are not "uncontroversial guideline-standard" statements and are not in DeVita — they
  should either be sourced elsewhere or explicitly tagged as outside-DeVita like the rest of the doc.
- Everything else checks out against the chapter text (lines ~323125-323470): amphiphysin →
  SCLC + breast cancer, phenotypes EM/SNN/SPS, intracellular-antigen → worse immunotherapy response,
  steroids first-line with IVIG/plasma exchange as alternatives, second-line rituximab/azathioprine/
  MMF/cyclophosphamide, tocilizumab for rituximab-refractory autoimmune encephalitis (with sidecar's
  own caveat that this isn't amphiphysin-specific evidence), "mostly retrospective series and expert
  opinion" framing, and the 4-6 month x2 year re-screening interval — all directly traceable to the
  text at those line numbers. Morvan/CASPR2 correctly NOT attributed to amphiphysin, matching DeVita
  (Morvan → CASPR2/thymoma, line 323350-323355), consistent with the draft agent's stated omission.

**3. CITATION:** Present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
of Oncology, 12th ed." (line 79), name only, no page numbers. Correct.

**4. VERDICT:** ISSUES
- Untagged, DeVita-unsupported prognosis/complication claim (ventilatory compromise / myelopathy
  progression) appears twice (Monitoring; When to refer) without the doc's own established
  "general oncology standard, not from DeVita" disclaimer that it uses elsewhere for extrapolated
  content. Fix: either add that same caveat tag to both instances, or cut the myelopathy/ventilatory
  detail down to what's actually supportable (e.g., "spasms can be severe" without the prognosis/
  progression claim). No dose leak; citation correct; rest of the drug/phenotype/tumor-association
  content is well grounded in the cited chapter.
