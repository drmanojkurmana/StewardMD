# Adversarial re-verification verdict: mesothelioma.md (round 2)

Reviewer: independent re-verification pass (not the drafting/revising agent).
Grounded against: /Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt,
DeVita Ch. 76 "Benign and Malignant Mesothelioma," Treatment section
(approx. lines 292025-293345).

## 1. DOSE LEAK
Scanned for mg, mg/m2, mg/kg, AUC, Gy, cycle counts, numbered q-schedules
(`grep 'mg\|AUC\|cycle\|q[0-9]'` and manual read). **None.** Only numerals
present are non-dose labels: "R0", "MARS 2", "PD-1"/"CTLA-4", "BAP1",
"12th ed". Verdict: no dose leak, confirmed on re-check.

Also confirmed: no em dash anywhere in the file.

## 2. UNGROUNDED / MISLABELLED CLAIMS
None found on this pass. The single prior blocking issue is now fixed
correctly:

- **Role of radiotherapy, bullet 1 (SEER vs. NCDB direction) — FIXED,
  verified correct.** Sidecar now reads: "a large registry analysis of
  surgery with adjuvant radiotherapy versus surgery alone did not show an
  added survival benefit from the radiotherapy, while a separate large
  registry analysis of definitive radiotherapy (without surgery) versus no
  definitive treatment suggested a significant survival benefit." This
  matches DeVita exactly: the SEER analysis found "no difference when
  combined surgery and radiation was compared to surgery alone," and the
  separate NCDB analysis of definitive RT found a 2-yr OS improvement from
  20% to 34% (adjusted HR 0.87), "suggesting a significant benefit with the
  use of RT" (devita.txt lines ~293200-293214). Direction is now correct on
  both clauses.

- Re-spot-checked and still grounded: MARS trial (no added benefit, worse
  EPP survival, small-sample/high-perioperative-mortality criticism) and
  MARS 2 (extended P/D after induction chemo vs. chemo alone); IMRT/IMPRINT
  mixed-evidence framing (NCDB null vs. single-center positive finding,
  framed as unsettled); CheckMate 743 (dual-ICI OS benefit, larger
  magnitude in non-epithelioid/biphasic-sarcomatoid histology; epithelioid
  sequencing left individualized); antifolate-platinum doublet as SOC with
  carboplatin/single-agent substitutions; bevacizumab/MAPS (OS benefit, no
  formal regulatory approval, limited adoption); TTFields/STELLAR
  (single-arm trial, device-specific HDE approval, not RCT-tested) —
  correctly labelled "(general oncology standard, not from DeVita's section
  on this disease)"; CALGB 20901 maintenance pemetrexed (no PFS benefit,
  closed early for poor accrual); RAMES gemcitabine+anti-VEGFR
  (ramucirumab) salvage OS benefit needing confirmation; single-agent
  CTLA-4/DETERMINE null result; rare ALK-fusion case-report response and
  BAP1/PARP (MiST, rucaparib) early/mixed-activity data, both scoped as
  non-standard; mesothelin CAR-T/antibody-construct limitations (poor
  penetration, short persistence, toxicity); "essentially all patients...
  should be considered for ICI" hedge (matches DeVita's own conclusion,
  with a reasonable added contraindication carve-out, not an overreach);
  Monitoring section's honest "schedule not found in the section reviewed"
  admission, correctly tagged general-oncology-standard rather than
  attributed to DeVita.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." (last line). Name-only, no page numbers.
Meets requirement.

## 4. VERDICT
**CLEAN — ready for R1 re-review.**

- Dose-leak check: clean.
- Em-dash check: clean.
- Citation: clean.
- The one previously-confirmed issue (SEER/NCDB radiotherapy direction
  swap) is now correctly stated and verified word-for-word against
  DeVita's actual database-comparison language.
- No new fabrications, mislabelling, or attribution errors introduced by
  the rewrite.
