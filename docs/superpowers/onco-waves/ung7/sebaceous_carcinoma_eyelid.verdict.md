# Adversarial verification verdict — sebaceous_carcinoma_eyelid

## 1. DOSE LEAK
None. The only numbers present are surgical margin widths (5-6 mm, 1-3 mm, 5 mm), epidemiologic percentages (75%, 12%, 36%, 18%, 20%, 9%, 50%, 29%, 21%), a stage cutoff (T2c), an age cutoff (<60), a risk score cutoff (3), and a lesion-size cutoff (<1 cm) — all matching DeVita's own numbers verbatim (lines 226397-226444). No mg, mg/m2, AUC, Gy, cycle count, or numbered drug schedule appears anywhere in the file. Correctly, the sidecar explicitly declines to state any systemic regimen for metastatic disease, citing lack of grounding.

## 2. UNGROUNDED CLAIMS
Cross-checked against DeVita 12th ed., "SEBACEOUS CARCINOMA" section (devita.txt lines 226371-226444). Nearly every specific claim traces directly to that section (incidence, MTS/Mayo scoring, pagetoid spread, special stains, AJCC8 staging, margin-recurrence data, MMS vs. WLE recurrence/mortality rates, RT case series, metastasis rate/sites, mortality range, extraocular RR/met rate, <1cm prognosis).

One unflagged addition not found in the DeVita section text:
- "map biopsies of the surrounding conjunctiva may be needed to define the true extent of disease before definitive surgery" — DeVita's section does not mention map biopsies at all. This is a plausible, uncontroversial ophthalmic-oncology practice detail, but it is presented as if grounded (no "general oncology standard" qualifier attached to it), unlike the sidecar's other non-DeVita additions which are explicitly flagged. Minor sourcing/labeling gap, not a fabricated regimen or statistic.

All other non-DeVita additions (MMS-preferred-technique editorializing, RT patient-selection criteria, follow-up recommendation, "guided by NCCN guidance" line) are honestly and explicitly labeled in-line as "general oncology standard, not from DeVita's section on this disease" — good practice, not fabrication.

No specific drug, trial name, or systemic statistic is asserted anywhere; the sidecar affirmatively declines to invent a systemic-therapy line for metastatic/regional disease, which is the correct behavior given the source gap.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1), with one minor note: the "map biopsies of the surrounding conjunctiva" sentence in the Diagnosis/workup section is not supported by the DeVita text and should either be removed or explicitly re-labeled as a general practice note (like the other non-DeVita additions in the same document) before/at R1. This does not rise to a dose leak or a fabricated regimen/statistic and does not block R1 review.
