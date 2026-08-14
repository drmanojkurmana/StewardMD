# ONCQIS Wave-1 Promotion Proposal (analysis only — nothing promoted)

Source: `docs/superpowers/onco-wave1-inventory.md` + the 15 re-mapped Standard Protocol JSONs and their
`.r1.md` verdicts in `docs/superpowers/onco-protocols-v2/`. All 15 protocols are currently
`status: DRAFT`, `clinicalApprovalStatus: null`, `evidence.guideline: []`. This document proposes a
ranking; **it does not change any protocol's status.**

Ranking basis, applied in this order: (1) dose-completeness — zero `VERIFY` anywhere in the dosing
path (drug dose/unit/days, cycle length, cycle count); (2) R1 verdict = APPROVE (as a draft); (3)
clinical frequency / general-adult-oncology relevance (how often the regimen is actually prescribed
today, not just historically named); (4) fewest remaining indication/eligibility `verifyFields`.

Two of the inventory's original "fully dose-verified" top-7 turned out to have an R1 verdict of
**REVISE** once the `.r1.md` files were read (`folfox-6`, `lv5fu2-de-gramont`), so they are demoted out
of the shortlist below despite being dose-complete. `fufiri` is also REVISE. All three are moved to the
"Not yet" list.

## Proposed Wave-1 shortlist (ranked)

All of the following are fully dose-verified (no VERIFY in dose/unit/days/cycle fields) and carry an R1
verdict of APPROVE-as-draft. None is clean of every caveat — R1 attaches "Important" pre-promotion
conditions to nearly all of them (mostly a batch-wide `evidenceStatus: "current"` sourcing issue and a
batch-wide schema `oneOf`/`anyOf` defect on the `VERIFY` sentinel) — but none has a Critical/blocking
clinical finding.

1. **modified-folfox-6** (Modified FOLFOX-6) — colorectal_cancer
   - Why it qualifies: all doses concrete; matches NCCN colon regimens / DeVita Table 40.13 exactly;
     R1 confirms "Dose/units/days/cycles — CORRECT & SAFE", no Critical findings; this is the current
     real-world CRC backbone (highest clinical frequency in the set) and ties for best eligibility
     completeness (6 VERIFY fields).
   - Remaining VERIFY fields (must resolve before ACTIVE): `histology`, `stage`, `biomarkers`,
     `treatmentSetting`, `lineOfTherapy`, `eligibilityCriteria`. Plus two R1 "Important" items:
     confirm/scope `treatmentIntent: ["curative"]` against the per-disease NCCN template (source table
     only supports metastatic/palliative), and set `evidence.core[0].evidenceStatus` to `"unknown"`
     (currently an unsourced `"current"` claim).
   - R1 status: **APPROVE** (for continued DRAFT status); no Critical findings.

2. **folfiri** (FOLFIRI, Douillard) — colorectal_cancer
   - Why it qualifies: all doses concrete, matches canonical Douillard FOLFIRI (LV5FU2 backbone, q14d)
     exactly; standard irinotecan-based CRC backbone, high frequency; 6 VERIFY fields.
   - Remaining VERIFY fields: `histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`,
     `eligibilityCriteria`. Plus 1 Important item (set `evidenceStatus` to `"unknown"`) and 2 Advisory
     items (spell out irinotecan-specific diarrhea management; `disease` string is a mechanical
     humanization, not sourced verbatim).
   - R1 status: **APPROVE** (with 1 Important + 2 Advisory to clear before promotion).

3. **folfirinox** (FOLFIRINOX, PRODIGE 4/ACCORD 11) — pancreatic_cancer
   - Why it qualifies: all doses concrete; standard first-line regimen for fit metastatic/locally
     advanced pancreatic cancer — very high frequency within that population; 6 VERIFY fields.
   - Remaining VERIFY fields: `histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`,
     `eligibilityCriteria`. Plus 2 Important items: set `evidenceStatus` to `"unknown"`; add
     irinotecan-diarrhea/UGT1A1 dose-reduction guidance before promotion. Also flags the batch-wide
     schema `oneOf`→`anyOf` defect on the `VERIFY` sentinel (schema-owner issue, not a content defect).
   - R1 status: **APPROVE** for DRAFT merge — promotion to selectable explicitly blocked until the two
     Important items are resolved.

