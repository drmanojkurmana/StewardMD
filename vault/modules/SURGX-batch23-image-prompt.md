---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 23 (Hemiarthroplasty of the hip, Open reduction and internal fixation of the ankle, Distal radius fracture fixation, Arthroscopic ACL reconstruction, Split-thickness skin graft): Gemini image prompt (103 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant orthopaedic surgeons and plastic and hand surgeons. You are making 103 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Hemiarthroplasty of the hip                                    22 images
  B. Open reduction and internal fixation of the ankle              22 images
  C. Distal radius fracture fixation                                22 images
  D. Arthroscopic ACL reconstruction (hamstring graft)              21 images
  E. Split-thickness skin graft                                     16 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Academy of Orthopaedic Surgeons (AAOS), Management of Anterior Cruciate Ligament Injuries: Evidence-Based Clinical Practice Guideline; American Academy of Orthopaedic Surgeons (AAOS), Management of Distal Radius Fractures: Evidence-Based Clinical Practice Guideline; Association of Anaesthetists (Griffiths R et al). Anaesthesia 76:225, Guideline for the management of hip fractures 2020; Asuku M et al. Burns 47:1525, Split-thickness skin graft donor-site morbidity: a systematic literature review; British Orthopaedic Association, BOAST: The management of ankle fractures; Brown JE et al.).
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
- A. Lateral decubitus with pelvic supports, operated side up, with careful padding of frail skin and the down-side
  heel and fibular head. Keep the patient warm; hypothermia worsens bleeding and delirium.
- B. Supine with a sandbag under the ipsilateral buttock to internally rotate the leg, or lateral for a posterior
  approach. Thigh tourniquet; heel on a padded support so the C-arm can obtain true mortise and lateral views.
- C. Supine with the arm on a radiolucent hand table, forearm supinated for the volar approach. Upper arm tourniquet;
  image intensifier able to reach posteroanterior, lateral and tilted views.
- D. Supine with a lateral post or leg holder, allowing hyperflexion beyond 120 degrees for the femoral tunnel. Thigh
  tourniquet; foot rest to hold the knee at 90 degrees.
- E. Positioned so both donor and recipient sites are accessible, with pressure areas protected.
Step-specific facts:
- A. Anatomy: The femoral head blood supply is mainly from the medial femoral circumflex artery through retinacular
  vessels along the neck; a displaced intracapsular fracture disrupts it, which is why the head is replaced rather
  than fixed. Must be right: Run the cement safety pause: brief the team, ensure the anaesthetist is ready, and use
  modern cementing technique with a canal plug, lavage, drying and a cement gun.
- B. Anatomy: The superficial peroneal nerve pierces the deep fascia in the distal leg and crosses anterior to the
  fibula at a variable level, so it is at risk in the proximal wound. Must be right: Operate when the soft tissues
  allow, not when the list allows. Restore fibular length and rotation before judging the syndesmosis. Always test the
  syndesmosis after fixation and confirm congruent mortise on the final images.
- C. Anatomy: The watershed line is the most volar ridge of the distal radius; a plate placed distal to it contacts
  flexor pollicis longus. The palmar cutaneous branch of the median nerve runs ulnar to the FCR tendon and is
  protected by staying within the FCR sheath. Must be right: Stay within the FCR sheath, and proximal to the watershed
  line. Check dorsal screw length on a dorsal tangential view. Check median nerve function and DRUJ stability before
  leaving theatre.
- D. Anatomy: The ACL runs from the posteromedial aspect of the lateral femoral condyle to the tibia in front of and
  lateral to the medial tibial spine. The lateral intercondylar ridge marks the anterior border of the femoral
  footprint. Must be right: Release every hamstring accessory band before stripping. Watch the tibial guide pin while
  reaming so it cannot advance posteriorly. Confirm femoral fixation before tensioning the graft.
- E. Anatomy: A split-thickness graft carries epidermis and part of the dermis; the donor heals from adnexal remnants
  in the remaining dermis. Thinner grafts take more reliably and the donor heals faster; thicker grafts contract less
  and look better. Must be right: Prepare the bed before harvesting the graft: a perfect graft on a poor bed fails.
  Dermis side down. A graft placed upside down will not take. Prevent shear, haematoma and seroma: these, with
  infection, account for most graft loss.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 103 images)
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

