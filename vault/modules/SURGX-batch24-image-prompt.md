---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 24 (Open carpal tunnel release, Trigger finger release, Flexor tendon repair, Craniotomy for supratentorial tumour, Decompressive craniectomy): Gemini image prompt (103 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant neurosurgeons and spine surgeons and plastic and hand surgeons. You are making 103 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Open carpal tunnel release                                     19 images
  B. Trigger finger release                                         19 images
  C. Flexor tendon repair (zone II)                                 21 images
  D. Craniotomy for supratentorial tumour                           22 images
  E. Decompressive craniectomy (planned)                            22 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Academy of Orthopaedic Surgeons (AAOS), Management of Carpal Tunnel Syndrome: Evidence-Based Clinical Practice Guideline; American Heart Association / American Stroke Association, Wijdicks EFM et al. (Stroke), Recommendations for the management of cerebral and cerebellar infarction with swelling; Brain Trauma Foundation, Carney N et al.).
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
- A. Supine, arm on a hand table, shoulder abducted no more than 90 degrees; lead hand or assistant to hold the
  fingers. Forearm supinated with the wrist slightly extended over a rolled towel.
- B. Supine, arm on a hand table, shoulder abducted no more than 90 degrees; lead hand or assistant to hold the
  fingers.
- C. Supine, arm on a hand table, shoulder abducted no more than 90 degrees; lead hand or assistant to hold the
  fingers.
- D. Supine, lateral or prone so the tumour is at the highest point of the field and the approach is perpendicular to
  the scalp. Pins in a three-point head clamp, with the head above the heart and the jugular veins free.
- E. Supine with a shoulder roll and the head turned to the opposite side, or lateral for a very large decompression.
  Horseshoe or pins; the head above the heart, with no jugular compression.
Step-specific facts:
- A. Anatomy: Kaplan's cardinal line and the radial border of the ring finger axis locate the incision ulnar to the
  thenar crease, away from the palmar cutaneous branch. Must be right: Incise ulnar to the thenar crease and divide
  the ligament on its ulnar side. See the nerve before dividing each part of the ligament. Release completely,
  including the distal antebrachial fascia.
- B. Anatomy: The A1 pulley overlies the MCP joint volar plate; A2 starts just distal to it over the proximal phalanx
  and is critical for flexion. The digital nerves lie on either side of the flexor sheath, palmar to the arteries at
  this level. Must be right: Identify both neurovascular bundles, and in the thumb find the radial digital nerve
  before dividing the pulley. Divide the whole A1 pulley and nothing beyond it. Check active movement before closure.
- C. Anatomy: In zone II, FDP and FDS run together in the fibro-osseous sheath; FDS splits around FDP at Camper's
  chiasm and inserts on the middle phalanx. Must be right: Handle tendons only at their cut ends. Preserve the
  critical pulleys while allowing the repair to glide. Use a repair strong enough for early active motion, and check
  it for gapping. Repair divided digital nerves.
- D. Anatomy: The central sulcus separates motor cortex in front from sensory cortex behind; on axial MRI it is
  identified by the hand knob and the pars marginalis sign. Must be right: Verify navigation accuracy before planning
  the flap and before every navigation-based decision; assume brain shift after CSF release and debulking.
- E. Anatomy: A reverse question mark (or a T-bar) incision starts in front of the tragus at the zygoma, curves behind
  the ear and the parietal eminence, and comes forward to the hairline about 2 cm from the midline. Must be right:
  Make it large: the Brain Trauma Foundation fourth edition recommends a large fronto-temporo-parietal craniectomy
  (not less than 12 by 15 cm, or 15 cm diameter) over a small one.
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

