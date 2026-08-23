# CliniX visual asset requests

Process (per owner instruction, 2026-08-23): for each lesson, first look for a real, legally
usable medical image/illustration/video/GIF (open licence, or an embeddable YouTube video verified
via oEmbed). If nothing suitable exists, do NOT fill the slot with a generic/AI/low-quality image —
log it here with a `CLX-Vnnn` id and keep building. When the owner supplies an asset for an id,
wire it into every skill/media entry that references that id.

Status key: `OPEN` (no asset yet, self-authored SVG placeholder in use where noted) · `FILLED`
(owner-supplied asset integrated).

---

## CLX-V001 — Liver palpation, preferred (bimanual) method
- **Clinical context:** `skill.exam.gi.liver`, CliniX abdomen module.
- **Must show:** examiner's two hands flat on the abdomen below the right costal margin, fingers
  pointing towards the ribs, palpating as the patient takes a deep breath — the edge meeting the
  fingertips on inspiration, hand staying still (not chasing the edge down).
- **Preferred format:** short looping video/GIF (5-10s) or a clean annotated photo/illustration
  sequence (2-3 frames: hands placed → breath in → edge contact).
- **Where it appears:** `media.dia.liverpalp`, first "show" turn of the liver-examination lesson.
- **Current placeholder:** self-authored inline SVG (`diagram.liverpalp` in clinix-diagrams.js) —
  functional but schematic, not a real demonstration. A real video already covers the FULL
  technique end to end (`media.vid.liverexam`, AMBOSS, oEmbed-verified) and plays as the closing
  turn; this id is for a tighter clip/image of the bimanual grip specifically, shown up front.
- **Status:** OPEN

## CLX-V002 — Spleen palpation, direction of enlargement
- **Clinical context:** `skill.exam.gi.spleen`.
- **Must show:** the diagonal line a spleen enlarges along, from the left costal margin towards
  the umbilicus and right iliac fossa — ideally overlaid on a torso outline or line diagram, not a
  live photo (this is an anatomical/conceptual point, not a technique to imitate).
- **Preferred format:** clean medical illustration (open licence) or a short animated diagram.
- **Where it appears:** `media.dia.spleenpalp`, first "show" turn of the spleen-examination lesson.
- **Current placeholder:** self-authored inline SVG (`diagram.spleenpalp`). A real technique video
  already covers the palpation + percussion methods end to end (`media.vid.spleenexam`, AMBOSS,
  oEmbed-verified).
- **Status:** OPEN

## CLX-V003 — Nine regions of the abdomen
- **Clinical context:** `skill.exam.gi.inspection`, used as the orientation map for the whole
  abdomen chapter.
- **Must show:** the standard 4-quadrant/9-region grid on a torso outline, labelled, ideally
  interactive (tap a region → see what organ lies beneath).
- **Preferred format:** open-licence anatomical illustration, redrawn/adapted to be tappable, or an
  SVG built from a licensed reference (with attribution) rather than fully original if a suitable
  reference exists.
- **Where it appears:** `media.dia.giregions`, first "show" turn of the inspection lesson.
- **Current placeholder:** self-authored inline SVG (`diagram.abdregions`), already interactive
  (tap-to-identify) — functional, but a professionally illustrated torso would read better than
  the current schematic rectangle grid.
- **Status:** OPEN

## CLX-V004 — Barrel chest, side-on comparison
- **Clinical context:** `skill.exam.resp.inspection`, CliniX respiratory module.
- **Must show:** a side-on (lateral) silhouette comparison of a normal chest versus a barrel
  chest (increased AP diameter, ~1:1 AP:transverse ratio) — a shape-recognition sign, learned from
  seeing real examples, not from a technique demonstration.
- **Preferred format:** open-licence clinical photo pair or a professional anatomical illustration
  comparison. Not a video — this is an appearance to recognise, not a manoeuvre to imitate.
- **Where it appears:** `media.dia.barrel`, inspection lesson.
- **Current placeholder:** self-authored inline SVG (`diagram.barrel` in clinix-diagrams.js) —
  schematic outline comparison, functional but a real photo pair would teach the actual visual
  recognition task far better.
- **Status:** OPEN

## CLX-V005 — Clubbing and the Schamroth window
- **Clinical context:** `skill.gen.clubbing`, CliniX respiratory module (general examination).
- **Must show:** a finger with clubbing (loss of the normal nail-fold angle, and the Schamroth
  window sign — the diamond-shaped gap that disappears when two opposing fingertips are pressed
  together, nail to nail) alongside a normal finger for comparison.
- **Preferred format:** open-licence clinical photo (a dermatology/clinical-signs atlas image, not
  a real patient photo sourced without clear licence) or a professional illustration.
- **Where it appears:** `media.dia.clubbing`, general examination chapter.
- **Current placeholder:** self-authored inline SVG (`diagram.clubbing`) — a real photo is
  materially better here since clubbing is a subtle visual sign students consistently misjudge
  from a line drawing.
- **Status:** OPEN

---

