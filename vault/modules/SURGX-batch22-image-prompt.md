---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 22 (Peritonsillar abscess, Dynamic hip screw, Intramedullary nailing of the tibia, Debridement of an open fracture with external fixation, Fasciotomy of the leg): Gemini image prompt (91 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant ENT surgeons and orthopaedic surgeons. You are making 91 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Peritonsillar abscess (quinsy) drainage under local anaesthetic 15 images
  B. Dynamic hip screw                                              18 images
  C. Intramedullary nailing of the tibia                            18 images
  D. Debridement of an open fracture with external fixation         23 images
  E. Fasciotomy of the leg                                          17 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (Association of Anaesthetists (Griffiths R et al). Anaesthesia 76:225, Guideline for the management of hip fractures 2020; Baumgaertner MR et al. J Bone Joint Surg Am 77:1058, The value of the tip-apex distance in predicting failure of fixation of peritrochanteric fractures of the hip; British Orthopaedic Association (BOA), BOAST: Diagnosis and Management of Compartment Syndrome of the Extremities; British Orthopaedic Association (BOA), BOAST: Open Fractures; Clinical Otolaryngology, An evidence-based review of peritonsillar abscess (Powell J, Wilson JA); FLOW Investigators.).
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
- A. Sitting upright on a couch or chair with the head supported against a headrest or held by an assistant, chin
  slightly down. Headlight on, Yankauer suction connected and working, and a vomit bowl in the patient's hands.
- B. Supine on a traction table with a well-padded perineal post. The uninjured leg in a well-leg holder or scissored
  down, positioned so the C-arm can reach a true lateral. Reduce by longitudinal traction and internal rotation, and
  confirm on both views before preparing the skin.
- C. Supine on a radiolucent table. Knee flexed over a radiolucent support for an infrapatellar entry, or semi-
  extended for a suprapatellar entry. C-arm from the opposite side so anteroposterior and lateral views of the whole
  tibia are possible.
- D. Supine on a radiolucent table with the limb free and supported. Tourniquet applied but not routinely inflated.
  C-arm access to the whole segment and the joints at either end.
- E. Supine, with the leg supported so both medial and lateral sides are accessible. Tourniquet applied but not
  inflated.
Step-specific facts:
- A. Anatomy: The abscess lies in the peritonsillar space, between the tonsil capsule and the superior constrictor,
  most commonly at the superior pole. Must be right: Guard both the needle and the blade, so neither can pass more
  than about 1 cm deep. Aim directly posteriorly or slightly medially, never laterally towards the carotid sheath.
  Aspirate before incision.
- B. Anatomy: The femoral neck sits at roughly 130 degrees to the shaft and is anteverted, which is why a true lateral
  view is essential. Must be right: Accept no implant until the reduction is acceptable on both views. Place the lag
  screw centrally in the head on both views with a small tip-apex distance. A large tip-apex distance predicts cut-
  out.
- C. Anatomy: The entry point lies just medial to the lateral tibial spine on the AP view and at the anterior edge of
  the plateau on the lateral view. The tibial canal is triangular; the anteromedial surface is subcutaneous along its
  length. Must be right: Correct entry point on both views is the single biggest determinant of alignment in proximal
  fractures. Keep the guidewire centred in the distal fragment on both views before reaming. Do not ream with a
  tourniquet inflated: the bone cannot dissipate the heat.
- D. Anatomy: Perforators from the posterior tibial artery emerge along the medial border of the tibia and supply
  local fasciocutaneous flaps; incisions must spare them. The anteromedial surface of the tibia is the safe corridor
  for half-pins. Must be right: Debride systematically, layer by layer, from the outside in, to healthy bleeding
  tissue. Extend the wound along fasciotomy lines so later flap options are preserved.
- E. Anatomy: Anterior compartment: tibialis anterior, toe extensors, anterior tibial artery and deep peroneal nerve.
  Lateral compartment: peronei and the superficial peroneal nerve, which pierces the fascia in the distal third. Must
  be right: Decompress all four compartments and confirm each one is open. The deep posterior compartment is the one
  most often missed. Long incisions. A short skin incision can still constrict the swollen muscle beneath it.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 91 images)
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

