# Adversarial verification verdict — krukenberg_tumour

## 1. DOSE LEAK
None. Grepped for mg / mg-m2 / AUC / Gy / % / mL patterns and every bare digit in the file.
The only digit occurrences are marker/gene names (CK7, CK20, CDX2, HER2, CA19-9, CEA, CA125)
and "12th ed." in the citation line — no dose, no AUC, no numbered schedule.

## 2. UNGROUNDED CLAIMS
None beyond what the sidecar itself already discloses. Grepped DeVita for "Krukenberg":
10 hits, all incidental cross-references inside the Ovarian/Stomach/Gallbladder chapters
(definitional mentions — Blumer shelf, metastatic-to-ovary lists, "Krukenberg Syndrome" as
peritoneal seeding mechanism). No dedicated management/treatment section exists for this
disease in DeVita. The sidecar correctly flags this in its own "Grounding note" and labels
every specific therapeutic claim inline as "(general oncology standard, not from DeVita's
section on this disease)" rather than falsely attributing it to DeVita. No regimen names,
trial names, or statistics are asserted anywhere — the draft agent deliberately omitted them,
which is the correct call given zero DeVita grounding. This is unusually conservative, not
fabricated.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed. NCCN Guidelines (general oncology standard where cited above)." Name only, no page
numbers. Correct format, and honestly qualifies the NCCN portion as non-DeVita.

## 4. VERDICT: CLEAN (ready for R1)

Notes for R1: this sidecar is atypical in that it has near-zero direct DeVita grounding for
management (DeVita has no dedicated section on this disease) — every substantive claim is
labeled "general oncology standard, not from DeVita's section on this disease" rather than
cited to a page. That labeling is honest and matches what grep confirms. No fabricated doses,
regimens, trials, or statistics were introduced to compensate for the grounding gap.
