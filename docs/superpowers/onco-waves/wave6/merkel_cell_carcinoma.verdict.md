# Adversarial verification — merkel_cell_carcinoma.md

1. DOSE LEAK: none. Grepped for mg/mcg/mg-m2/AUC/Gy/IU/% and scanned every digit in the file.
   The only numbers present are "2 cm" (AJCC8 stage I size cutoff) and "1 to 2 cm" (WLE margin
   width) — anatomic/staging thresholds, not drug doses, RT doses (Gy), or dosing schedules.
   DeVita's actual RT doses (50-56 Gy, 56-60 Gy, 60-66 Gy), drug doses (avelumab 10 mg/kg q2w,
   pembrolizumab 2 mg/kg q3w) and response-rate/survival percentages are all correctly omitted.

2. UNGROUNDED CLAIMS: none found that lack DeVita support or aren't disclosed as such.
   Cross-checked against DeVita 12th ed, Ch. 62 "Cancer of the Skin," Merkel Cell Carcinoma
   section (~lines 225865-226110 of devita.txt):
   - Baseline workup (skin/node exam, CBC, LFTs, CT/PET) — matches verbatim intent.
   - AJCC8 staging tiers (I/IIA/IIB/III/IV) — matches.
   - WLE 1-2 cm margins, margin width not firmly established — matches.
   - Mohs as alternative, comparable but few cases, no RCTs — matches.
   - SLNB rationale (understaging, worse RFS if positive), coordinate with excision — matches.
   - Nodal dissection vs. RT similar outcomes, no added benefit from adjuvant RT after
     dissection, RT offered if SLNB declined/ineligible — matches.
   - Adjuvant RT to primary for high local-recurrence risk / positive margins; RT-alone worse
     distant recurrence and survival than surgery — matches.
   - Checkpoint immunotherapy (avelumab, pembrolizumab) first-line for metastatic/unresectable
     disease, higher response in treatment-naive, includes CR in a minority, irAEs expected —
     matches (pembrolizumab: 16% CR in DeVita's cited study).
   - Chemo (SCLC-like: cyclophosphamide/anthracycline/cisplatin) palliative-only, no survival
     benefit, worse outcomes than checkpoint inhibition — matches ("platinum- and
     anthracycline-based" is a fair paraphrase of cisplatin+anthracycline+cyclophosphamide).
   - Follow-up cadence (~q3-6mo x2-3y, then q6-12mo) — matches.
   - MCPyV oncoprotein titer falls with treatment, rising titer predicts recurrence — matches
     (DeVita gives PPV 66%, sidecar correctly omits the number).
   - Two claims are explicitly flagged inline by the draft agent as NOT from this DeVita section
     (neoadjuvant checkpoint immunotherapy / CheckMate 358-style trials; routine
     immunosuppression-reduction as management) and labeled general/investigational framing.
     Both are honest disclosures, both are uncontroversial oncology framing, and neither is
     presented as DeVita-sourced fact. Acceptable.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
   of Oncology, 12th ed." Name only, no page numbers. Correct format.

4. VERDICT: CLEAN — ready for R1.
