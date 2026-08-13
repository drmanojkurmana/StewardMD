# Adversarial verification: ganglioglioma.md

Grounded against DeVita 12th ed, "GANGLIOGLIOMAS" section (lines ~241250-241318 of devita.txt: Clinical/Pathologic, Surgery, Radiation Therapy, Chemotherapy).

## 1. DOSE LEAK
None. Grepped for `mg|Gy|AUC|dose|dosing` and all digit sequences (`[0-9]+`):
- "600" hits are all from "BRAF V600E" (a mutation name, not a dose) — lines 5, 30, 46, 52.
- "12" is the DeVita edition number ("12th ed") — line 52.
- "1" is from "R1-gated" (internal KB cross-reference), not a dose — line 50.
- The words "dose"/"dosing" appear twice (lines 20, 50) but only qualitatively ("higher-dose radiotherapy... generally warranted", "does not give a numeric radiotherapy dose recommendation... so no doses are given") — no mg, mg/m2, AUC, Gy, or numbered schedule anywhere.
DeVita's own numbers (54 Gy, 60 Gy, 10-year local control 62% vs 52%, 10-year OS 65% vs 74%, 5-year PFS 85%, BRAFV600E in 20-50% of cases) are all correctly omitted/generalized into qualitative language ("substantial proportion," "trend toward improved... survival that has not reached statistical significance," "higher-dose radiotherapy," "reasonable option").

## 2. UNGROUNDED CLAIMS
One flagged item, and it is self-disclosed rather than hidden:
- BRAF-targeted therapy (BRAF inhibitor +/- MEK inhibitor) for BRAF V600E-mutant higher-grade/unresectable ganglioglioma (lines 30, 46) is NOT present in DeVita's ganglioglioma text. The sidecar explicitly flags this inline ("DeVita's text on ganglioglioma itself does not detail this... included here only as guideline-general practice") and cites NCCN separately in the sources line. This is uncontroversial guideline-standard practice for BRAF V600E-altered glial/glioneuronal tumors (dabrafenib+trametinib class), so it clears the bar for inclusion — but it is technically outside DeVita and correctly labeled as such.
- No other regimen, drug, named trial, or specific statistic appears without DeVita support. Cross-checked: astroglial-variant grouping, GTR/STR distinction, no-consensus-on-adjuvant-RT, chemo-as-salvage-only, disease-stabilization-as-endpoint, combined-modality-limited-evidence — all traced directly to the DeVita excerpt.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. (A second NCCN attribution is appended, scoped explicitly to the one BRAF-targeted-therapy sentence; this is transparent, not a substitute for or dilution of the primary DeVita citation.)

## 4. VERDICT: CLEAN (ready for R1)

No dose leak, no fabricated regimens/trials/statistics, primary source line present and correctly scoped, the one non-DeVita claim (BRAF-targeted therapy) is transparently flagged with its own separate guideline citation rather than misattributed to DeVita.
