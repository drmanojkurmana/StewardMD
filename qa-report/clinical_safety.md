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

H1-H7 + M/L below remain open. The original findings are preserved below for the record.

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

## Gate decision (from the clinical auditor)
**Block the DDI ruleset until C1-C3 are remediated** (missed warfarin-antibiotic + colchicine interactions;
the paracetamol/naloxone false-positive eroding the opioid+benzo alert). H1-H6 are class-wiring fixes on
well-known interactions - ship in the same pass. H7 (SknX melanoma) is flag-OFF but needs the pigmented-
lesion caveat before enablement. **These are the single highest-priority items in the whole QA pass** -
they are direct patient-safety gaps, and per your instruction NONE were auto-modified.
