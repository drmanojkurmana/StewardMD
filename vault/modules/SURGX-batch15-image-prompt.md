---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 15 (Retrograde double-J ureteric stent insertion, Percutaneous nephrolithotomy, Radical nephrectomy, Hydrocele repair, Adult circumcision): Gemini image prompt (96 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant urologists. You are making 96 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Retrograde double-J ureteric stent insertion                   18 images
  B. Percutaneous nephrolithotomy (PCNL)                            22 images
  C. Radical nephrectomy (open and laparoscopic principles)         22 images
  D. Hydrocele repair (Jaboulay or Lord)                            17 images
  E. Adult circumcision                                             17 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Urological Association (AUA) and Endourological Society, Surgical Management of Stones: AUA/Endourological Society Guideline; American Urological Association (AUA), Renal Mass and Localized Renal Cancer: Evaluation, Management, and Follow-up: AUA Guideline; British Association of Urological Surgeons (BAUS), Circumcision in adults (patient information leaflet); British Association of Urological Surgeons (BAUS), Removal of a hydrocele (patient information leaflet); Elsevier, Campbell-Walsh-Wein Urology; European Association of Urology (EAU) and American Society of Clinical Oncology (ASCO), EAU-ASCO Guidelines on Penile Cancer; European Association of Urology (EAU), EAU Guidelines on Renal Cell Carcinoma; European Association of Urology (EAU), EAU Guidelines on Testicular Cancer; European Association of Urology (EAU), EAU Guidelines on Urolithiasis; European Association of Urology (EAU), EAU Guidelines on Urological Infections; National Institute for Health and Care Excellence (NICE), Renal and ureteric stones: assessment and management (NG118); World Health Organization (WHO), Manual for male circumcision under local anaesthesia and HIV prevention services for adolescent boys and men).
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
- A. Lithotomy with padded supports; a flexible cystoscope in the supine patient is an alternative in some units.
  C-arm able to screen from bladder to kidney before draping.
- B. Lithotomy first for cystoscopy and ureteric catheter placement, unless a supine position allows simultaneous
  retrograde access.
- C. Laparoscopic transperitoneal: modified flank (45 to 60 degrees), operated side up, kidney rest or bridge raised
  under the flank, table flexed, with the arms supported and the axilla protected.
- D. Supine, legs slightly apart; the penis taped up onto the abdomen out of the field.
- E. Supine with the legs slightly apart.
Step-specific facts:
- A. Anatomy: The ureteric orifices lie at the lateral corners of the trigone, joined by the interureteric bar; oedema
  or a stone at the orifice can hide it. Must be right: In an infected obstructed system the aim is drainage, nothing
  more. Minimal contrast, minimal pressure, no stone manipulation. Never push a stent against resistance. If it will
  not go, stop, image and change plan.
- B. Anatomy: The kidney lies obliquely, with its posterior calyces pointing posterolaterally; a posterior calyx gives
  the most direct, least vascular route to the collecting system. Must be right: Puncture end-on through the papilla
  of a chosen calyx; never through the infundibulum or the renal pelvis directly. Dilate only to the calyx, under
  fluoroscopy, and never beyond the tip of the guidewire's safe course.
- C. Anatomy: Gerota's (perirenal) fascia encloses the kidney, perirenal fat and adrenal; a radical nephrectomy
  removes the kidney within it, so the dissection stays outside the fascia. Must be right: Know the number of renal
  arteries and veins from the CT before starting, and count them in the operation. Ligate the artery before the vein.
  If the vein remains distended after arterial ligation, there is another artery.
- D. Anatomy: A primary hydrocele is fluid within the tunica vaginalis, the closed peritoneal remnant that covers the
  front and sides of the testis and epididymis. Must be right: Never open a scrotum for a hydrocele without an
  ultrasound that shows a normal testis. An unexpected testicular mass at operation is a reason to stop, not to
  proceed with a scrotal orchidectomy.
- E. Anatomy: The prepuce has an outer skin layer and an inner mucosal layer; the inner layer meets the glans at the
  coronal sulcus. Must be right: Never use local anaesthetic with adrenaline in a penile block, by long-standing
  convention, and never use monopolar diathermy on the penis. Mark the incision lines before cutting; the shaft skin
  removed cannot be replaced.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 96 images)
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

A. RETROGRADE DOUBLE-J URETERIC STENT INSERTION  (folder uro-dj-stent/)
01_consent-check.png [step.core.consent-check]  Common. In a septic patient with impaired capacity, act in the
   patient's best interests and document it; do not delay drainage for a signature.
