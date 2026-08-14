# Adversarial verification verdict — ocular_surface_squamous_neoplasia

1. DOSE LEAK: none. Grepped the sidecar for digits — only hits are "12th ed." (citation edition
   number, twice) and "alfa-2b" (drug name suffix, not a dose). No mg, mg/m2, AUC, or numbered
   schedule anywhere.

2. UNGROUNDED CLAIMS: none beyond what the sidecar itself already flags. Independently grepped
   devita.txt for "ocular surface squamous", "OSSN", and "conjunctiv*" (17 hits) — every hit is
   unrelated (eyelid sebaceous carcinoma, conjunctival melanoma, drug-induced/radiation
   conjunctivitis, orbital invasion by other tumors). DeVita has zero disease-specific management
   content for OSSN/conjunctival SCC. The sidecar correctly labels every section
   "(general oncology standard, not from DeVita's section on this disease)" instead of falsely
   attributing content to DeVita, and its "Deliberately omitted" section explicitly withholds
   recurrence/cure-rate statistics and any surgery-vs-topical first-line preference for lack of
   grounding. This is honest degradation, not fabrication — but it means the file provides
   essentially zero DeVita-sourced content, which R1 should weigh as a coverage gap for this
   disease rather than a citation-integrity problem.

3. CITATION: present but atypical — the source line names "DeVita, Hellman, and Rosenberg's
   Cancer: Principles & Practice of Oncology, 12th ed." and explicitly states it was searched and
   found to contain nothing citable for this disease, then names NCCN general SCC principles
   (applied by extension) as the actual basis. No page numbers used, consistent with convention.

4. VERDICT: CLEAN (ready for R1) — no dose leak, no fabricated DeVita grounding, all claims
   correctly labeled as general-standard rather than falsely sourced. Flag for R1: this entry has
   effectively 0% DeVita coverage (a true negative, verified by independent grep), so R1 should
   decide whether a non-DeVita-grounded sidecar is acceptable for this disease or whether it needs
   escalation/different sourcing strategy.
