# Adversarial verification — steroid_cell_tumor_ovary.md

1. DOSE LEAK: none. Grepped for mg / mg-m2 / AUC / numbered-schedule patterns across the sidecar — zero hits. Draft correctly contains no numeric dosing anywhere.

2. UNGROUNDED CLAIMS: none found to be mislabeled. Verified directly against devita.txt:
   - Confirmed zero hits for "steroid cell", "lipid cell", "lipoid cell", "stromal luteoma" anywhere in the DeVita text — the sidecar's core sourcing claim (no dedicated section for this entity) is accurate, not fabricated.
   - Confirmed DeVita's sex cord-stromal tumor section (~line 178389-178420) covers only granulosa cell tumor (GCT), juvenile granulosa cell tumor (JGCT), and Sertoli-Leydig cell tumor — matches the sidecar's description exactly.
   - Confirmed DeVita's BEP (bleomycin-etoposide-cisplatin) regimen is described for malignant germ cell tumors of the ovary and "has demonstrable activity in GCTs" — the sidecar's parenthetical reference to this (explicitly flagged as NOT tumor-specific evidence for steroid cell tumor) is an accurate paraphrase, correctly caveated.
   - Platinum-taxane as standard epithelial ovarian cancer therapy is confirmed as a recurring, uncontroversial theme throughout DeVita's ovarian cancer sections (multiple carboplatin+paclitaxel citations found).
   - All other clinical claims (surgical management by risk category, hormone monitoring, referral triggers) are inline-labeled "(general oncology standard, not from DeVita's section on this disease)" — an honest disclosure rather than an ungrounded claim dressed as DeVita-sourced. No claim in the document asserts DeVita support it does not have.
   - No specific regimen, trial name, response rate, or survival statistic is asserted for this tumor type — the "Deliberately omitted" section confirms this was a deliberate, correct choice given the sourcing gap.

3. CITATION: present but non-standard — the sidecar states "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed. (searched; no dedicated section on this entity found)" plus a secondary reference to the WHO Classification of Female Genital Tumours (matching the existing KB entry's citation). This deviates from the plain "DeVita 12th ed., name only" citation format used when DeVita is the grounding source, but that deviation is honest and necessary here — DeVita was searched, not used as a grounding source, and the draft says so plainly rather than fabricating a DeVita citation for content it doesn't support. No page numbers present either way.

4. VERDICT: CLEAN (ready for R1).

Rationale: This is the correct behavior when a disease has no dedicated DeVita coverage. The agent verified absence rather than fabricating presence, explicitly labeled every clinical claim as general-standard rather than DeVita-sourced, correctly distinguished BEP/platinum-taxane evidence for adjacent-but-different entities (GCT, malignant germ cell tumor, epithelial ovarian cancer) from evidence for steroid cell tumor itself, and omitted all disease-specific statistics/regimens it could not support. No dose leak. No fabricated grounding. Flag for manual gynae-onc/WHO sourcing is appropriate and already present in the draft.
