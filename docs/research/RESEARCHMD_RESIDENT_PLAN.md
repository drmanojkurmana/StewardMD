# ResearchMD for residents: original studies, thesis start, real use (plan, 2026-11-24)

Goal: an MD/MS resident with an original study (cohort, cross-sectional, RCT) can plan it, get ethics approval,
analyse the master chart and write the paper on the phone, without paying a statistician.

## Fix 1. "Analyse my master chart" (original studies)  -> Grok (stats) + Qwen (screens)
- ON DEVICE: the master chart (CSV or XLSX) is parsed and analysed in the app. Patient rows never leave the phone,
  so no PHI upload, no IPD gate, 0 MaiK tokens.
- Identifier columns (name, phone, hospital number, address, Aadhaar, dates of birth) are detected and excluded first.
- Column types guessed (number, yes/no, categories, ID, date), one tap to correct.
- Right test chosen by fixed rules with the reason shown: Welch t / Mann-Whitney U, ANOVA / Kruskal-Wallis, chi-square /
  Fisher's exact, paired t / Wilcoxon / McNemar, Pearson / Spearman, logistic regression for risk factors.
- Outputs: Table 1 (baseline characteristics), results tables, a Results paragraph with every number generated from the
  calculation, DOCX/CSV export, "Use in my manuscript".
- research-stats.js: pure ES5, unit-tested against R reference values (Rscript run once, values frozen in the tests).

## Fix 2. Thesis start: sample size, ethics committee, consent, CTRI  -> Gemini 3.8 High (agy)
- Sample size calculator (two proportions, two means, single proportion / prevalence, with dropout), deterministic,
  with a ready synopsis paragraph. 0 tokens.
- Ask MaiK drafts (existing ai-draft pipeline, PHI gate, MaiK tokens, never auto-saved): IEC application, participant
  information sheet + informed consent form (English + one chosen Indian language), CTRI registration fields.

## Fix 3. Real use  -> Qwen (demo + feedback), orchestrator (end-to-end test), owner (pilot)
- "Try with a sample thesis": a synthetic 200-patient master chart built into the app (no real patient), so anyone can
  walk the whole flow in 2 minutes.
- "Tell us what went wrong" on every ResearchMD screen, through the existing /api/support feedback route (screen name
  attached, no patient data).
- One end-to-end headless test: new project -> sample size -> master chart -> Table 1 -> results -> manuscript -> DOCX.
- Owner pilot: 3 residents each take one real thesis or paper through the app on their own phone; every feedback ticket
  fixed within 24 hours; then decide 10/10.

## Order
Fix 1 and Fix 2 build in parallel in separate worktrees; Fix 3 demo and feedback ride with Qwen's screens. Orchestrator
merges into branch research-usability (PR #2737), checks screen/server shapes, runs every test and screenshots.
