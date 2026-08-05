# Clinical Safety Validation (Phases 6 + 13)

_Method: static audit + **dynamic** - the shipped drug-interaction engine was loaded in Node and ~75
real drug-pair probes were executed. Every Critical/High below was **reproduced against the running
engine**. No clinical logic was modified (per the Phase 13 rule)._

**Golden regression:** `test/run-golden.mjs` (reasoning engine) fully green; all clinical interaction
assertions pass. The DDI engine is class/mechanism-based - a rule fires only if a drug is mapped to the
right class; `normalizeMed` strips `epc:*` umbrella classes. The whole ruleset is only **6 contraindicated
+ 34 major** rules ("broad screen, not exhaustive"). The misses below are tier-1 interactions any
clinician expects a checker to catch, plus data errors that fire dangerous alerts on SAFE combinations.

## STATUS UPDATE (2026-08-05): CR1-CR3 FIXED (commit 34fc5153, test-driven)

All three CRITICALs below were remediated after this audit, test-first
(`test/interaction-critical-fixes.test.mjs`, 10/10), with the golden regression unchanged
(`run-golden.mjs` all green; `run-interactions.mjs` clinical assertions pass, its 1 failure is a
pre-existing UI-tile locator). Full suite 1640 tests / 1635 pass, no new failures. Fix summary:
CR1 -> new `cyp2c9_inhibitor` class on metronidazole/co-trimoxazole/cotrimoxazole/amiodarone + a
`pair-warfarin-cyp2c9` rule + a `pair-warfarin-fluoroquinolone` rule + the co-trimoxazole hyphen bug
reconciled. CR2 -> two contraindicated rules (`pair-colchicine-cyp3a4strong` + `pair-colchicine-pgp`). CR3 ->
removed the wrong `opioid`/`cns_depressant` classes from paracetamol + naloxone (combo products like
paracetamol+codeine unaffected; morphine+diazepam still fires).

**R1 RE-REVIEW: CONFIRMED-GOOD** (commit 4f318012). The reviewer loaded the engine, probed a broad drug
spread, and confirmed all three CRITICALs are correctly closed with **no new false-positives and no new
misses**: cyp2c9_inhibitor has exactly the 4 correct drugs (no double-fire, non-CYP antibiotics stay
silent), hyphen bug fully reconciled, paracetamol/naloxone now inert with the genuine opioid+benzo alert
preserved and combo products intact. It flagged ONE residual in my own CR2 fix (the rule claimed "P-gp"
but only keyed on strong CYP3A4, so colchicine + cyclosporine still missed) - **now closed** by splitting
into the two rules above (colchicine + cyclosporine/verapamil/amiodarone now contraindicated).

**Known minor (fast-follow, not a safety issue):** colchicine + a drug that is BOTH a strong CYP3A4 AND
a P-gp inhibitor (clarithromycin, ketoconazole, itraconazole, ritonavir) fires the contraindicated alert
twice. This is a true-positive redundancy (both alerts are correct), not the CR3 false-alert problem; a
rule-match dedup by drug-pair in the engine would collapse it. Also open (pre-existing, non-regression):
colchicine + erythromycin/diltiazem (not tagged strong-CYP3A4 or P-gp) still miss - a data-tagging gap.

## STATUS UPDATE (2026-08-05): H1-H7 FIXED (test-driven)

All seven HIGH items are now remediated, test-first, with the golden regression unchanged.

**H1-H6 (DDI ruleset, `interaction-rules.js`)** - guarded by `test/interaction-high-fixes.test.mjs` (17/17),
`test/interaction-critical-fixes.test.mjs` still 12/12, `run-golden.mjs` all green, `run-interactions.mjs`
clinical assertions pass (its 1 failure is the pre-existing home-tile locator, not the ruleset). A
false-positive sweep of common safe pairs (amlodipine+metformin, lisinopril+atorvastatin, aspirin+paracetamol,
digoxin+amlodipine, apixaban+metformin, spironolactone+metformin, lithium+paracetamol, HCTZ+metformin,
potassium+metformin) stays silent. Fix summary:
- **H1** - `pair-allopurinol-azathioprine` -> `pair-xanthineoxidase-azathioprine`, subject widened to the
  `xanthine_oxidase_inhibitor` class so azathioprine + febuxostat now fires (allopurinol still fires).
- **H2** - the two named `pair-digoxin-amiodarone` + `pair-digoxin-verapamil` rules collapsed into one
  `pair-digoxin-pgp` (digoxin x `pgp_inhibitor` class). digoxin + clarithromycin now fires; amiodarone fires
  exactly once (no double).
- **H3** - new `pair-potassium-sparing-supplement` (`potassium_sparing_diuretic` x `potassium_supplement`);
  spironolactone/amiloride + potassium now fire.
