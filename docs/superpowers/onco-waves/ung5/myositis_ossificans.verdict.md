# Adversarial re-verification: myositis_ossificans.md (post-revision)

## 1. DOSE LEAK
None. Re-grepped for mg/mg-m2/AUC/Gy/%/numbered schedules across the revised file — no hits (the only digit is "12th ed." in the source line). Consistent with prior pass; disease is benign/non-anticancer so no regimen numbers expected.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Both previously-flagged issues are confirmed fixed:
- **Line 7 (zoning/osteosarcoma comparison, was minor).** Now reads: "...a more ordered zoning pattern than osteosarcoma, DeVita states, with cellular fibroblastic elements centrally and calcified/ossified regions almost exclusively at the periphery, in contrast to the more disorganized, centrally-mineralizing pattern typical of osteosarcoma (general oncology standard, not from DeVita's section on this disease)." DeVita's actual text (devita.txt ~L212698-212705: "a more ordered growth pattern than osteosarcoma, with cellular elements found in the center... and calcified regions almost exclusively in the periphery (zoning)") is kept under DeVita; the added osteosarcoma characterization is now correctly tagged as general standard, not DeVita. Fixed.
- **Line 11 (biopsy/imaging inference, was blocking).** Now reads: DeVita is credited only for the two facts it states — biopsy (Tru-Cut/open) often causes hemorrhage mimicking a vascular neoplasm, and diagnosis "can be made fairly accurately by either plain film or MRI" (devita.txt ~L214320-214327) — and the "favoring imaging-based diagnosis and deferring biopsy" inference is now explicitly tagged `(general oncology standard, not from DeVita's section on this disease)`. Fixed.
- All remaining bullets that go beyond DeVita's literal disease section (observation as default, serial imaging cadence, symptomatic/surgical management, referral triggers) remain transparently labeled "(general oncology standard, not from DeVita's section on this disease)."
- One residual, non-blocking, low-severity item: the sentence "This zoning is the key feature that separates it from extraskeletal osteosarcoma and other sarcomas with metaplastic bone" (end of the histology paragraph) is an unlabeled inference — not a regimen/drug/trial/statistic, and not attributed to DeVita as a direct quote, so it doesn't meet the blocking bar, but R1 may want it tagged too for consistency.
No fabricated drug/regimen/trial/statistic anywhere (correctly none claimed — RT/chemo/systemic therapy explicitly stated as absent from DeVita's section for this benign entity).

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Unchanged, correct format.

## 4. VERDICT
CLEAN (ready for R1 re-review). Both R1-flagged issues (blocking biopsy-deferral mislabel; minor osteosarcoma-zoning mislabel) are resolved — DeVita's actual statements and the general-oncology-standard inferences are now cleanly separated and tagged. No dose leak. Citation correctly formatted. One trivial, non-blocking labeling gap remains (the "key feature... separates it from extraskeletal osteosarcoma" sentence) but does not warrant another REVISE cycle.
