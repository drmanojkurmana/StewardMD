---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 9b (urology: robotic, laparoscopic and open cancer and reconstruction): Gemini image prompt (115 images, 5 operations)

Built 2026-11-21 by `make9.py` from the real steps in `surgx/procedures/<id>.json`. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant urologists (endourology, uro-oncology and reconstructive urology). You are making 115 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Laparoscopic or robotic pyeloplasty (LEFT kidney)              20 images
  B. Robotic partial nephrectomy (RIGHT kidney tumour)              23 images
  C. Robotic radical prostatectomy                                  25 images
  D. Radical cystectomy with ileal conduit                          24 images
  E. Radical nephroureterectomy with bladder cuff (LEFT side)       23 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (EAU Guidelines (urolithiasis, prostate, bladder, upper tract, kidney cancer, male LUTS, urethral strictures), NICE NG131, AUA vasectomy guideline, BAUS procedure information).
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
- Viewpoint: the endoscope monitor view for cystoscopic, urethral and laser steps (round endoscopic image, the scope tip and the instrument entering from the bottom or side); the robot or laparoscope monitor view for robotic steps; the surgeon's view of the field for open, perineal and scrotal steps; an ultrasound screen as grey abstract shapes for the biopsy; a clean cut-away inset when the trainee must see a layer or the inside of an organ; a whole-body view for positioning; a theatre view for team and safety steps.
- The key structure is where the eye lands first: sharp and well lit, the background slightly softened. A subtle glow
  or outline on the key structure is fine. A small circular close-up or cross-section inset is allowed when the key
  detail is tiny or lies deep or inside an organ.
- Instruments correct in size and position, entering through the correct incision.
- Orientation and laterality: state the side in every image. Pyeloplasty on the LEFT kidney; partial nephrectomy on a RIGHT renal tumour; nephroureterectomy on the LEFT side; the buccal graft taken from the RIGHT cheek. In endoscopic views the bladder's 12 o'clock (anterior, the air bubble) is at the TOP of the round image. Open views have the patient's head at the TOP of the frame unless the step needs otherwise. Never flip a side between images of the same operation.
- BODIES MUST BE WHOLE AND CONNECTED. Every hand belongs to an arm that runs to a shoulder of a visible body. The same
  patient keeps the same face, age and hair in every image of an operation; never swap the patient.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal. Fat yellow ONLY where real fat is; arteries thick-walled and red,
  veins thinner and blue-purple; the ureter a pale, thin, peristaltic tube; burnt eschar leathery grey-brown or white;
  pericardium a glistening white-grey sac; valve leaflets thin, white and calcified when stenotic.
- Patients covered and dignified; only the operative field exposed.

PRECISE FACTS (draw exactly this)
Positioning (a NEW whole-body view for each operation; never reuse a generic theatre scene):
- A. RIGHT side down, LEFT flank up at about 45 to 60 degrees, padded, strapped, table flexed slightly.
- B. LEFT side down, RIGHT flank up at about 60 degrees, padded, strapped, table flexed.
- C. Lithotomy in STEEP head-down tilt (about 25 to 30 degrees), arms tucked and padded at the sides, the patient
  secured against sliding, eyes taped; the robot docked between the legs or from the side.
- D. Supine with the table broken at the pelvis and slight head-down tilt, arms out on boards; a stoma site marked in
  the RIGHT lower abdomen.
- E. RIGHT side down, LEFT flank up, padded and strapped.
Step-specific facts:
- A. The renal pelvis bulging above a narrow pelviureteric junction, a lower pole artery crossing in front; the
  narrow segment cut out, the ureter opened (spatulated) on its outer side and brought IN FRONT of the vessel; a fine
  running suture joining it to the lowest point of the pelvis over a double-J stent.
- B. Robotic view: bulldog clamps on the renal artery; an intraoperative ultrasound probe on the kidney; a scored line
  a few mm around a round tumour bulging from the kidney; the tumour cut out with a thin rim of normal kidney; a
  two-layer closure with sliding clips; a running timer drawn as a simple clock with no numbers.
