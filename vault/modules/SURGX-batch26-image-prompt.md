---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 26 (Coronary artery bypass grafting, Hemithyroidectomy, Parathyroidectomy, Laparoscopic adrenalectomy): Gemini image prompt (86 images, 4 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant cardiothoracic surgeons and endocrine surgeons. You are making 86 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Coronary artery bypass grafting                                22 images
  B. Hemithyroidectomy (thyroid lobectomy)                          21 images
  C. Parathyroidectomy                                              22 images
  D. Laparoscopic adrenalectomy                                     21 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Association of Endocrine Surgeons (AAES), The American Association of Endocrine Surgeons guidelines for definitive management of primary hyperparathyroidism (Wilhelm SM et al., JAMA Surgery); American College of Cardiology, American Heart Association and Society for Cardiovascular Angiography and Interventions, 2021 ACC/AHA/SCAI Guideline for Coronary Artery Revascularization; American Thyroid Association (ATA), 2015 American Thyroid Association management guidelines for adult patients with thyroid nodules and differentiated thyroid cancer (Haugen BR et al., Thyroid); Association of Anaesthetists, Royal College of Physicians and Society for Endocrinology, Guidelines for the management of glucocorticoids during the peri-operative period for patients with adrenal insufficiency (Woodcock T et al., Anaesthesia); Difficult Airway Society (DAS), British Association of Endocrine and Thyroid Surgeons (BAETS) and ENT UK, Management of haematoma after thyroid surgery: systematic review and multidisciplinary consensus guidelines (Iliff HA et al., Anaesthesia); EACTS, EACTA and EBCP, 2019 EACTS/EACTA/EBCP guidelines on cardiopulmonary bypass in adult cardiac surgery; Endocrine Society, Pheochromocytoma and paraganglioma: an Endocrine Society clinical practice guideline (Lenders JWM et al., J Clin Endocrinol Metab); Endocrine Society, The management of primary aldosteronism: case detection, diagnosis, and treatment: an Endocrine Society clinical practice guideline (Funder JW et al., J Clin Endocrinol Metab); European Society of Cardiology (ESC) and European Association for Cardio-Thoracic Surgery (EACTS), 2018 ESC/EACTS Guidelines on myocardial revascularization; European Society of Endocrinology (ESE) and European Network for the Study of Adrenal Tumors (ENSAT), European Society of Endocrinology clinical practice guidelines on the management of adrenocortical carcinoma in adults (Fassnacht M et al., Eur J Endocrinol); European Society of Endocrinology (ESE) and European Network for the Study of Adrenal Tumors (ENSAT), Management of adrenal incidentalomas: European Society of Endocrinology clinical practice guideline (Fassnacht M et al., Eur J Endocrinol); International Neural Monitoring Study Group (INMSG), Electrophysiologic recurrent laryngeal nerve monitoring during thyroid and parathyroid surgery: international standards guideline statement (Randolph GW et al., Laryngoscope); National Institute for Health and Care Excellence (NICE), Hyperparathyroidism (primary): diagnosis, assessment and initial management (NG132); Surgery (journal), Comparison of intraoperative iPTH assay (QPTH) criteria in guiding parathyroidectomy: which criterion is the most accurate?).
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
- A. Supine with the arms tucked or, if a radial artery is harvested, the arm out on a board; roll between the
  scapulae. Legs slightly abducted and externally rotated, knees supported, for vein harvest.
- B. Supine with a shoulder roll, neck extended on a head ring, slight reverse Trendelenburg to lower venous pressure.
  Avoid hyperextension in cervical spondylosis or rheumatoid disease; agree the degree with the anaesthetist. Arms
  tucked at the sides, with access to the monitoring tube connections.
- C. Supine, shoulder roll, neck extended on a head ring, slight reverse Trendelenburg. For a focused approach, the
  head may be turned slightly away from the side of the adenoma. Arms tucked; arterial or venous access for intra-
  operative PTH sampling agreed with the anaesthetist.
- D. Lateral decubitus with the operated side up, the table flexed at the level of the umbilicus or a kidney bridge
  raised to open the space between the costal margin and the iliac crest.
Step-specific facts:
- A. Anatomy: The left anterior descending artery runs in the anterior interventricular groove and supplies the
  anterior wall and septum; it is the most important target, and the left internal mammary artery graft to it carries
  the strongest survival evidence. Must be right: Full heparinisation to the target clotting time before cannulation
  and bypass, confirmed with the perfusionist. Assess the ascending aorta for atheroma before cannulation and clamping
  to reduce stroke.
