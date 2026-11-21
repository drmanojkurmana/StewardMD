---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 9a (urology: endoscopic, perineal and scrotal): Gemini image prompt (104 images, 7 operations)

Built 2026-11-21 by `make9.py` from the real steps in `surgx/procedures/<id>.json`. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant urologists (endourology, uro-oncology and reconstructive urology). You are making 104 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Flexible cystoscopy and stent removal                          12 images
  B. Transperineal prostate biopsy                                  16 images
  C. Optical internal urethrotomy                                   14 images
  D. Cystolitholapaxy (bladder stone)                               15 images
  E. Holmium laser enucleation of the prostate (HoLEP)              18 images
  F. No-scalpel vasectomy                                           13 images
  G. Bulbar urethroplasty with buccal mucosa graft (RIGHT cheek)    16 images
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
- A. A man supine with lidocaine gel; a woman in frog-leg; the patient awake watching a screen.
- B, C, D, E and G. Lithotomy with well-padded leg supports, buttocks at the table edge; for B the scrotum lifted and
  taped up away from the perineum; for G a nasal tube so the mouth is free.
- F. Supine, the penis taped up onto the lower abdomen, only the scrotum exposed.
Step-specific facts:
- A. A flexible cystoscope (thin, black, steerable tip) entering the urethra; in the bladder the tip bent fully back
  (retroflexion) to look at its own entry; graspers through the channel pulling out a double-J stent curl.
- B. A transrectal ultrasound probe in the rectum on a stepper; a long biopsy needle entering through the PERINEAL skin
  (never through the rectum) via a grid or access guide; cores from the MRI target first, then a systematic pattern.
- C. Endoscopic view: a pale ring of scar narrowing the urethra, a thin guidewire passing through its centre, and a cold
  hook knife cutting at 12 o'clock only.
- D. A large yellow-white stone in the bladder; a laser fibre tip touching the stone with clear fluid between the stone
  and the bladder wall; an Ellik evacuator bulb on a syringe-like glass reservoir sucking out fragments.
- E. The laser fibre at the bladder neck; the white adenoma being peeled off the pink surgical capsule; separated lobes
  floating in a FULL bladder; a morcellator tip with its side window holding a piece of adenoma, the bladder wall far
  away; laser goggles on all staff.
- F. Fingers trapping a white cord-like vas under the thin scrotal skin in the midline; a ring clamp holding it; sharp
  forceps puncturing the skin; a loop of bare vas lifted out; its cut ends sealed and separated by a fascial layer.
- G. A mouth gag; a rectangle of inner cheek mucosa marked BELOW the parotid duct opening (opposite the upper second
  molar); a perineal midline incision, the bulbospongiosus split, the urethra opened along the stricture; the buccal
  graft quilted flat on its bed.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 104 images)
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

