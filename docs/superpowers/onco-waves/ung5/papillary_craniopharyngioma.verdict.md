# Adversarial verification verdict — papillary_craniopharyngioma.md

## 1. DOSE LEAK
None. Grepped for numeric mg / mg-m2 / AUC / Gy / % patterns and scanned all digit-containing
lines: only "WHO grade 1", "BRAF V600E" (mutation name, not a dose), "phosphorus-32" (isotope
name, no activity/dose attached), and "12th ed" (edition number). DeVita's own section carries
plenty of doses for this disease (45.0-50.4 Gy fractionated RT, SRS 12-22 Gy, IBT 250 Gy median
to cyst wall, 3-5 mm margins, mortality/morbidity %, hypopituitarism incidence %) — the sidecar
correctly omits every one of them.

## 2. UNGROUNDED CLAIMS
- "occurs almost exclusively in adults" — not stated in DeVita's CRANIOPHARYNGIOMAS section
  (which gives an epidemiology reference for children too, ref. 501 "Craniopharyngiomas in
  children"). This is standard neuro-oncology teaching (papillary CP is essentially an
  adult-onset entity vs. adamantinomatous CP's bimodal/pediatric peak) — uncontroversial, but not
  DeVita-sourced for this disease's section as written.
- "WHO grade 1" classification — not stated in the DeVita CP section itself (it appears in the
  general CNS tumor-grading framework elsewhere in the book, not verified here). Uncontroversial
  standard WHO CNS5 classification fact.
- Neoadjuvant BRAF/MEK cytoreduction before surgery, and recurrent/unresectable-disease framing —
  explicitly self-flagged inline by the draft agent as general-oncology-standard, not DeVita-
  sourced; DeVita only supports the fact of "dramatic treatment responses" to combined BRAF/MEK
  inhibition, not this treatment-line positioning. Correctly disclosed, not silently fabricated.
- "All patients require referral to a multidisciplinary skull-base or neuro-oncology team..." —
  explicitly self-flagged as general-oncology-standard, not from DeVita's section. Correctly
  disclosed.
- Everything else checked (endoscopic endonasal/sphenoid approach, Ommaya reservoir for cystic
  disease, conservative-surgery-preserves-QOL, fractionated RT for gross residual/recurrent
  disease, IMRT/VMAT/proton sparing optic apparatus, proton reducing vasculopathy/neurocognitive/
  secondary-malignancy risk in younger patients, SRS for small-volume disease away from chiasm,
  P-32 IBT for progressive cystic disease, hypopituitarism as most frequent late RT complication,
  optic neuropathy/temporal lobe necrosis/secondary malignancy as rare, lifelong hormone
  replacement + desmopressin for DI, visual improvement after surgery in most with preop loss,
  neuropsych deficits after aggressive resection, surveillance-imaging-frequency/progression
  association, BRAF V600E testing for eligibility) is directly and closely paraphrased from the
  DeVita CRANIOPHARYNGIOMAS section (lines ~242796-242965 of the source dump), with every numeric
  qualifier DeVita attaches (percentages, Gy doses, mm margins) correctly stripped out.
- Chemotherapy: sidecar states cytotoxic chemo has no established role and is unaddressed in the
  source — confirmed accurate; DeVita's CP section never mentions cytotoxic chemotherapy.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN (ready for R1)

No dose leak. The handful of ungrounded statements are (a) uncontroversial standard-of-care /
classification facts, not fabricated specifics, and (b) in the two cases with real potential for
overreach (BRAF/MEK treatment-line positioning, MDT-referral mandate), the draft agent already
disclosed inline that they are general-oncology-standard rather than DeVita-sourced, rather than
passing them off as verbatim source content. No invented drug names, trial names, or statistics
beyond what DeVita supports.
