# Adversarial verification verdict — ossifying_fibromyxoid_tumor.md

## 1. DOSE LEAK
None. Grep of all digit-containing lines in the sidecar (lines 7, 12-14, 81, 87) turns up only:
- "age 49 to 50 years" (epidemiology)
- "roughly 85%" / "about half" (translocation frequency)
- "12th ed." (edition number in the source citation)

No mg, mg/m2, AUC, cycle count, or numbered treatment schedule anywhere in the file.

## 2. UNGROUNDED CLAIMS
Checked the sidecar's descriptive paragraph word-for-word against DeVita's dedicated "Ossifying
Fibromyxoid Tumors" passage (Chapter 60, Soft Tissue Sarcoma, ~line 214086 of the extracted text).
Every epidemiology/histology/genetics claim matches DeVita closely (subcutaneous/muscular trunk
and extremity location, male predominance, median age 49-50y, benign/malignant grading by
cellularity/atypia/mitoses with outcome correlation undefined due to rarity, lung/soft-tissue
metastasis with distant recurrence years to decades later, ~85% harboring recurrent
translocations, PHF1 in ~50% fused most often to EP400 with MEAF6/EPC1/TFE3 as other partners,
CREBBP-BCORL1 and KDM2A-WWTR1 in malignant-appearing OFMT). No numeric or genetic claim here is
unsupported.

All therapeutic content (surgery-first, re-excision for recurrence/incomplete margins, adjuvant
RT threshold for high-grade/marginal resection, systemic therapy classes for metastatic disease,
surveillance cadence, sarcoma-center referral) is explicitly and consistently tagged inline as
"(general oncology standard, not from DeVita's section on this disease)" rather than presented as
DeVita-sourced. The only borderline item is the "anthracycline-based regimens, alkylating agents,
or other cytotoxic combinations" sentence in the Metastatic disease bullet — this names drug
*classes* (not a specific drug, dose, or trial) and is immediately flagged as extrapolated from
general STS management, not DeVita's OFMT text. This is uncontroversial guideline-standard STS
systemic-therapy framing, not a fabricated OFMT-specific regimen, so it does not rise to an
ungrounded claim — but it is the one place a careless reader could mistake general-STS framing for
OFMT-specific evidence if the inline tag were missed.

No named trial, response-rate statistic, or targeted agent is asserted for OFMT specifically,
consistent with the draft agent's stated omission.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1).

Rationale: no dose leak of any kind; the DeVita-grounded descriptive claims all check out verbatim
against the source passage; every therapeutic/management claim is honestly and consistently
labeled as general soft-tissue-sarcoma extrapolation rather than DeVita-sourced fact, with no
attempt to dress up unsupported specifics as disease-specific evidence.
