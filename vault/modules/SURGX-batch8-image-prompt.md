---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 8: Gemini image prompt (128 images, 7 operations)

Built 2026-11-21 from the real steps in `surgx/procedures/<id>.json`, the general (non-eye) version of the batch 6 and 7 generator. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant surgeons (transplant, cardiothoracic and plastic surgery). You are making 128 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Deceased donor kidney transplant (RIGHT iliac fossa)           21 images
  B. Laparoscopic living donor nephrectomy (LEFT kidney)            20 images
  C. Aortic valve replacement on bypass                             20 images
  D. Subxiphoid pericardial window                                  16 images
  E. Escharotomy (LEFT arm and chest)                               15 images
  F. Rhomboid (Limberg) flap (RIGHT cheek)                          17 images
  G. Unilateral cleft lip repair (LEFT side)                        19 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (British Transplantation Society guidelines, the EAU renal transplant guideline, STS and EACTS valve guidance, the ABA and BBA burns guidance, ACPA cleft care standards, operative atlases (Hinman, Kirklin, Grabb and Smith)).
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
- Viewpoint: the surgeon's view of the operative field for open steps; the laparoscope monitor view for laparoscopic steps; a clean anatomical cross-section or cut-away inset when the trainee must see a layer or a structure behind; a whole-body view for positioning; a theatre view for team and safety steps.
- The key structure is where the eye lands first: sharp and well lit, the background slightly softened. A subtle glow
  or outline on the key structure is fine. A small circular close-up or cross-section inset is allowed when the key
  detail is tiny or lies deep or inside an organ.
- Instruments correct in size and position, entering through the correct incision.
- Orientation and laterality: state the side in every image. The kidney transplant goes in the RIGHT iliac fossa; the donor nephrectomy takes the LEFT kidney; the escharotomy is on a burnt LEFT arm and the chest; the rhomboid flap closes a defect on the RIGHT cheek; the cleft lip is on the baby's LEFT. Open views have the patient's head at the TOP of the frame unless the step needs otherwise. Never flip a side between images of the same operation.
- BODIES MUST BE WHOLE AND CONNECTED. Every hand belongs to an arm that runs to a shoulder of a visible body. The same
  patient keeps the same face, age and hair in every image of an operation; never swap the patient.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal. Fat yellow ONLY where real fat is; arteries thick-walled and red,
  veins thinner and blue-purple; the ureter a pale, thin, peristaltic tube; burnt eschar leathery grey-brown or white;
  pericardium a glistening white-grey sac; valve leaflets thin, white and calcified when stenotic.
- Patients covered and dignified; only the operative field exposed.

PRECISE FACTS (draw exactly this)
Positioning (a NEW whole-body view for each operation; never reuse a generic theatre scene):
- A. Supine, arms out, a urinary catheter with the bladder fill line; the incision a curved Rutherford Morison line in
  the RIGHT lower abdomen.
- B. RIGHT side down in a full lateral (flank) position, the table flexed slightly, an axillary roll, pillows between
  the legs, strapped and padded; the LEFT flank up.
- C and D. Supine, arms by the sides, the chest exposed from neck to umbilicus; C with a central venous line and
  arterial line; D head of the table raised about 30 degrees.
- E. Supine on a warmed burns table, the burnt LEFT arm abducted on a board; the chest bare.
- F. Supine, head turned to the LEFT so the RIGHT cheek faces up, on a head ring.
- G. A baby of about 3 months supine on a warming mattress, a shoulder roll, the head on a ring, an oral RAE tube taped
  to the lower lip in the midline.
Step-specific facts:
- A. On the back table: the donor kidney in ice slush with its renal artery on an aortic (Carrel) patch, the vein
  and the ureter. In the patient: the external iliac artery and vein exposed extraperitoneally; the renal vein sewn
  END-TO-SIDE to the external iliac vein and the renal artery END-TO-SIDE to the external iliac artery with fine
  continuous sutures; on reperfusion the kidney turns from pale to pink and firm; the ureter tunnelled into the bladder
  dome over a double-J stent.
- B. Four ports: camera at the umbilicus, working ports in the LEFT upper and lower abdomen, a Pfannenstiel line for
  extraction. The colon reflected medially; the gonadal vein and ureter lifted together; the renal vein with its
  gonadal, adrenal and lumbar tributaries; the artery clipped with locking clips (never a single plain clip) or
  stapled; the kidney taken out in a bag; the artery ALWAYS divided before the vein.
- C. Median sternotomy; the pericardium opened and slung; an aortic cannula in the ascending aorta and a two-stage
  venous cannula in the right atrium; the cross-clamp on the aorta; a transverse aortotomy above the valve; the
  calcified three-leaflet valve excised and the annulus decalcified; pledgeted mattress sutures round the annulus; the
  prosthesis lowered and tied down; the aorta closed and de-aired; pacing wires; two chest drains; steel wires closing
  the sternum.
- D. A short vertical incision over the xiphoid; the xiphoid lifted or excised; the pericardium grasped and a square
  about 3 by 3 cm cut out; straw or blood-stained fluid draining into suction; the specimen sent; a drain left in the
  pericardium.
- E. Full-thickness eschar on the LEFT arm cut along the MID-MEDIAL and MID-LATERAL lines with diathermy, down to
  bleeding, bulging fat, extending onto the hand along the dorsum between the metacarpals; on the chest the cuts run
  along both anterior axillary lines joined by a transverse cut below the costal margin (a box) so the chest can move.
