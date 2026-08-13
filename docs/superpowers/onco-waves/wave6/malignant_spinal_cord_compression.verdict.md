# Adversarial verification verdict — malignant_spinal_cord_compression.md

Checked against DeVita, Hellman, Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed.,
Chapter 81 "Spinal Cord Compression" (lines 313142-313800 of the extracted text; full chapter body
through the reference list was read, not just the range the draft agent claimed).

## 1. DOSE LEAK
All numeric tokens in the sidecar, with verdict on each:
- "72 hours" (Step 4 Neurologic bullet) — a clinical timing threshold (matches source's ">72 hours"
  exactly), not a dose/mg/Gy/AUC/fractionation number. Not a leak.
- "grade 2 to 3" (x2) and "grade 0 to 1" (x1) — Bilsky grade numbers (0-3 scale), not doses. See
  ISSUE #2 below for why these are still worth flagging.
- "radium-223" — drug/isotope name, not a dose.
- "12th ed." — citation edition number.
- Step 1/2/3/4 section headers — not doses.

No mg, mg/m2, AUC, Gy, or numbered radiotherapy-fractionation schedule appears anywhere in the
document. The draft consistently converts DeVita's actual numbers into qualitative language
(e.g. "low-dose bolus" vs "much higher-dose bolus" instead of the source's "10 mg" vs "100 mg";
"a margin of separation" instead of "1 to 3 mm"; "very low radiation doses" instead of "4 Gy";
">85%"/"1-year local control" percentages dropped entirely). This is the correct pattern for the
dose-free policy and is applied thoroughly. **Verdict: no dose leak.**

## 2. UNGROUNDED CLAIMS
None found that lack DeVita support and aren't uncontroversial general-oncology standard (the latter
are explicitly and honestly flagged inline as "general oncology standard, not from DeVita's section
on this disease" — gastroprotection with steroids, VTE prophylaxis/bladder care/log-roll precautions,
myeloma's inclusion in the systemic-therapy-adjunct sentence). Spot-checked against source:
- Step 1 (histology-first, steroid-before-biopsy pitfall in lymphoma) — matches source verbatim in
  substance.
- Step 2 (steroids, oral vs IV, trauma-protocol dose not recommended, 10mg vs 100mg trial) — matches
  source (Sørensen trial), numbers correctly dropped.
- Step 3 (prognostic factors, KPS/life-expectancy >2 months gate) — matches source.
- MNOP framework, attribution to International Spine Oncology Consortium — matches source.
- Radiosensitivity tiering (lymphoma/myeloma very favorable; prostate/breast favorable; NSCLC/GI
  intermediate-unfavorable; melanoma/sarcoma/RCC resistant) — matches Table 81.2 substantively.
- Patchell 2005 RCT (surgery+RT vs RT alone, better ambulation/survival) + Rades matched-pair
  analysis (no benefit in elderly) — matches source, no OR/CI numbers leaked (correctly dropped
  "84% vs 57%, OR 6.2").
- Surgery risk factors (age, prior RT, diffuse spinal disease, poor PS, comorbidities), <3-month life
  expectancy cutoff for surgery, less-invasive alternatives (vertebroplasty/kyphoplasty/pedicle
  screws) — matches source (KPS 10-40 number correctly dropped to "poor performance status").
  Note: "life expectancy under about three months" is spelled out in words rather than digits — same
  underlying number as source's "<3 months," just not leaked as a digit-form dose/schedule.
- sSBRT biologically-effective-dose claim, spinal-cord-tolerance margin requirement, grade 2-3 not
  full-dose-sSBRT-eligible / grade 0-1 candidates — matches source substantively; minor stretch: the
  source says only "select cases of grade 1" get sSBRT (grade 0 is "the ideal case"), while the
  sidecar phrases "grade 0 to 1" as a general low-grade upfront-eligible bucket — a slight
  over-generalization but not a fabrication.
- Systemic therapy (chemo for NHL, EGFR inhibitors, hormonal therapy breast/prostate) and
  radium-223's short alpha-particle path length making it ineffective for epidural disease — matches
  source (the ~0.1 mm figure correctly dropped).
- "When to refer" grade 2-3 = oncologic emergency, unstable spine = surgical referral regardless of
  grade, new back pain in a cancer patient = presumed spine metastasis/MSCC until proven otherwise —
  matches source closely, including the CSF-obliteration distinction between grade 2 and grade 3.

No specific regimen, trial, or statistic was found that isn't traceable to this chapter or explicitly
labeled as outside-DeVita general standard.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th
ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES (minor, non-blocking)

- **Internal inconsistency in the omission disclaimer.** The closing section claims the "Bilsky and
  Spinal Instability Neoplastic Score grading thresholds... are omitted from this narrative," but the
  body text does use Bilsky grade numbers directly three times ("grade 2 to 3" x2, "grade 0 to 1"),
  and in the "When to refer" section it explicitly restates the criterion that distinguishes grade 2
  from grade 3 (spinal cord compression "with or without obliteration of the surrounding
  cerebrospinal fluid space") — which is itself the Bilsky scale's defining threshold, not merely a
  grade label. This isn't a clinical fabrication (the content is accurate per DeVita), but the
  disclaimer overclaims what was actually left out. R1 should either (a) strike the CSF-obliteration
  parenthetical and rely on plain-language severity description instead, or (b) fix the closing note
  to say the numeric grading criteria are used only where clinically load-bearing (emergency
  threshold) and the full 4-/6-point scale/SINS tool are otherwise left to a structured calculator.
- No dose leak, no unsupported clinical claims found otherwise. Ready for R1 once the above
  disclaimer/body inconsistency is reconciled (cosmetic fix, not a rewrite).