A. HEMIARTHROPLASTY OF THE HIP  (folder hip-hemiarthroplasty/)
01_consent-check.png [step.core.consent-check]  Common. Assess capacity. If the patient lacks capacity, use the best-
   interests process and involve the family. Mark the side.
02_timeout.png [step.core.timeout]  Common. State at the time-out whether the patient is at high risk from cement, and
   the plan if blood pressure falls.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_arthroplasty-asepsis.png [step.ortho.arthroplasty-asepsis]  Arthroplasty theatre discipline and asepsis: Use an
   ultraclean air (laminar flow) theatre where available, keep the doors shut and keep traffic to the people who need
   to be there. Open implants only when the size is decided and keep trays covered until needed. Teach: A deep
   infection around a joint replacement usually means further major surgery. Check: avoid opening every implant size
   'to be ready'.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_posterior-hip-approach.png [step.ortho.posterior-hip-approach]  Posterior (Southern) approach to the hip: Centre a
   curved incision on the posterior third of the greater trochanter, running proximally towards the posterior superior
   iliac spine and distally along the femoral shaft. Divide fascia lata in line with the incision and split gluteus
   maximus bluntly in the line of its fibres; coagulate the vessels in the split. If your unit uses the anterolateral
   approach (which NICE CG124 suggests considering), substitute it here. Teach: The posterior approach gives wide
   access to the femur and acetabulum through the gluteus maximus split and the short external rotators. Check: avoid
   retractor placed blindly behind the rotators, compressing the sciatic nerve.
08_neck-osteotomy.png [step.ortho.neck-osteotomy]  Dislocation and femoral neck osteotomy: Dislocate the hip
   posteriorly with gentle flexion, adduction and internal rotation; if it does not come out easily, release more
   capsule or remove osteophytes rather than force it, especially in osteoporotic bone. Mark the neck cut from the
   templated distance above the lesser trochanter, checked against the trial stem or the cutting guide. The head is
   free in a displaced fracture: remove it with a corkscrew, clear fragments of neck and ligamentum teres, then trim
   the neck to the templated level. Teach: The level and angle of the neck cut set the starting point for leg length
   and offset. Check: avoid levering the leg into internal rotation against a hip that will not dislocate, causing a
   femoral shaft fracture.
09_head-sizing.png [step.hemi.head-sizing]  Measuring the femoral head and choosing the prosthetic head: Measure the
   extracted head diameter with the sizing gauge in two planes. Inspect the acetabular cartilage: significant
   arthritis changes the decision towards total hip replacement if the patient meets the criteria and it was consented
   for. Teach: In a hemiarthroplasty the prosthetic head articulates against native cartilage. Check: avoid estimating
   size by eye.
10_femoral-canal-prep.png [step.ortho.femoral-canal-prep]  Femoral canal preparation and broaching: Expose the cut
   neck by flexing, adducting and internally rotating the hip, with the tibia vertical so it shows the version of the
   femur. Open the canal laterally in the piriform fossa with a box chisel so the stem goes down the axis, not into
   varus. Osteoporotic bone fractures easily. Broach with control, not force. Teach: The broach shapes the canal for
   the stem. Check: avoid starting medially so the broach and stem end in varus.
11_trial-reduction.png [step.ortho.trial-reduction]  Trial components: stability, length and range: Reduce with the
   trial components and move the joint through the full range the patient will use. Test for impingement and
   instability in the positions that dislocate the joint or cause it to lift off, as described for the specific joint.
   Check stability through a functional range, and that the trial neck length does not make the leg longer than the
   other side. Teach: Trials are the last cheap moment to change size, offset, version or balance. Check: avoid
   accepting instability and hoping the soft-tissue repair will hold it.
12_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Teach: The wrong size, side or type cannot be undone after insertion, and an implant that is not registered cannot
   be traced if it is recalled. Check: avoid opening an implant before the measurement is confirmed.
