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

---

Nothing else in the abdomen chapter currently needs an entry: `skill.exam.gi.auscultation`,
`skill.exam.gi.palpation`, `skill.exam.gi.gallbladder_kidney`, and `skill.exam.gi.ascites` have no
media attached yet at all (not even a placeholder) — flag before writing new teach content for
them, rather than defaulting to another self-authored SVG.