- F. A rhombus with 60 and 120 degree angles drawn around a small lesion on the RIGHT cheek; the flap drawn from the
  short diagonal extended by its own length, then back parallel to the adjacent side; after excision the flap raised in
  the subcutaneous plane and transposed into the defect; the donor site closed first; fine interrupted sutures.
- G. A complete or incomplete cleft of the upper lip on the baby's LEFT; the Millard rotation-advancement markings in
  blue dots on the lip (dots only, no numbers); the orbicularis muscle freed and rejoined across the cleft; the nasal
  floor and alar base repositioned; a neat three-layer closure (mucosa, muscle, skin) with the white roll lined up.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 128 images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern operative surgery atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs; neutral clean background.
- Within each operation the same patient (an adult, or the same baby for the cleft lip), the same team and the same instrument set in every image. Staff in
  caps and masks, generic faces, no real or identifiable person.
- Landscape 4:3, exactly 1600 x 1200 px, PNG.

THE STEPS  (filename [step id]  scene : teaching point : check)
Each line quotes what that step does in the app. Draw the ONE moment that shows it best. Where a step is a check,
a decision or a bailout (organ check, perfusion check, major bleed, flap compromise, physiology gate), draw the
people and the thing being checked or the complication being handled, for example the team checking a blank organ
transport label against a blank sheet, or the surgeon pressing a gauze on a bleeding renal vessel while the
anaesthetist calls for blood. Use the PRECISE FACTS above wherever they apply.

