# Adversarial verification verdict: chordoid_glioma.md

## 1. DOSE LEAK
None. Grepped for mg / mg/m2 / Gy / AUC / fractions / cycles: zero hits. The only digits in the
file are "grade 2" (WHO CNS grading, line 19), the numbered list markers "1./2./3." in the Lines of
Therapy section (line 52-54, which enumerate treatment steps by name with no attached dose/schedule
numbers), and "12th ed" in the citation (line 109). None of these are a dose, drug quantity, or
numbered dosing schedule.

## 2. UNGROUNDED CLAIMS
- Verified DeVita line 312592: chordoid glioma of the third ventricle is listed only as a cause of
  CSF-flow obstruction, in a chapter on increased ICP. No dedicated management section exists — matches
  the draft agent's report.
- Every substantive management claim (surgery as primary treatment, adjuvant RT for subtotal
  resection, re-resection/RT for recurrence, endocrine/visual surveillance, MDT referral pattern) is
  correctly inline-labeled "general oncology standard, not from DeVita's section on this disease" — not
  presented as DeVita-sourced. These are uncontroversial WHO-grade-2 neuro-oncology standards, consistent
  with guideline knowledge, so labeling them as general standard (rather than omitting) is acceptable.
- **One unflagged specific claim found**: "Surgery is both diagnostic (histology and PRKCA-mutation
  testing) and therapeutic" (in the "Newly diagnosed..." bullet). This sentence sits immediately after
  the bullet's "(general oncology standard...)" parenthetical but is its own separate sentence with no
  label of its own. PRKCA D463H is a real, specific molecular marker for chordoid glioma (WHO CNS5), but
  it is NOT in DeVita (confirmed: the only PRKCA hit in devita.txt, line 227430, is in an unrelated
  melanoma pathway table) and is not flagged as "general oncology standard, not from DeVita's section" the
  way every other specific claim in the document is. This breaks the sidecar's own labeling discipline —
  it's a specific, checkable molecular-testing claim presented without the disclaimer that surrounds
  every other specific assertion in the file.
- No trial names, response rates, survival statistics, or specific chemo/targeted-agent regimens appear
  anywhere — consistent with the draft agent's claim that none exist in DeVita for this entity and none
  were invented.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." — name only, no page numbers. Correct format.

## 4. VERDICT
**ISSUES (minor)** — not CLEAN as-is:
- Unflag or re-label the "(histology and PRKCA-mutation testing)" clause in the surgery bullet; it is
  a specific, unlabeled claim not supported by DeVita and should either be removed or given the same
  "general oncology standard, not from DeVita's section on this disease" (or a more precise "not sourced
  from DeVita" label) as every other specific claim in the document, to keep the sidecar's labeling
  discipline consistent.
- No dose leak, no fabricated regimens/trials/statistics, citation format correct, and the DeVita-only
  grounded claim (CSF obstruction/monitoring) is genuinely verified at line 312592. Otherwise safe for
  R1 review alongside this fix.
