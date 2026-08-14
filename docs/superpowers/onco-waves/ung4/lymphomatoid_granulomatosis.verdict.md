# Adversarial re-verification verdict — lymphomatoid_granulomatosis (rev3)

Sidecar: `docs/superpowers/onco-waves/ung4/lymphomatoid_granulomatosis.md`
DeVita source: `/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt` (12th ed)

## 1. DOSE LEAK
`none`. Re-grepped for mg/mg-m2/AUC/cycle-day-schedules/numbered regimens — no hits. "grade one
to three"/"grade 1/2/3" is histologic-grade language, not dosing. Document still explicitly
states doses/schedules are not specified here.

## 2. UNGROUNDED / MISLABELLED CLAIMS
Re-ran the DeVita grep independently: `grep -n -i "lymphomatoid granulomatosis"` → same 2 hits as
both prior rounds — line ~67661 (bare WHO thoracic-tumor TOC entry, "6.3 Lymphomatoid
granulomatosis of the lung," followed only by a citation line, no body text) and line ~266692
(bare WHO haematolymphoid classification-list entry, no discursive text). Confirmed: DeVita
contains zero management narrative for this entity. The Sourcing note's characterization remains
accurate.

Checked the two passages named in the R1/adversarial-review gap as still needing fixes:
- **"Treatment approach by grade/intent" section** (low-grade: reduce immunosuppression +
  interferon-alfa + single-agent rituximab for CD20+ non-responders; high-grade: rituximab +
  CHOP-like anthracycline backbone as "the standard approach") — now has a section-level tag
  ("General oncology standard, not from DeVita's section on this disease, for the grade-directed
  treatment approach described in this section") placed directly under the heading, before the
  first bullet. Confirmed it precedes and covers both the low-grade and high-grade bullets.
- **"Lines of therapy" section** (restates the same low-grade and high-grade first-line regimens)
  — now has its own section-level tag directly under the heading, confirmed covering both
  restated bullets. The third bullet (RR-DLBCL-like salvage) still carries its pre-existing inline
  tag too — redundant, not a problem.

No new unlabelled specific-regimen/drug/trial/statistic claims found elsewhere in the document.
No claim is mis-attributed to DeVita as its source — the Sources line correctly scopes DeVita to
the bare classification-list citation only.

## 3. CITATION
Present (Sourcing note + terminal Sources line). Names sources only (DeVita, Hellman, and
Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed.; WHO Classification of
Haematolymphoid Tumours) — no page numbers. Correctly scopes DeVita to the classification-list
citation, not the management-content source. Clean.

## 4. VERDICT: CLEAN — ready for R1 re-review.
Both passages named in the prior adversarial verdict (grade-directed treatment-approach content,
and its restatement under Lines of therapy) now carry section-level inline tags that correctly
cover every regimen-specific bullet beneath them. No dose leak. No fabrication. No DeVita
mis-attribution anywhere in the document. Citation format clean (name only, no page numbers).

Non-blocking cosmetic note (out of scope for this round, not a labelling/grounding issue): the H1
title uses an em dash ("— Management"); sibling files in this wave mix hyphens and em dashes in
their headers. No clinical-content impact.
