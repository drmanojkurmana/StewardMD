# Verdict: lymphomatoid_papulosis.md (re-verification pass 2)

1. DOSE LEAK: none. Grepped for mg / mg-m2 / mcg / µg / AUC / cycle-N / day-N / qNw / "every N day(s)/week(s)" — zero hits. Only non-dose numerics present: ~12-week lesion course, 60% TCR clonality, 118-case series / 4% progression, up to 20% lymphoma-association, ~two-thirds ORR / ~third CR (brentuximab), 100% 5-yr survival — all statistics, no doses/schedules.

2. UNGROUNDED / MISLABELLED CLAIMS: none found unlabelled.
   - Bexarotene/oral retinoids (both occurrences: "Refractory..." bullet and Lines-of-therapy item 4) now carry `(general oncology standard, not from DeVita's section on this disease)` — correctly flagged; DeVita's LyP passage indeed never mentions bexarotene for LyP (bexarotene appears only in the MF/SS section, unrelated to this indication). This resolves the sole ISSUES item from the prior verdict.
   - Topical corticosteroids/retinoids and photographic mapping — correctly labelled as general-standard, not DeVita.
   - Brentuximab claim checked against DeVita p.1417-1418 verbatim: "phase II open label trial of 48 patients with CD30+ lymphoproliferative disorders including LyP and primary cutaneous anaplastic large cell lymphoma (C-ALCL) or CD30+ MF, brentuximab demonstrated an ORR of 71% (34/48), with 35% of patients achieving a complete remission... no correlation between response and level of CD30 expression." Sidecar's "roughly two-thirds ... about a third ... no correlation with CD30 expression" is a faithful (if loosely rounded — 71% read as "two-thirds" rather than "~seven in ten") paraphrase, correctly attributed to DeVita, correct trial composition (LyP + C-ALCL + CD30+ MF). Minor rounding looseness, not a fabrication or mislabel.
   - Surgery/RT section correctly states DeVita describes that role for C-ALCL, not LyP itself — verified true against the C-ALCL paragraph immediately following the LyP paragraph in the same chapter.
   - Monitoring stats (118 cases/4%, up to 20% associated lymphoma, 60% TCR clonality, 100% 5-yr survival) all verified verbatim against DeVita Ch.68 LyP paragraph and Table 68.2 (WHO-EORTC outcomes table, LyP row: 12% frequency / 100% disease-specific 5-yr survival).
   - "Aggressive multiagent chemotherapy... should be avoided" — an inference, not a direct DeVita quote for LyP specifically, but not attributed to a specific unstudied regimen/trial/stat either; consistent with the chapter's general indolent-disease framing. Not a fabrication; no relabel needed (unchanged from prior verdict's non-blocking note).

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name + edition only, no page numbers. Clean.

4. Title em-dash fix confirmed (now uses a colon: "Lymphomatoid Papulosis (LyP): Management"); grep for em/en dash across the whole file returns none.

VERDICT: CLEAN — ready for R1 re-review.

Note to orchestrator: an `.r1.md` file (`lymphomatoid_papulosis.md.r1.md`) is present in wave6/ alongside the sidecar and this verdict, contradicting the reviser's stated premise that no `.r1.md` existed. Not reviewed here (out of scope — task was re-verifying the sidecar `.md` only); flagging so the R1 step isn't skipped or duplicated.
