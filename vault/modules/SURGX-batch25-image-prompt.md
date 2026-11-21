---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 25 (Anterior cervical discectomy and fusion, Lumbar laminectomy for canal stenosis, Posterior lumbar instrumented fusion, VATS bullectomy with pleurodesis, Median sternotomy and closure): Gemini image prompt (100 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant cardiothoracic surgeons and neurosurgeons and spine surgeons. You are making 100 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Anterior cervical discectomy and fusion                        22 images
  B. Lumbar laminectomy for canal stenosis                          19 images
  C. Posterior lumbar instrumented fusion (TLIF)                    22 images
  D. VATS bullectomy with pleurodesis                               18 images
  E. Median sternotomy and closure                                  19 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (AANS/CNS Joint Section on Disorders of the Spine and Peripheral Nerves (J Neurosurg Spine), Guideline update for the performance of fusion procedures for degenerative disease of the lumbar spine; AO Spine / Cervical Spine Research Society, Fehlings MG et al.).
2. Write back a short plan: for each step, 1 to 2 lines on what the image shows, the viewpoint and the single teaching
   point. Then go on to Phase 2 without waiting for me.
3. References are ONLY for accuracy. Never copy, trace or reproduce a frame or image from any video or website.
   Every image must be newly generated.

PHASE 2: GENERATE THE IMAGES
- Use your IMAGE GENERATION MODEL (Nano Banana / Gemini image generation) for every image.
- NEVER draw with code (no SVG, HTML, canvas, Python, matplotlib, Three.js). Code is allowed ONLY at the very end,
  to put the finished images into zip files.
- Work operation by operation. If you cannot make all of them in one reply, work in batches and keep the style
  identical. Do not skip any image.

HOW EVERY IMAGE MUST TEACH
- ONE teaching point per image. The action of the step is the clear centre of the picture.
- Viewpoint: the surgeon's view of the operative field for open steps; the laparoscope or endoscope monitor view (round image, thin instruments only, never open retractors) for laparoscopic, arthroscopic and endoscopic steps; the microscope view for ear, larynx and spine microsurgery; a fluoroscopy screen as grey shapes for image-guided steps; a clean cut-away inset when the trainee must see a layer or a structure behind; a whole-body view for positioning; a theatre view for team and safety steps.
- The key structure is where the eye lands first: sharp and well lit, the background slightly softened. A subtle glow
  or outline on the key structure is fine. A small circular close-up or cross-section inset is allowed when the key
  detail is tiny or lies deep or inside an organ.
- Instruments correct in size and position, entering through the correct incision.
- Orientation and laterality: state the side in every image of an operation that has a side, and keep that side the same in every image. Open views have the patient's head at the TOP of the frame unless the step needs otherwise. Never flip a side between images of the same operation.
- BODIES MUST BE WHOLE AND CONNECTED. Every hand belongs to an arm that runs to a shoulder of a visible body. The same
  patient keeps the same face, age and hair in every image of an operation; never swap the patient.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal. Fat yellow ONLY where real fat is; arteries thick-walled and red,
  veins thinner and blue-purple; the ureter a pale, thin, peristaltic tube; burnt eschar leathery grey-brown or white;
  pericardium a glistening white-grey sac; valve leaflets thin, white and calcified when stenotic.
- Patients covered and dignified; only the operative field exposed.

PRECISE FACTS (draw exactly this)
Positioning (a NEW whole-body view for each operation; never reuse a generic theatre scene):
- A. Supine with a small roll between the shoulder blades and the neck in mild extension within the range the patient
  tolerated awake. Shoulders gently taped down to allow a lateral image of the lower cervical spine, without traction
  injury to the brachial plexus.
- B. Prone on a frame that keeps the abdomen free, with slight lumbar flexion to open the interlaminar spaces. Eyes
  free of pressure; arms forward at no more than 90 degrees. Image intensifier positioned for lateral views before
  preparing the skin.
- C. Prone on a radiolucent frame that leaves the abdomen free and maintains lumbar lordosis; hips extended. Eyes free
  of pressure, checked at intervals and recorded. Image intensifier or navigation set up so that true AP and lateral
  views of each pedicle can be obtained before preparing.
- D. Lateral decubitus with the operated side up, an axillary roll below the dependent axilla, and the table broken to
  open the intercostal spaces. Arms supported with the upper arm forward and up, pressure points padded, and the
  patient secured before any tilt.
- E. Supine with the arms tucked at the sides and padded, or abducted per unit practice, with a small roll between the
  scapulae to lift the sternum. Defibrillator pads applied before draping in redo and high-risk cases.
Step-specific facts:
- A. Anatomy: Surface landmarks: the hyoid lies at about C3, the thyroid cartilage at C4 and C5, the cricoid at C6;
  the carotid tubercle (Chassaignac) on C6. Image to confirm. Must be right: Confirm the level with a needle and
  lateral image before any disc is opened. Keep retractor blades under the longus colli, not on the oesophagus or
  carotid. Work in the midline: identify the uncinate processes on each side and stay between them.
- B. Anatomy: The ligamentum flavum attaches to the undersurface of the upper lamina and the upper edge of the lower
  lamina; it thickens with age and is the main soft tissue cause of stenosis. Must be right: Image the level before
  incision and before removing bone. Keep the Kerrison footplate between the ligament and the dura; free adhesions
  before biting. Preserve the pars and enough facet on each side. Decompress the lateral recesses, not just the
  central canal.
- C. Anatomy: The lumbar pedicle entry point is at the junction of the transverse process and the lateral edge of the
  superior articular process, at the base of the pars. Pedicles converge medially and their angulation increases from
  L1 to L5. Must be right: Image or navigate every pedicle before a screw is inserted, and probe all four walls and
  the floor. Know where the exiting root is before working in the foramen: it lies just under the pedicle above.
- D. Anatomy: Blebs and bullae in primary spontaneous pneumothorax are most often at the lung apex, and sometimes at
  the apex of the lower lobe. Must be right: Do not induce positive-pressure ventilation with an undrained
  pneumothorax. Confirm lung isolation before the first port; poor isolation makes the operation unsafe. Insert the
  first port under vision or by blunt finger dissection, not by a blind trocar thrust.
- E. Anatomy: The sternum consists of the manubrium, body and xiphoid; the sternal angle marks the second costal
  cartilage. The innominate (left brachiocephalic) vein crosses behind the manubrium, sometimes high in the neck,
  sometimes low. Must be right: Stop ventilation during the saw pass. In a redo, never use the standard sternal saw
  for re-entry, and have peripheral cannulation sites prepared. Counts must be correct before the sternum is closed:
  the mediastinum is a cavity.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 100 images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern operative surgery atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs; neutral clean background.
- Within each operation the same patient (the same adult, or the same child in a paediatric operation), the same team and the same instrument set in every image. Staff in
  caps and masks, generic faces, no real or identifiable person.
- Landscape 4:3, exactly 1600 x 1200 px, PNG.

THE STEPS  (filename [step id]  scene : teaching point : check)
Each line quotes what that step does in the app. Draw the ONE moment that shows it best. Where a step is a check,
a decision or a bailout (a safety check, a major bleed, an injury, a conversion or bailout), draw the
people and the thing being checked or the complication being handled, for example the surgeon pressing a gauze on a bleeding
vessel while the anaesthetist calls for blood, or the team pausing to look at a blank imaging screen. Use the PRECISE FACTS above wherever they apply.

COMMON SAFETY STEPS (draw them for each operation with that operation's patient, team and setting)
- consent-check: pre-op bay, the awake patient, the surgeon marking an arrow on the operative SIDE where the
  operation has a side (for a child, the parent sits beside the bed and signs a form with grey lines). Teach: confirm
  identity, operation and side. Check: nothing written.
- timeout: theatre, patient on the table, whole team paused and facing each other, surgeon speaking, nobody holding an
  instrument. Teach: everyone stops and confirms before the first cut.
- prophylaxis: the anaesthetist or nurse connects a syringe (blank label) to the cannula PORT on the arm (needle-free).
  Teach: prophylaxis per protocol. Check: arm attached to the patient.
- prep-drape: the skin painted with antiseptic well beyond the incision, then sterile drapes leaving only the field.
  Teach: prepare widely and drape to the field.
- haemostasis: a diathermy tip touching a single bleeding point; the field dry.
- counts: scrub practitioner and circulating nurse counting blades, needles and sponges beside a BLANK count board.
  Teach: count before closure; any discrepancy stops the closure.
- specimen: the excised tissue in a small pot with a BLANK white label, surgeon and scrub reading it together.
- skin-closure: the closed wound with a clean dressing.
- debrief: surgeon writing the operation note (grey lines) and handing over to a recovery or ICU nurse at the
  bedside.

A. ANTERIOR CERVICAL DISCECTOMY AND FUSION  (folder acdf/)
01_consent-check.png [step.core.consent-check]  Common. Include dysphagia, hoarseness and the airway risk of a neck
   haematoma.
02_preop-check.png [step.neuro.preop-check]  Neurological baseline, side and coagulation check: Record GCS by
   component and pupil size and reaction immediately before anaesthesia, with the time. Put the most recent scan up in
   theatre. Read the side (or spinal level) aloud from the images with the team, and match it to the consent and the
   skin mark. Record limb power, hand function, gait and the mJOA score; read the level from the MRI aloud. Teach: In
   neurosurgery the side and the level are read off a scan, not seen on the skin, and the patient often cannot confirm
   them. Check: avoid operating on the side written on the request form rather than the side shown on the scan.
03_timeout.png [step.core.timeout]  Common. Agree the intubation and neck position plan, monitoring, and the level and
   side of approach.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_image-intensifier.png [step.ortho.image-intensifier]  Image intensifier set-up and radiation safety: Position the
   C-arm and confirm that true anteroposterior and lateral views can be obtained before preparing the skin. Lead
   protection and dosimeters for all staff; thyroid shields; the radiographer briefed on the views needed. Check that
   the target level can be seen on a lateral view before preparing; large shoulders hide C6 and C7. Teach: Fixation is
   only as good as the images it is judged by, and every second of screening is dose to the patient and the team.
   Check: avoid discovering after draping that a true lateral cannot be obtained.
07_spine-level.png [step.neuro.spine-level]  Radiographic level confirmation before incision and before bone removal:
   Before incision, place a marker on the skin or a spinal needle and take a lateral image. Count from a fixed
   reference: the sacrum in the lumbar spine, and the C2 vertebra or a visible landmark in the cervical spine. Compare
   the count with the MRI and any whole-spine image, looking for transitional or extra lumbar vertebrae, or rib
   anomalies. Skin marker before incision; a bent needle in the disc space after exposure, imaged before any disc is
   touched. Teach: Wrong-level spine surgery is one of the commonest serious errors in the specialty. Check: avoid
   relying on palpation of spinous processes or the iliac crest line.
08_ionm.png [step.neuro.ionm]  Neurophysiological monitoring baseline and alarm plan: Agree the modalities with the
   neurophysiologist: motor evoked potentials, somatosensory evoked potentials, free-running and triggered EMG, as
   suited to the operation. Agree the anaesthetic with the anaesthetist, usually total intravenous anaesthesia with
   neuromuscular blockade avoided or reversed when motor potentials are needed. Baselines before any distraction or
   decompression in myelopathic patients. Teach: Monitoring is only useful if a baseline was obtained before the at-
   risk step, the anaesthetic allows the signals to be read, and the team has agreed in advance what will happen when
   the signal changes. Check: avoid no baseline, so a poor signal cannot be interpreted.
09_prep-drape.png [step.core.prep-drape]  Common.
10_approach.png [step.acdf.approach]  Anterior approach to the cervical spine: Make a transverse skin incision in a
   skin crease at the imaged level, from the midline to the anterior border of sternocleidomastoid. Divide the
   platysma, then dissect bluntly along the medial border of sternocleidomastoid. Feel the carotid pulse and stay
   medial to it. Teach: The anterior cervical approach uses a natural plane between the carotid sheath and the
   visceral column. Check: avoid sharp dissection in the visceral plane.
11_discectomy-endplate.png [step.neuro.discectomy-endplate]  Complete discectomy and endplate preparation for
   interbody fusion: Incise the annulus with a scalpel in a window sized to the cage, and remove nucleus with
   pituitary rongeurs. Use curettes and shavers to strip cartilage from both endplates while preserving the bony
   endplate. Stay between the uncinate processes; remove the cartilage endplate without breaching the bony endplate.
   Teach: An interbody fusion fuses bone to bone through the disc space. Check: avoid breaching the endplate with an
   aggressive curette, causing subsidence.
12_decompression.png [step.acdf.decompression]  Posterior osteophytes, posterior longitudinal ligament and foraminal
   decompression: Under magnification, thin the posterior osteophytes with a diamond burr, working parallel to the
   endplates. Open the posterior longitudinal ligament with a hook and remove it with small Kerrison rongeurs when
   there is extruded disc behind it or the surgeon plans a complete decompression. Teach: In myelopathy and
   radiculopathy, the compression often lies behind the disc: osteophytes, disc fragments under or through the
   posterior longitudinal ligament, and uncovertebral spurs in the foramen. Check: avoid pushing a Kerrison footplate
   under a ligament where the cord has no room.
13_ionm-alert.png [step.neuro.ionm-alert]  Bailout: responding to a monitoring alert or new neurological concern: Stop
   the surgical manoeuvre and announce the pause. Ask what was done just before the change. Anaesthesia: raise mean
   arterial pressure towards or above baseline per local protocol, correct anaemia and hypothermia, check anaesthetic
   depth and that no relaxant has been given. Teach: A significant drop in evoked potentials signals possible cord or
   root injury that is often reversible if acted on within minutes. Check: avoid carrying on with the operation while
   the alarm is investigated.
14_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Confirm cage height and footprint, and plate length, against the trials and the images. Teach: The wrong size, side
   or type cannot be undone after insertion, and an implant that is not registered cannot be traced if it is recalled.
   Check: avoid opening an implant before the measurement is confirmed.
15_interbody-cage.png [step.neuro.interbody-cage]  Sizing and inserting the interbody cage or graft: Trial sizes
   sequentially under imaging. Choose the size that sits snug without forcing, and match the lordosis to the segment.
   Pack the cage with autograft or the agreed graft material, and place graft in the disc space ahead of it as
   appropriate. Recess the cage behind the anterior vertebral margin and well in front of the posterior margin;
   release distraction before checking. Teach: The cage restores disc height and indirectly decompresses the foramen,
   then carries the graft that will fuse. Check: avoid over-distraction that causes a new root deficit.
16_plate.png [step.acdf.plate]  Anterior plate fixation: Remove anterior osteophytes so the plate lies flat on the
   vertebral bodies. Choose the shortest plate that allows screws in each vertebral body without the plate reaching
   the adjacent discs. Teach: A plate adds stability and reduces cage migration, particularly in multilevel
   constructs, but a plate that is too long overlaps the adjacent disc, and screws that are angled badly can enter the
   disc or the canal. Check: avoid an overlong plate encroaching on the adjacent disc.
17_final-imaging.png [step.ortho.final-imaging]  Final images saved in two planes: Screen the whole construct in two
   planes, including the ends of the implant and the joints at either end. Confirm reduction, implant position and
   screw lengths; look specifically for joint penetration. AP and lateral images showing the cage, the plate and the
   screw tips. Teach: The final images are the evidence of what was achieved. Check: avoid saving only the best-
   looking view.
18_haemostasis.png [step.core.haemostasis]  Common. Release the retractors and inspect for bleeding from longus colli
   and the vertebral body edges; a neck haematoma is an airway emergency.
19_counts.png [step.core.counts]  Common.
20_skin-closure.png [step.core.skin-closure]  Common. Close the platysma as a separate layer, then the skin; a drain
   is per surgeon preference.
21_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Post-operative neurological observation plan: Write the post-
   operative GCS, pupils and limb power (or lower-limb and sphincter function after spinal surgery) as a baseline.
   Prescribe the frequency of neurological observations and a specific trigger: a fall in GCS, a new pupil change, new
   weakness or new retention. Add the neck: swelling, stridor and swallowing, with the airway plan for a haematoma
   written down. Teach: Post-operative haematoma and swelling present as a change in neurological observations, often
   hours after surgery. Check: avoid writing 'routine neuro obs' without a baseline or a trigger.
22_debrief.png [step.core.debrief]  Common.

B. LUMBAR LAMINECTOMY FOR CANAL STENOSIS  (folder lumbar-laminectomy-stenosis/)
01_consent-check.png [step.core.consent-check]  Common.
02_preop-check.png [step.neuro.preop-check]  Neurological baseline, side and coagulation check: Record GCS by
   component and pupil size and reaction immediately before anaesthesia, with the time. Put the most recent scan up in
   theatre. Read the side (or spinal level) aloud from the images with the team, and match it to the consent and the
   skin mark. Read the levels from the MRI aloud and match them to the consent; record leg power and bladder function.
   Teach: In neurosurgery the side and the level are read off a scan, not seen on the skin, and the patient often
   cannot confirm them. Check: avoid operating on the side written on the request form rather than the side shown on
   the scan.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_prone-position.png [step.neuro.prone-position]  Prone positioning on a spinal frame: Log-roll from the trolley with
   the anaesthetist controlling the head and airway; check the tube and lines after turning. Use a frame or bolsters
   that leave the abdomen hanging free. Slight flexion for a decompression alone; the abdomen hanging free. Teach: The
   prone position decides blood loss, lordosis and the risk of blindness. Check: avoid compressing the abdomen, then
   fighting epidural bleeding for the rest of the case.
06_image-intensifier.png [step.ortho.image-intensifier]  Image intensifier set-up and radiation safety: Position the
   C-arm and confirm that true anteroposterior and lateral views can be obtained before preparing the skin. Lead
   protection and dosimeters for all staff; thyroid shields; the radiographer briefed on the views needed. Confirm a
   true lateral of the target levels before preparing the skin. Teach: Fixation is only as good as the images it is
   judged by, and every second of screening is dose to the patient and the team. Check: avoid discovering after
   draping that a true lateral cannot be obtained.
07_spine-level.png [step.neuro.spine-level]  Radiographic level confirmation before incision and before bone removal:
   Before incision, place a marker on the skin or a spinal needle and take a lateral image. Count from a fixed
   reference: the sacrum in the lumbar spine, and the C2 vertebra or a visible landmark in the cervical spine. Compare
   the count with the MRI and any whole-spine image, looking for transitional or extra lumbar vertebrae, or rib
   anomalies. Count from the sacrum, check for a transitional vertebra on the MRI, and re-image on the lamina before
   removing bone. Teach: Wrong-level spine surgery is one of the commonest serious errors in the specialty. Check:
   avoid relying on palpation of spinous processes or the iliac crest line.
08_prep-drape.png [step.core.prep-drape]  Common.
09_posterior-exposure.png [step.neuro.posterior-exposure]  Posterior midline exposure of the lumbar spine: Incise in
   the midline over the confirmed levels, and divide the thoracolumbar fascia just off the spinous processes. Strip
   the paraspinal muscles subperiosteally off the spinous processes and laminae with a Cobb elevator and diathermy,
   packing as you go. Expose only to the lateral edge of the facets; preserve the facet capsules. Teach: A clean
   subperiosteal exposure keeps blood loss low and gives a clear view of the bony landmarks that guide decompression
   and screw entry. Check: avoid plunging an instrument through the interlaminar space, especially in a revision.
10_central-decompression.png [step.neuro.central-decompression]  Central laminectomy and decompression of the thecal
   sac: Remove the spinous process and lamina of the stenotic level with rongeurs and a burr, thinning the lamina
   before removing it. Detach the ligamentum flavum from the undersurface of the lamina with a curette, and remove it
   in pieces with Kerrison rongeurs, keeping the footplate between the ligament and the dura. Teach: Stenosis is
   narrowing by bone, hypertrophied ligamentum flavum and disc. Check: avoid using a Kerrison under the lamina where
   the dura is adherent to the ligament, tearing the dura.
11_lateral-recess.png [step.lam.lateral-recess]  Lateral recess and foraminal decompression: Undercut the medial part
   of the superior articular process with an angled Kerrison or a burr, staying parallel to the dura. Follow the
   traversing root to its pedicle and into the foramen until a probe passes freely along it. Teach: Leg symptoms in
   stenosis often come from the lateral recess and the foramen, under the superior articular process. Check: avoid
   removing the whole facet to see the root.
12_stability-check.png [step.lam.stability-check]  Checking what is left: facets, pars and stability: Inspect the
   remaining pars on each side; if it is very thin or fractured, the segment may slip. Estimate how much of each facet
   has been removed and whether the capsule is intact. Teach: Iatrogenic instability is a recognised late failure of
   decompression. Check: avoid not recording a pars fracture, so later back pain and slip are not anticipated.
13_dural-repair.png [step.neuro.dural-repair]  Dural closure or repair: Close the dura primarily with a fine non-
   absorbable suture where the edges come together without tension. Use a graft (pericranium, fascia or a licensed
   substitute) where primary closure would compress the brain or narrow the theca. Only if a durotomy has occurred;
   repair, test with Valsalva, and tell the ward team the mobilisation plan. Teach: A watertight dura keeps
   cerebrospinal fluid in and infection out. Check: avoid forcing a tight primary closure over a swollen brain.
14_bailout.png [step.lam.bailout]  Bailout: uncontrolled epidural bleeding or an unrepairable dural tear: Stop biting
   bone. Ask the anaesthetist to check the abdomen is free, the blood pressure is not high and the patient is not
   coughing against the tube. Pack with haemostatic material and cottonoids, wait, then work from normal dura towards
   the bleeding. Teach: Epidural bleeding obscures the dura and roots, and blind bites in a bloody field create dural
   tears. Check: avoid biting blindly in a pool of blood.
15_haemostasis.png [step.core.haemostasis]  Common. Bipolar on the epidural veins and haemostatic material in the
   lateral gutters; ask for normotension before inspecting.
16_counts.png [step.core.counts]  Common. Count the cottonoids as well as swabs.
17_spine-closure.png [step.neuro.spine-closure]  Layered closure of the posterior spinal wound: Irrigate the wound.
   Look one final time at the dura for a leak, and ask for a Valsalva manoeuvre if a tear was repaired. Decide on a
   drain: helpful over a large decompression or fusion, avoided or left to free drainage (no suction) after a durotomy
   repair per surgeon preference. Record the decision. Teach: The deep fascia is the barrier against CSF fistula and
   deep infection. Check: avoid a loose fascial closure over a durotomy, leading to a CSF fistula.
18_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Post-operative neurological observation plan: Write the post-
   operative GCS, pupils and limb power (or lower-limb and sphincter function after spinal surgery) as a baseline.
   Prescribe the frequency of neurological observations and a specific trigger: a fall in GCS, a new pupil change, new
   weakness or new retention. Leg power, saddle sensation and bladder function in the baseline and the trigger. Teach:
   Post-operative haematoma and swelling present as a change in neurological observations, often hours after surgery.
   Check: avoid writing 'routine neuro obs' without a baseline or a trigger.
19_debrief.png [step.core.debrief]  Common. Record the levels decompressed, the extent of facet removal, and any
   durotomy.

C. POSTERIOR LUMBAR INSTRUMENTED FUSION (TLIF)  (folder posterior-lumbar-fusion-tlif/)
01_consent-check.png [step.core.consent-check]  Common. Be explicit that fusion is for leg symptoms and instability,
   and that relief of back pain is not assured.
02_preop-check.png [step.neuro.preop-check]  Neurological baseline, side and coagulation check: Record GCS by
   component and pupil size and reaction immediately before anaesthesia, with the time. Put the most recent scan up in
   theatre. Read the side (or spinal level) aloud from the images with the team, and match it to the consent and the
   skin mark. Read the level and the side of the TLIF from the MRI aloud; record leg power and the Oswestry score.
   Teach: In neurosurgery the side and the level are read off a scan, not seen on the skin, and the patient often
   cannot confirm them. Check: avoid operating on the side written on the request form rather than the side shown on
   the scan.
03_timeout.png [step.core.timeout]  Common. State the levels, the side for the interbody approach, blood availability,
   cell salvage and monitoring.
04_prophylaxis.png [step.core.prophylaxis]  Common. Redose the antibiotic for a long operation or heavy blood loss.
05_prone-position.png [step.neuro.prone-position]  Prone positioning on a spinal frame: Log-roll from the trolley with
   the anaesthetist controlling the head and airway; check the tube and lines after turning. Use a frame or bolsters
   that leave the abdomen hanging free. Hips extended on the frame to keep lordosis; the segment is fused in the
   position it lies in. Teach: The prone position decides blood loss, lordosis and the risk of blindness. Check: avoid
   compressing the abdomen, then fighting epidural bleeding for the rest of the case.
06_ionm.png [step.neuro.ionm]  Neurophysiological monitoring baseline and alarm plan: Agree the modalities with the
   neurophysiologist: motor evoked potentials, somatosensory evoked potentials, free-running and triggered EMG, as
   suited to the operation. Agree the anaesthetic with the anaesthetist, usually total intravenous anaesthesia with
   neuromuscular blockade avoided or reversed when motor potentials are needed. Triggered EMG for screws and free-
   running EMG for the TLIF corridor, if monitoring is used. Teach: Monitoring is only useful if a baseline was
   obtained before the at-risk step, the anaesthetic allows the signals to be read, and the team has agreed in advance
   what will happen when the signal changes. Check: avoid no baseline, so a poor signal cannot be interpreted.
07_spine-level.png [step.neuro.spine-level]  Radiographic level confirmation before incision and before bone removal:
   Before incision, place a marker on the skin or a spinal needle and take a lateral image. Count from a fixed
   reference: the sacrum in the lumbar spine, and the C2 vertebra or a visible landmark in the cervical spine. Compare
   the count with the MRI and any whole-spine image, looking for transitional or extra lumbar vertebrae, or rib
   anomalies. Count from the sacrum; confirm the level again with markers in the pedicles. Teach: Wrong-level spine
   surgery is one of the commonest serious errors in the specialty. Check: avoid relying on palpation of spinous
   processes or the iliac crest line.
08_prep-drape.png [step.core.prep-drape]  Common.
09_posterior-exposure.png [step.neuro.posterior-exposure]  Posterior midline exposure of the lumbar spine: Incise in
   the midline over the confirmed levels, and divide the thoracolumbar fascia just off the spinous processes. Strip
   the paraspinal muscles subperiosteally off the spinous processes and laminae with a Cobb elevator and diathermy,
   packing as you go. Expose to the tips of the transverse processes at the fused levels only, preserving the facet
   capsule above. Teach: A clean subperiosteal exposure keeps blood loss low and gives a clear view of the bony
   landmarks that guide decompression and screw entry. Check: avoid plunging an instrument through the interlaminar
   space, especially in a revision.
10_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Confirm screw diameters and lengths from the CT measurements before opening. Teach: The wrong size, side or type
   cannot be undone after insertion, and an implant that is not registered cannot be traced if it is recalled. Check:
   avoid opening an implant before the measurement is confirmed.
11_pedicle-screws.png [step.tlif.pedicle-screws]  Pedicle screw insertion: Identify the entry point at the junction of
   the transverse process and the lateral superior articular process, and decorticate it with a burr. Advance the
   pedicle probe with gentle, steady pressure along the planned convergence and the angle of the endplate, without
   forcing it; a sudden give suggests a breach. Teach: The pedicle is a narrow bony tube with a nerve root on its
   medial and inferior sides. Check: avoid forcing the probe when it meets resistance.
12_central-decompression.png [step.neuro.central-decompression]  Central laminectomy and decompression of the thecal
   sac: Remove the spinous process and lamina of the stenotic level with rongeurs and a burr, thinning the lamina
   before removing it. Detach the ligamentum flavum from the undersurface of the lamina with a curette, and remove it
   in pieces with Kerrison rongeurs, keeping the footplate between the ligament and the dura. Decompress as the
   stenosis requires; the TLIF side is decompressed through the facetectomy. Teach: Stenosis is narrowing by bone,
   hypertrophied ligamentum flavum and disc. Check: avoid using a Kerrison under the lamina where the dura is adherent
   to the ligament, tearing the dura.
13_facetectomy.png [step.tlif.facetectomy]  Unilateral facetectomy and opening Kambin triangle: On the side of the
   worse leg symptoms, osteotomise the inferior articular process of the upper vertebra and remove it; keep it as
   autograft. Remove the superior articular process of the lower vertebra flush with the pedicle below. Teach: A full
   facetectomy creates the corridor for the cage without having to retract the dura or the traversing root. Check:
   avoid working too high in the foramen and injuring the exiting root or its dorsal root ganglion.
14_discectomy-endplate.png [step.neuro.discectomy-endplate]  Complete discectomy and endplate preparation for
   interbody fusion: Incise the annulus with a scalpel in a window sized to the cage, and remove nucleus with
   pituitary rongeurs. Use curettes and shavers to strip cartilage from both endplates while preserving the bony
   endplate. Through Kambin triangle, without retracting the dura beyond the medial edge of the pedicle. Teach: An
   interbody fusion fuses bone to bone through the disc space. Check: avoid breaching the endplate with an aggressive
   curette, causing subsidence.
15_interbody-cage.png [step.neuro.interbody-cage]  Sizing and inserting the interbody cage or graft: Trial sizes
   sequentially under imaging. Choose the size that sits snug without forcing, and match the lordosis to the segment.
   Pack the cage with autograft or the agreed graft material, and place graft in the disc space ahead of it as
   appropriate. Distract on the opposite screws, insert the cage obliquely or across the midline, then release
   distraction. Teach: The cage restores disc height and indirectly decompresses the foramen, then carries the graft
   that will fuse. Check: avoid over-distraction that causes a new root deficit.
16_rods.png [step.tlif.rods]  Rods, compression and posterolateral graft: Decorticate the transverse processes and
   facet remnants on the side without the TLIF, and lay autograft or graft material for a posterolateral fusion if
   planned. Cut and contour the rods to the lordosis wanted; seat them in the screw heads without forcing a screw to
   pull out of its pedicle. Teach: Rods connect the screws into a construct. Check: avoid forcing a misaligned rod
   into a screw head.
17_ionm-alert.png [step.neuro.ionm-alert]  Bailout: responding to a monitoring alert or new neurological concern: Stop
   the surgical manoeuvre and announce the pause. Ask what was done just before the change. Anaesthesia: raise mean
   arterial pressure towards or above baseline per local protocol, correct anaemia and hypothermia, check anaesthetic
   depth and that no relaxant has been given. After a cage or a screw: check the implant first. Teach: A significant
   drop in evoked potentials signals possible cord or root injury that is often reversible if acted on within minutes.
   Check: avoid carrying on with the operation while the alarm is investigated.
18_haemostasis.png [step.core.haemostasis]  Common.
19_counts.png [step.core.counts]  Common.
20_spine-closure.png [step.neuro.spine-closure]  Layered closure of the posterior spinal wound: Irrigate the wound.
   Look one final time at the dura for a leak, and ask for a Valsalva manoeuvre if a tear was repaired. Decide on a
   drain: helpful over a large decompression or fusion, avoided or left to free drainage (no suction) after a durotomy
   repair per surgeon preference. Record the decision. Teach: The deep fascia is the barrier against CSF fistula and
   deep infection. Check: avoid a loose fascial closure over a durotomy, leading to a CSF fistula.
21_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Post-operative neurological observation plan: Write the post-
   operative GCS, pupils and limb power (or lower-limb and sphincter function after spinal surgery) as a baseline.
   Prescribe the frequency of neurological observations and a specific trigger: a fall in GCS, a new pupil change, new
   weakness or new retention. Root-by-root leg power and sensation, with new radicular pain as a trigger for imaging.
   Teach: Post-operative haematoma and swelling present as a change in neurological observations, often hours after
   surgery. Check: avoid writing 'routine neuro obs' without a baseline or a trigger.
22_debrief.png [step.core.debrief]  Common. Record screw and cage details, the side of the TLIF, monitoring events and
   the images saved.

D. VATS BULLECTOMY WITH PLEURODESIS  (folder vats-bullectomy-pleurodesis/)
01_consent-check.png [step.core.consent-check]  Common. Confirm and mark the side against the radiographs. Include
   conversion to thoracotomy, recurrence and chronic pain.
02_timeout.png [step.core.timeout]  Common. State that a drain is in place if a pneumothorax is present, and the lung
   isolation plan.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_lung-isolation.png [step.vats.lung-isolation]  Lung isolation and one-lung ventilation: Ensure an intercostal drain
   is in place if a pneumothorax is present before positive-pressure ventilation begins. Agree with the anaesthetist
   on a double-lumen tube or bronchial blocker; position is confirmed by fibreoptic bronchoscopy. Teach: Thoracoscopy
   needs a collapsed lung to see and to work. Check: avoid starting the operation with partial lung collapse and
   hoping it improves.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Prepare widely enough for a thoracotomy and for drain sites, from
   the spine to the sternum.
07_ports.png [step.vats.ports]  Port placement: Place the camera port in a lower intercostal space in the mid-axillary
   line, entering by blunt dissection over the upper border of the rib and confirming with a finger that the lung is
   free. Under vision, place working ports to triangulate on the apex, or use a single utility incision for a
   uniportal approach. Teach: The first port enters a chest that may contain adherent lung, and a low port can enter
   the abdomen. Check: avoid a sharp trocar pushed blindly through the chest wall.
08_inspection.png [step.vats.inspection]  Systematic inspection and finding the leak: Inspect the apex of the upper
   lobe, the apex of the lower lobe, the fissures and the mediastinal and diaphragmatic surfaces in a fixed order.
   Divide adhesions under vision, sealing vascular ones, to free the apex. Teach: Recurrence after surgery often comes
   from a bleb that was never found. Check: avoid stopping at the first bulla found.
09_bullectomy.png [step.vats.bullectomy]  Stapled bullectomy: Grasp the bulla gently, or the lung just beyond it, and
   position the stapler across normal lung proximal to the bulla. Choose a staple load suitable for the lung
   thickness; use buttress material if the lung is thin and the unit uses it. Teach: Removing the diseased apical lung
   removes the source of the leak. Check: avoid firing through the bulla.
10_pleurodesis.png [step.vats.pleurodesis]  Pleurodesis: pleural abrasion or apical pleurectomy: For mechanical
   abrasion, rub the parietal pleura with an abrasion pad until it bleeds lightly, over the upper chest wall and apex.
   For apical pleurectomy, raise a flap of parietal pleura along a line through the intercostal spaces and strip it
   from the upper chest wall, staying clear of the apex vessels. Teach: Bullectomy alone leaves a significant
   recurrence rate. Check: avoid stripping or abrading over the apex dome and the sympathetic chain.
11_leak-test.png [step.vats.leak-test]  Leak test and re-expansion under vision: Fill the chest with warm saline over
   the staple lines and ask the anaesthetist to ventilate the lung gently at a sustained pressure. Look for bubbles
   from the staple line and the lung surface, and repair significant leaks with staples or sutures. Teach: An air leak
   found now can be stapled or sutured in a minute; found after closure it becomes days of drainage or a return to
   theatre. Check: avoid over-inflating fragile lung during the test and causing a new leak.
12_conversion.png [step.vats.conversion]  Conversion to thoracotomy: Convert for uncontrolled bleeding, dense
   adhesions that cannot be divided safely, failure of lung isolation, or a finding that needs a larger resection. For
   major bleeding, apply direct pressure with a sponge stick through a port, tell the anaesthetist, call for senior
   help and blood, and open through a lateral or anterior thoracotomy incorporating a port. Teach: Conversion is not
   failure. Check: avoid persisting thoracoscopically with a poor view and rising blood loss.
13_haemostasis.png [step.core.haemostasis]  Common. Inspect the staple line, port sites, adhesion beds and any
   pleurectomy bed under the camera as the lung re-expands.
14_chest-drains.png [step.thor.chest-drains]  Placing mediastinal and pleural drains: Place drains where fluid and air
   will collect: an apical and, when needed, a basal pleural drain after lung surgery; mediastinal and any opened
   pleural space after a sternotomy. Bring each drain out through a separate stab incision under direct vision,
   passing over the upper border of the rib so that the intercostal bundle is spared, and away from the sternal wound.
   An apical drain through a port site, positioned under vision; a second basal drain if there was bleeding or the
   space is large. Teach: A drain that is kinked, blocked or wrongly placed gives false reassurance while blood or air
   collects, and retained blood after cardiac or thoracic surgery causes tamponade, a trapped lung and empyema. Check:
   avoid a drain lying against a graft or across the heart.
15_counts.png [step.core.counts]  Common.
16_specimen.png [step.core.specimen]  Common. Send the resected lung for histology; occasionally it shows an
   unexpected diagnosis.
17_skin-closure.png [step.core.skin-closure]  Common. Close muscle and skin at port sites in layers around the drain.
18_debrief.png [step.core.debrief]  Common. Record bullae found and resected, the pleurodesis method and its extent,
   the leak test, drains and suction plan.

E. MEDIAN STERNOTOMY AND CLOSURE  (folder median-sternotomy/)
01_consent-check.png [step.core.consent-check]  Common. Include sternal infection, dehiscence and, in a redo, injury
   at re-entry.
02_timeout.png [step.core.timeout]  Common. State whether this is a redo, what lies behind the sternum on CT, and the
   plan for peripheral cannulation.
03_prophylaxis.png [step.core.prophylaxis]  Common. Timed prophylaxis per cardiac unit protocol with redosing for long
   cases and bypass; glycaemic control is part of sternal infection prevention.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Chin to knees and both legs or arms if conduit may be needed; groins
   prepared for cannulation.
06_landmarks.png [step.st.landmarks]  Marking the midline: Palpate the sternal notch and the xiphoid, and the
   intercostal spaces on both sides along the body of the sternum. Mark the midline of the bone and keep the skin
   incision short of the notch where possible, for cosmesis and to reduce wound problems. Teach: Skin landmarks are
   misleading in obese patients and those with asymmetric chests. Check: avoid following the skin midline when the
   sternum is rotated or the breasts pull the skin sideways.
07_sternotomy-open.png [step.thor.sternotomy-open]  Opening the sternum in the midline: Mark the midline from the
   sternal notch to the xiphoid, palpating the intercostal spaces on both sides; incise skin and divide the presternal
   tissue and periosteum exactly on the mark with diathermy. Clear the space behind the manubrium by dividing the
   interclavicular ligament and sweeping a finger behind the notch, and free the xiphoid so that the retrosternal
   plane is open at both ends. Teach: A sternotomy that wanders off the midline produces a weak, asymmetric closure
   and is the commonest technical root of sternal dehiscence. Check: avoid a paramedian cut that splits into the
   costal cartilages.
08_redo-entry.png [step.st.redo-entry]  Re-entry in a previously opened chest: Review the CT for structures adherent
   to the sternum before starting; prepare or cannulate peripheral vessels first when the risk is high. Remove the old
   wires (or cut them and leave them in place as a guard until the saw has passed), and divide the anterior table with
   an oscillating saw. Teach: In a redo the right ventricle, aorta and patent grafts may be stuck to the back of the
   sternum, and injury at re-entry is a major cause of death in re-operative cardiac surgery. Check: avoid using the
   standard sternal saw for re-entry.
09_pericardium-open.png [step.thor.pericardium-open]  Spreading the sternum and opening the pericardium: Secure
   haemostasis of the periosteum and marrow edges with diathermy and minimal bone wax, then open the retractor slowly
   and only as far as the operation needs, placed low on the sternum. Divide the thymic remnant between ties or clips,
   staying clear of the innominate vein and its thymic branches. Teach: Gradual retraction avoids rib fractures and
   brachial plexus stretch, and a controlled pericardiotomy exposes the heart without injuring the innominate vein,
   the phrenic nerves or the heart itself. Check: avoid opening the retractor fully and quickly, fracturing the first
   rib and stretching the brachial plexus.
10_heparin-reversal.png [step.vasc.heparin-reversal]  Deciding on, and giving, heparin reversal: Decide with the
   anaesthetist whether to reverse, the dose per local protocol, and the timing, once flow is restored and the repair
   is satisfactory. In cardiac surgery give protamine only after separation from bypass and venous decannulation, and
   tell the perfusionist so that the pump suckers are switched off before it starts. At the end of the cardiac
   procedure, after separation from bypass and decannulation. Teach: Protamine reduces wound and mediastinal bleeding,
   but it can cause severe hypotension, pulmonary hypertension or anaphylaxis, and given at the wrong moment it clots
   the repair or the bypass circuit. Check: avoid protamine running while the cardiotomy suckers are still returning
   blood to the circuit.
11_haemostasis.png [step.core.haemostasis]  Common. Check the sternal edges, periosteum, mammary bed, thymic remnant,
   cannulation sites and pericardial edges in order.
12_pacing-wires.png [step.thor.pacing-wires]  Temporary epicardial pacing wires: Decide with the anaesthetist which
   wires are needed (ventricular, atrial, or both) from the rhythm on and off bypass and the operation done. Place the
   wires superficially in the epicardium away from coronary arteries and grafts, and bring them out through the skin
   below the incision on the agreed sides. Teach: Conduction and rhythm disturbances are common after cardiac surgery,
   and a wire placed now is far safer than an emergency transvenous wire later. Check: avoid wires placed through a
   coronary artery or a graft.
13_chest-drains.png [step.thor.chest-drains]  Placing mediastinal and pleural drains: Place drains where fluid and air
   will collect: an apical and, when needed, a basal pleural drain after lung surgery; mediastinal and any opened
   pleural space after a sternotomy. Bring each drain out through a separate stab incision under direct vision,
   passing over the upper border of the rib so that the intercostal bundle is spared, and away from the sternal wound.
   Teach: A drain that is kinked, blocked or wrongly placed gives false reassurance while blood or air collects, and
   retained blood after cardiac or thoracic surgery causes tamponade, a trapped lung and empyema. Check: avoid a drain
   lying against a graft or across the heart.
14_counts.png [step.core.counts]  Common. Before the sternum is closed: the mediastinum and any opened pleura are
   cavities.
15_open-chest.png [step.st.open-chest]  Delayed sternal closure when the chest will not close safely: Consider leaving
   the sternum open when approximation causes hypotension, rising filling pressures or arrhythmia, or when diffuse
   bleeding needs packing. Cover the open sternum with a sealed membrane or dressing per unit protocol, with drains in
   place, and keep the patient sedated and ventilated. Teach: Closing the sternum over a swollen heart or ongoing
   coagulopathic bleeding can cause tamponade physiology and haemodynamic collapse. Check: avoid forcing closure
   because an open chest feels like failure.
16_sternal-closure.png [step.thor.sternal-closure]  Sternal closure with wires: Before closure, confirm haemostasis of
   the sternal edges, the internal mammary beds and the wire sites, and that the counts are correct. Pass stainless
   steel wires through the manubrium and around the body of the sternum in the intercostal spaces, close to the
   sternal edge, keeping clear of the internal mammary vessels and any arterial graft pedicle. Teach: Sternal
   instability leads to dehiscence and deep sternal wound infection, which carry substantial mortality. Check: avoid
   wires placed through the bone too near the edge, which cut out when the patient coughs.
17_skin-closure.png [step.core.skin-closure]  Common. Close presternal fascia and subcutaneous tissue in layers over
   the wires, then skin; a sealed dressing.
18_debrief.png [step.core.debrief]  Common. Record the closure method and wire count, drains and pacing wires, and any
   concern about bleeding or sternal quality.
19_emergency-resternotomy.png [step.thor.emergency-resternotomy]  Emergency re-sternotomy for arrest or tamponade:
   Recognise the setting: sudden hypotension, rising filling pressures, falling or abruptly stopped drain output, or
   arrest within the first days after surgery. Call the cardiac surgeon and the team immediately. Follow the cardiac
   surgery resuscitation protocol: for a shockable rhythm, early defibrillation; for asystole or severe bradycardia,
   pace through the epicardial wires; start compressions only if these do not restore output quickly. Taught here
   because it is part of every sternotomy's after-care: the whole team must know where the set is and who opens.
   Teach: After cardiac surgery, cardiac arrest is often caused by tamponade or bleeding that only opening the chest
   can fix, and external compressions can damage grafts and valves. Check: avoid prolonged external compressions while
   the cause is a tamponade that only re-sternotomy will relieve.

QUALITY CHECK (for EVERY image, at FULL SIZE, before moving to the next)
- Correct side and the orientation rule followed?
- Same patient as the other images of that operation?
- Every hand, arm and head attached to a body?
- Anatomy, instrument, incision and position correct for this step? Every PRECISE FACT that applies drawn exactly?
- The teaching point is the first thing the eye lands on?
- Zero text, numbers, labels, logos or watermarks, including boxes, printouts and screens?
If any answer is no, regenerate that image before continuing.

DELIVERY
Make one zip file per operation, each containing a FOLDER with the operation's folder name and the PNGs inside it,
named exactly as above:
  surgx-acdf-steps.zip   (folder acdf/)
  surgx-lumbar-laminectomy-stenosis-steps.zip   (folder lumbar-laminectomy-stenosis/)
  surgx-posterior-lumbar-fusion-tlif-steps.zip   (folder posterior-lumbar-fusion-tlif/)
  surgx-vats-bullectomy-pleurodesis-steps.zip   (folder vats-bullectomy-pleurodesis/)
  surgx-median-sternotomy-steps.zip   (folder median-sternotomy/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
