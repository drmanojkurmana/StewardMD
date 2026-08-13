# Adversarial verification — lymphomatoid_papulosis.md

1. DOSE LEAK: none. Regex scan for mg/mg-m2/AUC/numbered-schedule patterns returned zero hits.
   The only numbers present are disease-natural-history/outcome statistics (12 weeks lesion
   duration, up to 60% TCR clonality, 118-case series, 4% systemic progression, up to 20%
   preceded/followed by another lymphoma, 100% disease-specific 5-year survival, "roughly
   two-thirds"/"about a third" brentuximab response fractions) — none are treatment doses,
   mg/m2, AUC, or numbered cycle schedules.

2. UNGROUNDED CLAIMS:
   - "Oral retinoids (e.g. bexarotene) are a further option for refractory disease" (appears in
     the "Refractory or highly symptomatic disease" bullet and again in "Lines of therapy" #4).
     Grepped every LyP/CD30+ LPD mention in devita.txt (lines 271147, 271882-271887, 271894,
     272202, 272346-272430) and every "bexarotene"/"oral retinoid" hit in the file — bexarotene
     is discussed extensively for MF/SS but is never mentioned in DeVita's LyP or "Primary CD30+
     Lymphoproliferative Disorders" passage. DeVita states LyP "is managed either with no
     treatment, low doses of oral methotrexate, or PUVA" — no retinoid option is given.
     Unlike the sidecar's other non-DeVita items (topical steroids/retinoids for individual
     lesions, photographic mapping), this claim carries no "general oncology standard, not from
     DeVita's section" disclaimer, so it reads as DeVita-grounded when it is not. It is
     clinically plausible/uncontroversial as real-world off-label practice for refractory CD30+
     LPD, but should be relabeled with the same disclaimer the other ungrounded items received.
   - "Aggressive multiagent chemotherapy is not appropriate for this indolent condition and
     should be avoided" — not a direct DeVita quote, but a reasonable synthesis of DeVita's
     stated management (no treatment / low-dose methotrexate / PUVA); not flagging as fabrication,
     just noting it is inferred rather than quoted.
   - All other specific claims verified as grounded: waxing/waning course, ~12-week lesion
     resolution with scarring (devita.txt:272354-272360), up to 60% TCR clonality
     (272360-272364), up to 20% preceded/followed by MF/ALCL/Hodgkin lymphoma
     (272364-272365), 118-case series with 4% systemic progression (272365-272367),
     brentuximab vedotin phase II trial in 48 patients combining LyP/C-ALCL/CD30+ MF with
     ORR 71% (34/48) and 35% CR, no correlation with CD30 expression level
     (272198-272207), C-ALCL surgical excision/radiotherapy for the related-but-distinct
     entity correctly NOT applied to LyP itself (272400-272410), WHO-EORTC Table 68.2 LyP
     100% disease-specific 5-year survival (270878 region / Table 68.2).

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
   of Oncology, 12th ed." Name only, no page numbers. Correct format.

4. VERDICT: ISSUES (minor, non-blocking)
   - Relabel the oral-retinoid/bexarotene sentence (in both the treatment-approach bullet and
     the "Lines of therapy" #4) with the same "general oncology standard, not from DeVita's
     section on this disease" disclaimer already used elsewhere in the file, since it is not
     supported by the DeVita LyP/CD30+ LPD passage.
   - Everything else (course description, TCR clonality %, 118-case progression stat, brentuximab
     trial detail, WHO-EORTC 100% survival figure, citation line, and the absence of any dose
     numbers) is clean and DeVita-grounded. No dose leak. Ready for R1 once the one mislabeled
     sourcing note above is fixed.