- C. Robotic view: the bladder dropped from the abdominal wall; the bladder neck opened with the catheter lifted; the
  seminal vesicles held up; the neurovascular bundles left on the rectum side with clips, no diathermy; the urethra cut
  at the apex; a barbed running suture joining bladder neck to urethra.
- D. A midline laparotomy; the ureters divided low and clipped; the bladder (with prostate in a man) removed intact; a
  15 to 20 cm segment of ileum isolated with its mesentery, the bowel rejoined above it; the two ureters joined to the
  conduit over thin stents that exit through a spouted stoma in the right lower abdomen.
- E. A clip across the ureter BELOW the tumour early; the artery stapled before the vein; the kidney freed outside its
  fat envelope; the ureter followed down into the bladder and a cuff of bladder excised around its opening; the bladder
  closed in two layers; kidney, ureter and cuff in ONE bag.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 115 images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern operative surgery atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs; neutral clean background.
- Within each operation the same adult patient, the same team and the same instrument set in every image. Staff in
  caps and masks, generic faces, no real or identifiable person.
- Landscape 4:3, exactly 1600 x 1200 px, PNG.

THE STEPS  (filename [step id]  scene : teaching point : check)
Each line quotes what that step does in the app. Draw the ONE moment that shows it best. Where a step is a check,
a decision or a bailout (urine check, laser safety, clamp timer, leak test, rectal injury, morcellator injury), draw the
people and the thing being checked or the complication being handled, for example the nurse showing a blank culture
report to the surgeon, or the bladder filled with saline and the surgeon watching the anastomosis for a leak. Use the PRECISE FACTS above wherever they apply.