- B. Anatomy: Each lobe is supplied by the superior thyroid artery (from the external carotid) and the inferior
  thyroid artery (from the thyrocervical trunk), and drained by superior, middle and inferior thyroid veins. Must be
  right: See the recurrent laryngeal nerve before dividing anything near its course; monitoring supplements
  identification, it does not replace it.
- C. Anatomy: Most people have four parathyroids; supernumerary glands occur, and a missing gland is commonly ectopic.
  Must be right: Confirm the biochemical diagnosis before operating; imaging only tells you where to look. Keep the
  adenoma capsule intact: rupture can seed parathyroid tissue (parathyromatosis) and cause persistent disease.
- D. Anatomy: The right adrenal lies posterior to the inferior vena cava and above the upper pole of the kidney,
  beneath the bare area of the liver; its vein is short and wide and drains directly into the posterior surface of the
  vena cava. Must be right: Confirm the biochemistry and the preparation before induction; an unprepared
  phaeochromocytoma can cause a hypertensive crisis on the table.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 86 images)
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

A. CORONARY ARTERY BYPASS GRAFTING  (folder cabg/)
01_consent-check.png [step.core.consent-check]  Common. Document the Heart Team decision. Include stroke, death,
   bleeding and re-operation.
02_timeout.png [step.core.timeout]  Common. State the grafting plan (targets and conduits), the cannulation strategy,
   the aortic assessment and blood availability.
03_prophylaxis.png [step.core.prophylaxis]  Common. Timed prophylaxis with redosing for duration and bypass, per
   cardiac unit protocol.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Chin to toes including both legs, so that any vein can be harvested.
06_sternotomy-open.png [step.thor.sternotomy-open]  Opening the sternum in the midline: Mark the midline from the
   sternal notch to the xiphoid, palpating the intercostal spaces on both sides; incise skin and divide the presternal
   tissue and periosteum exactly on the mark with diathermy. Clear the space behind the manubrium by dividing the
   interclavicular ligament and sweeping a finger behind the notch, and free the xiphoid so that the retrosternal
   plane is open at both ends. Teach: A sternotomy that wanders off the midline produces a weak, asymmetric closure
   and is the commonest technical root of sternal dehiscence. Check: avoid a paramedian cut that splits into the
   costal cartilages.
07_ima-harvest.png [step.cabg.ima-harvest]  Internal mammary artery harvest: Elevate the left hemisternum with a
   mammary retractor and reduce the ventilation volume to bring the pleura away. Harvest the artery as a pedicle with
   its veins and fascia, or skeletonised, using low-power diathermy and clips on the branches, never touching the
   artery itself. Teach: The left internal mammary artery to the left anterior descending artery is the graft most
   strongly linked with long-term survival. Check: avoid diathermy too close to the artery, causing dissection or
   spasm.
08_vein-harvest.png [step.vasc.vein-harvest]  Harvesting and preparing a vein conduit: Expose the vein through
   continuous or skip incisions directly over the marked course, so that the skin flaps are not undermined. Handle the
   vein by its adventitia or the stumps of its branches only. Ligate or clip each tributary a short distance from the
   vein wall, neither flush nor long. Usually done by a second operator during mammary harvest, open or endoscopic.
   Prepare the vein with low-pressure distension and keep it in a buffered solution until use. Teach: The long-term
   patency of a vein graft is largely set during harvest. Check: avoid high-pressure distension with a syringe, which
   tears the intima.
09_pericardium-open.png [step.thor.pericardium-open]  Spreading the sternum and opening the pericardium: Secure
   haemostasis of the periosteum and marrow edges with diathermy and minimal bone wax, then open the retractor slowly
   and only as far as the operation needs, placed low on the sternum. Divide the thymic remnant between ties or clips,
   staying clear of the innominate vein and its thymic branches. Teach: Gradual retraction avoids rib fractures and
   brachial plexus stretch, and a controlled pericardiotomy exposes the heart without injuring the innominate vein,
   the phrenic nerves or the heart itself. Check: avoid opening the retractor fully and quickly, fracturing the first
   rib and stretching the brachial plexus.
10_bypass.png [step.cabg.bypass]  Heparinisation, cannulation, bypass and cardioplegic arrest: Give full-dose heparin
   and confirm the target clotting time with the perfusionist before cannulation (EACTS/EACTA/EBCP 2019). Assess the
   ascending aorta by palpation and, where used, epiaortic ultrasound; place aortic purse strings in a soft area and
   cannulate the aorta, then the right atrium, with the anaesthetist controlling blood pressure during aortic
   cannulation. Teach: Cardiopulmonary bypass and cardioplegia give a still, bloodless field for the coronary
   anastomoses. Check: avoid cannulating or clamping through atheroma.
