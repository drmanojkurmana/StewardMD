# R1 Clinical-Safety Review: brooke_spiegler_syndrome

VERDICT: APPROVE

## 1. SAFETY - PASS
No unsafe, misleading, or absolute claims. Correctly frames the syndrome as
predominantly benign with symptom-control/surveillance intent rather than
systemic anticancer therapy. RT is appropriately cautioned (case-report trigger
for malignant transformation) and reserved for confirmed transformation.
Biopsy-any-changing-lesion and lifelong follow-up guidance is safe and standard.
No statement would cause harm if followed.

## 2. GROUNDING - PASS
No fabricated or outdated regimen. The draft names no specific drug, trial, or
statistic, and explicitly declines to name an NF-kB/CYLD-targeted agent
("no established, clinically validated targeted drug regimen ... can be cited
here without inventing a claim, so none is given") - correct restraint. All
treatment claims (excision as mainstay, CO2 laser/electrodesiccation/dermabrasion
debulking, transformed-lesion management per corresponding sporadic histology,
autosomal-dominant CYLD germline testing/cascade counseling) are uncontroversial
dermatology/oncology standard of care.

## 3. DOSE-FREE - PASS
No numeric dose. Only numeric token is "12th ed." (edition), not a dose. No
mg / mg/m2 / AUC / Gy / numbered schedule.

## 4. SCOPE - PASS
Appropriately hedged as decision-support: refer-to-specialist framing throughout
(dermatology, dermatologic/plastic surgery, clinical genetics, medical/surgical
oncology only on confirmed transformation). No directive overreach.

## 5. ADVERSARIAL FLAGS - PASS
The .verdict.md returned CLEAN: no dose leak, no ungrounded claims, citation
present. Independently corroborated by its DeVita full-text grep (zero hits for
Brooke-Spiegler/cylindroma/turban tumour/spiradenoma; CYLD/trichoepithelioma hits
unrelated). No flagged issue remains in the sidecar.

Critical distinction handled correctly: the draft does NOT attribute any claim to
DeVita. It opens with a "needs manual sourcing" FLAG, labels every claim as
"general oncology/dermatology standard (not from DeVita)", and cites DeVita only
to document the absence of a chapter - not as a source. This satisfies the
"do not cite DeVita for a claim not in DeVita" rule.

goldens changed: no (intended: n/a - reference narrative, no engine/golden impact)

## Note (non-blocking, advisory)
The top-line "needs manual sourcing" FLAG should be preserved into the KB entry
(or the entry tagged low-confidence) so the honest ungrounded-in-DeVita status
carries through to any downstream reviewer/clinician.
