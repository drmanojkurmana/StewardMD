# Adversarial re-verification — gastrointestinal_stromal_tumour.md (post PET-timing fix)

## 1. DOSE LEAK
None. Grepped for `mg`, `mg/m2`, `mg-m2`, `AUC`, numbered schedules — zero hits. Drugs are named
generically only (imatinib, sunitinib, regorafenib, ripretinib, avapritinib), no numeric strength or
administration schedule anywhere in the file. Sizes/durations present (2 cm resection cutoff, 1-2 cm
observation range, 30-50% risk framing, 3-year adjuvant duration, 6-12 month neoadjuvant window, 2-3
year peak-relapse window) are clinical thresholds/durations, not drug doses. **Clean.**

## 2. UNGROUNDED / MISLABELLED CLAIMS
The one blocking item from the prior round is now correctly fixed, with no new issue introduced:

- **PET-timing (line 21, neoadjuvant-imatinib bullet) — verified fixed.** Now reads "PET metabolic
  response can demonstrate tumour responsiveness in a matter of weeks, well before dimensional
  shrinkage is apparent." Checked against DeVita's preoperative/neoadjuvant passage: "tumor response
  should be monitored closely. Positron emission tomography (PET) scanning is a resource because it can
  demonstrate tumor responsiveness in a matter of weeks." Exact match — correctly reverted to the
  neoadjuvant-context wording, no longer borrowing the "days" language that belongs to the
  advanced-disease passage.
- **PET-timing (line 55, monitoring section) — re-verified untouched and still correct.** "Symptomatic
  improvement and metabolic response on FDG-PET can appear within a matter of days of starting an
  effective TKI, and a positive PET scan can turn negative within a few days" matches DeVita's
  advanced/metastatic-disease response passage: "a subjective response may take place very early. In a
  matter of days after starting an effective TKI, a symptomatic patient may well feel a clear degree of
  subjective improvement... A positive PET scan result may turn negative in a few days." Confirmed
  correctly sourced; left alone as instructed.
- Regimen sequencing (imatinib -> sunitinib -> regorafenib -> ripretinib; avapritinib for D842V/exon 18)
  matches DeVita's GIST-chapter drug list and lines-of-therapy ordering.
- Radiation-therapy section (no curative role, palliative use for bone metastases only) still matches
  DeVita's Palliative Care subsection, unchanged from prior pass.
- No claim found mis-attributed to DeVita; no claim needing a "(general oncology standard...)" label was
  found unlabelled.

All other content re-spot-checked against DeVita Ch. 39 without new findings: genotype-driven
management, KIT/PDGFRA/SDH/NF-1 biology, AFIP/MSKCC/contour-map risk tools, 2 cm resection cutoff,
R0 goal with narrower-than-adenocarcinoma margins, no routine lymphadenectomy, tumor-rupture definition,
3-year adjuvant duration + 30-50% risk framing + benefit attenuation over 1-3 years, exon 9 KIT
adjuvant-dosing controversy (de-numericized), D842V/exon 18 resistance + avapritinib efficacy and
cognitive-neurotoxicity caveat, dose-escalation-on-progression rationale (de-numericized),
secondary-resistance mutation sites/heterogeneity, "nodule within nodule" limited-progression pattern
(flagged non-prospective), unproven metastasectomy benefit + failed prospective accrual trial, CT as
most sensitive follow-up modality, 2-3 year peak relapse window, and no routine surveillance endoscopy.

## 3. CITATION
Present and correctly formatted: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." — name only, no page numbers.

## 4. VERDICT: CLEAN
Ready for R1 re-review. The prior blocking PET-timing mis-sourcing (line 21) is resolved and
independently re-verified against DeVita's actual neoadjuvant-context wording ("in a matter of weeks");
the untouched monitoring-section wording (line 55, "days") is separately re-confirmed correct for its
own (advanced-disease) context. No dose leak, no new fabrication or mislabelling, citation format
correct.
