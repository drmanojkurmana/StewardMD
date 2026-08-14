# Verdict: primary_cutaneous_anaplastic_large_cell_lymphoma (re-verification)

## 1. DOSE LEAK
None. Grepped for `mg|Gy|AUC|mg/m2|mg-m2|%|mg/kg` across the whole file — only three `%` hits, all
incidence/response-rate statistics, not doses: multifocal-disease "up to about 20%", ALCANZA "87%",
LyP-overlap "up to about 20%". The prior "30 Gy" figure is gone; the RT line now reads "dose and
fractionation are set by the treating radiation oncologist per institutional protocol." No mg,
mg/m2, mg/kg, AUC, or numbered cycle/schedule anywhere.

## 2. UNGROUNDED / MISLABELLED CLAIMS
None found.
- Multifocal disease "up to about 20%" — verbatim match to devita.txt.
- ALK-negative / EMA-negative distinction of C-ALCL from systemic ALCL — verbatim match.
- ALCANZA 87% cutaneous-only response rate and later-line FDA positioning (progression after RT
  or ≥1 systemic therapy) — verbatim match, correctly attributed to DeVita, no page number.
- Low-dose oral methotrexate for recurrent disease — matches devita.txt.
- LyP/C-ALCL overlap, "up to 20%" preceded/followed by another lymphoma (MF, ALCL, Hodgkin) —
  matches devita.txt's "Primary CD30+ Lymphoproliferative Disorders" section, which discusses LyP
  and C-ALCL together.
- Peripheral-neuropathy AE bullet is unlabelled but not mis-sourced: it's a non-numeric paraphrase
  of the same ALCANZA-trial toxicity discussion DeVita gives just above the C-ALCL passage
  (67%/59% in the source); no numbers are claimed here, so it's safely worded and still
  DeVita-adjacent, not a fabrication.
- EPOCH-type multi-agent chemo bullet and pentostatin/gemcitabine bullet — now correctly tagged
  "(general oncology standard, not from DeVita's section on this disease)", closing the gap
  flagged in the prior review. Content still matches DeVita's broader CTCL section (EPOCH regimen;
  pentostatin/gemcitabine activity), with every specific dose/response-rate number from that source
  (3-5 mg/m2/d, 1,200 mg/m2, 80%/56%/75% ORRs, etc.) stripped out of the sidecar.
- Observation-option and surveillance-cadence bullets remain correctly tagged as general oncology
  standard, as before.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." Name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN
Ready for R1 re-review. Dose leak from the prior pass is fixed, the two under-labelled bullets are
now tagged consistently with the rest of the doc, and no new fabrication or mis-attribution was
introduced. All spot-checked numeric/statistical claims trace to DeVita's dedicated C-ALCL / CD30+
LPD passage.