02_timeout.png [step.core.timeout]  Common. State the fallback: who will do a nephrostomy if retrograde access fails.
03_prophylaxis.png [step.core.prophylaxis]  Common. In suspected sepsis this is treatment, not prophylaxis: it should
   already be running.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_fluoro-setup.png [step.uro.fluoro-setup]  Fluoroscopy, contrast and radiation safety set-up: Confirm the C-arm can
   image from the bladder to the upper pole of the kidney before the patient is draped, with the table radiolucent
   over that length. Check pregnancy status in every patient who could be pregnant, and contrast allergy, before the
   first image. Teach: Upper tract endourology is done by watching wires and stents you cannot see directly. Check:
   avoid discovering after draping that the table bar or the leg holder sits over the kidney.
06_prep-drape.png [step.core.prep-drape]  Common.
07_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Send bladder urine for
   culture before irrigating. Find the orifice; a stone may be visible in it. Teach: Every endoscopic bladder
   operation starts with a complete map. Check: avoid missing the dome and the anterior wall because the bladder was
   overfilled or the lens never rotated upwards.
08_retrograde-pyelogram.png [step.uro.retrograde-pyelogram]  Retrograde pyelogram: map the ureter and collecting
   system: Cannulate the ureteric orifice with an open-ended ureteric catheter under vision, or pass the guidewire
   first if the ureter is obstructed or tortuous. Inject dilute contrast slowly under fluoroscopy; stop when the
   pelvis and calyces are outlined. Over-distension of an infected system pushes bacteria into the bloodstream. In an
   infected system, a few mL of contrast to show the obstruction is enough. Teach: The pyelogram shows where the
   obstruction is, how the ureter runs and how the calyces are arranged. Check: avoid forceful injection into an
   obstructed, infected kidney, followed by septic shock in recovery.
09_safety-guidewire.png [step.uro.safety-guidewire]  Safety guidewire into the renal pelvis: Pass a hydrophilic-tip or
   hybrid guidewire up the ureter under fluoroscopy, past the stone or obstruction, until it coils in the renal pelvis
   or an upper calyx. If it will not pass, change angle with a ureteric catheter or an angled wire; never push against
   a fixed resistance. Here the guidewire is also the stent's track: the stent is only as well placed as the wire.
   Teach: The safety wire is the road home. Check: avoid pushing a stiff wire against an impacted stone and passing it
   outside the ureter.
10_infected-system-bailout.png [step.uro.infected-system-bailout]  Pus in an obstructed system: drain and stop: If
   pus, turbid urine or frank infection is found above the obstruction, abandon definitive stone treatment. Send urine
   from the renal pelvis for culture, separately labelled from the bladder sample. This is often the reason for the
   operation. Pass an open-ended catheter over the wire into the pelvis and aspirate urine for culture before placing
   the stent. Teach: An infected, obstructed kidney is a urological emergency. Check: avoid treating the stone
   'because we are already there'.
11_length.png [step.djs.length]  Choosing stent length and diameter: Estimate the length from the patient's height,
   using the unit's chart, or measure the ureter from the pelviureteric junction to the orifice with a graduated
   ureteric catheter under fluoroscopy. Choose the diameter to suit the indication: a larger diameter for drainage of
   thick or infected urine or extrinsic compression; a standard diameter for most stone work. Teach: Too short and the
   proximal coil drops into the ureter or the distal coil is pulled up; too long and the distal coil irritates the
   trigone and causes most of the stent symptoms patients complain of. Check: avoid choosing a standard length by
   habit for every patient.
12_dj-stent.png [step.uro.dj-stent]  Double-J stent placement and position check: Choose the stent diameter and length
   for the patient and the ureter; the length can be estimated from height or measured with a graduated ureteric
   catheter. Pass the stent over the guidewire with the pusher, watching the proximal end reach the renal pelvis on
   fluoroscopy and the distal end at the orifice through the cystoscope. Teach: A stent drains an obstructed or
   injured ureter, but a stent in the wrong place either drains nothing or causes pain, haematuria and migration.
   Check: avoid pulling the wire out before the proximal coil is seen in the pelvis, leaving the stent in the mid-
   ureter.
