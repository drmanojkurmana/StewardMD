# GAP-AUDIT-DONE — student-safety gap audit, first fill

Branch gap-audit-1013. Audit: .fleet-reports/GAP-AUDIT.md (2,435 taxonomy lines: 742 OK, 1,219 THIN, 474 MISSING before fill). No Claude API spend. No existing explanation rewritten. No coming-soon text added.

## Filled in this PR (60 new MCQs + 6 lessons, set gap1013a)

| Topic | Before | After | Source named in items |
|---|---|---|---|
| med-sepsis | 140 MCQs, no lesson | +10 MCQs, lesson added | Surviving Sepsis Campaign 2021 |
| med-allergy-immunology (anaphylaxis) | 83, no lesson | +10, lesson | Resuscitation Council UK; NICE NG183 |
| med-pesticides (organophosphate) | 24, no lesson | +10, lesson | WHO pesticide poisoning guidance |
| med-envenomation (snake bite) | 43, no lesson | +10, lesson | WHO South-East Asia snakebite guideline |
| ans-difficult-airway | 75, no lesson | +10, lesson | Difficult Airway Society |
| med-potassium (hyperkalaemia) | 207, no lesson | +10, lesson | UK Kidney Association |

Files: prep/overlays/gap1013a/{medicine,anaesthesia}/*.json and prep/lessons/v1/*.json. Items are hand-authored vignettes with reasoning explanations and Know-more lesson links (x.links.lesson_ids). Release still needs the standard publish steps (R2 overlay upload, overlay-counts refresh, prep-ids publish) under owner release control; this PR stages repo content only.

## Independent check (Step 3)

Second re-read of every number in the 60 items: one true dose (adult IM adrenaline 500 micrograms, 0.5 mL of 1 mg/mL — correct per Resuscitation Council UK), one bedside threshold (20-minute whole blood clotting test — correct per WHO), biphasic timing stated qualitatively (hours). All other items are deliberately number-free. Wrong-dose strings (5 mg IV, 50 micrograms oral) appear only as labelled distractors. Held list: empty. Caveat: no blind-key second-model check was run (brief forbids Claude API spend; author is the writer), so all 60 items should still get doctor sign-off before R2 release.

## Remaining gaps (ranked, for next PRs of ~300 items)

1. Life-critical lessons still missing (MCQs plentiful): ACLS/BLS, ATLS, DKA/HHS, status epilepticus, stroke, ACS, PE, pneumothorax, massive haemorrhage, eclampsia, PPH, ectopic, neonatal resuscitation, hyponatraemia, raised ICP, meningitis, malignant hyperthermia, LAST, paediatric dehydration, aortic dissection.
2. Drug safety lessons: insulin, oral antidiabetics, opioids, corticosteroids, antidotes, interactions (mphar-interactions only 24 MCQs).
3. Indian programmes: NTEP, NACO, NVBDCP lessons; Ayushman Bharat has no module.
4. MBBS lesson debt: medicine 100 THIN, pathology 53, surgery 45, pharmacology 40; dermatology weakest subject.
5. NEET-SS: 474 taxonomy topics are empty v1 shells; live SS bank location must be confirmed before any fill (do not duplicate).
6. Skills with no module home: clinical examination/OSCE steps, CBC/lab interpretation.

## Owner questions

1. NEET-SS: where does the live ~31k SS bank resolve, if not the v1 ss-* indexes (all report total 0)? Fill shells or repoint taxonomy?
2. Approve hand-authored items for doctor sign-off workflow (held queue) before R2 publish, as no API verification was spent?
3. Should examination/OSCE and lab-interpretation become new taxonomy modules, or lesson-only additions to existing modules?
