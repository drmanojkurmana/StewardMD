# Adversarial re-verification — desmoid_tumour.md (post-revision)

1. DOSE LEAK: none. Only numeric tokens in the file are "5 cm" (line 33,
   tumour-size recurrence-risk threshold — matches DeVita's ">5 cm" cutoff
   verbatim, not a dose) and "12th ed" in the citation line. Grepped for
   mg, mg/m2, AUC, Gy, %, and numbered-schedule patterns: zero hits.
   Sidecar consistently generalizes away DeVita's numeric data (drops the
   50% vs 59% 5-yr PFS wait-and-see figures, the >90%/20-30%/>50%
   recurrence-rate figures, the 56%/69% local-control figures, the 50-60 Gy
   radiation doses, and the 81% vs 36% 2-yr PFS trial result) into
   qualitative language ("similar longer-term outcomes," "cure rates are
   high," "meaningful proportion," "achieved meaningful rates of local
   control").

2. UNGROUNDED / MISLABELLED CLAIMS: none remaining.
   - Gamma-secretase inhibitor claim (lines 77-80, the R1-blocking issue):
     now reads "is under investigation on this mechanistic basis as a
     targeted option in refractory disease." Confirmed against DeVita
     p.1089: "Cross-talk between the Wnt and Notch signaling pathways
     provided rationale for a phase I trial of the oral gamma-secretase
     inhibitor PF-03084014, which disrupts Notch signaling." The revised
     wording keeps only the mechanistic-rationale/investigational framing
     and drops the unsupported "has shown activity in trials" efficacy
     claim. No longer implies proven benefit; no longer misattributes
     post-12th-ed nirogacestat/DeFi efficacy data to DeVita. Resolved.
   - NSAID vs. hormonal-agent evidence parity (line 64): "produced reported
     responses" (was "well-documented responses") now sits at parity with
     "anecdotal response data" for hormonal agents, matching DeVita's
     actual relative framing (p.1125: "well-documented responses" for
     NSAIDs vs. "anecdotal accounts" for hormonal agents — the sidecar now
     undersells NSAID evidence slightly for safety margin rather than
     overselling it, acceptable per R1's requested direction). Resolved.
   - TKI paragraph (lines 72-76): "a placebo-controlled randomised trial
     confirmed improved progression-free survival with a multitargeted
     tyrosine kinase inhibitor compared with placebo" — correct,
     unattributed (no drug name, no numbers) paraphrase of DeVita's
     sorafenib phase III result (p.1126, ref. 69). No fabrication.
   - Surgery/recurrence-risk factors (>5cm size, chest wall/extremity site,
     younger age, margin status not predictive), regional/ablative
     therapies (HIFU, cryoablation, chemoembolization), radiation
     controversy/definitive-radiation role, and the FAP screening trigger
     all trace cleanly to the DeVita pp.1125-1126 management passage.
   - No claim is mis-attributed to DeVita. Nothing requires the "(general
     oncology standard...)" label because no remaining claim is both
     specific (regimen/drug/trial/statistic) and ungrounded — the generic
     MDT-referral and urgent-referral guidance in "When to refer" is
     process guidance, not a specific regimen/drug/trial/stat claim.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer:
   Principles & Practice of Oncology, 12th ed." Name only, no page
   numbers. Compliant.

4. VERDICT: CLEAN — ready for R1 re-review. Both items from the prior
   ISSUES verdict (gamma-secretase efficacy overstatement; NSAID/hormonal
   evidence-parity wording) are fixed exactly as flagged, with no new
   drift introduced elsewhere in the file.
