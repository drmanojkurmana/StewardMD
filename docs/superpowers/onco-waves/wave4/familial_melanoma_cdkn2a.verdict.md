# Verdict: familial_melanoma_cdkn2a.md

1. DOSE LEAK: none. Grepped for mg/mg-m2/AUC/Gy/numbered-schedule tokens; only hits are staging numerals
   (I/II/III/IV), gene/mutation names (CDKN2A, BAP1, BRAF V600), "12th ed", and the word "dose" used
   unquantified ("a single pre-operative dose of checkpoint therapy" — no mg/kg attached). No numeric
   dose, AUC, or Gy anywhere in the file.

2. UNGROUNDED CLAIMS: none found. Every specific regimen/trial claim has a DeVita match:
   - CDKN2A = FAMMM gene, pancreatic-cancer familial syndrome table (lifetime risk 15%) — devita.txt
     lines ~104318-104330.
   - CDKN2A carried the highest OR among germline genes in a large pancreatic case-control series
     (sidecar correctly abstracts the number away) — matches OR 12.33 for CDKN2A vs TP53 6.70, MLH1
     6.66, BRCA2 6.20, ATM 5.71, BRCA1 2.58 — devita.txt lines ~104382-104389. Guideline shift toward
     universal germline testing in pancreatic cancer — same passage, line ~104390-104392.
   - Adjuvant PD-1: nivolumab vs ipilimumab (CheckMate 238) and pembrolizumab vs placebo
     (KEYNOTE-054/EORTC 1325-MG) improving RFS in resected stage III — devita.txt lines ~32955-32963,
     ~232148-232160, ~232346-232348, ~236081, ~236100.
   - Adjuvant BRAF/MEK (dabrafenib+trametinib, COMBI-AD) for BRAF-mutant resected stage III —
     devita.txt lines ~232344-232345, ~232630.
   - Neoadjuvant single-dose checkpoint inhibitor before lymphadenectomy correlating pathologic
     response with disease-free outcome — matches the 30-patient pilot pembrolizumab neoadjuvant
     nodal-melanoma study (pCR/near-CR 40%, all disease-free) — devita.txt lines ~33040-33050.
   - Advanced/stage IV: anti-PD-1 alone or with anti-CTLA-4, and BRAF/MEK for BRAF V600-mutant
     metastatic disease, established via randomized trials — devita.txt lines ~22304, ~33094-33128,
     ~68014, ~70946-70953 (ipi+nivo trials) and general BRAF/MEK metastatic-melanoma sections.
   - BAP1 as an overlapping/differential tumor-predisposition consideration (uveal melanoma) is
     phrased as a soft "differential/overlapping consideration," consistent with BAP1-associated
     tumor predisposition syndrome entries (devita.txt lines ~149598-149739) without asserting a
     false direct CDKN2A-BAP1 link.
   - The doc explicitly and correctly declines to assert a specific post-relapse line-of-therapy
     sequence or numeric surgical-margin/surveillance-interval specifics, flagging these as not
     spelled out in the reviewed DeVita text — appropriately conservative, not fabrication.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed. NCCN Guidelines (Genetic/Familial High-Risk Assessment and Cutaneous Melanoma)."
   Name only, no page numbers. Correct format.

4. VERDICT: CLEAN — ready for R1.
