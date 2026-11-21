---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 20 (Great saphenous vein surgery, Above-knee amputation, Open surgical tracheostomy, Functional endoscopic sinus surgery, Myringotomy and grommet insertion, Septoplasty): Gemini image prompt (100 images, 6 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant ENT surgeons and vascular surgeons. You are making 100 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Great saphenous vein surgery                                   19 images
  B. Above-knee amputation                                          19 images
  C. Open surgical tracheostomy                                     14 images
  D. Functional endoscopic sinus surgery (FESS)                     17 images
  E. Myringotomy and grommet insertion                              11 images
  F. Septoplasty                                                    20 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Academy of Otolaryngology-Head and Neck Surgery Foundation (AAO-HNSF), Clinical Practice Guideline: Tympanostomy Tubes in Children (Update); American Academy of Otolaryngology-Head and Neck Surgery Foundation (AAO-HNSF), Clinical consensus statement: septoplasty with or without inferior turbinate reduction (Han JK et al., Otolaryngol Head Neck Surg); American Academy of Otolaryngology-Head and Neck Surgery Foundation (AAO-HNSF), Clinical practice guideline (update): adult sinusitis; Difficult Airway Society (DAS), Difficult Airway Society 2015 guidelines for management of unanticipated difficult intubation in adults; European Rhinologic Society, European Position Paper on Rhinosinusitis and Nasal Polyps 2020 (EPOS 2020); European Society for Vascular Surgery (ESVS), ESVS 2022 Clinical Practice Guidelines on the Management of Chronic Venous Disease of the Lower Limbs; European Society for Vascular Surgery, Society for Vascular Surgery and World Federation of Vascular Societies, Global Vascular Guidelines on the Management of Chronic Limb-Threatening Ischemia; National Confidential Enquiry into Patient Outcome and Death (NCEPOD), On the right Trach?).
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
- A. Supine with the leg slightly externally rotated and the knee slightly flexed. Reverse Trendelenburg tilt to fill
  the vein for cannulation, then head-down tilt to empty it for ablation or stripping.
- B. Supine, with a sandbag under the ipsilateral buttock so the thigh can be lifted to reach the posterior flap.
  Protect the contralateral heel and foot, which are often also ischaemic.
- C. Supine, shoulder roll, neck extended if the cervical spine allows. Extension brings the trachea up into the neck
  by several rings. Head ring, arms by the side, the anaesthetist with access to the tube and the circuit throughout.
  Head of the table up slightly to reduce venous congestion.
- D. Supine with the head of the table raised (reverse Trendelenburg) to reduce venous pressure in the nose. Head
  turned slightly towards the surgeon on a head ring, eyes taped but visible within the field, never covered by
  drapes.
- E. Supine, head turned away from the operated ear on a head ring. Operating microscope positioned before the ear is
  touched; surgeon seated with arms supported.
- F. Supine with a head ring, head slightly flexed on the neck and turned a little towards the surgeon, with 15 to 20
  degrees of head-up tilt. Reinforced or preformed oral tube fixed in the midline of the lower lip, away from the
  field, and a throat pack if agreed.
Step-specific facts:
- A. Anatomy: The saphenofemoral junction lies about 2 to 3 cm below and lateral to the pubic tubercle, deep to the
  cribriform fascia. Must be right: Never tie or divide any vessel at the groin until the common femoral vein has been
  seen and the junction identified with certainty.
- B. Anatomy: The superficial femoral artery and vein run in the adductor canal deep to sartorius on the medial thigh;
  the profunda femoris artery and its perforating branches supply the posterior thigh muscles and bleed from the
  posterior flap. Must be right: Confirm the side and level with the awake patient and mark it. Wrong-side amputation
  is a never event. Ligate the superficial femoral artery and vein separately and transfix the artery; a slipped tie
  on the femoral artery is life-threatening on the ward.
- C. Anatomy: Landmarks from above: thyroid notch, cricothyroid membrane, cricoid cartilage, then the tracheal rings.
  The cricoid is the only complete ring in the airway and must not be damaged. Must be right: The patient is
  oxygenated through the existing tube until the new tube is in the trachea and confirmed by waveform capnography.
  Withdraw the endotracheal tube under direct vision, not out of the mouth.
- D. Anatomy: The uncinate process covers the maxillary ostium and the ethmoid infundibulum. Removing it is the key to
  the natural ostium. The lamina papyracea forms the lateral wall of the ethmoid sinus and is paper thin; behind it is
  orbital fat and the medial rectus. Must be right: Review the CT systematically before surgery: cribriform plate
  depth, lamina papyracea integrity, Onodi cell, sphenoid wall dehiscence, and the anterior ethmoidal artery. Many
  surgeons teach this as the CLOSE checklist.