- **H4** - lisinopril de-tagged (`["ace_inhibitor","raas"]`, was mis-tagged diuretic/thiazide) + two new rules
  `pair-lithium-thiazide` and `pair-lithium-loop`; lithium + HCTZ/furosemide now fire, lithium + lisinopril
  still fires exactly once.
- **H5** - `pair-warfarin-aspirin` -> `pair-anticoagulant-antiplatelet` (class x class); warfarin+clopidogrel,
  apixaban+aspirin, warfarin+aspirin all fire. (warfarin+aspirin also fires the pre-existing warfarin x NSAID
  rule - a true-positive redundancy, count unchanged from before the fix.)
- **H6** - new `pair-doac-pgp` (`doac` x `pgp_inhibitor`); apixaban+clarithromycin, rivaroxaban+ketoconazole,
  dabigatran+verapamil now fire.

**H7 (SknX, `sknx-engines.js`)** - guarded by `test/sknx-melanoma-caveat.test.mjs` (8/8). ANY pigmented/
melanocytic TOP differential (nevus, lentigo, seborrheic/benign keratosis, ...) now forces `rxEligible=false`
and surfaces a "cannot exclude melanoma" point-of-decision caveat, closing the gap where a melanoma read as a
benign nevus (no ABCDE, not OOD) would have been `referral=false, rxEligible=true`. Non-pigmented reads
(psoriasis) stay Rx-eligible; the existing malignant-lesion, red-flag, and OOD guardrails are unchanged. The
two on-device-vision tests that asserted the old (unsafe) "nevus -> Rx-eligible" contract were updated to the
new contract.

**R1 RE-REVIEW: CONFIRMED-GOOD, no blocking defects.** The reviewer loaded the engine, ran ~60 pairs beyond
the test file, ran all 59 deployed cloud labels + the on-device labels through the H7 matcher, and confirmed
the golden is untouched (68/68 across the four fix suites). All seven intended fixes fire correctly and close
the stated false negatives. It surfaced Important fast-follows (all failing in the safe direction, none
eroding a specific alert) which are **now closed:**
- Class-hygiene FPs that widening-to-class exposed: the auto-derived `anticoagulant` class carried three
  non-anticoagulants (`protamine sulfate` - a reversal agent whose alert was backwards, `sodium citrate`,
  `edetic acid`); `doac` carried parenterals (`fondaparinux`, `bivalirudin`); `pgp_inhibitor` carried
  non-inhibitors (`abciximab`, `zonisamide`, `sarecycline`). These are de-tagged (fondaparinux/bivalirudin
  keep `anticoagulant`, so their genuine antiplatelet interaction still fires). Guarded by 8 new no-FP
  assertions in `test/interaction-high-fixes.test.mjs` (now 25/25).
- H7 coverage on the deployed model: the label-gated force only fires on melanocytic label strings, and the
  deployed 59-class taxonomy has no melanocytic class - so a melanoma read as an inflammatory label carried
  no caveat. Closed with a **blanket** limitation in the always-shown educational disclaimer
  (`sknx-screens.js`): "This tool does not detect melanoma: evaluate any pigmented, new, or changing lesion
  clinically." The per-lesion force now also covers the `dermatofibroma`/`vascular lesion` mimics.
  `test/sknx-melanoma-caveat.test.mjs` now 11/11.

**Residual (documented, not blocking):** DOAC + ticagrelor fires twice (`pair-doac-pgp` + `pair-anticoagulant-
antiplatelet`, since ticagrelor is both an antiplatelet and a P-gp inhibitor) - a true-positive redundancy;
collapsing it needs the engine-level drug-pair dedup already noted for the CR2 overlap case. Advisory: the
`"pigment"` substring also forces `rxEligible=false` + the melanoma caveat on two benign cloud labels
(post-inflammatory hyperpigmentation, pigmented purpuric eruption) - conservative (no Rx offered on a benign
pigmented read; Rx is flag-OFF regardless), not a safety issue.

M/L below remain open. The original findings are preserved below for the record.

## CRITICAL (engine-reproduced - now FIXED, see status above)

- **C1 - Warfarin + common antibiotics silently NOT flagged.** The only warfarin-antimicrobial rule keys
  on `cyp3a4_inhibitor`. Verified MISS: `warfarin + ciprofloxacin`, `+ metronidazole`, `+ co-trimoxazole`,
  `+ amiodarone`. Co-trimoxazole/metronidazole/fluoroquinolones are top warfarin potentiators (CYP2C9) -
  real-world INR 6-10, fatal bleeds. **Data bug:** `cotrimoxazole` (no hyphen) is mis-tagged
  `cyp3a4_inhibitor` so it FIRES, while the standard `co-trimoxazole` MISSES - same drug, opposite result
  on a hyphen. `interaction-rules.js:21422, 721, 726, 3863`. Fix: add a `cyp2c9_inhibitor` class + warfarin
  x fluoroquinolone/metronidazole/sulfonamide/amiodarone rules; reconcile the spelling variants.

