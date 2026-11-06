# SS CTVS (ss-ctvs) Existing Lessons Audit (Lane C)

Audit per Step 1 (Stage 1) while `ss-ctvs` blueprint status is `todo`.
Current subject = queue line 15 (all lanes todo, subject open). Lane C does
no stage-2 lesson writing until lane A lands the blueprint. Complements lane
B's audit (branch ss-lessons-B-ctvs-audit: coronary-valve steps 2+8,
thoracic step 1, TEVAR NEEDS row, Thym.oma/Broncus repaint rows). No step
touched by both lanes, so both sides merge cleanly except same-file context.

## Scope
Five existing lessons point at CTVS modules:

- sct-coronary-valve (Coronary and valvular surgery)
- sct-aorta-congenital (Aortic and congenital cardiac surgery)
- sct-thoracic (Thoracic surgery)
- sur-cardiac (CABG, valvular disease, CPB)
- sur-thoracic (thoracic oncology, lobectomy, VATS, empyema)

## Gates observed this run (origin/main 9664b1731)
- checkLesson (gate 0): `[]` for all five lessons before and after this
  audit's edits.
- Narration gate (`checkNarration`): only the already-logged
  verb-dictionary false positives on unchanged sentences
  (LESSONS-GARBLED.md lines 1047-1049, 1219, 1251): aorta steps 3+7,
  coronary step 6, thoracic step 4, sur-cardiac steps 2+3, sur-thoracic
  step 1. No new GARBLED rows. No rewrites in this job; stage 2 replaces
  the muse-wonder (local authoring) narration.
- `tools/prep-lessons.mjs --check` reports "unknown module" for sct-*
  keys (pre-existing tooling quirk, also noted by lane B). Left untouched.

## Existing figures verification (IMAGE EXISTENCE RULE: curl + look)
All five R2 srcs return HTTP 200 and were viewed this run. All KEPT:

- v1/lessons/media/sct-aorta-congenital-gen1.webp (68230 B): axial scan of
  ascending dissection, true/false lumen and intimal flap labelled, no PHI
  or markers. Fits step 2. KEEP.
- v1/lessons/media/sct-aorta-congenital-fig1.webp (30528 B): normal heart
  vs tetralogy of Fallot on the TOF step. Medically correct. KEEP.
- v1/lessons/media/sct-coronary-valve-fig1.webp (36346 B): mechanical vs
  biological valve comparison on the prosthesis step. Labels correct
  ("Durable / Warfarin life" vs "Limited durability / Avoids thinners").
  The aortic/mitral positions are illustrative, not prescriptive. KEEP.
- v1/lessons/media/sct-thoracic-fig1.webp (30482 B): mediastinal
  compartments with sternotomy/VATS access on the mediastinum step.
  Correct except 'Thym.oma' typo (lane B already filed the repaint row).
  KEPT per IMAGE TYPO RULE.
- v1/lessons/media/sur-cardiac-fig1.webp (92272 B): 3-panel CABG grafts,
  valve comparison (INR 2.5-3.5 shown on the mechanical valve) and CPB
  circuit. Correct. KEEP. One fix: the step-2 say asked for "the
  anticoagulation target and reversal agent shown", but protamine is not
  drawn; say now states only the INR target shown, caption says heparin
  dosing and protamine reversal are in the bypass text. Caption also
  gained the missing StewardMD credit.

## Images added (KB-IMAGE-INDEX reuse, all cleared StewardMD rows, R2 200 + viewed)
- sct-aorta-congenital step 1: v1/kb/media/aortic-dissection-fig1.webp
  (intimal tear, true/false lumens, Stanford A vs B). Image steps 2 -> 3.
- sct-aorta-congenital step 5: v1/kb/media/congenital-heart-disease-fig1.webp
  (secundum ASD, membranous VSD, RVOT obstruction, overriding aorta).
  Image steps 3 -> 4.
- sct-thoracic step 2: v1/kb/media/pneumothorax-fig2.webp (tension
  mechanism, needle/tube sites above the rib). Image steps 2 -> 3.
- sct-thoracic step 3: v1/kb/media/pleural-empyema-fig1.webp (loculations,
  split pleura sign, pH < 7.20 thresholds). Image steps 3 -> 4.
- sct-thoracic step 6: v1/kb/media/thoracic-trauma-tension-pneumothorax-and-tamponade-fig1.webp
  (tension physiology, flail segment, tamponade). Image steps 4 -> 5.
- sct-coronary-valve step 6: v1/kb/media/ie-fig2.webp (valve vegetations
  with septic emboli, Janeway/Osler/splinter/Roth panels). Image steps
  3 -> 4 (counts lane B's two additions).

No removals. No "[Alt:"/"[Credit:" fragments in any caption. Alt text
never quotes the truncated ie-fig2 footer labels.

## Blind check status
Writer is muse (muse-spark-1.3); agy and grok both fail at startup in this
sandbox (fresh probes this run). Logged as UNCHECKED (muse writer) in
SS-LESSONS-FLAGS.md; held for the blind pass before merge.

## Still imageless (NEEDS rows filed, lane C)
- sct-aorta-congenital steps 3 (root/arch repair), 7 (switch/Fontan)
- sct-coronary-valve steps 1 (Heart Team), 3 (technique), 4 (aortic valve),
  5 (mitral valve)
- sct-thoracic step 5 (oesophagectomy conduit)
- repaint: ie-fig2 truncated footer labels ('Pale White/Clear Ce',
  'Immune Complex Vasc')

(Lane B already filed: TEVAR figure, Thym.oma and Broncus repaints.)
