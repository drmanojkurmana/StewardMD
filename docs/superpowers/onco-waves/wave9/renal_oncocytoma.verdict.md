# Verdict: renal_oncocytoma.md

## 1. DOSE LEAK
None. No mg, mg/m2, AUC, or numbered chemo/RT schedule anywhere in the sidecar.
Only numeric clinical parameters present are diagnostic/monitoring intervals ("every 3 to 6
months" for surveillance imaging), which are directly lifted from DeVita's own phrasing for
SRM active surveillance (line ~150345, "serial imaging (every 3 to 6 months)") — not a dose,
not flagged.

## 2. UNGROUNDED CLAIMS
Two claims are not traceable to the DeVita passages cited, and — unlike the rest of the
document, which consistently tags borrowed general-oncology content inline — these are
stated as plain fact with no tag:

- "Immunohistochemistry can help separate oncocytoma from chromophobe RCC when biopsy is
  done" — grepped DeVita for "immunohistochemistry" near oncocytoma/chromophobe: no hit.
  Uncontroversial pathology practice (CK7/CD117 panels are standard), but not found in the
  cited chapter and not tagged as outside-DeVita, breaking the doc's own convention.
- "resected 'oncocytoma' specimens can occasionally reveal chromophobe RCC or a hybrid tumor
  on full pathologic review" (Monitoring section) — reasonable inference from DeVita's
  discussion of hybrid oncocytic-chromophobe tumors and BHD-associated hybrid tumors (line
  150103), but DeVita does not state this post-resection-discordance claim explicitly, and it
  is likewise untagged.

Everything else checks out against DeVita almost verbatim:
- Kutikov et al. risk-stratification algorithm for renal mass biopsy selection — confirmed,
  DeVita line ~149274 ("Kutikov et al. have proposed a risk stratification algorithm...").
- 99mTc-sestamibi SPECT/CT as an adjunct for mitochondria-rich tumors (chromophobe RCC/
  oncocytoma) — confirmed, DeVita line ~149164-149167 (sidecar correctly omits the cited
  83.3%/95.2% sens/spec figures).
- Biopsy diagnostic yield "in most cases" / "grading concordance is only moderate" —
  confirmed pattern (DeVita gives 80-90% diagnostic yield, 60-70% grading concordance at line
  ~149268; sidecar correctly omits the exact percentages).
- Active surveillance for SRM endorsed by guidelines, for small lesions and where competing
  risks of death outweigh benefit of treatment, serial imaging every 3-6 months — confirmed
  near-verbatim, DeVita line ~150345-150355.
- Partial nephrectomy (nephron-sparing) preferred over radical nephrectomy as standard of
  care for SRM, citing renal-function preservation rationale — confirmed, DeVita line
  ~150247 ("PN is now accepted as standard of care for SRM, based in part on the appreciation
  of the deleterious renal functional consequences of RN").
- Treatment armamentarium for SRM = RN/PN/TA/AS, "no one approach is best in all
  circumstances," urologist-with-expertise involvement essential — confirmed near-verbatim,
  DeVita line ~150244-150247 (note: the sidecar tags the "urologist" sentence as
  "general oncology standard, not from DeVita" — actually this phrase IS from DeVita's RCC
  chapter almost word for word; the tag is overly conservative but not a fabrication risk).
- Birt-Hogg-Dube: autosomal-dominant, hereditary, cutaneous (fibrofolliculoma) + pulmonary
  (cysts/pneumothorax) manifestations, chromophobe RCC/hybrid oncocytic tumors — confirmed,
  DeVita line ~150097-150106.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed. NCCN Guidelines (general renal mass management principles, where noted above)." —
name only, no page numbers, matches requirement.

## 4. VERDICT: ISSUES (minor)

- Two untagged claims (IHC oncocytoma-vs-chromophobe distinction; occasional pathologic
  discordance on resected "oncocytoma" specimens) are not found in the cited DeVita text and
  should either be tagged "(general pathology standard, not from DeVita's section on this
  disease)" the same way the rest of the note tags borrowed content, or be removed/softened
  to match the doc's own grounding discipline.
- One over-cautious mistag: the "urologist with expertise" sentence is labeled non-DeVita but
  is actually a close paraphrase of DeVita's own RCC-chapter text — harmless (errs toward
  under-claiming DeVita support, not over-claiming), not required to fix.
- No dose leak. No fabricated regimens, trial names, or statistics. Everything else that
  carries a specific claim is grounded in the cited DeVita passages, and the numeric figures
  DeVita does report (sens/spec, biopsy yield/concordance %) were deliberately and correctly
  left out rather than invented.

Not blocking, but R1 should decide whether to tag or trim the two flagged sentences before
sign-off.
