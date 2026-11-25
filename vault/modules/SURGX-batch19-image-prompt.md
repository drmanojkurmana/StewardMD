---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 19 (Femoral embolectomy, Below-knee amputation, Carotid endarterectomy, Femoro-popliteal bypass, Radiocephalic arteriovenous fistula): Gemini image prompt (100 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant vascular surgeons. You are making 100 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Femoral embolectomy                                            20 images
  B. Below-knee amputation                                          16 images
  C. Carotid endarterectomy                                         22 images
  D. Femoro-popliteal bypass (above knee, vein graft)               22 images
  E. Radiocephalic arteriovenous fistula                            20 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (European Society for Vascular Surgery (ESVS), ESVS 2020 Clinical Practice Guidelines on the Management of Acute Limb Ischaemia; European Society for Vascular Surgery (ESVS), ESVS 2023 Clinical Practice Guidelines on the Management of Atherosclerotic Carotid and Vertebral Artery Disease; European Society for Vascular Surgery (ESVS), ESVS 2024 Clinical Practice Guidelines on the Management of Asymptomatic Lower Limb Peripheral Arterial Disease and Intermittent Claudication; European Society for Vascular Surgery (ESVS), Vascular Access: 2018 Clinical Practice Guidelines of the European Society for Vascular Surgery; European Society for Vascular Surgery, Society for Vascular Surgery and World Federation of Vascular Societies, Global Vascular Guidelines on the Management of Chronic Limb-Threatening Ischemia; Fogarty TJ et al., Surgery, Gynecology and Obstetrics, A method for extraction of arterial emboli and thrombi; GALA Trial Collaborative Group, The Lancet, General anaesthesia versus local anaesthesia for carotid surgery (GALA): a multicentre, randomised controlled trial; National Institute for Health and Care Excellence (NICE), Peripheral arterial disease: diagnosis and management (CG147); National Kidney Foundation KDOQI, KDOQI Clinical Practice Guideline for Vascular Access: 2019 Update; Vascular Society of Great Britain and Ireland (VSGBI), A Best Practice Clinical Care Pathway for Major Amputation Surgery).
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
- A. Supine, with the whole affected leg prepped and free, and the other groin prepped for access or vein harvest.
  Radiolucent table for on-table angiography.
- B. Supine, with a sandbag under the ipsilateral buttock and the knee able to flex. Pad the contralateral heel and
  protect the other foot, which is often also ischaemic.
- C. Supine with the head on a ring, turned slightly away from the operative side and the neck gently extended with a
  roll under the shoulders. Head-up tilt to reduce venous pressure; under local anaesthesia keep the drapes off the
  face so the patient can talk and squeeze a toy in the contralateral hand.
- D. Supine, the leg slightly externally rotated with the knee flexed on a padded support to open the medial thigh.
  Both legs prepared if the contralateral vein may be needed; radiolucent table for completion imaging.
- E. Supine with the arm abducted on an arm table, palm up, the wrist slightly extended over a small roll. The whole
  forearm and hand visible for perfusion checks; operator and assistant seated.
Step-specific facts:
- A. Anatomy: The common femoral artery lies at the mid-inguinal point, midway between the anterior superior iliac
  spine and the pubic symphysis, lateral to the femoral vein. Must be right: Inflate the balloon only enough to feel
  gentle contact with the wall as it is withdrawn. Over-inflation causes intimal injury, dissection and rupture. Pass
  the catheter into the profunda as well as the superficial femoral artery; the profunda may save the limb.
- B. Anatomy: Four compartments: anterior (tibialis anterior, anterior tibial vessels, deep peroneal nerve), lateral
  (peronei, superficial peroneal nerve), superficial posterior (gastrocnemius and soleus) and deep posterior (tibialis
  posterior, posterior tibial and peroneal vessels, tibial nerve). Must be right: Confirm the side with the awake
  patient and mark it. Wrong-side amputation is a never event. Do not exsanguinate an ischaemic or infected limb
  before applying a tourniquet. Handle the flaps without forceps on the skin; ischaemic skin does not forgive
  crushing.
- C. Anatomy: The common carotid artery runs in the carotid sheath with the internal jugular vein lateral and the
  vagus nerve posterior between them. Must be right: Minimal handling of the bifurcation before clamping: dissection
  of a diseased bulb can release embolic plaque and cause a stroke on the table. Clamp the internal carotid first and
  release it last.
- D. Anatomy: The common femoral artery lies at the mid-inguinal point lateral to the femoral vein; it divides into
  the superficial femoral and profunda femoris arteries a few centimetres below the inguinal ligament. Must be right:
  Choose the inflow and target from imaging before the incision; an anastomosis to a diseased segment fails. Treat the
  vein as the operation's most precious tissue: gentle handling, low-pressure distension, no twist.
- E. Anatomy: The radial artery lies at the wrist between brachioradialis and flexor carpi radialis, with its venae
  comitantes. Must be right: Do not use an arm in which the vein or artery has failed the mapping criteria because it
  is the arm on the list. Avoid twisting or kinking the vein as it is swung to the artery. Keep the arteriotomy short
  to limit the risk of steal.
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

A. FEMORAL EMBOLECTOMY  (folder femoral-embolectomy/)
01_consent-check.png [step.core.consent-check]  Common. Include fasciotomy, bypass, amputation and death. These are
   frail patients with cardiac disease.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Prepare the whole affected leg circumferentially to the toes, in a
   clear bag, and the contralateral groin and leg for vein or access.
06_groin-exposure.png [step.emb.groin-exposure]  Exposure of the femoral bifurcation: Make a vertical incision over
   the femoral artery, from just above the inguinal ligament downwards, centred on the mid-inguinal point. Divide the
   femoral sheath over the artery, ligating lymphatics to reduce lymphocele. Teach: The common femoral bifurcation
   gives access to the iliac, superficial femoral and profunda arteries through one incision, and is where emboli most
   often lodge. Check: avoid an incision too low, which finds the superficial femoral artery and misses the profunda.
07_vessel-control.png [step.vasc.vessel-control]  Proximal and distal control before opening the artery: Expose the
   artery above and below the planned arteriotomy, in healthy tissue away from haematoma or disease where possible.
   Pass slings or tapes around each vessel, including the important branches, and identify where each clamp will go
   before applying any. Sling the common femoral, superficial femoral and profunda femoris arteries separately. Teach:
   An artery opened without control bleeds at arterial pressure into a field you can no longer see. Check: avoid
   clamping a heavily calcified segment, which cracks the plaque and causes a dissection.
08_heparin.png [step.vasc.heparin]  Systemic heparin before clamping: Agree the heparin dose with the anaesthetist per
   local protocol, and give it a few minutes before the clamps go on. Record the time and dose; check clotting (for
   example ACT) during long clamp times if the unit uses it. Usually already given at diagnosis. Top it up per local
   protocol before clamping. Teach: Static blood beyond a clamp clots within minutes. Check: avoid clamping before the
   heparin has circulated.
09_arteriotomy.png [step.emb.arteriotomy]  Arteriotomy: A transverse arteriotomy in the common femoral artery just
   above the bifurcation in a soft, healthy artery: it closes primarily without narrowing. A longitudinal arteriotomy
   if the artery is diseased and an endarterectomy, patch or bypass may follow. Teach: The site and direction of the
   arteriotomy decide how easily the catheter enters each branch and whether the artery can be closed without
   narrowing. Check: avoid cutting the back wall with the knife.
10_catheter-passes.png [step.emb.catheter-passes]  Balloon catheter passes: Pass an appropriately sized catheter
   proximally into the iliac system until inflow is pulsatile and strong. Pass catheters distally into the superficial
   femoral and profunda arteries, as far as they go, inflating the balloon gently while withdrawing, with the operator
   feeling the wall. Teach: The balloon catheter extracts clot from vessels that cannot be reached directly. Check:
   avoid over-inflating the balloon, causing intimal damage that later thromboses.
11_flush-backbleed.png [step.vasc.flush-backbleed]  Flushing and back-bleeding before the final sutures: Before tying
   the last suture, release the distal clamp briefly to back-bleed, then the proximal clamp to forward-flush. Irrigate
   the lumen with heparinised saline and remove any loose thrombus or intimal flaps. Teach: Clot, air and debris left
   in the lumen go straight to the distal bed when flow is restored. Check: avoid skipping the flush to save a minute
   at the end of a long operation.
12_arteriotomy-closure.png [step.emb.arteriotomy-closure]  Closure of the arteriotomy: Close a transverse arteriotomy
   primarily with interrupted or continuous fine monofilament sutures. Close a longitudinal arteriotomy with a patch
   (vein or prosthetic) unless the artery is large. Teach: A closure that narrows the artery creates the stenosis that
   will thrombose the repair. Check: avoid primary closure of a longitudinal arteriotomy in a small artery.
13_restore-flow.png [step.vasc.restore-flow]  Restoring flow with the anaesthetist warned: Tell the anaesthetist
   before releasing each clamp so that volume and vasopressors are ready. Release slowly, one limb or one clamp at a
   time, and be ready to reapply if the pressure falls sharply. Teach: Declamping releases cold, acidic, potassium-
   rich blood into the circulation and drops the pressure suddenly. Check: avoid releasing both iliac clamps together
   after a long clamp time.
14_perfusion-check.png [step.vasc.perfusion-check]  Confirming distal perfusion before leaving theatre: Examine both
   feet (or hands) under the drapes: colour, capillary refill, palpable pulses, and handheld Doppler signals. Perform
   completion angiography or duplex when the result is in doubt, or routinely after embolectomy. On-table angiography
   is routine after embolectomy, not an optional extra. Teach: A technically perfect anastomosis with a thrombosed or
   embolised distal bed is a failed operation. Check: avoid draping the feet out of view, so that distal ischaemia is
   found in recovery.
15_fasciotomy-decision.png [step.emb.fasciotomy-decision]  Fasciotomy decision: Consider four-compartment fasciotomy
   after prolonged ischaemia, after a IIb limb, or when the calf is already tense. Use two incisions, lateral and
   medial, decompressing all four compartments. Teach: Reperfusion swelling causes compartment syndrome hours later,
   often at night, when nerve and muscle loss are then irreversible. Check: avoid deferring the decision to the ward
   team overnight.
16_haemostasis.png [step.core.haemostasis]  Common.
17_counts.png [step.core.counts]  Common.
18_specimen.png [step.core.specimen]  Common. Send the embolus for histology: an atrial myxoma or tumour embolus
   changes the whole management.
19_skin-closure.png [step.core.skin-closure]  Common.
20_debrief.png [step.core.debrief]  Common.

B. BELOW-KNEE AMPUTATION  (folder below-knee-amputation/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side and the level. Discuss the chance of the stump
   not healing and needing a higher level, and phantom pain.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Cover for skin flora and, in an infected or gangrenous limb, the
   organisms grown or likely, per local protocol. Thromboprophylaxis is essential.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Isolate the foot in a sealed bag or glove so that infected tissue
   never enters the field.
06_flaps.png [step.bka.flaps]  Marking the level and flaps: Mark the tibial cut at around 12 to 15 cm below the knee
   joint line. Mark the anterior incision transversely at the level of the bone cut, across two thirds of the leg
   circumference. Teach: Most stump failures are decided at the marking: a level without enough blood supply, or flaps
   too short to close without tension. Check: avoid a posterior flap too short to cover the bone end without tension.
07_anterior.png [step.bka.anterior]  Anterior and lateral compartments: Incise the anterior skin and fascia down to
   the tibia, without undermining the skin. Divide the muscles of the anterior and lateral compartments at the level
   of the bone cut. Teach: Dividing the anterior and lateral compartments at the bone level exposes the tibia and
   fibula and the anterior tibial vessels in a controlled order. Check: avoid undermining the anterior skin from the
   periosteum, which devascularises it.
08_vessels.png [step.bka.vessels]  Division of the vessels: Divide the anterior tibial, posterior tibial and peroneal
   arteries and veins separately. Suture-ligate or doubly ligate each artery; transfix the larger ones. Teach: Named
   arteries in a stump must be individually suture-ligated. Check: avoid mass ligation of vessels and nerve together.
09_bone.png [step.bka.bone]  Division and shaping of the tibia and fibula: Elevate the periosteum minimally and divide
   the tibia at the marked level. Bevel the anterior crest of the tibia at roughly 45 degrees and smooth it with a
   rasp. Teach: A sharp or prominent bone end will erode through the skin or make a prosthesis painful. Check: avoid
   leaving a sharp anterior tibial spike.
10_nerves.png [step.bka.nerves]  Nerve handling: Identify the tibial, superficial peroneal, deep peroneal, sural and
   saphenous nerves. Pull each gently distally, divide it sharply, and allow it to retract proximally. Teach: A nerve
   cut under tension retracts away from the stump end, so the neuroma forms in protected tissue rather than where the
   prosthesis loads. Check: avoid cutting a nerve flush with the bone end.
11_posterior.png [step.bka.posterior]  Fashioning the posterior myocutaneous flap: Divide the deep posterior muscles
   at the bone level, then cut the posterior flap with an amputation knife along the marked lines. Trim the soleus to
   reduce bulk while preserving the gastrocnemius and its blood supply. Teach: The posterior flap carries the best
   blood supply and the muscle padding for the stump. Check: avoid a bulky flap closed under tension.
12_haemostasis.png [step.core.haemostasis]  Common. Release any tourniquet before closure and secure haemostasis; a
   stump haematoma becomes a stump infection.
13_counts.png [step.core.counts]  Common.
14_specimen.png [step.core.specimen]  Common. Send the limb for histology, with bone margin for culture if
   osteomyelitis was suspected.
15_skin-closure.png [step.core.skin-closure]  Common. Close without tension, handling skin edges without forceps.
   Interrupted sutures allow a single area to be released.
16_debrief.png [step.core.debrief]  Common.

C. CAROTID ENDARTERECTOMY  (folder carotid-endarterectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the symptomatic side with the patient and the imaging.
   Include stroke, death, cranial nerve injury and neck haematoma in the discussion.
02_timeout.png [step.core.timeout]  Common. State the clamp plan, the shunt availability and the cerebral monitoring
   method aloud at the time-out.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_anaesthesia-monitoring.png [step.cea.anaesthesia-monitoring]  Anaesthetic technique and cerebral monitoring: Agree
   with the anaesthetist on local or regional anaesthesia (superficial or intermediate cervical plexus block plus
   local infiltration) or general anaesthesia. Under local anaesthesia, rehearse the neurological test with the
   patient before draping: speech, orientation and contralateral hand grip. Teach: The way you will know whether the
   brain tolerates clamping depends on the anaesthetic. Check: avoid starting under local anaesthesia in a patient who
   cannot lie still or cooperate.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. From the mastoid and ear lobe to below the clavicle, so that the
   incision can be extended up behind the angle of the jaw.
07_exposure.png [step.cea.exposure]  Exposure of the carotid sheath: Incise along the anterior border of
   sternocleidomastoid, centred on the bifurcation as marked on duplex; curve the upper end posteriorly towards the
   mastoid rather than towards the jaw. Divide platysma and retract sternocleidomastoid laterally; open the carotid
   sheath along the anterior border of the internal jugular vein. Teach: A good exposure lets you control the internal
   carotid beyond the plaque without traction on the bulb or the nerves. Check: avoid extending the incision forward
   towards the jaw and stretching the marginal mandibular nerve with the retractor.
08_nerves.png [step.cea.nerves]  Identifying and protecting the cranial nerves: Find the hypoglossal nerve as it
   crosses the internal and external carotid arteries above the bifurcation. To mobilise it upwards, divide the
   sternocleidomastoid artery and vein and, if needed, the descendens hypoglossi. Identify the vagus in the posterior
   sheath between the artery and the jugular vein before applying any clamp, so that it is not caught. Teach: Cranial
   nerve injury is the commonest complication of carotid surgery. Check: avoid mistaking the hypoglossal nerve for a
   vessel loop of the ansa and dividing it.
09_vessel-control.png [step.vasc.vessel-control]  Proximal and distal control before opening the artery: Expose the
   artery above and below the planned arteriotomy, in healthy tissue away from haematoma or disease where possible.
   Pass slings or tapes around each vessel, including the important branches, and identify where each clamp will go
   before applying any. Sling the common, external and internal carotid arteries and the superior thyroid artery with
   the minimum of dissection at the bulb. Control the internal carotid well beyond the palpable end of the plaque.
   Teach: An artery opened without control bleeds at arterial pressure into a field you can no longer see. Check:
   avoid clamping a heavily calcified segment, which cracks the plaque and causes a dissection.
10_heparin.png [step.vasc.heparin]  Systemic heparin before clamping: Agree the heparin dose with the anaesthetist per
   local protocol, and give it a few minutes before the clamps go on. Record the time and dose; check clotting (for
   example ACT) during long clamp times if the unit uses it. Given before clamping per local protocol; confirm with
   the anaesthetist. Teach: Static blood beyond a clamp clots within minutes. Check: avoid clamping before the heparin
   has circulated.
11_shunt.png [step.cea.shunt]  Clamping, clamp tolerance and shunting: Clamp the internal carotid first, then the
   common and the external carotid, and start timing. Under local anaesthesia, test speech, orientation and hand grip
   immediately and every few minutes; under general anaesthesia, read the agreed monitor. Teach: Most patients
   tolerate carotid clamping because the circle of Willis fills the hemisphere, but some do not. Check: avoid shunt
   not opened, checked and on the trolley before clamping.
12_endarterectomy.png [step.cea.endarterectomy]  Arteriotomy, plaque removal and the distal endpoint: Make a
   longitudinal arteriotomy from the common carotid through the bulb into the internal carotid, past the end of the
   plaque into soft, normal artery. Develop the endarterectomy plane in the media with a dissector, divide the plaque
   proximally, and remove the external carotid plaque by eversion. Teach: The endpoint in the internal carotid decides
   whether the artery stays open. Check: avoid stopping the arteriotomy short of the end of the plaque, so that the
   endpoint is blind.
13_patch-closure.png [step.cea.patch-closure]  Closure of the arteriotomy with a patch: Cut the patch to the length
   and shape of the arteriotomy so that it widens without forming an aneurysmal bulge. Sew with a fine continuous
   monofilament from each end towards the middle, taking care at the distal internal carotid apex, with the shunt in
   place if one is used. Teach: Patch angioplasty reduces early thrombosis and restenosis compared with routine
   primary closure of a longitudinal arteriotomy, and ESVS recommends patch closure (or eversion) over routine primary
   closure. Check: avoid a patch so wide that it forms a bulb with turbulent flow and mural thrombus.
14_flush-backbleed.png [step.vasc.flush-backbleed]  Flushing and back-bleeding before the final sutures: Before tying
   the last suture, release the distal clamp briefly to back-bleed, then the proximal clamp to forward-flush. Irrigate
   the lumen with heparinised saline and remove any loose thrombus or intimal flaps. Back-bleed the internal carotid
   and flush the external and common carotid before the last sutures, irrigating out any debris. Teach: Clot, air and
   debris left in the lumen go straight to the distal bed when flow is restored. Check: avoid skipping the flush to
   save a minute at the end of a long operation.
15_restore-flow.png [step.vasc.restore-flow]  Restoring flow with the anaesthetist warned: Tell the anaesthetist
   before releasing each clamp so that volume and vasopressors are ready. Release slowly, one limb or one clamp at a
   time, and be ready to reapply if the pressure falls sharply. Restore flow into the external carotid first, then the
   internal carotid last, so that any residual debris or air goes to the face rather than the brain. Teach: Declamping
   releases cold, acidic, potassium-rich blood into the circulation and drops the pressure suddenly. Check: avoid
   releasing both iliac clamps together after a long clamp time.
16_heparin-reversal.png [step.vasc.heparin-reversal]  Deciding on, and giving, heparin reversal: Decide with the
   anaesthetist whether to reverse, the dose per local protocol, and the timing, once flow is restored and the repair
   is satisfactory. In cardiac surgery give protamine only after separation from bypass and venous decannulation, and
   tell the perfusionist so that the pump suckers are switched off before it starts. Practice varies; decide
   explicitly. Bleeding into the neck is an airway problem, not only a wound problem. Teach: Protamine reduces wound
   and mediastinal bleeding, but it can cause severe hypotension, pulmonary hypertension or anaphylaxis, and given at
   the wrong moment it clots the repair or the bypass circuit. Check: avoid protamine running while the cardiotomy
   suckers are still returning blood to the circuit.
17_haemostasis.png [step.core.haemostasis]  Common. Check at a blood pressure close to the patient's normal; the patch
   suture line and the needle holes are the usual sources.
18_counts.png [step.core.counts]  Common.
19_specimen.png [step.core.specimen]  Common. Send the plaque if local policy requires it; label the side.
20_skin-closure.png [step.core.skin-closure]  Common. Close the platysma as a separate layer; a drain is optional and
   does not prevent an airway-threatening haematoma.
21_neuro-check.png [step.cea.neuro-check]  Neurological assessment before leaving theatre: Wake the patient in theatre
   (or continue the awake assessment) and examine speech, face, arm and leg strength, and tongue protrusion before
   leaving. If there is a new deficit, scan the artery with duplex on the table and, if it is occluded or the endpoint
   is doubtful, re-open the wound and re-explore without delay. Teach: A new deficit after carotid endarterectomy is
   often due to thrombosis or a flap at the operated site, and the brain can be saved only if this is found and
   corrected within minutes. Check: avoid attributing a new weakness to the anaesthetic and waiting.
22_debrief.png [step.core.debrief]  Common. Record shunt use, clamp time, patch type, the endpoint, the neurological
   state on waking and the blood pressure target.

D. FEMORO-POPLITEAL BYPASS (ABOVE KNEE, VEIN GRAFT)  (folder fem-pop-bypass/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side. Discuss graft failure, wound complications and
   the possibility of amputation.
02_timeout.png [step.core.timeout]  Common. Display the angiogram and the vein map; state the planned inflow, target
   and back-up conduit.
03_prophylaxis.png [step.core.prophylaxis]  Common. Prophylaxis covering skin flora is standard for a groin incision
   and a possible prosthetic graft; agent per local protocol.
04_vein-mapping.png [step.vasc.vein-mapping]  Duplex vein assessment and marking: Review the duplex report yourself:
   diameter, depth, continuity, previous thrombosis, and the course of the vein along its length. Mark the vein on the
   skin with the patient in the position used for the scan (standing or reverse Trendelenburg for leg veins), the
   evening before or in the anaesthetic room. Map the ipsilateral great saphenous vein from the groin to the knee, and
   identify a back-up vein in the other leg or the arms. Teach: Vein operations succeed or fail on the vein. Check:
   avoid operating on an old scan when the vein has since thrombosed or been used.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Prepare the whole leg circumferentially to the toes with the foot in
   a clear bag, plus the abdomen and the contralateral leg.
07_groin-exposure.png [step.fp.groin-exposure]  Exposure of the common femoral bifurcation: Make a vertical groin
   incision over the femoral pulse (or the mid-inguinal point), extending above the inguinal ligament if the common
   femoral artery is high. Ligate the lymphatic tissue as it is divided and keep the dissection on the artery rather
   than lateral to it. Teach: The inflow anastomosis must sit on a soft segment with good pressure. Check: avoid too
   low an incision, which finds the superficial femoral artery but not the common femoral.
08_popliteal-exposure.png [step.fp.popliteal-exposure]  Exposure of the above-knee popliteal artery: With the knee
   flexed, make a medial lower-thigh incision along the anterior border of sartorius, avoiding the great saphenous
   vein. Divide the deep fascia, retract sartorius posteriorly, and enter the popliteal fossa through the fat just
   above the adductor tendon. Teach: The above-knee popliteal artery lies deep to its vein in a confined space. Check:
   avoid approaching posterior to sartorius and losing orientation.
09_vein-harvest.png [step.vasc.vein-harvest]  Harvesting and preparing a vein conduit: Expose the vein through
   continuous or skip incisions directly over the marked course, so that the skin flaps are not undermined. Handle the
   vein by its adventitia or the stumps of its branches only. Ligate or clip each tributary a short distance from the
   vein wall, neither flush nor long. Harvest the great saphenous vein from the saphenofemoral junction to the knee;
   for a reversed graft, label the proximal end clearly. Teach: The long-term patency of a vein graft is largely set
   during harvest. Check: avoid high-pressure distension with a syringe, which tears the intima.
10_conduit-bailout.png [step.fp.conduit-bailout]  When the vein is inadequate: Inspect and distend the harvested vein:
   look for sclerotic segments, varicosities and small calibre, and judge it against the target. If inadequate, use
   the next-best autologous option already identified: contralateral great saphenous, small saphenous or arm vein, or
   a spliced composite. Teach: A small, sclerosed or diseased vein used because it was already harvested is a common
   cause of early failure. Check: avoid using a poor vein because it is already out.
11_tunnel.png [step.fp.tunnel]  Tunnelling the graft: Pass the tunneller in the subsartorial plane from the popliteal
   incision to the groin, keeping deep to sartorius along the line of the femoral vessels. Draw the graft through,
   guided by the line marked along it, so that it is not twisted. Teach: A twisted, kinked or compressed graft
   thromboses regardless of how good the anastomoses are. Check: avoid losing the orientation mark and introducing a
   twist.
12_heparin.png [step.vasc.heparin]  Systemic heparin before clamping: Agree the heparin dose with the anaesthetist per
   local protocol, and give it a few minutes before the clamps go on. Record the time and dose; check clotting (for
   example ACT) during long clamp times if the unit uses it. Teach: Static blood beyond a clamp clots within minutes.
   Check: avoid clamping before the heparin has circulated.
13_vessel-control.png [step.vasc.vessel-control]  Proximal and distal control before opening the artery: Expose the
   artery above and below the planned arteriotomy, in healthy tissue away from haematoma or disease where possible.
   Pass slings or tapes around each vessel, including the important branches, and identify where each clamp will go
   before applying any. Control the common femoral, superficial femoral and profunda at the groin, and the popliteal
   artery above and below the target with slings or bulldogs. Teach: An artery opened without control bleeds at
   arterial pressure into a field you can no longer see. Check: avoid clamping a heavily calcified segment, which
   cracks the plaque and causes a dissection.
14_end-to-side-anastomosis.png [step.vasc.end-to-side-anastomosis]  End-to-side anastomosis: Make a clean longitudinal
   arteriotomy in the softest available segment, and cut the end of the conduit obliquely (spatulated) so that its
   opening matches the arteriotomy. Start at the heel, using a parachute technique where it helps visibility, and keep
   equal, small bites with the needle passed from inside to outside on the diseased side so that plaque is pinned
   rather than lifted. Proximal anastomosis first, reversed vein end to the side of the common femoral artery. Check
   pulsatile flow through the graft, then pass it through the tunnel and perform the distal anastomosis to the above-
   knee popliteal artery. Teach: Most early graft and fistula failures are technical and sit at an anastomosis: a
   narrowed heel or toe, a lifted intimal flap, a purse-stringed suture line or a twisted conduit. Check: avoid
   picking up the back wall in a toe suture.
15_flush-backbleed.png [step.vasc.flush-backbleed]  Flushing and back-bleeding before the final sutures: Before tying
   the last suture, release the distal clamp briefly to back-bleed, then the proximal clamp to forward-flush. Irrigate
   the lumen with heparinised saline and remove any loose thrombus or intimal flaps. Teach: Clot, air and debris left
   in the lumen go straight to the distal bed when flow is restored. Check: avoid skipping the flush to save a minute
   at the end of a long operation.
16_restore-flow.png [step.vasc.restore-flow]  Restoring flow with the anaesthetist warned: Tell the anaesthetist
   before releasing each clamp so that volume and vasopressors are ready. Release slowly, one limb or one clamp at a
   time, and be ready to reapply if the pressure falls sharply. Teach: Declamping releases cold, acidic, potassium-
   rich blood into the circulation and drops the pressure suddenly. Check: avoid releasing both iliac clamps together
   after a long clamp time.
17_perfusion-check.png [step.vasc.perfusion-check]  Confirming distal perfusion before leaving theatre: Examine both
   feet (or hands) under the drapes: colour, capillary refill, palpable pulses, and handheld Doppler signals. Perform
   completion angiography or duplex when the result is in doubt, or routinely after embolectomy. Completion
   angiography or duplex of the graft and run-off; correct any technical defect now. Teach: A technically perfect
   anastomosis with a thrombosed or embolised distal bed is a failed operation. Check: avoid draping the feet out of
   view, so that distal ischaemia is found in recovery.
18_haemostasis.png [step.core.haemostasis]  Common. The harvest wound and the vein branch ties bleed most; the patient
   is still heparinised.
19_counts.png [step.core.counts]  Common.
20_groin-closure.png [step.vasc.groin-closure]  Layered closure of a groin incision: Ligate or seal divided lymphatic
   tissue rather than leaving it to leak; avoid wide undermining. Close the deep fascia and subcutaneous tissue in two
   or more layers so that no cavity remains over the vessels or graft. Teach: The groin is the commonest site of
   vascular wound complications: lymph leak, seroma, infection and breakdown over a graft or a vein stump. Check:
   avoid a single-layer skin closure over a dead space that fills with lymph.
21_skin-closure.png [step.core.skin-closure]  Common. Close the harvest and popliteal wounds without tension and
   without undermining.
22_debrief.png [step.core.debrief]  Common. Record inflow and target, conduit and orientation, completion imaging
   findings and the graft surveillance plan.

E. RADIOCEPHALIC ARTERIOVENOUS FISTULA  (folder av-fistula-radiocephalic/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the arm with the patient and the dialysis team; mark
   the vein and the arm.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis per local protocol; many units give none
   for a primary autologous fistula. Mechanical thromboprophylaxis is rarely relevant for this short operation.
04_vein-mapping.png [step.vasc.vein-mapping]  Duplex vein assessment and marking: Review the duplex report yourself:
   diameter, depth, continuity, previous thrombosis, and the course of the vein along its length. Mark the vein on the
   skin with the patient in the position used for the scan (standing or reverse Trendelenburg for leg veins), the
   evening before or in the anaesthetic room. Confirm the cephalic vein is continuous to the elbow and the radial
   artery is soft and of adequate calibre. Mark the vein with a tourniquet on. Teach: Vein operations succeed or fail
   on the vein. Check: avoid operating on an old scan when the vein has since thrombosed or been used.
05_anaesthesia.png [step.avf.anaesthesia]  Anaesthesia that dilates the vessels: Agree with the anaesthetist on a
   brachial plexus block where available, or careful local infiltration away from the vessels. Keep the patient and
   the arm warm. Teach: Small vessels in spasm are hard to sew and quick to thrombose. Check: avoid a cold theatre and
   an exposed arm, producing spasm.
06_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common. Prepare the hand and whole forearm so that the incision can move
   proximally if the wrist vessels prove unsuitable.
08_exposure.png [step.avf.exposure]  Incision and exposure at the wrist: Make a longitudinal or slightly oblique
   incision between the marked cephalic vein and the radial pulse at the distal forearm. Find the cephalic vein in the
   subcutaneous fat and identify any nerve branches lying with it. Teach: One incision placed between the artery and
   the vein reaches both without undermining, and keeps away from the superficial radial nerve branches. Check: avoid
   an incision directly over the vein, leaving the scar over the future needling site.
09_vein-mobilise.png [step.avf.vein-mobilise]  Mobilising and preparing the cephalic vein: Free a sufficient length of
   cephalic vein to reach the artery without tension, ligating small branches a short distance from the wall. Ligate
   the distal vein and divide it obliquely to create a spatulated end. Teach: The vein must reach the artery in a
   smooth curve. Check: avoid high-pressure syringe distension.
10_vessel-control.png [step.vasc.vessel-control]  Proximal and distal control before opening the artery: Expose the
   artery above and below the planned arteriotomy, in healthy tissue away from haematoma or disease where possible.
   Pass slings or tapes around each vessel, including the important branches, and identify where each clamp will go
   before applying any. Loops or micro-bulldogs on the radial artery above and below the planned arteriotomy; no
   circumferential dissection beyond what is needed. Teach: An artery opened without control bleeds at arterial
   pressure into a field you can no longer see. Check: avoid clamping a heavily calcified segment, which cracks the
   plaque and causes a dissection.
11_heparin.png [step.vasc.heparin]  Systemic heparin before clamping: Agree the heparin dose with the anaesthetist per
   local protocol, and give it a few minutes before the clamps go on. Record the time and dose; check clotting (for
   example ACT) during long clamp times if the unit uses it. Many surgeons use local heparinised saline only, or a
   small systemic dose; agree it with the anaesthetist. Teach: Static blood beyond a clamp clots within minutes.
   Check: avoid clamping before the heparin has circulated.
12_arteriotomy.png [step.avf.arteriotomy]  Radial arteriotomy: Make a longitudinal arteriotomy on the side of the
   radial artery facing the vein, sized to the spatulated vein end and kept short. Check proximal inflow and distal
   back-bleeding through the arteriotomy before sewing. Teach: The arteriotomy length controls the fistula flow.
   Check: avoid cutting the back wall in a small artery.
13_end-to-side-anastomosis.png [step.vasc.end-to-side-anastomosis]  End-to-side anastomosis: Make a clean longitudinal
   arteriotomy in the softest available segment, and cut the end of the conduit obliquely (spatulated) so that its
   opening matches the arteriotomy. Start at the heel, using a parachute technique where it helps visibility, and keep
   equal, small bites with the needle passed from inside to outside on the diseased side so that plaque is pinned
   rather than lifted. End of the cephalic vein to the side of the radial artery, with the vein lying in a gentle
   curve without twist or tension. Teach: Most early graft and fistula failures are technical and sit at an
   anastomosis: a narrowed heel or toe, a lifted intimal flap, a purse-stringed suture line or a twisted conduit.
   Check: avoid picking up the back wall in a toe suture.
14_restore-flow.png [step.vasc.restore-flow]  Restoring flow with the anaesthetist warned: Tell the anaesthetist
   before releasing each clamp so that volume and vasopressors are ready. Release slowly, one limb or one clamp at a
   time, and be ready to reapply if the pressure falls sharply. Release the vein clamp, then the distal and proximal
   arterial clamps; small-volume flow means systemic effects are minimal, but suture line leaks show now. Teach:
   Declamping releases cold, acidic, potassium-rich blood into the circulation and drops the pressure suddenly. Check:
   avoid releasing both iliac clamps together after a long clamp time.
15_perfusion-check.png [step.vasc.perfusion-check]  Confirming distal perfusion before leaving theatre: Examine both
   feet (or hands) under the drapes: colour, capillary refill, palpable pulses, and handheld Doppler signals. Perform
   completion angiography or duplex when the result is in doubt, or routinely after embolectomy. Feel for a continuous
   thrill along the vein and check the hand: colour, capillary refill and the radial and ulnar Doppler signals at the
   palm. Teach: A technically perfect anastomosis with a thrombosed or embolised distal bed is a failed operation.
   Check: avoid draping the feet out of view, so that distal ischaemia is found in recovery.
16_no-thrill.png [step.avf.no-thrill]  No thrill or a cold hand: A pulse without a thrill suggests outflow
   obstruction: check the vein for twist, kink, a ligated outflow branch or a valve, and pass a probe or flush along
   it. No pulse and no thrill suggests inflow or anastomotic failure: open the anastomosis, remove thrombus, check the
   arteriotomy and resew. Teach: A fistula that has only a pulse and no thrill at the end of the operation is likely
   to fail within hours. Check: avoid closing on a weak or absent thrill and hoping it improves.
17_haemostasis.png [step.core.haemostasis]  Common.
18_counts.png [step.core.counts]  Common.
19_skin-closure.png [step.core.skin-closure]  Common. Loose closure without compression over the vein; a light
   dressing that allows the thrill to be felt.
20_debrief.png [step.core.debrief]  Common. Record the vessels' sizes, the anastomosis, the thrill and the hand status
   at the end; give the patient and the dialysis unit the plan.

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
  surgx-femoral-embolectomy-steps.zip   (folder femoral-embolectomy/)
  surgx-below-knee-amputation-steps.zip   (folder below-knee-amputation/)
  surgx-carotid-endarterectomy-steps.zip   (folder carotid-endarterectomy/)
  surgx-fem-pop-bypass-steps.zip   (folder fem-pop-bypass/)
  surgx-av-fistula-radiocephalic-steps.zip   (folder av-fistula-radiocephalic/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
