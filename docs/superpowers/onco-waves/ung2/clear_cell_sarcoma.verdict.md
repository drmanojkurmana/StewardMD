# Adversarial verification verdict: clear_cell_sarcoma

## 1. DOSE LEAK
None. Every numeral in the file is non-dose: gene/fusion labels (EWSR1-ATF1, EWSR1-CREB1), tumor
size threshold ("5 cm"), survival statistic ("5-year survival approaches 50%"), IHC marker names
(S100, HMB-45), and the edition number ("12th ed"). No mg, mg/m2, AUC, or numbered
cycle/day/schedule anywhere.

## 2. UNGROUNDED CLAIMS
None found unsupported. Cross-checked against DeVita lines ~214057-214081 (dedicated "Clear Cell
Sarcoma" narrative) and the fusion table at ~212464-212478:
- Tendon/aponeuroses origin, melanocytic differentiation, EWSR1-ATF1 (>75%) / EWSR1-CREB1 (<5%),
  t(12;22) — matches DeVita verbatim.
- S100/HMB-45/melan-A IHC profile — matches.
- Surgical resection as treatment of choice; gross nodal disease resected with primary; sentinel
  node biopsy "can be considered," "clinical utility debated" — matches DeVita almost verbatim.
- Size <5 cm at diagnosis; 5-year survival ~50% — matches.
- "Chemotherapy has limited efficacy, platinum-containing regimens offering the most potential
  benefit," antiangiogenic activity (sorafenib, sunitinib) — matches DeVita verbatim (footnotes
  347,348 in source).
- "Malignant melanoma of soft parts" synonym (title line) — not the exact phrase found in this
  DeVita excerpt, but this is the well-established historical/pathology synonym for the entity
  (per Enzinger's original description referenced in DeVita's citation list); uncontroversial
  nomenclature, not a fabricated claim.
- All items the draft agent flagged as ungrounded (chemo line sequencing, named immunotherapy
  agents, MET-pathway inhibitor specifics, RT dose/sequencing) are correctly labeled in the
  sidecar's own "What is not established" section as absent from DeVita and not inferred — this
  is honest self-scoping, not a violation.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN — ready for R1.