13_cement-implant.png [step.ortho.cement-implant]  Cementing and implanting with a cement safety pause: Announce aloud
   that cement is about to be inserted. The anaesthetist confirms they are ready, with invasive monitoring where
   planned and vasopressors drawn up. Prepare the bone bed: lavage (pulsatile where used), suction and dry it; insert
   a cement restrictor in the femoral canal where the technique calls for one. Follow the cemented hemiarthroplasty
   safety guideline: canal plug, lavage, drying, retrograde gun delivery, and avoid excessive pressurisation in high-
   risk patients. Teach: Cement gives immediate fixation in poor bone, but pressurisation can drive marrow and fat
   into the circulation. Check: avoid cementing without warning the anaesthetist.
14_hip-final-reduction.png [step.ortho.hip-final-reduction]  Definitive reduction and stability check of the hip:
   Clean the taper, impact the definitive head and reduce with longitudinal traction and gentle rotation, keeping soft
   tissue out of the joint. Repeat the stability tests done with the trials: flexion with internal rotation for
   posterior stability, and extension with external rotation for anterior stability. Teach: The definitive implants
   can behave differently from the trials. Check: avoid impacting a head onto a wet or contaminated taper.
15_periprosthetic-fracture.png [step.ortho.periprosthetic-fracture]  Intra-operative periprosthetic fracture: stop and
   reassess: Stop impacting when the feel or sound changes. Expose the bone and look for the full extent of any crack.
   Image the bone with the image intensifier or a radiograph in theatre if the extent is not clear. Teach: Fractures
   around a component happen during preparation, impaction or reduction, especially in osteoporotic bone. Check: avoid
   continuing to impact a component after a change in feel.
16_posterior-repair.png [step.ortho.posterior-repair]  Posterior capsule and short external rotator repair: Pass the
   capsular and rotator stay sutures through drill holes in the greater trochanter, or through the gluteus medius
   tendon insertion, with the hip in slight abduction and external rotation. Tie them with the hip in extension and
   slight external rotation so the repair is not under tension. Teach: Repairing the posterior capsule and rotators
   reduces the risk of dislocation after a posterior approach. Check: avoid tying the repair with the hip internally
   rotated, so it fails on the first movement.
17_haemostasis.png [step.core.haemostasis]  Common.
18_counts.png [step.core.counts]  Common.
19_specimen.png [step.core.specimen]  Common. Send the femoral head for histology if there is any suspicion of a
   pathological fracture.
20_skin-closure.png [step.core.skin-closure]  Common.
21_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Teach: Deficits and compartment syndrome that are found early are
   treatable. Check: avoid assuming the limb is fine because it was fine before.
22_debrief.png [step.core.debrief]  Common. Record full weight bearing and any reason for restriction, so the
   physiotherapist can start the next day.

B. OPEN REDUCTION AND INTERNAL FIXATION OF THE ANKLE  (folder ankle-orif/)
01_consent-check.png [step.core.consent-check]  Common. Check the skin and the wrinkle sign before confirming the
   operation goes ahead today.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. Teach: A
   tourniquet gives a bloodless field but adds ischaemia to injured tissue and hides bleeding that tells you what is
   alive. Check: avoid inflating on a limb with suspected compartment syndrome or arterial injury.
06_image-intensifier.png [step.ortho.image-intensifier]  Image intensifier set-up and radiation safety: Position the
   C-arm and confirm that true anteroposterior and lateral views can be obtained before preparing the skin. Lead
   protection and dosimeters for all staff; thyroid shields; the radiographer briefed on the views needed. Confirm a
   true mortise view (about 15 to 20 degrees of internal rotation) and a true lateral before preparing. Teach:
   Fixation is only as good as the images it is judged by, and every second of screening is dose to the patient and
   the team. Check: avoid discovering after draping that a true lateral cannot be obtained.
07_prep-drape.png [step.core.prep-drape]  Common.
08_lateral-approach.png [step.ankle.lateral-approach]  Lateral approach to the distal fibula: Incise along the
   posterior border of the fibula (or directly lateral, according to the planned plate position), centred on the
   fracture. Before deepening proximally, look for the superficial peroneal nerve crossing anteriorly in the
   subcutaneous tissue and protect it. Teach: The fibula is subcutaneous, so the approach is simple, but the
   superficial peroneal nerve crosses from posterior to anterior in the distal leg at a variable level and the skin
   over the fibula tolerates little retraction or a prominent plate. Check: avoid cutting the superficial peroneal
   nerve in the proximal part of the wound.