A. PERITONSILLAR ABSCESS (QUINSY) DRAINAGE UNDER LOCAL ANAESTHETIC  (folder quinsy-drainage/)
01_consent-check.png [step.core.consent-check]  Common. Verbal or written consent per local policy; explain that one
   or two needle passes may be needed and that no pus does not mean failure.
02_preop-data-check.png [step.ent.preop-data-check]  Confirm the investigation that justifies the operation: Display
   the key investigation in theatre before the time-out, not just in the notes. Confirm side and indication against it
   aloud, for example: bilateral effusion with flat tympanograms, or left-sided disease on the CT. Confirm the side,
   the clinical diagnosis and the absence of airway compromise or neck signs that would need imaging first. Teach: ENT
   operations are often elective and sided, and each rests on one investigation: the audiogram and tympanogram for
   grommets, the CT for sinus surgery, the documented infection count or sleep study for tonsillectomy. Check: avoid
   operating on the side written on the list rather than the side shown by the investigation.
03_timeout.png [step.core.timeout]  Common. A local safety checklist in the treatment room or emergency department:
   identity, side, allergies, anticoagulants, suction working.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_local.png [step.st.local]  Local anaesthesia for an inflamed field: Infiltrate a field block in healthy tissue
   around the abscess rather than into it. Check the maximum safe dose for the patient's weight and whether adrenaline
   is appropriate for that site. Topical lidocaine spray, then infiltrate a small volume of local anaesthetic with
   adrenaline submucosally at the planned puncture site. Infiltrate superficially, not deep. Teach: Local anaesthetic
   works poorly in the acidic tissue of an abscess, which is why patients remember these procedures. Check: avoid
   injecting into the cavity, which hurts and does not work.
06_landmark.png [step.quinsy.landmark]  Choose the puncture site: With the tongue depressed, identify the point of
   maximal swelling or fluctuance, usually on the soft palate above and lateral to the upper pole of the tonsil. Use
   as a guide the point where a horizontal line along the base of the uvula meets a vertical line along the anterior
   pillar. Teach: The abscess is usually at the superior pole, and the carotid is lateral. Check: avoid choosing a
   site on the tonsil itself, below the abscess.
07_aspirate.png [step.quinsy.aspirate]  Guarded needle aspiration: Trim the needle cap so only about 1 cm of needle is
   exposed, and refit it over the needle. Advance the needle at the chosen point, directed straight back or slightly
   medially, never laterally, to the depth of the guard. Teach: Needle aspiration confirms the diagnosis and often
   drains the abscess on its own. Check: avoid an unguarded needle advanced deeper and deeper in search of pus.
08_culture.png [step.st.culture]  Pus for culture: Aspirate or swab pus from within the cavity at the moment it is
   opened, before irrigation. Send in an appropriate container, and request anaerobic culture where the site suggests
   it. Send the first aspirate for culture before any further drainage or irrigation. Teach: Pus obtained at drainage
   is the specimen that guides therapy. Check: avoid irrigating first, then swabbing.
09_incise.png [step.quinsy.incise]  Guarded incision over the abscess: Tape the blade so only its tip is exposed,
   about 1 cm or less. Make a short incision through mucosa at the site where pus was aspirated, directed posteriorly.
   Teach: Aspiration alone often suffices, but a large or thick-walled collection drains better through an incision.
   Check: avoid incising at a site where aspiration found no pus.
10_deloculate.png [step.st.deloculate]  Breaking down loculations: Explore the whole cavity with a finger or a blunt
   instrument and break every septum. Feel for the extent in every direction, particularly deep, where the cavity is
   usually larger than the skin suggests. Open the incision with closed Tilley's or sinus forceps, spreading gently in
   the cavity only. Never push forceps laterally or deep. Teach: An abscess that is not fully de-loculated is an
   abscess that has been partly drained, and it is the commonest reason for recurrence and readmission. Check: avoid
   stopping at the first gush of pus.
