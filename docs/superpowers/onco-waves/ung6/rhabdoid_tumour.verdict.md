# Adversarial verification verdict — rhabdoid_tumour.md

1. DOSE LEAK: none. Grepped for digits, mg, m2/m², AUC, Gy, cycle, q[0-9], day 1, dose — every numeric hit is a gene name (SMARCB1, SMARCA4) or the "12th ed" citation. No dose, no numbered schedule.

2. UNGROUNDED CLAIMS: none found unsupported.
   - The one DeVita-attributed clinical claim (SMARCB1/INI1 loss -> EZH2 upregulation -> EZH2-inhibitor trials in SMARCB1-deficient neoplasms including malignant rhabdoid tumor, epithelioid sarcoma, poorly differentiated chordoma) is a near-verbatim match to DeVita 12th ed text at line ~221213 ("Currently, EZH2-targeting agents are used in clinical trials in SMARCB1-deficient neoplasms that include malignant rhabdoid tumor, epithelioid sarcoma, and poorly differentiated chordoma (Clinicaltrials.gov NCT02601937 and NCT02601950)"). Sidecar correctly omits the NCT numbers rather than inventing outcome data for them.
   - Every other claim (multimodal chemo+surgery+RT backbone, ATRT/CNS synchronous screening, germline SMARCB1/SMARCA4 predisposition testing, paraneoplastic hypercalcaemia, poor prognosis, palliative care timing, referral pathway) is explicitly tagged "(general oncology standard, not from DeVita's section on this disease)" and is uncontroversial pediatric-oncology standard-of-care framing, not a specific regimen/trial/statistic presented as DeVita-sourced.
   - Confirmed DeVita has no dedicated extracranial/renal rhabdoid-tumor management section: the only other rhabdoid-tumor mentions in devita.txt are pathology-descriptor uses ("rhabdoid differentiation/features/phenotype" in unrelated sarcoma/RCC/chordoma histology sections) and a single passing mention of atypical teratoid/rhabdoid tumor (ATRT) in the CNS embryonal-tumor overview (~line 241896-241919) with no ATRT-specific regimen given.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. Correct.

4. VERDICT: CLEAN (ready for R1).