09_fracture-exposure.png [step.ortho.fracture-exposure]  Exposing and cleaning the fracture: Expose only the fracture
   edges you need to read and reduce. Keep soft tissue attached to small fragments. Irrigate and clear haematoma and
   interposed periosteum from the fracture lines with a curette and small elevator. Teach: A fracture cannot be
   reduced accurately while clot, periosteum and soft tissue sit between the fragments. Check: avoid wide
   circumferential stripping to 'see better'.
10_reduction-check.png [step.ortho.reduction-check]  Reduction confirmed in two planes: Reduce by traction and the
   manoeuvre the fracture needs, then screen in two orthogonal planes. Check length, angulation in both planes and
   rotation against landmarks or the other limb. Restore fibular length, rotation and alignment; the talus should sit
   congruent in the mortise with a normal medial clear space. Teach: Fixing a malreduced fracture fixes the
   malreduction. Check: avoid accepting a single good view.
11_provisional-fixation.png [step.ortho.provisional-fixation]  Provisional fixation with clamps and K-wires: Hold the
   reduction with pointed reduction clamps applied with modest force. Add K-wires placed where they will not obstruct
   the plate or the planned screws. Teach: Provisional fixation holds the reduction while it is checked in two planes
   and while the plate is applied. Check: avoid k-wires placed exactly where the plate needs to sit.
12_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Teach: The wrong size, side or type cannot be undone after insertion, and an implant that is not registered cannot
   be traced if it is recalled. Check: avoid opening an implant before the measurement is confirmed.
13_plate-fixation.png [step.ortho.plate-fixation]  Plate application and screw insertion: Choose plate length to give
   the planned number of screws on each side of the fracture; contour it if the system is not pre-contoured. Position
   the plate on the surface the plan requires, check its position on screening before the first screw, and use the
   first screw to hold position, not to pull the bone to a badly placed plate. For a short oblique Weber B fracture:
   an interfragmentary lag screw, then a neutralisation plate laterally or an antiglide plate posterolaterally. Avoid
   long distal screws entering the joint. Teach: The plate provides the stability that lets the fracture heal and the
   joint move. Check: avoid screws that are too long, irritating tendons or entering the joint.
14_medial-malleolus.png [step.ankle.medial-malleolus]  Medial malleolus reduction and fixation: Anteromedial incision
   over the fracture, protecting the long saphenous vein and saphenous nerve. Clear interposed periosteum, inspect the
   anteromedial joint surface and the talar dome, and reduce with a pointed clamp or a K-wire joystick. Teach: A
   displaced medial malleolar fracture leaves the talus unstable and the joint incongruent. Check: avoid accepting a
   gap with interposed periosteum.
15_syndesmosis.png [step.ankle.syndesmosis]  Syndesmosis: test, reduce and fix: After fibular fixation, stress the
   syndesmosis: a lateral pull on the fibula with a bone hook, and an external rotation stress under fluoroscopy. Look
   for widening of the medial clear space and tibiofibular clear space. If unstable, reduce the fibula into the
   incisura under direct vision or fluoroscopy, checking fibular length and rotation; use a clamp with moderate force,
   aligned with the axis of the incisura, to avoid over-compression and malreduction. Teach: An unstable syndesmosis
   left unfixed lets the talus shift, but a syndesmosis fixed in a malreduced position is common and harms outcome as
   much. Check: avoid clamp placed obliquely, pushing the fibula anterior or posterior in the incisura.
16_final-imaging.png [step.ortho.final-imaging]  Final images saved in two planes: Screen the whole construct in two
   planes, including the ends of the implant and the joints at either end. Confirm reduction, implant position and
   screw lengths; look specifically for joint penetration. Mortise and lateral: congruent joint, equal medial clear
   space, fibular length restored, no intra-articular screws. Teach: The final images are the evidence of what was
   achieved. Check: avoid saving only the best-looking view.
17_fixation-bailout.png [step.ortho.fixation-bailout]  Bail-out when definitive fixation is not safe: Recognise the
   situation early: blistered or swollen skin, comminution beyond what the implant can hold, or a reduction that
   cannot be maintained. Stabilise with a spanning external fixator, a bridging plate or K-wires, as appropriate to
   the injury. If the skin is not ready or the reduction cannot be held, stabilise with a spanning external fixator
   and return when the soft tissues allow. Teach: Sometimes the soft tissue or the bone will not tolerate the planned
   fixation. Check: avoid proceeding through compromised skin because the list is booked.