11_end-to-side-anastomosis.png [step.vasc.end-to-side-anastomosis]  End-to-side anastomosis: Make a clean longitudinal
   arteriotomy in the softest available segment, and cut the end of the conduit obliquely (spatulated) so that its
   opening matches the arteriotomy. Start at the heel, using a parachute technique where it helps visibility, and keep
   equal, small bites with the needle passed from inside to outside on the diseased side so that plaque is pinned
   rather than lifted. Distal coronary anastomoses on the arrested heart, usually the most compromised territory first
   and the mammary artery to the left anterior descending; then the proximal vein-to-aorta anastomoses, under a side-
   biting clamp or a single cross-clamp per surgeon. Teach: Most early graft and fistula failures are technical and
   sit at an anastomosis: a narrowed heel or toe, a lifted intimal flap, a purse-stringed suture line or a twisted
   conduit. Check: avoid picking up the back wall in a toe suture.
12_weaning.png [step.cabg.weaning]  De-airing, reperfusion and weaning from bypass: De-air the heart and aortic root
   before removing the cross-clamp, then reperfuse and rewarm to the target temperature. Confirm rhythm (pace or
   defibrillate as needed), potassium, calcium, haemoglobin and acid-base status, and resume ventilation of both
   lungs. Teach: Coming off bypass is the moment the new grafts and the heart are tested. Check: avoid weaning a cold,
   hyperkalaemic or bradycardic heart.
13_failure-to-wean.png [step.cabg.failure-to-wean]  Failure to wean from bypass: Return to full bypass early rather
   than persisting with a failing heart, and call for senior surgical and anaesthetic help. Look for a cause: graft
   kink, twist, tension or poor flow; new regional wall motion abnormality; valve dysfunction; air; arrhythmia;
   metabolic derangement. Teach: A heart that will not come off bypass is usually telling you something specific,
   often a graft problem or ongoing ischaemia. Check: avoid escalating inotropes without checking the grafts.
14_heparin-reversal.png [step.vasc.heparin-reversal]  Deciding on, and giving, heparin reversal: Decide with the
   anaesthetist whether to reverse, the dose per local protocol, and the timing, once flow is restored and the repair
   is satisfactory. In cardiac surgery give protamine only after separation from bypass and venous decannulation, and
   tell the perfusionist so that the pump suckers are switched off before it starts. Teach: Protamine reduces wound
   and mediastinal bleeding, but it can cause severe hypotension, pulmonary hypertension or anaphylaxis, and given at
   the wrong moment it clots the repair or the bypass circuit. Check: avoid protamine running while the cardiotomy
   suckers are still returning blood to the circuit.
15_haemostasis.png [step.core.haemostasis]  Common. Check every anastomosis, the mammary bed, side branches of the
   conduits, cannulation sites and the sternal edges.
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
   Mediastinal drains, plus a pleural drain on the side of an opened pleura or mammary harvest. Keep drains off the
   grafts. Teach: A drain that is kinked, blocked or wrongly placed gives false reassurance while blood or air
   collects, and retained blood after cardiac or thoracic surgery causes tamponade, a trapped lung and empyema. Check:
   avoid a drain lying against a graft or across the heart.
18_counts.png [step.core.counts]  Common.
19_sternal-closure.png [step.thor.sternal-closure]  Sternal closure with wires: Before closure, confirm haemostasis of
   the sternal edges, the internal mammary beds and the wire sites, and that the counts are correct. Pass stainless
   steel wires through the manubrium and around the body of the sternum in the intercostal spaces, close to the
   sternal edge, keeping clear of the internal mammary vessels and any arterial graft pedicle. Bilateral mammary
   harvest in a diabetic or obese patient raises the risk of sternal complications; consider reinforcement. Teach:
   Sternal instability leads to dehiscence and deep sternal wound infection, which carry substantial mortality. Check:
   avoid wires placed through the bone too near the edge, which cut out when the patient coughs.
20_skin-closure.png [step.core.skin-closure]  Common. Sternal and leg wounds; the leg wound is a common site of
   infection and haematoma.
21_debrief.png [step.core.debrief]  Common. Record each graft (conduit, target, flow), bypass and cross-clamp times,
   inotropic support, pacing needs and bleeding concerns.