11_no-pus-bailout.png [step.quinsy.no-pus-bailout]  Bail-out: no pus, a failing patient, or an unsafe procedure: If
   the first aspiration is dry, make one further attempt at a second site, usually lower, at the middle of the tonsil,
   with the same guarded needle and posterior direction. If still dry, stop. Treat as cellulitis with intravenous
   antibiotics, review within the day, and arrange contrast-enhanced CT of the neck if there is no improvement or any
   sign of deep extension. Teach: A dry tap may mean peritonsillar cellulitis, an abscess in a different position, or
   deep neck space disease. Check: avoid three, four or five punctures in increasingly deep positions.
12_haemostasis.png [step.core.haemostasis]  Common. Most bleeding stops with pressure from a swab on a holder and the
   patient spitting. Brisk or pulsatile bleeding is an emergency: pressure, airway, senior help immediately.
13_counts.png [step.core.counts]  Common. Needles and the blade disposed of; any swab used in the mouth accounted for.
14_airway-handover.png [step.ent.airway-handover]  Airway handover to recovery and the ward: State the airway: tube or
   tracheostomy type and size, whether the cuff is up, whether the upper airway is patent, and whether the patient can
   be oxygenated from above. State the bleeding risk and what bleeding would look like: frequent swallowing, fresh
   blood from mouth or nose, rising heart rate in a child. Hand over the side, the volume of pus, trismus before and
   after, and the observations that would prompt review: stridor, drooling, neck swelling. Teach: Most ENT airway
   catastrophes happen after the operation, in recovery or on the ward, in the hands of people who were not in
   theatre. Check: avoid a handover that covers the operation but not what to do if the airway fails.
15_debrief.png [step.core.debrief]  Common.

