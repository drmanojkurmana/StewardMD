# Adversarial verification verdict — neuroendocrine_tumor.md (wave7)

## 1. DOSE LEAK
None. Grepped for `mg`, `mg/m2`, `AUC`, numbered schedules (`q_w`, `q_d`), mcg — zero hits.
The only numerics present are non-dose: tumor-size thresholds (2 cm, 1-2 cm), staging labels
(R0/R1/N2, stage I-III), a trial name (NETTER-1), isotope names (lutetium-177, gallium-68 —
element identifiers, not doses), a response-rate range (20-30% ORR, prose not a regimen),
a surveillance interval (every 12-24 months), the biomarker name 5-HIAA, and syndrome names
(MEN1, neurofibromatosis type 1). Correctly omits the actual DeVita-stated doses (octreotide
LAR 30 mg, telotristat 250/500 mg TID, perioperative octreotide 25-500 mcg, infusion 50-200
mcg/hr) that are present in the source text — deliberate and correct exclusion, not oversight.

## 2. UNGROUNDED CLAIMS
None found that lack DeVita support and aren't uncontroversial guideline-standard. Spot-checked
against DeVita 12th ed text directly:
- Pancreatic NET resection thresholds (≥2 cm resect, ≤1 cm observe, 1-2 cm unsettled) —
  matches AHPBA/ENETS summary verbatim (DeVita pancreatic NET section, ~L104880-104908).
- Pulmonary carcinoid: no adjuvant benefit after R0; consider adjuvant chemo for N2/aggressive
  histology; R1 → refer to radiation oncology — matches DeVita almost word-for-word
  (~L199-203 of the pulmonary carcinoid excerpt).
- SSA first-line (PROMID octreotide, lanreotide enteropancreatic trial), PFS benefit without OS
  benefit, benefit greatest with lower hepatic burden/resected primary — matches PROMID
  discussion (~L174-187 of carcinoid-syndrome excerpt).
- PRRT/NETTER-1 (phase III, PFS benefit over high-dose octreotide, GEP-NET approval, smaller
  bronchial-carcinoid activity data) — matches (~L98-112 of pulmonary carcinoid excerpt).
- Everolimus RADIANT-2 (combo w/ octreotide, low/intermediate-grade carcinoid) and RADIANT-4
  (monotherapy vs placebo, nonfunctional lung/GI NET) — matches (~L117-139).
- Chemo: SCLC-extrapolated regimens for bronchial carcinoid, CAP-TEM high response/DCR in
  pulmonary carcinoid + liver-met pancreatic NET — matches (~L142-167); the sidecar's 20-30%
  ORR range is consistent with the etoposide/cisplatin ORR reported in that section.
- Immunotherapy: modest/variable ORR, not standard of care, investigational — matches
  spartalizumab/pembrolizumab KEYNOTE discussion (~L169-195).
- Carcinoid syndrome: SSA first-line, tachyphylaxis, telotristat (TELESTAR/TELEPATH,
  reduces BM frequency + urinary 5-HIAA), bile-acid binders/pancreatic enzymes/antibacterials/
  loperamide-opium as adjuncts — matches (~L109-162 of carcinoid-syndrome excerpt).
- Carcinoid crisis: perioperative SSA cover, IV fluids + hemodynamic monitoring + more SSA/
  steroids during a crisis, avoid adrenergic agents (mediator release) — matches (~L206-222,
  L809-816: "adrenergic drugs should be avoided").
- Carcinoid heart disease: tricuspid/pulmonic valve fibrosis from serotonin-driven TGF pathway,
  correlates with higher 5-HIAA, echo screening, early cardiology/surgery referral — matches
  (~L121-137). Sidecar says "substantial minority"; DeVita quantifies ~40% — sidecar is vaguer
  than the source (a safe, non-fabricating simplification, not an ungrounded claim).
- 68Ga-DOTATATE PET superior to octreotide scintigraphy, esp. liver/bone — matches
  (~L74830-74858, "demonstrated superiority... particularly in liver").
- Two claims are explicitly self-flagged inline as NOT DeVita-sourced (poorly-differentiated
  NEC → platinum-based chemo as a class statement; hereditary-syndrome → genetics referral
  implication) — appropriately labeled rather than presented as grounded, and both are
  uncontroversial general-oncology standard.

No fabricated trial names, no invented statistics, no regimen not present in the reviewed
DeVita sections.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." (line 131) — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN — ready for R1.

Notes for R1 (not defects, just texture):
- The "substantial minority" phrasing for carcinoid heart disease prevalence is a deliberate
  vagueness vs. DeVita's ~40% figure — consistent with the no-precise-stats convention, flagged
  here only for awareness, not as an issue.
- The two inline non-DeVita flags (poorly-differentiated NEC chemo class statement; genetics-
  referral implication) are honestly disclosed and low-risk (general oncology standard).
