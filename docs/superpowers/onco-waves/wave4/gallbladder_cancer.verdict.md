# Adversarial verification — gallbladder_cancer.md

## 1. DOSE LEAK
None. `grep -nE '[0-9]'` on the sidecar hits only: "FGFR2", "IDH1", "HER2/neu"
(gene names, no numbers attached), "CA 19-9" (marker name, not a dose), and
"12th ed." (citation edition). No mg, mg/m2, AUC, Gy, %, or numbered
cycle/schedule anywhere in the file.

## 2. UNGROUNDED CLAIMS
Spot-checked against DeVita 12th ed., Ch. 37 "Gallbladder Cancer" section
(lines ~114196–114922, incl. TNM table, surgery, adjuvant therapy, Figure 37.5
algorithm, radiation therapy, palliative care, and the "Systemic Therapy for
Cholangiocarcinoma" subsection the sidecar explicitly borrows from for GBC).

All load-bearing claims trace to the source:
- Surgery-is-only-curative-option, open vs. laparoscopic cholecystectomy
  preference, absolute contraindications (mets / vascular / nodal spread
  beyond hepatoduodenal ligament) — verbatim match to source.
- Extent-of-resection ladder (wedge liver resection, LN dissection,
  extrahepatic bile duct resection, pancreaticoduodenectomy) — matches.
- Adjuvant therapy grounding in PRODIGE-12/BILCAP (pooled biliary-tract
  trials, not GBC-specific) — matches, and sidecar correctly hedges this as
  extrapolated rather than GBC-specific.
- Chemoradiation for unresectable-intrahepatic-confined disease and
  first-line gemcitabine + platinum for metastatic/extrahepatic disease —
  matches Figure 37.5 algorithm exactly (numeric survival %'s in the figure
  correctly omitted from the sidecar).
- Second-line "no single standard; oxaliplatin/FOLFOX-type regimen showed a
  survival benefit over supportive care" — matches the FOLFOX vs. BSC
  phase 3 data described in text (numbers correctly omitted).
- FGFR2/IDH1 being more established in cholangiocarcinoma generally than
  validated specifically for GBC, and HER2/neu amplification as an emerging
  GBC-specific signal — matches ("Other Targets" paragraph: "In GBC tumors in
  particular, HER2/neu alterations... amplifications occur in up to 19% of
  cases... HER2/neu-targeted therapy... has demonstrated significant results
  preliminarily"; sidecar correctly softens the % into "meaningful minority").
- Palliative goals (biliary/bowel obstruction prevention, stenting, no
  benefit to surgical bypass or resection of distant/nodal disease) — matches
  verbatim.

Two minor points worth flagging for R1 (not fabrications, but softer
inferences than the rest of the draft):
- **Monitoring/follow-up tumor markers.** The sidecar states CA 19-9 and CEA
  should be used post-resection to detect recurrence. DeVita's GBC section
  only establishes CA 19-9/CEA as *diagnostic* markers ("Serum CEA or CA 19-9
  may be elevated, but these tumor markers are not diagnostic... A CEA >4
  ng/mL is 93% specific..."); it does not state a GBC-specific
  surveillance/monitoring protocol using these markers (the adjacent iCCA/eCCA
  subsections do recommend CA 19-9 in surveillance, which is the likely basis
  for the extrapolation). This is a reasonable same-chapter analogy, not an
  invented fact, but it is inference rather than a direct GBC statement.
- **"Extraserosal cholecystectomy" as the T1 procedure.** The source first
  defines "extraserosal cholecystectomy" generally, then separately says "For
  T1 lesions... cholecystectomy is sufficient and can be curative" without
  explicitly re-using the term "extraserosal" for the T1 case. The sidecar's
  parenthetical equates plain cholecystectomy-for-T1 with "an extraserosal
  cholecystectomy." This is a plausible reading of an ambiguous source
  passage, not a contradicted claim, but it's a paraphrase liberty worth a
  second look.

No specific drug dose, trial acronym, or statistic appears in the sidecar
that isn't traceable to the DeVita GBC (or directly-adjacent CCA systemic
therapy) text; nothing looks invented.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT
**CLEAN (ready for R1)**, with two minor non-blocking notes above (tumor-marker
follow-up section is an analogy extrapolated from the iCCA/eCCA surveillance
guidance rather than a direct GBC statement; the T1 "extraserosal
cholecystectomy" phrasing slightly over-specifies an ambiguous source
sentence). Neither is a dose leak or a fabricated regimen/trial/statistic;
both are reasonable, disclosed-in-spirit extrapolations consistent with the
sidecar's own "What DeVita does not resolve for GBC specifically" section.
