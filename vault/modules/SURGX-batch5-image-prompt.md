---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 5: Gemini image prompt (92 images, 5 neurosurgery operations)

Built 2026-11-21 from the real steps in `surgx/procedures/<id>.json`, the batch 4 prompt ([[SURGX-batch4-image-prompt]])
and every fault Gemini made in batches 2 to 4 (a limb along the side instead of out at 90 degrees, a table bent instead
of tilted, the wrong side of the body, a patient on the back in a lateral case, a bare pelvis in a wound, a hand
detached from the arm). The operations are burr-hole-csdh (16), trauma-craniotomy-edh (20), evd-insertion (17),
vp-shunt-insertion (22) and lumbar-discectomy-ces (17). Paste everything inside the block into ONE NEW Gemini chat.
The block format matches batch 4, so the batch 4 wiring script parses it unchanged.

```
ROLE
You are a senior medical illustrator working with three consultant neurosurgeons (cranial trauma, hydrocephalus and
spine). You are making 92 teaching images for a surgical training app used by doctors and surgical trainees. One image
per step:
  A. Burr hole evacuation of chronic subdural haematoma (RIGHT side)      16 images
  B. Trauma craniotomy for extradural haematoma (RIGHT temporal)          20 images
  C. External ventricular drain at Kocher point (RIGHT frontal)           17 images
  D. Ventriculoperitoneal shunt (RIGHT parieto-occipital to abdomen)      22 images
  E. Lumbar discectomy for cauda equina syndrome (L4-L5, prone)           17 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from neurosurgical textbooks and operative atlases, the guidance named below and
   operative videos. For each operation study:
   A. Chronic subdural haematoma. Guidance: SBNS/BNTRC (British Neurosurgical Trainee Research Collaborative), the
      Santarius drain trial (a drain halves recurrence), Dex-CSDH (no dexamethasone), NICE head injury NG232.
      Anatomy: scalp layers (skin, dense connective tissue, galea, loose areolar tissue, pericranium), outer and inner
      tables of the skull with diploe between, dura, the outer (dural-side) and inner membranes of the haematoma,
      arachnoid, brain surface, bridging veins, superior sagittal sinus in the midline, coronal suture.
      Instruments: scalpel, small self-retaining retractor (West or Weitlaner), periosteal elevator, cranial
      perforator (drill with a self-stopping clutch) and burr, bone wax, bipolar diathermy, dural hook, number 11 blade,
      soft irrigation catheter (Jaques), syringes of warmed saline, kidney dish, soft silicone subdural drain, closed
      drainage bag.
   B. Extradural haematoma. Guidance: Brain Trauma Foundation surgical guidelines (evacuate an EDH over 30 mL
      regardless of GCS), NICE NG232, ATLS, RESCUEicp and RESCUE-ASDH (decompressive craniectomy). Anatomy: temporal
      squama (thin bone), pterion, middle meningeal artery running on the outer surface of the dura from the foramen
      spinosum, the lens-shaped clot BETWEEN bone and dura, superficial temporal artery in front of the tragus,
      frontal branch of the facial nerve, temporalis muscle, middle cranial fossa floor, superior sagittal sinus.
      Instruments: Raney scalp clips (plastic, on the scalp edges), fish-hook or spring scalp retractors, perforator,
      craniotome with a footplate, Penfield dissector, Kerrison and Leksell rongeurs, suction, bipolar diathermy,
      haemostatic agent and bone wax, dural hitch sutures, titanium cranial plates and screws, dural substitute.
   C. External ventricular drain. Guidance: Neurocritical Care Society EVD guideline (Fried 2016), BTF, local EVD
      care bundles. Anatomy: nasion, coronal suture, mid-pupillary line, Kocher point (about 11 cm behind the nasion,
      about 3 cm from the midline, about 1 cm in front of the coronal suture), the frontal horn of the lateral
      ventricle, foramen of Monro, medial canthus and external auditory meatus as the aiming points.
      Instruments: hand twist drill with a depth stop (or a perforator), ventricular catheter with a stylet,
      subcutaneous tunnelling trocar, closed EVD system with a graduated column on a pole, drip chamber and collection
      bag, a laser level (or spirit level) to set the zero at the tragus, transparent dressing.
   D. Ventriculoperitoneal shunt. Guidance: BASICS trial (antibiotic- or silver-impregnated catheters), the
      Hydrocephalus Clinical Research Network shunt infection protocol (no-touch, glove change, limited theatre
      traffic), NICE/SBNS hydrocephalus guidance. Anatomy: Keen point for a parieto-occipital catheter (about 3 cm
      above and 3 cm behind the top of the pinna), frontal horn of the lateral ventricle, choroid plexus, scalp
      galea, the subcutaneous plane behind the ear, over the clavicle and down the chest wall, anterior rectus sheath,
      rectus muscle, posterior sheath, peritoneum, omentum, bowel. Instruments: ventricular catheter with stylet and
      a right-angle guide, a valve (programmable or fixed pressure) with a direction-of-flow arrow shape moulded on
      it, distal peritoneal catheter, long malleable tunneller, non-absorbable ligatures, valve programmer, optical
      neuronavigation camera with a reflective-sphere reference frame and pointer, iodine-impregnated adhesive drape.
   E. Lumbar discectomy for cauda equina syndrome. Guidance: GIRFT/SBNS/BASS national CES pathway (2023), NICE.
      Anatomy: spinous processes, laminae, facet joints, interlaminar window, ligamentum flavum (genuinely yellow),
      epidural fat and veins, thecal sac (dura) containing the cauda equina, traversing L5 nerve root, the L4-L5 disc
      with its annulus, the aorta and iliac vessels IN FRONT of the disc. Instruments: Wilson frame or Jackson table,
      C-arm image intensifier, spinal needle as a level marker, self-retaining spinal retractor (Caspar or
      McCulloch), operating microscope or loupes, Kerrison rongeurs, nerve root retractor, number 15 blade,
      pituitary rongeurs, ball-tipped probe, bipolar diathermy, cottonoid patties with strings, 6-0 dural suture,
      dural sealant patch.
2. Write back a short plan: for each step, 1 to 2 lines on what the image shows, the viewpoint and the single
   teaching point. Then go on to Phase 2 without waiting for me.
3. References are ONLY for accuracy. Never copy, trace or reproduce a frame or image from any video or website.
   Every image must be newly generated.

PHASE 2: GENERATE THE IMAGES
- Use your IMAGE GENERATION MODEL (Nano Banana / Gemini image generation) for every image.
- NEVER draw with code (no SVG, HTML, canvas, Python, matplotlib, Three.js). Code is allowed ONLY at the very end,
  to put the finished images into zip files.
- Work operation by operation (A, B, C, D, E). If you cannot make all of them in one reply, work in batches and keep
  the style identical. Do not skip any image.

HOW EVERY IMAGE MUST TEACH
- ONE teaching point per image. The action of the step is the clear centre of the picture.
- Viewpoint: the surgeon's eye view of the open field for operative steps; a clean 3D cutaway when the trainee must
  see through a layer (scalp, skull tables, dura, brain to the ventricle, the disc space); a whole-body view for every
  positioning step, drawn from the angle given in PRECISE FACTS; a theatre view for team and safety steps. Steps E09
  to E11 alone are microscope views with a soft round vignette.
- The key structure is where the eye lands first: sharp and well lit, the background slightly softened or
  desaturated. A subtle glow or outline on the key structure is fine. A small circular close-up inset is allowed
  when the key detail is tiny.
- Instruments correct in size and position, entering through the correct incision.
- Orientation and laterality correct and never flipped between images of the same operation:
  A and B. RIGHT side of the head. The patient lies supine with the head turned to the LEFT, so the right side of the
     head is uppermost. Field views look straight down on the right side of the head like a right-side profile: the
     VERTEX towards the TOP of the frame, the FACE and forehead towards the viewer's RIGHT, the back of the head
     towards the viewer's LEFT, the right ear in the lower middle of the frame.
  C. RIGHT frontal. Patient supine, head straight, nose to the ceiling. Field views look down on the top of the head
     from just above the forehead: the NOSE and eyebrows at the BOTTOM of the frame, the vertex towards the TOP, the
     patient's RIGHT on the viewer's LEFT. The entry point is therefore on the viewer's LEFT of the midline.
  D. RIGHT side. Head turned to the LEFT as in A and B. Cranial field views follow the A and B rule (vertex TOP, face
     viewer's RIGHT). Abdominal field views: the patient's HEAD at the TOP of the frame, the patient's RIGHT on the
     viewer's LEFT. Whole-length views (D05, D13): seen from the patient's RIGHT side, the head at the viewer's LEFT,
     the feet at the viewer's RIGHT.
  E. Patient PRONE. Field views look straight down on the lower back: the patient's HEAD at the TOP of the frame, the
     midline running top to bottom, the patient's LEFT on the viewer's LEFT.
- CT and MRI on screens are shown in radiological convention: the patient's RIGHT is on the viewer's LEFT of the scan.
  So a RIGHT-sided haematoma appears on the LEFT half of the CT picture.
- BODIES MUST BE WHOLE AND CONNECTED. Every hand belongs to an arm that runs to a shoulder of a visible body; every
  patient limb is continuous with the patient. Never draw a hand or arm floating near the head or on the wrong side.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal and realistic. Bone is ivory with pink diploe between the tables; dura is
  grey-white and slightly translucent; brain surface is pale pink with fine vessels; muscle is red-brown; fat is yellow
  ONLY where real fat is (subcutaneous fat, epidural fat, omentum); the ligamentum flavum is pale yellow.
- The scalp is shaved only along the planned incision (a neat strip); the rest of the hair is present and tucked
  under the drape. Patients are covered and dignified; only the operative field is exposed.

PRECISE FACTS (draw exactly this; Gemini got similar facts wrong before)
Positioning (show angles visibly by the drawing; a NEW whole-body view at table height for each operation; never reuse
a generic theatre scene):
- A. Supine, the head on a padded horseshoe (or ring) headrest, turned about 45 to 60 degrees to the LEFT so the right
  frontal and parietal area is uppermost, a small roll under the RIGHT shoulder, the head end of the table raised so
  the head is above the heart, the neck NOT kinked (two fingers' breadth between chin and chest). Drawn as a
  three-quarter view from the patient's RIGHT side and slightly above, so the head turn and the shoulder roll are both
  obvious. Elderly patient.
- B. Supine, a roll under the RIGHT shoulder, the head turned to the LEFT on a horseshoe headrest so the right temple
  is uppermost and horizontal, the head end raised 15 to 30 degrees, the jugular veins free (no tight rotation or
  flexion), endotracheal tube and ventilator. Same three-quarter view as A. Young adult.
- C. Supine, the head STRAIGHT with the nose pointing at the ceiling (not turned), on a ring, the head of the table
  raised about 30 degrees, intubated. Pure side view at table height from the patient's RIGHT, so the straight head
  and the 30 degree back rest are obvious.
- D. Supine on a horseshoe headrest, the head turned to the LEFT, a roll under the RIGHT shoulder, the neck gently
  extended so a STRAIGHT line runs from behind the right ear down the side of the neck, over the clavicle and down the
  chest to the right upper abdomen (shown as a faint dotted line on the skin); two fingers' breadth between chin and
  chest. Drawn from the patient's RIGHT side and slightly above.
- E. PRONE on a Wilson frame (or Jackson table with bolsters under the chest and both iliac crests) so the ABDOMEN
  HANGS FREE with a clear gap under it; the face in a padded foam prone headrest with the eyes and nose free of
  pressure; both arms forward on padded arm boards with the shoulders and elbows each bent NO MORE than 90 degrees;
  knees and shins padded, the hips and knees slightly flexed. Pure side view at table height from the patient's LEFT,
  so the free abdomen is the first thing the eye sees.
Step-specific facts:
- A. Chronic subdural on CT: a CRESCENT-shaped DARK GREY (low density) collection along the whole right hemisphere,
  the brain pushed towards the left, displayed on the LEFT half of the CT picture. Two burr holes over the
  collection: frontal (behind the hairline, in the mid-pupillary line, in front of the coronal suture) and parietal
  (over the parietal eminence, above and behind the ear), both well away from the midline. The perforator is held
  PERPENDICULAR to the skull and stops at the inner table by itself; the dura beneath stays intact. When the dura and
  the outer membrane are opened, dark brown "motor oil" fluid escapes under pressure. The irrigation catheter slides
  ALONG the inner surface of the dura (tangential), never pointing into the brain. A soft subdural drain is
  tunnelled out through a SEPARATE stab incision and the bag hangs BELOW the level of the head.
- B. Extradural on CT: a LENS-shaped (biconvex) BRIGHT WHITE (high density) clot against the right temporal bone,
  on the LEFT half of the CT picture, with midline shift. The RIGHT pupil larger than the left. Reverse question-mark
  (trauma) incision: starts at the zygomatic arch about 1 cm IN FRONT of the tragus, rises in front of the ear, curves
  backwards above the ear over the parietal area, then forwards about 2 cm from the midline to end at the hairline of
  the forehead. Raney clips on both scalp edges. The clot is dark red and jelly-like, lying BETWEEN the bone and the
  white dura; the torn branch of the middle meningeal artery runs on the outer surface of the dura and is coagulated
  with bipolar forceps. Dural hitch sutures run from the dura up to small holes at the bone edge. A decompressive
  craniectomy is LARGE: frontotemporoparietal, at least 12 cm front to back (much larger than a palm), reaching down to
  the floor of the middle cranial fossa, with the dura opened widely and a LOOSE patch. A replaced flap is fixed with
  small titanium plates and screws.
- C. Kocher point on the RIGHT: about 11 cm behind the nasion, about 3 cm from the midline (the mid-pupillary line),
  about 1 cm in front of the coronal suture. The drill and the catheter are held PERPENDICULAR to the skull. The
  catheter aims at the right medial canthus (seen from the front) and at the right external auditory meatus (seen from
  the side). Its tip lies in the frontal horn of the RIGHT lateral ventricle, just in front of the foramen of Monro,
  usually 5 to 7 cm deep. The EVD column zero is set level with the TRAGUS with a laser level. The catheter leaves the
  scalp through a separate stab several centimetres from the incision.
- D. The burr hole at Keen point on the RIGHT (about 3 cm above and 3 cm behind the top of the pinna) under a curved
  scalp flap, so neither the burr hole nor the valve lies under the suture line. The catheter tip in the frontal horn
  of the RIGHT lateral ventricle, in front of the choroid plexus. The valve sits on the skull behind the ear, anchored
  to the pericranium, its moulded arrow pointing DOWN the body (towards the abdomen). The tunneller runs in the
  subcutaneous fat behind the ear, down the neck, OVER the clavicle (superficial to it) and down the chest. The small
  abdominal incision is in the right upper quadrant beside the umbilicus; the peritoneum is held up between two clips
  and opened under direct vision; the catheter lies free inside the peritoneal cavity among the bowel loops, with
  ample length.
- E. Level: lateral C-arm image with a spinal needle pointing at the L4-L5 disc, counted up from the sacrum. Exposure:
  midline incision, muscles stripped off the laminae, the facet joints preserved, the lower edge of the L4 lamina and
  the yellow ligamentum flavum removed with a Kerrison rongeur. Discectomy: the thecal sac and the traversing L5 root
  retracted GENTLY towards the midline, the annulus cut with a blade, a white disc fragment removed with a pituitary
  rongeur kept at a controlled depth (never through the front of the disc, where the aorta and iliac vessels lie).
  After decompression the thecal sac is slack and pulsates.
Monitors and screens: CT, MRI and X-ray pictures may be shown on screens as images only, with no text, numbers or
annotations on them. The navigation screen shows only grey brain pictures. Anaesthetic monitors show only abstract
waves and grey bars.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Specimen pots, drug syringes, implant boxes, shunt packs, CSF
  tubes and drain bags carry BLANK white rectangles. Consent forms, checklists, notes and observation charts show only
  grey lines. The EVD column has plain tick marks with NO numbers. Wristbands are plain. Angles and distances are
  NEVER written; show them by the drawing itself.

STYLE (identical across all 92 images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern neurosurgical atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs; neutral clean background. Intensive care or ward scenes where the step
  says so.
- Within each operation the same adult patient, the same team and the same instrument set in every image. Staff in
  caps and masks, generic faces, no real or identifiable person. Patients covered and dignified.
- Landscape 4:3, exactly 1600 x 1200 px, PNG.

THE STEPS  (filename [step id] : scene : teaching point : check)

COMMON SAFETY STEPS (draw them for each operation with that operation's patient, team and setting)
- consent-check: pre-op bay, the patient (or, if unconscious, a relative beside the trolley), the surgeon marking the
  site with an arrow on the RIGHT side of the head (or the lower back for E) while going through a consent form with
  grey lines. Teach: confirm identity, operation and side with the patient or record the best-interests decision.
  Check: arrow on the correct side; form has no text.
- team-time-out: theatre, patient on the table, whole team paused and facing each other, surgeon speaking, nobody
  holding an instrument, the scan up on the wall screen. Teach: everyone stops and confirms before the first cut.
- prophylaxis: the patient's arm runs from the shoulder onto an arm board beside the CHEST; the anaesthetist connects
  a syringe (blank label) to the cannula PORT (needle-free, no needle into the skin); compression sleeves on both legs.
  Teach: antibiotic before incision plus mechanical VTE prophylaxis. Check: arm attached.
- prep-drape: the shaved strip and the field painted with antiseptic from the incision outwards, widely, then drapes
  leaving only the field. Teach: prepare widely, let it dry before drapes and diathermy.
- haemostasis: the field dry, bone edges sealed with bone wax, bipolar forceps in view, a moist cottonoid patty.
  Teach: inspect systematically before closing.
- counts: scrub practitioner and circulating nurse counting together beside a BLANK count board, including the small
  cottonoid patties with their strings. Teach: count before closure; any discrepancy stops the closure.
- specimen: specimen in a pot with a BLANK white label, surgeon and scrub reading it together. Teach: label at hand-
  off, read aloud.
- skin-closure: the closed wound with a clean dressing. Teach: tension-free closure.
- debrief: surgeon writing the operation note (grey lines) and handing over to a recovery or intensive care nurse.
  Teach: write it now and hand over the plan.

A. BURR HOLE EVACUATION OF CHRONIC SUBDURAL HAEMATOMA  (folder burr-hole-csdh/)
01_consent-check.png [step.core.consent-check]  Common: an elderly patient, awake but slow, a relative beside them, an
   arrow on the RIGHT side of the head; a blank tablet box (anticoagulant) on the bedside table.
02_neuro-baseline-scan.png [step.neuro.preop-check]  Theatre: the CT on the wall screen with the A crescent fact; the
   anaesthetist shining a pen torch into the patient's pupils; the surgeon pointing at the collection on the screen.
   Teach: a fresh GCS and pupil check, the side read aloud from the scan and matched to the mark. Check: crescent,
   dark grey, on the LEFT half of the CT picture; no text.
03_team-time-out.png [step.core.timeout]  Common.
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_landmarks-marking.png [step.neuro.cranial-landmarks]  Field view of the right side of the head: thin marker lines
   for the midline, the coronal suture, the outline of the pinna and the zygomatic arch; two small circles for the
   frontal and parietal burr holes with a short incision line through each; a faint crescent shadow of the collection
   under the scalp. Teach: plan the burr holes over the thickest part of the collection, away from the midline.
   Check: both circles over the shadow; no text.
07_skin-prep-draping.png [step.core.prep-drape]  Common: the right side of the head, both burr-hole sites in the field.
08_burr-hole.png [step.neuro.burr-hole]  A short incision opened to bone with a small self-retaining retractor; the
   cranial perforator held PERPENDICULAR to the skull with saline dripping on it; inset cutaway through scalp, outer
   table, diploe and inner table: the perforator has stopped at the inner table and the dura beneath is intact.
   Teach: perpendicular, steady pressure, let the clutch stop at the inner table. Check: drill perpendicular.
09_dura-open.png [step.neuro.dura-open]  Close-up of the burr hole: grey-blue dura opened in a cross with a number 11
   blade lifted on a hook; dark brown "motor oil" fluid welling out under pressure; the brain surface not touched.
   Teach: dark fluid under pressure confirms the diagnosis; open the dura away from the brain. Check: colour dark brown.
10_subdural-irrigation.png [step.csdh.irrigation]  A soft catheter passed through the burr hole and slid ALONG the
   inner surface of the dura; warm saline injected gently from a syringe; the return running into a kidney dish,
   changing from brown to nearly clear; inset cutaway: the catheter between dura and brain, running parallel to the
   dura. Teach: irrigate gently along the dura until the return is clear. Check: catheter never points into the brain.
11_subdural-drain.png [step.neuro.drain-tunnel]  A soft drain lying in the subdural space under the frontal burr
   hole, tunnelled under the scalp to a separate stab exit, stitched there; the tube running to a closed drainage bag
   hanging at the side of the trolley BELOW the level of the head. Teach: separate stab, secure, keep the bag below the
   head. Check: bag lower than the head.
12_haemostasis.png [step.core.haemostasis]  Common, at the burr holes.
13_counts.png [step.core.counts]  Common.
14_skin-closure-dressing.png [step.core.skin-closure]  Common: two small scalp wounds closed with staples, the drain
   exit separate, a light dressing.
15_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Ward bay: a nurse shining a pen torch into the patient's eyes,
   the patient lying almost flat, the drain bag below the head, an observation chart with grey lines. Teach: write a
   baseline GCS and pupils and a trigger for urgent CT. Check: chart has no text.
16_debrief-handover.png [step.core.debrief]  Common, handover to the ward nurse including the drain plan.

B. TRAUMA CRANIOTOMY FOR EXTRADURAL HAEMATOMA  (folder trauma-craniotomy-edh/)
01_consent-check.png [step.core.consent-check]  Common, emergency: an intubated young adult on a trolley with a hard
   collar removed, a relative beside the surgeon, the surgeon marking an arrow on the RIGHT temple and recording a
   best-interests decision on a form with grey lines.
02_neuro-baseline-scan.png [step.neuro.preop-check]  Theatre: the CT on the wall screen with the B lens-shaped fact;
   the anaesthetist shining a pen torch into the eyes, the RIGHT pupil clearly larger than the left (inset of both
   eyes). Teach: pupils and motor score immediately before induction, the side read aloud. Check: lens-shaped, bright
   white, on the LEFT half of the CT picture; right pupil larger.
03_team-time-out.png [step.core.timeout]  Common, a fast emergency time-out.
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
06_question-mark-incision.png [step.neuro.cranial-landmarks]  Field view of the right side of the head: the reverse
   question-mark incision drawn exactly as in the B facts; thin lines for the midline, the coronal suture, the pinna and
   the zygomatic arch; a faint lens-shaped shadow of the clot under the temple. Teach: a trauma flap that can be
   extended to a full decompression. Check: incision starts in front of the tragus; no text.
07_skin-prep-draping.png [step.core.prep-drape]  Common: the whole question-mark field.
08_scalp-flap.png [step.edh.scalp-flap]  The scalp incised to bone with blue plastic Raney clips along both edges,
   the assistant's fingers pressing beside the wound; the scalp and temporalis flap reflected forwards and held with
   hooks, wrapped in a moist swab. Teach: control the scalp edges as you go; blood loss starts here. Check: clips on
   both edges.
09_first-burr-hole.png [step.neuro.burr-hole]  The perforator held perpendicular on the temporal bone just above the
   zygomatic arch; dark clot extruding from the new hole. Teach: the first burr hole over the thickest clot relieves
   pressure. Check: drill perpendicular.
10_bone-flap.png [step.edh.bone-flap]  A Penfield dissector separating the dura from the inner table, then the
   craniotome with its footplate cutting between burr holes; the bone flap being lifted with dark clot stuck to its
   underside. Teach: free the dura first, and make the flap big enough to expose the whole clot. Check: the cut does
   not cross the midline.
11_evacuate-clot.png [step.edh.evacuate]  The dark red jelly-like clot over the white dura being removed with suction
   and irrigation; the bleeding middle meningeal artery branch on the dura caught with bipolar forceps; two dural
   hitch sutures running from the dura edge to small holes in the bone edge. Teach: remove the clot AND control the
   source, then hitch the dura. Check: artery on the outer surface of the dura.
12_dura-inspect.png [step.neuro.dura-open]  The clean dura after evacuation, mostly white and slack, with one small
   tense BLUE area (blood beneath) being opened with a hook and blade. Teach: open the dura only if it is blue or tense,
   or the scan shows subdural blood. Check: brain not cut.
13_decompressive-craniectomy.png [step.edh.decompressive-craniectomy]  The B craniectomy fact: a very large
   frontotemporoparietal bone opening reaching down to the floor of the middle fossa, the dura opened widely, swollen
   brain bulging above the bone edge; the bone flap on the scrub trolley in a sterile bowl. Teach: if the brain swells
   above the inner table, leave the bone out, and make the opening large. Check: much larger than a palm.
14_loose-duraplasty.png [step.neuro.dural-repair]  A loose patch of pericranium or dural substitute sewn to the dural
   edges over the swollen brain, with slack in it. Teach: a loose duraplasty gives the swollen brain room. Check: the
   patch is not tight.
15_replace-bone-flap.png [step.edh.flap-replace]  The standard path when the brain is slack: the bone flap back in
   place with small titanium plates and screws, a central hitch suture through two small holes in the flap tying the
   dura up to it. Teach: replace the bone only if the brain is slack; hitch the dura centrally. Check: brain below the
   inner table.
16_haemostasis.png [step.core.haemostasis]  Common.
17_counts.png [step.core.counts]  Common.
18_skin-closure-dressing.png [step.core.skin-closure]  Common: the question-mark wound closed with staples and a head
   dressing.
19_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Intensive care: the ventilated patient, a nurse checking the
   pupils with a pen torch, an observation chart with grey lines. Teach: a written baseline and a trigger for urgent
   CT. Check: chart has no text.
20_debrief-handover.png [step.core.debrief]  The surgeon writing the note while the scrub nurse hands the bone flap in
   a sealed sterile container with a BLANK label to the circulating nurse for storage. Teach: record whether the flap is
   replaced or stored, and where. Check: no text on the container.

C. EXTERNAL VENTRICULAR DRAIN AT KOCHER POINT  (folder evd-insertion/)
01_consent-check.png [step.core.consent-check]  Common, intensive care: an intubated patient, a relative with the
   surgeon, an arrow on the RIGHT side of the forehead behind the hairline, a best-interests form with grey lines.
02_neuro-baseline-scan.png [step.neuro.preop-check]  The CT on a screen showing both lateral ventricles enlarged and
   dark (hydrocephalus), no midline shift; the surgeon tracing the right frontal horn with a finger; a nurse checking
   the pupils. Teach: read the ventricles and any shift before choosing the side. Check: no text.
03_team-time-out.png [step.core.timeout]  Common.
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common: a single dose at insertion.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_kocher-point.png [step.neuro.cranial-landmarks]  Field view from just above the forehead (C orientation): a thin
   line along the midline from the nasion backwards, a line across for the coronal suture, a small cross at Kocher point
   on the RIGHT (viewer's LEFT of the midline), in line with the right pupil and just in front of the coronal suture, a
   short incision line through it. Teach: Kocher point, mid-pupillary line, just in front of the coronal suture.
   Check: cross on the patient's RIGHT; no text or numbers.
07_skin-prep-draping.png [step.core.prep-drape]  Common: a small field around the right frontal point.
08_twist-drill.png [step.neuro.burr-hole]  A hand twist drill with a depth stop held PERPENDICULAR to the skull
   through a small stab incision at Kocher point; inset cutaway: the drill through both tables, stopping at the dura.
   Teach: keep the drill perpendicular to the skull. Check: drill perpendicular.
09_dura-nick.png [step.neuro.dura-open]  The small drill hole with the dura coagulated and nicked with a fine needle or
   blade just enough to pass the catheter. Teach: open the dura only as much as the catheter needs.
10_ventricular-cannulation.png [step.evd.cannulate]  The catheter with its stylet passing perpendicular to the skull;
   two small insets: from the front, a faint line from Kocher point towards the RIGHT medial canthus; from the side, a
   faint line towards the RIGHT external auditory meatus; a cutaway of the brain showing the tip in the right frontal
   horn just in front of the foramen of Monro; clear CSF beginning to drip. Teach: aim at the medial canthus and the
   ear; stop after three passes. Check: tip in the frontal horn of the right lateral ventricle.
11_opening-pressure-connect.png [step.evd.connect]  The catheter connected to a closed EVD set on a pole beside the
   bed: a column with plain tick marks (no numbers), a drip chamber and a collection bag; a red laser line from a laser
   level running from the zero mark to the patient's TRAGUS; clear CSF swinging in the column. Teach: zero at the
   tragus, measure the opening pressure, keep the system closed. Check: zero level with the ear.
12_tunnel-secure.png [step.neuro.drain-tunnel]  The catheter tunnelled under the scalp to exit through a separate stab
   several centimetres behind the incision, anchored with a suture, a gentle loop of tubing taped down. Teach: a long
   tunnel and firm fixation reduce infection and pull-out. Check: exit separate from the incision.
13_haemostasis.png [step.core.haemostasis]  Common.
14_counts.png [step.core.counts]  Common, procedure-pack items and sharps.
15_skin-closure-dressing.png [step.core.skin-closure]  Common: the small incision closed, the exit site under a
   transparent dressing, the tubing looped and taped.
16_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Intensive care: a nurse re-levelling the EVD column to the
   tragus with the laser level after the head of the bed was moved, the pupils checked, an observation chart with grey
   lines. Teach: re-level the drain whenever the head moves; a written trigger for calling. Check: no text.
17_debrief-handover.png [step.core.debrief]  Common, handover to the intensive care nurse at the bedside with the EVD
   set in view. Teach: write the opening pressure, the reference level and the drain height.

D. VENTRICULOPERITONEAL SHUNT  (folder vp-shunt-insertion/)
01_consent-check.png [step.core.consent-check]  Common: an awake older adult with a walking frame and a relative; arrows
   behind the RIGHT ear and on the right upper abdomen. Teach: consent covers lifelong shunt dependence and likely
   revisions.
02_neuro-baseline-scan.png [step.neuro.preop-check]  A CT on the screen with enlarged lateral ventricles; on the table a
   valve box with a BLANK label and a valve programmer; the surgeon pointing to the right ventricle. Teach: confirm the
   ventricle size, the side, the entry point and the valve chosen. Check: no text.
03_team-time-out.png [step.core.timeout]  Common: the surgeon holding up the unopened valve box (blank label); a sign
   on the theatre door showing only a plain symbol for "limit entry" (no text).
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common: the syringe connected before the knife is
   picked up.
05_head-position.png [step.neuro.head-fixation]  Teach and Check: the D positioning facts exactly, with the straight
   dotted line from behind the ear to the abdomen.
06_landmarks-marking.png [step.neuro.cranial-landmarks]  Field view of the right side of the head: a small cross at
   Keen point (above and behind the top of the pinna) with a curved incision line around it; a separate inset of the
   right upper abdomen with a short incision line beside the umbilicus. Teach: mark the cranial entry, the scalp
   incision and the abdominal incision before draping. Check: no text.
07_navigation.png [step.neuro.navigation]  Theatre: an optical navigation camera on a stand, a reference frame with
   reflective spheres fixed to the headrest, the surgeon touching the nasion with a navigation pointer; the screen
   shows three grey brain views with the ventricles (no text). Teach: check accuracy on three bony landmarks before
   trusting navigation. Check: no numbers on the screen.
08_skin-prep-draping.png [step.core.prep-drape]  ONE continuous field from the scalp behind the ear, down the neck and
   chest to the abdomen, covered with a brownish transparent iodine-impregnated adhesive drape so no skin is exposed
   along the tunnel. Teach: one continuous field, no exposed skin along the tunnel.
09_shunt-handling.png [step.vps.shunt-handling]  The scrub nurse pulling on fresh outer gloves; the shunt (ventricular
   catheter, valve, peritoneal catheter) just taken from its pack, being primed with saline from a syringe in the
   direction of flow, lying in a dish of saline; the wound edges covered with swabs. Teach: open the implant only when
   needed, fresh gloves, it never touches skin. Check: shunt away from the skin.
10_scalp-incision.png [step.neuro.scalp-incision]  A curved incision behind the right ear around Keen point, the
   assistant pressing either side, clips on the scalp edge, the small flap turned so the burr-hole site and the valve
   bed lie away from the suture line. Teach: curve the incision so no implant lies under the scar.
11_burr-hole.png [step.neuro.burr-hole]  The perforator perpendicular on the parieto-occipital bone; inset: stopping at
   the inner table, dura intact. Teach: perpendicular, let the clutch stop at the inner table.
12_peritoneal-access.png [step.vps.abdominal-access]  The small right upper-quadrant incision: the anterior rectus
   sheath opened, the rectus split, the thin peritoneum held up between two artery clips and opened under direct
   vision, glistening omentum and pink bowel serosa visible through the opening, a purse-string suture placed. Teach:
   enter under vision and see omentum or bowel, not preperitoneal fat. Check: the opening is through the peritoneum.
13_subcutaneous-tunnel.png [step.vps.tunnel]  Whole-length view (D orientation): a long malleable tunneller passing
   under the skin from the cranial wound behind the ear, down the neck, over the clavicle and down the chest towards
   the abdominal incision; the surgeon's free hand feeling its tip under the skin; inset cutaway at the clavicle: the
   tunneller in the fat ABOVE the clavicle, far from the lung. Teach: stay subcutaneous and cross over the clavicle
   superficially. Check: tunneller visible as a ridge under the skin.
14_dura-open.png [step.neuro.dura-open]  The burr hole with a small cross-shaped dural opening and the pia coagulated
   with bipolar forceps, just large enough for the catheter. Teach: a small opening so CSF does not leak around the
   catheter.
15_ventricular-catheter.png [step.vps.ventricular-catheter]  The catheter with stylet passing through the burr hole
   along the planned path; cutaway: the tip in the frontal horn of the RIGHT lateral ventricle in front of the choroid
   plexus; after the stylet is removed, clear CSF dripping into a sample tube with a blank label. Teach: one clean pass
   to the planned depth; if no CSF, withdraw fully, never redirect inside the brain. Check: tip in the frontal horn.
16_connect-flow.png [step.vps.connect-flow]  The ventricular catheter bent over a right-angle guide and joined to the
   valve, each joint tied with a non-absorbable ligature; the valve stitched to the pericranium with its moulded arrow
   pointing towards the abdomen; the far end of the peritoneal catheter held BELOW the head with clear CSF dripping
   from it. Teach: secure every joint, valve the right way round, see spontaneous distal flow. Check: arrow points
   down the body.
17_peritoneal-placement.png [step.vps.peritoneal-placement]  The peritoneal catheter fed freely into the cavity
   through the opened peritoneum; the purse-string being tied around it without crushing it; inset cutaway: loose loops
   of catheter lying among the bowel inside the peritoneum, not in the abdominal wall. Teach: free intraperitoneal
   placement with enough length. Check: catheter inside the peritoneum.
18_bailout-cloudy-csf.png [step.vps.bailout]  The surgeon holding up a CSF sample tube (blank label) that is clearly
   CLOUDY against the light; the shunt pack set aside unopened; the scrub nurse opening an external ventricular drain
   set instead. Teach: cloudy CSF means no implant: send CSF and place an external drain. Check: CSF cloudy, not clear.
19_counts.png [step.core.counts]  Common.
20_layered-closure.png [step.neuro.layered-scalp-closure]  The scalp wound with the galea closed by interrupted
   inverted absorbable sutures and the skin being stapled; the valve showing as a small bump BESIDE, not under, the
   suture line; inset of the abdominal wound closed in layers. Teach: close the galea, and never leave an implant
   under the suture line. Check: valve away from the suture line.
21_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Ward: the patient sitting up, a nurse checking conscious level
   and pupils; on a screen a plain X-ray series showing one continuous shunt tube from the head down the neck and chest
   into the abdomen (no text). Teach: headache, vomiting and drowsiness are shunt-failure triggers. Check: no text.
22_debrief-handover.png [step.core.debrief]  Common: the note includes the valve type and setting; the valve
   programmer on the desk.

E. LUMBAR DISCECTOMY FOR CAUDA EQUINA SYNDROME  (folder lumbar-discectomy-ces/)
01_consent-check.png [step.core.consent-check]  Common: an awake adult lying on the side on a trolley, a urinary
   catheter bag hanging below, the surgeon marking an arrow on the lower back in the midline.
02_neuro-baseline-mri.png [step.neuro.preop-check]  A sagittal lumbar MRI on the screen: a large L4-L5 disc
   herniation squashing the thecal sac; the surgeon testing ankle dorsiflexion power while a nurse holds a bladder
   scanner. Teach: read the level from the MRI aloud and match it to the mark; record leg, saddle and bladder function.
   Check: no text on the MRI.
03_team-time-out.png [step.core.timeout]  Common.
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common (patient still supine on the trolley before
   turning).
05_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
06_skin-prep-draping.png [step.core.prep-drape]  Common: the lower back, a wide field.
07_level-check.png [step.spine.level-check]  The C-arm in the lateral position over the lumbar spine with a spinal
   needle in the back at the marked level; inset lateral X-ray (no text): the needle pointing at the L4-L5 disc, the
   sacrum visible at the bottom. Teach: count up from the sacrum on a lateral image before the incision. Check: sacrum
   in the image.
08_exposure-laminotomy.png [step.spine.exposure]  Field view (E orientation): midline incision, the muscles held off
   the laminae by a self-retaining spinal retractor; a Kerrison rongeur biting the lower edge of the L4 lamina and the
   yellow ligamentum flavum; the facet joints intact at the sides. Teach: remove enough bone and ligament to reach the
   disc without pulling on a compressed sac; keep the facets. Check: facets preserved.
09_discectomy.png [step.spine.decompress]  Microscope view with a soft round vignette: the thecal sac and the L5 root
   held gently towards the midline with a root retractor; the annulus opened; a pituitary rongeur lifting out a large
   white disc fragment; inset side cutaway: the rongeur tip inside the disc space, well short of the front of the disc
   and the aorta beyond. Teach: retract gently only once there is room; keep the rongeur at a controlled depth. Check:
   tip not through the front of the disc.
10_confirm-decompression.png [step.spine.confirm]  Microscope view: a ball-tipped probe passing under the now slack,
   pulsating thecal sac and into the foramen; the root moving freely; no fragments left. Teach: probe under the sac,
   into the foramen and up and down the canal. Check: sac slack.
11_dural-repair.png [step.neuro.dural-repair]  Microscope view: a small tear in the dura being closed with a fine
   suture, a sealant patch ready; inset: the anaesthetist squeezing the breathing bag for a Valsalva test. Teach: repair,
   reinforce, test with Valsalva, tell the ward. Check: fine suture.
12_specimen-labelling.png [step.core.specimen]  Common: white disc fragments in a pot with a blank label.
13_haemostasis.png [step.core.haemostasis]  Common: epidural veins controlled with bipolar and a haemostatic agent.
14_counts.png [step.core.counts]  Common, with the cottonoid patties and their strings laid out.
15_skin-closure-dressing.png [step.core.skin-closure]  Common: a short midline lumbar wound closed with a dressing.
16_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Ward: a nurse scanning the bladder with a bladder scanner and
   checking leg power; an observation chart with grey lines. Teach: include saddle sensation and bladder function in
   the baseline and the trigger for an urgent MRI. Check: no text.
17_debrief-handover.png [step.core.debrief]  Common.

QUALITY CHECK (for EVERY image, at FULL SIZE, before moving to the next)
- Orientation and laterality correct for that operation (see the rules above)? Is the operated side the RIGHT side
  of the head (A to D) and is the scan in radiological convention?
- Every hand, arm and leg attached to a body, on the correct side?
- Anatomy, instrument, incision and position correct for this step?
- Every PRECISE FACT that applies to this image drawn exactly? Drill and catheter perpendicular where stated?
- Fat yellow only where real fat is; dura grey-white; bone ivory?
- The teaching point is the first thing the eye lands on?
- Zero text, numbers, labels, logos or watermarks, including boards, labels, packs, scans and screens?
- Same style, patient and team as the earlier images of that operation?
If any answer is no, regenerate that image before continuing.

DELIVERY
Make FIVE zip files, one per operation, each containing a FOLDER with the operation's folder name and the PNGs inside
it, named exactly as above:
  surgx-burr-hole-csdh-steps.zip              (16 images, folder burr-hole-csdh/)
  surgx-trauma-craniotomy-edh-steps.zip       (20 images, folder trauma-craniotomy-edh/)
  surgx-evd-insertion-steps.zip               (17 images, folder evd-insertion/)
  surgx-vp-shunt-insertion-steps.zip          (22 images, folder vp-shunt-insertion/)
  surgx-lumbar-discectomy-ces-steps.zip       (17 images, folder lumbar-discectomy-ces/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the five zips as downloads.
```