A. FLEXIBLE CYSTOSCOPY AND STENT REMOVAL  (folder uro-flexible-cystoscopy/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_urine-check.png [step.uro.urine-check]  Sterile urine before instrumentation: Check the most recent urine culture
   and that any infection has been treated with a sensitive antibiotic. Ask about fever, rigors or new symptoms today;
   a febrile patient with an obstructed system is drained (stent or nephrostomy) and the definitive operation waits.
   Teach: Instrumenting infected urine can cause urosepsis within hours. Check: avoid proceeding on an old or missing
   culture.
04_prophylaxis.png [step.core.prophylaxis]  Common. Usually no antibiotic for a diagnostic look; give one only for
   risk factors or stent removal per local policy.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Clean the meatus and glans or vulva; a fenestrated drape.
07_la-gel.png [step.fcs.la-gel]  Lidocaine gel and gentle urethral entry: Instil sterile lidocaine gel into the
   urethra and wait about 3 to 5 minutes. Hold the penis upright and stretched (men) and advance the scope only where
   the lumen is seen ahead. Teach: Gel left in place for a few minutes makes the look painless and lubricates the
   scope, so the patient stays still and the urethra is not damaged. Check: avoid pushing the scope blind.
08_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Pass the flexible scope
   under vision along the urethra, then map the bladder wall in order. Teach: Every endoscopic bladder operation
   starts with a complete map. Check: avoid missing the dome and the anterior wall because the bladder was overfilled
   or the lens never rotated upwards.
09_retroflex.png [step.fcs.retroflex]  Retroflexion to see the bladder neck: In the bladder with moderate filling,
   deflect the tip fully so the scope looks back at its own entry point. Rotate the scope through 360 degrees to
   inspect the whole bladder neck and the area around it. Teach: Tumours at the bladder neck and around the internal
   opening are hidden from the straight view; retroflexion shows them. Check: avoid withdrawing the scope while it is
   still retroflexed.
10_stent-removal.png [step.fcs.stent-removal]  Stent removal with graspers: Identify the stent coming out of the
   ureteric orifice. Pass graspers down the working channel, grasp the stent end and withdraw the scope and stent
   together. Teach: A stent left in too long encrusts and can block or break. Check: avoid pulling only part of an
   encrusted stent.
11_finding.png [step.fcs.finding]  A suspicious finding: Record the site, size, number and appearance of any lesion on
   a bladder diagram, with photographs. Explain the finding to the patient and book a TURBT and staging scans as
   indicated. Teach: A flexible look is for diagnosis. Check: avoid taking a small cold-cup biopsy and calling it
   staged.
12_debrief.png [step.core.debrief]  Common. Explain the findings, document the bladder map, and book any biopsy or
   TURBT.

B. TRANSPERINEAL PROSTATE BIOPSY  (folder uro-transperineal-prostate-biopsy/)
01_consent-check.png [step.core.consent-check]  Common.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. The MRI has been reviewed and the targets with their zones are marked on the plan. Teach: A cancer
   operation is one part of a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note
   that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_urine-check.png [step.uro.urine-check]  Sterile urine before instrumentation: Check the most recent urine culture
   and that any infection has been treated with a sensitive antibiotic. Ask about fever, rigors or new symptoms today;
   a febrile patient with an obstructed system is drained (stent or nephrostomy) and the definitive operation waits.
   Teach: Instrumenting infected urine can cause urosepsis within hours. Check: avoid proceeding on an old or missing
   culture.
05_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic per local policy; the transperineal route carries far
   less sepsis risk than transrectal.
06_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common. Clean the perineum widely; drape with the perineum exposed.
08_block.png [step.tpb.block]  Perineal and periprostatic local anaesthetic: Raise a skin weal at the planned entry
   points either side of the midline above the anus. Under ultrasound, advance a long spinal needle and infiltrate
   along the track to the prostatic apex on each side. Teach: A good block lets the biopsy be done awake in clinic;
   the periprostatic part numbs the capsule where the needle passes. Check: avoid injecting into the urethra or the
   rectum.
09_probe.png [step.tpb.probe]  Ultrasound probe and access device: Insert the lubricated probe into the rectum and
   image the prostate in the transverse and sagittal planes. Mount the stepper or the freehand access device so the
   needle path shows on the sagittal view. Teach: The transrectal probe only images; the needle goes through the
   perineal skin. Check: avoid losing the urethra on the image and passing through it.
10_targeted.png [step.tpb.targeted]  Targeted cores from the MRI lesion: Find the MRI lesion on ultrasound (cognitive
   or fusion registration). Take 3 to 5 cores through the lesion, watching the needle enter the target on the sagittal
   view. Teach: The MRI lesion is the most likely site of significant cancer. Check: avoid taking the systematic cores
   first and then not seeing the target.
11_systematic.png [step.tpb.systematic]  Systematic template cores: Take systematic cores from each side per the local
   template (for example 12 to 24 cores by zone), including the anterior zones. Avoid the urethra by keeping the
   needle lateral to it on the image. Teach: Cancers outside the MRI lesion are found by systematic sampling of each
   zone, from apex to base. Check: avoid skipping the anterior zones, where transrectal biopsy often misses cancer.
12_haemostasis.png [step.core.haemostasis]  Common. Firm pressure on the perineal puncture sites.
13_specimen.png [step.core.specimen]  Common. Every core in its own labelled pot or cassette by site, read back.
14_retention.png [step.tpb.retention]  Retention or heavy bleeding after biopsy: Check the patient passes urine before
   discharge; scan the bladder if unsure. If in retention, pass a urethral catheter and plan a trial without catheter.
   Teach: Swelling after many cores can block a big prostate. Check: avoid discharging a patient who has not voided.
15_counts.png [step.core.counts]  Common.
16_debrief.png [step.core.debrief]  Common. Record the number of cores per site, the targets sampled and the follow-up
   date.

C. OPTICAL INTERNAL URETHROTOMY  (folder uro-optical-urethrotomy/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_urine-check.png [step.uro.urine-check]  Sterile urine before instrumentation: Check the most recent urine culture
   and that any infection has been treated with a sensitive antibiotic. Ask about fever, rigors or new symptoms today;
   a febrile patient with an obstructed system is drained (stent or nephrostomy) and the definitive operation waits.
   Teach: Instrumenting infected urine can cause urosepsis within hours. Check: avoid proceeding on an old or missing
   culture.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_fluoro-setup.png [step.uro.fluoro-setup]  Fluoroscopy, contrast and radiation safety set-up: Confirm the C-arm can
   image from the bladder to the upper pole of the kidney before the patient is draped, with the table radiolucent
   over that length. Check pregnancy status in every patient who could be pregnant, and contrast allergy, before the
   first image. Teach: Upper tract endourology is done by watching wires and stents you cannot see directly. Check:
   avoid discovering after draping that the table bar or the leg holder sits over the kidney.
07_prep-drape.png [step.core.prep-drape]  Common.
08_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Urethroscopy to the
   stricture: note its site and look for a lumen. Teach: Every endoscopic bladder operation starts with a complete
   map. Check: avoid missing the dome and the anterior wall because the bladder was overfilled or the lens never
   rotated upwards.
09_safety-guidewire.png [step.uro.safety-guidewire]  Safety guidewire into the renal pelvis: Pass a hydrophilic-tip or
   hybrid guidewire up the ureter under fluoroscopy, past the stone or obstruction, until it coils in the renal pelvis
   or an upper calyx. If it will not pass, change angle with a ureteric catheter or an angled wire; never push against
   a fixed resistance. Pass the wire through the stricture into the bladder and confirm it coils in the bladder on
   fluoroscopy. Teach: The safety wire is the road home. Check: avoid pushing a stiff wire against an impacted stone
   and passing it outside the ureter.
10_incise.png [step.dviu.incise]  Cold-knife incision at 12 o'clock: With the wire in view, place the cold knife at 12
   o'clock on the stricture. Cut the scar in short strokes until healthy spongiosum and the lumen open and the scope
   passes easily into the bladder. Teach: Cutting the scar at 12 o'clock releases the narrowing with the least
   bleeding and keeps away from the rectum and the corpora at the sides. Check: avoid cutting deep into the corpus
   spongiosum.
11_false-passage.png [step.dviu.false-passage]  Bailout: lost lumen or false passage: If the wire will not pass or the
   scope leaves the lumen, stop cutting. Place a suprapubic catheter and plan imaging and a formal urethroplasty.
   Teach: A blind cut makes a false passage that turns a simple stricture into a complex one. Check: avoid persisting
   with blind cuts.
12_catheter-plan.png [step.uro.catheter-plan]  Catheter secured and plan recorded: Secure the catheter to the thigh
   without tension; note the size, balloon volume and type. Write how long it stays and how it comes out (trial
   without catheter, or a contrast study first). A catheter over the wire into the bladder; write the removal date.
   Teach: After urethral or bladder surgery the catheter splints the repair. Check: avoid an unsecured catheter pulled
   out in recovery.
13_counts.png [step.core.counts]  Common.
14_debrief.png [step.core.debrief]  Common. Record the stricture site and length, the cut, the catheter plan, and the
   urethroplasty discussion.

D. CYSTOLITHOLAPAXY (BLADDER STONE)  (folder uro-cystolitholapaxy/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_urine-check.png [step.uro.urine-check]  Sterile urine before instrumentation: Check the most recent urine culture
   and that any infection has been treated with a sensitive antibiotic. Ask about fever, rigors or new symptoms today;
   a febrile patient with an obstructed system is drained (stent or nephrostomy) and the definitive operation waits.
   Teach: Instrumenting infected urine can cause urosepsis within hours. Check: avoid proceeding on an old or missing
   culture.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Note stone size and
   number, the prostate, any diverticulum, and the bladder mucosa. Teach: Every endoscopic bladder operation starts
   with a complete map. Check: avoid missing the dome and the anterior wall because the bladder was overfilled or the
   lens never rotated upwards.
08_lithotripsy.png [step.uro.lithotripsy]  Intracorporeal lithotripsy: Confirm the energy source (laser, pneumatic or
   ultrasonic) and, for a laser, the settings, eye protection for everyone in the room and the warning sign on the
   door. Keep the fibre or probe tip visible beyond the end of the scope and in contact with the stone, never touching
   mucosa, the guidewire or a basket. In the bladder: fibre on the stone, the bladder moderately full, the wall never
   in front of the fibre. Teach: Breaking the stone is the point of the operation, but the energy that breaks stone
   also cuts urothelium, guidewires and scopes. Check: avoid firing the laser with the fibre tip inside the working
   channel, destroying the scope.
09_fragment-clearance.png [step.uro.fragment-clearance]  Fragment retrieval and stone-free assessment: Retrieve
   fragments large enough to obstruct with a basket or grasper; never pull a fragment that is wider than the lumen it
   must pass through. Inspect systematically every calyx or ureteric segment that held stone, and screen with
   fluoroscopy for radio-opaque residual fragments. Evacuate fragments with the Ellik and recheck every part of the
   bladder. Teach: Residual fragments grow, cause colic and bring the patient back. Check: avoid pulling an entrapped
   basket and stone against resistance. Release the stone or fragment it in the basket instead.
10_cause.png [step.clp.cause]  Find and treat the cause: Once the stone is cleared, inspect the mucosa where it lay
   for tumour. Assess the prostate and the bladder neck, look for diverticula, foreign bodies or a retained stent.
   Teach: Bladder stones usually form behind outflow obstruction or in stagnant urine. Check: avoid clearing the stone
   and missing a tumour under it.
11_perforation-check.png [step.uro.perforation-check]  Final inspection: perforation, orifices and landmarks: Inspect
   the resected area at low pressure: fat seen through the capsule or bladder wall, or black space beyond, means
   perforation. Check that both ureteric orifices are intact and that the verumontanum and external sphincter are
   preserved. Teach: A perforation recognised in theatre changes the plan and is usually manageable; one recognised in
   recovery presents as abdominal distension, pain and fluid overload, and costs time the patient may not have. Check:
   avoid finishing the case because it is nearly finished when a perforation is seen.
12_catheter-plan.png [step.uro.catheter-plan]  Catheter secured and plan recorded: Secure the catheter to the thigh
   without tension; note the size, balloon volume and type. Write how long it stays and how it comes out (trial
   without catheter, or a contrast study first). A catheter for drainage; a three-way catheter if bleeding. Teach:
   After urethral or bladder surgery the catheter splints the repair. Check: avoid an unsecured catheter pulled out in
   recovery.
13_specimen.png [step.core.specimen]  Common. Stone fragments sent for analysis.
14_counts.png [step.core.counts]  Common.
15_debrief.png [step.core.debrief]  Common. Record clearance, the cause found and the plan to treat it.

E. HOLMIUM LASER ENUCLEATION OF THE PROSTATE (HOLEP)  (folder uro-holep/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_urine-check.png [step.uro.urine-check]  Sterile urine before instrumentation: Check the most recent urine culture
   and that any infection has been treated with a sensitive antibiotic. Ask about fever, rigors or new symptoms today;
   a febrile patient with an obstructed system is drained (stent or nephrostomy) and the definitive operation waits.
   Teach: Instrumenting infected urine can cause urosepsis within hours. Check: avoid proceeding on an old or missing
   culture.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Note the ureteric
   orifices, the median lobe and the verumontanum before any laser. Teach: Every endoscopic bladder operation starts
   with a complete map. Check: avoid missing the dome and the anterior wall because the bladder was overfilled or the
   lens never rotated upwards.
08_laser-safety.png [step.holep.laser-safety]  Laser safety check: Confirm the laser safety officer, the warning sign
   on the door and goggles for everyone in the room. Inspect the fibre tip and set the energy and frequency per
   protocol; standby until the fibre is in the scope. Teach: A holmium laser damages eyes and burns drapes. Check:
   avoid firing with the fibre tip inside the scope.
09_enucleation.png [step.holep.enucleation]  Find the capsule plane and release the apex: Make incisions at the
   bladder neck (5 and 7 o'clock, or 6 o'clock) down to the capsule, from the bladder neck towards the verumontanum.
   At the verumontanum, open the plane between adenoma and capsule and use the scope beak to sweep the adenoma off the
   capsule. Teach: The adenoma peels off the surgical capsule like an orange segment. Check: avoid tearing the apical
   mucosa with traction.
10_lobes.png [step.holep.lobes]  Enucleate the lobes into the bladder: Enucleate the median lobe (if present) and push
   it into the bladder. Enucleate each lateral lobe from apex to bladder neck along the capsule (or en bloc in one
   piece). Teach: Following the capsule all the way round leaves a smooth, wide channel with little residual tissue.
   Check: avoid undermining the trigone at the bladder neck.
11_haemostasis.png [step.core.haemostasis]  Common. Coagulate capsular vessels with the laser before morcellation; it
   is far harder after.
12_morcellation.png [step.holep.morcellation]  Morcellation in a full bladder: Exchange to the nephroscope and fill
   the bladder well, using two inflow sources if available. Bring the morcellator to a floating adenoma piece, pedal
   suction first and cut only with the tissue held in the mouth of the blade. Teach: The morcellator blades suck in
   anything they touch. Check: avoid morcellating in a collapsing bladder.
13_morcellator-injury.png [step.holep.morcellator-injury]  Bailout: bladder wall caught by the morcellator: Stop
   morcellating and release the pedal; inspect the bladder wall. A superficial injury: coagulate and continue
   carefully, or leave fragments for a second session. Teach: A morcellator injury can perforate the bladder. Check:
   avoid continuing after an unrecognised perforation.
14_perforation-check.png [step.uro.perforation-check]  Final inspection: perforation, orifices and landmarks: Inspect
   the resected area at low pressure: fat seen through the capsule or bladder wall, or black space beyond, means
   perforation. Check that both ureteric orifices are intact and that the verumontanum and external sphincter are
   preserved. Inspect the capsule and the bladder wall after morcellation. Teach: A perforation recognised in theatre
   changes the plan and is usually manageable; one recognised in recovery presents as abdominal distension, pain and
   fluid overload, and costs time the patient may not have. Check: avoid finishing the case because it is nearly
   finished when a perforation is seen.
15_three-way-catheter.png [step.uro.three-way-catheter]  Three-way catheter and continuous irrigation: Pass a three-
   way irrigating catheter of adequate size over an introducer if needed, confirming free drainage before inflating
   the balloon. Inflate the balloon with sterile water to the volume the manufacturer specifies, and record catheter
   type, size and balloon volume in the note. Teach: After a resection the bladder must stay empty and free of clot
   while the raw surface stops oozing. Check: avoid the catheter tip passing into a false passage under the bladder
   neck after a TURP; the balloon is then inflated in the prostatic fossa.
16_specimen.png [step.core.specimen]  Common. All morcellated tissue sent for histology.
17_counts.png [step.core.counts]  Common.
18_debrief.png [step.core.debrief]  Common.

F. NO-SCALPEL VASECTOMY  (folder uro-vasectomy/)
01_consent-check.png [step.core.consent-check]  Common. Permanent; not immediate; a later semen test; the failure and
   pain rates.
02_timeout.png [step.core.timeout]  Common.
03_positioning.png [step.core.positioning]  Teach and Check: the F positioning facts exactly.
04_prep-drape.png [step.core.prep-drape]  Common. Clean the scrotum; a fenestrated drape.
05_fix.png [step.vas.fix]  Three-finger fix of the vas: Feel the right vas at the back of the cord and roll it to the
   front under the median raphe. Trap it between thumb, index and middle finger (three-finger technique) so it lies
   just under thin skin. Teach: Holding the vas firmly under the skin at one spot makes the procedure short and keeps
   the vessels out of the way. Check: avoid fixing a vein instead of the vas.
06_local.png [step.vas.local]  Local anaesthetic block of the vas: Raise a skin weal over the fixed vas. Advance the
   needle along the vas towards the inguinal ring and inject a few ml into the sheath (or use a no-needle jet
   injector). Teach: A vasal block numbs the vas and its sheath; a skin weal alone is not enough. Check: avoid
   injecting into a vessel.
07_deliver.png [step.vas.deliver]  Puncture and deliver a loop of vas: Hold the vas in the ring clamp through the
   skin. Puncture skin and sheath with one blade of the sharp forceps, spread to open a small hole down to the vas.
   Teach: A small puncture with sharp forceps heals without stitches and causes fewer haematomas than a scalpel
   incision. Check: avoid spreading too widely and tearing vessels.
08_divide.png [step.vas.divide]  Divide, seal and interpose fascia: Divide the vas and remove a short segment if
   policy requires. Cauterise the lumen of each end for about 1 cm with a fine needle cautery. Teach: Sealing the cut
   lumen and putting a layer of fascia between the ends gives the lowest failure rate. Check: avoid leaving the two
   ends lying together without interposition.
09_haemostasis.png [step.core.haemostasis]  Common. Check both ends and the sheath for bleeding before returning the
   vas.
10_other-side.png [step.vas.other-side]  The other side, same way: Return the right vas and confirm no bleeding. Fix
   the left vas under the same puncture and repeat block, delivery and division. Teach: Both vasa must be divided.
   Check: avoid dividing the same vas twice and missing the other.
11_specimen.png [step.core.specimen]  Common. Short vas segments sent if local policy requires histology.
12_skin-closure.png [step.core.skin-closure]  Common. The small puncture usually needs no stitch; pressure and a dry
   dressing.
13_debrief.png [step.core.debrief]  Common. Contraception continues until the semen test is clear; give the test date
   and pot.

G. BULBAR URETHROPLASTY WITH BUCCAL MUCOSA GRAFT (RIGHT CHEEK)  (folder uro-buccal-urethroplasty/)
01_consent-check.png [step.core.consent-check]  Common. Mouth donor site and recurrence discussed.
02_timeout.png [step.core.timeout]  Common.
03_urine-check.png [step.uro.urine-check]  Sterile urine before instrumentation: Check the most recent urine culture
   and that any infection has been treated with a sensitive antibiotic. Ask about fever, rigors or new symptoms today;
   a febrile patient with an obstructed system is drained (stent or nephrostomy) and the definitive operation waits.
   Teach: Instrumenting infected urine can cause urosepsis within hours. Check: avoid proceeding on an old or missing
   culture.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the G positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Perineum prepared; the mouth prepared separately with its own
   instruments.
07_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Look at the stricture
   and pass a wire into the bladder if possible. Teach: Every endoscopic bladder operation starts with a complete map.
   Check: avoid missing the dome and the anterior wall because the bladder was overfilled or the lens never rotated
   upwards.
08_harvest.png [step.urp.harvest]  Harvest the buccal graft: Open the mouth with a gag, mark Stensen's duct opening
   (opposite the second upper molar) and stay below it. Mark a graft about 1.5 to 2.5 cm wide and as long as needed;
   inject local anaesthetic with adrenaline. Teach: Inner cheek mucosa is wet, thick and takes well. Check: avoid
   harvesting over the duct opening.
09_expose.png [step.urp.expose]  Expose the bulbar urethra: Make a midline or inverted-Y perineal incision. Split the
   bulbospongiosus muscle in the midline to show the corpus spongiosum. Teach: A midline perineal approach with the
   bulbospongiosus split gives access to the whole bulbar urethra. Check: avoid damaging the bulbar arteries.
10_open.png [step.urp.open]  Open the stricture into healthy urethra: Open the urethra along the stricture (dorsal or
   ventral stricturotomy). Extend the opening beyond the stricture at both ends until a 24 to 26 Fr bougie passes
   easily. Teach: Recurrence comes from scar left at the ends. Check: avoid stopping in scar at either end.
11_graft.png [step.urp.graft]  Quilt and sew the graft: Lay the graft on its bed (corpora dorsally or spongiosum
   ventrally) and quilt it with fine sutures so it lies flat. Sew the urethral edges to the graft over a catheter with
   fine absorbable sutures, apex first. Teach: The graft lives on its bed in the first days. Check: avoid a loose
   graft with fluid under it.
12_catheter-plan.png [step.uro.catheter-plan]  Catheter secured and plan recorded: Secure the catheter to the thigh
   without tension; note the size, balloon volume and type. Write how long it stays and how it comes out (trial
   without catheter, or a contrast study first). Catheter stays 2 to 3 weeks; urethrogram before removal. Teach: After
   urethral or bladder surgery the catheter splints the repair. Check: avoid an unsecured catheter pulled out in
   recovery.
13_haemostasis.png [step.core.haemostasis]  Common. Check the spongiosum edges and the cheek.
14_skin-closure.png [step.core.skin-closure]  Common. Close bulbospongiosus and the perineum in layers.
15_counts.png [step.core.counts]  Common.
16_debrief.png [step.core.debrief]  Common. Record stricture length, graft size and position, and the urethrogram
   date.

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
  surgx-uro-flexible-cystoscopy-steps.zip   (folder uro-flexible-cystoscopy/)
  surgx-uro-transperineal-prostate-biopsy-steps.zip   (folder uro-transperineal-prostate-biopsy/)
  surgx-uro-optical-urethrotomy-steps.zip   (folder uro-optical-urethrotomy/)
  surgx-uro-cystolitholapaxy-steps.zip   (folder uro-cystolitholapaxy/)
  surgx-uro-holep-steps.zip   (folder uro-holep/)
  surgx-uro-vasectomy-steps.zip   (folder uro-vasectomy/)
  surgx-uro-buccal-urethroplasty-steps.zip   (folder uro-buccal-urethroplasty/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
