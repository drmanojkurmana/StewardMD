# Adversarial verification verdict — hibernoma.md

1. DOSE LEAK: none. Grepped for mg/mg-m2/AUC/mL/units/q-schedules/cycle/day-numbers and for all bare numerals in the file — the only digit in the entire sidecar is "12" in "DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." No dose, no numbered schedule, no staging number.

2. UNGROUNDED CLAIMS: none found unlabeled. Checked each specific claim against DeVita line 213127-213131 ("Hibernoma is a rare, slow-growing, benign neoplasm that resembles the glandular brown fat of hibernating animals. The literature consists primarily of case reports. Most of these tumors arise within the thorax, though hibernomas of the trunk, retroperitoneum, and extremities are also reported. Excision is generally curative. Hibernomas' molecular underpinnings suggest common chromosomal abnormalities that result in loss of tumor suppressors MEN1 and AIP and upregulation of the brown fat marker UCP1."):
   - rare/slow-growing/benign, brown-fat origin, case-report-dominated literature, thorax-predominant with trunk/retroperitoneum/extremity, excision generally curative, MEN1/AIP loss + UCP1 upregulation — all directly supported, verbatim match.
   - Everything else (MRI characterization, PET/FDG-avidity caveat, core biopsy vs. lipoma/ALT-WDLS differential, marginal-excision-is-adequate, vascularity/bleeding precaution, no role for RT/systemic therapy, no surveillance-imaging protocol, referral thresholds, sarcoma-pathway referral) is explicitly inline-tagged "(general oncology standard, not from DeVita's section on this disease)" or otherwise flagged as inference/absence-of-mention rather than presented as a DeVita finding. None of these are exotic — all are uncontroversial standard soft-tissue-mass workup/management practice, consistent with the labeling. No invented drug, trial, or statistic anywhere.
   - The "What DeVita does not address" section correctly and explicitly scopes the gaps (staging, systemic therapy, RT, margins, follow-up interval) instead of inventing values for them.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. Correct.

4. VERDICT: CLEAN — ready for R1.
