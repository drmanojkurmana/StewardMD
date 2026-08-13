# Adversarial verification verdict - hereditary_papillary_renal_carcinoma.md

## 1. DOSE LEAK
None. Grepped for `[0-9]+ ?mg`, `mg/m2`, `AUC ?[0-9]`, `q[0-9]+[wd]`, `every N days/weeks`, `mg/kg` -
zero hits. All numerals present in the sidecar are non-dose descriptive stats that match DeVita's
disease/general-RCC text: type "1" papillary histology (repeated), penetrance "by age 80" (DeVita:
"nearly complete penetrance by 80 years of age"), "fewer than 35 kindreds" (DeVita: "less than 35
kindreds worldwide"), chromosome "7" (trisomy 7 / MET locus), cancer-specific survival "above 90%"
for T1 (DeVita: >98% T1a / 90% T1b / 86% T2 - a fair rollup, slightly loose for T1b which is exactly
90% not "above"), "30%" renal-remnant-preservation threshold (DeVita: "at least 30% of a
well-functioning remnant kidney"), thermal-ablation size cutoff "<3 cm" (DeVita: same), and "12th
ed." (edition number, not a dose). No drug doses, no AUC, no schedule numbers anywhere. Confirms
draft agent's claim.

## 2. UNGROUNDED CLAIMS
No fabricated regimen/drug/trial/statistic was found - every specific claim traced to a DeVita
passage (ASSURE/SORCE/S-TRAC/PROTECT/ATLAS/ARISER trial table at ~151080-151300; KEYNOTE-564
pembrolizumab adjuvant result at ~151095-151112; everolimus histology-agnostic-efficacy /
third-line-positioning passage at ~28029-28040; localized-RCC treatment section at ~150244-150650;
IVC-thrombus/papillary-histology-as-poor-prognostic-factor passage at ~150800-150820; HPRC
genetics passage at ~149782-149854).

However, one significant **inverse** problem: the sidecar's own grounding claim is factually wrong.
It repeatedly asserts DeVita has no disease-specific systemic-therapy data for HPRC -
- "DeVita's section on this disease is genetics- and pathology-focused; it does not lay out a
  disease-specific systemic-therapy algorithm for HPRC" (Overview grounding)
- "DeVita's disease-specific section does not itself specify a regimen" (Advanced disease bullet)
- "No specific drug names, doses, or regimens are given for MET-targeted or VEGF-targeted therapy
  in HPRC because DeVita's disease-specific section does not name or validate a specific agent for
  this syndrome" (Deliberately omitted)

This is incorrect. DeVita's HPRC/Type-1-PRCC section (line ~149982-149996 in the source text)
explicitly states: "foretinib (formerly known as XL880), a multikinase inhibitor that targets MET
among other tyrosine kinases, was evaluated in a phase II clinical trial in patients with
bilateral, multifocal, or metastatic papillary RCC or **HPRC with a germline MET mutation**.
Foretinib demonstrated activity in patients with advanced papillary RCC (ORR 13.5%; PFS 9.3 months)
with highest response in patients with germline MET mutations." That is disease-specific
(HPRC-population), named-agent, outcome-statistic evidence that DeVita does provide - and none of
it is a dose (no dose/schedule given in that DeVita passage either, so citing it would not have
created a dose leak). The sidecar's "silent"/"does not specify"/"does not name" framing is a
mischaracterization of the source, not a fabrication of new content - but it means R1 will be
working from an inaccurate premise that DeVita offers zero HPRC-specific systemic-therapy signal,
when in fact it offers a named MET inhibitor with a phase II efficacy readout in exactly this
population.

Everything else claimed as "general oncology standard, not from DeVita's HPRC section" (surveillance-
and-treat size-threshold strategy, NCCN referral, MET-inhibitor rationale by extrapolation) is
correctly and conservatively labelled as such and is uncontroversial.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed. NCCN Guidelines where noted as general oncology standard." Name only, no page numbers. Correct
format.

No em-dashes found (grepped "—", zero hits) - confirms draft agent's claim.

## 4. VERDICT: ISSUES

- Fix before R1: the sidecar's claim that "DeVita's disease-specific section does not name or
  validate a specific agent for this syndrome" / "does not lay out a disease-specific
  systemic-therapy algorithm for HPRC" is false. DeVita names foretinib and reports a phase II
  ORR/PFS readout specifically in HPRC/germline-MET-mutation patients (source line ~149982-149996,
  Chapter 43). This passage should be added to the "Advanced, unresectable, or metastatic disease"
  section (as descriptive trial evidence, not as a dosing instruction - no dose is given in DeVita
  for foretinib anyway) and the "Deliberately omitted" section's framing should be corrected to
  reflect that DeVita does name and report data on an HPRC-specific agent, even though it does not
  give a dose/schedule for it.
- No dose leak, no fabricated drugs/trials/stats, citation format correct, no em-dashes: all other
  aspects are clean.
