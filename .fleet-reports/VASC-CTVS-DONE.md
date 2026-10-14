# VASC-CTVS Wave 1 DONE (no-textbook vascular + CTVS, NEET-SS depth)

**Date:** 2026-10-14 | **Branch:** `vasc-ctvs-1014` (worktree `/private/tmp/vascvs-wt`, remove when done: disk)
**Base:** origin/main de18aa48f | **Spend:** $0.00 (no Anthropic API; local authoring)
**Generator:** `tools/generate-books2-vasc1.mjs` (DER2 pattern + ORT2 lesson writer)

## Gap check first (fill gaps only)
- Taxonomy vs index: exactly 5 lesson-less modules: `sva-arterial`, `sva-venous-access`
  (ss-vascular-surgery), `sct-coronary-valve`, `sct-aorta-congenital`, `sct-thoracic`
  (ss-ctvs). All other candidates already covered: MBBS `sur-arterial/aneurysm/venous/
  lymphatic/thoracic/cardiac/chest-trauma` lessons indexed; paediatric cardiac
  (`ped-congenital-heart`, `ped-acquired-heart`, `pcd-congenital`) already carries
  maikbook2 items, so no paediatric-cardiac wave was written.
- Live bank: maikss sets for ss-vascular-surgery / ss-ctvs already live (untouched).

## Delivered (1 PR-sized wave, 5 modules)
| Module | Lesson | KB page | MCQs |
|---|---|---|---|
| sva-arterial: CLTI/claudication, ALI, AAA, carotid, mesenteric, Buerger/Raynaud/TOS | prep/lessons/v1/sva-arterial.json (6 steps) | kb/reference/sva_arterial_clti_ali_carotid_mesenteric.json | bk2-vas-001..010 |
| sva-venous-access: varicose/CVD, DVT/PE, diabetic foot, trauma, access, lymphoedema | sva-venous-access.json (6 steps) | sva_venous_varicose_access_lymphoedema.json | bk2-vas-011..020 |
| sct-coronary-valve: CABG, AS/AR/MS/MR, endocarditis, prosthesis/anticoag, CPB/MCS/transplant/ICU | sct-coronary-valve.json (8 steps) | sct_coronary_valve_cpb_mcs.json | bk2-vas-021..030 |
| sct-aorta-congenital: dissection, ASD/VSD/PDA, TOF, TGA, Fontan | sct-aorta-congenital.json (6 steps) | sct_aorta_dissection_congenital.json | bk2-vas-031..040 |
| sct-thoracic: lung surgery, pneumothorax, empyema, mediastinum, oesophagus link, chest trauma | sct-thoracic.json (6 steps) | sct_thoracic_lung_trauma.json | bk2-vas-041..050 |
- Overlays: `prep/overlays/maikbook2/surgery/` (+5 files; maikbook2 4350 -> 4400).
  Surgery already in the books-mcqs test loop; prep.js untouched per PLAS1/URO1 precedent.
- Index 1466 -> 1471 modules; `prep/accuracy.json` regenerated via script (never hand-bumped).

## Sources used (no textbook; every MCQ carries a `source` field)
SVS/Global Vascular Guidelines (CLTI), ESVS AAA/carotid/mesenteric/venous guidance,
AHA/ACC PAD/valvular/aortic/ACHD guidance, ESC/EACTS revascularisation/valvular/aortic/
endocarditis/thymic guidance, STS/EACTS congenital practice, STS bypass/empyema practice,
ESTS mediastinal practice, NICE NG13 varicose + NG122 lung, BTS pneumothorax/pleural,
ACCP antithrombotic, KDOQI access, IWGDF diabetic foot, ISL lymphoedema, ATLS, ISHLT
transplant, Indian practice labelled (beating-heart CABG, rheumatic valves, NVBDCP
filariasis). Trials named correctly: BEST-CLI, BASIL-2, EVAR-1, NASCET, ACST, CREST,
CaVenT, ATTRACT, MIST, SYNTAX, FREEDOM, ART, ROOBY, CORONARY, PARTNER, COAPT, CROSS,
FLOT, JCOG0802, CALGB 140503. Zero milligram regimens; thresholds only where a named
guideline backs them (ABPI 0.9, AAA 5.5 cm men, NASCET 70% + fortnight CEA, WIfI,
Rutherford, INR bands); warfarin/antifilarial/antibiotic mentions are class-only.

## Gates (all in-generator + repo suites)
- LP.checkLesson 5/5; KB schema required-fields 5/5; quiz/overlay/lesson-quiz match 5/5.
- Blind cross-family: 0 stem hits vs all prep/overlays families AND 276 prep/bank files.
- Dose regex clean; ASCII clean; answers 13/12/12/13; 50/50 items carry `source`.
- Suites: books-mcqs/lessons/subject/accuracy 36/36; medcov/lessons-100/kb 23/23;
  prep-app 33/33 (no pre-existing failure on this base).
- No UI files touched (content pipeline only: lessons/KB/overlays); no UI skill read needed.
- No PDFs deleted (none were used); no orphan overwrites (all 5 files were new).

## Lead next steps (not done here)
1. Squash-merge the PR after the browser job (plain squash, pipeline convention).
2. Run OTA publish, then `node tools/prep-ids.mjs publish --yes` (immutable overlay release).
3. Remove worktree `/private/tmp/vascvs-wt` to reclaim disk.