**Diagrams intentionally NOT flagged above** (self-authored SVG is the right call, not a
placeholder gap): `media.dia.flowvolume` (an abstract flow-volume graph — inherently a diagram,
not a photographable thing), `media.dia.airtrapping` (a mechanism cartoon of small-airway
collapse), `media.dia.effusionshift` (a mechanism diagram of mediastinal shift), `media.dia.breathing`
(a comparative rate/pattern graph). `media.dia.percussion` (zone map) and `media.dia.trachea`
(landmark map) are interactive maps, not technique demonstrations — real technique for both is
already covered by the full-exam video `media.vid.respexam`. `media.dia.percussiontech`,
`media.dia.expansion`, and `media.dia.hoover` are techniques already demonstrated in that same
end-to-end video; a dedicated clip would be a nice-to-have, not a gap, so not logged here.

Nothing in the abdomen chapter beyond CLX-V001–003 currently needs an entry: `skill.exam.gi.auscultation`,
`skill.exam.gi.palpation`, `skill.exam.gi.gallbladder_kidney`, and `skill.exam.gi.ascites` have no
media attached yet at all (not even a placeholder) — flag before writing new teach content for
them, rather than defaulting to another self-authored SVG.

## CLX-V006 — BP cuff placement and sizing
- **Clinical context:** `skill.exam.cvs.bp`, CliniX cardiovascular module.
- **Must show:** correct cuff bladder placement over the brachial artery, lower edge ~3cm above
  the elbow crease, plus the arm-circumference-to-cuff-size chart (small/regular/large/thigh).
- **Preferred format:** static diagram or infographic.
- **Where it appears:** blood-pressure-technique lesson.
- **Status:** OPEN

## CLX-V007 — Cardiac auscultation areas, labelled
- **Clinical context:** `skill.exam.cvs.heartsounds`.
- **Must show:** the 5 standard auscultation areas (mitral/tricuspid/aortic/pulmonary/Erb's) plus
  the extra listening points (axilla, epigastrium, carotids, back) on a chest outline.
- **Preferred format:** static labelled diagram. A real technique video already exists for this
  skill (`media.vid.auscultareas`, Medzcool, oEmbed-verified) — this id is for the site MAP, not
  the technique.
- **Where it appears:** heart-sounds lesson, alongside the auscultation-route teach block.
- **Status:** OPEN

## CLX-V008 — JVP waveform synced to the cardiac cycle
- **Clinical context:** `skill.exam.cvs.jvp`.
- **Must show:** the normal a/c/x/v/y waveform against S1/S2, plus abnormal patterns (absent a,
  giant a, cannon a waves, giant v waves) for comparison.
- **Preferred format:** static diagram, or a short looping animation if available.
- **Where it appears:** JVP lesson, waveform-interpretation teach block.
- **Status:** OPEN

## CLX-V009 — Six cardinal gaze positions
- **Clinical context:** `skill.exam.neuro.cn3_4_6` (oculomotor/trochlear/abducens).
- **Must show:** the H-pattern eye-movement test with the responsible muscle and cranial nerve
  labelled at each of the 6 positions (SR/IO/LR/MR/IR/SO).
- **Preferred format:** static diagram.
- **Where it appears:** eye-movement testing step of the CN III/IV/VI lesson.
- **Status:** OPEN

## CLX-V010 — Trigeminal sensory divisions and onion-skin pattern
- **Clinical context:** `skill.exam.neuro.cn5` (trigeminal).
- **Must show:** the three trigeminal divisions (V1/V2/V3) on a face outline, plus the concentric
  "onion-skin" (Dejerine) distribution seen in brainstem lesions.
- **Preferred format:** static diagram.
- **Where it appears:** trigeminal sensory-testing step.
- **Status:** OPEN

## CLX-V011 — Rinne's and Weber's tuning-fork technique
- **Clinical context:** `skill.exam.neuro.cn8` (vestibulocochlear).
- **Must show:** fork placement on the mastoid vs beside the ear (Rinne's), and on the vertex
  (Weber's).
- **Preferred format:** short demonstration video (30-90s).
- **Where it appears:** CN VIII bedside hearing-test step.
- **Status:** OPEN

## CLX-V012 — Dermatome map
- **Clinical context:** `skill.exam.neuro.sensory`.
- **Must show:** the standard anterior + posterior dermatome chart, for mapping pin-prick/touch
  findings to a spinal root level.
- **Preferred format:** static diagram, both views.
- **Where it appears:** sensory-exam lesson.
- **Status:** OPEN

## CLX-V013 — Named gait patterns, reference video
- **Clinical context:** `skill.exam.neuro.gait`.
- **Must show:** each named gait (hemiplegic, high-stepping, waddling, ataxic, parkinsonian, and
  the other patterns taught in the lesson) for a few seconds each, captioned.
- **Preferred format:** short video compilation.
- **Where it appears:** gait-examination lesson.
- **Status:** OPEN

---

Cardiovascular and Neurology just landed at full depth (11 and 15 skills respectively, up from 7
and 3), each with real oEmbed-verified demonstration videos wired in where a good one existed
(JVP, auscultation areas, parasternal heave/thrills, cranial nerve overview, cerebellar exam,
GCS, meningeal signs). CLX-V006–013 above are the gaps their authors found and declined to fill
with another self-authored placeholder.