13_failed-access.png [step.djs.failed-access]  Failed retrograde stenting: stop and arrange nephrostomy: Try once with
   a different wire, an angled catheter or a semirigid ureteroscope to see the obstruction, if the patient is stable
   and the urine is not frankly purulent. If the stent still will not pass, stop. Do not leave a wire or catheter in a
   perforated ureter without a plan. Teach: A wire that will not pass an impacted stone, an orifice that cannot be
   found, or a stent that will not advance all mean the same thing: further force risks perforation and sepsis, and
   the kidney still needs draining. Check: avoid repeated attempts in a septic patient while the anaesthetist manages
   falling blood pressure.
14_bladder-drainage.png [step.djs.bladder-drainage]  Bladder drainage and output monitoring: Pass a urethral catheter
   after stenting an infected system, or where output monitoring is needed. Confirm drainage and record catheter type
   and balloon volume. Teach: A double-J stent allows urine to reflux from the bladder up to the kidney. Check: avoid
   no output chart after relieving a solitary kidney, missing a large post-obstructive diuresis.
15_stent-register.png [step.uro.stent-register]  Stent register and removal plan: Record stent type, diameter, length,
   side, string or no string, and the intended dwell time in the operative note. Enter the stent on the unit's stent
   register or tracking system and book the removal or exchange. Teach: A forgotten stent encrusts, obstructs and can
   cost the kidney. Check: avoid relying on the discharge letter to generate the removal appointment.
16_specimen.png [step.core.specimen]  Common. Bladder urine and renal pelvis urine, labelled separately and sent for
   culture.
17_counts.png [step.core.counts]  Common. Account for every wire and catheter.
18_debrief.png [step.core.debrief]  Common. Hand over sepsis status, urine appearance from the kidney, stent details
   and the escalation plan.