4. **folfox-4** (FOLFOX-4, de Gramont) — colorectal_cancer
   - Why it qualifies: all doses concrete, every value matches the canonical de Gramont FOLFOX-4
     regimen; largely superseded by mFOLFOX6/FOLFOX-6 but still cited/used — moderate-high frequency;
     6 VERIFY fields.
   - Remaining VERIFY fields: `histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`,
     `eligibilityCriteria`. Plus: resolve `evidenceStatus` (source it or set `"unknown"`); do not
     promote until VERIFY fields resolved + `clinicalApprovalStatus` set + `review` populated;
     `doseModificationRules` is thin (single ANC/platelet delay rule) — acceptable for draft, expand
     before promotion.
   - R1 status: **APPROVE** (as DRAFT only) — blocks promotion/selectability until gating conditions
     above are met.

5. **simplified-lv5fu2** (Simplified LV5FU2) — colorectal_cancer
   - Why it qualifies: all doses concrete, matches published simplified LV5FU2/de Gramont exactly;
     practical 1-day variant, moderate frequency; 6 VERIFY fields.
   - Remaining VERIFY fields: `histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`,
     `eligibilityCriteria`. Plus 1 Important item: `treatmentIntent: ["palliative"]` is an unverified
     concrete claim not listed in `verifyFields` — confirm it's sourced or convert to VERIFY like its
     siblings. Also blocked by the batch-wide schema `VERIFY`-sentinel `oneOf` defect (must be fixed
     before this file can even pass schema validation, let alone promote).
   - R1 status: **APPROVE** (draft only; two items MUST be resolved before promotion/selectable).

