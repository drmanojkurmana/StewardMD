# Adversarial verification verdict — Myxofibrosarcoma sidecar

Sidecar: `docs/superpowers/onco-waves/wave7/myxofibrosarcoma.md`
Checked against: DeVita 12th ed dedicated "Myxofibrosarcoma" subsection, lines 212965-213023 of
`/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt` (grepped "myxofibrosarcoma", "RICTOR",
"Skp2", "pevonedistat", "Alliance", "mTOR", "integrin", "TRIO" across the full text; confirmed no
other DeVita passage was silently borrowed).

## 1. DOSE LEAK
None. Grepped every numeral in the file (`[0-9]+`). Hits are: "50" (line 8, a local-recurrence
*rate*, not a dose), "10"/"1"/"53" (embedded in "alpha10", "RB1", "TP53" — gene/receptor names, not
doses), "2" (embedded in "Skp2", "phase II" as digit inside "Skp2"), "12" (line 113, "12th ed"
citation). No mg, mg/m2, mcg, AUC, Gy/cGy, IU, mL, or numbered cycle/schedule anywhere. Drug name
MLN0128 (the actual Alliance-trial mTOR inhibitor named in DeVita) is deliberately omitted in favor
of the generic "an mTOR inhibitor" — a conservative choice, not a leak.

## 2. UNGROUNDED CLAIMS
None found that aren't already self-labeled. Checked every DeVita-attributed clinical/genomic claim
against the source text:
- Histology (fibroblastic, curvilinear vascular pattern, myxoid component correlating with
  behavior) — matches DeVita verbatim in substance.
- Recurrence ~50% in high-myxoid tumors — matches DeVita's "up to 50% of cases... associated with
  tumors having a ≥75% myxoid component," though the sidecar merges two adjacent DeVita clauses
  (overall 50% rate; separately, association with ≥75% myxoid) into one sentence tying the 50%
  specifically to "high myxoid fraction." This is a defensible paraphrase, not a fabrication, but is
  a minor interpretive tightening worth flagging to R1.
- Site-based recurrence ordering (lower extremity < upper extremity < truncal) — matches DeVita
  (18%/36%/49%), sidecar correctly omits the specific percentages and the n=197 cohort size.
- Low-grade-to-high-grade progression with recurrence, raising metastatic potential — matches.
- Metastatic sites (lung, bone, lymph node) — matches.
- Copy-number-driven tumor, triploid/tetraploid karyotypes, no single fusion — matches.
- MFS/UPS genetic spectrum (not fully distinct entities) — matches DeVita's TCGA-based statement.
- RICTOR/mTOR via integrin-alpha10/TRIO-RICTOR signaling → Alliance phase II mTOR-inhibitor trial —
  matches DeVita's ITGA10/TRIO/RICTOR/MLN0128/Alliance passage; drug name correctly withheld.
- Skp2/neddylation inhibition (pevonedistat) in RB1/TP53-deficient MFS/UPS — matches DeVita's Skp2/
  pevonedistat passage; drug name correctly withheld, correctly labeled preclinical/not standard.
- All surgery/RT/chemo/surveillance/referral claims are explicitly and consistently tagged inline as
  "general oncology standard, not from DeVita's section on this disease" rather than mis-attributed
  to DeVita. These are uncontroversial soft-tissue-sarcoma guideline standards (wide excision,
  perioperative RT for high-risk tumors, anthracycline ± ifosfamide for advanced disease,
  metastasectomy for isolated resectable pulmonary mets) — not specific enough to be a fabricated
  regimen/trial/statistic, and not presented as MFS-specific evidence.
No specific regimen, dose sequence, trial name/number, or efficacy statistic is asserted without
either DeVita support or an inline "not from DeVita" disclaimer.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." (line 113). Name only, no page numbers — compliant.

## 4. VERDICT
CLEAN — ready for R1.

Minor note for R1 (not a blocker): the merged phrasing of the 50%-recurrence / high-myxoid-fraction
sentence (see item 2) slightly tightens the association DeVita states across two clauses; consider
loosening to "reported up to 50% overall, with recurrence associated with high myxoid content" if
R1 wants stricter 1:1 fidelity to DeVita's sentence structure.
