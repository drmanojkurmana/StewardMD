# Adversarial verification — tumour_lysis_syndrome.md

Grounded against DeVita 12th ed, Chapter 82 "Tumor Lysis Syndrome and Hyperuricemia" (lines
313952–314136, incl. Table 82.1 and the risk-stratification figure text).

## 1. DOSE LEAK
None found. Grepped the sidecar for digits, `mg`, `AUC`, `dose`, `infusion`, `day(s)`, `hour(s)`,
`daily`:
- Only numeric hits in the whole file: "12th ed" (edition number, not a dose) and the two
  `G6PD`/inline-disclosure lines (no numbers in them).
- "roughly a day before chemotherapy" (line 38) is a vague paraphrase of DeVita's precise "24 hours
  before chemotherapy administration" — deliberately de-precisioned, not a leaked number/schedule.
  Borderline-worth-noting but not a violation of the no-dose-number rule.
- "twice daily" / "daily monitoring" (lines 38, 47, 52, 90) are lab-monitoring cadence, verbatim
  from DeVita's "should be monitored twice daily" — not a drug dose or treatment schedule.
- No rasburicase/allopurinol/febuxostat mg, mg/kg, mg/m2, AUC, or day-count regimen anywhere
  (DeVita's 0.2 mg/kg, 0.15 mg/kg, 5-day/3-day arms, 96-hour endpoint, trial name EFC 4978, and
  the Fasturtec/Elitek brand names are all correctly and completely omitted).

**Verdict: no dose leak.**

## 2. UNGROUNDED CLAIMS
None of concern. Every specific regimen/drug claim traces to the excerpt:
- Risk-stratification 4-tier scheme (low/intermediate/high/established) — matches Table 82.1 /
  Figure 82.1 text exactly, including the tumor-burden, cell-lysis-risk, and organ-function
  descriptors.
- Xanthine oxidase inhibitors (allopurinol, febuxostat alternative), rasburicase mechanism
  (urate oxidase → allantoin, more soluble), rasburicase reserved for high-risk/established TLS
  due to cost, hyperkalemia/hyperphosphatemia/hemodialysis management — all directly grounded.
- The draft agent itself flagged the two claims that are NOT verbatim in the excerpt
  (G6PD-rasburicase contraindication; avoid-routine-calcium-supplementation caution) as
  general-oncology-standard rather than DeVita-sourced, and disclosed this inline rather than
  passing it off as a DeVita claim. Both are uncontroversial, well-established standard-of-care
  facts, so this is acceptable per the instructions, and the transparency is correct practice.
- Two additional lines carry a similar implicit inference without an inline disclosure: "early
  involvement of nephrology (and critical care where relevant)" (lines 98–101) and "continuous
  cardiac monitoring... individualised" (lines 92–94, though this one IS flagged). The nephrology
  referral line is uncontroversial general practice and consistent with DeVita's framing of
  hemodialysis as fallback, so not treated as a fabrication — but it is technically an
  undisclosed non-verbatim inference. Minor, not blocking.
- No invented trial names, statistics, or regimens beyond what's in the excerpt; the epidemiology
  numbers DeVita gives (42%/6% NHL, 3.4%/5.2%/6.1% AML/ALL/NHL, 0.9% mortality) were appropriately
  left out entirely rather than mangled.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." (line 114) — name only, no page numbers. Correct format.

## 4. VERDICT
**CLEAN (ready for R1).**

Minor non-blocking note for R1's awareness: the nephrology/critical-care referral trigger (lines
98–101) is an undisclosed inference beyond the verbatim excerpt (uncontroversial, but not
inline-flagged like the G6PD/calcium items were). Does not warrant a rewrite.