B. PERCUTANEOUS NEPHROLITHOTOMY (PCNL)  (folder uro-pcnl/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the side and the planned calyx of entry against the
   CT; check the transfusion plan and group and save are in place.
02_timeout.png [step.core.timeout]  Common. Plan for bleeding, for sepsis and for a failed puncture, aloud. Confirm
   blood is available if the stone is a staghorn.
03_prophylaxis.png [step.core.prophylaxis]  Common. Guided by the urine culture; infected and struvite stones may need
   a treatment course before surgery.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_fluoro-setup.png [step.uro.fluoro-setup]  Fluoroscopy, contrast and radiation safety set-up: Confirm the C-arm can
   image from the bladder to the upper pole of the kidney before the patient is draped, with the table radiolucent
   over that length. Check pregnancy status in every patient who could be pregnant, and contrast allergy, before the
   first image. If puncturing under fluoroscopy, keep your hands out of the beam: use a needle holder or ultrasound
   guidance. Teach: Upper tract endourology is done by watching wires and stents you cannot see directly. Check: avoid
   discovering after draping that the table bar or the leg holder sits over the kidney.
06_prep-drape.png [step.core.prep-drape]  Common.
07_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Purpose here is to place
   a ureteric catheter; this is usually done in lithotomy before turning prone. Teach: Every endoscopic bladder
   operation starts with a complete map. Check: avoid missing the dome and the anterior wall because the bladder was
   overfilled or the lens never rotated upwards.
08_safety-guidewire.png [step.uro.safety-guidewire]  Safety guidewire into the renal pelvis: Pass a hydrophilic-tip or
   hybrid guidewire up the ureter under fluoroscopy, past the stone or obstruction, until it coils in the renal pelvis
   or an upper calyx. If it will not pass, change angle with a ureteric catheter or an angled wire; never push against
   a fixed resistance. A ureteric catheter left over the wire up to the pelvis lets you opacify or distend the system
   and stops fragments falling down the ureter. Teach: The safety wire is the road home. Check: avoid pushing a stiff
   wire against an impacted stone and passing it outside the ureter.
09_retrograde-pyelogram.png [step.uro.retrograde-pyelogram]  Retrograde pyelogram: map the ureter and collecting
   system: Cannulate the ureteric orifice with an open-ended ureteric catheter under vision, or pass the guidewire
   first if the ureter is obstructed or tortuous. Inject dilute contrast slowly under fluoroscopy; stop when the
   pelvis and calyces are outlined. Over-distension of an infected system pushes bacteria into the bloodstream.
   Opacify through the ureteric catheter once positioned for puncture. Air injected through the catheter outlines
   posterior calyces, which fill with air in the prone patient. Teach: The pyelogram shows where the obstruction is,
   how the ureter runs and how the calyces are arranged. Check: avoid forceful injection into an obstructed, infected
   kidney, followed by septic shock in recovery.
10_puncture.png [step.pcnl.puncture]  Calyceal puncture: posterior calyx, end-on through the papilla: Choose the calyx
   that gives the straightest line to the bulk of the stone, usually a posterior lower or middle calyx; an upper pole
   calyx gives the best line to the pelviureteric junction and staghorn branches but may be supracostal. Puncture
   under ultrasound or fluoroscopy (bull's-eye or triangulation technique), aiming to enter the calyx end-on through
   the papilla. Teach: The puncture is the operation. Check: avoid multiple passes through the parenchyma searching
   for the calyx, each one a potential bleeding source.
11_infected-system-bailout.png [step.uro.infected-system-bailout]  Pus in an obstructed system: drain and stop: If
   pus, turbid urine or frank infection is found above the obstruction, abandon definitive stone treatment. Send urine
   from the renal pelvis for culture, separately labelled from the bladder sample. Pus from the needle: pass a wire,
   place a nephrostomy, stop, and treat the infection. Return for the stone later. Teach: An infected, obstructed
   kidney is a urological emergency. Check: avoid treating the stone 'because we are already there'.
12_dilatation.png [step.pcnl.dilatation]  Tract dilatation and sheath placement: Make a skin incision large enough for
   the sheath and dilate along the wire under fluoroscopy, with the wire secure and not buckling. Advance each dilator
   or balloon only to the calyx, watching the tip on fluoroscopy; stop at the stone or the calyceal neck. Teach: The
   dilator follows the wire, and it can go further than you want it to. Check: avoid losing the tract after removing
   the sheath without a wire in place.
13_lithotripsy.png [step.uro.lithotripsy]  Intracorporeal lithotripsy: Confirm the energy source (laser, pneumatic or
   ultrasonic) and, for a laser, the settings, eye protection for everyone in the room and the warning sign on the
   door. Keep the fibre or probe tip visible beyond the end of the scope and in contact with the stone, never touching
   mucosa, the guidewire or a basket. Work through the sheath with outflow kept free, so that intrarenal pressure
   stays low. Teach: Breaking the stone is the point of the operation, but the energy that breaks stone also cuts
   urothelium, guidewires and scopes. Check: avoid firing the laser with the fibre tip inside the working channel,
   destroying the scope.
14_fragment-clearance.png [step.uro.fragment-clearance]  Fragment retrieval and stone-free assessment: Retrieve
   fragments large enough to obstruct with a basket or grasper; never pull a fragment that is wider than the lumen it
   must pass through. Inspect systematically every calyx or ureteric segment that held stone, and screen with
   fluoroscopy for radio-opaque residual fragments. Use the flexible nephroscope for calyces not reached through the
   rigid tract, and fluoroscopy to look for residual stone. Teach: Residual fragments grow, cause colic and bring the
   patient back. Check: avoid pulling an entrapped basket and stone against resistance. Release the stone or fragment
   it in the basket instead.
15_bleeding.png [step.pcnl.bleeding]  Bleeding: tamponade, stop and escalate: When the view is lost to blood, stop
   irrigation and lithotripsy and advance the sheath into the calyx to tamponade the tract. If bleeding continues,
   abandon the stone work, place a nephrostomy (or a balloon tamponade catheter) and clamp it; inform the anaesthetist
   and check haemoglobin. Teach: Bleeding in PCNL is common and usually venous, and venous bleeding stops with
   tamponade. Check: avoid continuing to fragment in a red field to finish the stone.
16_dj-stent.png [step.uro.dj-stent]  Double-J stent placement and position check: Choose the stent diameter and length
   for the patient and the ureter; the length can be estimated from height or measured with a graduated ureteric
   catheter. Pass the stent over the guidewire with the pusher, watching the proximal end reach the renal pelvis on
   fluoroscopy and the distal end at the orifice through the cystoscope. Antegrade or retrograde; decide based on
   residual stone, ureteric oedema, pelvic tear and whether a nephrostomy is left. Teach: A stent drains an obstructed
   or injured ureter, but a stent in the wrong place either drains nothing or causes pain, haematuria and migration.
   Check: avoid pulling the wire out before the proximal coil is seen in the pelvis, leaving the stent in the mid-
   ureter.
17_exit.png [step.pcnl.exit]  Exit strategy: nephrostomy, stent or tubeless: Leave a nephrostomy if there is
   significant bleeding, residual stone needing a second look, a pelvic perforation, infection, or more than one
   tract. Consider a tubeless finish (stent or ureteric catheter only, or totally tubeless) in an uncomplicated
   procedure with a single tract, minimal bleeding and complete clearance. Teach: How the kidney is drained at the end
   decides the patient's pain, the length of stay and whether a second look is easy. Check: avoid a tubeless finish
   after a bloody procedure.
18_stent-register.png [step.uro.stent-register]  Stent register and removal plan: Record stent type, diameter, length,
   side, string or no string, and the intended dwell time in the operative note. Enter the stent on the unit's stent
   register or tracking system and book the removal or exchange. Teach: A forgotten stent encrusts, obstructs and can
   cost the kidney. Check: avoid relying on the discharge letter to generate the removal appointment.
19_specimen.png [step.core.specimen]  Common. Stone for analysis and, if taken, stone or pelvic urine for culture.
20_counts.png [step.core.counts]  Common. Account for wires, dilators, sheaths and baskets.
21_chest-check.png [step.pcnl.chest-check]  Chest check after upper or supracostal access: After turning supine, ask
   the anaesthetist about ventilation pressures and saturation, and examine the chest on the operated side. Screen the
   chest with fluoroscopy before leaving theatre, or arrange a chest X-ray in recovery, after any supracostal or upper
   pole access. Teach: A hydrothorax or pneumothorax from a supracostal tract often shows only as falling oxygen
   saturation or breathlessness after the patient is turned back. Check: avoid attributing post-operative
   breathlessness to atelectasis without imaging.
22_debrief.png [step.core.debrief]  Common. Record the calyx used, the rib relationship, stone-free status, drainage,
   and what would prompt a return or angiography.

C. RADICAL NEPHRECTOMY (OPEN AND LAPAROSCOPIC PRINCIPLES)  (folder uro-radical-nephrectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the side against the CT, and that partial nephrectomy
   has been considered and the reason it is not being done is recorded.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Staging complete, MDT outcome documented, contralateral kidney function confirmed, and thrombus level
   known. Teach: A cancer operation is one part of a treatment plan agreed by a multidisciplinary team. Check: avoid
   accepting an MDT note that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common. State the number of renal arteries and veins on the CT, the conversion
   plan, and blood availability.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Prepare and drape wide enough to convert to an open incision without
   re-preparing.
07_access.png [step.rn.access]  Access: laparoscopic ports or open incision: Laparoscopic transperitoneal: establish
   pneumoperitoneum, place the camera port lateral to the rectus at or near the umbilicus, with working ports to
   triangulate on the hilum; on the right add a liver retractor port. Retroperitoneoscopic: develop the
   retroperitoneal space with a balloon below the twelfth rib, giving direct access to the posterior hilum without
   mobilising bowel. Teach: The access decides how easily the hilum can be reached and controlled. Check: avoid ports
   placed too close to the hilum to work on it.
08_tumour-handling.png [step.onco.tumour-handling]  Oncological handling: no touch, wound protection, clean field:
   Handle the tumour-bearing tissue as little as possible; retract the specimen by its normal edges, not by the
   tumour. Control the vascular pedicle early where the operation allows it, before the tumour is mobilised. The
   specimen is handled by Gerota's fascia and the surrounding fat, never by the tumour. Teach: Tumour cells shed into
   the wound, the peritoneum or a port site produce a recurrence that no adjuvant therapy fully reverses. Check: avoid
   grasping the tumour with a toothed instrument to improve exposure.
09_mobilise.png [step.rn.mobilise]  Reflecting the colon and the overlying viscera: Incise the line of Toldt and
   reflect the colon medially in the plane between the mesocolon and Gerota's fascia. Right: mobilise the hepatic
   flexure, divide the triangular and coronary attachments as needed and lift the liver, then Kocherise the duodenum
   to expose the vena cava. Teach: The kidney lies behind the colon and, on each side, a different organ that can be
   injured: the duodenum on the right, the spleen and pancreas on the left. Check: avoid dissecting in the mesocolon
   and devascularising the colon.
10_ureter-gonadal.png [step.rn.ureter-gonadal]  Ureter and gonadal vein: lift the lower pole: Identify the gonadal
   vein and the ureter on psoas below the lower pole; on the left the gonadal vein leads directly to the left renal
   vein. Lift the ureter with the lower pole fat, dissecting on psoas and staying lateral to the great vessels. Teach:
   The ureter and gonadal vein on psoas are the most reliable landmarks in the retroperitoneum. Check: avoid traction
   on the right gonadal vein tearing it off the vena cava.
11_hilum.png [step.rn.hilum]  Hilar dissection: identify every artery and vein: With the lower pole lifted, dissect
   the hilum from below, defining the renal vein first and then the artery behind and usually above it. On the left,
   identify and divide the gonadal, adrenal and lumbar tributaries of the renal vein as needed to free it and reach
   the artery behind. Teach: The hilum is where the operation is won or lost. Check: avoid dissecting medially on the
   left past the aorta and finding the superior mesenteric artery.
12_vessel-ligation.png [step.rn.vessel-ligation]  Ligation: artery first, then vein: Ligate the renal artery with
   locking polymer clips or a vascular stapler, leaving adequate cuff on the patient side, and divide it. Wait and
   look: the renal vein should flatten. If it does not, find the other artery before going further. Teach: Taking the
   artery first stops inflow while the vein drains the kidney; taking the vein first leaves a kidney full of blood
   with nowhere to go, and it bleeds. Check: avoid firing a stapler across a clip, which causes a stapler misfire and
   bleeding.
13_vascular-bailout.png [step.rn.vascular-bailout]  Major bleeding or failure to progress: control and convert: Apply
   direct pressure with a grasper and swab or, open, with a finger or swab stick; increase pneumoperitoneum briefly if
   it helps while the team prepares. Tell the anaesthetist, call for senior and vascular help, and get blood and cell
   salvage ready. Teach: Conversion is not a failure; delayed conversion is. Check: avoid applying clips blindly into
   a pool of blood.
14_upper-pole-adrenal.png [step.rn.upper-pole-adrenal]  Upper pole and adrenal: decide, then free the specimen: Decide
   on the adrenal from the CT and the operative findings: spare it if uninvolved, remove it en bloc if involved or
   inseparable. To spare the adrenal, dissect between the upper pole and the adrenal, taking care with adrenal
   vessels; to remove it, ligate the adrenal vein (on the right, directly into the vena cava) and free it with the
   kidney. Teach: Routine adrenalectomy is not needed when imaging shows the adrenal is uninvolved; removing it adds
   bleeding and morbidity. Check: avoid tearing the short right adrenal vein off the vena cava.
15_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Bag the specimen intact and extract through an incision large enough for it; no
   morcellation. In the open operation, lift it out as one piece. Teach: Bringing an infected or neoplastic specimen
   through the abdominal wall unprotected causes port-site infection and, in malignancy, port-site recurrence. Check:
   avoid a bag torn during extraction, spilling contents into the wound.
16_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Teach: Margin status and nodal yield are reported by the pathologist, but only from a
   specimen they can orient. Check: avoid a single suture with no stated convention.
17_haemostasis.png [step.core.haemostasis]  Common. Lower the pneumoperitoneum pressure to look at the renal bed,
   adrenal and hilar stumps, the spleen and the liver.
18_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. A drain is not routine; consider it after a difficult dissection, a
   pancreatic tail injury or a lymphadenectomy. Teach: A drain tells you what is happening in a space you cannot see.
   Check: avoid a drain placed 'just in case', which then becomes a route for infection.
19_counts.png [step.core.counts]  Common.
20_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Open: close the flank or subcostal incision in layers. Laparoscopic: close the
   fascia of the extraction site and of the larger ports. Teach: Burst abdomen and incisional hernia are closure
   failures, and closure technique is one of the few variables entirely under the surgeon's control. Check: avoid
   large bites taken quickly at the end of a long case.
21_skin-closure.png [step.core.skin-closure]  Common.
22_debrief.png [step.core.debrief]  Common. Record the vessels found and how they were ligated, adrenal and node
   decisions, any visceral injury, and the remaining kidney's function plan.

D. HYDROCELE REPAIR (JABOULAY OR LORD)  (folder uro-hydrocele-repair/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side on the awake patient; for bilateral hydroceles
   record whether both are being repaired.
02_scrotal-imaging-check.png [step.uro.scrotal-imaging-check]  Scrotal ultrasound and examination reviewed before
   incision: Review the scrotal ultrasound yourself: both testes seen and described, the lesion characterised, and the
   contralateral testis normal or its abnormality noted. Examine the patient awake: side, the testis felt separately
   from the swelling where possible, and the cord. A large hydrocele hides the testis from examination; the ultrasound
   is the only proof that it is normal. Teach: A hydrocele, a varicocele or a 'benign' swelling can hide a testicular
   tumour, and the operation planned for a benign lesion is the wrong one for a cancer. Check: avoid operating on an
   adult hydrocele through the scrotum without an ultrasound of the testis behind it.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. Clean procedure: antibiotic prophylaxis per local policy, not
   routinely.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_incision.png [step.hyd.incision]  Scrotal incision through the dartos: Steady the hydrocele by stretching the
   scrotal skin over it with the non-dominant hand. Make a transverse incision over the anterior surface, avoiding
   visible skin vessels, or use a median raphe incision for bilateral repair. Teach: A transverse incision along the
   skin creases, between visible vessels, heals with the least scarring and bleeding; the dartos is a vascular muscle
   layer, and the plane beneath it determines how much the scrotum bleeds afterwards. Check: avoid cutting through the
   sac in the same stroke, collapsing it before the plane has been found.
08_deliver.png [step.hyd.deliver]  Delivering the sac (Jaboulay) or preserving the plane (Lord): Jaboulay: free the
   intact sac from the dartos with blunt dissection in the avascular plane, and deliver the sac with the testis
   through the incision. Lord: do not dissect around the sac; open it in situ and deliver only the testis through a
   small opening. Teach: The choice of repair decides the dissection. Check: avoid choosing Lord for a large, thick
   sac, which plicates into a bulky mass and recurs.
09_open-inspect.png [step.hyd.open-inspect]  Open the sac, drain the fluid and inspect the testis: Open the sac
   anteriorly, away from the testis, and drain the fluid, noting its colour: clear and straw-coloured is expected;
   blood, pus or chylous fluid needs explanation. Inspect and palpate the testis and epididymis; identify the
   epididymis and vas posteriorly before cutting further. Teach: This is the first direct look at the testis and
   epididymis, and the last chance to recognise that the problem is not a simple hydrocele. Check: avoid opening a
   tense sac with a deep stab and cutting the testis beneath it.
10_mass-bailout.png [step.hyd.mass-bailout]  Unexpected testicular mass: stop: Do not biopsy the testis or perform an
   orchidectomy through the scrotal incision. Close the scrotum and inform the patient after recovery. Teach: Removing
   a testicular cancer through the scrotum breaches the lymphatic drainage and may change staging and treatment.
   Check: avoid proceeding to a scrotal orchidectomy because the patient is already asleep.
11_sac-repair.png [step.hyd.sac-repair]  Jaboulay eversion or Lord plication: Jaboulay: trim excess sac if very large,
   leaving a margin, then evert the remaining sac behind the testis and cord and approximate its edges loosely behind
   the cord with absorbable sutures, without constricting it. Lord: place a series of radial plicating absorbable
   sutures from the cut edge of the tunica to its reflection at the junction with the testis, around the
   circumference, and tie them to gather the sac into a ruff. Teach: Both repairs stop the secreting tunica vaginalis
   from re-forming a closed sac: Jaboulay by turning it inside out behind the testis, Lord by gathering it into a
   collar. Check: avoid closing the everted sac tightly round the cord, causing venous congestion of the testis.
12_haemostasis.png [step.core.haemostasis]  Common. Inspect the cut edge of the sac, the dartos and the skin edges;
   bleeding points in the scrotum are small and many, and each one matters.
13_replace-close.png [step.hyd.replace-close]  Replace the testis and close the dartos: Replace the testis in its
   normal orientation, with the epididymis posterior and no twist in the cord. Close the dartos with a continuous
   absorbable suture, obliterating the space without strangulating tissue. Teach: A testis replaced with a twist, or
   into a dead space in the scrotum, causes pain and haematoma. Check: avoid closing skin only, leaving the dartos to
   bleed into the scrotum.
14_specimen.png [step.core.specimen]  Common. Send excised sac for histology when it is thick, irregular or the cause
   is uncertain; record 'none sent' after a Lord's plication.
15_counts.png [step.core.counts]  Common.
16_skin-closure.png [step.core.skin-closure]  Common. Absorbable interrupted or continuous skin sutures; a fluffy
   gauze and scrotal support give gentle compression.
17_debrief.png [step.core.debrief]  Common. Record the technique used, the appearance of the testis and epididymis,
   and the haematoma warning given to the patient.

E. ADULT CIRCUMCISION  (folder uro-adult-circumcision/)
01_consent-check.png [step.core.consent-check]  Common. Discuss the cosmetic result and how much skin will be removed.
   Record any lesion, lichen sclerosus or meatal narrowing seen.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis is not routine for a clean circumcision;
   treat active infection first.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Retract the prepuce as far as it will go and clean beneath it.
06_block.png [step.circ.block]  Penile block (dorsal nerve and ring block): Calculate the maximum safe dose of plain
   local anaesthetic for the patient's weight before drawing up. Infiltrate a ring block around the base of the penis
   subcutaneously, and inject either side of the midline beneath Buck's fascia on the dorsum to block the dorsal
   nerves, aspirating before each injection. Teach: A good block makes the operation painless under local anaesthetic
   and reduces post-operative pain after a general anaesthetic. Check: avoid using a pre-mixed local anaesthetic with
   adrenaline from the wrong tray.
07_adhesions-inspect.png [step.circ.adhesions-inspect]  Free adhesions and inspect the glans and meatus: If the
   prepuce will not retract, make a short dorsal slit under vision to allow full retraction, keeping the blade off the
   glans. Separate preputial adhesions gently with a blunt probe or swab. Teach: The prepuce may hide adhesions,
   smegma, lichen sclerosus, meatal stenosis or a tumour. Check: avoid a dorsal slit blade passed blindly beneath a
   tight prepuce, lacerating the glans or entering the meatus.
08_lesion-bailout.png [step.circ.lesion-bailout]  Suspicious lesion: biopsy and stop: If the glans or inner prepuce
   shows an ulcer, mass, or suspicious plaque, take a representative biopsy and do not proceed to formal circumcision.
   A dorsal slit can be left to allow access and hygiene. Teach: Penile cancer often presents under a phimosis. Check:
   avoid completing the circumcision and sending the prepuce as the 'biopsy'.
09_outer-incision.png [step.circ.outer-incision]  Mark and incise the outer prepuce at the corona: With the prepuce
   unretracted and the penis untensioned, mark a circumferential line on the outer skin at the level of the coronal
   sulcus, following its V-shape ventrally at the frenulum. Incise along the marked line through skin only, with the
   scalpel, staying superficial to the dartos. Teach: The outer incision decides how much shaft skin remains. Check:
   avoid pulling the prepuce forward over the glans before marking, which moves shaft skin into the excision.
10_inner-incision.png [step.circ.inner-incision]  Mark and incise the inner prepuce: Retract the prepuce fully and
   mark a line on the inner prepuce a few millimetres proximal to the coronal sulcus, parallel to it, sparing the
   frenulum ventrally. Incise through mucosa only, with the glans protected. Teach: Too long an inner cuff swells and
   looks poor; too short makes the anastomosis tight against the glans and risks injury to the sulcus. Check: avoid
   cutting the inner incision against the corona, leaving nothing to suture to.
11_excise.png [step.circ.excise]  Excise the sleeve of prepuce: Divide the sleeve of skin between the two incisions
   dorsally in the midline, then excise it circumferentially in the plane just beneath the dartos. Ventrally, take the
   frenular tissue carefully, identifying the frenular artery and clamping and ligating it. Teach: The sleeve is
   removed in the plane superficial to Buck's fascia. Check: avoid dissecting deep on the dorsum into the dorsal vein,
   causing troublesome bleeding.
12_haemostasis.png [step.core.haemostasis]  Common. Bipolar only, precise points; ask the patient (if awake) to relax
   and wait a moment for vessels to show. Ligate the frenular artery rather than relying on coagulation.
13_anastomosis.png [step.circ.anastomosis]  Skin-to-mucosa anastomosis: Place a ventral frenular suture (horizontal
   mattress or U-stitch) incorporating the frenular area, then a dorsal midline suture, then sutures at three and nine
   o'clock. Close the gaps between with interrupted fine absorbable sutures, taking skin and mucosa only. Teach:
   Sutures placed in quadrants first spread the skin evenly and prevent a twisted or uneven result; the ventral
   frenular stitch closes the area that bleeds most. Check: avoid deep ventral bites that catch the urethra.
14_specimen.png [step.core.specimen]  Common. Send the prepuce for histology, particularly with lichen sclerosus or
   any visible abnormality.
15_counts.png [step.core.counts]  Common.
16_skin-closure.png [step.core.skin-closure]  Common. The skin is closed by the anastomosis; apply a non-adherent
   dressing that does not constrict the shaft.
17_debrief.png [step.core.debrief]  Common. Record the appearance of the glans and meatus, the frenular artery
   management, and the histology plan.

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
  surgx-uro-dj-stent-steps.zip   (folder uro-dj-stent/)
  surgx-uro-pcnl-steps.zip   (folder uro-pcnl/)
  surgx-uro-radical-nephrectomy-steps.zip   (folder uro-radical-nephrectomy/)
  surgx-uro-hydrocele-repair-steps.zip   (folder uro-hydrocele-repair/)
  surgx-uro-adult-circumcision-steps.zip   (folder uro-adult-circumcision/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