18_haemostasis.png [step.core.haemostasis]  Common.
19_counts.png [step.core.counts]  Common.
20_skin-closure.png [step.core.skin-closure]  Common. Tension-free closure with careful handling of thin skin over the
   plate.
21_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Teach: Deficits and compartment syndrome that are found early are
   treatable. Check: avoid assuming the limb is fine because it was fine before.
22_debrief.png [step.core.debrief]  Common. State the weight-bearing instruction and the length of protection
   explicitly.

C. DISTAL RADIUS FRACTURE FIXATION  (folder distal-radius-fixation/)
01_consent-check.png [step.core.consent-check]  Common. Record median nerve function before surgery.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. Teach: A
   tourniquet gives a bloodless field but adds ischaemia to injured tissue and hides bleeding that tells you what is
   alive. Check: avoid inflating on a limb with suspected compartment syndrome or arterial injury.
06_image-intensifier.png [step.ortho.image-intensifier]  Image intensifier set-up and radiation safety: Position the
   C-arm and confirm that true anteroposterior and lateral views can be obtained before preparing the skin. Lead
   protection and dosimeters for all staff; thyroid shields; the radiographer briefed on the views needed. Teach:
   Fixation is only as good as the images it is judged by, and every second of screening is dose to the patient and
   the team. Check: avoid discovering after draping that a true lateral cannot be obtained.
07_prep-drape.png [step.core.prep-drape]  Common.
08_fcr-approach.png [step.dr.fcr-approach]  Volar approach through the flexor carpi radialis sheath: Incise
   longitudinally over the FCR tendon, from the distal wrist crease proximally, without crossing the crease at a right
   angle. Open the FCR sheath, retract the tendon ulnarward and incise the floor of the sheath; sweep the flexor
   pollicis longus ulnarward with a finger. Teach: Working through the floor of the FCR sheath keeps the radial artery
   to one side and the median nerve and its palmar cutaneous branch to the other, and gives direct access to the volar
   radius under pronator quadratus. Check: avoid straying ulnar to the FCR sheath into the median nerve territory.
09_fracture-exposure.png [step.ortho.fracture-exposure]  Exposing and cleaning the fracture: Expose only the fracture
   edges you need to read and reduce. Keep soft tissue attached to small fragments. Irrigate and clear haematoma and
   interposed periosteum from the fracture lines with a curette and small elevator. Inspect the volar cortex for the
   key reduction; keep soft tissue on small articular fragments. Teach: A fracture cannot be reduced accurately while
   clot, periosteum and soft tissue sit between the fragments. Check: avoid wide circumferential stripping to 'see
   better'.
10_reduction-check.png [step.ortho.reduction-check]  Reduction confirmed in two planes: Reduce by traction and the
   manoeuvre the fracture needs, then screen in two orthogonal planes. Check length, angulation in both planes and
   rotation against landmarks or the other limb. Restore radial height and inclination on the PA, volar tilt on the
   lateral, and the articular surface on a tilted lateral. Reduction of the volar cortex is often the key. Teach:
   Fixing a malreduced fracture fixes the malreduction. Check: avoid accepting a single good view.
11_provisional-fixation.png [step.ortho.provisional-fixation]  Provisional fixation with clamps and K-wires: Hold the
   reduction with pointed reduction clamps applied with modest force. Add K-wires placed where they will not obstruct
   the plate or the planned screws. A K-wire through the radial styloid commonly holds the reduction while the plate
   is placed. Teach: Provisional fixation holds the reduction while it is checked in two planes and while the plate is
   applied. Check: avoid k-wires placed exactly where the plate needs to sit.
12_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Teach: The wrong size, side or type cannot be undone after insertion, and an implant that is not registered cannot
   be traced if it is recalled. Check: avoid opening an implant before the measurement is confirmed.
