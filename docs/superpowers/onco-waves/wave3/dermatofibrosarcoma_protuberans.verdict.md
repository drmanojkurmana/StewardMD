# Adversarial verification verdict - Dermatofibrosarcoma protuberans

## 1. DOSE LEAK
None. Grepped the sidecar for mg / mcg / mg-m2 / AUC / Gy / IU / mL and for every digit sequence.
The only numbers present are: 90% (low-grade fraction, x2), 3 cm (WLE margin), 60% (max reported
recurrence rate), 3 years (recurrence window), 1% (nodal mets), 4% (distant mets), and "12th ed"
in the citation line. No drug dose, no mg/m2, no AUC, no Gy, no numbered cycle/schedule.

## 2. UNGROUNDED CLAIMS
Cross-checked against DeVita Ch. 62 "Dermatofibrosarcoma Protuberans" (Staging, Prognosis, and
Management + Incidence/Clinical Features, lines ~226010-226180 of the source dump). All load-bearing
claims trace directly to that text:
- 90% low-grade / fibrosarcomatous variant staged higher -> matches verbatim.
- AJCC groups DFSP with other soft tissue sarcomas, stage I/II/III/IV mapping -> matches.
- >90% COL1A1-PDGFB fusion driving PDGFR signaling -> matches.
- WLE with >=3cm margin incl. fascia, no elective LND -> matches ("at least 3 cm... without
  elective lymph node dissection").
- MMS comparable-or-better local control, fewer positive margins -> matches the two cited series
  (48-pt retro review, Paradisi et al.) that DeVita reports with exact numbers; sidecar correctly
  generalizes without repeating the numbers, no fabrication.
- Recurrence risk proportional to margin adequacy -> matches ("directly proportional to the
  adequacy of surgical margins").
- RT used selectively when resection inadequate/deforming, DeVita gives no dose -> matches exactly,
  and the sidecar explicitly flags the omission instead of inventing a number. Good practice.
- Imatinib activity in advanced/metastatic disease -> matches ("used with clinical success in
  advanced disease," 9/10 responders in the cited case series).
- Vinblastine/methotrexate = limited data, fallback -> matches verbatim ("Limited clinical data
  are available on the use of chemotherapeutic agents such as vinblastine and methotrexate").
- Fibrosarcomatous variant: higher recurrence + nontrivial metastasis rate -> matches the cited
  41-patient series (58% local RR, 14.7% met rate) without repeating exact figures.
- Recurrence up to ~60%, most within 3 years, head/neck worse than trunk/extremity, ~1% nodal,
  ~4% distant (lung), low mortality -> all matches DeVita's follow-up paragraph.

One soft spot: the sidecar calls imatinib responses "durable" ("has produced durable responses
including in case series..."). DeVita's text (case series: 9/10 responders) doesn't use the word
"durable" in the passage read. This is a mild, guideline-consistent embellishment (imatinib
responses in DFSP are widely described as durable in the broader literature) rather than a
fabricated statistic or regimen, but it is technically an adjective not present in the grounding
text - worth a light touch-up (e.g., "has produced responses, including in case series of locally
advanced or metastatic disease") rather than a blocking issue.

No named regimen, trial acronym, or response-rate statistic appears in the sidecar that isn't
either directly attributable to the DeVita passage above or explicitly flagged as not given by
DeVita (RT dose, follow-up interval). Nothing looks invented.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." - name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1), with one minor optional wording nit: soften "durable responses" to plain
"responses" since DeVita's read passage doesn't use "durable" - not a blocking issue, no numeric
or fabrication problem.
