# Verdict: papillary_tumor_pineal_region

1. DOSE LEAK: none. Only digits present are "64" (chapter number) and "12"/"64" in
   the citation line ("chapter 64", page 1308 range not even quoted) — no mg,
   mg/m2, AUC, Gy, %, or numbered-schedule anywhere in the clinical body text.

2. UNGROUNDED CLAIMS: none found that are stated as DeVita-sourced. The sidecar
   deliberately contains **zero** specific drugs, regimens, trial names, or
   statistics for PTPR — every clinical statement is generic ("surgery is
   primary," "RT for residual/unresectable/recurrent disease," "chemo role
   unestablished," "serial MRI surveillance") and is explicitly flagged inline,
   repeatedly, as "general oncology standard, not from DeVita's section on this
   disease." Confirmed by direct grep + read of DeVita's pineal chapter
   (lines ~242451-242610, "PINEAL REGION TUMORS AND GERM CELL TUMORS"): PTPR /
   "papillary tumor of the pineal region" is never named anywhere in the file;
   that section is entirely about germinomas, NGGCTs, and pineocytoma/
   pineoblastoma (a different histology), and correctly was NOT mined for
   PTPR-specific claims. This is the right call, not a gap — germinoma-specific
   figures (CR rates, WVI/CSI dose framework, survival %) would misattribute if
   borrowed here, and the draft agent correctly excluded all of it.

3. CITATION: present, but non-standard format. The closing "Sources:" line
   names DeVita 12th ed. correctly (no page numbers) but bundles in a chapter
   number ("chapter 64") and an explanatory disclaimer rather than a clean
   name-only citation. Not a fabrication risk, just stylistically heavier than
   the expected minimal citation line — flag for R1 to decide whether to trim.

4. VERDICT: CLEAN (ready for R1), with one flag already surfaced by the draft
   itself: PTPR is NOT actually named/discussed in DeVita, so this sidecar has
   no DeVita-grounded entity-specific content — every claim is disclosed
   generic neuro-onc standard-of-care, not fabricated or misattributed. R1
   should confirm whether "general oncology standard, no DeVita passage on
   this specific rare entity" is an acceptable sourcing tier for this wave, or
   whether PTPR needs to be pulled and sourced from a dedicated
   neuro-pathology reference instead. Minor cleanup nit: trim the citation
   line to remove the embedded chapter-number/disclaimer clutter if R1 wants a
   uniform citation format across the wave.