13_plate-fixation.png [step.ortho.plate-fixation]  Plate application and screw insertion: Choose plate length to give
   the planned number of screws on each side of the fracture; contour it if the system is not pre-contoured. Position
   the plate on the surface the plan requires, check its position on screening before the first screw, and use the
   first screw to hold position, not to pull the bone to a badly placed plate. Position the plate first with a screw
   in the oblong hole, adjust under screening, then fix distally with locking screws in the subchondral bone, short of
   the dorsal cortex. Teach: The plate provides the stability that lets the fracture heal and the joint move. Check:
   avoid screws that are too long, irritating tendons or entering the joint.
14_screw-check.png [step.dr.screw-check]  Plate position and screw length check: Confirm on the lateral that the plate
   sits proximal to the watershed line, or as close to it as the fracture allows, and flush with bone. Take a tilted
   lateral to see the articular surface and a dorsal tangential (skyline) view to check that no screw passes beyond
   the dorsal cortex. Teach: Volar plates cause harm from the edges: a plate distal to the watershed line rubs the
   flexor tendons, and dorsal screws that are too long rupture the extensor tendons. Check: avoid relying on the
   standard lateral view to judge dorsal screw length.
15_kwire.png [step.dr.kwire]  K-wire fixation (alternative to plating): Reduce closed by traction and manipulation and
   confirm on both views. Make a small incision at each wire entry point and spread bluntly down to bone, using a
   drill guide, to avoid the superficial radial nerve and the extensor tendons. Teach: For dorsally displaced
   fractures that reduce closed, K-wire fixation gave similar function at one year to a volar locking plate in the
   DRAFFT trial, with a shorter, cheaper operation. Check: avoid inserting wires percutaneously without a guide,
   transfixing the superficial radial nerve or a tendon.
16_fixation-bailout.png [step.ortho.fixation-bailout]  Bail-out when definitive fixation is not safe: Recognise the
   situation early: blistered or swollen skin, comminution beyond what the implant can hold, or a reduction that
   cannot be maintained. Stabilise with a spanning external fixator, a bridging plate or K-wires, as appropriate to
   the injury. For severe comminution that the plate cannot hold, consider a dorsal bridge plate or a spanning
   external fixator. Teach: Sometimes the soft tissue or the bone will not tolerate the planned fixation. Check: avoid
   proceeding through compromised skin because the list is booked.
17_final-imaging.png [step.ortho.final-imaging]  Final images saved in two planes: Screen the whole construct in two
   planes, including the ends of the implant and the joints at either end. Confirm reduction, implant position and
   screw lengths; look specifically for joint penetration. Teach: The final images are the evidence of what was
   achieved. Check: avoid saving only the best-looking view.
18_haemostasis.png [step.core.haemostasis]  Common. Release the tourniquet and check the radial artery branches before
   closure; repair pronator quadratus where possible.
19_counts.png [step.core.counts]  Common.
20_skin-closure.png [step.core.skin-closure]  Common.
21_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Median nerve sensation and finger perfusion; elevate and start finger
   movement. Teach: Deficits and compartment syndrome that are found early are treatable. Check: avoid assuming the
   limb is fine because it was fine before.
22_debrief.png [step.core.debrief]  Common.

D. ARTHROSCOPIC ACL RECONSTRUCTION (HAMSTRING GRAFT)  (folder acl-reconstruction/)
01_consent-check.png [step.core.consent-check]  Common. Include consent for an alternative graft source in case of
   hamstring amputation, and for meniscal repair or resection.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_eua.png [step.acl.eua]  Examination under anaesthesia: Compare both knees: range of movement, Lachman, anterior
   drawer, pivot shift. Test varus and valgus at 0 and 30 degrees, posterior drawer and dial test for associated
   ligament injuries. Teach: Under anaesthesia, without guarding, the Lachman and pivot shift tests confirm the
   diagnosis and reveal associated laxity (collateral or posterolateral) that would change the operation. Check: avoid
   skipping the examination because the MRI showed the tear.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. Teach: A
   tourniquet gives a bloodless field but adds ischaemia to injured tissue and hides bleeding that tells you what is
   alive. Check: avoid inflating on a limb with suspected compartment syndrome or arterial injury.
