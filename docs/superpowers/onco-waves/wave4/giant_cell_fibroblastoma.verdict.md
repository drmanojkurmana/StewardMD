# Adversarial verification verdict — giant_cell_fibroblastoma.md

## 1. DOSE LEAK
None. Scanned for mg / mg-m2 / AUC / Gy / cGy / mL / mg-kg / numbered schedules and for every
bare digit in the file. The only digit hits are `1` inside gene names (COL1A1, PDGFB context) and
`12` in "12th ed." in the citation line — no dose, no margin number, no % survival/recurrence
figure, no cycle count. Note DeVita itself gives numeric margins ("≥2 cm") and recurrence rates
("up to 50%... ≤5%") for DFSP; the sidecar deliberately paraphrases these as "a few centimetres"
and "low long-term local recurrence" with no digits carried over. Clean.

## 2. UNGROUNDED CLAIMS
- Minor: the Overview's claim that GCF and DFSP "sometimes recur as, or arise combined with, one
  another" (hybrid GCF/DFSP lesions) is not found anywhere in the DeVita text I could grep
  (searched "combined", "hybrid", "recur... giant cell" near dermatofibrosarcoma/fibroblastoma —
  no hits). This is standard, uncontroversial soft-tissue-pathology knowledge (WHO Classification
  of Soft Tissue Tumours describes GCF-DFSP hybrid/recurrence relationships) but it is not
  DeVita-sourced, and the sidecar's own grounding note admits it partly draws on "the KB's own
  reference note" rather than DeVita alone — so this is disclosed, not smuggled in, but still
  technically an extra-DeVita claim worth flagging.
- Everything else checks out against DeVita lines 211907 (WHO list placement, "intermediate
  locally aggressive," correctly not conflated with DFSP's own separate "intermediate rarely
  metastasizing" category), 212771-212798 (DFSP surgery-as-gold-standard, infiltrative-margin
  risk, R1-observation trend over adjuvant RT, imatinib salvage for recurrent/residual disease,
  rare metastasis tied to fibrosarcomatous transformation), and 218293 (shared PDGFB gene
  rearrangement in DFSP and GCF). No named trial, no unsupported statistic, no drug beyond the
  PDGFR-TKI class (imatinib is named once, explicitly attributed to DFSP data, not asserted as
  GCF-proven).
- No named statistics (recurrence %, metastasis %, survival) are asserted for GCF itself — the
  document correctly flags these as absent from DeVita for GCF and omits them.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." — name only, no page numbers. Compliant.

## 4. VERDICT
CLEAN (ready for R1), with one minor caveat noted above: the GCF/DFSP "hybrid/recurs-as-each-other"
line in the Overview is extra-DeVita (uncontroversial pathology consensus, and the sidecar's own
grounding note already discloses that the GCF-DFSP relationship framing is partly extrapolated
rather than a direct DeVita statement). No dose leak, no fabricated regimen/trial/drug, citation
format correct. Recommend R1 either lightly hedge that one sentence further or leave as-is given
the existing disclosure — not a blocker.
