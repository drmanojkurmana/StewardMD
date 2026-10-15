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

# Wave 2 DONE (vascular + CTVS gap-fill, MBBS surgery depth)

**Date:** 2026-10-15/16 | **Branch:** `vasc-ctvs-lessons-1015` (worktree `/private/tmp/vascvs-wt`)
**Commit:** `848602803` Books-2 VASC2: 90 vascular-CTVS gap-fill MCQs across 9 surgery modules
**Generator:** `tools/generate-books2-vasc2.mjs` (vasc1 pattern: LP.checkLesson + kb_validate_v2 + family-wide stem check + dose regex + rotation + wiring)

## Gap check first (fill gaps only, no rewrites)
8 committed `sur-*` lessons verified LP.checkLesson PASS and left byte-untouched; only
`sgs-vascular-transplant` was lesson-less, so it got one FULL new v1 lesson (6 steps) plus
one NEW KB v2 page (graft surveillance + transplant workup, kept clear of `sur-transplant`
HLA/rejection/renal-technique and `sva-venous-access` fistula content).

## Delivered (9 modules, 90 MCQs bk2-vas-051..140)

| Module | Lesson | KB new-or-reused | Overlay | MCQ ids | Named sources |
|---|---|---|---|---|---|
| sur-arterial | existing, untouched | reused: peripheral_arterial_disease, buerger_disease, raynaud_phenomenon, thoracic_outlet_syndrome | prep/overlays/maikbook2/surgery/sur-arterial.json | bk2-vas-051..060 | ESVS ALI, AHA/ACC PAD, SVS/ESVS PAD |
| sur-aneurysm | existing, untouched | reused: abdominal_aortic_aneurysms_evar_and_carotid_endarterectomy, popliteal_artery_aneurysm, carotid_artery_stenosis | sur-aneurysm.json | bk2-vas-061..070 | SVS/ESVS AAA, ESVS peripheral/ruptured AAA, ACST + ESVS carotid |
| sur-venous | existing, untouched | reused: chronic_venous_insufficiency, chronic_venous_disease_ceap_and_endovenous_ablation, deep_venous_thrombosis_and_pulmonary, venous_leg_ulcer, diabetic_foot_ulcer | sur-venous.json | bk2-vas-071..080 | NICE NG13 varicose, NICE NG158 VTE, ESC PE, ACCP antithrombotic |
| sur-lymphatic | existing, untouched | reused: lymphedema, lymphedema_staging_lymphoscintigraphy_and_surgical_restoration, filariasis, primary_lymphoedema | sur-lymphatic.json | bk2-vas-081..090 | ISL lymphoedema consensus, NVBDCP filariasis (labelled), NICE breast |
| sur-thoracic | existing, untouched | reused: thoracic_oncology_lobectomy_and_pleural_empyema, empyema_thoracic, tension_pneumothorax, disorders_of_the_mediastinum, thymoma | sur-thoracic.json | bk2-vas-091..100 | ESTS/STS thoracic, NICE NG122 lung, BTS bronchiectasis/pneumothorax/pleural |
| sur-cardiac | existing, untouched | reused: cardiac_surgery_cabg_valvular_repair_and_cardiopulmonary_bypass, valvular_heart_disease_and_endocarditis | sur-cardiac.json | bk2-vas-101..110 | SYNTAX/EXCEL + ESC/EACTS revasc, STS conduit, ACC/AHA valvular/aortic |
| sur-chest-trauma | existing, untouched | reused: flail_chest, thoracic_trauma_tension_pneumothorax_and_tamponade, tension_pneumothorax | sur-chest-trauma.json | bk2-vas-111..120 | SVS/ESTS blunt aortic injury + ATLS, STS chest trauma/post-cardiotomy |
| sur-neck-face-trauma | existing, untouched | reused: neck_and_maxillofacial_trauma_zones_and_management, carotid_artery_stenosis | sur-neck-face-trauma.json | bk2-vas-121..130 | SVS/AAST vascular trauma + ATLS, SVS carotid/subclavian/vertebral |
| sgs-vascular-transplant | NEW prep/lessons/v1/sgs-vascular-transplant.json (6 steps) | NEW kb/reference/sgs_vascular_graft_surveillance_transplant_workup.json | sgs-vascular-transplant.json | bk2-vas-131..140 | ISHLT listing, THOTA/NOTTO (labelled), SVS/ESVS bypass surveillance, ESVS graft infection |

Counts: 90 new MCQs, ids bk2-vas-051..140 all present, 90/90 unique; answers wave-2
23/22/22/23, all-140 bk2-vas 36/34/34/36 (balanced). Wiring purely additive:
index.json +sgs entry, overlay-counts +9x10, accuracy lessons 1217->1218 steps
5718->5724, books-mcqs test total 4400->4490.

## Gates (re-verified read-only in worktree, 2026-10-15)
- LP.checkLesson 9/9 PASS (8 existing + 1 new); kb_validate_v2 ok on new KB + all 26
  distinct reused KB files.
- Similarity: 0 true cross-family stem hits vs 6245 family stems (all prep/overlays,
  wave-2 excluded); 0 in-wave dup stems. (Generator re-run XFAMILY lines for
  bk2-vas-138..140 are self-matches against committed wave-2 files, not real hits.)
- Dose regex clean (no mg/milligram/mcg); all 90 items carry `source`.
- Suites: prep-books-mcqs + prep-lessons + prep-subject 32/32; prep-accuracy 5/5;
  prep-crosslist + prep-ss-groups + prep-links-final + kb-tests 31/31.
- Git: 1 wave-2 commit `848602803` (note: on top of a7b5b3b7e, NOT directly on
  79a5dea3e which is 29 commits back; intermediate commits are others' work).
  Tree clean at commit; this report extension is the only working-tree edit.
- No push / merge / PR opened (per instructions).

## Lead next steps (not done here)
1. Squash-merge the PR after the browser job (plain squash, pipeline convention).
2. Run OTA publish, then `node tools/prep-ids.mjs publish --yes` (immutable overlay release).
3. Remove worktree `/private/tmp/vascvs-wt` to reclaim disk.