COMMON SAFETY STEPS (draw them for each operation with that operation's patient, team and setting)
- consent-check: pre-op bay, the awake patient, the surgeon marking an arrow on the operative SIDE where the
  operation has a side. Teach: confirm
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

A. LAPAROSCOPIC OR ROBOTIC PYELOPLASTY (LEFT KIDNEY)  (folder uro-pyeloplasty/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_urine-check.png [step.uro.urine-check]  Sterile urine before instrumentation: Check the most recent urine culture
   and that any infection has been treated with a sensitive antibiotic. Ask about fever, rigors or new symptoms today;
   a febrile patient with an obstructed system is drained (stent or nephrostomy) and the definitive operation waits.
   Teach: Instrumenting infected urine can cause urosepsis within hours. Check: avoid proceeding on an old or missing
   culture.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
08_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
09_robot-dock.png [step.uro.robot-dock]  Robot docking and instrument check: Confirm the final table position before
   docking; check the face, eyes, arms and legs are padded and nothing rests on the patient. Dock the arms to the
   ports with the remote centre at the abdominal wall, and insert every instrument under direct camera vision. For the
   robotic approach; otherwise go straight to the survey. Teach: The patient cannot be moved once the robot is docked,
   and steep positions load the face, shoulders and legs. Check: avoid moving the table after docking.
10_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Teach: The first look answers a question the imaging could
   not, and it is the only chance to find the second diagnosis before attention narrows to the first. Check: avoid
   going straight to the target and missing a second pathology.
11_expose.png [step.pyelo.expose]  Expose the pelvis, junction and any crossing vessel: Reflect the colon (or go
   through the mesocolon on the left in thin patients) to the renal pelvis. Find the ureter below and follow it up to
   the junction, keeping its adventitia. Teach: Seeing the whole junction and its relation to a lower pole vessel
   decides the repair. Check: avoid stripping the ureter of its blood supply.
12_divide.png [step.pyelo.divide]  Dismember and spatulate: Divide the ureter just below the junction and excise the
   narrow segment with excess pelvis if redundant. Spatulate the ureter on its lateral side for about 1.5 to 2 cm.
   Teach: Removing the narrow segment and opening the ureter along its side makes a wide, funnel-shaped join. Check:
   avoid spatulating on the wrong side and twisting the ureter.
13_dj-stent.png [step.uro.dj-stent]  Double-J stent placement and position check: Choose the stent diameter and length
   for the patient and the ureter; the length can be estimated from height or measured with a graduated ureteric
   catheter. Pass the stent over the guidewire with the pusher, watching the proximal end reach the renal pelvis on
   fluoroscopy and the distal end at the orifice through the cystoscope. Pass the double-J antegrade over a wire after
   the back wall is sewn, checking the lower curl lies in the bladder. Teach: A stent drains an obstructed or injured
   ureter, but a stent in the wrong place either drains nothing or causes pain, haematuria and migration. Check: avoid
   pulling the wire out before the proximal coil is seen in the pelvis, leaving the stent in the mid-ureter.
14_anastomosis.png [step.pyelo.anastomosis]  Pelvi-ureteric anastomosis: Place the first stitch from the tip of the
   spatulation to the lowest point of the pelvis. Sew the back wall with fine absorbable running suture, place the
   stent, then the front wall. Teach: A watertight, tension-free and dependent anastomosis drains well and does not
   leak. Check: avoid a tight or twisted join.
15_haemostasis.png [step.core.haemostasis]  Common. Check the pelvis edges and the mesocolon window.
16_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. A drain near the anastomosis, not on it. Teach: A drain tells you what is
   happening in a space you cannot see. Check: avoid a drain placed 'just in case', which then becomes a route for
   infection.
17_stent-register.png [step.uro.stent-register]  Stent register and removal plan: Record stent type, diameter, length,
   side, string or no string, and the intended dwell time in the operative note. Enter the stent on the unit's stent
   register or tracking system and book the removal or exchange. Teach: A forgotten stent encrusts, obstructs and can
   cost the kidney. Check: avoid relying on the discharge letter to generate the removal appointment.
18_counts.png [step.core.counts]  Common.
19_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
20_debrief.png [step.core.debrief]  Common.

B. ROBOTIC PARTIAL NEPHRECTOMY (RIGHT KIDNEY TUMOUR)  (folder uro-partial-nephrectomy/)
01_consent-check.png [step.core.consent-check]  Common.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Imaging, complexity score and the plan for a solitary or normal kidney reviewed. Teach: A cancer operation
   is one part of a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note that
   predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
08_robot-dock.png [step.uro.robot-dock]  Robot docking and instrument check: Confirm the final table position before
   docking; check the face, eyes, arms and legs are padded and nothing rests on the patient. Dock the arms to the
   ports with the remote centre at the abdominal wall, and insert every instrument under direct camera vision. Teach:
   The patient cannot be moved once the robot is docked, and steep positions load the face, shoulders and legs. Check:
   avoid moving the table after docking.
09_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Teach: The first look answers a question the imaging could
   not, and it is the only chance to find the second diagnosis before attention narrows to the first. Check: avoid
   going straight to the target and missing a second pathology.
10_hilum.png [step.pn.hilum]  Expose and control the hilum: Reflect the colon, find the ureter and gonadal vein and
   follow them up to the hilum. Dissect the renal artery (and any accessory arteries) and the vein; place vessel
   loops. Teach: The artery must be controlled before the tumour is cut. Check: avoid missing an accessory artery.
11_ultrasound.png [step.pn.ultrasound]  Ultrasound and score the margin: Defat the kidney around the tumour, keeping
   the fat over the tumour. Scan with the intraoperative probe to see the tumour edge and depth. Teach: The tumour's
   deep edge is not visible. Check: avoid scoring too close and entering the tumour.
12_clamp.png [step.pn.clamp]  Clamp the artery and start the clock: Tell the anaesthetist; give mannitol if used
   locally. Place bulldog clamps on the artery (and accessory arteries); clamp the vein only if needed. Teach:
   Clamping makes the field bloodless. Check: avoid no timer.
13_excise.png [step.pn.excise]  Excise the tumour with a rim: Cut along the scored line with cold scissors, following
   the tumour's curve. Keep a thin layer of normal kidney on the tumour all round; open the collecting system if
   needed. Teach: A thin rim of normal kidney around the tumour gives a clear margin without wasting kidney. Check:
   avoid entering the tumour.
14_renorrhaphy.png [step.pn.renorrhaphy]  Two-layer renorrhaphy: Inner layer: running absorbable suture along the
   base, closing the collecting system and open vessels. Outer layer: interrupted or sliding-clip sutures across the
   defect, tightened without cutting through. Teach: The inner layer closes opened vessels and the collecting system;
   the outer layer brings the kidney edges together and stops bleeding. Check: avoid sutures that cut through the
   parenchyma.
15_unclamp.png [step.pn.unclamp]  Unclamp and record the warm time: Remove the bulldogs and call the warm ischaemia
   time aloud. Watch the kidney reperfuse and the renorrhaphy for bleeding; add sutures as needed. Teach: The kidney
   must pink up and stop bleeding. Check: avoid leaving a bulldog clamp on.
16_major-bleed.png [step.hpb.major-bleed]  Major haemorrhage: press, tell, call, then repair or pack: Put pressure on
   the bleeding: a finger, a swab on a stick or packs, and hold it. Do not clamp or clip into a pool of blood. Tell
   the anaesthetist clearly, ask for the major haemorrhage protocol to be activated if blood loss is heavy, and ask
   for a second experienced surgeon, a cell saver and vascular instruments. Hilar or parenchymal bleeding: press, tell
   the anaesthetist, add a port or convert; consider clamping again. Teach: In upper abdominal surgery the large veins
   (portal, superior mesenteric, splenic, hepatic and the cava) tear rather than cut, and clamping blindly makes a
   small hole large. Check: avoid blind clamping or deep suturing into a field of blood, which converts a bleed into a
   bile duct or pancreatic injury.
17_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Tumour in a bag, out intact. Teach: Bringing an infected or neoplastic specimen
   through the abdominal wall unprotected causes port-site infection and, in malignancy, port-site recurrence. Check:
   avoid a bag torn during extraction, spilling contents into the wound.
18_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Teach: Margin status and nodal yield are reported by the pathologist, but only from a
   specimen they can orient. Check: avoid a single suture with no stated convention.
19_haemostasis.png [step.core.haemostasis]  Common. With the pneumoperitoneum lowered, check the renorrhaphy and the
   hilum.
20_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. Teach: A drain tells you what is happening in a space you cannot see. Check:
   avoid a drain placed 'just in case', which then becomes a route for infection.
21_counts.png [step.core.counts]  Common.
22_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
23_debrief.png [step.core.debrief]  Common. Record warm ischaemia time, collecting system entry and repair, and
   margins seen.

C. ROBOTIC RADICAL PROSTATECTOMY  (folder uro-radical-prostatectomy/)
01_consent-check.png [step.core.consent-check]  Common. Continence, erections, margins and further treatment
   discussed.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Staging, nerve-sparing plan per side and node dissection decision confirmed. Teach: A cancer operation is
   one part of a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note that predates
   new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
08_robot-dock.png [step.uro.robot-dock]  Robot docking and instrument check: Confirm the final table position before
   docking; check the face, eyes, arms and legs are padded and nothing rests on the patient. Dock the arms to the
   ports with the remote centre at the abdominal wall, and insert every instrument under direct camera vision. Teach:
   The patient cannot be moved once the robot is docked, and steep positions load the face, shoulders and legs. Check:
   avoid moving the table after docking.
09_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Teach: The first look answers a question the imaging could
   not, and it is the only chance to find the second diagnosis before attention narrows to the first. Check: avoid
   going straight to the target and missing a second pathology.
10_bladder-drop.png [step.rp.bladder-drop]  Drop the bladder into the space of Retzius: Incise the peritoneum lateral
   to the medial umbilical ligaments and across above the bladder. Develop the avascular space of Retzius down to the
   pubic bone. Teach: Opening the space in front of the bladder exposes the front of the prostate and the endopelvic
   fascia. Check: avoid cutting into the bladder dome.
11_bladder-neck.png [step.rp.bladder-neck]  Bladder neck dissection: Find the junction by moving the catheter balloon
   and the change in fat. Open the anterior bladder neck, lift the catheter, then divide the posterior bladder neck.
   Teach: Finding the junction of bladder and prostate right preserves the bladder neck and keeps away from the
   ureteric orifices. Check: avoid cutting into the prostate (positive margin) or too far into the bladder.
12_seminal-vesicles.png [step.rp.seminal-vesicles]  Seminal vesicles and posterior plane: Divide the vasa and dissect
   the seminal vesicles, clipping their arteries rather than burning near the nerves. Lift the seminal vesicles and
   incise Denonvilliers' fascia. Teach: The vasa and seminal vesicles lead to the plane behind the prostate, in front
   of the rectum. Check: avoid thermal energy at the tip of the seminal vesicles near the nerves.
13_nerves.png [step.rp.nerves]  Pedicles and nerve sparing: Control the prostatic pedicles with clips close to the
   prostate, without diathermy. Release the neurovascular bundle off the prostate in the planned plane (intrafascial
   or interfascial) on each side. Teach: The neurovascular bundles run beside the prostate. Check: avoid diathermy on
   the bundles.
14_apex.png [step.rp.apex]  Dorsal venous complex and apex: Control the dorsal venous complex with a suture. Divide it
   and develop the apex, then cut the urethra sharply with cold scissors, keeping its length. Teach: The apex is where
   positive margins and incontinence are decided. Check: avoid cutting into the apex.
15_rectal-injury.png [step.rp.rectal-injury]  Bailout: rectal injury: If suspected, fill the pelvis with saline and
   insufflate air via the rectum; look for bubbles. Repair in two layers, interpose tissue where possible, and wash
   out. Teach: A rectal injury recognised now and repaired heals; one missed becomes a rectourethral fistula. Check:
   avoid not testing after a difficult posterior dissection.
16_nodal-clearance.png [step.onco.nodal-clearance]  En bloc nodal clearance by named level or station: Before
   starting, state which levels or stations are to be cleared, as agreed at the MDT, and which non-lymphatic
   structures are to be preserved. Define the boundary structures first (vessels, nerves, muscles), then sweep the
   fibrofatty tissue off them towards the specimen, keeping the packet in one piece. Extended pelvic node dissection
   when indicated: external iliac, obturator and internal iliac, protecting the obturator nerve. Teach: A
   lymphadenectomy stages the cancer and, in several cancers, controls regional disease. Check: avoid node picking
   instead of an en bloc clearance, which lowers yield and leaves disease behind.
17_anastomosis.png [step.rp.anastomosis]  Vesicourethral anastomosis: Optionally reconstruct the posterior layer
   (Rocco) to reduce tension. Join bladder neck to urethra with a running barbed or double-armed suture, mucosa to
   mucosa. Teach: A watertight, tension-free join of the bladder neck to the urethra lets the catheter come out on
   time and lowers stricture risk. Check: avoid catching the catheter in the stitch.
18_bladder-leak-test.png [step.uro.bladder-leak-test]  Bladder or anastomosis leak test: Fill the bladder through the
   catheter with about 150 to 200 ml of saline. Watch the suture line under the camera or directly for leaking fluid.
   Fill with about 150 ml and check the anastomosis. Teach: A leak found on the table is fixed with one stitch; a leak
   found on day three is a urinoma, ileus and a longer catheter. Check: avoid overfilling the bladder and disrupting a
   fresh anastomosis.
19_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Prostate in a bag, out intact. Teach: Bringing an infected or neoplastic specimen
   through the abdominal wall unprotected causes port-site infection and, in malignancy, port-site recurrence. Check:
   avoid a bag torn during extraction, spilling contents into the wound.
20_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Teach: Margin status and nodal yield are reported by the pathologist, but only from a
   specimen they can orient. Check: avoid a single suture with no stated convention.
21_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. Teach: A drain tells you what is happening in a space you cannot see. Check:
   avoid a drain placed 'just in case', which then becomes a route for infection.
22_catheter-plan.png [step.uro.catheter-plan]  Catheter secured and plan recorded: Secure the catheter to the thigh
   without tension; note the size, balloon volume and type. Write how long it stays and how it comes out (trial
   without catheter, or a contrast study first). Catheter for about 7 to 10 days; it must not be removed early. Teach:
   After urethral or bladder surgery the catheter splints the repair. Check: avoid an unsecured catheter pulled out in
   recovery.
23_counts.png [step.core.counts]  Common.
24_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
25_debrief.png [step.core.debrief]  Common.

D. RADICAL CYSTECTOMY WITH ILEAL CONDUIT  (folder uro-radical-cystectomy-ileal-conduit/)
01_consent-check.png [step.core.consent-check]  Common. Stoma, complications and long-term kidney and bowel effects
   discussed.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Staging, neoadjuvant chemotherapy and diversion choice confirmed. Teach: A cancer operation is one part of
   a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note that predates new imaging
   or a changed biopsy result.
03_stoma-siting.png [step.bowel.stoma-siting]  Pre-operative stoma siting: Mark the site before theatre whenever time
   allows, ideally with a stoma specialist nurse, for any operation in which a stoma is possible. Examine the patient
   lying, sitting and standing. Choose a flat area of at least the size of the appliance flange, within the rectus
   sheath, below the belt line and where the patient can see it. The conduit stoma sited in the right iliac fossa by
   the stoma nurse. Teach: Most stoma leaks, skin problems and appliance failures trace back to where the stoma was
   put. Check: avoid siting on the supine anaesthetised patient, where a deep crease becomes visible only when the
   patient sits up on day two.
04_timeout.png [step.core.timeout]  Common.
05_prophylaxis.png [step.core.prophylaxis]  Common.
06_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common.
08_midline.png [step.abd.midline]  Midline laparotomy incision: Incise through skin, fat and linea alba, staying in
   the midline: drifting off it bleeds and weakens the closure. Enter the peritoneum between forceps under direct
   vision, then extend with fingers protecting the bowel. Teach: The midline is fast, bloodless and extensible in both
   directions, which is exactly what an unknown pathology needs. Check: avoid entering blind through a scar.
09_exploration.png [step.abd.exploration]  Systematic exploration: Follow the same sequence every time: liver and
   gallbladder, stomach and duodenum, spleen, small bowel from duodenojejunal flexure to caecum, colon and rectum,
   pelvis, retroperitoneum, hernial orifices from inside. Run the small bowel hand over hand, both surfaces, in one
   direction. Teach: The purpose of a laparotomy is to find out. Check: avoid stopping the exploration when the
   expected pathology is found.
10_ureters.png [step.rc.ureters]  Find and divide the ureters: Find each ureter at the iliac bifurcation and follow it
   down to the bladder, keeping its adventitia. Clip and divide it close to the bladder; send the distal margin for
   frozen section if indicated. Teach: Long, healthy ureters with their blood supply are the basis of a good
   diversion; a cancerous margin must be found now. Check: avoid stripping the ureter.
11_nodal-clearance.png [step.onco.nodal-clearance]  En bloc nodal clearance by named level or station: Before
   starting, state which levels or stations are to be cleared, as agreed at the MDT, and which non-lymphatic
   structures are to be preserved. Define the boundary structures first (vessels, nerves, muscles), then sweep the
   fibrofatty tissue off them towards the specimen, keeping the packet in one piece. Pelvic lymph node dissection:
   external iliac, obturator and internal iliac, at least to the common iliac bifurcation. Teach: A lymphadenectomy
   stages the cancer and, in several cancers, controls regional disease. Check: avoid node picking instead of an en
   bloc clearance, which lowers yield and leaves disease behind.
12_pedicles.png [step.rc.pedicles]  Bladder pedicles and removal of the specimen: Divide the lateral pedicles with
   staplers, sealing device or ties, keeping away from the rectum. Develop the plane in front of the rectum, then
   control the dorsal venous complex and divide the urethra. Teach: Controlling the lateral and posterior pedicles
   lets the bladder come out with the prostate (men) or the uterus and anterior vaginal wall (women). Check: avoid
   entering the rectum.
13_major-vein-injury.png [step.onco.major-vein-injury]  Major vein injury during a nodal clearance: press, control,
   repair: Press directly on the bleeding point with a finger or a swab on a stick; tell the anaesthetist, and ask for
   head-down positioning in the neck to reduce the risk of air embolism. Call for senior help and suction, improve
   exposure, and get proximal and distal control with gentle pressure or vascular clamps placed under vision. Bleeding
   from the dorsal venous complex or iliac veins: press, tell, call. Teach: The axillary and internal jugular veins
   form the boundaries of the commonest nodal clearances. Check: avoid blind clamping or diathermy into a pool of
   blood, catching the adjacent nerve.
14_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Bladder (with prostate or uterus) intact, ureteric margins labelled. Teach: Margin status and
   nodal yield are reported by the pathologist, but only from a specimen they can orient. Check: avoid a single suture
   with no stated convention.
15_ileal-segment.png [step.rc.ileal-segment]  Isolate the ileal segment: Measure about 15 to 20 cm of ileum, starting
   at least 15 to 20 cm from the ileocaecal valve. Transilluminate the mesentery and divide it keeping the arcades to
   the segment. Teach: A 15 to 20 cm segment with good mesentery, taken away from the terminal ileum, makes a conduit
   that drains well. Check: avoid using the terminal ileum.
16_anastomosis-stapled.png [step.bowel.anastomosis-stapled]  Stapled side-to-side (functional end-to-end) anastomosis:
   Decide first whether an anastomosis is safe at all: haemodynamic instability, vasopressors, gross contamination,
   malnutrition and doubtful viability favour a stoma or a delayed anastomosis. Lay the two limbs side by side along
   their antimesenteric borders, make enterotomies at the corner, and fire a linear cutting stapler, keeping the
   mesentery clear. Restore ileal continuity above the conduit; close the mesenteric window. Teach: An anastomosis
   heals only if it is well perfused, tension-free and made between healthy ends. Check: avoid overlapping staple
   lines at the crotch without reinforcement.
17_uretero-ileal.png [step.rc.uretero-ileal]  Uretero-ileal anastomoses over stents: Spatulate each ureter and join it
   to the conduit end-to-side (Bricker) or to each other and the conduit end (Wallace). Pass a stent up each ureter
   into the kidney and out through the conduit. Teach: Tension-free, well-vascularised joins over stents give the
   fewest leaks and strictures. Check: avoid tension on the anastomosis.
18_stoma-mature.png [step.bowel.stoma-mature]  Maturing the stoma and checking viability: Mature only after the main
   wound is closed and covered, so faecal contamination does not reach it. Ileostomy: evert to a spout of roughly 2 to
   3 cm (Brooke technique) using three-point sutures through the bowel edge, the seromuscular layer at the skin level
   and the dermis. Mature the conduit as a spouted stoma at the marked site. Teach: Small bowel effluent is caustic.
   Check: avoid sutures through the dermal surface rather than the dermis, which leave mucosal implants on the skin.
19_stent-register.png [step.uro.stent-register]  Stent register and removal plan: Record stent type, diameter, length,
   side, string or no string, and the intended dwell time in the operative note. Enter the stent on the unit's stent
   register or tracking system and book the removal or exchange. Record both ureteric stents and their removal date.
   Teach: A forgotten stent encrusts, obstructs and can cost the kidney. Check: avoid relying on the discharge letter
   to generate the removal appointment.
20_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. Teach: A drain tells you what is happening in a space you cannot see. Check:
   avoid a drain placed 'just in case', which then becomes a route for infection.
21_counts.png [step.core.counts]  Common.
22_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Teach: Burst abdomen and incisional hernia are closure failures, and closure
   technique is one of the few variables entirely under the surgeon's control. Check: avoid large bites taken quickly
   at the end of a long case.
23_skin-closure.png [step.core.skin-closure]  Common.
24_debrief.png [step.core.debrief]  Common.

E. RADICAL NEPHROURETERECTOMY WITH BLADDER CUFF (LEFT SIDE)  (folder uro-nephroureterectomy/)
01_consent-check.png [step.core.consent-check]  Common.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Biopsy and cytology, cystoscopy, renal function and the chemotherapy plan confirmed. Teach: A cancer
   operation is one part of a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note
   that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
08_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
09_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Teach: The first look answers a question the imaging could
   not, and it is the only chance to find the second diagnosis before attention narrows to the first. Check: avoid
   going straight to the target and missing a second pathology.
10_tumour-handling.png [step.onco.tumour-handling]  Oncological handling: no touch, wound protection, clean field:
   Handle the tumour-bearing tissue as little as possible; retract the specimen by its normal edges, not by the
   tumour. Control the vascular pedicle early where the operation allows it, before the tumour is mobilised. No entry
   into the collecting system or ureter at any point. Teach: Tumour cells shed into the wound, the peritoneum or a
   port site produce a recurrence that no adjuvant therapy fully reverses. Check: avoid grasping the tumour with a
   toothed instrument to improve exposure.
11_clip-ureter.png [step.nu.clip-ureter]  Clip the ureter early: Find the ureter below the tumour early in the
   dissection. Place a clip across it without dividing it. Teach: Clipping below the tumour before handling the kidney
   stops tumour cells being pushed into the bladder. Check: avoid leaving the ureter open while the kidney is
   squeezed.
12_hilum.png [step.nu.hilum]  Control the renal hilum, artery before vein: Dissect the renal artery and vein at the
   hilum. Clip or staple the artery and divide it; then staple the vein. Teach: Securing the artery first stops the
   kidney swelling with blood when the vein is closed. Check: avoid dividing the vein before the artery.
13_kidney.png [step.nu.kidney]  Free the kidney outside Gerota's fascia: Free the kidney outside Gerota's fascia,
   taking the adrenal only if involved. Follow the ureter down to the bladder, keeping it intact. Teach: The kidney,
   perinephric fat and ureter come out as one oncological block. Check: avoid breaching Gerota's fascia over the
   tumour.
14_bladder-cuff.png [step.nu.bladder-cuff]  Excise the bladder cuff: Free the ureter down into the bladder wall,
   tenting it up. Excise a cuff of bladder around the orifice (extravesically, or opened under vision), keeping clear
   of the other orifice. Teach: The intramural ureter and its orifice can carry tumour. Check: avoid leaving the
   intramural ureter behind.
15_bladder-leak-test.png [step.uro.bladder-leak-test]  Bladder or anastomosis leak test: Fill the bladder through the
   catheter with about 150 to 200 ml of saline. Watch the suture line under the camera or directly for leaking fluid.
   Fill the bladder and check the cuff closure. Teach: A leak found on the table is fixed with one stitch; a leak
   found on day three is a urinoma, ileus and a longer catheter. Check: avoid overfilling the bladder and disrupting a
   fresh anastomosis.
16_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Kidney, ureter and cuff in one bag, out intact, no morcellation. Teach: Bringing an
   infected or neoplastic specimen through the abdominal wall unprotected causes port-site infection and, in
   malignancy, port-site recurrence. Check: avoid a bag torn during extraction, spilling contents into the wound.
17_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Teach: Margin status and nodal yield are reported by the pathologist, but only from a
   specimen they can orient. Check: avoid a single suture with no stated convention.
18_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. Teach: A drain tells you what is happening in a space you cannot see. Check:
   avoid a drain placed 'just in case', which then becomes a route for infection.
19_catheter-plan.png [step.uro.catheter-plan]  Catheter secured and plan recorded: Secure the catheter to the thigh
   without tension; note the size, balloon volume and type. Write how long it stays and how it comes out (trial
   without catheter, or a contrast study first). Catheter until the cuff closure heals; cystogram first if needed.
   Teach: After urethral or bladder surgery the catheter splints the repair. Check: avoid an unsecured catheter pulled
   out in recovery.
20_instillation.png [step.nu.instillation]  Single intravesical chemotherapy instillation: Check the bladder closure
   is watertight and there is no suspicion of leak. Give a single instillation (for example mitomycin C) per protocol,
   timed as the local guideline says. Teach: One dose of chemotherapy into the bladder after surgery reduces the
   chance of a bladder recurrence. Check: avoid instilling into a bladder that may leak.
21_counts.png [step.core.counts]  Common.
22_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
23_debrief.png [step.core.debrief]  Common.

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
  surgx-uro-pyeloplasty-steps.zip   (folder uro-pyeloplasty/)
  surgx-uro-partial-nephrectomy-steps.zip   (folder uro-partial-nephrectomy/)
  surgx-uro-radical-prostatectomy-steps.zip   (folder uro-radical-prostatectomy/)
  surgx-uro-radical-cystectomy-ileal-conduit-steps.zip   (folder uro-radical-cystectomy-ileal-conduit/)
  surgx-uro-nephroureterectomy-steps.zip   (folder uro-nephroureterectomy/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