- **C2 - Colchicine has ZERO interaction coverage.** Its only classes are `epc:*` (all stripped) -> named
  in no rule. Verified MISS: `colchicine + clarithromycin` (documented deaths - CYP3A4/P-gp block ->
  colchicine toxicity/pancytopenia), `colchicine + simvastatin`. `interaction-rules.js:16038`. Fix: give
  colchicine curated classes + a contraindicated rule vs strong CYP3A4/P-gp inhibitors.

- **C3 - Paracetamol + naloxone mis-tagged as opioid/CNS-depressant -> FALSE "coma and death" alerts.**
  `paracetamol + diazepam` (a safe, extremely common pairing) throws TWO major "respiratory depression,
  coma and death" alerts - identical to oxycodone + alprazolam. Naloxone (an opioid ANTAGONIST) is tagged
  as an opioid. This trains clinicians to dismiss the single most important respiratory-depression alert
  (opioid+benzo) -> alert fatigue on a life-saving alert. `interaction-rules.js:16684, 7729, 20662, 20886`.
  Fix: remove `opioid`/`cns_depressant` from paracetamol + naloxone.

## HIGH (well-known interactions, class-wiring fixes)

- **H1 - Azathioprine + febuxostat** not flagged (fatal myelosuppression) - the rule uses named generics
  `allopurinol+azathioprine` though its own text says "same applies to febuxostat." Use the
  `xanthine_oxidase_inhibitor` class. `interaction-rules.js:21134`.
- **H2 - Digoxin + clarithromycin/erythromycin** (P-gp; digoxin +70-100%) not flagged - only
  digoxin+amiodarone/verapamil exist. Add `digoxin x pgp_inhibitor`. `:21230,21254`.
- **H3 - Potassium-sparing diuretic + potassium supplement** (hyperkalemia) not flagged -
  `spironolactone + KCl`, `amiloride + K` both MISS.
- **H4 - Lithium + thiazide/loop diuretic** not flagged despite the rule text claiming it (subjects are
  `lithium + raas` only). `lithium + HCTZ` MISS (classic lithium-toxicity cause). `:21086`.
- **H5 - Anticoagulant + antiplatelet dual therapy** (major bleeding) not flagged - `warfarin+clopidogrel`,
  `apixaban+aspirin`, `dabigatran+clopidogrel` all MISS. Needs a general `anticoagulant x antiplatelet` rule.
- **H6 - DOAC + strong CYP3A4/P-gp inhibitor** (bleeding) not flagged - `apixaban+clarithromycin`,
  `rivaroxaban+ketoconazole`, `dabigatran+verapamil` all MISS.
- **H7 - SknX: a mis-classified melanoma can yield `rxEligible=true` / no referral.** The malignancy
  guardrail fires only when the classifier emits a malignant label, but the deployed 59-class model has no
  melanoma class - a nodular/amelanotic melanoma read as a benign nevus (not OOD, no ABCDE ticked) ->
  `referral=false, rxEligible=true`. `sknx-engines.js:114-152`. Mitigated (flag-OFF, access-gated, OOD gate,
  disclaimer). **Before any enablement:** a blanket point-of-decision "cannot exclude melanoma for any
  pigmented/changing lesion" caveat + force `rxEligible=false` for melanocytic/pigmented top-differentials.

## MEDIUM

## STATUS UPDATE (2026-08-05): M1-M3 + M5 FIXED (test-driven); M4 deferred to R2

The four DDI-ruleset MEDIUM items are remediated, test-first
(`test/interaction-medium-fixes.test.mjs` 19/19, golden regression unchanged, critical/high suites still
12/12 and 25/25, full unit suite no new failures). Fix summary (all in `interaction-rules.js`):
- **M1** - new `pair-amiodarone-statin` (amiodarone x `statin` class, major) with the FDA simvastatin-20mg /
  lovastatin-40mg dose caps and a steer to pravastatin/rosuvastatin/pitavastatin in the action text. (Did
  NOT add `cyp3a4_inhibitor` to amiodarone, which would have double-fired warfarin via the existing
  `pair-warfarin-macrolide-azole`.)
