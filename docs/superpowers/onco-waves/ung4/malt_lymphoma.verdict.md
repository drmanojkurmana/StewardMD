# Adversarial verification: malt_lymphoma.md (EMZL / MALT lymphoma)

## 1. DOSE LEAK
None. Checked for mg, mg/m2, AUC, Gy, and numbered schedules (q_w, cycles, day N).
The only numbers present are outcome statistics (89% 5-yr OS, "two thirds" stage
I/II), which are not doses. Confirmed DeVita's actual dose figures (4 Gy low-dose RT
for ocular adnexal disease, 150 cGy splenic RT fractions) were correctly omitted from
the sidecar.

## 2. UNGROUNDED CLAIMS
None found unsupported. Spot-checked against DeVita Ch. 67 (EMZL section, lines
~267819-267989; Nodal MZL section ~267714-267746 for the BTK/PI3K/CAR-T paragraph;
Small Bowel Lymphoma Table 38.7 at ~116884-116910):

- "Two thirds of patients present with stage I/II" — verbatim in DeVita (line 267836).
- "5-year OS around 89%" in localized disease — verbatim match (line 267938, "5-year
  OS of 89%").
- Gastric EMZL / H. pylori eradication effective when t(11;18)-negative; RT preferred
  if H. pylori-negative, t(11;18)+, or non-regressing — matches DeVita 267941-267947.
- Ocular adnexal EMZL: RT primary, low-dose minimal toxicity, high RR/durable control;
  doxycycline studied for C. psittaci association, lower/less durable response than RT
  — matches DeVita 267951-267958 (sidecar correctly drops the actual numbers: 96-100%
  RT RR, 65% RR / 55% 5-yr PFS for doxycycline).
- HCV-associated EMZL: antiviral therapy may cause regression, considered before other
  systemic treatment even in advanced disease — matches DeVita 267931-267934.
- Systemic therapy options (alkylators, single-agent rituximab, purine-analog-based
  regimens, combination chemoimmunotherapy, occasional anthracycline-based regimens in
  younger/aggressive presentations) reserved for relapsed/refractory or advanced
  symptomatic disease, mirroring FL — matches DeVita 267939-267940, 267948-267971.
  Single-agent rituximab activity/durability claim matches DeVita's rituximab study
  (chemo-naive vs. previously treated, short duration of response) at 267965-267971,
  with the specific percentages correctly stripped out.
- BTK inhibitors (ibrutinib, zanubrutinib) FDA-approved for relapsed MZL, PI3K inhibitor
  (umbralisib) approved for relapsed/refractory MZL, CD19 CAR-T (axi-cel/ZUMA-5) still
  being explored in relapsed/refractory MZL third-line+ — this is a strong, verbatim
  match to DeVita's Nodal MZL section (lines 267721-267745: ibrutinib "FDA approved for
  patients with relapsed MZL," zanubrutinib "FDA-approved option for
  relapsed/refractory disease," umbralisib "approved by the FDA in this context," axi-
  cel "continues to be explored... third line and beyond"). The sidecar's inline
  caveat that this is documented for "MZL as a category" rather than EMZL-specifically
  is accurate and appropriately conservative — DeVita presents this paragraph under
  Nodal MZL, not EMZL, and the sidecar flags that.
- Small bowel marginal zone B-cell lymphoma: "surgery and/or chemotherapy" alongside
  H. pylori eradication — verbatim match to Table 38.7 (line 116909-116910).
- Transformation to ABC-like DLBCL, rare — matches DeVita 267837-267838.
- Staging/monitoring imaging (chest/abdomen/pelvis CT, neck/parotid/orbit imaging,
  bone marrow biopsy consideration for multifocal disease, gastric mucosa evaluation
  for non-gastric EMZL) — matches DeVita 267915-267920.

No specific regimen/drug/trial/statistic in the sidecar lacks DeVita support. The
sidecar's own inline "general oncology standard, not from DeVita" flags (watch-and-
wait rationale restated, surgery-not-curative framing, surveillance-after-eradication
practice, MDT referral) are honest self-disclosure of extrapolation beyond the source,
which is appropriate and expected, not fabrication.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
Oncology, 12th ed." (line 113). Name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1).

No dose leak, no em dashes, no unsupported specific claims. All drug names, approval
statuses, and stage/site-driven treatment logic trace cleanly to DeVita Ch. 67 (EMZL
section + Nodal MZL section for the BTK/PI3K/CAR-T paragraph, and Table 38.7 for the
small bowel variant). The draft agent's self-reported omissions (no antibiotic
regimen names/doses, no RT doses, no doxycycline response numbers, EMZL-vs-MZL
specificity flagged inline) match what was actually found in the text.
