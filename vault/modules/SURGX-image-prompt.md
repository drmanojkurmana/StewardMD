---
tags: [surgx, media, prompt, gemini]
---
# SURGX step pictures: the Gemini prompt (template + lessons)

Used for appendicectomy on 2026-11-20 (19 images, see [[SURGX]] "Step pictures"). The owner wants every future
prompt to be **perfect and detailed first time**. Build it from this template, filling every `<...>` from the
procedure's own JSON (`surgx/procedures/<id>.json` + the step packs), never from memory.

## How to fill it
1. Resolve the procedure's `steps[]` refs against `surgx/steps/*.json` + `steps_local`. Use the REAL step ids and
   titles (the first timestamp prompt invented ids such as `step.core.who-checklist`; the real one is
   `step.core.timeout`).
2. For each step write: filename `NN_<slug>.png`, the SCENE (who, what, which instrument, which port, viewpoint), the
   single TEACH point (from the step's `emphasis` or first `how` line), and a per-image CHECK line.
3. State every geometric fact as a measurable instruction (angles, sides, counts). Gemini ignores vague words such as
   "steep head-down" and "tilt".
4. Spell out every object that must NOT carry text (boards, labels, screens, forms, wristbands).

## Lessons from round 1 (each cost a regeneration)
| Image | What Gemini did | Write this instead |
|---|---|---|
| Positioning | Table flat, arms out | "Table tilted head end DOWN by 20 degrees AND rolled so the patient's LEFT side is lower. BOTH arms tucked at the sides, not on arm boards. Show the tilt clearly from the side." |
| Endoloop | Tied as a bow, later a knot with long tails | "An endoloop is a PRE-TIED sliding (Roeder) knot cinched down by a plastic knot pusher; after cinching the tail is cut short. Never a bow, never a reef knot, never long loose ends." |
| Count board | Handwritten scribbles | "The count board is a BLANK whiteboard with an empty grid. No marks, ticks or numbers." |
| Specimen label | Pseudo-text | "The label is a BLANK white rectangle." |
| Screens | Faux UI text | "Any screen shows only abstract grey bars and blocks." |

General rules that held: one teaching point per image; laparoscopic round-vignette view for inside steps; 3D cutaway
for wall layers; theatre view for team steps; key structure sharp with background softened; no text anywhere.
Laterality: say "the patient's RIGHT iliac fossa" AND where that is in the frame ("on the viewer's left when the
camera looks from the patient's feet").

## The template (paste into Gemini, fill the <...>)
```
ROLE
You are a senior medical illustrator and a <specialty> surgeon working together. You are making
<N> teaching images for a surgical training app used by doctors and surgical trainees.
Topic: <PROCEDURE, approach>. One image per step, <N> images in total.
Goal: a trainee who looks at each image for 3 seconds understands exactly what is being done in that
step and why. Correctness and clarity come before beauty; the quality must be the best you can produce.

PHASE 1: UNDERSTAND THE OPERATION FIRST (before generating any image)
1. Research the operation in depth: surgical textbooks and operative atlases, <the governing guideline>,
   and operative videos of <procedure>. Study:
   - anatomy: <list every structure the steps mention>
   - instruments: <list every instrument, port size and device the steps mention>
   - how the real <laparoscopic camera / open field / endoscopic> view looks
2. Write back a short plan: for each step, 1 to 2 lines on what the image shows, the viewpoint and the
   single teaching point. Then continue to Phase 2 without waiting for me.
3. References are ONLY for accuracy. Never copy, trace or reproduce a frame or image from any video or
   website. Every image must be newly generated.

PHASE 2: GENERATE THE IMAGES
- Use your IMAGE GENERATION MODEL (Nano Banana / Gemini image generation) for every image.
- NEVER draw with code (no SVG, HTML, canvas, Python, matplotlib, Three.js). Code is allowed ONLY at the
  end, to put the finished images in a zip.
- If you cannot make all of them in one reply, work in batches and keep the style identical.

HOW EVERY IMAGE MUST TEACH
- ONE teaching point per image; the action of the step is the clear centre.
- Viewpoint: <camera view> for steps inside the body, a clean 3D cutaway where the trainee must see through
  the wall, a theatre view for team and safety steps.
- The critical structure is where the eye lands first: sharp and well lit, background slightly softened or
  desaturated; a subtle glow or outline on it is fine. A small circular close-up inset is allowed when the
  key detail is tiny.
- Instruments accurate in size and position, entering from the correct port or incision.
- Anatomy and laterality correct and consistent: <state the side of the pathology, where the working ports
  are, and where that sits in the frame>. Laterality never flips between images.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal and realistic.

PRECISE FACTS (draw exactly this, Gemini got these wrong before)
- Positioning: <exact table angle in degrees, which side is lower, arm positions, padding, strap>.
- Ligatures and loops: <exact knot type; e.g. an endoloop is a pre-tied sliding Roeder knot cinched by a
  plastic knot pusher, tail cut short; never a bow, never long loose ends>.
- <any other step-specific fact the first draft is likely to get wrong>

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK grids. Specimen and drug labels are BLANK white rectangles. Consent forms show only
  grey lines. Screens show only abstract grey bars. Wristbands are plain.

STYLE (identical across all images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern surgical atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs; neutral clean background.
- The same adult patient, team and instrument set in every image. Staff in caps and masks, generic faces,
  no real or identifiable person. Patient covered and dignified; only the operative field exposed.
- Landscape 4:3, at least 1600 x 1200 px, PNG.

THE STEPS  (filename : scene : teaching point : check)
<NN_slug.png>
   Scene: <who, what, which instrument through which port, viewpoint, what is highlighted>.
   Teach: <one line>.
   Check: <the one thing this image must get right>.
<... one block per step ...>

QUALITY CHECK (for EVERY image before moving to the next)
- Laterality correct (<restate>)?
- Anatomy, instrument, port and position correct for this step?
- Every PRECISE FACT above that applies to this image drawn exactly?
- Teaching point is the first thing the eye lands on?
- Zero text, numbers, labels, logos or watermarks, including boards, labels and screens?
- Same style, patient and team as the earlier images?
If any answer is no, regenerate that image before continuing.

DELIVERY
Put all <N> PNG images, named exactly as above, into ONE zip file: surgx-<procedure-id>-steps.zip
Include credits.txt listing, for each image: filename, one-line description, reference sources studied
(titles and links). Then give me the zip as a download.
```

## The timestamp prompt (for step video clips)
Same discipline: list the REAL step ids from the JSON, ask for `start`/`end` in whole seconds verified by watching,
`null` when a step is not shown, one `best` per step, and `concerns`. A video Gemini could not watch comes back
`"watched": false` (an audio podcast did); drop it. The shim plays `start`/`end` (`_site/yt.html`).

## Getting the result back
A Gemini share link (`share.gemini.google/...`) renders client-side: open it in headless Chromium (Playwright), click
the "Download <name>" button, and save the zip. Plain fetch and WebFetch only see the page shell.
