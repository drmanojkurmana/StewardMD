# Adversarial verification: sertoli_leydig_cell_tumour.md

## 1. DOSE LEAK
None. Grepped for numeric dose patterns (mg, mg/m2, AUC, IU, etc.) — zero hits. No numbered
chemo schedule anywhere in the file.

## 2. UNGROUNDED CLAIMS
Checked every specific claim against `devita.txt` (grep "sertoli", "DICER1", "heterologous",
"retiform", "androblastoma", "gynandroblastoma"). DeVita's SLCT text (lines ~178411-178414) is
exactly three sentences: virilization from testosterone, "surgical resection is usually curative,"
and possible response to GnRH analogs in advanced disease — confirmed verbatim. The
lymphadenectomy-omission claim (line 18-21 of sidecar) is also confirmed, verbatim in the same
DeVita paragraph, stated for the sex-cord stromal group (GCT/JGCT) rather than SLCT specifically —
sidecar labels this correctly as borrowed-from-the-class, not SLCT-specific. The inhibin/GCT
monitoring analogy (Monitoring section) is likewise confirmed in DeVita and correctly scoped to GCT
only.

Everything else in the sidecar that is NOT in DeVita's SLCT lines is explicitly and correctly
flagged inline as "(general oncology standard, not from DeVita's section on this disease)" —
this includes: total hysterectomy/BSO + debulking for advanced/poor-risk disease, platinum-based
combination chemo, radiotherapy's absence, testosterone/imaging surveillance protocol, and DICER1
germline testing. None of these are presented as if DeVita-sourced, and none are exotic — all are
uncontroversial gynecologic-oncology standard-of-care statements (staging surgery for high-risk
histology, platinum-based chemo for high-risk sex-cord stromal tumors, DICER1 testing in young/
retiform SLCT is an established real association). Checked devita.txt for DICER1 — the one hit
(line ~67933) is in an unrelated adjacent-tumor-type context, not attributed to SLCT by the
sidecar either, consistent with the sidecar's honest labeling.

No fabricated trial names, no fabricated statistics (%, survival numbers, response rates) tied to
SLCT anywhere in the file.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." — name only, no page numbers. Correct per rules.

## 4. VERDICT: CLEAN (ready for R1)

No dose leak, no unlabeled/unsupported specific claims, correct citation format. Every claim beyond
DeVita's narrow SLCT text is explicitly inline-labeled as general-standard rather than misattributed
to DeVita, and those general-standard claims are themselves uncontroversial guideline-level
statements, not invented specifics.
