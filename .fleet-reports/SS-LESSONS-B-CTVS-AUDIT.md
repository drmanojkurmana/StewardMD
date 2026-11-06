# SS CTVS (ss-ctvs) Existing Lessons Audit (Lane B)

Audit per Step 1 (Stage 1) while `ss-ctvs` blueprint status is `todo`.
Current subject = queue line 15 (all lanes todo, subject open). Lane B does
no stage-2 lesson writing until lane A lands the blueprint.

## Scope
The existing CTVS lessons are the three below (taxonomy
`ss-ctvs` / section `ss-ctvs-g` on origin/main lists exactly these three
modules; no other lesson keys point at them).

- sct-coronary-valve (Coronary and valvular surgery)
- sct-aorta-congenital (Aortic and congenital cardiac surgery)
- sct-thoracic (Thoracic surgery)

## Gates on current main (all observed this run, origin/main 9664b1731)
- checkLesson (gate 0): `[]` for all three lessons, before and after this
  audit's image additions.
- Narration gate (`checkNarration` in tools/prep-lessons.mjs): 4 failing
  steps, all already logged in LESSONS-GARBLED.md lines 1047-1049 (same
  sentences observed this run): sct-coronary-valve step 6, sct-aorta-congenital
  steps 3 and 7, sct-thoracic step 4. No new GARBLED rows. No rewrites in this
  job per the brief; the stage-2 rewrite will replace this muse-wonder
  (local authoring) narration.
- `tools/prep-lessons.mjs --check` reports "unknown module" for sct-* keys:
  pre-existing tooling quirk (the modules ARE in prep/taxonomy.json under
  ss-ctvs-g). Left untouched; lane B owns the gate tools and this changes
  nothing about the lessons.

## Existing Figures Verification (IMAGE EXISTENCE RULE: curl + look)
All four R2 srcs return HTTP 200 and were viewed this run:

- v1/lessons/media/sct-coronary-valve-fig1.webp (36346 B): clean code-drawn
  mechanical-vs-biological valve diagram on the prosthesis step. Labels
  correct, no typos. KEEP.
- v1/lessons/media/sct-aorta-congenital-gen1.webp (68230 B): CT-style
  ascending dissection with true/false lumen and intimal flap labels on the
  scan step. Matches the step point. KEEP.
- v1/lessons/media/sct-aorta-congenital-fig1.webp (30528 B): normal heart vs
  tetralogy of Fallot diagram on the TOF step. Medically correct. KEEP
  (removal would need owner permission; none sought).
- v1/lessons/media/sct-thoracic-fig1.webp (30482 B): mediastinal compartments
  with sternotomy/VATS access on the mediastinum step. Correct except a
  label typo: 'Thym.oma'. KEPT per IMAGE TYPO RULE; repaint row added to
  SS-LESSONS-IMAGE-NEEDS.md ('Thym.oma' -> 'Thymoma').

No removals. No "[Alt:"/"[Credit:" fragments in any caption.

## Images added (KB-IMAGE-INDEX reuse, all cleared rows, R2 200 + viewed)
- sct-coronary-valve step 2 (grafts): v1/kb/media/sct-coronary-valve-cpb-mcs-fig1.webp
  (CABG mammary + vein grafts). Image steps 1 -> 3.
- sct-coronary-valve step 8 (support): v1/kb/media/cardiac-surgery-cabg-valvular-repair-and-cardiopulmonary-bypass-fig1.webp
  (CPB cannulation with grafts). Labels checked, no typos.
- sct-thoracic step 1 (lung): v1/kb/media/sct-thoracic-lung-trauma-fig1.webp
  (VATS lobectomy, thoracotomy, pleurodesis, EBUS, thymectomy). One label
  typo: 'Broncus'; kept + repaint row added ('Broncus' -> 'Bronchus').
  Image steps 1 -> 2.
- sct-aorta-congenital already has 2 image steps; the abdominal-EVAR KB row
  does not fit the descending/TEVAR step (abdominal vs thoracic), so no
  addition there; NEEDS row added for a descending-aorta TEVAR figure.

## Blind fact check
Image-only audit: no lesson text touched. Existing narration failures are
already flagged in LESSONS-GARBLED.md for the stage-2 rewrite; no new
clinical claims added (image alts/captions describe only what each figure
shows, verified by viewing). No checker needed; nothing to hold in FLAGS.
