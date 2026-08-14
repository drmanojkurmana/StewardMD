# Adversarial verification — Soft-tissue myoepithelioma sidecar

Sidecar: docs/superpowers/onco-waves/ung5/myoepithelioma.md

## 1. DOSE LEAK
None. Grepped for mg, mg/m2, AUC, Gy, q-schedules, cycle/day numbers, percentages. The only digits present are non-dose: "5th ed." / "12th ed." (WHO/DeVita edition numbers), "Chapter 60", and the gene names SMARCB1/INI1, EWSR1/FUS. No numeric dose, no AUC, no numbered schedule anywhere.

## 2. UNGROUNDED CLAIMS
- The one disease-specific fact used (myoepithelioma NOS = "intermediate, rarely metastasizing"; myoepithelial carcinoma = "malignant") is VERIFIED against DeVita 12th ed., Ch. 60 WHO Classification table (line ~212060/212070: "■ Myoepithelioma, NOS" under INTERMEDIATE (RARELY METASTASIZING) TUMORS; "■ Myoepithelial carcinoma" under MALIGANT TUMORS, Tumors of Uncertain Differentiation). Correct and accurately transcribed.
- Everything else (excision-as-cure for benign disease, wide-margin surgery, adjuvant RT for close/positive margins or high-grade disease, anthracycline-based first-line therapy for unresectable/metastatic soft-tissue sarcoma, sarcoma surveillance with chest imaging, referral triggers) is explicitly labelled inline as "general oncology standard, not from DeVita's section on this disease" and/or "NCCN Soft Tissue Sarcoma guidance" — none of it is presented as DeVita-sourced disease-specific fact. These are uncontroversial, guideline-standard STS management principles (not disease-specific to myoepithelioma), so the labelling is honest and matches what's actually in the source.
- No regimen name, trial name, drug name (beyond the generic class "anthracycline-based"), or outcome statistic is asserted as myoepithelioma-specific. The sidecar itself explicitly flags this omission in its own "What was deliberately omitted" section.
- Additional DeVita hits not cited by the draft agent (lines 65757/65799/65837, salivary-gland WHO risk-stratification tables in Ch. 29; lines 67623/67626, WHO lung tumor classification list) were checked directly: these all refer to "Myoepithelial carcinoma" as a distinct salivary-gland or pulmonary entity, not soft-tissue myoepithelioma/myoepithelial carcinoma. Correctly excluded as not applicable to this disease.
- No fabrication found: no invented trial, no invented statistic, no disease-specific regimen asserted as fact.

## 3. CITATION
Present. Final line: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed.; NCCN Guidelines (Soft Tissue Sarcoma), where noted above." Name-only, no page numbers, as required.

## 4. VERDICT: CLEAN (ready for R1)

Notes for R1: this is a thin-grounding case by necessity — DeVita has no dedicated management narrative for soft-tissue myoepithelioma/myoepithelial carcinoma, only a one-line WHO classification placement. The draft agent handled this correctly: verified the one fact it did have, labelled every borrowed general-STS/NCCN claim inline rather than passing it off as DeVita-specific, and explicitly disclosed the omission of any disease-specific regimen/trial/statistic rather than fabricating one. No dose leak, no unlabelled fabrication, citation present. Given the sparse source material, this entry may warrant flagging to a human reviewer as "genuinely under-sourced in DeVita" rather than being treated as a fully vetted disease-specific protocol — but nothing here is fabricated or mislabelled.
