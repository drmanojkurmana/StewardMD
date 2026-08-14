# Adversarial verification verdict — indolent_t_cell_lymphoproliferative_gi

## 1. DOSE LEAK
None. Full-file scan for digits found only: "STAT3-JAK2" (gene names, not a dose) at 2 occurrences, and "12th ed." (edition number) in the source line. No mg, mg/m2, AUC, cycle count, or numbered schedule anywhere.

## 2. UNGROUNDED CLAIMS
- Verified: DeVita 12th ed. line 266717 lists "Indolent T-cell lymphoproliferative disorder of the gastrointestinal tract" only as a bare row in the WHO mature T-/NK-cell neoplasm classification table — no surrounding clinical/staging/treatment text for this entity. Confirmed by direct read of the surrounding lines (266700-266730): it's sandwiched between EATL/MEITL and hepatosplenic TCL with zero narrative discussion.
- The sidecar's JAK-STAT/STAT3-JAK2-fusion-directed-therapy claim: checked every "JAK-STAT" hit in devita.txt. The only other occurrence (line 276092) is in the ALL (acute lymphoblastic leukemia) chapter discussing Ph-like ALL kinase alterations — completely unrelated to iTLPD-GI. So this claim has zero DeVita grounding, and the sidecar is honest about that (tagged inline as general-standard, not DeVita). STAT3-JAK2 fusions are a real, published molecular finding for this specific entity in the wider literature, so it's not a fabrication, just correctly disclosed as non-DeVita.
- Every other clinical claim (watch-and-wait, symptom-directed/nutritional first-line, avoidance of aggressive multi-agent regimens, surveillance for transformation markers, referral triggers, coeliac-negative gluten-free-trial distinguishing feature) is generic, uncontroversial haemato-oncology standard-of-care reasoning for an indolent GI lymphoproliferative process — nothing that reads as an invented trial, drug, or statistic. No regimen names, no trial names, no response-rate numbers appear anywhere (consistent with the draft agent's stated deliberate omission).
- All 18 of the ~20 substantive bullet/paragraph lines carry the explicit "(general oncology standard, not from DeVita's section on this disease)" tag; the 2 untagged lines are the doc title and the sourcing-note paragraph, which itself states the same caveat for the whole document.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed. (entity listed in WHO classification table only, no dedicated management content found)." Name only, no page numbers — correct format. Also explicitly notes NCCN not cited.

## 4. VERDICT
CLEAN (ready for R1) — with the caveat already flagged by the draft agent and repeated here for R1's benefit: this entity has no dedicated DeVita treatment content, so the entire management body is generic haem-onc reasoning rather than textbook-specific fact, and should ideally get a WHO Classification / society-guideline citation added at some point rather than resting on DeVita alone. No dose leak, no fabricated regimens/trials/statistics, transparent sourcing throughout.
