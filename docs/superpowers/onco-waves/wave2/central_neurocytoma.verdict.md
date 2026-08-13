# Adversarial verification — central_neurocytoma.md

## 1. DOSE LEAK
None. Grepped all digits in the file: "WHO CNS grade 2" (tumor grade, not a dose),
numbered list items 1–4 under "Lines of therapy" (a treatment-sequence list, not a
dosing/fractionation schedule), "Ki-67/MIB-1" and "1p/19q" (biomarker/genetic-marker
names), "12th ed" (citation edition). No mg, mg/m2, AUC, Gy, or fractionation numbers
anywhere.

## 2. UNGROUNDED CLAIMS
Grepped DeVita (`devita.txt`) for "neurocytoma" — exactly one hit, confirming the
draft agent's report: a passing list-mention in the raised-ICP/CSF-obstruction chapter
("...meningioma, central neurocytoma, chordoid glioma of the third ventricle...") with
no dedicated management discussion. So none of the sidecar's management content is
DeVita-grounded, and the file says so explicitly (front-matter flag "needs manual
sourcing").

Checked the substantive claims against general neuro-oncology consensus (WHO CNS
classification, standard neurosurgical oncology teaching) since DeVita gives nothing
to check against:
- GTR as primary/curative treatment, STR/atypical histology → adjuvant RT, SRS for
  small residual/recurrent disease, no established systemic therapy role, MRI
  surveillance, synaptophysin + Ki-67/MIB-1 for diagnosis/risk-stratification,
  differential-diagnosis workup (IDH/1p19q/ATRX) vs oligodendroglioma — all of this is
  uncontroversial, textbook-standard neuro-oncology for central neurocytoma, not a
  specific regimen, trial, or statistic. Nothing here rises to a fabricated
  drug/trial/number.
- No specific drug name, trial name, or statistic (%, survival number, dose) appears
  anywhere in the file. The file explicitly states no systemic-therapy claim is made
  ("No cytotoxic, targeted, or other drug-class recommendation can be grounded... so
  none is given here").

Net: no ungrounded specific claims found. The document's honesty about its own
grounding (flagging that DeVita has no dedicated passage, and omitting anything it
couldn't support) is the correct behavior, not a red flag.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
Oncology, 12th ed." — name only, no page numbers. Correct format, though note the
citation is honest-but-thin here since the underlying DeVita support for the *content*
is a single passing mention, not a management section — this is disclosed in the
front-matter flag, so it's not misleading.

## 4. VERDICT: CLEAN (ready for R1)

Rationale: zero dose/numeric leakage, zero fabricated regimens/trials/statistics, the
one real gap (DeVita has no dedicated management passage for this entity) is
transparently flagged in-file rather than papered over, and the substituted
generic-guideline content stays within uncontroversial, well-established neuro-oncology
teaching. R1 should independently confirm the clinical content is consistent with the
existing reference JSON mentioned in the sidecar's own flag, but that's a
cross-reference check, not a fabrication issue.
