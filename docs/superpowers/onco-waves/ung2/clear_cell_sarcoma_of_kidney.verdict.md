# Adversarial verification verdict: clear_cell_sarcoma_of_kidney.md

## 1. DOSE LEAK
None. Regex sweep for mg / mg-m2 / AUC / numbered schedules (`[0-9]+ ?mg`, `mg/m2`, `AUC[0-9]`,
`q[0-9]+d/wk`, `cycle [0-9]`, `x[0-9]+ days/weeks/cycles`) returned zero matches. Manual grep for
any digit in the file returns only: gene/fusion names (EWSR1-ATF1, YWHAE-NUTM2), "12th ed."
(citation), and "20 Gy" does NOT appear in this file (that number is in DeVita's Wilms tumor text,
not in the sidecar — confirmed not copied over). No numeric dose, weight-based dose, AUC, or
cycle-numbered schedule anywhere in the sidecar.

## 2. UNGROUNDED CLAIMS
Independently re-verified: grep of "clear cell sarcoma" (case-insensitive) across the full DeVita
text returns 20 hits, all either index entries (`1087t, 1100`) or the single dedicated section at
line ~214057 ("Clear Cell Sarcoma") — which is explicitly the soft-tissue/tendon entity ("initially
described by Enzinger," EWSR1-ATF1 translocation, melanocytic differentiation), not the pediatric
renal tumor (CCSK). Confirmed no DeVita text search hit for "CCSK," "clear cell sarcoma of the
kidney," or "clear cell sarcoma of kidney." A supplementary grep for "Wilms" (the closest pediatric
renal-tumor content DeVita has) returns 9 hits, all incidental (WT1 gene/protein references, an
index entry, one radiotherapy dose for a different tumor type) — none of it is cited or drawn on by
the sidecar, correctly.

So every clinical claim in the body (radical nephrectomy as surgical mainstay, upfront nephrectomy
vs. neoadjuvant chemo, anthracycline/alkylator/vinca-alkaloid backbone, chemo for all stages
including stage I, cardiac surveillance for anthracycline exposure, flank/whole-abdomen
radiotherapy, bone-metastasis radiotherapy, BCOR-ITD/YWHAE-NUTM2 molecular confirmation, late
bone/brain relapse pattern, extended surveillance beyond Wilms follow-up) is unsupported by DeVita
and is not attributed to it — each is explicitly hedged as "(general oncology standard, not from
DeVita's section on this disease)". This is honest labeling, not fabrication-as-DeVita-sourced, but
it does mean the sidecar is currently zero-grounded pediatric-oncology general knowledge with no
primary/guideline citation (no NCCN, no COG protocol, no named trial) backing any of the specific
claims (drug classes, radiotherapy indications, molecular markers, relapse/surveillance pattern).
None of these are so uncontroversial-guideline-standard that they need no citation at all — e.g. the
BCOR-ITD/YWHAE-NUTM2 molecular markers and the specific "upfront nephrectomy vs. neoadjuvant" point
are protocol-specific facts that a clinician reader would reasonably expect a citation for.

## 3. CITATION
Present, correctly scoped: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
of Oncology, 12th ed. (searched but no dedicated section on this disease found; see sourcing note
above). NCCN Guidelines were not separately consulted for this narrative." No page numbers. Honest
about the negative search result and the absence of a secondary guideline source.

## 4. VERDICT
ISSUES (not a fabrication problem — the draft agent's self-report is accurate and the file is honest
about its own grounding gap — but it is not "DeVita-grounded content," it is unsourced general
pediatric-oncology narrative with an explicit disclaimer repeated ~15 times). Before this goes to R1
as a DeVita-sourced sidecar:
- No dose leak: PASS.
- No false DeVita attribution: PASS (every claim correctly disclaims DeVita sourcing).
- Grounding: FAIL as a "DeVita wave" deliverable — none of the specific claims (drug-class backbone,
  radiotherapy indications, molecular markers, relapse/surveillance pattern) has ANY citation
  (DeVita or otherwise). This is fine as a stopgap general-knowledge placeholder but should not be
  merged into the DeVita-grounded corpus without either (a) a real secondary source (NCCN pediatric
  guidelines, COG protocol reference) added to the Sources line, or (b) explicit sign-off that
  uncited general-knowledge sidecars are acceptable for diseases DeVita doesn't cover.
- Recommend: flag this disease to the wave owner as "DeVita has no coverage — needs a different
  source (NCCN/COG) or explicit owner acceptance of uncited content" rather than silently passing it
  through as if it were a normal DeVita-grounded entry.
