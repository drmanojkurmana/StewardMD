# Adversarial verification — cholangiocarcinoma.md

1. DOSE LEAK: none. Grepped for mg, mg/m2, Gy, AUC, q-day/week schedules — zero hits in the sidecar.

2. UNGROUNDED CLAIMS: none found. Every specific regimen/drug/trial/statistic-free claim checked
   against DeVita 12th ed, Ch. 37 ("Cancer of the Biliary Tree"), lines ~112567-115346 of the
   supplied text dump, and is supported:
   - Resection definitions by subtype (iCCA nonanatomic/segmental; pCCA lobe + extrahepatic duct +
     periportal lymphadenectomy, caudate lobe involvement; dCCA ~ pancreaticoduodenectomy) — matches text.
   - R0 vs R1 margin as dominant outcome driver — matches.
   - Perihilar liver transplant protocol (neoadjuvant chemoradiation + staging laparoscopy +
     transplant, extrahepatic nodal disease/mets as contraindication, EUS-FNA seeding risk) — matches
     Murad/Heimbach/Hassoun-referenced text almost verbatim (without the doses/Gy/day numbers DeVita
     gives, which the sidecar correctly omits).
   - iCCA transplant "disappointing" / not routinely offered, possible role in cirrhosis + small
     tumor — matches (European Liver Transplant Registry 29% 5-yr framed only qualitatively by sidecar).
   - Adjuvant capecitabine (BILCAP) survival/RFS benefit vs. adjuvant gemcitabine (BCAT, PRODIGE-12)
     no benefit — matches trial-by-trial text exactly (numbers correctly stripped).
   - Photodynamic therapy + stenting survival/QoL benefit over stenting alone (randomized + pooled
     data) for unresectable perihilar disease — matches Ortner/Zoepf/Leggett-referenced text.
   - First-line gemcitabine-platinum doublet as standard of care (ABC-02/Valle et al.) — matches.
   - Second-line FOLFOX vs. best supportive care superior OS after gem/cis progression (ABC-06) —
     matches, including the framing that there was long no agreed second-line standard.
   - FGFR2 fusion/rearrangement oral inhibitors approved for previously treated
     unresectable/metastatic disease (pemigatinib, infigratinib per text) — matches.
   - IDH1 mutation: ivosidenib (ClarIDHy) improved PFS vs placebo; OS benefit only reached
     significance after crossover adjustment; approved for previously treated IDH1-mutant advanced
     disease — matches text precisely (unadjusted HR 0.69 P=.06 not significant; crossover-adjusted
     HR 0.49 P<.0001 significant), and the sidecar keeps the qualitative characterization without
     leaking the numbers.
   - BRAF V600E, NTRK fusions, HER2/neu amplification (esp. gallbladder) as emerging targets,
     tumor-board/trial access rather than a named CCA-specific approved regimen — matches (dabrafenib+
     trametinib ROAR, larotrectinib, HER2 MyPathway/neratinib are all still basket/phase 2 trial data
     in the text, not CCA-specific approvals, so the sidecar is right not to name specific agents here).
   - No formal surveillance guidelines; practice-pattern imaging/CA19-9 q3mo x2yr then q6mo,
     CA19-9 not a validated standalone marker but rising levels can precede recurrence; surgery
     generally not offered for recurrent disease — matches DeVita's iCCA and pCCA sections almost
     verbatim.
   - Local-regional therapy (TACE/TARE/ablation) and radiation/SBRT for unresectable intrahepatic/
     perihilar disease framed as lacking randomized survival data — matches (DeVita explicitly notes
     small retrospective series, no randomized comparisons).

   Items the draft agent said it deliberately omitted (checked and agree with the omission):
   - Gemcitabine-oxaliplatin as a first-line alternative doublet — text only supports this via "phase
     II studies have suggested comparable benefit" and a pooled analysis, weaker than the ABC-02
     gem-cis level of evidence; correctly left out as a named option.
   - BRAF/NTRK/HER2 named agents for CCA itself — text frames these as basket-trial/emerging, not an
     approved CCA-specific regimen; correctly generalized to "molecular tumour board/trial."
   - Any numeric survival/response stats — correctly stripped per the dose/number-leak rule.
   - Formal surveillance-interval guideline — text explicitly says none exist; sidecar correctly
     labels the interval as practice pattern, not guideline.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed." (line 140, name only, no page numbers). Compliant.

4. VERDICT: CLEAN — ready for R1.
