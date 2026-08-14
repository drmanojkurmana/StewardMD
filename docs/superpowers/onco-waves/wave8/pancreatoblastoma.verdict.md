# Adversarial re-verification verdict - pancreatoblastoma.md (wave8, post-revision)

## 1. DOSE LEAK
None. Grepped the revised sidecar for digits: only "12th ed." (edition number)
and the SMAD4/CTNNB1/KRAS gene-name line (no numbers there). No mg, mg/m2,
AUC, cycle count, or numbered schedule anywhere in the file.

## 2. UNGROUNDED / MISLABELLED CLAIMS
The two previously-flagged unflagged claims are now fixed:
- "squamoid nests/corpuscles" is now correctly tagged
  `(general oncology standard, not from DeVita's section on this disease)` as
  a WHO-classification detail, and the grounded sentence beside it restates
  DeVita's actual wording (acinar cells, other cell types often present).
- The "DeVita notes that survival is poorer once disease is metastatic"
  mis-attribution is now split: the DeVita-sourced part (one-third metastatic
  rate + cure achievable) stays under DeVita's name, and the "less favourable
  outlook" claim is now its own sentence tagged
  `(general oncology standard, not from DeVita's section on this disease)`.
Both previously-flagged paraphrase-drift items are also fixed: "first eight
years of life" now matches DeVita's "first 8 years," and "Elevated serum
alpha-fetoprotein and hormone levels have been described" now matches DeVita's
wording exactly (no added "frequently" qualifier).

REMAINING ISSUE (new, introduced by the fix): in splitting the metastatic
claim, the DeVita-attributed half was rewritten as: "DeVita notes that ...
resection-based cure remains achievable in a meaningful proportion of
children even with metastatic presentation." DeVita's actual sentence is:
"Cures are often achievable with resection in children, although one-third
of patients present with metastatic disease" - two facts merely juxtaposed
with "although," not a stated claim that cure is achievable specifically *in*
the metastatic subgroup. "Even with metastatic presentation" is an
interpretive connection the source does not make, still delivered in DeVita's
voice ("DeVita notes that... resection-based cure remains achievable...").
This is the same category of defect the original review caught (an inference
not actually present in the source, attributed to DeVita by name), just with
the valence flipped (now overstates that cure applies to the metastatic
subset, instead of overstating that survival is worse when metastatic).

Everything else attributed to DeVita by name checks out against the source
paragraph (Chapter 35, "Less Common Pancreatic Cancers - Pancreatoblastoma"):
epidemiology/age, BWS/FAP association, AFP/hormone elevation, one-third
metastatic rate (as a standalone fact), adult cases with PDAC-comparable
resection survival, acinar-cell-predominant histology with other cell types
present, SMAD4/CTNNB1 mutations without KRAS. All other regimen-level claims
(neoadjuvant platinum+anthracycline backbone, metastasectomy consideration,
adult PDAC-line extrapolation, relapse/salvage gap disclosure, imaging
surveillance, genetics referral) are correctly and consistently tagged
`(general oncology standard, not from DeVita's section on this disease)`.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." - name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES (one residual item) - not yet CLEAN for R1 re-review.

- No dose leak, no em-dashes, citation format correct - clean on those fronts.
- The two originally-flagged defects (unflagged squamoid-nests claim,
  survival-attributed-to-DeVita sentence) and both paraphrase-drift items are
  genuinely fixed.
- Fix still needed: reword the metastatic-disease DeVita-attributed sentence
  so it doesn't assert "cure ... even with metastatic presentation" as a
  DeVita-stated connection. Either state the two DeVita facts side by side
  without the causal "even with" link (matching DeVita's own "although"
  juxtaposition), or move the cure-in-metastatic-subset inference into its own
  `(general oncology standard, not from DeVita's section on this disease)`
  tagged sentence, consistent with how the prior round's overreach was
  handled.