22_emergency-resternotomy.png [step.thor.emergency-resternotomy]  Emergency re-sternotomy for arrest or tamponade:
   Recognise the setting: sudden hypotension, rising filling pressures, falling or abruptly stopped drain output, or
   arrest within the first days after surgery. Call the cardiac surgeon and the team immediately. Follow the cardiac
   surgery resuscitation protocol: for a shockable rhythm, early defibrillation; for asystole or severe bradycardia,
   pace through the epicardial wires; start compressions only if these do not restore output quickly. Hand over the
   re-sternotomy plan for the intensive care team, and the threshold for calling the surgeon about drain output.
   Teach: After cardiac surgery, cardiac arrest is often caused by tamponade or bleeding that only opening the chest
   can fix, and external compressions can damage grafts and valves. Check: avoid prolonged external compressions while
   the cause is a tamponade that only re-sternotomy will relieve.

B. HEMITHYROIDECTOMY (THYROID LOBECTOMY)  (folder hemithyroidectomy/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side. Confirm the patient understands this is one
   lobe and that a second operation may follow histology.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. For a nodule, confirm the Bethesda category, the ultrasound of both lateral compartments and the
   laryngoscopy result. For a cancer, confirm the MDT chose lobectomy rather than total thyroidectomy. Teach: A cancer
   operation is one part of a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note
   that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. A clean neck operation: routine antibiotic prophylaxis is usually
   not needed. Follow local policy.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_collar-access.png [step.neck.collar-access]  Collar incision, subplatysmal flaps and midline strap separation: Mark
   the incision in a natural skin crease about two finger-breadths above the sternal notch, ideally with the patient
   sitting up before positioning; length to suit the gland and the operation. Divide platysma and raise flaps in the
   subplatysmal plane, superficial to the anterior jugular veins, up to the thyroid cartilage and down to the sternal
   notch. Teach: A skin-crease incision heals with a good scar, and the avascular midline between the strap muscles
   gives bloodless access to the thyroid bed and the parathyroids on either side. Check: avoid an incision placed too
   low, which drifts onto the sternum as the scar matures and widens.
08_ionm-setup.png [step.neck.ionm-setup]  Nerve monitoring set-up and baseline vagal signal: Ask the anaesthetist to
   confirm tube electrode position after final positioning (neck extension moves the tube) and to avoid long-acting
   neuromuscular block after intubation. Before thyroid or parathyroid dissection, open the carotid sheath on the
   operated side and stimulate the vagus (V1), recording amplitude and latency. Teach: Monitoring only helps if you
   know it worked at the start. Check: avoid starting dissection with an untested system and discovering the fault
   only when the nerve signal seems lost.
09_superior-pole.png [step.hemi.superior-pole]  Superior pole: individual vessel ligation, external branch protected:
   Divide the middle thyroid vein first so the lobe can be rotated forwards and medially. Retract the upper pole
   downwards and laterally to open the avascular space between the pole and cricothyroid (the sternothyroid-laryngeal
   triangle). Teach: The external branch of the superior laryngeal nerve runs with or between the superior pole
   vessels. Check: avoid taking the whole pedicle in one bite away from the capsule.
10_parathyroid-recognition.png [step.neck.parathyroid-recognition]  Recognise each parathyroid and keep it on its
   blood supply: Look for the superior gland posteriorly at about the level of the cricothyroid junction, dorsal to
   the plane of the recurrent laryngeal nerve; look for the inferior gland near the lower pole and thyrothymic
   ligament, ventral to the nerve. Recognise parathyroid by its tan, caramel colour, its fine surface vessels and its
   tendency to slide in its fat; fat is yellower and lymph nodes greyer and firmer. Here the aim is preservation:
   sweep both glands on the operated side laterally on their pedicles before the nerve dissection. Teach: Whether the
   aim is to preserve normal parathyroids during a lobectomy or to find the abnormal one, the surgeon must recognise
   parathyroid tissue and know where it lives. Check: avoid ligating the inferior thyroid artery trunk laterally,
   which devascularises both glands on that side.
11_rln-identify.png [step.neck.rln-identify]  Identify and protect the recurrent laryngeal nerve: Rotate the lobe
   medially with gentle traction and look for the nerve in the tracheo-oesophageal groove, at its crossing with the
   inferior thyroid artery, or beneath the tubercle of Zuckerkandl. Confirm it with the stimulating probe (R1) and
   follow it upwards towards its entry into the larynx below the inferior constrictor. Teach: Seeing the recurrent
   laryngeal nerve along its course is the main defence against injuring it. Check: avoid traction injury from
   vigorous medial rotation of the lobe.
12_unexpected-findings.png [step.hemi.unexpected-findings]  Unexpected invasive tumour or nodal disease: stop
   extending, reassess: If the tumour is adherent to a nerve that conducted normally on monitoring, shave the tumour
   off the nerve where possible rather than divide it; record any residual disease. If the trachea, oesophagus or
   larynx is invaded, stop, call a senior colleague, and do not proceed with an unplanned aerodigestive resection.
   Teach: A lobectomy is planned for low-risk disease. Check: avoid dividing a functioning recurrent laryngeal nerve
   to achieve a clear margin.
13_berry-isthmus.png [step.hemi.berry-isthmus]  Ligament of Berry, isthmus division and lobe removal: With the nerve
   in view, divide the ligament of Berry in small bites with fine instruments, close to the gland. Control bleeding
   here with pressure or fine bipolar under vision, not with blind clips or monopolar diathermy. Teach: The nerve is
   closest to the gland at the ligament of Berry, and small vessels here bleed. Check: avoid chasing bleeding at
   Berry's ligament with diathermy.
14_ionm-final.png [step.neck.ionm-final]  Final nerve signal and the decision about the other side: After the
   dissection on each side, stimulate the recurrent laryngeal nerve proximal to the dissected segment (R2) and the
   vagus (V2), and record the values. If the signal is lost, troubleshoot the equipment and the tube first, then map
   the nerve to find the segment of injury. In a lobectomy there is no second side today, but a lost signal changes
   the voice plan and makes cord assessment essential before any completion surgery. Teach: A signal recorded after
   the dissection tells you whether the nerve still conducts. Check: avoid proceeding to the second side after a loss
   of signal because the patient was told it would be one operation.
15_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. A suture on the superior pole is the usual minimum; mark the nodule of concern if more than
   one is present. Teach: Margin status and nodal yield are reported by the pathologist, but only from a specimen they
   can orient. Check: avoid a single suture with no stated convention.
16_haemostasis.png [step.core.haemostasis]  Common. Valsalva or a raised pressure, and inspect the superior pole
   stump, the Berry's ligament area and the isthmus edge.
17_counts.png [step.core.counts]  Common.
18_specimen.png [step.core.specimen]  Common.
19_closure.png [step.neck.closure]  Closing the central neck so a haematoma can decompress: After the haemostasis
   check with a raised pressure or Valsalva, approximate the strap muscles loosely in the midline, leaving a gap at
   the lower end. Close platysma with interrupted absorbable sutures, then the skin with a subcuticular suture, glue
   or clips. Teach: Blood trapped deep to tightly closed strap muscles compresses the trachea and causes laryngeal
   venous congestion. Check: avoid watertight strap closure that converts a small bleed into airway compression.
20_haematoma-handover.png [step.neck.haematoma-handover]  Airway and haematoma handover after neck surgery: Hand over
   explicitly to recovery and the ward: the operation, any concern about haemostasis, nerve monitoring results and the
   voice plan. Ensure a haematoma kit (stitch cutter or clip remover, scalpel, gauze) is at the bedside and that staff
   know the DESATS warning features and the SCOOP bedside release sequence per the DAS, BAETS and ENT UK guidance.
   Teach: A neck haematoma can obstruct the airway within minutes, and the people who see it first are recovery and
   ward staff, not the surgeon. Check: avoid a handover of 'routine neck obs' without saying what to look for or what
   to do.
21_debrief.png [step.core.debrief]  Common.

C. PARATHYROIDECTOMY  (folder parathyroidectomy/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side of the localised adenoma, and confirm the
   patient has consented to bilateral exploration if the focused approach fails.
02_endocrine-biochem-check.png [step.onco.endocrine-biochem-check]  Biochemical diagnosis, localisation and endocrine
   preparation confirmed: Confirm the biochemical diagnosis that justifies the operation is documented and current,
   and that alternative explanations (for example familial hypocalciuric hypercalcaemia, or medication effects) have
   been excluded. Confirm that localisation imaging is available in theatre and that the side and site match the
   consent and the marking. Calcium, PTH, vitamin D and urinary calcium excretion (familial hypocalciuric
   hypercalcaemia excluded), with the two localisation studies concordant for a focused approach. Teach: Endocrine
   operations treat a biochemical disease. Check: avoid operating on an incidental lump that was never shown to be
   functional or suspicious.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. A clean neck operation: routine antibiotic prophylaxis is usually
   not needed. Follow local policy.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Drape for a full collar incision even when planning a small one, so
   conversion to bilateral exploration needs no re-preparation.
07_baseline-pth.png [step.ptx.baseline-pth]  Baseline PTH before incision or before excision: Agree the sampling
   protocol with the anaesthetist and the laboratory before starting: sample site, tube type and timing. Take the
   baseline sample before incision, and a pre-excision sample just before the adenoma's vessel is clamped, because
   handling the gland can raise PTH. Teach: Intra-operative PTH is judged as a fall from a baseline. Check: avoid
   taking the baseline after the gland has been mobilised and squeezed, which makes a later fall look larger than it
   is.
08_collar-access.png [step.neck.collar-access]  Collar incision, subplatysmal flaps and midline strap separation: Mark
   the incision in a natural skin crease about two finger-breadths above the sternal notch, ideally with the patient
   sitting up before positioning; length to suit the gland and the operation. Divide platysma and raise flaps in the
   subplatysmal plane, superficial to the anterior jugular veins, up to the thyroid cartilage and down to the sternal
   notch. For a focused approach use a short incision placed over the localised gland, off-midline if planned, so that
   it can be extended into a standard collar incision. Teach: A skin-crease incision heals with a good scar, and the
   avascular midline between the strap muscles gives bloodless access to the thyroid bed and the parathyroids on
   either side. Check: avoid an incision placed too low, which drifts onto the sternum as the scar matures and widens.
09_ionm-setup.png [step.neck.ionm-setup]  Nerve monitoring set-up and baseline vagal signal: Ask the anaesthetist to
   confirm tube electrode position after final positioning (neck extension moves the tube) and to avoid long-acting
   neuromuscular block after intubation. Before thyroid or parathyroid dissection, open the carotid sheath on the
   operated side and stimulate the vagus (V1), recording amplitude and latency. Teach: Monitoring only helps if you
   know it worked at the start. Check: avoid starting dissection with an untested system and discovering the fault
   only when the nerve signal seems lost.
10_focused-search.png [step.ptx.focused-search]  Go straight to the localised site and find the adenoma: Enter between
   the strap muscles and sternocleidomastoid or through the midline as planned, and retract the thyroid lobe medially.
   Look first where the imaging places the gland, using its relation to the lower pole, the inferior thyroid artery
   and the carotid as described on the ultrasound. Teach: A focused operation is safe only when it goes exactly where
   the concordant imaging points. Check: avoid tearing the middle thyroid vein through a small incision.
11_rln-identify.png [step.neck.rln-identify]  Identify and protect the recurrent laryngeal nerve: Rotate the lobe
   medially with gentle traction and look for the nerve in the tracheo-oesophageal groove, at its crossing with the
   inferior thyroid artery, or beneath the tubercle of Zuckerkandl. Confirm it with the stimulating probe (R1) and
   follow it upwards towards its entry into the larynx below the inferior constrictor. Inferior adenomas lie ventral
   to the nerve; superior adenomas lie dorsal to it and can descend into the groove. Know which before you clip the
   pedicle. Teach: Seeing the recurrent laryngeal nerve along its course is the main defence against injuring it.
   Check: avoid traction injury from vigorous medial rotation of the lobe.
12_parathyroid-recognition.png [step.neck.parathyroid-recognition]  Recognise each parathyroid and keep it on its
   blood supply: Look for the superior gland posteriorly at about the level of the cricothyroid junction, dorsal to
   the plane of the recurrent laryngeal nerve; look for the inferior gland near the lower pole and thyrothymic
   ligament, ventral to the nerve. Recognise parathyroid by its tan, caramel colour, its fine surface vessels and its
   tendency to slide in its fat; fat is yellower and lymph nodes greyer and firmer. Here the aim is to tell abnormal
   from normal: an adenoma is larger and darker, a normal gland is small and caramel. Do not biopsy normal glands.
   Teach: Whether the aim is to preserve normal parathyroids during a lobectomy or to find the abnormal one, the
   surgeon must recognise parathyroid tissue and know where it lives. Check: avoid ligating the inferior thyroid
   artery trunk laterally, which devascularises both glands on that side.
13_adenoma-excision.png [step.ptx.adenoma-excision]  Excise the adenoma with its capsule intact: Handle the gland only
   by its surrounding fat or a fine tie on its pedicle; never grasp the capsule with forceps. Dissect around the gland
   bluntly in its fat envelope and identify its vascular pedicle. Teach: A ruptured adenoma can seed parathyroid
   tissue through the neck and cause persistent or recurrent hyperparathyroidism that is very hard to cure. Check:
   avoid grasping the adenoma with toothed forceps and rupturing it.
14_iopth.png [step.ptx.iopth]  Intra-operative PTH after excision: cure or continue: Draw the post-excision sample at
   the time the agreed criterion specifies; the commonly used Miami criterion is a fall of more than 50 percent from
   the highest pre-incision or pre-excision value at 10 minutes after excision. Keep the wound open and the patient
   anaesthetised while the result is processed. Teach: PTH has a short half-life, so removing the only
   hyperfunctioning gland produces a fall within minutes. Check: avoid closing because the excised gland looked large,
   before the result is back.
15_bilateral-exploration.png [step.ptx.bilateral-exploration]  Convert to bilateral exploration when the focused
   approach fails: Extend to a standard collar incision and explore both sides systematically, identifying each
   recurrent laryngeal nerve, and aim to see all four glands before removing any further tissue. Search the common
   ectopic sites for a missing gland: the thyrothymic ligament and upper thymus (inferior), the tracheo-oesophageal
   groove and retro-oesophageal space (superior), the carotid sheath, and within the thyroid. Teach: When the
   localised gland is not found, or PTH does not fall, the patient is not cured. Check: avoid removing normal glands
   one by one in the hope that PTH will fall, causing permanent hypoparathyroidism.
16_ionm-final.png [step.neck.ionm-final]  Final nerve signal and the decision about the other side: After the
   dissection on each side, stimulate the recurrent laryngeal nerve proximal to the dissected segment (R2) and the
   vagus (V2), and record the values. If the signal is lost, troubleshoot the equipment and the tube first, then map
   the nerve to find the segment of injury. Before crossing to the second side in a bilateral exploration, confirm the
   first nerve still conducts. Teach: A signal recorded after the dissection tells you whether the nerve still
   conducts. Check: avoid proceeding to the second side after a loss of signal because the patient was told it would
   be one operation.
17_haemostasis.png [step.core.haemostasis]  Common. Valsalva or a raised pressure; check the pedicle clip and the
   thyroid surface you retracted.
18_counts.png [step.core.counts]  Common.
19_specimen.png [step.core.specimen]  Common. Weigh the gland where the unit records it, and label each gland removed
   by its position (right or left, superior or inferior).
20_closure.png [step.neck.closure]  Closing the central neck so a haematoma can decompress: After the haemostasis
   check with a raised pressure or Valsalva, approximate the strap muscles loosely in the midline, leaving a gap at
   the lower end. Close platysma with interrupted absorbable sutures, then the skin with a subcuticular suture, glue
   or clips. Teach: Blood trapped deep to tightly closed strap muscles compresses the trachea and causes laryngeal
   venous congestion. Check: avoid watertight strap closure that converts a small bleed into airway compression.
21_haematoma-handover.png [step.neck.haematoma-handover]  Airway and haematoma handover after neck surgery: Hand over
   explicitly to recovery and the ward: the operation, any concern about haemostasis, nerve monitoring results and the
   voice plan. Ensure a haematoma kit (stitch cutter or clip remover, scalpel, gauze) is at the bedside and that staff
   know the DESATS warning features and the SCOOP bedside release sequence per the DAS, BAETS and ENT UK guidance.
   Teach: A neck haematoma can obstruct the airway within minutes, and the people who see it first are recovery and
   ward staff, not the surgeon. Check: avoid a handover of 'routine neck obs' without saying what to look for or what
   to do.
22_debrief.png [step.core.debrief]  Common.

D. LAPAROSCOPIC ADRENALECTOMY  (folder laparoscopic-adrenalectomy/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side and check it against the imaging and, in
   aldosteronism, against the adrenal venous sampling result.
02_endocrine-biochem-check.png [step.onco.endocrine-biochem-check]  Biochemical diagnosis, localisation and endocrine
   preparation confirmed: Confirm the biochemical diagnosis that justifies the operation is documented and current,
   and that alternative explanations (for example familial hypocalciuric hypercalcaemia, or medication effects) have
   been excluded. Confirm that localisation imaging is available in theatre and that the side and site match the
   consent and the marking. Metanephrines, cortisol suppression and aldosterone-renin results documented for every
   case; alpha-blockade complete for a phaeochromocytoma; steroid cover written up for cortisol excess. Teach:
   Endocrine operations treat a biochemical disease. Check: avoid operating on an incidental lump that was never shown
   to be functional or suspicious.
03_timeout.png [step.core.timeout]  Common. For a phaeochromocytoma, the anaesthetist states the vasoactive drugs
   drawn up, and the team agrees to announce tumour manipulation and vein ligation.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Prepare widely enough for an open subcostal or flank conversion.
07_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Usually
   below the costal margin in the anterior axillary or mid-clavicular line, with the patient on their side. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
08_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Three or four ports along and parallel to the costal margin; on the right one carries the liver
   retractor. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference between a
   comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight each
   other.
09_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Look at the liver and peritoneum for unexpected metastatic
   disease, especially when carcinoma or metastasis is a possibility. Teach: The first look answers a question the
   imaging could not, and it is the only chance to find the second diagnosis before attention narrows to the first.
   Check: avoid going straight to the target and missing a second pathology.
10_mobilise.png [step.adr.mobilise]  Expose the adrenal: liver mobilisation on the right, medial rotation on the left:
   Right: divide the right triangular ligament and the peritoneum along the inferior edge of the liver up to the
   diaphragm, retract the liver medially and upwards, and expose the lateral border of the inferior vena cava. Left:
   mobilise the splenic flexure if needed, divide the splenorenal ligament up to the diaphragm, and let the spleen and
   pancreatic tail fall medially, developing the plane between the pancreatic tail and the kidney. Teach: Laparoscopic
   adrenalectomy is safe when gravity and mobilisation display the gland and its vein. Check: avoid too little liver
   mobilisation, so the vena cava edge is never clearly seen.
11_tumour-handling.png [step.onco.tumour-handling]  Oncological handling: no touch, wound protection, clean field:
   Handle the tumour-bearing tissue as little as possible; retract the specimen by its normal edges, not by the
   tumour. Control the vascular pedicle early where the operation allows it, before the tumour is mobilised. Handle
   the adrenal only by its surrounding fat; a capsular breach spills tumour and, in a phaeochromocytoma,
   catecholamines. Teach: Tumour cells shed into the wound, the peritoneum or a port site produce a recurrence that no
   adjuvant therapy fully reverses. Check: avoid grasping the tumour with a toothed instrument to improve exposure.
12_vein.png [step.adr.vein]  Identify, clip and divide the adrenal vein: Right: dissect along the lateral edge of the
   vena cava upwards until the short adrenal vein is seen entering its posterolateral surface; free it enough for two
   clips on the caval side. Left: follow the left renal vein to the adrenal vein on its upper border, often joined by
   the inferior phrenic vein; clip and divide it, preserving the renal vein. Teach: The adrenal vein is the one
   structure in this operation that bleeds dangerously: on the right it is short and enters the vena cava directly, on
   the left it joins the renal vein. Check: avoid clipping across the wall of the vena cava.
13_gland-dissection.png [step.adr.gland-dissection]  Free the gland in its periadrenal fat with an intact capsule:
   Lift the gland by its surrounding fat, not by the gland, and seal the small arteries from the inferior phrenic,
   aorta and renal artery with the energy device. Free the superior attachments from the diaphragm, then the inferior
   attachments from the upper pole of the kidney, staying out of the renal hilum. Teach: The adrenal is friable and
   its tumours may be malignant or hormonally active. Check: avoid breaching the capsule with a grasper.
14_conversion.png [step.adr.conversion]  Convert to open surgery early when needed: Decide on conversion for bleeding
   not controlled within a short period of pressure, for local invasion or venous tumour thrombus, or when the
   dissection is not progressing safely. Maintain pressure on any bleeding point while the team prepares; tell the
   anaesthetist and call for blood and senior help. Teach: Conversion is a safety manoeuvre, not a failure. Check:
   avoid persisting laparoscopically while blood loss mounts.
15_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Always use a bag; never morcellate an adrenal tumour. Teach: Bringing an infected or
   neoplastic specimen through the abdominal wall unprotected causes port-site infection and, in malignancy, port-site
   recurrence. Check: avoid a bag torn during extraction, spilling contents into the wound.
16_haemostasis.png [step.core.haemostasis]  Common. Lower the pneumoperitoneum and inspect the vein stump, the adrenal
   bed, the liver or spleen surface and the renal hilum.
17_counts.png [step.core.counts]  Common.
18_specimen.png [step.core.specimen]  Common.
19_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
20_skin-closure.png [step.core.skin-closure]  Common.
21_debrief.png [step.core.debrief]  Common. Hand over the hormone plan in writing: steroid cover and taper, potassium
   plan, or phaeochromocytoma monitoring for blood pressure and glucose.

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
  surgx-cabg-steps.zip   (folder cabg/)
  surgx-hemithyroidectomy-steps.zip   (folder hemithyroidectomy/)
  surgx-parathyroidectomy-steps.zip   (folder parathyroidectomy/)
  surgx-laparoscopic-adrenalectomy-steps.zip   (folder laparoscopic-adrenalectomy/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
