# Adversarial verification — gastrointestinal_stromal_tumour.md

## 1. DOSE LEAK
None. Grepped for `mg`, `AUC`, `mg/m2`, `Gy`, numbered cycles/schedules, and every bare number in the
file. All numbers present are non-dose: tumor sizes in cm (2 cm, 1-2 cm), exon numbers (9, 11, 18),
mutation names (D842V → matched as "842"), percent risk range (30-50%), duration in years (1-3, 3, 12),
PET timing (24 hours), and a "Chapter 39"-style year reference. No drug dose, AUC, mg/m2, or numbered
administration schedule anywhere in the sidecar. **Clean.**

## 2. UNGROUNDED CLAIMS
- **Radiation therapy section is actively wrong, not just cautious.** The sidecar states: "Radiotherapy
  is not established as a role in GIST management in this ground truth; no organ-specific curative or
  palliative radiotherapy indication for GIST was identified." DeVita Ch. 39 (Palliative Care subsection)
  directly contradicts this: "Extra-abdominal metastases are occasionally seen, mainly to the bone, and
  can require palliative irradiation." This is a real, if minor, palliative RT indication (bone
  metastases) that the sidecar claims does not exist in the source. Should be corrected to reflect the
  bone-metastasis palliative RT role rather than asserting none was found.
- **"PET can show very early metabolic response, within about 24 hours of the first dose"** — DeVita
  gives no "24 hours" figure. The text says a symptomatic subjective response can occur "in a matter of
  days" after starting an effective TKI, paralleled by metabolic response on FDG-PET, and that "a
  positive PET scan result may turn negative in a few days." The sidecar's specific "24 hours" number is
  not supported by the source and appears fabricated/over-precise; "days" is what DeVita says.
- **Minor/low-severity:** the differential-diagnosis list in the Overview ("retroperitoneal sarcoma,
  desmoid fibromatosis, germ cell tumours") extends beyond DeVita's explicit list ("epithelial tumors,
  small bowel endocrine tumors, lymphomas, paragangliomas, and so on"). DeVita's "and so on" makes this a
  plausible, guideline-standard extension rather than a fabrication, but it is not literally grounded in
  the text.

Everything else checked out well against DeVita Ch. 39 (and the Ch. 11 TKI table cross-reference):
genotype-driven management, 2 cm cutoff and 1-2 cm observation-vs-resection option, R0 goal with
narrower-than-adenocarcinoma margins, no routine lymphadenectomy, tumor rupture as an adverse factor,
neoadjuvant imatinib 6-12 month response window, 3-year adjuvant duration and 30-50% risk threshold,
exon 9 KIT adjuvant-dosing controversy, D842V/exon 18 imatinib resistance and avapritinib efficacy +
cognitive neurotoxicity, sunitinib/regorafenib/ripretinib line sequencing and their genotype-specific
activity, dose-escalation-on-progression pattern, secondary resistance mutation sites (exons
13/14/17/18), heterogeneity of resistance, "limited/nodule-within-nodule" progression managed with
local ablation/surgery + continued TKI (explicitly non-prospective, as the sidecar notes), unproven
metastasectomy benefit + failed prospective accrual trial, CT as most sensitive follow-up modality,
2-3 year peak relapse window, late relapses more common in low-mitotic-rate tumors, and no role for
routine surveillance endoscopy. All matched DeVita without embellishment.

## 3. CITATION
Present and correctly formatted: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." — name only, no page numbers.

## 4. VERDICT: ISSUES
- Fix the Radiation Therapy section: DeVita does describe a palliative RT role for bone metastases in
  advanced GIST; the sidecar's blanket "no radiotherapy indication was identified" is contradicted by the
  source and should be corrected (not just softened).
- Remove or soften the "within about 24 hours" PET-response claim to match DeVita's actual wording
  ("a matter of days" / "a few days") — no 24-hour figure is grounded in the text.
- Optional/low-priority: trim the differential-diagnosis list back to what DeVita states, or note the
  extension is illustrative rather than sourced.

No dose leak. Citation format correct. The two substantive issues above should be fixed before this is
considered ready for R1; the rest of the sidecar is well-grounded in DeVita Ch. 39.
