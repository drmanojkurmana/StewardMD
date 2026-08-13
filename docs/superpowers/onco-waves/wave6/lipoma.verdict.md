# Adversarial verification — lipoma.md (Wave 6)

1. DOSE LEAK: none. No mg, mg/m2, AUC, or numbered drug schedule anywhere in the doc. Only
   numeric content is a size threshold ("roughly above ten centimetres", used twice, for
   deep/intramuscular lesion triage) — not a dose.

2. UNGROUNDED CLAIMS: none beyond what the doc itself already discloses. Cross-checked
   devita.txt directly (grep -i "lipoma"): every hit is either an index-page pointer (p.1092,
   "Lipomas. See also Adipocytic tumors; Soft tissue sarcoma") or a distinct entity
   (thymolipoma, renal angiomyolipoma) — no chapter body text on simple/benign lipoma
   management exists in the extract. The sidecar accurately reports this (0 grounded lines) and
   labels every clinical claim inline as "(general oncology standard, not from DeVita's section
   on this disease)" rather than fabricating a DeVita citation. Content itself (observe small
   asymptomatic lesions; marginal excision for symptomatic/enlarging/cosmetic; MRI + core
   biopsy before excising large/deep/atypical fatty masses to rule out ALT/WDLPS; no
   role for chemo/RT/systemic therapy; refer multiple lipomas for Gardner/BRRS/Madelung
   workup) is uncontroversial, textbook-level soft-tissue-tumor management — nothing exotic,
   no named trial, no invented statistic.

3. CITATION: present, but honestly qualified — "Sources: DeVita, Hellman, and Rosenberg's
   Cancer: Principles & Practice of Oncology, 12th ed. (index reference only, page 1092, no
   chapter text retrievable for grounding); general oncology and soft tissue tumour management
   standards consistent with NCCN Guidelines for Soft Tissue Sarcoma." No page numbers are
   used as claim-level citations (page 1092 is only cited as "this is all the index gave us,"
   not as support for a specific clinical statement) — consistent with the no-page-numbers rule.

4. VERDICT: CLEAN (ready for R1).
   - No dose leak.
   - No fabricated grounding — the draft agent's "0 lines grounded" self-report is verified
     accurate against devita.txt; every claim is explicitly flagged as general-standard rather
     than falsely dressed up as DeVita-sourced.
   - Scope is correctly bounded to benign simple lipoma; liposarcoma/ALT systemic and RT detail
     is explicitly and correctly excluded as a separate disease entity, avoiding the more
     common failure mode of blending a benign-entity sidecar with sarcoma-specific regimens.
   - No numeric statistics or named trials presented as fact.