07_prep-drape.png [step.core.prep-drape]  Common.
08_portals-diagnostic.png [step.acl.portals-diagnostic]  Arthroscopic portals and diagnostic arthroscopy: Create the
   anterolateral portal high and close to the patellar tendon; place the anteromedial portal under direct vision using
   a spinal needle, so it reaches the femoral footprint. Inspect systematically: suprapatellar pouch, patellofemoral
   joint, gutters, medial compartment, notch, lateral compartment. Teach: Well-placed portals make every later step
   easier, and a systematic inspection finds the meniscal and chondral injuries that commonly accompany an ACL tear
   and change both the operation and the prognosis. Check: avoid a low anteromedial portal that cannot reach the
   femoral footprint.
09_graft-harvest.png [step.acl.graft-harvest]  Hamstring graft harvest (semitendinosus and gracilis): Make an incision
   over the pes anserinus on the anteromedial tibia, below and medial to the tibial tubercle. Incise the sartorius
   fascia in line with the tendons, identify gracilis (proximal) and semitendinosus (distal) from the deep side, and
   tag each tendon. Teach: The graft is the reconstruction. Check: avoid using the stripper before the accessory bands
   are released.
10_graft-prep.png [step.acl.graft-prep]  Graft preparation and sizing: Strip muscle from the tendons on the back
   table, keeping the graft moist and covered. Fold the tendons to make the planned multi-strand graft and whipstitch
   the ends. Teach: The graft's diameter and length decide the tunnel size and fixation. Check: avoid dropping the
   graft on the floor without a plan: know the local protocol for decontamination or an alternative graft.
11_femoral-tunnel.png [step.acl.femoral-tunnel]  Notch preparation and anatomical femoral tunnel: Debride the ACL
   stump with a shaver, preserving enough of the footprint to see where it was; perform a notchplasty only if the
   graft will impinge. Identify the footprint on the medial wall of the lateral femoral condyle, behind the lateral
   intercondylar ridge, using the ridge and the posterior cartilage margin as landmarks. Teach: A non-anatomical
   femoral tunnel, usually too high or too anterior, is a common technical cause of failure. Check: avoid drilling
   with the knee insufficiently flexed, giving a short tunnel or a posterior wall blow-out.
12_tibial-tunnel.png [step.acl.tibial-tunnel]  Anatomical tibial tunnel: Set the tibial guide through the anteromedial
   portal on the centre of the tibial footprint, in front of the PCL and in line with the posterior edge of the
   anterior horn of the lateral meniscus. Start the external entry medial to the tibial tubercle above the pes
   insertion, and advance the guide pin under vision into the joint, protecting the femoral condyle with a curette.
   Teach: The tibial tunnel decides where the graft emerges in the joint. Check: avoid guide pin advancing with the
   reamer into the back of the knee.
13_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Fixation devices sized to the measured graft and tunnel lengths before opening. Teach: The wrong size, side or type
   cannot be undone after insertion, and an implant that is not registered cannot be traced if it is recalled. Check:
   avoid opening an implant before the measurement is confirmed.
14_pass-fix.png [step.acl.pass-fix]  Graft passage, tensioning and fixation: Pass the graft from tibia to femur with
   the leading sutures, under arthroscopic vision. Deploy femoral fixation and confirm it: feel the button flip and
   lock, and confirm on vision or fluoroscopy that it sits on the cortex with no soft tissue between. Teach: Fixation
   holds the graft until it incorporates. Check: avoid assuming the button has flipped without checking.
15_final-check.png [step.acl.final-check]  Final graft check: impingement, tension and stability: Fully extend the
   knee under vision: the graft should not impinge on the roof of the notch. Probe the graft for tension and inspect
   the tunnel apertures. Teach: The last look shows whether the graft impinges in extension, whether it is taut and
   whether the knee is now stable. Check: avoid missing an extension deficit caused by roof impingement or a cyclops
   lesion.
16_bailout.png [step.acl.bailout]  Graft or tunnel problems: change the plan safely: Short or small graft: add
   strands, change configuration, or take a different autograft (contralateral hamstrings, bone-patellar tendon-bone
   or quadriceps) only if consented; allograft per local availability. Posterior wall blow-out: switch to suspensory
   cortical fixation, or redirect the tunnel; do not rely on an interference screw without a back wall. Teach: A short
   or amputated graft, a posterior wall blow-out or a tunnel in the wrong place each has a standard rescue. Check:
   avoid persisting with a tunnel or graft that will fail.
