# Adversarial RE-verification verdict — extramammary_paget_disease (post-revision, round 3)

## 1. DOSE LEAK
None. Grepped for mg/mg-m2/AUC/Gy/mcg/mL/numbered-schedule tokens — zero hits. Only numerics present: 5%, 40% (line 10, perianal-Paget progression stats), 30%, 40% (line 14, WLE local recurrence), and "12th ed." in the citation. All rates/edition, no doses.

## 2. UNGROUNDED / MISLABELLED CLAIMS
None found. This revision fixes the single defect from the prior round (invented "recalcitrant"/"unfit for"/"unwilling to have" RT-indication language attributed to DeVita). Re-checked both instances against DeVita Ch.62 "EXTRAMAMMARY PAGET DISEASE" (devita.txt lines ~226446-226540):
- **Line 8**: now reads "...radiotherapy has also been reported for EMPD with some success, providing local control in retrospective series" under the DeVita attribution — this matches DeVita's actual sentence ("RT has also been reported for EMPD with some success and has provided local control of disease in retrospective series"). The "unfit for, unwilling to have, or whose disease is recalcitrant to other local treatment" qualifier is now its own sentence, explicitly tagged "(general oncology standard, not from DeVita's section on this disease)" — correct, since DeVita's own "recalcitrant" usage modifies surgical salvage of imiquimod failures, not RT.
- **Line 15**: same fix applied — the "per DeVita" sentence is trimmed to only the local-control/retrospective-series claim, and the recalcitrant/unfit/unwilling qualifiers are separately tagged general-oncology-standard.
- Imiquimod as effective first-line therapy for primary EMPD — matches DeVita ("...is an effective first-line therapy for primary EMPD"). Correctly tagged "per DeVita."
- WLE local recurrence "30% to 40%" and Mohs "lower local recurrence in retrospective series" — matches DeVita's "local RRs may be as high as 30% to 40%" and "MMS may be a superior option, with historical local RRs of 12%-18%..." (sidecar omits the specific Mohs percentages and the named multicenter-study figures, which is a safe simplification, not a fabrication).
- Perianal Paget "~5% progress to invasive" / "up to 40% in untreated disease" — matches DeVita's Anal Paget subsection verbatim sense, correctly flagged as two distinct figures for two different scenarios, and correctly not claimed as coming from the Ch.62 EMPD section itself.
- Pre-treatment colonoscopy + GU malignancy screening — matches DeVita verbatim sense ("...should undergo a colonoscopy and appropriate screening for genitourinary malignancy prior to initiating treatment").
- Tubo-ovarian adenocarcinoma / GI cancer association — matches DeVita's Anal Paget subsection.
- Axillary EMPD as rare primary site — matches DeVita ("Rare cases of primary EMPD have also been described in the axillae"), correctly caveated as lacking site-specific workup detail in DeVita.
- PDT, systemic-therapy-follows-site-pathway framing, invasive-disease adjuvant RT/chemo framing, site-specific screening-modality extension, MDT/referral bullets — all correctly tagged "(general oncology standard, not from DeVita's section on this disease)"; none of these appear in DeVita's EMPD section.
- No claim remains mis-attributed to DeVita.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name + edition only, no page numbers. Correct format.

## 4. VERDICT: CLEAN — ready for R1 re-review
No dose leak (re-verified), no em/en dashes (re-verified via unicode-aware scan), citation format correct, and the single round-2 defect (invented DeVita-attributed RT indication language) is genuinely fixed in both instances (lines 8 and 15). No new or remaining fabrication/mislabelling found on this pass.
