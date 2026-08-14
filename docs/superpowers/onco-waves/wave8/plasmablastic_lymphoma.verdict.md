# Verdict: plasmablastic_lymphoma.md

1. DOSE LEAK: none. Only numbers present are marker names (CD38, CD138, MUM1, CD20, CD79a — not doses), a Ki-67 threshold (>80%, a pathology cutoff mirrored verbatim from DeVita, not a drug dose), and reference-style artifacts. No mg, mg/m2, AUC, or numbered cycle/day schedule anywhere.

2. UNGROUNDED CLAIMS: none found beyond what the sidecar itself already flags. All specific regimen/drug claims are grounded in DeVita's HIV-associated NHL section (lines ~269547-269581):
   - DA-EPOCH ± rituximab (if CD20+) for PBL or Ki-67 >80% — grounded.
   - CD20/CD79a often negative, CD38/CD138/MUM1 positive, EBV-positive, oropharynx-predominant — grounded.
   - CSF exam considered for all patients; PJP/zoster/Candida prophylaxis; ART continuation through chemo — grounded, verbatim match.
   - PET-CT "particularly useful" for aggressive lymphomas including plasmablastic lymphoma by name — grounded (line 266839, direct disease-name hit).
   - Relapsed AIDS-NHL: salvage chemo + consolidative ASCT with outcomes comparable to HIV-negative patients — grounded (line ~269588 area describes a phase II trial with comparable outcomes vs. historical HIV-negative controls); sidecar correctly omits the specific OS/PFS percentages and correctly labels this as extrapolated from AIDS-related-lymphoma-relapse literature rather than PBL-specific data.
   - Everything else the sidecar flags inline as "general oncology standard, not from DeVita's section on this disease" (surgery has no role, tumor lysis risk, radiotherapy, paraprotein/myeloma differential, short follow-up intervals, referral triggers) is honestly and correctly labeled as non-DeVita-sourced, and each is uncontroversial general-oncology practice, not a fabricated specific claim.
   - Draft agent's self-reported omissions (no salvage regimen name, no PBL-specific survival stats, no PBL-specific RT recommendation) are consistent with what's actually in the text — DeVita's survival/RR numbers near this passage belong to PTLD, not PBL, and the sidecar does not borrow them.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." No page numbers. Correct.

4. VERDICT: CLEAN (ready for R1).