- E. Anatomy: The tympanic membrane has a pars tensa and a smaller pars flaccida above the lateral process of the
  malleus. Grommets go in the pars tensa. The handle of the malleus divides the drum into anterior and posterior
  halves. Must be right: Confirm the side and the indication against the audiogram and tympanogram before the time-
  out. Incise in the anteroinferior quadrant. Never in the posterosuperior quadrant, where the ossicles and chorda
  tympani lie.
- F. Anatomy: The septum is the quadrilateral cartilage in front, the perpendicular plate of the ethmoid above and
  behind, and the vomer below and behind, sitting on the maxillary crest and nasal crest of the palatine bone. Must be
  right: The plane is under the perichondrium. Mucosa that is pink and bleeding means you are above it; cartilage that
  looks blue-white and smooth means you are in it. Preserve the dorsal and caudal L-strut. Resect what is deviated,
  not what is reachable.
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

A. GREAT SAPHENOUS VEIN SURGERY  (folder gsv-ablation-stripping/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side and the tributaries with the patient standing.
   Confirm which technique is planned and that the patient understands the alternatives.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis is not routinely needed for endovenous
   ablation; follow local policy for open groin surgery. Document the venous thromboembolism risk assessment and plan.
04_vein-mapping.png [step.vasc.vein-mapping]  Duplex vein assessment and marking: Review the duplex report yourself:
   diameter, depth, continuity, previous thrombosis, and the course of the vein along its length. Mark the vein on the
   skin with the patient in the position used for the scan (standing or reverse Trendelenburg for leg veins), the
   evening before or in the anaesthetic room. Confirm the refluxing segment, the junction, the deep veins and the
   point of lowest reflux, where cannulation will be. Teach: Vein operations succeed or fail on the vein. Check: avoid
   operating on an old scan when the vein has since thrombosed or been used.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Prepare the whole leg from the groin to the foot, with a sterile
   cover for the ultrasound probe.
07_cannulation.png [step.gsv.cannulation]  Ultrasound-guided cannulation of the saphenous vein: With the leg
   dependent, scan the vein at the planned entry point, usually at or just above the knee for the great saphenous
   vein, and infiltrate a small amount of local anaesthetic. Puncture the vein under direct ultrasound vision in long
   or short axis, confirm venous backflow, and pass the guidewire. Teach: Cannulating at the lowest point of reflux
   treats the whole incompetent segment, and a single clean puncture avoids spasm and haematoma that make further
   attempts harder. Check: avoid cannulating below the knee, where the saphenous nerve lies against the vein.
08_tip-position.png [step.gsv.tip-position]  Confirming the catheter tip position at the junction: Image the junction
   in longitudinal view and identify the common femoral vein and the superficial epigastric vein. Position the tip
   short of the junction at the distance specified by the device instructions and unit protocol (commonly 1 to 2 cm
   distal to the junction). Teach: Heat delivered too close to the junction can propagate thrombus into the common
   femoral vein, which turns a cosmetic operation into a deep vein thrombosis or pulmonary embolism. Check: avoid
   measuring in transverse view only, which misjudges the distance.
09_tumescent.png [step.gsv.tumescent]  Tumescent anaesthesia: Infiltrate dilute local anaesthetic solution under
   ultrasound into the saphenous compartment along the whole length to be treated. Aim for a halo of fluid around the
   vein that separates it from the skin; superficial segments need more. Teach: Tumescent fluid provides analgesia,
   compresses the vein onto the catheter for effective heat transfer, and creates a heat sink that protects the skin
   and nerves. Check: avoid gaps in the tumescent sleeve, which lead to burns and pain.
10_ablation.png [step.gsv.ablation]  Delivering thermal energy and checking the deep vein: With the patient head-down
   and the tip confirmed, deliver energy and withdraw the catheter according to the device protocol, with ultrasound
   or manual compression over the vein. Give extra attention to the junctional segment as the device instructions
   advise. Teach: Ablation closes the refluxing vein permanently only when the right energy is delivered along its
   length; checking the deep vein afterwards finds the thrombus that would otherwise present as a pulmonary embolism.
   Check: avoid firing the device with the tip outside the vein or in a tributary.
11_sfj-ligation.png [step.gsv.sfj-ligation]  Open saphenofemoral junction ligation (high tie): Make a groin crease
   incision centred over the junction as marked on ultrasound, below and lateral to the pubic tubercle. Find the great
   saphenous vein and follow it up to the common femoral vein, which must be clearly seen above and below the junction
   before any tie is placed. Teach: Recurrence after open surgery comes largely from tributaries or a stump left
   behind, and the most serious injury in varicose vein surgery, ligation or stripping of the femoral vein, happens
   here. Check: avoid mistaking the common femoral vein for a large saphenous vein and ligating or stripping it.
12_strip.png [step.gsv.strip]  Stripping the great saphenous vein to the knee: Pass the stripper from the groin down
   the vein to just below the knee and bring it out through a small incision. Secure the vein to the stripper and
   remove it by inversion from groin to knee, with the leg elevated. Teach: Removing the refluxing thigh trunk reduces
   recurrence compared with junction ligation alone. Check: avoid stripping the below-knee segment routinely, causing
   saphenous neuralgia.
13_phlebectomy.png [step.gsv.phlebectomy]  Phlebectomy of marked tributaries: Make small stab incisions along the
   marked varicosities, using the standing marks made before surgery. Hook out the vein segments with a phlebectomy
   hook, avulsing them with gentle traction and pressure. Teach: Treating the trunk alone often leaves visible
   varicosities and symptoms. Check: avoid marks washed off by skin preparation; re-mark with a surgical marker after
   preparation if needed.
14_bailout.png [step.gsv.bailout]  When access fails or the junction is unclear: If cannulation fails after a few
   attempts, try a different puncture site higher on the vein or a small cut-down; otherwise convert to foam
   sclerotherapy or open surgery, or defer. If the catheter will not pass, treat the accessible segment and plan the
   remainder separately rather than forcing it. Teach: The serious harms of this operation come from pressing on:
   forcing a catheter, ablating a vein that has not been reached, or dissecting a groin whose anatomy is not
   understood. Check: avoid blind clamping in a bleeding groin.
15_haemostasis.png [step.core.haemostasis]  Common. Firm pressure along the stripped track and phlebectomy sites, with
   the leg elevated, is the main haemostatic manoeuvre.
16_counts.png [step.core.counts]  Common. Include the guidewires, sheaths and stripper heads.
17_groin-closure.png [step.vasc.groin-closure]  Layered closure of a groin incision: Ligate or seal divided lymphatic
   tissue rather than leaving it to leak; avoid wide undermining. Close the deep fascia and subcutaneous tissue in two
   or more layers so that no cavity remains over the vessels or graft. After open junction ligation; close the
   cribriform fascia and subcutaneous layer over the ligated stump. Teach: The groin is the commonest site of vascular
   wound complications: lymph leak, seroma, infection and breakdown over a graft or a vein stump. Check: avoid a
   single-layer skin closure over a dead space that fills with lymph.
18_skin-closure.png [step.core.skin-closure]  Common. Adhesive strips to phlebectomy incisions; apply the compression
   bandage from the foot upwards before the patient leaves theatre.
19_debrief.png [step.core.debrief]  Common. Record the technique, treated length, energy delivered, distance of the
   tip from the junction, the end-of-procedure deep vein scan, and the compression and thromboprophylaxis plan.

B. ABOVE-KNEE AMPUTATION  (folder above-knee-amputation/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side and the level with the awake patient. Record why
   a lower level is not appropriate.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Cover skin flora and, in a gangrenous or infected limb, the likely
   or cultured organisms (including anaerobes), per local protocol. Thromboprophylaxis is essential.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Isolate the foot and leg below the knee in a sealed bag; prepare to
   the groin and buttock.
06_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. A sterile
   thigh tourniquet is possible only if the level is low enough to leave room above it. Never exsanguinate an
   ischaemic or infected limb; many surgeons operate without one. Teach: A tourniquet gives a bloodless field but adds
   ischaemia to injured tissue and hides bleeding that tells you what is alive. Check: avoid inflating on a limb with
   suspected compartment syndrome or arterial injury.
07_flaps.png [step.aka.flaps]  Marking the bone level and flaps: Mark the planned femoral cut, leaving as much length
   as the tissues and perfusion allow while staying well above the knee. Mark equal anterior and posterior fish-mouth
   flaps, with their apices at the level of the bone cut on the medial and lateral thigh and each flap long enough to
   reach the other over the bone end. Teach: A stump that cannot be closed without tension will break down. Check:
   avoid flaps measured from the skin incision rather than from the bone cut, so the bone is left too long for them.
08_anterior-medial.png [step.aka.anterior-medial]  Anterior and medial muscle division: Incise skin and deep fascia
   along the anterior flap line without undermining the skin. Divide quadriceps down to the femur, and sartorius and
   the medial muscles to expose the adductor canal. Teach: Dividing the anterior and medial muscles first exposes the
   femoral vessels in the adductor canal so they can be controlled before they are cut. Check: avoid separating skin
   from fascia, which devascularises the flap.
09_femoral-vessels.png [step.aka.femoral-vessels]  Ligation of the femoral vessels: Separate the superficial femoral
   artery from the vein for a short length. Doubly ligate the artery and add a transfixion suture distal to the
   proximal tie before dividing it; ligate the vein separately. Teach: The superficial femoral artery carries enough
   flow to exsanguinate a patient from a slipped tie. Check: avoid mass ligation of artery, vein and nerve together.
10_bone.png [step.aka.bone]  Division of the femur: Strip the periosteum only minimally at the level of the cut and
   retract the soft tissues proximally to protect them. Divide the femur with the saw at the marked level, cooling
   with saline. Teach: A bone end that is too long for the flaps forces a tight closure, and a sharp edge erodes
   through the soft tissue or makes the socket painful. Check: avoid cutting the bone at the skin incision level
   instead of above it.
11_sciatic.png [step.aka.sciatic]  Handling the sciatic nerve: Identify the sciatic nerve posteriorly between the
   hamstrings and adductor magnus. Draw it down gently, ligate it proximally to control its companion artery, and
   divide it sharply so that it retracts well above the bone end. Teach: The sciatic nerve carries a companion artery
   that bleeds if the nerve is cut without ligation, and a neuroma at the end of the stump makes a prosthesis
   intolerable. Check: avoid dividing the nerve without ligation and chasing bleeding in the posterior compartment.
12_posterior.png [step.aka.posterior]  Completing the posterior flap: Lift the thigh and divide the hamstrings and
   remaining posterior muscles along the posterior flap line with an amputation knife. Ligate the perforating vessels
   as they are divided. Teach: The posterior muscles carry the perforating branches of the profunda, which bleed
   briskly. Check: avoid bevelling the posterior flap so that the skin is longer than the muscle and thin at the edge.
13_myodesis.png [step.aka.myodesis]  Muscle stabilisation: myodesis and myoplasty: In a patient expected to walk with
   a prosthesis, attach adductor magnus to the lateral femur through drill holes with the hip in adduction. Bring the
   quadriceps over the bone end and suture it to the posterior fascia and hamstrings (myoplasty). Teach: Without the
   adductors attached, the short femur drifts into abduction and flexion, which makes the prosthesis hard to fit and
   walking inefficient. Check: avoid bulky muscle closed under tension, compromising the flaps.
14_guillotine.png [step.aka.guillotine]  Guillotine first stage for sepsis or instability: Divide skin, muscle and
   bone circumferentially at or just above the level of the infection or necrosis, ligating the main vessels
   individually. Leave the wound open and dressed, without sutures; send tissue for culture. Teach: In a septic or
   unstable patient, a quick circumferential amputation removes the source of sepsis in minutes; a formal stump made
   through infected or oedematous tissue tends to break down. Check: avoid fashioning definitive flaps through
   infected tissue to avoid a second operation.
15_haemostasis.png [step.core.haemostasis]  Common. Release any tourniquet before closure; the perforating branches of
   the profunda in the posterior flap bleed most.
16_counts.png [step.core.counts]  Common.
17_specimen.png [step.core.specimen]  Common. Send the limb for histology, and a proximal bone or tissue sample for
   culture if infection was present.
18_skin-closure.png [step.core.skin-closure]  Common. Close fascia and then skin without tension; handle the skin
   edges without forceps. Interrupted sutures allow a single area to be released.
19_debrief.png [step.core.debrief]  Common. Record the level, flaps, vessel ligation, nerve handling, myodesis and the
   anti-contracture and rehabilitation plan.

C. OPEN SURGICAL TRACHEOSTOMY  (folder surgical-tracheostomy/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common. State the inspired oxygen plan, the diathermy plan and the tube size
   aloud. The team must know when the trachea will be opened.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_airway-share.png [step.ent.airway-share]  Shared airway plan with the anaesthetist: Agree the airway device and its
   fixation: reinforced or preformed tube, laryngeal mask, or the existing tracheostomy or endotracheal tube. Agree
   whether a throat pack is placed, who places it, and record it on the whiteboard so its removal is a counted event.
   The anaesthetist owns the airway until the new tube is confirmed. Agree the words used to signal each stage. Teach:
   In ENT surgery the surgeon and the anaesthetist work in the same space. Check: avoid a throat pack placed by one
   person and not recorded anywhere, then left in at extubation.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_incision.png [step.trach.incision]  Incision and midline approach through the strap muscles: Palpate and mark the
   cricoid and the sternal notch. Make a horizontal incision about midway between them, or two finger-breadths above
   the notch. Divide the platysma and retract or ligate the anterior jugular veins. Teach: The midline raphe between
   the strap muscles is the avascular corridor to the trachea. Check: avoid losing the midline in a deep neck. Palpate
   the trachea again rather than dissect blindly.
08_isthmus.png [step.trach.isthmus]  Divide or retract the thyroid isthmus: Identify the isthmus and decide whether it
   can be retracted upwards or must be divided. If dividing, create a plane between the isthmus and the trachea, clamp
   both sides, divide, and suture-ligate each stump. Teach: The isthmus lies over the rings where the window will be.
   Check: avoid relying on diathermy alone for the isthmus, which then bleeds after the patient coughs.
09_haemostasis.png [step.core.haemostasis]  Common. Haemostasis is complete BEFORE the trachea is opened. Blood
   running into an open airway is aspirated.
10_window.png [step.trach.window]  Open the trachea and insert the tube: Confirm with the anaesthetist: inspired
   oxygen reduced, monopolar diathermy put away, suction ready, new tube cuff tested. Place stay sutures either side
   of the planned opening if that is local practice, and label them. Teach: This is the moment the airway changes
   hands. Check: avoid using monopolar diathermy to cut into the trachea in high oxygen.
11_confirm.png [step.trach.confirm]  Confirm with capnography, then secure: Confirm a sustained capnography trace and
   bilateral chest expansion. Pass a suction catheter freely through the tube, or use a fibreoptic scope if in doubt.
   Only then remove the endotracheal tube completely. Teach: A tracheostomy tube can sit in a false passage and look
   perfect. Check: avoid removing the endotracheal tube before capnography is confirmed.
12_counts.png [step.core.counts]  Common.
13_airway-handover.png [step.ent.airway-handover]  Airway handover to recovery and the ward: State the airway: tube or
   tracheostomy type and size, whether the cuff is up, whether the upper airway is patent, and whether the patient can
   be oxygenated from above. State the bleeding risk and what bleeding would look like: frequent swallowing, fresh
   blood from mouth or nose, rising heart rate in a child. Bedhead sign, spare tubes (same size and one smaller),
   obturator, suction and humidification with the patient before leaving theatre. Teach: Most ENT airway catastrophes
   happen after the operation, in recovery or on the ward, in the hands of people who were not in theatre. Check:
   avoid a handover that covers the operation but not what to do if the airway fails.
14_debrief.png [step.core.debrief]  Common.

D. FUNCTIONAL ENDOSCOPIC SINUS SURGERY (FESS)  (folder fess/)
01_consent-check.png [step.core.consent-check]  Common.
02_preop-data-check.png [step.ent.preop-data-check]  Confirm the investigation that justifies the operation: Display
   the key investigation in theatre before the time-out, not just in the notes. Confirm side and indication against it
   aloud, for example: bilateral effusion with flat tympanograms, or left-sided disease on the CT. The CT stays on the
   screen for the whole operation. Run the anatomy checklist aloud before the endoscope goes in. Teach: ENT operations
   are often elective and sided, and each rests on one investigation: the audiogram and tympanogram for grommets, the
   CT for sinus surgery, the documented infection count or sleep study for tonsillectomy. Check: avoid operating on
   the side written on the list rather than the side shown by the investigation.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_airway-share.png [step.ent.airway-share]  Shared airway plan with the anaesthetist: Agree the airway device and its
   fixation: reinforced or preformed tube, laryngeal mask, or the existing tracheostomy or endotracheal tube. Agree
   whether a throat pack is placed, who places it, and record it on the whiteboard so its removal is a counted event.
   Throat pack recorded on the board. Agree controlled hypotension and total intravenous anaesthesia if the unit uses
   them to improve the field. Teach: In ENT surgery the surgeon and the anaesthetist work in the same space. Check:
   avoid a throat pack placed by one person and not recorded anywhere, then left in at extubation.
06_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common.
08_decongest.png [step.fess.decongest]  Decongest and infiltrate: Place neuropatties soaked in topical vasoconstrictor
   along the middle meatus and nasal floor, counted in. Infiltrate local anaesthetic with adrenaline into the lateral
   nasal wall at the axilla of the middle turbinate and the uncinate. Teach: Endoscopic sinus surgery depends on the
   field. Check: avoid starting surgery before the vasoconstrictor has had time to work.
09_uncinectomy.png [step.fess.uncinectomy]  Uncinectomy and middle meatal antrostomy: Medialise the middle turbinate
   gently, without fracturing it at its attachment to the skull base. Remove the uncinate process with a sickle knife
   or backbiter, staying parallel to the lamina papyracea. Teach: The operation is functional: it restores drainage
   through the natural maxillary ostium. Check: avoid entering the orbit when the uncinate is incised too far
   laterally.
10_ethmoidectomy.png [step.fess.ethmoidectomy]  Ethmoidectomy from front to back: Open the ethmoid bulla and remove
   its walls to the basal lamella of the middle turbinate. Enter the posterior ethmoid through the basal lamella,
   inferiorly and medially, never high and lateral. Teach: The ethmoid labyrinth sits between the orbit and the brain.
   Check: avoid losing orientation and continuing. Stop, re-check the CT and image guidance, and find a known
   landmark.
11_orbit-check.png [step.fess.orbit-check]  Check the eyes before ending: Inspect and gently palpate both eyes:
   compare proptosis, tension and lid bruising. Look for orbital fat in the ethmoid cavity. If present, document it
   and avoid packing that pushes into the orbit. Teach: Orbital haematoma from an anterior ethmoidal artery injury or
   a breach of the lamina can threaten sight within a short time. Check: avoid leaving the eyes taped and draped until
   recovery.
12_haemostasis.png [step.core.haemostasis]  Common.
13_pharynx-clearance.png [step.ent.pharynx-clearance]  Clear the pharynx: throat pack out, clot out, postnasal space
   checked: Remove the throat pack and state its removal aloud so the anaesthetist and scrub practitioner record it.
   Suction the oropharynx and, with a mirror or endoscope, the postnasal space. Remove any clot there before it is
   aspirated at extubation. Clear the postnasal space with the endoscope. A clot behind the palate is aspirated at
   extubation. Teach: A retained throat pack or a clot in the nasopharynx sitting above the larynx can obstruct the
   airway completely after extubation. Check: avoid checking only the oropharynx and missing a clot in the nasopharynx
   behind the soft palate.
14_counts.png [step.core.counts]  Common. Count every neuropatty out of the nose as well as the throat pack.
15_specimen.png [step.core.specimen]  Common.
16_airway-handover.png [step.ent.airway-handover]  Airway handover to recovery and the ward: State the airway: tube or
   tracheostomy type and size, whether the cuff is up, whether the upper airway is patent, and whether the patient can
   be oxygenated from above. State the bleeding risk and what bleeding would look like: frequent swallowing, fresh
   blood from mouth or nose, rising heart rate in a child. Recovery staff check the eyes as part of observations and
   know that a swollen, tense eye is an emergency. Teach: Most ENT airway catastrophes happen after the operation, in
   recovery or on the ward, in the hands of people who were not in theatre. Check: avoid a handover that covers the
   operation but not what to do if the airway fails.
17_debrief.png [step.core.debrief]  Common.

E. MYRINGOTOMY AND GROMMET INSERTION  (folder myringotomy-grommets/)
01_consent-check.png [step.core.consent-check]  Common.
02_preop-data-check.png [step.ent.preop-data-check]  Confirm the investigation that justifies the operation: Display
   the key investigation in theatre before the time-out, not just in the notes. Confirm side and indication against it
   aloud, for example: bilateral effusion with flat tympanograms, or left-sided disease on the CT. The tympanogram and
   audiogram for each ear. A bilateral listing with a normal tympanogram on one side needs a decision before the
   anaesthetic. Teach: ENT operations are often elective and sided, and each rests on one investigation: the audiogram
   and tympanogram for grommets, the CT for sinus surgery, the documented infection count or sleep study for
   tonsillectomy. Check: avoid operating on the side written on the list rather than the side shown by the
   investigation.
03_timeout.png [step.core.timeout]  Common.
04_airway-share.png [step.ent.airway-share]  Shared airway plan with the anaesthetist: Agree the airway device and its
   fixation: reinforced or preformed tube, laryngeal mask, or the existing tracheostomy or endotracheal tube. Agree
   whether a throat pack is placed, who places it, and record it on the whiteboard so its removal is a counted event.
   Usually a face mask or laryngeal mask. Agree how far the head will be turned for each ear. Teach: In ENT surgery
   the surgeon and the anaesthetist work in the same space. Check: avoid a throat pack placed by one person and not
   recorded anywhere, then left in at extubation.
05_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
06_canal.png [step.grommet.canal]  Clear the canal and inspect the whole drum: Insert the largest speculum that fits
   comfortably and align the canal. Remove wax with a wax hook or suction without touching the canal skin. Teach: Wax
   and debris hide the anatomy. Check: avoid accepting a partial view of the drum.
07_myringotomy.png [step.grommet.myringotomy]  Radial myringotomy in the anteroinferior quadrant: Make a short radial
   incision in the anteroinferior quadrant, sized to the grommet. Aspirate the effusion through the incision with fine
   suction and note its character: serous, mucoid or purulent. Teach: The anteroinferior quadrant is away from the
   ossicles and the chorda tympani. Check: avoid incising posteriorly because the anterior drum is hard to see. Change
   the speculum or angle instead.
08_insert.png [step.grommet.insert]  Insert and seat the grommet: Hold the grommet with crocodile forceps by the outer
   flange and engage the inner flange in the incision. Rotate or push it into place with a probe until both flanges
   sit either side of the drum. Teach: A grommet that is not seated across the drum either extrudes early or falls
   into the middle ear and becomes a foreign body. Check: avoid pushing hard against the drum, which enlarges the
   incision and loses the grommet into the middle ear.
09_counts.png [step.core.counts]  Common.
10_airway-handover.png [step.ent.airway-handover]  Airway handover to recovery and the ward: State the airway: tube or
   tracheostomy type and size, whether the cuff is up, whether the upper airway is patent, and whether the patient can
   be oxygenated from above. State the bleeding risk and what bleeding would look like: frequent swallowing, fresh
   blood from mouth or nose, rising heart rate in a child. Teach: Most ENT airway catastrophes happen after the
   operation, in recovery or on the ward, in the hands of people who were not in theatre. Check: avoid a handover that
   covers the operation but not what to do if the airway fails.
11_debrief.png [step.core.debrief]  Common.

F. SEPTOPLASTY  (folder septoplasty/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the patient understands that the shape of the nose is
   not being changed, and that obstruction from rhinitis will persist.
02_preop-data-check.png [step.ent.preop-data-check]  Confirm the investigation that justifies the operation: Display
   the key investigation in theatre before the time-out, not just in the notes. Confirm side and indication against it
   aloud, for example: bilateral effusion with flat tympanograms, or left-sided disease on the CT. Nasendoscopy
   findings showing the deviation that matches the symptomatic side and level, and the record of a medical trial for
   rhinitis. Teach: ENT operations are often elective and sided, and each rests on one investigation: the audiogram
   and tympanogram for grommets, the CT for sinus surgery, the documented infection count or sleep study for
   tonsillectomy. Check: avoid operating on the side written on the list rather than the side shown by the
   investigation.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis is not routine for septoplasty; follow
   local policy. Thromboprophylaxis by risk assessment.
05_airway-share.png [step.ent.airway-share]  Shared airway plan with the anaesthetist: Agree the airway device and its
   fixation: reinforced or preformed tube, laryngeal mask, or the existing tracheostomy or endotracheal tube. Agree
   whether a throat pack is placed, who places it, and record it on the whiteboard so its removal is a counted event.
   Reinforced oral tube in the midline. A throat pack is recorded on the whiteboard because blood runs back into the
   pharynx throughout. Teach: In ENT surgery the surgeon and the anaesthetist work in the same space. Check: avoid a
   throat pack placed by one person and not recorded anywhere, then left in at extubation.
06_positioning.png [step.core.positioning]  Teach and Check: the F positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common. Aqueous antiseptic only around the eyes and face. Leave the nose and
   medial canthi in view.
08_bloodless-field.png [step.ent.bloodless-field]  Bloodless field: head-up tilt, vasoconstrictor infiltration and the
   wait: Ask for a head-up tilt and agree with the anaesthetist on a calm, normotensive or modestly lowered blood
   pressure and heart rate, using their preferred technique. Infiltrate local anaesthetic with adrenaline in the
   correct plane: under the mucoperichondrium for the septum, into the canal skin at four quadrants and the postaural
   sulcus for the ear. Aspirate before each injection. Topical vasoconstrictor on patties first, then infiltrate under
   the mucoperichondrium on both sides of the septum until the mucosa blanches and lifts. Teach: Nasal and ear surgery
   is done through a small opening under magnification, where a few drops of blood hide the plane, the nerve or the
   flap edge. Check: avoid incising immediately after injection, which gives a wet field and wastes the
   vasoconstrictor.
09_incision.png [step.septo.incision]  Incision: Killian or hemitransfixion: For a mid or posterior deviation, make a
   Killian incision through mucosa and perichondrium about 1 cm behind the caudal border of the septum, on the side
   chosen by the surgeon's handedness and the deviation. For a caudal deviation or a dislocated caudal border, make a
   hemitransfixion incision at the caudal edge of the septal cartilage. Teach: The incision decides which part of the
   septum you can correct. Check: avoid a Killian incision placed too far forward that weakens the caudal strut.
10_flap.png [step.septo.flap]  Raise the subperichondrial flap: Lift the perichondrium off the cartilage with the
   sharp end of a Cottle or Freer elevator, sweeping backwards and upwards with the instrument kept against the
   cartilage. Extend the elevation over the whole deviated area and down to the floor of the nose, keeping it in one
   sheet. Teach: The subperichondrial plane is avascular and strong. Check: avoid elevating pink, bleeding tissue: you
   are submucosal; go back and re-find the cartilage.
11_bony-junction.png [step.septo.bony-junction]  Cross to the opposite side at the bony-cartilaginous junction:
   Separate the quadrilateral cartilage from the perpendicular plate and vomer with the blunt end of the elevator
   along the chondro-osseous junction. Raise the subperiosteal flap on the opposite side of the bony septum, keeping
   the opposite cartilage flap attached where it is not needed. Teach: Most deviations involve both cartilage and
   bone. Check: avoid disarticulating the cartilage from the bone along its full height, including high dorsally,
   which destabilises the dorsum.
12_resection.png [step.septo.resection]  Resect deviated cartilage and bone, preserve the L-strut: Mark the dorsal and
   caudal strut you will leave, commonly at least 1 cm each, and resect deviated cartilage behind and below it with
   the swivel knife or scalpel. Remove deviated perpendicular plate and vomer with through-cutting forceps. Cut it
   free before removing it; never twist or rock bone attached to the skull base. Teach: Only the deviated segment
   needs to go. Check: avoid resecting a high dorsal deviation in the strut, which causes a saddle deformity. Scoring,
   splinting or a referral for septorhinoplasty is safer.
13_maxillary-crest.png [step.septo.maxillary-crest]  Deal with the maxillary crest and spur: Raise the inferior tunnel
   along the floor of the nose separately and join it to the upper tunnel at the spur, so the flap is lifted around
   the spur from both directions. Reduce the spur with a chisel or gouge, or remove it with forceps, keeping the flap
   protected with the speculum blade. Teach: A basal spur or a cartilage edge dislocated off the maxillary crest is
   the commonest cause of persisting obstruction, and the commonest site of a flap tear. Check: avoid chiselling the
   spur with the flap still stretched over it.
14_tear-bailout.png [step.septo.tear-bailout]  Bail-out: opposing flap tears or loss of support: If both flaps are
   torn at the same level, close at least one side with a fine absorbable suture and place a piece of straightened
   cartilage or crushed cartilage between the flaps. If the caudal strut has been dislocated or weakened, fix it back
   to the nasal spine or splint it, and tell the consultant before closing. Teach: A tear on one side heals. Check:
   avoid leaving opposing tears unrepaired because the operation is otherwise finished.
15_close-quilt.png [step.septo.close-quilt]  Close the incision, quilt the flaps, splint: Close the incision with
   interrupted absorbable sutures. Place a running transseptal quilting suture from front to back to hold both flaps
   against the remaining septum. Teach: The space between the flaps fills with blood if it is left open. Check: avoid
   quilting sutures pulled tight enough to strangulate the flap.
16_haemostasis.png [step.core.haemostasis]  Common. Inspect both flaps and the incision with the endoscope after the
   patties are removed and the blood pressure is normal.
17_pharynx-clearance.png [step.ent.pharynx-clearance]  Clear the pharynx: throat pack out, clot out, postnasal space
   checked: Remove the throat pack and state its removal aloud so the anaesthetist and scrub practitioner record it.
   Suction the oropharynx and, with a mirror or endoscope, the postnasal space. Remove any clot there before it is
   aspirated at extubation. Teach: A retained throat pack or a clot in the nasopharynx sitting above the larynx can
   obstruct the airway completely after extubation. Check: avoid checking only the oropharynx and missing a clot in
   the nasopharynx behind the soft palate.
18_counts.png [step.core.counts]  Common. Patties, packs and the throat pack counted out. A retained nasal patty is a
   retained swab.
19_airway-handover.png [step.ent.airway-handover]  Airway handover to recovery and the ward: State the airway: tube or
   tracheostomy type and size, whether the cuff is up, whether the upper airway is patent, and whether the patient can
   be oxygenated from above. State the bleeding risk and what bleeding would look like: frequent swallowing, fresh
   blood from mouth or nose, rising heart rate in a child. State whether packs or splints are in and how the patient
   is to breathe; tell recovery that mouth breathing is expected and nasal bleeding through the packs is not. Teach:
   Most ENT airway catastrophes happen after the operation, in recovery or on the ward, in the hands of people who
   were not in theatre. Check: avoid a handover that covers the operation but not what to do if the airway fails.
20_debrief.png [step.core.debrief]  Common.

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
  surgx-gsv-ablation-stripping-steps.zip   (folder gsv-ablation-stripping/)
  surgx-above-knee-amputation-steps.zip   (folder above-knee-amputation/)
  surgx-surgical-tracheostomy-steps.zip   (folder surgical-tracheostomy/)
  surgx-fess-steps.zip   (folder fess/)
  surgx-myringotomy-grommets-steps.zip   (folder myringotomy-grommets/)
  surgx-septoplasty-steps.zip   (folder septoplasty/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
