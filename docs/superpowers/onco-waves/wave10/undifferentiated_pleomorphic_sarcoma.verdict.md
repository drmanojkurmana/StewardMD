# Verdict: undifferentiated_pleomorphic_sarcoma.md

1. DOSE LEAK: none. Scanned every number in the sidecar: "60s to 70s" (age), "5%"
   (metastatic-at-presentation rate), "1 mm to 1 cm" (surgical margin distance, not
   a drug dose), "under 5 cm" / "over 5 cm" (tumor-size thresholds), "less than 5%
   myxoid component" (histologic-subtyping cutoff), "a fifth to a third" (5-year
   metastasectomy survival). No mg, mg/m2, AUC, cycle count, or numbered schedule
   anywhere in the file.

2. UNGROUNDED CLAIMS: none found. Every specific regimen/drug/statistic checked
   against DeVita 12th ed (Ch. 60, Soft Tissue Sarcoma) and matches:
   - Margins "1 mm to 1 cm," function-sparing excision, "whoops"/unplanned-excision
     re-excision + adjuvant RT — matches the surgery/extent-of-resection passage
     (~lines 214870-214960, 215062-215066).
   - RT added for deep/>5cm/high-grade/close-margin/extramuscular tumors; small
     superficial single-compartment lesions manageable with surgery alone;
     preop-vs-postop RT tradeoffs (smaller preop field/higher wound-complication
     risk vs. larger postop field/higher dose) and similar local
     control/metastasis-free/overall survival between sequences — matches
     ~lines 215070-215180 (Radiation Therapy for Primary Localized Extremity...,
     Canadian trial discussion).
   - UPS with <5% myxoid component named alongside synovial sarcoma and
     round-cell/pleomorphic liposarcoma as the histologies considered for
     preoperative chemo — matches the Figure 60.7 algorithm text verbatim in
     substance (~line 214930: "Consider preoperative chemotherapy if synovial
     sarcoma, RC/pleo LS or UPS < 5% myxoid component").
   - "Meta-analysis... combined anthracycline-alkylator reduces local recurrence
     and improves overall survival, single-agent anthracycline alone has not shown
     clear survival benefit" — matches the 2008 meta-analysis (OR 0.73 local
     recurrence; OS not sig. improved with doxorubicin alone OR 0.84 vs. improved
     with doxorubicin+ifosfamide OR 0.56) at ~lines 216730-216745.
   - First-line single-agent doxorubicin as standard; doxorubicin-ifosfamide
     combination reserved for good-performance-status patients when a higher
     response is needed (e.g., before resecting metastases); single-agent
     doxorubicin standard for poorer performance status; gemcitabine-docetaxel as
     an alternative with similar efficacy — matches DeVita's "Recommendations for
     Patients with Advanced Disease" almost verbatim (~lines 217784-217800: "When
     a clinical response is needed—for example, before surgery for
     metastases—combinations such as doxorubicin and ifosfamide should be
     considered, especially for patients with good performance status... the
     GeDDiS study indicates that gemcitabine and docetaxel may be equally
     effective").
   - Second-line after anthracycline: gemcitabine-docetaxel, single-agent
     ifosfamide, pazopanib, or dacarbazine — matches DeVita's second-line list
     verbatim in substance (~line 217800: "the second line can be the
     combination of gemcitabine and docetaxel, single-agent ifosfamide,
     pazopanib, or dacarbazine").
   - Metastasectomy: "roughly a fifth to a third... alive at five years" —
     matches "In retrospective series, 20% to 30% of patients who undergo
     metastasectomy are alive 5 years later" (~line 216768).
   - "~5% present with metastatic disease... usually pulmonary" — matches
     "Approximately 5% of patients present with metastasis, typically to lung"
     in the UPS-specific definition passage (~line 214178).
   - UPS as diagnosis of exclusion (formerly MFH, now reserved for pleomorphic
     sarcomas with no definable line of differentiation) — matches ~lines
     214184-214196.

   One completeness gap, not a fabrication: DeVita has a dedicated
   "Undifferentiated Pleomorphic Sarcoma" subsection (~line 217869) reporting a
   23% response rate to pembrolizumab (SARC028 expansion cohort) in advanced UPS.
   The sidecar's advanced-disease section omits any mention of immunotherapy/
   checkpoint inhibition for UPS specifically. This is an omission (arguably
   worth adding for completeness) rather than an invented claim, and does not by
   itself compromise the sidecar's accuracy.

3. CITATION: present and correctly formatted — "Sources: DeVita, Hellman, and
   Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no
   page numbers.

4. VERDICT: CLEAN (ready for R1).
   Optional, non-blocking suggestion for R1: consider adding a one-line mention
   that pembrolizumab/checkpoint immunotherapy has shown response activity
   (~23%) in advanced UPS per DeVita's dedicated UPS subsection, since it is
   disease-specific evidence the current draft doesn't surface.