6. **folfiri-simplified** (FOLFIRI, simplified/Andre variant) — colorectal_cancer
   - Why it qualifies: all doses concrete; single-day-visit FOLFIRI variant, used but less often cited
     than classic FOLFIRI (lower frequency than #2 above); 6 VERIFY fields.
   - Remaining VERIFY fields: `histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`,
     `eligibilityCriteria` (R1 calls out `lineOfTherapy`, `treatmentSetting`, `eligibilityCriteria` as
     especially important to resolve). NCCN-template mapping and institutional approval also still
     outstanding.
   - R1 status: **APPROVE** (as DRAFT), confidence 92 — contingent on DRAFT status remaining until
     NCCN-template mapping, R1 clinical sign-off, and institutional approval complete.

7. **roswell-park** (Roswell Park weekly bolus 5-FU/LV) — colorectal_cancer
   - Why it qualifies: all doses concrete; older weekly bolus regimen, still used in some settings but
     lower current frequency than infusional regimens; 6 VERIFY fields.
   - Remaining VERIFY fields: `histology`, `stage`, `biomarkers`, `treatmentSetting`, `lineOfTherapy`,
     `eligibilityCriteria` — R1 explicitly says a colorectal regimen "must not be selectable with
     histology/stage/setting/line unresolved." Plus: set `evidenceStatus` to `"unknown"`; surface that
     the guideline-layer (NCCN) check is outstanding rather than silently dropped.
   - R1 status: **APPROVE** (draft is clinically safe; two pre-promotion conditions).

8. **fufox** (FUFOX, Grothey weekly) — colorectal_cancer
   - Why it qualifies: all doses concrete; best eligibility completeness in the whole set (5 VERIFY
     fields, one fewer than every other protocol here) — but a German weekly oxaliplatin regimen that
     is niche/low current frequency outside that trial tradition, which is why it ranks below the
     higher-frequency regimens above despite the better VERIFY count.
   - Remaining VERIFY fields: `histology`, `stage`, `treatmentSetting`, `lineOfTherapy`,
     `eligibilityCriteria`. Plus: batch-wide schema `verifiable` `oneOf`/`anyOf` fix needed for the file
     to validate; clinician sign-off resolving every VERIFY field.
   - R1 status: **APPROVE** (draft clinical content is safe and source-faithful); promotion gated.

9. **aio-weekly-24h** (AIO weekly 24-hr infusion 5-FU/LV) — colorectal_cancer
   - Why it qualifies (weakest in this shortlist): all doses concrete, but worst eligibility
     completeness of the fully-dose-verified group (7 VERIFY fields, one more than the rest) and a
     largely historical German weekly infusional regimen — low current frequency. Included only because
     it clears the dose-completeness + R1-approve bar; ranked last.
   - Remaining VERIFY fields: `histology`, `stage`, `biomarkers`, `treatmentSetting`, `treatmentIntent`,
     `lineOfTherapy`, `eligibilityCriteria`. Plus 2 Important items: add DPD-deficiency consideration to
     `eligibilityCriteria`/clearance checks before selectable (fatal-toxicity red flag for all
     fluoropyrimidines); restore the sourced `intentOptions: ["palliative"]` that v2 replaced with
     `["VERIFY"]` when the indication layer is sourced.
   - R1 status: **APPROVE** (draft may remain non-selectable; must not be promoted until Important
     items closed).

## Not yet — needs sourcing

### R1 verdict = REVISE (blocking issue, independent of VERIFY-field count)

- **folfox-6** (FOLFOX-6, Tournigand) — colorectal_cancer. Dose-complete, high frequency, but R1
  returned REVISE — a specific correctness/honesty issue must be fixed and re-reviewed before this can
  even reach APPROVE-as-draft, let alone be considered for promotion. Read `folfox-6.r1.md` for the
  exact required fix before resubmitting for R1.
- **lv5fu2-de-gramont** (LV5FU2, de Gramont) — colorectal_cancer. Dose-complete, but R1 returned REVISE,
  blocking specifically on an `evidenceStatus` overstatement (Important #1 in `lv5fu2-de-gramont.r1.md`);
  doses/eligibility handling otherwise fine. Fix the flagged issue and re-run R1.
- **fufiri** (FUFIRI, Douillard weekly) — colorectal_cancer. Dose-complete but niche/low frequency and
  R1 returned REVISE on a schema-validation issue (the `VERIFY` sentinel `oneOf` match). Needs the fix
  plus a fresh R1 pass; lower priority than the REVISE items above given its low current frequency.

### Heavy-VERIFY / not fully dose-complete (AML/APL — high clinical frequency, but sourcing gaps in the dosing path itself)

- **aml-7-plus-3-induction** (7+3 induction) — acute_myeloid_leukemia. Per-drug doses concrete
  (100/60/12 mg/m2) but `cycleLengthDays`/`cycles` are VERIFY and daunorubicin-vs-idarubicin dose is
  only a range/either-or in Harrison. R1 verdict is also **REVISE** (idarubicin cumulative-dose cap
  and G-CSF framing must be fixed before promotion or even before this clears R1 as a clean draft).
  Needs: fixed induction duration/cycle count and a single disambiguated anthracycline dose, sourced
  from an institutional order set or NCCN AML template.
- **apl-atra-ato** (ATRA + ATO, low-risk APL) — acute_myeloid_leukemia. Per-drug doses concrete
  (45 mg/m2, 0.15 mg/kg) but `days[]` is empty and `cycleLengthDays`/`cycles` are VERIFY because
  Harrison gives no fixed duration ("continuously per day"). R1 verdict: APPROVE as DRAFT only — the
  dose values themselves are safe, but this is not dose-complete by the promotion bar. Needs: a fixed
  total induction duration and day-schedule, sourced from an NCCN APL template or institutional
  protocol.
- **aml-hidac-idac-consolidation** (HiDAC/IDAC consolidation) — acute_myeloid_leukemia. Per-drug doses
  concrete (3000/1500 mg/m2) but HiDAC-vs-IDAC is a physician choice not disambiguated to one value,
  IDAC itself spans a 1-1.5 g/m2 range, and `cycles` is a printed range ("2-4") not a single number.
  R1 verdict: APPROVE as DRAFT only. Needs: a single selected regimen (or an explicit,
  schema-supported choice mechanism) and a fixed cycle count, sourced the same way as above.

All three AML/APL protocols also need an NCCN per-disease chemotherapy order-template pass
(`evidence.guideline` is empty, same as every protocol in this inventory) before promotion can even be
considered.

### Cross-cutting blockers noted across nearly every `.r1.md` (not protocol-specific)

- Batch-wide schema defect: `$defs/verifiable`'s `oneOf` matches the literal `"VERIFY"` sentinel on both
  branches, so strict Draft-2020-12 validation fails on files that correctly use `"VERIFY"`. Needs a
  schema-owner fix (`oneOf` → `anyOf`) before any of these protocols can pass their own schema, which is
  itself a prerequisite for promotion.
- Batch-wide: several files assert `evidence.core[0].evidenceStatus: "current"` without an editor
  confirming currency (schema default is `"unknown"`). Should be normalized before promotion review.

## Promotion requires more than this document

This document is an analysis and ranking only. **No protocol's `status` or `clinicalApprovalStatus` has
been changed.** Promoting any protocol from DRAFT to ACTIVE/selectable requires, at minimum:

1. **Owner sign-off** on the ranked shortlist / promotion order.
2. **R1 CLINICAL APPROVAL** — a formal (not draft-gate) clinical review clearing every "Important" item
   listed above and resolving all `verifyFields` for that protocol.
3. **Per-hospital HOSPITAL APPROVAL** — each deploying institution's own sign-off (order-set alignment,
   local formulary/dose-cap policy), tracked in `evidence.institutional` — before that hospital's
   instance can select the protocol.

This proposal does not, and cannot, substitute for any of the three.
