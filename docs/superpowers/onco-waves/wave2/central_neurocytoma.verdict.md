# Adversarial re-verification — central_neurocytoma.md (post-revision)

## 1. DOSE LEAK
None. Grepped for mg/mg-m2/AUC/Gy/cycle/q-schedule/day-1/every-N-days patterns: no real
hits. (`grep -i "gy\b"` false-positived on word endings like "oncology"/"histology"/
"radiology" — no actual radiation-dose unit "Gy" appears.) The only numbers in the file
are "WHO CNS grade 2", the 1–4 treatment-sequence list under "Lines of therapy" (not a
dosing schedule), and "12th ed." in the citation. No mg, mg/m2, AUC, Gy, or fractionation
numbers anywhere.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Re-grepped DeVita (`devita.txt`) for "neurocytoma": exactly one hit, at the raised-ICP/
CSF-obstruction chapter — "...meningioma, central neurocytoma, chordoid glioma of the
third ventricle..." — a passing list-mention, no dedicated management discussion.
Confirmed accurate.

Body content (GTR as primary/curative treatment; EVD/ETV/shunt for acute hydrocephalus;
transcortical/transcallosal surgical approach; adjuvant RT for incomplete resection,
atypical histology, or recurrence; SRS for small residual/recurrent disease; no
established systemic-therapy role; MRI surveillance; synaptophysin + Ki-67/MIB-1 for
diagnosis/risk-stratification; IDH/1p19q/ATRX workup vs oligodendroglioma) is generic,
uncontroversial neuro-oncology/WHO-classification teaching — no specific drug name,
regimen, trial name, or statistic (%, survival number, dose) appears anywhere in the
file, and none of it is attributed to DeVita in the body text. DeVita is named only in
the intro disclaimer and the closing Sources line, both purely to disclose the gap, not
to cite content. No mis-attribution found.

## 3. CITATION
Fixed since prior review. Previously the Sources line read simply "DeVita, Hellman, and
Rosenberg's Cancer... 12th ed." crediting the whole narrative to DeVita despite DeVita
having no dedicated management passage for this entity — that was the R1-blocking
mis-attribution. Now reads: "Sources: general neuro-oncology standard of care and WHO
CNS tumor classification principles (general oncology standard, not from DeVita's
section on this disease). DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed. was searched but contains no dedicated clinical
management text for central neurocytoma (only a single passing list mention in the
chapter on raised intracranial pressure); no clinical claims in this document are
attributed to DeVita." Name only, no page numbers, correctly labelled per house
convention (matches `chondroblastoma.md`'s handling of the same DeVita-thin situation).
Mis-attribution resolved.

## 4. VERDICT: CLEAN — ready for R1 re-review.

Rationale: zero dose/numeric leakage, zero fabricated regimens/trials/statistics, the
DeVita-thin gap is now correctly disclosed rather than papered over with a misleading
citation, and all substituted content is uncontroversial, well-established
neuro-oncology teaching that stays within the file's own disclaimed scope. R1 should
still independently cross-check the clinical content against the existing reference
JSON mentioned in the sidecar's own flag, but that is a cross-reference check, not a
fabrication issue.
