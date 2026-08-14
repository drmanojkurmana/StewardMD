# Adversarial re-verification — PEComa sidecar (post-revision)

Sidecar: docs/superpowers/onco-waves/ung5/perivascular_epithelioid_cell_tumour.md

## 1. DOSE LEAK
None. Grepped for mg, mg/m2, mg/kg, AUC, Gy, qXw/qXd, cycle/day-numbered schedules — zero hits.
Only numerals present are gene names (TSC1/TSC2/TFE3), the "12th ed." citation, and outcome
statistics stated in words ("the large majority", "a substantial minority", "over two and a half
years") — no dose or schedule accompanies any of them.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Re-checked against DeVita 12th ed. "Neoplasms with Perivascular Epithelioid Cell Differentiation
(PEComas)" (~line 213854) and the nab-sirolimus/everolimus passages (~line 27985, ~213878):
- Angiomyolipoma/LAM benign-spectrum behavior, embolization for large tumors, wide excision
  curative, phase III placebo-controlled everolimus trial, lung transplant in end-stage LAM —
  VERIFIED verbatim.
- Malignant PEComa possible; surgical resection for isolated tumors; mTOR inhibitors for
  metastatic/unresectable disease — VERIFIED verbatim.
- nab-sirolimus FDA approval for locally advanced unresectable/metastatic malignant PEComa, phase
  II trial with clinical benefit in "the large majority" (DeVita: 91%), PR/CR in "a substantial
  minority" (DeVita: 39%) lasting >2.5 years, more common with confirmed TSC2 mutation — VERIFIED,
  faithful qualitative paraphrase of DeVita's exact figures.
- TFE3-fusion subset lacking TSC1/2 alterations, and DeVita's silence on a TFE3-specific regimen /
  on chemo, RT, or non-mTOR targeted agents for PEComa — VERIFIED (refs 290/330); gaps are
  disclosed, not filled with invented content.
- Malignant-risk histologic features paragraph and the monitoring paragraph remain correctly
  labeled "(general oncology standard, not from DeVita's section on this disease)" — honest,
  non-blocking. Minor observation only: the added parenthetical that DeVita "lists these same
  clear-cell/malignant features for the related renal tumour group" is partially precise (DeVita's
  RCC section discusses nuclear grade, necrosis, and vascular invasion as prognostic variables, and
  size via the SSIGN score elsewhere, but doesn't itemize "infiltrative margins"/"high mitotic
  rate" together in that passage). This rides on an already-correctly-labelled general-standard
  claim and is not a primary mislabelling — does not block CLEAN.

**Self-contradiction from prior verdict — RESOLVED.** The "Deliberately omitted" section (lines
74-80) now reads: "Nab-sirolimus is named above because it is the specific mTOR-inhibitor
formulation carrying regulatory approval for this indication; no numeric dose or schedule is given
for it, or for any other agent." This correctly acknowledges the drug name is intentionally present
(and DeVita-grounded, not a dose leak) while confirming no dose/schedule leaked. No new
fabrication or mislabelling introduced by the fix.

## 3. CITATION
Present. Final line: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
Oncology, 12th ed." Name-only, no page numbers.

## 4. VERDICT: CLEAN (ready for R1 re-review)
The R1-blocking self-contradiction is genuinely fixed, not papered over — the revised omission line
is factually accurate about what the body says. No dose/schedule leak, no fabricated
regimen/trial/statistic, no claim mis-attributed to DeVita. One non-blocking observational note
(renal-tumour-group parenthetical, item 2) left for R1's awareness but does not require another
revision cycle.