A. OPEN CARPAL TUNNEL RELEASE  (folder carpal-tunnel-release/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Routine antibiotic prophylaxis is generally not needed for a short
   clean hand operation; follow local policy.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_anaesthesia.png [step.hand.anaesthesia]  Hand anaesthesia: wide-awake local or regional with tourniquet: Agree the
   technique with the patient and the anaesthetist: WALANT, regional block with an arm tourniquet, or general
   anaesthesia. For WALANT, inject local anaesthetic with adrenaline slowly through a fine needle, proximal to distal,
   and wait for vasoconstriction before incising; calculate the maximum safe dose by weight and record it. Infiltrate
   along the planned incision and proximally into the forearm subcutaneous tissue, not into the carpal tunnel or the
   nerve. Teach: The anaesthetic choice shapes the operation. Check: avoid incising before the adrenaline has had time
   to work, so the field bleeds.
06_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. Not needed
   with WALANT; if used, an upper arm cuff, with the time recorded. Teach: A tourniquet gives a bloodless field but
   adds ischaemia to injured tissue and hides bleeding that tells you what is alive. Check: avoid inflating on a limb
   with suspected compartment syndrome or arterial injury.
07_prep-drape.png [step.core.prep-drape]  Common.
08_incision.png [step.hand.incision]  Hand incision placed on the creases and safe lines: Mark the incision before
   infiltration, relating it to the creases and to the structure you need to reach. Use Brunner zigzags or mid-lateral
   incisions in the digit; never cross a flexion crease at a right angle. In line with the radial border of the ring
   finger, ulnar to the thenar crease, from Kaplan's cardinal line to just short of the distal wrist crease. Teach:
   Incisions that cross flexion creases at a right angle contract and limit movement. Check: avoid a straight
   longitudinal incision across a digital crease.
09_palmar-fascia.png [step.ctr.palmar-fascia]  Through fat and palmar fascia to the transverse carpal ligament: Spread
   the subcutaneous fat longitudinally and retract it with small self-retainers. Divide the palmar fascia in line with
   the incision, and the thin palmaris brevis fibres distally if present. Teach: The palmar fascia and fat lie over
   the ligament, with the palmar cutaneous branch radially and the superficial palmar arch distally. Check: avoid
   straying ulnarly into Guyon's canal.
10_nerve-protection.png [step.hand.nerve-protection]  Identify and protect the nerves before dividing anything: Know
   where the nerve is expected for this operation and look for it before dividing fascia, pulley or ligament. Retract
   nerves gently with blunt retractors; never hold them with toothed forceps. Look for the median nerve through the
   first opening in the ligament, and for any transligamentous motor branch. Teach: In the hand the nerves lie close
   to every structure that is released or repaired, and their position varies. Check: avoid assuming textbook anatomy
   when variants are common.
11_divide-tcl.png [step.ctr.divide-tcl]  Dividing the transverse carpal ligament under vision: Incise the ligament in
   its middle third until the nerve is seen beneath, then protect the nerve with a blunt dissector or McDonald's
   elevator. Divide the ligament distally along its ulnar side under direct vision until the distal fat pad is
   reached; the superficial palmar arch lies just beyond. Teach: The release is the operation. Check: avoid blind
   proximal release that leaves the antebrachial fascia intact.
12_release-check.png [step.ctr.release-check]  Checking the release is complete: Pass a blunt instrument along the
   canal proximally and distally: it should meet no residual band. Inspect the nerve for constriction, colour change
   or an anomalous branch; do not perform routine neurolysis or tenosynovectomy. Teach: Incomplete release, usually
   proximally or distally, is the commonest cause of persistent symptoms. Check: avoid closing without checking the
   proximal end.
13_unexpected-findings.png [step.hand.unexpected-findings]  Unexpected findings in the hand: stop and get help: Stop
   and reassess the anatomy and the diagnosis before going further. Send tissue for histology or culture if it looks
   abnormal. A mass, florid tenosynovitis or an anomalous muscle in the canal: send tissue and stop if the operation
   needs to change. Teach: Hand operations booked as routine can reveal a tumour, a nerve variant, tenosynovitis,
   infection or a tendon gap that cannot be closed primarily. Check: avoid extending the operation into a
   reconstruction without consent.
14_haemostasis.png [step.core.haemostasis]  Common.
15_counts.png [step.core.counts]  Common.
16_skin-closure.png [step.core.skin-closure]  Common. Interrupted non-absorbable or absorbable sutures per local
   practice; do not close the palmar fascia.
17_dressing-therapy.png [step.hand.dressing-therapy]  Hand dressing, elevation, splint and therapy plan: Apply a
   dressing that does not constrict and leaves the fingertips visible for perfusion checks. Splint in the position the
   operation needs, or leave the hand free to move if early motion is the plan. Bulky non-constricting dressing, no
   splint; finger movement from the start. Teach: Hand outcome depends on what happens after theatre: swelling and
   stiffness cause more poor results than technique does. Check: avoid a circumferential dressing that tightens as the
   hand swells.
18_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Teach: Deficits and compartment syndrome that are found early are
   treatable. Check: avoid assuming the limb is fine because it was fine before.
19_debrief.png [step.core.debrief]  Common.

B. TRIGGER FINGER RELEASE  (folder trigger-finger-release/)
01_consent-check.png [step.core.consent-check]  Common. Mark the affected digit; trigger fingers are often multiple
   and on both hands.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Routine antibiotic prophylaxis is generally not needed for a short
   clean hand operation; follow local policy.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_anaesthesia.png [step.hand.anaesthesia]  Hand anaesthesia: wide-awake local or regional with tourniquet: Agree the
   technique with the patient and the anaesthetist: WALANT, regional block with an arm tourniquet, or general
   anaesthesia. For WALANT, inject local anaesthetic with adrenaline slowly through a fine needle, proximal to distal,
   and wait for vasoconstriction before incising; calculate the maximum safe dose by weight and record it. Wide-awake
   local is ideal here: the active check proves the release. Teach: The anaesthetic choice shapes the operation.
   Check: avoid incising before the adrenaline has had time to work, so the field bleeds.
06_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. Not needed
   with WALANT; if used, record the time. Teach: A tourniquet gives a bloodless field but adds ischaemia to injured
   tissue and hides bleeding that tells you what is alive. Check: avoid inflating on a limb with suspected compartment
   syndrome or arterial injury.
07_prep-drape.png [step.core.prep-drape]  Common.
08_incision.png [step.hand.incision]  Hand incision placed on the creases and safe lines: Mark the incision before
   infiltration, relating it to the creases and to the structure you need to reach. Use Brunner zigzags or mid-lateral
   incisions in the digit; never cross a flexion crease at a right angle. Transverse in the palmar crease over A1, or
   longitudinal or oblique; for the thumb, a transverse incision in the MCP crease with care for the radial digital
   nerve. Teach: Incisions that cross flexion creases at a right angle contract and limit movement. Check: avoid a
   straight longitudinal incision across a digital crease.
09_nerve-protection.png [step.hand.nerve-protection]  Identify and protect the nerves before dividing anything: Know
   where the nerve is expected for this operation and look for it before dividing fascia, pulley or ligament. Retract
   nerves gently with blunt retractors; never hold them with toothed forceps. Both bundles are close to the pulley; in
   the thumb the radial digital nerve crosses the field obliquely. Teach: In the hand the nerves lie close to every
   structure that is released or repaired, and their position varies. Check: avoid assuming textbook anatomy when
   variants are common.
10_expose-a1.png [step.tf.expose-a1]  Exposing the A1 pulley: Locate the A1 pulley over the metacarpal head: under the
   distal palmar crease for the ring and little fingers, between the creases for the middle finger, under the proximal
   palmar crease for the index, and at the MCP flexion crease for the thumb. Spread the fat longitudinally with fine
   scissors and retract with small retractors to show the pulley and both neurovascular bundles. Teach: The A1 pulley
   lies over the metacarpophalangeal joint, with the digital neurovascular bundles on either side and, in the thumb,
   the radial digital nerve crossing obliquely close to it. Check: avoid transverse cutting through fat in the thumb,
   dividing the radial digital nerve.
11_divide-a1.png [step.tf.divide-a1]  Dividing the A1 pulley completely and preserving A2: Divide the A1 pulley
   longitudinally in its midline with a blade or scissors, along its full length. Identify the distal edge of A1 and
   the start of the A2 pulley, and stop there. Teach: Triggering persists if any part of A1 is left, and the finger
   bowstrings if the A2 pulley is divided. Check: avoid incomplete distal release of A1.
12_active-check.png [step.hand.active-check]  Active movement check before closure: Ask the patient to make a full
   fist and fully extend the digit several times. Watch the tendon: it should glide smoothly without triggering,
   catching or gapping. Full active fist and extension, several times, with no triggering. Passive extension of the
   PIP joint checks for a fixed contracture. Teach: In a wide-awake patient, full active movement shows what no
   passive test can: whether triggering has gone, or whether a repair gaps or catches on a pulley. Check: avoid
   closing because the release 'looked complete'.
13_unexpected-findings.png [step.hand.unexpected-findings]  Unexpected findings in the hand: stop and get help: Stop
   and reassess the anatomy and the diagnosis before going further. Send tissue for histology or culture if it looks
   abnormal. A large nodule, a ganglion, tenosynovitis or an anomalous FDS: send tissue if abnormal and do not extend
   the operation without consent. Teach: Hand operations booked as routine can reveal a tumour, a nerve variant,
   tenosynovitis, infection or a tendon gap that cannot be closed primarily. Check: avoid extending the operation into
   a reconstruction without consent.
14_haemostasis.png [step.core.haemostasis]  Common.
15_counts.png [step.core.counts]  Common.
16_skin-closure.png [step.core.skin-closure]  Common.
17_dressing-therapy.png [step.hand.dressing-therapy]  Hand dressing, elevation, splint and therapy plan: Apply a
   dressing that does not constrict and leaves the fingertips visible for perfusion checks. Splint in the position the
   operation needs, or leave the hand free to move if early motion is the plan. Light dressing, no splint, active
   movement from the start. Teach: Hand outcome depends on what happens after theatre: swelling and stiffness cause
   more poor results than technique does. Check: avoid a circumferential dressing that tightens as the hand swells.
18_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Teach: Deficits and compartment syndrome that are found early are
   treatable. Check: avoid assuming the limb is fine because it was fine before.
19_debrief.png [step.core.debrief]  Common.

C. FLEXOR TENDON REPAIR (ZONE II)  (folder flexor-tendon-repair/)
01_consent-check.png [step.core.consent-check]  Common. Record the pre-operative examination of each tendon and nerve,
   and consent for nerve repair and possible staged reconstruction.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotics per local policy for a traumatic wound; check tetanus
   status.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_anaesthesia.png [step.hand.anaesthesia]  Hand anaesthesia: wide-awake local or regional with tourniquet: Agree the
   technique with the patient and the anaesthetist: WALANT, regional block with an arm tourniquet, or general
   anaesthesia. For WALANT, inject local anaesthetic with adrenaline slowly through a fine needle, proximal to distal,
   and wait for vasoconstriction before incising; calculate the maximum safe dose by weight and record it. WALANT
   allows the patient to flex actively, so the repair can be tested for gapping and gliding (Lalonde). Teach: The
   anaesthetic choice shapes the operation. Check: avoid incising before the adrenaline has had time to work, so the
   field bleeds.
06_tourniquet.png [step.ortho.tourniquet]  Tourniquet: decide, apply, record: Apply a padded pneumatic cuff as
   proximal as practical, protected from skin preparation fluid. Decide aloud whether it will be inflated. In
   debridement, inflate only if bleeding obscures the field; in compartment syndrome, leave it deflated. Under
   regional or general anaesthesia; not needed with WALANT. Teach: A tourniquet gives a bloodless field but adds
   ischaemia to injured tissue and hides bleeding that tells you what is alive. Check: avoid inflating on a limb with
   suspected compartment syndrome or arterial injury.
07_prep-drape.png [step.core.prep-drape]  Common.
08_incision.png [step.hand.incision]  Hand incision placed on the creases and safe lines: Mark the incision before
   infiltration, relating it to the creases and to the structure you need to reach. Use Brunner zigzags or mid-lateral
   incisions in the digit; never cross a flexion crease at a right angle. Extend the wound with Brunner zigzags or a
   mid-lateral incision, proximally and distally, to reach both tendon ends. Teach: Incisions that cross flexion
   creases at a right angle contract and limit movement. Check: avoid a straight longitudinal incision across a
   digital crease.
09_nerve-protection.png [step.hand.nerve-protection]  Identify and protect the nerves before dividing anything: Know
   where the nerve is expected for this operation and look for it before dividing fascia, pulley or ligament. Retract
   nerves gently with blunt retractors; never hold them with toothed forceps. Digital nerves are often divided with
   the tendon. Repair them under magnification after the tendon repair. Teach: In the hand the nerves lie close to
   every structure that is released or repaired, and their position varies. Check: avoid assuming textbook anatomy
   when variants are common.
10_retrieve.png [step.ftr.retrieve]  Exposing and retrieving the tendon ends: Extend the wound with Brunner or mid-
   lateral incisions to expose the sheath and find the distal tendon end by flexing the digit. Retrieve the proximal
   end by flexing the wrist and MCP joints and milking proximally to distally; if it has retracted into the palm, open
   over the palm and pass a fine catheter or tube down the sheath to deliver it. Teach: The proximal tendon end
   retracts into the palm or the sheath. Check: avoid repeated blind grabbing in the sheath with forceps.
11_pulleys.png [step.ftr.pulleys]  Managing the sheath and pulleys: Open the sheath through windows between the
   pulleys (cruciate or flap incisions) to reach the tendon ends. Preserve as much of A2 and A4 as the repair allows.
   If the repair catches, vent part of A2 or A4 rather than leave the repair jammed, as described by Tang. Teach: A2
   and A4 are the pulleys that matter most for flexion, but a bulky repair catching on them restricts gliding and
   ruptures. Check: avoid excising an entire A2 or A4 pulley.
12_core-suture.png [step.ftr.core-suture]  Multistrand core suture: Use a multistrand core repair (at least four
   strands, for example a 4-strand or a 6-strand M-Tang technique) with a strong looped or double suture. Place the
   core suture purchase well back from each cut end (the purchase length recommended by the technique), with locking
   or grasping loops. Teach: The strength of the repair is roughly proportional to the number of core strands crossing
   it, and the purchase of each grasp. Check: avoid a two-strand core repair that will not tolerate active motion.
13_epitendinous.png [step.ftr.epitendinous]  Epitendinous (peripheral) suture: Run a fine continuous epitendinous
   suture around the repair, with bites taken a short distance from the cut edge. Smooth any ragged surface so the
   repair passes under the pulleys without catching. Teach: The peripheral suture tidies the repair surface so it
   glides through the pulleys, and adds some strength and gap resistance. Check: avoid taking deep peripheral bites
   that bunch the repair.
14_active-check.png [step.hand.active-check]  Active movement check before closure: Ask the patient to make a full
   fist and fully extend the digit several times. Watch the tendon: it should glide smoothly without triggering,
   catching or gapping. Ask for active flexion and extension: look for gapping, catching on a pulley or triggering,
   and correct it now. Teach: In a wide-awake patient, full active movement shows what no passive test can: whether
   triggering has gone, or whether a repair gaps or catches on a pulley. Check: avoid closing because the release
   'looked complete'.
15_unexpected-findings.png [step.hand.unexpected-findings]  Unexpected findings in the hand: stop and get help: Stop
   and reassess the anatomy and the diagnosis before going further. Send tissue for histology or culture if it looks
   abnormal. Segmental loss, a destroyed pulley system or a tendon that will not reach without tension: do not force a
   repair; plan staged reconstruction with a senior hand surgeon. Teach: Hand operations booked as routine can reveal
   a tumour, a nerve variant, tenosynovitis, infection or a tendon gap that cannot be closed primarily. Check: avoid
   extending the operation into a reconstruction without consent.
16_haemostasis.png [step.core.haemostasis]  Common.
17_counts.png [step.core.counts]  Common.
18_skin-closure.png [step.core.skin-closure]  Common.
19_dressing-therapy.png [step.hand.dressing-therapy]  Hand dressing, elevation, splint and therapy plan: Apply a
   dressing that does not constrict and leaves the fingertips visible for perfusion checks. Splint in the position the
   operation needs, or leave the hand free to move if early motion is the plan. Dorsal blocking splint applied in
   theatre; hand therapy starts within days with an early active motion protocol. Teach: Hand outcome depends on what
   happens after theatre: swelling and stiffness cause more poor results than technique does. Check: avoid a
   circumferential dressing that tightens as the hand swells.
20_nv-check.png [step.ortho.nv-check]  Neurovascular and compartment check before leaving theatre: Before the patient
   leaves theatre, check pulses, capillary return and the compartments. Document distal neurovascular status in the
   operation note and the recovery handover. Record capillary refill of the digit and nerve repair status. Teach:
   Deficits and compartment syndrome that are found early are treatable. Check: avoid assuming the limb is fine
   because it was fine before.
21_debrief.png [step.core.debrief]  Common.

D. CRANIOTOMY FOR SUPRATENTORIAL TUMOUR  (folder craniotomy-supratentorial-tumour/)
01_consent-check.png [step.core.consent-check]  Common. Consent states the goal (diagnosis, debulking or maximal safe
   resection) and the realistic deficit risk for this location.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. For an intrinsic brain tumour the operation usually provides the tissue diagnosis. Confirm the MDT
   recommended resection rather than biopsy, and the goal. Teach: A cancer operation is one part of a treatment plan
   agreed by a multidisciplinary team. Check: avoid accepting an MDT note that predates new imaging or a changed
   biopsy result.
03_preop-check.png [step.neuro.preop-check]  Neurological baseline, side and coagulation check: Record GCS by
   component and pupil size and reaction immediately before anaesthesia, with the time. Put the most recent scan up in
   theatre. Read the side (or spinal level) aloud from the images with the team, and match it to the consent and the
   skin mark. Record limb power, speech and visual fields, steroid and anticonvulsant doses, and timing of 5-ALA if
   used. Teach: In neurosurgery the side and the level are read off a scan, not seen on the skin, and the patient
   often cannot confirm them. Check: avoid operating on the side written on the request form rather than the side
   shown on the scan.
04_timeout.png [step.core.timeout]  Common. Say the side, the tumour location and the eloquent structures at risk;
   confirm monitoring and navigation are ready.
05_prophylaxis.png [step.core.prophylaxis]  Common.
06_head-fixation.png [step.neuro.head-fixation]  Head position and fixation: pins or horseshoe: Decide pins (three-
   point fixation) or a horseshoe headrest before positioning. Pins suit long operations and navigation; a horseshoe
   or ring suits shunts and many emergencies. Place pins away from the frontal sinus, the temporal squama, shunt
   hardware, old craniotomy defects and the planned incision. Warn the anaesthetist before pin insertion: the surge in
   blood pressure is predictable. Pins; turn the head so the tumour is uppermost and the approach is perpendicular.
   Teach: The head position sets the surgical corridor, the venous drainage of the brain and the risk to the neck.
   Check: avoid pins in a thin child skull or over a fracture, so the pin penetrates the skull.
07_navigation.png [step.neuro.navigation]  Neuronavigation registration and accuracy check: Confirm the navigation
   scan is the correct patient, correct date and the sequence planned, and that its side matches the consent and the
   mark. Fix the reference frame rigidly to the head clamp (or the skull) where it will not be knocked and stays in
   camera view. Plan the smallest flap that gives access to the whole tumour plus a margin for brain swelling. Teach:
   Navigation shows the surgeon where an instrument is on the pre-operative scan, not in today's brain. Check: avoid
   accepting a registration verified only on the face, then working at the vertex where the error is greatest.
08_prep-drape.png [step.core.prep-drape]  Common. Prepare beyond the planned incision in case the flap has to be
   enlarged.
09_scalp-incision.png [step.neuro.scalp-incision]  Scalp incision and scalp haemostasis: Infiltrate the incision with
   local anaesthetic containing adrenaline where not contraindicated, and wait for it to work. Incise in segments,
   with the assistant pressing either side of the wound while the scalp edge is controlled with clips or haemostats.
   Teach: The scalp is very vascular and can lose a surprising volume of blood in a child or an anaemic adult. Check:
   avoid incising the whole length at once and then chasing scalp bleeding.
10_craniotomy-flap.png [step.neuro.craniotomy-flap]  Raising a free bone flap: Make burr holes at the planned corners,
   avoiding the sinuses, and strip the dura from the inner table of each with a dissector before cutting. Cut between
   burr holes with the footplate on the dura side, keeping the footplate against the inner table, and cut the side
   nearest a sinus last. Flap over the navigated tumour margin, with dural hitch sutures before the dura is opened.
   Teach: The craniotome is safe only when its footplate is separated from the dura. Check: avoid running the
   craniotome across the midline or a sinus.
11_dura-open.png [step.neuro.dura-open]  Opening the dura: Coagulate the dural surface with bipolar diathermy before
   opening it. Lift the dura with a hook or fine forceps and open it with a blade, so the cortex falls away rather
   than being cut. Open with the base towards the sinus; identify and protect the draining veins before the flap is
   reflected. Teach: The dura is the last barrier before brain. Check: avoid opening tense dura widely over a swollen
   brain, so the brain herniates through the defect.
12_corticectomy.png [step.tum.corticectomy]  Choosing and making the corticectomy: Inspect the surface: discoloured,
   expanded gyri or abnormal vessels often mark the tumour. Confirm with navigation and ultrasound. If the tumour is
   near eloquent cortex, map it by direct cortical stimulation before choosing the entry. Teach: The cortical entry
   decides what is damaged on the way to the tumour. Check: avoid a large cortical opening for a small deep tumour.
13_resection.png [step.tum.resection]  Tumour resection and judging the margin: Debulk from the inside with the
   ultrasonic aspirator or suction and bipolar diathermy, keeping within the tumour. For a metastasis or well-defined
   tumour, develop the gliotic plane around it with cottonoids; for a glioma, follow the abnormal tissue and the 5-ALA
   fluorescence or ultrasound appearance. Teach: Extent of resection matters for outcome in glioma, but a new
   permanent deficit matters more to the patient. Check: avoid chasing fluorescence or abnormal signal into eloquent
   tissue.
14_swollen-brain.png [step.neuro.swollen-brain]  Bailout: managing a tight or swelling brain: Say it aloud to the
   anaesthetist and stop retracting. Check head position, jugular compression, airway pressures, end-tidal carbon
   dioxide, blood pressure and anaesthetic depth. Ask for head-up tilt, osmotherapy, brief controlled hyperventilation
   and deeper anaesthesia, per local protocol. Debulking the tumour is often the remedy, but only if swelling is from
   the tumour itself. Teach: A brain that swells out of the craniotomy is either obstructed venous drainage, raised
   carbon dioxide, a new haematoma, or a lesion you have not yet dealt with. Check: avoid removing swollen brain to
   make room without a diagnosis of the cause.
15_specimen.png [step.core.specimen]  Common. Send a smear or frozen section early if the diagnosis decides the extent
   of resection; label fluorescent and non-fluorescent samples if requested.
16_haemostasis.png [step.core.haemostasis]  Common. Line the cavity with haemostatic material, ask for a Valsalva
   manoeuvre and a return to normal blood pressure, and wait for clear irrigation.
17_dural-repair.png [step.neuro.dural-repair]  Dural closure or repair: Close the dura primarily with a fine non-
   absorbable suture where the edges come together without tension. Use a graft (pericranium, fascia or a licensed
   substitute) where primary closure would compress the brain or narrow the theca. Watertight closure, with a
   pericranial or synthetic graft if needed. Teach: A watertight dura keeps cerebrospinal fluid in and infection out.
   Check: avoid forcing a tight primary closure over a swollen brain.
18_flap-fixation.png [step.tum.flap-fixation]  Replacing and fixing the bone flap: Replace the flap only if the brain
   lies below the inner table and the dura is closed. Fix it with low-profile plates and screws or clamps, filling
   burr holes with covers if used locally. Teach: A loose bone flap gives a poor cosmetic result and can move. Check:
   avoid replacing the flap over a tight brain.
19_counts.png [step.core.counts]  Common. Count the cottonoids as well as swabs; they are easily lost in a resection
   cavity.
20_layered-scalp-closure.png [step.neuro.layered-scalp-closure]  Layered scalp closure: Close the galea with
   interrupted inverted absorbable sutures, taking the galea and not just subcutaneous fat. Close the skin with
   staples or a non-absorbable suture that everts the edges, without tension. Teach: The galea is the strength layer
   of the scalp. Check: avoid skin-only closure that leaks CSF.
21_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Post-operative neurological observation plan: Write the post-
   operative GCS, pupils and limb power (or lower-limb and sphincter function after spinal surgery) as a baseline.
   Prescribe the frequency of neurological observations and a specific trigger: a fall in GCS, a new pupil change, new
   weakness or new retention. Baseline includes limb power, speech and visual fields as well as GCS and pupils. Teach:
   Post-operative haematoma and swelling present as a change in neurological observations, often hours after surgery.
   Check: avoid writing 'routine neuro obs' without a baseline or a trigger.
22_debrief.png [step.core.debrief]  Common. State the extent of resection as seen, monitoring events, and the post-
   operative MRI plan.

E. DECOMPRESSIVE CRANIECTOMY (PLANNED)  (folder decompressive-craniectomy/)
01_consent-check.png [step.core.consent-check]  Common. For many patients this is a best-interests decision with the
   family; record what outcome they were told to expect.
02_preop-check.png [step.neuro.preop-check]  Neurological baseline, side and coagulation check: Record GCS by
   component and pupil size and reaction immediately before anaesthesia, with the time. Put the most recent scan up in
   theatre. Read the side (or spinal level) aloud from the images with the team, and match it to the consent and the
   skin mark. Record GCS components and pupils; confirm time from stroke onset or the ICP trend that triggered the
   decision. Teach: In neurosurgery the side and the level are read off a scan, not seen on the skin, and the patient
   often cannot confirm them. Check: avoid operating on the side written on the request form rather than the side
   shown on the scan.
03_timeout.png [step.core.timeout]  Common. State where the bone flap will be stored and that a large craniectomy is
   planned.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_head-fixation.png [step.neuro.head-fixation]  Head position and fixation: pins or horseshoe: Decide pins (three-
   point fixation) or a horseshoe headrest before positioning. Pins suit long operations and navigation; a horseshoe
   or ring suits shunts and many emergencies. Place pins away from the frontal sinus, the temporal squama, shunt
   hardware, old craniotomy defects and the planned incision. Warn the anaesthetist before pin insertion: the surge in
   blood pressure is predictable. Head turned away with a shoulder roll, high enough to see the zygoma and behind the
   ear. Teach: The head position sets the surgical corridor, the venous drainage of the brain and the risk to the
   neck. Check: avoid pins in a thin child skull or over a fracture, so the pin penetrates the skull.
06_cranial-landmarks.png [step.neuro.cranial-landmarks]  Marking cranial landmarks and the incision: Mark the midline,
   the coronal suture, the pinna and the zygoma before draping, while you can still see the whole head. Project the
   lesion from the scan onto the scalp, and plan the burr hole or flap over its thickest part. Mark the midline, the
   tragus, the zygoma and a large reverse question mark incision; mark the 2 cm line off the midline. Teach: Cranial
   surgery is planned on surface landmarks that predict what lies beneath. Check: avoid marking after draping, when
   the midline is no longer visible.
07_prep-drape.png [step.core.prep-drape]  Common. Include the abdomen if the flap will be stored subcutaneously.
08_scalp-incision.png [step.neuro.scalp-incision]  Scalp incision and scalp haemostasis: Infiltrate the incision with
   local anaesthetic containing adrenaline where not contraindicated, and wait for it to work. Incise in segments,
   with the assistant pressing either side of the wound while the scalp edge is controlled with clips or haemostats.
   Preserve the superficial temporal artery at the root of the flap. Teach: The scalp is very vascular and can lose a
   surprising volume of blood in a child or an anaemic adult. Check: avoid incising the whole length at once and then
   chasing scalp bleeding.
09_temporalis.png [step.dc.temporalis]  Elevating the temporalis muscle: Elevate the temporalis with the scalp as a
   myocutaneous flap, or separately, according to preference and the need for exposure low on the temporal bone.
   Divide the muscle close to the superior temporal line, leaving a cuff of fascia for later reattachment if it is
   elevated separately. Teach: The temporalis covers the temporal squama, which has to be removed to decompress the
   temporal lobe. Check: avoid leaving the temporalis bulk over the low temporal bone, so the decompression stays
   high.
10_craniotomy-flap.png [step.neuro.craniotomy-flap]  Raising a free bone flap: Make burr holes at the planned corners,
   avoiding the sinuses, and strip the dura from the inner table of each with a dissector before cutting. Cut between
   burr holes with the footplate on the dura side, keeping the footplate against the inner table, and cut the side
   nearest a sinus last. Large flap: at least 12 by 15 cm, the medial edge about 2 cm from the midline, frontal limit
   at the floor of the anterior fossa where safe. Teach: The craniotome is safe only when its footplate is separated
   from the dura. Check: avoid running the craniotome across the midline or a sinus.
11_temporal-decompression.png [step.dc.temporal-decompression]  Decompressing to the floor of the middle fossa: Nibble
   the remaining temporal squama with rongeurs down to the floor of the middle fossa, flush with the zygomatic root.
   Remove the lesser wing of the sphenoid laterally where it narrows the decompression, with wax on the bone edges.
   Teach: Uncal herniation compresses the brainstem from the temporal lobe. Check: avoid leaving a temporal ledge that
   the brain herniates against.
12_dura-open.png [step.neuro.dura-open]  Opening the dura: Coagulate the dural surface with bipolar diathermy before
   opening it. Lift the dura with a hook or fine forceps and open it with a blade, so the cortex falls away rather
   than being cut. A wide stellate or C-shaped opening across the whole defect; open slowly with the anaesthetist
   ready for a fall in blood pressure. Teach: The dura is the last barrier before brain. Check: avoid opening tense
   dura widely over a swollen brain, so the brain herniates through the defect.
13_intradural.png [step.dc.intradural]  Intradural inspection and limited evacuation: Wash away subdural blood and
   clot gently with warm irrigation. Preserve bridging and cortical veins: venous infarction of swollen brain adds to
   the swelling. Teach: The aim of a decompression is to give the brain room, not to remove brain. Check: avoid
   resecting viable brain to make closure easier.
14_swollen-brain.png [step.neuro.swollen-brain]  Bailout: managing a tight or swelling brain: Say it aloud to the
   anaesthetist and stop retracting. Check head position, jugular compression, airway pressures, end-tidal carbon
   dioxide, blood pressure and anaesthetic depth. Ask for head-up tilt, osmotherapy, brief controlled hyperventilation
   and deeper anaesthesia, per local protocol. Unexpected swelling after decompression in trauma suggests a
   contralateral haematoma: image as soon as the wound is closed. Teach: A brain that swells out of the craniotomy is
   either obstructed venous drainage, raised carbon dioxide, a new haematoma, or a lesion you have not yet dealt with.
   Check: avoid removing swollen brain to make room without a diagnosis of the cause.
15_dural-repair.png [step.neuro.dural-repair]  Dural closure or repair: Close the dura primarily with a fine non-
   absorbable suture where the edges come together without tension. Use a graft (pericranium, fascia or a licensed
   substitute) where primary closure would compress the brain or narrow the theca. Expansile onlay duraplasty with
   pericranium or substitute, laid loosely over the brain. Not watertight, never tight. Teach: A watertight dura keeps
   cerebrospinal fluid in and infection out. Check: avoid forcing a tight primary closure over a swollen brain.
16_bone-storage.png [step.dc.bone-storage]  Bone flap storage, labelling and documentation: Store the flap by the
   agreed method: sterile packaging and the hospital bone bank freezer, or a subcutaneous abdominal pocket. Label it
   with patient identifiers, the date, the side and the operation, read aloud with the scrub practitioner. Teach: The
   bone flap belongs to the patient and will be returned months later. Check: avoid leaving the flap in theatre for
   'someone to sort out'.
17_haemostasis.png [step.core.haemostasis]  Common. Meticulous epidural and bone edge haemostasis; the swollen brain
   is about to fill the space.
18_drain-tunnel.png [step.neuro.drain-tunnel]  Tunnelling and securing a cranial drain: Tunnel the catheter
   subcutaneously away from the wound, exiting through a separate stab incision. Secure it at the exit site with a
   purse-string or anchoring suture, and avoid kinking it in the tunnel. A subgaleal drain on free drainage, not
   suction, if used. Teach: A cranial drain is a direct path from skin to the central nervous system. Check: avoid
   exiting the drain through the main wound, which raises the risk of wound leak and infection.
19_counts.png [step.core.counts]  Common.
20_layered-scalp-closure.png [step.neuro.layered-scalp-closure]  Layered scalp closure: Close the galea with
   interrupted inverted absorbable sutures, taking the galea and not just subcutaneous fat. Close the skin with
   staples or a non-absorbable suture that everts the edges, without tension. Close the galea without tension over the
   swollen brain. Teach: The galea is the strength layer of the scalp. Check: avoid skin-only closure that leaks CSF.
21_postop-neuro-obs.png [step.neuro.postop-neuro-obs]  Post-operative neurological observation plan: Write the post-
   operative GCS, pupils and limb power (or lower-limb and sphincter function after spinal surgery) as a baseline.
   Prescribe the frequency of neurological observations and a specific trigger: a fall in GCS, a new pupil change, new
   weakness or new retention. Add flap tension and ICP to the observations, and a sign that there is no bone on that
   side. Teach: Post-operative haematoma and swelling present as a change in neurological observations, often hours
   after surgery. Check: avoid writing 'routine neuro obs' without a baseline or a trigger.
22_debrief.png [step.core.debrief]  Common. Record the craniectomy dimensions, the dural management, and where and how
   the bone flap was stored.

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
  surgx-carpal-tunnel-release-steps.zip   (folder carpal-tunnel-release/)
  surgx-trigger-finger-release-steps.zip   (folder trigger-finger-release/)
  surgx-flexor-tendon-repair-steps.zip   (folder flexor-tendon-repair/)
  surgx-craniotomy-supratentorial-tumour-steps.zip   (folder craniotomy-supratentorial-tumour/)
  surgx-decompressive-craniectomy-steps.zip   (folder decompressive-craniectomy/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