COMMON SAFETY STEPS (draw them for each operation with that operation's patient, team and setting)
- consent-check: pre-op bay, the awake patient, the surgeon marking an arrow on the operative SIDE where the
  operation has a side (for the baby, the parent sits beside the cot and signs a form with grey lines). Teach: confirm
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

A. DECEASED DONOR KIDNEY TRANSPLANT (RIGHT ILIAC FOSSA)  (folder kidney-transplant/)
01_consent-check.png [step.core.consent-check]  Common. Includes the donor-derived risks and the immunosuppression
   commitment.
02_organ-check.png [step.tx.organ-check]  Donor organ and compatibility check: Confirm recipient identity, ABO
   compatibility of donor and recipient, a negative crossmatch and the donor information. Confirm the organ (side,
   anatomy, number of arteries) against the offer paperwork; note the cold ischaemia time. Teach: Transplanting into
   the wrong recipient, or across an incompatible blood group, can cause hyperacute rejection. Check: avoid relying on
   one person's check.
03_timeout.png [step.core.timeout]  Common. Read recipient and donor ABO, the crossmatch result, organ side and cold
   ischaemia time aloud.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis and the induction immunosuppression timed
   per the transplant protocol.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_bench.png [step.tx.bench]  Bench preparation of the kidney: Keep the kidney in a bowl of ice slush throughout. Trim
   excess perirenal fat, tie lymphatics and small vessels at the hilum, and identify the artery (with its Carrel
   patch), the vein and the ureter. Teach: Preparing the kidney on ice prevents warm injury and shows the vessels and
   ureter so the anastomoses are planned before the clamps go on. Check: avoid stripping the ureter.
08_exposure.png [step.tx.exposure]  Extraperitoneal exposure of the iliac vessels: Make a curvilinear (Rutherford
   Morison) incision in the iliac fossa; divide the muscles and push the peritoneum medially. Divide or preserve the
   inferior epigastric vessels and the round ligament or protect the spermatic cord. Teach: The iliac fossa gives a
   retroperitoneal bed close to the bladder. Check: avoid cutting lymphatics without ligation.
09_vessel-control.png [step.vasc.vessel-control]  Proximal and distal control before opening the artery: Expose the
   artery above and below the planned arteriotomy, in healthy tissue away from haematoma or disease where possible.
   Pass slings or tapes around each vessel, including the important branches, and identify where each clamp will go
   before applying any. Clamp the external iliac vein and artery only when the kidney is ready on ice. Teach: An
   artery opened without control bleeds at arterial pressure into a field you can no longer see. Check: avoid clamping
   a heavily calcified segment, which cracks the plaque and causes a dissection.
10_venous.png [step.tx.venous]  Renal vein to external iliac vein anastomosis: Clamp the external iliac vein, make a
   venotomy matched to the renal vein, and sew end to side with a fine non-absorbable continuous suture. Orient the
   kidney before suturing so the vein does not twist when the graft is placed. Teach: The venous anastomosis is
   usually done first. Check: avoid a twisted anastomosis.
11_end-to-side-anastomosis.png [step.vasc.end-to-side-anastomosis]  End-to-side anastomosis: Make a clean longitudinal
   arteriotomy in the softest available segment, and cut the end of the conduit obliquely (spatulated) so that its
   opening matches the arteriotomy. Start at the heel, using a parachute technique where it helps visibility, and keep
   equal, small bites with the needle passed from inside to outside on the diseased side so that plaque is pinned
   rather than lifted. Renal artery (Carrel patch) to the external iliac artery, end to side. Teach: Most early graft
   and fistula failures are technical and sit at an anastomosis: a narrowed heel or toe, a lifted intimal flap, a
   purse-stringed suture line or a twisted conduit. Check: avoid picking up the back wall in a toe suture.
12_restore-flow.png [step.vasc.restore-flow]  Restoring flow with the anaesthetist warned: Tell the anaesthetist
   before releasing each clamp so that volume and vasopressors are ready. Release slowly, one limb or one clamp at a
   time, and be ready to reapply if the pressure falls sharply. Warn the anaesthetist; the blood pressure target is
   high enough to perfuse the graft. Record the time of reperfusion. Teach: Declamping releases cold, acidic,
   potassium-rich blood into the circulation and drops the pressure suddenly. Check: avoid releasing both iliac clamps
   together after a long clamp time.
13_perfusion-check.png [step.vasc.perfusion-check]  Confirming distal perfusion before leaving theatre: Examine both
   feet (or hands) under the drapes: colour, capillary refill, palpable pulses, and handheld Doppler signals. Perform
   completion angiography or duplex when the result is in doubt, or routinely after embolectomy. The kidney turns pink
   and firm uniformly; watch for urine from the ureter. Teach: A technically perfect anastomosis with a thrombosed or
   embolised distal bed is a failed operation. Check: avoid draping the feet out of view, so that distal ischaemia is
   found in recovery.
14_poor-perfusion.png [step.tx.poor-perfusion]  Bailout: a graft that does not perfuse: Check the blood pressure with
   the anaesthetist and the position of the kidney for kinks or twists. Feel and Doppler the artery and vein; look for
   a dissection flap or thrombosis. Teach: Patchy, soft or dusky perfusion after reperfusion means a technical problem
   until proven otherwise, and it is reversible only while the patient is still on the table. Check: avoid closing
   over a poorly perfused graft and hoping.
15_ureter.png [step.tx.ureter]  Ureteroneocystostomy: Fill the bladder through the catheter and expose its dome or
   side. Shorten the ureter to a length that lies without tension, keeping its blood supply. Teach: A short, well-
   vascularised ureter joined to the bladder with an anti-reflux tunnel (Lich-Gregoir) gives the fewest leaks and
   stenoses. Check: avoid a long, ischaemic ureter.
16_dj-stent.png [step.uro.dj-stent]  Double-J stent placement and position check: Choose the stent diameter and length
   for the patient and the ureter; the length can be estimated from height or measured with a graduated ureteric
   catheter. Pass the stent over the guidewire with the pusher, watching the proximal end reach the renal pelvis on
   fluoroscopy and the distal end at the orifice through the cystoscope. A double-J stent across the
   ureteroneocystostomy; record it for removal. Teach: A stent drains an obstructed or injured ureter, but a stent in
   the wrong place either drains nothing or causes pain, haematuria and migration. Check: avoid pulling the wire out
   before the proximal coil is seen in the pelvis, leaving the stent in the mid-ureter.
17_haemostasis.png [step.core.haemostasis]  Common. Check the hilum and the anastomoses; immunosuppressed patients
   bleed late.
18_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. A drain near the graft, away from the anastomoses. Teach: A drain tells you
   what is happening in a space you cannot see. Check: avoid a drain placed 'just in case', which then becomes a route
   for infection.
19_counts.png [step.core.counts]  Common.
20_skin-closure.png [step.core.skin-closure]  Common.
21_debrief.png [step.core.debrief]  Common. Hand over ischaemia times, the anastomoses, the stent, the fluid and blood
   pressure plan, and when to scan the graft.

B. LAPAROSCOPIC LIVING DONOR NEPHRECTOMY (LEFT KIDNEY)  (folder lap-donor-nephrectomy/)
01_consent-check.png [step.core.consent-check]  Common. Donor consent is separate from the recipient's; confirm the
   authorisation papers are complete.
02_donor-check.png [step.ldn.donor-check]  Donor safety and authorisation check: Confirm the donor's identity, the
   authorisation documents, and that the donor still wishes to proceed, privately. Review the CT angiogram: side,
   number and length of arteries and veins, the ureter. Teach: The donor gains nothing medically, so every safeguard
   is checked again on the day: identity, legal authorisation, free consent and the anatomy that was planned. Check:
   avoid proceeding with incomplete authorisation.
03_timeout.png [step.core.timeout]  Common. Confirm side, number of arteries, the stapler for the artery, and that the
   recipient team is ready.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
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
10_splenic-flexure.png [step.bowel.splenic-flexure]  Splenic flexure mobilisation: Decide early whether length is
   needed: routinely for a low anastomosis, selectively for a sigmoid colectomy. Combine approaches: medial
   (continuing the retromesocolic plane up over the pancreas), lateral (along the white line) and from the lesser sac
   (dividing the gastrocolic omentum to the left of the middle colic vessels). Mobilise the descending colon and
   splenic flexure medially to expose the kidney, protecting spleen and pancreas. Teach: A colorectal anastomosis must
   lie in the pelvis without tension. Check: avoid downward traction on the colon that avulses the splenic capsule.
11_ureter.png [step.ldn.ureter]  Mobilising the ureter with the gonadal vein: Identify the gonadal vein and the ureter
   at the pelvic brim. Lift them together off the psoas, preserving the tissue between them up to the lower pole.
   Teach: The ureter's blood supply runs in the tissue around it. Check: avoid stripping the ureter.
12_vein.png [step.ldn.vein]  Dissecting the left renal vein and its tributaries: Expose the renal vein from the kidney
   to its crossing of the aorta. Clip and divide the gonadal, adrenal and lumbar veins. Teach: The left renal vein's
   tributaries (adrenal, gonadal, lumbar) must be divided to give length, and a missed lumbar vein tears when the
   kidney is lifted. Check: avoid missing a posterior lumbar vein.
13_artery.png [step.ldn.artery]  Dissecting the renal artery: Dissect the artery posterior to the vein back to its
   origin at the aorta. Divide the lymphatic and neural tissue around it with care; avoid traction (spasm). Teach:
   Length on the artery helps the recipient anastomosis. Check: avoid traction on the artery causing spasm.
14_extraction-site.png [step.ldn.extraction-site]  Extraction incision ready before the vessels are divided: Make the
   Pfannenstiel (or other) extraction incision down to, but not through, the peritoneum, or place a hand port. Give
   heparin or mannitol per protocol; confirm the recipient team and the ice and perfusion fluid are ready. Teach: Warm
   ischaemia starts when the artery is stapled. Check: avoid dividing the artery before the extraction route is ready.
15_divide.png [step.ldn.divide]  Dividing the artery and vein and retrieving the kidney: Staple and divide the renal
   artery with a transfixing vascular stapler (or a secure locking technique per protocol; never non-transfixing clips
   alone). Staple and divide the renal vein. Teach: The vascular division is the most dangerous moment for the donor:
   the arterial stump must be secure, and the kidney must come out quickly. Check: avoid non-transfixing clips on the
   artery stump.
16_major-bleed.png [step.hpb.major-bleed]  Major haemorrhage: press, tell, call, then repair or pack: Put pressure on
   the bleeding: a finger, a swab on a stick or packs, and hold it. Do not clamp or clip into a pool of blood. Tell
   the anaesthetist clearly, ask for the major haemorrhage protocol to be activated if blood loss is heavy, and ask
   for a second experienced surgeon, a cell saver and vascular instruments. Bleeding from the renal artery stump or
   the vena cava is the donor's main life-threatening risk: press, tell, call, convert. Teach: In upper abdominal
   surgery the large veins (portal, superior mesenteric, splenic, hepatic and the cava) tear rather than cut, and
   clamping blindly makes a small hole large. Check: avoid blind clamping or deep suturing into a field of blood,
   which converts a bleed into a bile duct or pancreatic injury.
17_flush.png [step.ldn.flush]  Cold flush and checking the stumps: On the bench: flush the kidney with cold
   preservation solution until the effluent is clear; record warm ischaemia time. In the donor: reinflate, lower the
   pressure, inspect the arterial and venous stumps, the adrenal bed, spleen and colon. Teach: The kidney is cooled
   and flushed at once; meanwhile the donor's vascular stumps and the field are checked under lower pneumoperitoneum.
   Check: avoid not re-inspecting the stumps at low pressure.
18_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Close the extraction incision in layers. Teach: A port-site
   hernia through an unclosed 10 mm fascial defect can strangulate, and it presents days later to someone who was not
   in theatre. Check: avoid removing all ports at once with the camera already out.
19_counts.png [step.core.counts]  Common.
20_debrief.png [step.core.debrief]  Common.

C. AORTIC VALVE REPLACEMENT ON BYPASS  (folder aortic-valve-replacement/)
01_consent-check.png [step.core.consent-check]  Common. Record the prosthesis choice and the reasons.
02_timeout.png [step.core.timeout]  Common. Confirm the prosthesis type and size range available, blood products,
   perfusion and echo ready.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_sternotomy-open.png [step.thor.sternotomy-open]  Opening the sternum in the midline: Mark the midline from the
   sternal notch to the xiphoid, palpating the intercostal spaces on both sides; incise skin and divide the presternal
   tissue and periosteum exactly on the mark with diathermy. Clear the space behind the manubrium by dividing the
   interclavicular ligament and sweeping a finger behind the notch, and free the xiphoid so that the retrosternal
   plane is open at both ends. Teach: A sternotomy that wanders off the midline produces a weak, asymmetric closure
   and is the commonest technical root of sternal dehiscence. Check: avoid a paramedian cut that splits into the
   costal cartilages.
07_pericardium-open.png [step.thor.pericardium-open]  Spreading the sternum and opening the pericardium: Secure
   haemostasis of the periosteum and marrow edges with diathermy and minimal bone wax, then open the retractor slowly
   and only as far as the operation needs, placed low on the sternum. Divide the thymic remnant between ties or clips,
   staying clear of the innominate vein and its thymic branches. Teach: Gradual retraction avoids rib fractures and
   brachial plexus stretch, and a controlled pericardiotomy exposes the heart without injuring the innominate vein,
   the phrenic nerves or the heart itself. Check: avoid opening the retractor fully and quickly, fracturing the first
   rib and stretching the brachial plexus.
08_cpb.png [step.avr.cpb]  Heparinisation, cannulation and starting bypass: Give heparin and confirm an adequate
   activated clotting time before cannulation. Place purse strings and cannulate the ascending aorta (checked by
   epiaortic scan if calcified) and the right atrium. Teach: Bypass lets the heart be stopped and opened. Check: avoid
   cannulating before the ACT is confirmed.
09_cardioplegia.png [step.avr.cardioplegia]  Cross-clamp and cardioplegia: Apply the cross-clamp to the ascending
   aorta. Give cardioplegia antegrade (root), via the coronary ostia, or retrograde via the coronary sinus as
   appropriate; repeat at intervals. Teach: Cardioplegia arrests and protects the heart. Check: avoid root
   cardioplegia in significant regurgitation.
10_excise.png [step.avr.excise]  Aortotomy, leaflet excision and decalcification: Make an oblique or transverse
   aortotomy above the sinotubular junction. Excise the leaflets and debride calcium from the annulus, with a sponge
   in the ventricle to catch debris. Teach: Calcium must be removed to seat the prosthesis, but fragments that fall
   into the ventricle or coronaries cause stroke or infarction. Check: avoid leaving loose calcium.
11_sutures.png [step.avr.sutures]  Sizing and placing the annular sutures: Size the annulus with the manufacturer's
   sizers. Place pledgeted horizontal mattress sutures around the annulus, keeping them superficial below the right-
   non-coronary commissure. Teach: Correct sizing avoids patient-prosthesis mismatch; suture depth near the conduction
   tissue decides whether the patient needs a pacemaker. Check: avoid undersizing.
12_seat.png [step.avr.seat]  Seating the valve and checking the coronaries: Lower the prosthesis into the annulus and
   tie the sutures evenly. Check the coronary ostia are not obstructed by the sewing ring or struts. Teach: A properly
   seated valve does not leak around its edge or block a coronary ostium; mechanical leaflets must move freely. Check:
   avoid obstructing a coronary ostium.
13_deair.png [step.avr.deair]  Closing the aorta and de-airing: Close the aortotomy in two layers. De-air the left
   heart through the root vent and the ventricular vent while the anaesthetist inflates the lungs; check with
   transoesophageal echo. Teach: Air left in the left heart embolises to the brain or the right coronary artery when
   the heart starts to eject. Check: avoid releasing the clamp before de-airing.
14_wean.png [step.avr.wean]  Weaning from bypass and checking the valve: Rewarm, establish rhythm (pacing if heart
   block), and wean from bypass with the anaesthetist and perfusionist. Echo: gradient across the valve, any
   paravalvular leak, ventricular function, aortic root. Teach: Transoesophageal echo confirms the valve works before
   decannulation, when it can still be fixed. Check: avoid accepting a significant paravalvular leak.
15_heparin-reversal.png [step.vasc.heparin-reversal]  Deciding on, and giving, heparin reversal: Decide with the
   anaesthetist whether to reverse, the dose per local protocol, and the timing, once flow is restored and the repair
   is satisfactory. In cardiac surgery give protamine only after separation from bypass and venous decannulation, and
   tell the perfusionist so that the pump suckers are switched off before it starts. Protamine after decannulation,
   watching for reaction. Teach: Protamine reduces wound and mediastinal bleeding, but it can cause severe
   hypotension, pulmonary hypertension or anaphylaxis, and given at the wrong moment it clots the repair or the bypass
   circuit. Check: avoid protamine running while the cardiotomy suckers are still returning blood to the circuit.
16_pacing-wires.png [step.thor.pacing-wires]  Temporary epicardial pacing wires: Decide with the anaesthetist which
   wires are needed (ventricular, atrial, or both) from the rhythm on and off bypass and the operation done. Place the
   wires superficially in the epicardium away from coronary arteries and grafts, and bring them out through the skin
   below the incision on the agreed sides. Teach: Conduction and rhythm disturbances are common after cardiac surgery,
   and a wire placed now is far safer than an emergency transvenous wire later. Check: avoid wires placed through a
   coronary artery or a graft.
17_chest-drains.png [step.thor.chest-drains]  Placing mediastinal and pleural drains: Place drains where fluid and air
   will collect: an apical and, when needed, a basal pleural drain after lung surgery; mediastinal and any opened
   pleural space after a sternotomy. Bring each drain out through a separate stab incision under direct vision,
   passing over the upper border of the rib so that the intercostal bundle is spared, and away from the sternal wound.
   Teach: A drain that is kinked, blocked or wrongly placed gives false reassurance while blood or air collects, and
   retained blood after cardiac or thoracic surgery causes tamponade, a trapped lung and empyema. Check: avoid a drain
   lying against a graft or across the heart.
18_sternal-closure.png [step.thor.sternal-closure]  Sternal closure with wires: Before closure, confirm haemostasis of
   the sternal edges, the internal mammary beds and the wire sites, and that the counts are correct. Pass stainless
   steel wires through the manubrium and around the body of the sternum in the intercostal spaces, close to the
   sternal edge, keeping clear of the internal mammary vessels and any arterial graft pedicle. Teach: Sternal
   instability leads to dehiscence and deep sternal wound infection, which carry substantial mortality. Check: avoid
   wires placed through the bone too near the edge, which cut out when the patient coughs.
19_counts.png [step.core.counts]  Common. Count every swab, needle and pledget before closing the pericardium and
   sternum.
20_debrief.png [step.core.debrief]  Common. Hand over the prosthesis, bypass and cross-clamp times, rhythm, pacing
   settings and the anticoagulation plan.

D. SUBXIPHOID PERICARDIAL WINDOW  (folder subxiphoid-pericardial-window/)
01_consent-check.png [step.core.consent-check]  Common. Includes the possibility of sternotomy.
02_timeout.png [step.core.timeout]  Common. Anaesthetic plan for tamponade discussed; the surgeon scrubbed and ready
   before induction.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Prep and drape the chest and upper abdomen before induction.
06_induction.png [step.pw.induction]  Induction in tamponade with the surgeon ready: Monitor invasively before
   induction where possible. Have the patient prepped and draped, and the surgeon scrubbed with the knife ready,
   before the anaesthetist induces. Teach: General anaesthesia and positive pressure ventilation reduce venous return;
   in tamponade this can stop the circulation. Check: avoid inducing an unprepared patient.
07_incision.png [step.pw.incision]  Upper midline incision and excision of the xiphoid: Make an upper midline incision
   over the xiphoid down to the linea alba, staying out of the peritoneum. Excise or retract the xiphoid process.
   Teach: The subxiphoid route reaches the inferior pericardium without opening the sternum or the pleura. Check:
   avoid entering the peritoneum.
08_pericardium.png [step.pw.pericardium]  Identifying and opening the pericardium: Identify the pericardium as a
   tense, smooth membrane; feel the heart beating behind it. Grasp it with two Allis forceps and lift; open it between
   them with a knife or scissors. Teach: The pericardium is opened under direct vision so the fluid escapes and the
   heart falls away from the knife. Check: avoid stabbing blindly.
09_window.png [step.pw.window]  Creating the window and exploring: Excise a piece of pericardium about 3 to 4 cm
   across. Break down loculations gently with a finger; inspect the visible pericardium for tumour or exudate. Teach:
   Excising a piece of pericardium both prevents early closure and provides tissue for diagnosis. Check: avoid too
   small a window.
10_specimen.png [step.core.specimen]  Common. Pericardial fluid for cytology, microscopy and culture (including
   tuberculosis), and the excised pericardium for histology.
11_chest-drains.png [step.thor.chest-drains]  Placing mediastinal and pleural drains: Place drains where fluid and air
   will collect: an apical and, when needed, a basal pleural drain after lung surgery; mediastinal and any opened
   pleural space after a sternotomy. Bring each drain out through a separate stab incision under direct vision,
   passing over the upper border of the rib so that the intercostal bundle is spared, and away from the sternal wound.
   A single large drain into the pericardial space through a separate stab incision. Teach: A drain that is kinked,
   blocked or wrongly placed gives false reassurance while blood or air collects, and retained blood after cardiac or
   thoracic surgery causes tamponade, a trapped lung and empyema. Check: avoid a drain lying against a graft or across
   the heart.
12_bailout.png [step.pw.bailout]  Bailout: cardiac or coronary injury: Press a finger on the bleeding point; tell the
   anaesthetist and call for a cardiac surgeon and blood. Extend to a sternotomy if trained and equipped, or keep
   pressure until help arrives. Teach: A tear in the right ventricle or a coronary vessel bleeds massively; the window
   does not give enough access to repair it. Check: avoid blind suturing through a small window.
13_haemostasis.png [step.core.haemostasis]  Common.
14_counts.png [step.core.counts]  Common.
15_skin-closure.png [step.core.skin-closure]  Common. Close the linea alba carefully to limit incisional hernia.
16_debrief.png [step.core.debrief]  Common.

E. ESCHAROTOMY (LEFT ARM AND CHEST)  (folder escharotomy/)
01_consent-check.png [step.core.consent-check]  Common. Often an emergency: record a best-interests decision if the
   patient cannot consent.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Routine systemic antibiotics are not indicated for burns; tetanus
   status checked.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_indication.png [step.esc.indication]  Confirming the indication and marking the lines: Confirm a full-thickness
   circumferential burn and the evidence of constriction (perfusion, ventilation). Mark the lines with the limb in the
   anatomical position: mid-medial and mid-lateral. Teach: Escharotomy is for constriction by full-thickness burn;
   doing it on partial-thickness burns adds wounds without benefit, and missing it costs limbs or ventilation. Check:
   avoid treating swelling of a partial-thickness burn as constriction.
07_limb.png [step.esc.limb]  Limb escharotomy: Incise along the mid-lateral and, if needed, mid-medial lines, from
   normal skin above to normal skin below. Deepen through eschar until fat bulges and the edges separate; do not cut
   into the deep fascia unless a fasciotomy is intended. Teach: The incision must go through the whole eschar into the
   fat, along the whole constricted segment, so the tissue can spring apart. Check: avoid stopping short of the
   constricted segment.
08_hand.png [step.esc.hand]  Hand and digit escharotomy (when needed): Release the dorsum of the hand with incisions
   over the second and fourth intermetacarpal spaces. Release digits along the mid-lateral line on the non-contact
   side (ulnar side of the index to ring fingers, radial side of the thumb and little finger), keeping dorsal to the
   neurovascular bundle. Teach: The hand is the most common place for an escharotomy to be needed and also the easiest
   place to injure nerves and tendons. Check: avoid volar incisions on the digits.
09_chest.png [step.esc.chest]  Chest and abdominal escharotomy: Incise along both anterior axillary lines from the
   clavicle level down to the costal margin. Join them with a transverse incision along the costal margin, and across
   the upper chest if needed; extend onto the abdomen if it is also constricted. Teach: A stiff burned chest wall
   cannot expand; releasing it as a mobile shield restores ventilation within minutes. Check: avoid only longitudinal
   lines with no transverse release.
10_release-check.png [step.esc.release-check]  Checking the release worked: Re-check capillary refill, Doppler signals
   and digit oximetry, and the ventilation pressures. If perfusion remains poor, measure compartment pressures or
   proceed to fasciotomy, with burns or plastics advice. Teach: Perfusion should improve within minutes. Check: avoid
   assuming the escharotomy is enough when perfusion has not returned.
11_haemostasis.png [step.core.haemostasis]  Common. Bipolar or electrocautery on bleeding points in the fat;
   escharotomies can bleed more than expected.
12_pack.png [step.st.pack]  Irrigation, packing and leaving the wound open: Irrigate with saline until the effluent is
   clear. Pack lightly if at all: the purpose is to keep the skin edges apart, not to fill the cavity under pressure.
   Cover the incisions with an antimicrobial burn dressing; do not pack tightly. Teach: An abscess cavity closed
   primarily becomes an abscess again. Check: avoid tight packing, which causes pain and pressure necrosis.
13_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Re-check perfusion distally and record it. Teach: Deficits and
   compartment syndrome that are found early are treatable. Check: avoid assuming the limb is fine because it was fine
   before.
14_counts.png [step.core.counts]  Common.
15_debrief.png [step.core.debrief]  Common.

F. RHOMBOID (LIMBERG) FLAP (RIGHT CHEEK)  (folder rhomboid-flap/)
01_consent-check.png [step.core.consent-check]  Common. Mark the lesion and the planned flap; photograph.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the F positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_plan.png [step.flap.plan]  Planning the rhombus and the flap: Mark the defect as a rhombus with angles of 60 and
   120 degrees, with the short diagonal along the line of maximal extensibility. Extend the short diagonal by one side
   length, then draw a line parallel to an adjacent side of the same length: this is the flap. Teach: A rhomboid flap
   works only if it borrows skin from where it is lax. Check: avoid choosing the flap by habit rather than by laxity.
07_local.png [step.flap.local]  Local anaesthetic with adrenaline: Infiltrate the lesion and the whole flap territory
   in the subcutaneous plane, calculating the maximum safe dose. Wait several minutes before incising. Teach:
   Infiltration with adrenaline gives anaesthesia and a drier field; waiting for the vasoconstriction makes the
   dissection easier. Check: avoid exceeding the maximum dose for the weight.
08_excise.png [step.flap.excise]  Excising the lesion as a rhombus: Incise along the rhombus to the planned depth
   (into subcutaneous fat or deeper as the lesion requires). Remove the specimen in one piece and orientate it. Teach:
   The excision follows the marked rhombus and the oncological margin; it is checked before any flap is raised. Check:
   avoid a shallow excision under a deep lesion.
09_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Orientate the specimen with a stitch (for example long superior) for margin reporting. Teach:
   Margin status and nodal yield are reported by the pathologist, but only from a specimen they can orient. Check:
   avoid a single suture with no stated convention.
10_raise.png [step.flap.raise]  Raising the flap: Incise the flap lines and raise it in the subcutaneous plane with a
   little fat under the dermis. Undermine around the defect and the donor site in the same plane to let the tissues
   move. Teach: A random-pattern flap lives on the subdermal plexus at its base; raising it in the right plane keeps
   that intact. Check: avoid raising it too thin, cutting the plexus.
11_transpose.png [step.flap.transpose]  Transposing the flap and closing the donor site: Place the first (key) suture
   to close the donor site at the point of greatest tension. Rotate and transpose the flap into the defect. Teach: The
   key stitch closes the donor site first; once that is closed, the flap should fall into the defect with little
   tension. Check: avoid forcing the flap in before the donor site is closed.
12_haemostasis.png [step.core.haemostasis]  Common. Bipolar only on the bed; avoid cautery on the flap edges.
13_inset.png [step.flap.inset]  Insetting the flap: Place interrupted buried deep dermal absorbable sutures, starting
   with the corners. Close the skin with fine interrupted or running sutures; a half-buried corner stitch for the flap
   tip. Teach: Deep dermal sutures take the tension so the skin sutures only align the edges; this gives the best scar
   and protects the flap tip. Check: avoid skin sutures taking the tension.
14_compromise.png [step.flap.compromise]  Bailout: a pale or congested flap: Check the colour and capillary refill of
   the flap tip. If it is pale, remove sutures under tension and check the base is not kinked; if congested, look for
   a haematoma. Teach: A flap that is white or blue at the end of surgery is under tension or kinked. Check: avoid
   leaving a blanched flap closed under tension.
15_counts.png [step.core.counts]  Common.
16_skin-closure.png [step.core.skin-closure]  Common. A light, non-compressive dressing over the flap.
17_debrief.png [step.core.debrief]  Common.

G. UNILATERAL CLEFT LIP REPAIR (LEFT SIDE)  (folder unilateral-cleft-lip-repair/)
01_consent-check.png [step.core.consent-check]  Common. Consent with the parents; confirm the side of the cleft.
02_physiology-gate.png [step.paeds.physiology-gate]  Paediatric physiology check before anaesthesia: Confirm today's
   weight and that drug and fluid doses on the chart are calculated from it. Review the latest electrolytes, gas and
   glucose against the agreed criteria for this operation. Weight, feeding, haemoglobin and no recent respiratory
   infection. Teach: Infants decompensate quickly and tolerate an uncorrected metabolic, glucose or temperature
   problem badly. Check: avoid proceeding because the list is booked when the bloods do not meet the agreed criteria.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_warming.png [step.paeds.warming]  Thermal care for the infant: Warm the theatre before the infant arrives, and use
   a forced-air warmer or warming mattress. Cover the head and limbs and expose only the operative field. Teach:
   Infants have a large surface area for their mass and little subcutaneous fat. Check: avoid prolonged exposure
   during positioning and draping while the team waits.
06_positioning.png [step.core.positioning]  Teach and Check: the G positioning facts exactly.
07_airway-share.png [step.ent.airway-share]  Shared airway plan with the anaesthetist: Agree the airway device and its
   fixation: reinforced or preformed tube, laryngeal mask, or the existing tracheostomy or endotracheal tube. Agree
   whether a throat pack is placed, who places it, and record it on the whiteboard so its removal is a counted event.
   Agree tube position and the plan for blood in the airway; a throat pack is placed and recorded. Teach: In ENT
   surgery the surgeon and the anaesthetist work in the same space. Check: avoid a throat pack placed by one person
   and not recorded anywhere, then left in at extubation.
08_prep-drape.png [step.core.prep-drape]  Common. The whole face prepared so symmetry can be judged; eyes protected.
09_markings.png [step.cl.markings]  Anthropometric marking and tattooing: Mark Cupid's bow peaks and low point on the
   non-cleft side, and the corresponding peak on the cleft side (Noordhoff's point) where the white roll and vermilion
   are fullest. Mark the alar bases, the columella base and the planned incisions per the chosen technique (rotation-
   advancement or anatomical subunit). Teach: The repair is only as good as its marks. Check: avoid marking after
   infiltration.
10_local-anaesthetic.png [step.paeds.local-anaesthetic]  Weight-based local anaesthetic infiltration: Agree the agent,
   concentration and maximum dose by weight with the anaesthetist before infiltration, and record it. Aspirate before
   injecting and infiltrate slowly. Local anaesthetic with adrenaline by weight, after the marks are tattooed. Teach:
   Wound infiltration or a regional block reduces opioid need, and opioids increase the risk of post-operative apnoea
   in infants. Check: avoid the anaesthetist gives a caudal block and the surgeon infiltrates a further full dose
   without either knowing.
11_incisions.png [step.cl.incisions]  Incisions and release of the lateral lip: Incise along the marks through skin
   with a fine blade. Release the lateral lip element from the maxilla in the supraperiosteal plane so it advances
   without tension. Teach: The incisions create the flaps that lengthen the medial side and bring the lateral side
   across; the lateral lip must be released enough to close without tension. Check: avoid insufficient release giving
   a tight closure.
12_nose.png [step.cl.nose]  Primary nasal repair: Dissect the alar cartilage off the overlying skin through the
   existing incisions. Reposition the alar base and support the cartilage with sutures or a bolster per technique.
   Teach: The cleft-side alar cartilage is displaced; repositioning it at the first operation improves nasal symmetry
   as the child grows. Check: avoid leaving the alar base displaced.
13_muscle.png [step.cl.muscle]  Reconstructing the orbicularis oris: Separate the orbicularis from the skin and mucosa
   on both sides for a few millimetres. Bring the muscle ends together across the cleft, overlapping slightly, with
   interrupted absorbable sutures from the nasal floor down to the vermilion. Teach: The muscle is the functional core
   of the lip. Check: avoid skin-only closure without muscle repair.
14_closure.png [step.cl.closure]  Mucosa, skin and vermilion closure: Close the oral mucosa with absorbable sutures.
   Place the key suture at the white roll first, aligning it exactly. Teach: Exact alignment of the white roll and the
   vermilion-mucosa junction is what people see; a small step is visible for life. Check: avoid misaligned white roll.
15_haemostasis.png [step.core.haemostasis]  Common. Bipolar only; check the labial arteries before closing the mucosa.
16_counts.png [step.core.counts]  Common.
17_pharynx-clearance.png [step.ent.pharynx-clearance]  Clear the pharynx: throat pack out, clot out, postnasal space
   checked: Remove the throat pack and state its removal aloud so the anaesthetist and scrub practitioner record it.
   Suction the oropharynx and, with a mirror or endoscope, the postnasal space. Remove any clot there before it is
   aspirated at extubation. Throat pack out and counted, blood cleared from the pharynx. Teach: A retained throat pack
   or a clot in the nasopharynx sitting above the larynx can obstruct the airway completely after extubation. Check:
   avoid checking only the oropharynx and missing a clot in the nasopharynx behind the soft palate.
18_airway-handover.png [step.ent.airway-handover]  Airway handover to recovery and the ward: State the airway: tube or
   tracheostomy type and size, whether the cuff is up, whether the upper airway is patent, and whether the patient can
   be oxygenated from above. State the bleeding risk and what bleeding would look like: frequent swallowing, fresh
   blood from mouth or nose, rising heart rate in a child. Hand over to recovery: airway, nose, feeding and arm
   restraint plan. Teach: Most ENT airway catastrophes happen after the operation, in recovery or on the ward, in the
   hands of people who were not in theatre. Check: avoid a handover that covers the operation but not what to do if
   the airway fails.
19_debrief.png [step.core.debrief]  Common.

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
  surgx-kidney-transplant-steps.zip   (folder kidney-transplant/)
  surgx-lap-donor-nephrectomy-steps.zip   (folder lap-donor-nephrectomy/)
  surgx-aortic-valve-replacement-steps.zip   (folder aortic-valve-replacement/)
  surgx-subxiphoid-pericardial-window-steps.zip   (folder subxiphoid-pericardial-window/)
  surgx-escharotomy-steps.zip   (folder escharotomy/)
  surgx-rhomboid-flap-steps.zip   (folder rhomboid-flap/)
  surgx-unilateral-cleft-lip-repair-steps.zip   (folder unilateral-cleft-lip-repair/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