17_haemostasis.png [step.core.haemostasis]  Common. Check the harvest site, which is the usual source of a
   postoperative haematoma.
18_counts.png [step.core.counts]  Common.
19_skin-closure.png [step.core.skin-closure]  Common.
20_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Teach: Deficits and compartment syndrome that are found early are
   treatable. Check: avoid assuming the limb is fine because it was fine before.
21_debrief.png [step.core.debrief]  Common.

E. SPLIT-THICKNESS SKIN GRAFT  (folder split-skin-graft/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. On a limb
   recipient site, inflate only for bed preparation and deflate for haemostasis before the graft goes on. Teach: A
   tourniquet gives a bloodless field but adds ischaemia to injured tissue and hides bleeding that tells you what is
   alive. Check: avoid inflating on a limb with suspected compartment syndrome or arterial injury.
06_prep-drape.png [step.core.prep-drape]  Common.
07_debride.png [step.st.debride]  Debridement of non-viable tissue: Excise to bleeding, contractile, healthy tissue in
   every direction. In necrotising infection, follow the plane of easy finger dissection: where the fascia separates
   without resistance, the disease has been. Excise granulation tissue and slough to a flat, bleeding, healthy bed.
   Teach: Antibiotics do not reach dead tissue. Check: avoid a conservative first debridement in necrotising
   infection.
08_haemostasis.png [step.core.haemostasis]  Common. Haemostasis of the bed is graft survival. Any haematoma lifts the
   graft off its blood supply.
09_harvest.png [step.stsg.harvest]  Graft harvest: Mark the area required; lubricate the donor and keep the skin under
   tension. Set the dermatome depth and width, and check them before cutting. Teach: The depth of harvest decides both
   whether the graft takes and how well the donor heals. Check: avoid an uneven graft from inconsistent pressure.
10_mesh.png [step.stsg.mesh]  Meshing or fenestration: Mesh at the ratio the wound needs, or fenestrate with a blade
   for sheet grafts. Use unmeshed sheet graft on the face and hands where appearance and contracture matter most.
   Teach: Meshing lets blood and serum escape and expands the graft. Check: avoid over-expanding a mesh so that
   interstices heal slowly.
11_inset.png [step.stsg.inset]  Graft inset and fixation: Lay the graft dermal side down on the bed with slight
   tension, avoiding folds. Fix the edges with staples, sutures or glue, trimming the excess. Teach: A graft takes
   only where it touches a vascular bed and stays still. Check: avoid graft placed upside down.
12_wound-photos.png [step.ortho.wound-photos]  Wound photographs at key stages: Photograph at first exposure in
   theatre, after debridement, and at closure or cover, per the governance policy for clinical images. Include a scale
   and a reference point so the extent is clear. Teach: Photographs let the next surgeon see the wound without taking
   the dressing down, and they document the injury and what was done to it. Check: avoid photographs kept only on a
   personal phone.
13_dressing.png [step.stsg.dressing]  Graft dressing and immobilisation: Use a non-adherent contact layer then a
   bolster tie-over or a negative-pressure dressing. Splint across any joint the graft crosses. Teach: Shear and fluid
   collections are the commonest preventable causes of graft loss; the dressing exists to stop both. Check: avoid a
   bulky dressing without even pressure.
14_donor.png [step.stsg.donor]  Donor site dressing: Apply a moist wound-healing dressing per local formulary;
   evidence favours moist dressings over dry gauze for pain and healing. Consider local anaesthetic infiltration or
   topical agents for donor pain. Teach: Donor site pain often troubles patients more than the recipient site. Check:
   avoid dry gauze adhering to the healing donor.
15_counts.png [step.core.counts]  Common.
16_debrief.png [step.core.debrief]  Common. Document graft source, size, meshing ratio, fixation and the date of first
   inspection.

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
  surgx-hip-hemiarthroplasty-steps.zip   (folder hip-hemiarthroplasty/)
  surgx-ankle-orif-steps.zip   (folder ankle-orif/)
  surgx-distal-radius-fixation-steps.zip   (folder distal-radius-fixation/)
  surgx-acl-reconstruction-steps.zip   (folder acl-reconstruction/)
  surgx-split-skin-graft-steps.zip   (folder split-skin-graft/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
