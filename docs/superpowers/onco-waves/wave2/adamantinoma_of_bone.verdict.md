# Adversarial verification — adamantinoma_of_bone.md

1. DOSE LEAK: none. Grepped for mg, mg/m2, mg/m², AUC, Gy, mcg, IU, %, q-day/cycle numbering, and
   any bare digit — the only numeric token in the file is "12th ed." in the closing Sources line
   (edition number, not a dose). No mg/mg-m2/AUC/Gy/numbered-schedule content anywhere.

2. UNGROUNDED CLAIMS:
   - No specific drug name, regimen, trial, or survival/recurrence statistic appears anywhere in
     the file — the sidecar deliberately stays at "a cytotoxic sarcoma-type regimen" (generic,
     not a named protocol) and explicitly flags that outcome statistics/dosing were not found in
     DeVita. This matches the draft agent's own disclosure.
   - Borderline (not dose/regimen/stat, but not directly grep-confirmed in the supplied DeVita
     excerpt either): the "soap-bubble lytic-sclerotic radiographic pattern" description, the
     "osteofibrous-dysplasia-like variant" / cytokeratin-IHC differential point, and "nodal
     metastasis... has been described." These are standard, uncontroversial orthopedic-oncology/
     pathology facts (consistent with DeVita's own cited reference #43, "Osteofibrous dysplasia
     and adamantinoma," even though that reference's body text wasn't in the grepped excerpt) —
     not fabricated regimens/trials/statistics, so they don't fail the "specific
     regimen/drug/trial/statistic" test, but R1 should note they rest on general domain knowledge
     rather than a DeVita line-and-verse match.
   - Everything else (surgery as primary/curative modality, chemo/RT resistance, wide-margin
     excision, recurrence driven by inadequate margins, long-term surveillance for late
     recurrence/pulmonary metastasis) is uncontroversial guideline-standard content, correctly
     flagged inline by the draft as not DeVita-sourced where DeVita is silent.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
   of Oncology, 12th ed." Name-only, no page numbers. Correct format.

4. VERDICT: CLEAN (ready for R1). No dose leak, no fabricated regimen/drug/trial/statistic, honest
   inline flagging of DeVita's silence on treatment specifics, citation line correctly formatted.
   Minor note for R1: the small set of pathology/imaging descriptors above are uncontroversial
   but weren't independently DeVita-line-confirmed in this pass.
