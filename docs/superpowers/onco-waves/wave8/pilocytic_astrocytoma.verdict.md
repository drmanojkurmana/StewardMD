# Adversarial verification verdict: pilocytic_astrocytoma.md

## 1. DOSE LEAK
None. Full-file scan for `mg`, `mg/m2`, `Gy`, `cGy`, `AUC`, numbered cycles/days/fractions found zero occurrences. Only numeric content present is epidemiologic/outcome statistics (e.g. "roughly a quarter of posterior fossa tumours," "5-year overall survival and progression-free survival around 85% and 70%"), which are not doses or schedules and are directly attributable to DeVita's own reported cohort figures (25%/111 series; 85.3%/70.0% OS/PFS in the 46-patient adult cohort). No mg, mg/m2, AUC, Gy, or numbered regimen schedule anywhere in the sidecar.

## 2. UNGROUNDED CLAIMS
None found. Checked every specific/quantitative or regimen-shaped claim against DeVita Ch. 64 (Cerebellar Astrocytomas ~L241175-241232, Optic/Chiasmal/Hypothalamic Gliomas ~L240830-241031, Brain Stem Gliomas ~L241032-241088):
- GTR "tantamount to a cure" for cerebellar PA — verbatim match (L241204).
- Conservative monitoring of incomplete resection (remnants indolent, resectable later) — matches L241204-241207.
- Surgery rarely indicated for OPG; unilateral anterior/non-chiasmatic resectable, chiasm resection avoided (bilateral blindness) — matches L240897-240907 near-verbatim.
- Dorsally exophytic/cervicomedullary lesions partially resectable with good results vs. diffuse intrinsic not resectable — matches L241071-241083.
- Hydrocephalus managed by CSF diversion (ETV/shunt), sometimes needed even after tumor treated — matches both L240917-240923 and L241075-241076.
- RT not needed after complete cerebellar resection; repeat resection preferred over RT on progression if feasible; RT reserved for multiple recurrences or high-risk residual location — matches L241210-241218.
- RT deferred in young OPG/hypothalamic patients in favor of chemo, to avoid RT vasculopathy (moyamoya) and secondary malignancy, particular NF1 concern — matches L240959-241007 closely, including the moyamoya/secondary-malignancy language.
- Adult PA rare, resection outcomes excellent, RT reserved for unresectable/salvage — matches L241220-241225.
- Chemo not generally indicated for resected/surveilled cerebellar PA — matches L241228 ("In general, chemotherapy is not indicated").
- Platinum + vinca alkaloid as most common first-line for progressive/unresectable OPG/hypothalamic disease in young children; alkylators avoided in NF1 (2nd-malignancy risk) — matches L241008 (vincristine+carboplatin, "most common first-line regimen") and L241025-241026 (alkylator avoidance in NF1). Sidecar correctly generalizes drug class ("a platinum agent... a vinca alkaloid") without naming vincristine/carboplatin specifically — arguably over-cautious but not ungrounded.
- Targetable BRAF fusion/V600E raising possibility of first-line targeted agent — matches L241229-241231 ("Some of these tumors may harbor specific targetable mutations that may allow for a targeted agent as first-line treatment"); sidecar's inline disclaimer that DeVita doesn't name a drug class here is accurate and appropriately hedged (if anything it under-claims DeVita's support, since DeVita does support "targeted agent first-line" as a concept, just not the MEK/BRAF-inhibitor class name — sidecar hedges that specific class-naming appropriately).
- NF1 optic pathway natural history (more indolent, higher spontaneous regression) — matches L240888-240894.
- Adult cohort 5y OS/PFS ~85%/70%, older age + higher BMI worse PFS/OS — matches L241197-241201 (85.3%/70.0%; age >40y and BMI).
- Brain stem gliomas: dorsally exophytic/cervicomedullary favorable vs. diffuse intrinsic unresectable — matches L241036-241039, L241071-241083.
- Ophthalmology/endocrine surveillance recommendation and NF1 combined neuro-onc/genetics follow-up — sidecar itself flags these as general-standard/not-DeVita-sourced inline; appropriately hedged, not presented as DeVita fact.

No regimen, trial name, or statistic in the draft lacks either a DeVita textual anchor or an explicit inline "general oncology standard, not from DeVita" hedge.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN (ready for R1)

No dose/schedule numbers leaked; every specific clinical claim traces to the DeVita Cerebellar Astrocytoma / Optic-Chiasmal-Hypothalamic Glioma / Brain Stem Glioma sections, and the two claims outside DeVita's exact disease-section scope (ophthalmology/endocrine surveillance cadence, specific MEK/BRAF-inhibitor drug class) are explicitly and correctly flagged inline as general-standard rather than DeVita-sourced. Citation line correct. No rewrite needed.