B. DYNAMIC HIP SCREW  (folder dynamic-hip-screw/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_image-intensifier.png [step.ortho.image-intensifier]  Image intensifier set-up and radiation safety: Position the
   C-arm and confirm that true anteroposterior and lateral views can be obtained before preparing the skin. Lead
   protection and dosimeters for all staff; thyroid shields; the radiographer briefed on the views needed. Teach:
   Fixation is only as good as the images it is judged by, and every second of screening is dose to the patient and
   the team. Check: avoid discovering after draping that a true lateral cannot be obtained.
06_reduction-check.png [step.ortho.reduction-check]  Reduction confirmed in two planes: Reduce by traction and the
   manoeuvre the fracture needs, then screen in two orthogonal planes. Check length, angulation in both planes and
   rotation against landmarks or the other limb. Traction plus internal rotation usually reduces the fracture. Check
   neck-shaft angle on the AP view and that there is no posterior sag on the lateral. Teach: Fixing a malreduced
   fracture fixes the malreduction. Check: avoid accepting a single good view.
07_prep-drape.png [step.core.prep-drape]  Common.
08_approach.png [step.dhs.approach]  Lateral approach to the proximal femur: Incise along the lateral femur from the
   vastus ridge distally, sized to the plate. Divide the fascia lata in line with the skin incision. Teach: The
   lateral approach reaches the lateral cortex through a single muscle with no internervous plane needed, and it is
   extensile if the plan changes. Check: avoid tearing perforators that retract behind the septum and bleed.
09_guidewire.png [step.ortho.guidewire]  Guidewire position confirmed before committing: Advance the guidewire under
   image control. Confirm its position on both anteroposterior and lateral views before measuring, drilling or
   reaming. Use the angle guide on the lateral cortex. Aim for a central position in the head on both views and a
   small tip-apex distance. Teach: Reamers, screws and nails follow the guidewire. Check: avoid checking one view
   only.
10_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Teach: The wrong size, side or type cannot be undone after insertion, and an implant that is not registered cannot
   be traced if it is recalled. Check: avoid opening an implant before the measurement is confirmed.
11_ream-lag.png [step.dhs.ream-lag]  Measure, ream and insert the lag screw: Measure the guidewire length and set the
   triple reamer to the length recommended by the system. Ream under image control, watching that the guidewire does
   not advance. Teach: The lag screw is the fixation. Check: avoid guidewire advancing with the reamer.
12_plate.png [step.dhs.plate]  Barrel plate application and compression: Slide the barrel plate over the lag screw
   with the keys aligned, and seat it against the lateral cortex. Clamp the plate to the shaft and insert cortical
   screws. Teach: The barrel lets the head-neck fragment slide and impact onto the shaft. Check: avoid plate not flush
   with the shaft.
13_final-imaging.png [step.ortho.final-imaging]  Final images saved in two planes: Screen the whole construct in two
   planes, including the ends of the implant and the joints at either end. Confirm reduction, implant position and
   screw lengths; look specifically for joint penetration. Teach: The final images are the evidence of what was
   achieved. Check: avoid saving only the best-looking view.
14_haemostasis.png [step.core.haemostasis]  Common.
15_counts.png [step.core.counts]  Common.
16_skin-closure.png [step.core.skin-closure]  Common.
17_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Teach: Deficits and compartment syndrome that are found early are
   treatable. Check: avoid assuming the limb is fine because it was fine before.
18_debrief.png [step.core.debrief]  Common.

C. INTRAMEDULLARY NAILING OF THE TIBIA  (folder tibial-im-nail/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_image-intensifier.png [step.ortho.image-intensifier]  Image intensifier set-up and radiation safety: Position the
   C-arm and confirm that true anteroposterior and lateral views can be obtained before preparing the skin. Lead
   protection and dosimeters for all staff; thyroid shields; the radiographer briefed on the views needed. Teach:
   Fixation is only as good as the images it is judged by, and every second of screening is dose to the patient and
   the team. Check: avoid discovering after draping that a true lateral cannot be obtained.
06_prep-drape.png [step.core.prep-drape]  Common.
07_entry.png [step.tibnail.entry]  Entry point: Approach through a patellar tendon split, medial parapatellar
   incision, or a suprapatellar portal with a protective sleeve. Place the awl or entry wire just medial to the
   lateral tibial spine on the AP view and at the anterior edge of the plateau on the lateral view. Teach: The nail
   follows the entry point. Check: avoid medial entry in a proximal fracture.
08_reduction-check.png [step.ortho.reduction-check]  Reduction confirmed in two planes: Reduce by traction and the
   manoeuvre the fracture needs, then screen in two orthogonal planes. Check length, angulation in both planes and
   rotation against landmarks or the other limb. Restore length, alignment and rotation before the guidewire crosses
   the fracture. Compare rotation with the other leg. Teach: Fixing a malreduced fracture fixes the malreduction.
   Check: avoid accepting a single good view.
09_guidewire.png [step.ortho.guidewire]  Guidewire position confirmed before committing: Advance the guidewire under
   image control. Confirm its position on both anteroposterior and lateral views before measuring, drilling or
   reaming. Ball-tipped guidewire centred in the distal fragment on both views, ending just above the ankle physeal
   scar. Teach: Reamers, screws and nails follow the guidewire. Check: avoid checking one view only.
10_ream.png [step.tibnail.ream]  Measuring and reaming: Measure nail length from the guidewire. Ream in small
   increments with sharp reamers, advancing slowly, with the fracture held reduced. Teach: Reaming allows a larger,
   stiffer nail. Check: avoid reaming with the tourniquet inflated.
11_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Teach: The wrong size, side or type cannot be undone after insertion, and an implant that is not registered cannot
   be traced if it is recalled. Check: avoid opening an implant before the measurement is confirmed.
12_insert-lock.png [step.tibnail.insert-lock]  Nail insertion and locking: Insert the nail by hand through the jig
   while the reduction is held, without forceful hammering. Seat the nail so it does not protrude above the entry
   point. Teach: Locking controls length and rotation; inserting the nail without losing reduction is what makes the
   locking worth doing. Check: avoid locking in distraction.
13_final-imaging.png [step.ortho.final-imaging]  Final images saved in two planes: Screen the whole construct in two
   planes, including the ends of the implant and the joints at either end. Confirm reduction, implant position and
   screw lengths; look specifically for joint penetration. Teach: The final images are the evidence of what was
   achieved. Check: avoid saving only the best-looking view.
14_haemostasis.png [step.core.haemostasis]  Common.
15_counts.png [step.core.counts]  Common.
16_skin-closure.png [step.core.skin-closure]  Common.
17_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Compartments of the leg checked and documented now, and the 48-hour
   observation plan handed over. Teach: Deficits and compartment syndrome that are found early are treatable. Check:
   avoid assuming the limb is fine because it was fine before.
18_debrief.png [step.core.debrief]  Common.

D. DEBRIDEMENT OF AN OPEN FRACTURE WITH EXTERNAL FIXATION  (folder open-fracture-debridement/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
05_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. Apply but do
   not inflate unless bleeding obscures the field. Bleeding is how viable tissue identifies itself. Teach: A
   tourniquet gives a bloodless field but adds ischaemia to injured tissue and hides bleeding that tells you what is
   alive. Check: avoid inflating on a limb with suspected compartment syndrome or arterial injury.
06_prep-drape.png [step.core.prep-drape]  Common.
07_wound-photos.png [step.ortho.wound-photos]  Wound photographs at key stages: Photograph at first exposure in
   theatre, after debridement, and at closure or cover, per the governance policy for clinical images. Include a scale
   and a reference point so the extent is clear. Teach: Photographs let the next surgeon see the wound without taking
   the dressing down, and they document the injury and what was done to it. Check: avoid photographs kept only on a
   personal phone.
08_leg-incisions.png [step.ortho.leg-incisions]  Leg incisions on the fasciotomy lines: Mark the subcutaneous border
   of the tibia, the fibula, and the course of the perforators before incising. Medial incision a short distance
   behind the posteromedial border of the tibia; lateral incision anterior to the fibula over the septum between the
   anterior and lateral compartments. Extend the wound along the fasciotomy lines. The medial incision alone is often
   enough for debridement and spares the perforators. Teach: Incisions placed on the fasciotomy lines decompress the
   compartments and preserve the perforators on which later local flaps depend. Check: avoid incising directly over
   the subcutaneous tibia, leaving bone exposed.
09_debride.png [step.st.debride]  Debridement of non-viable tissue: Excise to bleeding, contractile, healthy tissue in
   every direction. In necrotising infection, follow the plane of easy finger dissection: where the fascia separates
   without resistance, the disease has been. Layer by layer: skin, fat, fascia, muscle, then bone. Excise to bleeding,
   healthy tissue. Teach: Antibiotics do not reach dead tissue. Check: avoid a conservative first debridement in
   necrotising infection.
10_muscle-viability.png [step.ortho.muscle-viability]  Muscle viability assessed in every compartment: Assess colour,
   consistency, contractility to gentle stimulation, and capacity to bleed. Examine each compartment in turn and
   record the finding for each one. Teach: Dead muscle left behind becomes infection and drives rhabdomyolysis;
   healthy muscle removed is function lost. Check: avoid judging viability by colour alone.
11_bone.png [step.oex.bone]  Bone end debridement: Deliver each bone end into the wound by flexing or angulating the
   limb gently. Remove loose cortical fragments with no soft-tissue attachment; curette contaminated cancellous bone
   and the canal ends. Teach: Devitalised bone is a sequestrum in waiting. Check: avoid keeping a fragment because it
   fits.
12_lavage.png [step.oex.lavage]  Low-pressure irrigation: Irrigate with large volumes of saline at low pressure after
   excision is complete. Irrigate the canal ends and every recess of the wound. Teach: Irrigation dilutes what
   debridement cannot pick out. Check: avoid high-pressure pulsed lavage that drives contamination into tissue planes.
13_reprep.png [step.oex.reprep]  Re-preparation and fresh instruments: Remove the dirty drapes and instruments; the
   team changes gloves and gowns. Re-prepare the skin and re-drape. Teach: Once debridement is complete, anything
   implanted or reconstructed at the same sitting should be done as clean surgery, not with the instruments that
   handled the contamination. Check: avoid continuing to fixation with the debridement set.
14_image-intensifier.png [step.ortho.image-intensifier]  Image intensifier set-up and radiation safety: Position the
   C-arm and confirm that true anteroposterior and lateral views can be obtained before preparing the skin. Lead
   protection and dosimeters for all staff; thyroid shields; the radiographer briefed on the views needed. Teach:
   Fixation is only as good as the images it is judged by, and every second of screening is dose to the patient and
   the team. Check: avoid discovering after draping that a true lateral cannot be obtained.
15_reduction-check.png [step.ortho.reduction-check]  Reduction confirmed in two planes: Reduce by traction and the
   manoeuvre the fracture needs, then screen in two orthogonal planes. Check length, angulation in both planes and
   rotation against landmarks or the other limb. Teach: Fixing a malreduced fracture fixes the malreduction. Check:
   avoid accepting a single good view.
16_implant-check.png [step.ortho.implant-check]  Implant selection, check and register: Confirm implant type, size,
   length and side against the plan and the measurements aloud before opening. Check packaging integrity and expiry.
   Teach: The wrong size, side or type cannot be undone after insertion, and an implant that is not registered cannot
   be traced if it is recalled. Check: avoid opening an implant before the measurement is confirmed.
17_frame.png [step.oex.frame]  Spanning external fixator: Plan pin sites with the plastic surgeon: outside the zone of
   injury and away from future flaps and definitive fixation. Insert two bicortical half-pins in each main fragment
   through safe corridors, the anteromedial tibia in the leg. Teach: A frame holds length and alignment while the soft
   tissues declare themselves, without placing metal in a contaminated wound. Check: avoid pins through the wound or
   the zone of injury.
18_final-imaging.png [step.ortho.final-imaging]  Final images saved in two planes: Screen the whole construct in two
   planes, including the ends of the implant and the joints at either end. Confirm reduction, implant position and
   screw lengths; look specifically for joint penetration. Teach: The final images are the evidence of what was
   achieved. Check: avoid saving only the best-looking view.
19_haemostasis.png [step.core.haemostasis]  Common.
20_temp-cover.png [step.ortho.temp-cover]  Temporary wound cover and plan for definitive cover: Use a dressing that
   prevents desiccation and minimises dressing changes, such as a sealed or negative-pressure dressing. Cover exposed
   bone, tendon and neurovascular structures. Teach: A wound that dries out or is repeatedly undressed loses tissue
   and gains bacteria. Check: avoid daily dressing changes on the ward.
21_counts.png [step.core.counts]  Common.
22_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Teach: Deficits and compartment syndrome that are found early are
   treatable. Check: avoid assuming the limb is fine because it was fine before.
23_debrief.png [step.core.debrief]  Common. Record the Gustilo-Anderson grade now, after debridement, along with the
   plan and date for definitive cover.

E. FASCIOTOMY OF THE LEG  (folder leg-fasciotomy/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. Apply but
   leave deflated: the muscle is already ischaemic and you need to see it bleed. Teach: A tourniquet gives a bloodless
   field but adds ischaemia to injured tissue and hides bleeding that tells you what is alive. Check: avoid inflating
   on a limb with suspected compartment syndrome or arterial injury.
06_prep-drape.png [step.core.prep-drape]  Common.
07_leg-incisions.png [step.ortho.leg-incisions]  Leg incisions on the fasciotomy lines: Mark the subcutaneous border
   of the tibia, the fibula, and the course of the perforators before incising. Medial incision a short distance
   behind the posteromedial border of the tibia; lateral incision anterior to the fibula over the septum between the
   anterior and lateral compartments. Teach: Incisions placed on the fasciotomy lines decompress the compartments and
   preserve the perforators on which later local flaps depend. Check: avoid incising directly over the subcutaneous
   tibia, leaving bone exposed.
08_lateral.png [step.fas.lateral]  Lateral incision: anterior and lateral compartments: Incise anterior to the fibula
   along the length of the leg. Make a small transverse cut in the fascia to identify the anterior intermuscular
   septum. Teach: One lateral incision over the intermuscular septum releases both the anterior and the lateral
   compartments, provided the septum is found first. Check: avoid releasing only one of the two compartments because
   the septum was not identified.
09_medial.png [step.fas.medial]  Medial incision: superficial and deep posterior compartments: Incise a short distance
   behind the posteromedial border of the tibia, protecting the saphenous vein and nerve. Release the superficial
   posterior compartment fascia over gastrocnemius and soleus. Teach: The deep posterior compartment is the one that
   is missed, and it contains the posterior tibial vessels and tibial nerve. Check: avoid stopping after the
   superficial compartment.
10_muscle-viability.png [step.ortho.muscle-viability]  Muscle viability assessed in every compartment: Assess colour,
   consistency, contractility to gentle stimulation, and capacity to bleed. Examine each compartment in turn and
   record the finding for each one. Teach: Dead muscle left behind becomes infection and drives rhabdomyolysis;
   healthy muscle removed is function lost. Check: avoid judging viability by colour alone.
11_debride.png [step.st.debride]  Debridement of non-viable tissue: Excise to bleeding, contractile, healthy tissue in
   every direction. In necrotising infection, follow the plane of easy finger dissection: where the fascia separates
   without resistance, the disease has been. Excise only clearly dead muscle now. Doubtful muscle is reassessed at the
   planned second look. Teach: Antibiotics do not reach dead tissue. Check: avoid a conservative first debridement in
   necrotising infection.
12_wound-photos.png [step.ortho.wound-photos]  Wound photographs at key stages: Photograph at first exposure in
   theatre, after debridement, and at closure or cover, per the governance policy for clinical images. Include a scale
   and a reference point so the extent is clear. Teach: Photographs let the next surgeon see the wound without taking
   the dressing down, and they document the injury and what was done to it. Check: avoid photographs kept only on a
   personal phone.
13_haemostasis.png [step.core.haemostasis]  Common.
14_temp-cover.png [step.ortho.temp-cover]  Temporary wound cover and plan for definitive cover: Use a dressing that
   prevents desiccation and minimises dressing changes, such as a sealed or negative-pressure dressing. Cover exposed
   bone, tendon and neurovascular structures. Do not close the skin. Cover with a sealed or negative-pressure dressing
   and set the date for the second look. Teach: A wound that dries out or is repeatedly undressed loses tissue and
   gains bacteria. Check: avoid daily dressing changes on the ward.
15_counts.png [step.core.counts]  Common.
16_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Teach: Deficits and compartment syndrome that are found early are
   treatable. Check: avoid assuming the limb is fine because it was fine before.
17_debrief.png [step.core.debrief]  Common. Record each compartment and its muscle viability by name.

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
  surgx-quinsy-drainage-steps.zip   (folder quinsy-drainage/)
  surgx-dynamic-hip-screw-steps.zip   (folder dynamic-hip-screw/)
  surgx-tibial-im-nail-steps.zip   (folder tibial-im-nail/)
  surgx-open-fracture-debridement-steps.zip   (folder open-fracture-debridement/)
  surgx-leg-fasciotomy-steps.zip   (folder leg-fasciotomy/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
