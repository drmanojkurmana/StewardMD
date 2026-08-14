# Adversarial verification — cutaneous_b_cell_lymphoma.md

## 1. DOSE LEAK
None. Grepped all digits in the file:
- L14/34: "100 percent" / "50 percent" — outcome statistics (CR rate, 5-yr DFS), not doses.
- L24: "20" is part of "anti-CD20" (antigen name, not a dose).
- L43: "12th ed." / "Chapter 68" — citation edition/chapter numbers, not page numbers or doses.
- "low-dose radiotherapy" (L11) is qualitative language only — DeVita's source text gives an explicit
  fractionation (4 Gy in 2 fractions of 2 Gy) at this point, and the sidecar correctly omits that number.
No mg, mg/m2, AUC, cycle count, or numbered schedule anywhere in the file.

## 2. UNGROUNDED CLAIMS
Checked against DeVita 12th ed., Chapter 68, "Cutaneous B-cell Lymphoma" (lines ~272466–272522 of the
extracted text). All core claims are directly supported:
- Subtype-driven management (marginal zone / follicle center vs. leg-type DLBCL) — matches.
- RT/surgery/observation options for indolent disease; RT technique mirrors MF-CTCL — matches.
- Rituximab used in PCBCL incl. widespread disease, evidence "anecdotal," "series are small" — matches almost verbatim.
- Leg-type treated more aggressively due to poor outcomes with RT alone; combined modality following
  nodal-lymphoma paradigms of similar histology — matches.
- Non-leg DLBCL: RT alone can be sole modality — matches.
- CR rate ~100%, 5-yr DFS ~50% for localized CBCL — matches numbers exactly (DeVita: "approach 100%,"
  "approximately 50%").

Two claims are extrapolations beyond the literal DeVita sentence, both already self-flagged in the
sidecar's own text and/or its final Sources line as guideline-general rather than DeVita-sourced:
- "Borrelia burgdorferi" named as the specific species (L8) — DeVita's text only says "Borrelia has been
  identified" without naming the species. Borrelia burgdorferi is the standard/uncontroversial species
  cited in the wider literature for cutaneous marginal zone lymphoma, so this is a reasonable specification,
  not a fabrication, but it is technically more specific than the source line grepped.
- Antibiotic therapy for Borrelia-associated marginal zone lymphoma (L12) — explicitly labeled in-line as
  "guideline-general extension ... DeVita does not detail an antibiotic protocol." Honest self-flagging;
  content itself (doxycycline-type approach in Borrelia-endemic regions) is uncontroversial guideline-standard.
- "anthracycline-based, rituximab-containing immunochemotherapy regimen" for leg-type (L20/L28) — DeVita
  only says treatment "follow[s] those used in nodal lymphomas of similar histology" without naming a
  regimen class. The sidecar's gloss (anthracycline + rituximab, i.e., describing R-CHOP-type therapy
  without naming it or giving doses) is the uncontroversial standard-of-care description for nodal DLBCL
  and is not asserted as DeVita-sourced elsewhere (the "Role of surgery/radiotherapy/systemic therapy"
  section explicitly says "DeVita does not specify a preferred agent set beyond rituximab").

No fabricated trial names, no invented statistics, no specific drug list beyond rituximab presented as
DeVita fact.

## 3. CITATION
Present and correctly scoped: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
Oncology, 12th ed. (Chapter 68, Cutaneous Lymphomas)." — name/edition/chapter only, no page numbers.

## 4. VERDICT: CLEAN (ready for R1)
No dose leak, no fabricated regimens/statistics, all load-bearing figures verified against DeVita text,
extrapolations beyond the source are honestly self-flagged as guideline-general rather than DeVita fact.
