# Adversarial verification verdict — salivary_gland_tumor.md

1. DOSE LEAK: none. Grepped for mg/Gy/AUC/mcg/IU/ratios/cycle counts/q-schedules — zero hits. The
   only numeric tokens in the file are: "HER2" (receptor name), "RTOG 1008" (trial name, no dose
   attached), "phase 2 trials" (trial phase, not a dose), and the surveillance follow-up cadence
   ("every 2 to 3 months" / "every 6 months" / "years 3 to 5") — this is a clinical follow-up
   schedule, not a drug dose/regimen schedule, and matches the same pattern used in other
   already-approved wave sidecars (e.g. renal_oncocytoma.md, neuroendocrine_tumor.md). No mg,
   mg/m2, AUC, Gy, or numbered chemo-cycle schedule anywhere.

2. UNGROUNDED CLAIMS: none found. Spot-checked every specific claim against DeVita 12th ed,
   Chapter 29 (lines ~65240-66360 of the source dump):
   - HER2-positive resectable MEC (mucoepidermoid carcinoma, not a typo for SDC) treated with
     maintenance HER2-targeted antibody (trastuzumab) + platinum CRT, and AR-positive MEC treated
     with LHRH analogue + antiandrogen (bicalutamide) — both verbatim-matched in DeVita p.346
     (initially looked like a possible SDC/MEC mix-up but DeVita itself specifies MEC for this
     regimen, confirmed correct).
   - RTOG 1008 trial name and its adjuvant CRT-vs-RT context — matches DeVita exactly (trial name
     kept, per-arm dosing e.g. "weekly cisplatin" correctly dropped).
   - Registry analysis showing inferior survival with adjuvant CRT — matches DeVita ("showed
     inferior 5-year OS... adjuvant CRT"), the 5-year OS number correctly omitted.
   - CAP regimen generalized to "anthracycline-based platinum combination" (DeVita: cyclophosphamide
     + doxorubicin + cisplatin) — accurate generalization, response-rate/DOR numbers correctly
     dropped.
   - Vinorelbine ± cisplatin generalized to "vinca-alkaloid-based regimen with or without a platinum
     agent" — matches DeVita, numbers dropped.
   - Taxane avoidance in ACC — matches DeVita ("taxane therapy is often avoided in R/M ACC given
     lack of efficacy").
   - Antiangiogenic multitargeted TKI (lenvatinib/axitinib generalized) disease-stabilizing activity
     in phase 2 trials, dose-modification/discontinuation toxicity — matches DeVita, ORR/PFS/HR
     numbers correctly dropped.
   - Immune checkpoint blockade modest activity, low TMB/PD-L1 rationale — matches DeVita
     (pembrolizumab trial), numbers dropped.
   - NTRK fusion-positive mammary analog secretory carcinoma → oral NTRK inhibitor (larotrectinib/
     entrectinib generalized), high response rates — matches DeVita.
   - Non-ACC HER2-overexpressing disease: HER2-targeted antibody + taxane first-line, continued
     HER2-targeting at progression — matches DeVita (trastuzumab ± pertuzumab + taxane,
     T-DM1/trastuzumab deruxtecan at progression, generalized correctly).
   - AR-positive non-ACC disease: combined androgen blockade (LHRH + antiandrogen), sequencing
     HER2 before AR when both are positive — matches DeVita.
   - Non-ACC taxane response (paclitaxel ~25% ORR in DeVita) generalized to "may respond to a
     taxane-based regimen" — number correctly dropped.
   - Surgical detail (facial nerve preservation/sacrifice, submandibular en bloc with level Ib
     nodes, lingual/hypoglossal nerve risk, marginal mandibular nerve injury, sublingual approach),
     elective vs therapeutic neck dissection risk-stratification rationale, elective neck
     irradiation as an alternative to elective neck dissection, definitive RT + concurrent
     platinum for unresectable/medically-unfit disease (Gy dose correctly omitted), surveillance
     imaging triggers (base-of-skull/named-nerve MRI, annual chest CT for high-grade histologies),
     xerostomia/dental/lymphedema/trismus survivorship care, annual TSH after neck irradiation —
     all matched line-for-line against DeVita's Surgery/Radiotherapy/Complications/Surveillance
     sections.
   No specific regimen, trial, or statistic in the sidecar lacks DeVita support, and no invented
   drug/trial/number was found.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
   of Oncology, 12th ed." with no page numbers, plus a reasonable NCCN/ASCO mention consistent with
   what DeVita itself cites in-chapter (ASCO guideline is DeVita's own reference #2).

4. VERDICT: CLEAN — ready for R1.