- **M2** - new victim rules: `pair-carbamazepine-cyp3a4` (x `cyp3a4_inhibitor`), `pair-phenytoin-cyp2c9`
  (x `cyp2c9_inhibitor`) + `pair-phenytoin-azole` (x `azole_antifungal`, so phenytoin+fluconazole fires
  WITHOUT re-tagging fluconazole and double-firing warfarin), `pair-theophylline-cyp1a2` (x `cyp1a2_inhibitor`).
- **M3** - removed the `benzodiazepine` mis-tag from clozapine (its opioid+benzo "coma and death" false alert
  is gone; the genuine additive-CNS alert survives via `cns_depressant`) and the `dihydropyridine_ccb`
  mis-tag from verapamil, adding `mech-cyp3a4strong-nondhp-ccb` so the genuine clarithromycin+verapamil
  interaction is preserved and clarithromycin+diltiazem (previously missed) now fires. (The lisinopril
  mis-tag from M3 was already fixed in H4.)
- **M5** - new `pair-corticosteroid-nsaid` (GI bleeding) and `pair-loop-aminoglycoside` (oto/nephrotoxicity).
  insulin+sulfonylurea was NOT actually a miss (it already fires `dup-hypoglycemic`); the auditor hit it by
  entering bare `insulin`, which was UNCLASSIFIED - now added to `drugClasses` as `["hypoglycemic","insulin"]`
  so bare `insulin` resolves. (No redundant insulin x sulfonylurea rule added, to avoid a double-fire.)

**M4 (AI general-knowledge path) - NOT auto-fixed; routed to R2 AI-safety review.** It is a different
subsystem (`functions/api/ai`), any AI/prompt/serving change is mandatorily R2-reviewed, and its substantive
half (cross-checking AI-suggested drugs through the DDI engine) is a NEW feature with its own failure modes
(drug-mention extraction can give false reassurance) - not a high-confidence one-line fix. The ungrounded-dose
half is already guarded (ground-check rule #8, dosing rule #3, education-not-individualised rule #4, persistent
UI advisory). Left open pending an R2-designed cross-check. **R1 re-review of M1-M3/M5: in flight.**

- **M1** Amiodarone + simvastatin (myopathy; FDA caps simva 20mg) not flagged - amiodarone lacks `cyp3a4_inhibitor`.
- **M2** NTI CYP victims not wired: `carbamazepine+clarithromycin`, `phenytoin+fluconazole`, `theophylline+ciprofloxacin` MISS.
- **M3** Misclassifications -> false positives (alert fatigue): `clozapine` tagged `benzodiazepine`;
  `lisinopril` tagged `thiazide_diuretic`; `verapamil/diltiazem` tagged `dihydropyridine_ccb`.
- **M4** AI general-knowledge path (`functions/api/ai/[[path]].js:384-401`) may emit an ungrounded dose from
  model training when KB retrieval is thin; AI-recommended drugs are NOT cross-checked back through the DDI
  engine. Strong guardrails exist (Intent Firewall, ground-check, disclaimer) - residual risk. Chain to AI reviewer.
- **M5** Additive-toxicity pairs MISS: `corticosteroid+NSAID`, `insulin+sulfonylurea`, `furosemide+gentamicin`.

## LOW / ADVISORY
- L1 `hasIngredientOverlap` can over-suppress two different combo products sharing one ingredient.
- L2 unrecognized `rule.severity` defaults to the low-visibility `monitor` bucket (silent downgrade risk).
- L3 `acetaminophen` (US spelling) absent from drugClasses -> zero coverage under that name; L4 warfarin+paracetamol, methotrexate+PPI not flagged.

## POSITIVE (verified clean)
- **Calculators/dosing: NO defects found.** CrCl Cockcroft-Gault + CKD-EPI 2021 correct; MME uses correct
  CDC factors + excludes methadone/fentanyl; insulin calculator has hypoglycemia/DKA/renal/stacking guards;
  insulin-safety/convert conservative; ICU BISAP BUN=urea/2.14 correct.
- FollowCare correctly routes side-effects to `notify_doctor`, never changes drugs, blocks a false "Green"
  on unanswered red-flags.

## Gate decision (from the clinical auditor) - UPDATED 2026-08-05
Original decision: **Block the DDI ruleset until C1-C3 are remediated** (missed warfarin-antibiotic +
colchicine interactions; the paracetamol/naloxone false-positive eroding the opioid+benzo alert), with H1-H6
class-wiring fixes shipped in the same pass and H7 (SknX melanoma) caveated before enablement.

**Now:** CR1-CR3 and H1-H7 are all remediated test-first (see the two STATUS UPDATE blocks above); the DDI
ruleset block is cleared pending the R1 re-review of the HIGH fixes. The remaining Medium/Low items are
alert-quality / coverage-breadth improvements, not tier-1 patient-safety gaps, and stay open as fast-follow.
