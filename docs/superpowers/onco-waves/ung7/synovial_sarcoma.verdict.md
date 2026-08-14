# Verdict: synovial_sarcoma.md

## 1. DOSE LEAK
None. Grepped the sidecar for all digit occurrences: only tumor-size thresholds (5 cm, 10 cm),
genetic notation (t(X;18)), and follow-up timepoints (5-year, 15-year). No mg, mg/m2, AUC, cycle
count, or numbered schedule anywhere. Matches DeVita's own high-dose ifosfamide figure (14-18 g/m2)
and the 3-cycle epirubicin/ifosfamide regimen were both correctly left out.

## 2. UNGROUNDED CLAIMS
None found. Spot-checked every specific claim against devita.txt:
- Pathology/epidemiology, SS18-SSX translocation, TLE1, NY-ESO-1 surface expression, 5yr/15yr
  disease-specific survival pattern -> devita.txt:213882-213931 (dedicated "Synovial Sarcoma"
  pathology subsection). Confirmed verbatim-level match; sidecar correctly omits the 72%/53% figures.
- "high-grade >10cm... synovial sarcoma or myxoid/round cell liposarcoma... any high-risk size"
  neoadjuvant-chemo indication -> devita.txt:215044-215047, near-verbatim match.
- Perioperative/neoadjuvant chemo evidence discussion (ifosfamide-based retrospective survival
  benefit in >=5cm extremity SS, general caveats about small-trial evidence) -> devita.txt:215545-215590
  and dedicated subsection devita.txt:217842-217866 (HR=0.3, P=.007, 88%/67% 4-yr DSS all correctly
  omitted from the narrative).
- "Ifosfamide specifically active... high response rates at high doses in advanced disease" ->
  devita.txt:217859-217861 (13-patient study, 100% RR at 14-18 g/m2 - sidecar omits the dose and n).
- Second-line list (gemcitabine+docetaxel, ifosfamide, pazopanib, dacarbazine) and "ifosfamide more
  useful in SS than LMS" -> devita.txt:217780-217792, near-verbatim general-STS-section match,
  correctly labeled by the sidecar as general standard rather than SS-specific.
- Pazopanib ~modest RR / sorafenib ~no activity / sunitinib+mTOR not well studied ->
  devita.txt:217862-217865, direct match (sidecar correctly omits the 15%/0% figures).
- Trabectedin "has reported activity" -> devita.txt:217864 ("authors' experience, trabectedin has
  activity against this subtype").
- NY-ESO-1/MAGE-A4 TCR cell therapy, HLA-restricted, durable responses in a subset ->
  devita.txt:216898-216923 (ORR 50%/40%, DOR ~30wk correctly omitted).
- Checkpoint inhibitors active in STS broadly but SS not among the subtypes most likely to respond
  (contrasted with UPS) -> devita.txt:216915-216920 ("UPS, liposarcomas, osteosarcoma, and
  dedifferentiated chondrosarcoma" listed as more likely responders, SS absent) - correct, and the
  sidecar explicitly and correctly declines to claim checkpoint-inhibitor efficacy in SS itself.
- Isolated/oligometastatic pulmonary metastasectomy benefit + repeat-resection prognostic factors
  (number/size of lesions, grade) -> devita.txt:216770-216792 (general STS lung-mets subsection
  adjacent to, though not in, the draft agent's disclosed line list - content is genuinely grounded,
  just a minor citation-range gap, not a fabrication).
- Nerve encasement / function-sparing vs. nerve resection for high-grade tumors -> devita.txt:215030-215036
  ("nerve itself (MPNST or synovial sarcoma)... resection may be required" for high-grade lesions).
- Two items are explicitly and correctly self-flagged by the draft as NOT from DeVita's SS section
  (anthracycline monotherapy/doublet as a general perioperative option; >5yr surveillance horizon) -
  both are uncontroversial general-oncology/STS-biology-consistent statements, appropriately labeled.

No fabricated drug, trial name, or statistic was found anywhere in the file.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed."
(name only, no page numbers). Correct format.

## 4. VERDICT
CLEAN (ready for R1).

Minor non-blocking note: the pulmonary-metastasectomy paragraph draws on devita.txt:216770-216792,
which falls outside the specific line ranges the draft agent disclosed (213882-213930, 214940-215060,
215545-215590, 216898-216920, 217842-217866) but is still clearly within the same STS chapter and
genuinely supports the claims made - not a fabrication, just an incomplete self-reported citation list.
