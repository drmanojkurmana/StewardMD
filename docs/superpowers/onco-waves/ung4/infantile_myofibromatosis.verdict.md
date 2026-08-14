# Adversarial verification — infantile_myofibromatosis.md

## 1. DOSE LEAK
None. Grepped for digits, mg, mg/m2, AUC, Gy, cycle/day numbers, q-schedules. Only digit
occurrences in the file are "NOTCH3" (gene name) and "12th ed" (citation edition) — neither is a
dose or schedule. No numeric dose, no numbered regimen schedule anywhere in the sidecar.

## 2. UNGROUNDED CLAIMS
Verified against devita.txt (grep -i "myofibromatosis|myofibroma" -> exactly one hit, line 211975,
a single WHO-classification table row "Myopericytoma (including myofibroma and myofibromatosis)"
with no dedicated management/treatment section). So effectively 100% of this sidecar's clinical
content is ungrounded in DeVita — but the draft is honest about that: every substantive claim is
inline-tagged "(general oncology standard, not from DeVita's section on this disease)" and the top
Sourcing note explicitly states DeVita has no dedicated section and flags the whole thing as
"needing manual sourcing." That self-disclosure is the correct behavior for a disease DeVita
doesn't cover — not a violation, but it does mean R1 is reviewing an un-sourced document, not a
DeVita-grounded one.

Specific claims that could not be found in DeVita and are not simply "uncontroversial guideline
boilerplate":
- Vinblastine + methotrexate as first-line low-dose chemo for generalized/visceral infantile
  myofibromatosis: checked all vinblastine+methotrexate co-occurrences in devita.txt — every one
  is MVAC/CMV/M-CAVI regimens for urothelial/bladder cancer, unrelated to this disease. Real
  literature support exists outside DeVita (e.g., Weitz et al., pediatric soft-tissue tumor
  literature) but zero DeVita support. Correctly flagged as non-DeVita in the draft.
- PDGFRB/NOTCH3 activating mutations driving a subset of infantile myofibromatosis, and PDGFR-TKI
  as a targeted option: checked all PDGFRB/NOTCH3 hits in devita.txt — they map to unrelated
  entities (infantile fibrosarcoma ETV6-NTRK3, dermatofibrosarcoma protuberans COL1A1-PDGFRB,
  GIST, alveolar rhabdomyosarcoma, myeloid neoplasm fusion panels). None reference infantile
  myofibromatosis. This is real published biology for this disease (PDGFRB/NOTCH3 germline/somatic
  variants are an established finding in the myofibromatosis literature) but is not from DeVita —
  correctly flagged as such.
- Differential-diagnosis claim (infantile fibrosarcoma / rhabdomyosarcoma as histologic mimics
  warranting biopsy/reassessment): plausible and standard, but again not traceable to a DeVita
  passage about this disease specifically; carries the same generic disclaimer.
- No fabricated trial names, response-rate statistics, or staging system were found — the draft
  correctly omits these per its own report, and I found none introduced.

Net: nothing found that is stated as DeVita-sourced but isn't. All ungrounded material is labeled
ungrounded. The content itself (observation-first for solitary/multicentric non-visceral disease,
systemic therapy reserved for generalized visceral disease, surgery selective, no first-line
radiotherapy, PDGFR-TKI as an option in refractory PDGFRB-driven disease) matches mainstream
pediatric oncology practice as I'd expect from independent knowledge, but that is not the same as
DeVita grounding.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." at the end — name only, no page numbers, no misleading specificity given the sourcing note
above it already disclosed the near-total lack of DeVita coverage. Acceptable, though arguably the
generic citation line at the bottom is in tension with the sourcing note (a reader skimming only
the last line could still think DeVita is the source for the clinical content above).

## 4. VERDICT: CLEAN (ready for R1)

No dose leak, no fabricated grounding (claims are not misattributed to DeVita), no invented
trial/statistic. This is a "DeVita has nothing" case handled correctly: disclosed prominently up
front, every clinical line tagged, no numbers. Two minor, non-blocking notes for R1:
- Confirm R1 is comfortable accepting a sidecar where ~100% of content is flagged
  non-DeVita-sourced (i.e., this is really a general-oncology sidecar wearing a DeVita citation
  footer).
- Consider whether the bottom "Sources:" line should itself carry a caveat (e.g., "consulted; no
  dedicated section found") rather than reading like a normal grounded citation.
