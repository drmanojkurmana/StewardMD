---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 18 (Transvaginal cervical cerclage, Open, Wide local excision with sentinel node biopsy, Axillary lymph node dissection, Excision of a benign breast lump, Open repair of ruptured abdominal aortic aneurysm): Gemini image prompt (110 images, 6 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant breast surgeons and obstetricians and gynaecologists and vascular surgeons. You are making 110 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Transvaginal cervical cerclage (McDonald)                      15 images
  B. Open (abdominal) myomectomy                                    21 images
  C. Wide local excision with sentinel node biopsy                  18 images
  D. Axillary lymph node dissection                                 20 images
  E. Excision of a benign breast lump (fibroadenoma)                15 images
  F. Open repair of ruptured abdominal aortic aneurysm              21 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American College of Obstetricians and Gynecologists (ACOG), Cerclage for the management of cervical insufficiency (Practice Bulletin No. 142); American College of Obstetricians and Gynecologists (ACOG), Management of symptomatic uterine leiomyomas (Practice Bulletin No.).
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
- A. Lithotomy; slight head-down tilt helps when membranes are bulging.
- B. Supine, arms out, urinary catheter after vaginal preparation; slight head-down tilt once the abdomen is open.
- C. Supine with the ipsilateral arm abducted to no more than 90 degrees on an arm board. Slight lateral tilt for an
  outer quadrant lesion. Gamma probe and screen positioned so the surgeon can read the count while dissecting.
- D. Supine with the arm on an arm board abducted to no more than 90 degrees, shoulder at the edge of the table. Drape
  the arm free in a stockinette so the assistant can move it to relax pectoralis major during level II dissection.
- E. Supine with the ipsilateral arm abducted to no more than 90 degrees on an arm board. A small roll under the
  shoulder for a lateral lump, so the breast falls medially and flattens over the chest wall. The marked lump and the
  localising device (if any) visible after draping.
- F. Supine, arms out, with a warming blanket below the waist and fluid warmers on every line. Urinary catheter and
  nasogastric tube after induction if not already in place.
Step-specific facts:
- A. Anatomy: The McDonald suture is placed at the junction of the rugose vaginal skin and the smooth cervix, without
  dissecting the bladder off the cervix; higher placement requires dissection (Shirodkar) and is a different
  operation. Must be right: Place the bites as high as possible at the cervicovaginal junction, avoiding the bladder
  anteriorly and the vessels laterally. Do not enter the cervical canal with a bite. Handle the cervix and membranes
  gently; no bimanual pressure on bulging membranes.
- B. Anatomy: Fibroids are classified by their position relative to the cavity and serosa (submucous, intramural,
  subserosal, pedunculated), commonly by the FIGO system. Must be right: Warn the anaesthetist before any
  vasoconstrictor is injected, and aspirate before injecting. Plan the fewest incisions that reach all the fibroids,
  preferably anterior and in the midline.
- C. Anatomy: Lymph from the breast drains predominantly to the axilla, and the sentinel node is usually in level I,
  low in the axilla behind the lateral border of pectoralis major. The intercostobrachial nerve crosses the axilla
  near the usual site of the sentinel node. Must be right: Confirm the localisation device and the side before
  incision, and confirm on specimen radiograph that the lesion and the device are in the specimen.
- D. Anatomy: Levels are defined by pectoralis minor: level I lateral to its lateral border, level II behind it, level
  III medial to it up to the apex below the clavicle. The axillary vein forms the superior limit of a standard
  clearance; the specimen is taken from below it. Must be right: Define the axillary vein early and work below it; do
  not strip the vein adventitia or dissect above it in a standard clearance. Identify and preserve the long thoracic
  and thoracodorsal nerves before dividing tissue on the medial and posterior walls.
- E. Anatomy: The breast lies on pectoralis major fascia, from the second to the sixth rib and from the sternal edge
  to the mid-axillary line, with an axillary tail. Must be right: Do not operate without a concordant triple
  assessment; a discordant result is a diagnostic excision with margins in mind, not an enucleation. Excise the lump
  you marked: re-examine on the table, and confirm a localised lesion is in the specimen.
- F. Anatomy: The left renal vein crosses anterior to the aorta at the neck and is the landmark for an infrarenal
  clamp. It may be retro-aortic or circumaortic. Must be right: Prepare and drape before induction. Induction can drop
  the pressure catastrophically, and the knife must be ready. Proximal control is the operation. Clamp first, dissect
  later. Do not dissect the iliac arteries circumferentially.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 110 images)
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

A. TRANSVAGINAL CERVICAL CERCLAGE (MCDONALD)  (folder mcdonald-cerclage/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the indication category and that removal at 36 to 37
   weeks, or earlier with labour or rupture of membranes, was explained.
02_timeout.png [step.core.timeout]  Common.
03_preop-check.png [step.obg.preop-check]  Confirm the indication, pregnancy status and pre-operative work-up: Confirm
   pregnancy status on the day: a negative test before elective gynaecological surgery, or a confirmed intrauterine
   pregnancy and gestation before an obstetric procedure. Look at the imaging that justifies the operation yourself,
   and confirm it matches the side and the plan on the consent form. Viable intrauterine pregnancy and gestation
   confirmed; no labour, bleeding, rupture of membranes or infection. Teach: Gynaecological and obstetric operations
   rest on a scan, a test result and a plan agreed in clinic. Check: avoid proceeding on a report without looking at
   the images.
04_prophylaxis.png [step.core.prophylaxis]  Common. Routine antibiotics and tocolysis are not established for
   cerclage; follow local policy.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_lithotomy-eua.png [step.obg.lithotomy-eua]  Lithotomy, bladder and examination under anaesthesia: Lift and lower
   both legs together into the supports, avoid extreme hip flexion and abduction, and pad the lateral knee over the
   common peroneal nerve. Empty the bladder with an in-and-out catheter, or leave a catheter, as the procedure plan
   requires. Speculum examination only when membranes are exposed: no bimanual examination over bulging membranes.
   Teach: The size, position and mobility of the uterus and the state of the cervix under anaesthesia decide the
   direction of every instrument that follows. Check: avoid instrumenting a retroverted uterus as if it were
   anteverted.
07_prep-drape.png [step.core.prep-drape]  Common. Gentle vaginal preparation; do not swab vigorously over exposed
   membranes.
08_expose.png [step.cerc.expose]  Exposing and holding the cervix: Expose the cervix with a Sims or weighted speculum
   and lateral vaginal wall retractors. Hold the anterior and posterior lips with sponge-holding or ring forceps, not
   a toothed tenaculum. Teach: The suture can only be placed high if the cervicovaginal junction is seen all the way
   round, and a soft pregnant cervix tears if it is held with toothed instruments. Check: avoid pulling the cervix
   down hard, which can open the os.
09_membranes.png [step.cerc.membranes]  Managing bulging membranes, or abandoning the cerclage: Use head-down tilt,
   and reduce the membranes gently with a moist swab on a stick or by other methods the senior has agreed, such as
   filling the bladder or a balloon catheter. Keep the reduced membranes behind the os while the bites are placed and
   the suture is tied. Teach: In rescue cerclage the membranes may prolapse through the os. Check: avoid tying the
   suture over membranes that are still prolapsed.
10_bites.png [step.cerc.bites]  Placing the purse-string bites: Start anteriorly and place four to six bites around
   the cervix at the cervicovaginal junction, as high as can be reached. Take each bite deep into the cervical stroma
   but not into the canal; check the needle path before driving it through. Teach: A cerclage helps only if it is high
   on the cervix. Check: avoid bites placed low on the cervix because high exposure was difficult.
11_tie.png [step.cerc.tie]  Tying the cerclage and leaving it removable: Tie the suture firmly enough to close the os
   to a fingertip, without strangulating the cervix. Place the knot anteriorly (or where the operator records) and
   leave the ends long enough to grasp at removal. Teach: The knot must close the os without cutting through the
   cervix, and the suture must be easy to find and cut in labour or at 36 to 37 weeks. Check: avoid tying so tight
   that the suture cuts through soft tissue.
12_haemostasis.png [step.core.haemostasis]  Common. Pressure usually settles needle-hole bleeding; avoid diathermy
   near the membranes.
13_counts.png [step.core.counts]  Common. Every swab placed in the vagina is counted out.
14_fetal-check.png [step.cerc.fetal-check]  Fetal heart and immediate post-procedure check: Confirm the fetal heart by
   Doppler or ultrasound in recovery, as appropriate for gestation. Check for vaginal bleeding and leaking fluid.
   Teach: The operation is for the pregnancy. Check: avoid discharging without documenting the fetal heart after the
   procedure.
15_debrief.png [step.core.debrief]  Common. Record the suture material, number of bites, knot position, membrane
   status and the removal plan.

B. OPEN (ABDOMINAL) MYOMECTOMY  (folder open-myomectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm she understands the small risk of hysterectomy and
   what it means for her.
02_timeout.png [step.core.timeout]  Common. State the fibroid map, blood availability, cell salvage and the
   vasoconstrictor plan.
03_preop-check.png [step.obg.preop-check]  Confirm the indication, pregnancy status and pre-operative work-up: Confirm
   pregnancy status on the day: a negative test before elective gynaecological surgery, or a confirmed intrauterine
   pregnancy and gestation before an obstetric procedure. Look at the imaging that justifies the operation yourself,
   and confirm it matches the side and the plan on the consent form. Haemoglobin corrected, imaging map reviewed, no
   features of sarcoma. Teach: Gynaecological and obstetric operations rest on a scan, a test result and a plan agreed
   in clinic. Check: avoid proceeding on a report without looking at the images.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_pfannenstiel.png [step.obg.pfannenstiel]  Transverse lower abdominal (Pfannenstiel) entry: Choose the incision
   before you start: transverse for a uterus or mass confined to the pelvis, midline for a very large uterus, upper
   abdominal pathology or suspected malignancy. Incise the skin about two fingerbreadths above the symphysis and
   divide the anterior rectus sheath transversely. A midline incision when the uterus reaches well above the pelvis.
   Teach: A transverse suprapubic incision gives good access to a pelvic organ of moderate size, with less pain and a
   lower risk of incisional hernia than a midline incision. Check: avoid persisting with a transverse incision that
   does not give access to a large uterus.
08_exploration.png [step.abd.exploration]  Systematic exploration: Follow the same sequence every time: liver and
   gallbladder, stomach and duodenum, spleen, small bowel from duodenojejunal flexure to caecum, colon and rectum,
   pelvis, retroperitoneum, hernial orifices from inside. Run the small bowel hand over hand, both surfaces, in one
   direction. Palpate and map every fibroid against the imaging before choosing incisions. Teach: The purpose of a
   laparotomy is to find out. Check: avoid stopping the exploration when the expected pathology is found.
09_adnexal-check.png [step.obg.adnexal-check]  Inspect both tubes and ovaries: Inspect the contralateral tube along
   its length, including the fimbrial end, and both ovaries. Note adhesions, hydrosalpinx, endometriosis, cysts or
   other pathology. Teach: The state of the remaining tube and both ovaries determines future fertility, the choice
   between salpingectomy and salpingotomy, and what the woman is told afterwards. Check: avoid omitting the check
   because the main procedure is complete.
10_vasoconstrict.png [step.myo.vasoconstrict]  Reducing blood loss: vasoconstrictor and tourniquet: Tell the
   anaesthetist before injection; prepare the vasoconstrictor at the dilution and maximum dose set by local protocol.
   Aspirate before injecting and infiltrate into the myometrium around the fibroid, beneath the serosa, until it
   blanches. Teach: Myomectomy can bleed heavily and quickly. Check: avoid injecting without aspiration.
11_incision.png [step.myo.incision]  Planning and making the uterine incisions: Choose the fewest incisions that reach
   all the fibroids, preferably on the anterior wall and in the midline. Keep away from the cornua and the
   interstitial tubes. Teach: Every uterine incision is a source of adhesions and a scar for a future pregnancy.
   Check: avoid separate posterior incisions when an anterior approach would reach.
12_enucleate.png [step.myo.enucleate]  Enucleating the fibroids in the pseudocapsule plane: Grasp the fibroid with a
   myoma screw or tenaculum and apply firm traction. Develop the plane with scissors, a blunt dissector or diathermy,
   pushing the myometrium away from the fibroid rather than cutting into it. Teach: Staying in the pseudocapsule plane
   separates the fibroid from the myometrium with the least bleeding and keeps the remaining muscle intact. Check:
   avoid dissecting inside the fibroid, causing bleeding and a ragged bed.
13_repair.png [step.myo.repair]  Closing the myometrium in layers: If the cavity has been entered, close the
   endometrium separately with a fine absorbable suture. Close the myometrium in one or more layers with delayed-
   absorbable sutures, placing each layer so that the whole depth is apposed and no cavity remains. Teach: A well-
   closed myometrium without dead space stops bleeding, prevents an intramural haematoma, and gives the strongest
   possible scar for a future pregnancy. Check: avoid a single superficial layer over a deep defect, leaving dead
   space.
14_blood-loss.png [step.obg.blood-loss]  Quantify blood loss and agree the next step: Measure suction volumes
   (subtracting irrigation and amniotic fluid) and weigh swabs. State the measured blood loss aloud to the
   anaesthetist and scribe before closure. Teach: Visual estimates of blood loss are consistently low. Check: avoid
   reporting an estimated rather than measured loss.
15_bailout.png [step.myo.bailout]  Bleeding that will not stop: Apply direct pressure and close the defect quickly;
   apply or tighten the tourniquet if not already in place. Tell the anaesthetist, state the measured blood loss, give
   cell-salvaged blood, and activate the major haemorrhage protocol at the local threshold. Teach: Myomectomy bleeding
   can escalate faster than expected. Check: avoid waiting to call for help until the woman is shocked.
16_haemostasis.png [step.core.haemostasis]  Common. Release the tourniquet and check the suture lines and any needle
   holes before closing.
17_specimen.png [step.core.specimen]  Common. All fibroids, counted, for histology.
18_counts.png [step.core.counts]  Common.
19_transverse-closure.png [step.obg.transverse-closure]  Closing a transverse lower abdominal incision: Close the
   rectus sheath with a continuous delayed-absorbable suture, starting just beyond each angle so the corners are
   included. Keep the lateral bites superficial to avoid catching the ilioinguinal and iliohypogastric nerves. Teach:
   The rectus sheath is what holds the abdomen. Check: avoid missing the lateral angle of the sheath.
20_skin-closure.png [step.core.skin-closure]  Common.
21_debrief.png [step.core.debrief]  Common. Record the number, size and site of fibroids, whether the cavity was
   entered, depth of myometrial repair, and the advice for future pregnancy.

C. WIDE LOCAL EXCISION WITH SENTINEL NODE BIOPSY  (folder wle-sentinel-node-biopsy/)
01_consent-check.png [step.core.consent-check]  Common.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Confirm the axilla is clinically and radiologically negative, or the MDT has agreed sentinel node biopsy
   after neoadjuvant treatment. Teach: A cancer operation is one part of a treatment plan agreed by a
   multidisciplinary team. Check: avoid accepting an MDT note that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_tracer.png [step.wle.tracer]  Sentinel node tracer: confirm and inject: Confirm the radioisotope was injected
   within the window in the nuclear medicine protocol, and check the injection record. Inject blue dye or magnetic
   tracer in the subareolar or peritumoural tissue per local protocol, and massage the breast for a few minutes.
   Teach: A dual technique (radioisotope with blue dye, or a magnetic tracer) maximises the identification rate and
   lowers the false-negative rate of sentinel node biopsy. Check: avoid injecting blue dye intradermally close to the
   skin of a planned conservation, leaving lasting staining.
08_axilla-entry.png [step.onco.axilla-entry]  Entering the axilla through the clavipectoral fascia: Identify the
   lateral border of pectoralis major and open the clavipectoral fascia just behind it. Develop the axillary fat pad
   by blunt and sharp dissection, keeping the axillary vein as the superior limit you work towards, not through. Use
   the gamma probe or magnetometer to place a short incision directly over the hottest point, low in the axilla.
   Teach: Every axillary operation, from a sentinel node biopsy to a level II clearance, starts by opening the
   clavipectoral fascia at the lateral border of pectoralis major. Check: avoid dissecting too superficially in
   subcutaneous fat rather than below the fascia.
09_sentinel.png [step.wle.sentinel]  Identifying and removing the sentinel nodes: Follow the blue lymphatic or the
   probe signal to the node; record each node's ex-vivo count. Remove every node that is hot, blue or magnetic, and
   any palpably abnormal node. Teach: The sentinel node is the first node draining the tumour. Check: avoid shine-
   through from the injection site when the probe points towards the breast in an upper outer lesion.
10_tumour-handling.png [step.onco.tumour-handling]  Oncological handling: no touch, wound protection, clean field:
   Handle the tumour-bearing tissue as little as possible; retract the specimen by its normal edges, not by the
   tumour. Control the vascular pedicle early where the operation allows it, before the tumour is mobilised. Teach:
   Tumour cells shed into the wound, the peritoneum or a port site produce a recurrence that no adjuvant therapy fully
   reverses. Check: avoid grasping the tumour with a toothed instrument to improve exposure.
11_excision.png [step.wle.excision]  Wide local excision with a planned margin: Plan the incision over the lesion,
   along Langer's lines or circumareolar, considering an oncoplastic approach for larger excisions. Excise the lesion
   with a rim of normal tissue in one piece, down to the pectoral fascia for deep tumours; do not shell out the
   tumour. Teach: The goal is clear margins with the best possible cosmetic result. Check: avoid dissecting through
   the tumour to find a wire tip.
12_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Orient before the specimen radiograph, then confirm the lesion and the localisation device
   are both within the specimen. Teach: Margin status and nodal yield are reported by the pathologist, but only from a
   specimen they can orient. Check: avoid a single suture with no stated convention.
13_cavity.png [step.wle.cavity]  Marking the cavity and restoring the breast shape: Place radio-opaque clips at the
   cavity walls (superior, inferior, medial, lateral, deep) per radiotherapy protocol. Mobilise and appose the
   glandular tissue to fill the defect where this is possible without distorting the breast. Teach: Clips mark the
   tumour bed for the radiotherapy boost. Check: avoid omitting cavity clips, so the boost volume is larger or
   misplaced.
14_haemostasis.png [step.core.haemostasis]  Common.
15_counts.png [step.core.counts]  Common.
16_specimen.png [step.core.specimen]  Common.
17_skin-closure.png [step.core.skin-closure]  Common.
18_debrief.png [step.core.debrief]  Common.

D. AXILLARY LYMPH NODE DISSECTION  (folder axillary-lymph-node-dissection/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side. Discuss lymphoedema plainly; it is the
   complication patients most regret not hearing about.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Confirm why clearance rather than no further treatment or axillary radiotherapy, and whether level III is
   to be cleared. After neoadjuvant therapy, confirm whether a clipped node must be retrieved. Teach: A cancer
   operation is one part of a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note
   that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Include the arm to the elbow in the preparation and use a
   stockinette so it can be moved during the case.
07_incision.png [step.alnd.incision]  Axillary incision below the hairline: Mark a transverse or lazy-S incision below
   the hairline, from the lateral border of pectoralis major to the anterior border of latissimus dorsi. If combined
   with a mastectomy, use the lateral end of the mastectomy incision instead. Teach: A transverse or gently curved
   incision just below the hair-bearing skin, between pectoralis major and latissimus dorsi, gives access to all
   levels with a scar that is hidden by the arm and does not contract across the axilla. Check: avoid a vertical
   incision crossing the axillary skin crease, which contracts.
08_axilla-entry.png [step.onco.axilla-entry]  Entering the axilla through the clavipectoral fascia: Identify the
   lateral border of pectoralis major and open the clavipectoral fascia just behind it. Develop the axillary fat pad
   by blunt and sharp dissection, keeping the axillary vein as the superior limit you work towards, not through.
   Teach: Every axillary operation, from a sentinel node biopsy to a level II clearance, starts by opening the
   clavipectoral fascia at the lateral border of pectoralis major. Check: avoid dissecting too superficially in
   subcutaneous fat rather than below the fascia.
09_vein-definition.png [step.alnd.vein-definition]  Define the axillary vein as the upper limit: Open the
   clavipectoral fascia along the lateral border of pectoralis major and follow it up to the axillary vein, which
   appears blue and compressible beneath a thin fascial layer. Clear the fat from the anterior and inferior surfaces
   of the vein only, without stripping its adventitia or going above it. Teach: The axillary vein is the roof of a
   standard clearance. Check: avoid mistaking a large tributary for the vein itself.
10_nerves.png [step.alnd.nerves]  Identify the long thoracic and thoracodorsal nerves before clearing the walls: Find
   the thoracodorsal bundle on subscapularis by following the subscapular vessels down from the vein, and trace it to
   latissimus dorsi; confirm the nerve with stimulation if in doubt. Find the long thoracic nerve on the medial wall
   over serratus anterior, at the level of the vein, by gently sweeping the fat forwards; it lies close to the chest
   wall in its own fascia. Teach: The long thoracic nerve stabilises the scapula and the thoracodorsal nerve powers
   latissimus dorsi. Check: avoid lifting the long thoracic nerve off serratus with the medial fat and dividing it
   with the specimen.
11_level-ii.png [step.alnd.level-ii]  Level II behind pectoralis minor, medial pectoral nerve kept: Ask the assistant
   to flex and adduct the arm slightly over the chest to relax pectoralis major and minor. Retract pectoralis minor
   medially and upwards with a narrow retractor; identify the medial pectoral nerve and vessels emerging around its
   lateral border and preserve them. Teach: Level II nodes lie behind pectoralis minor and are part of a standard
   clearance. Check: avoid dividing the medial pectoral nerve to improve exposure.
12_nodal-clearance.png [step.onco.nodal-clearance]  En bloc nodal clearance by named level or station: Before
   starting, state which levels or stations are to be cleared, as agreed at the MDT, and which non-lymphatic
   structures are to be preserved. Define the boundary structures first (vessels, nerves, muscles), then sweep the
   fibrofatty tissue off them towards the specimen, keeping the packet in one piece. Deliver levels I and II as one
   packet from the vein above, the chest wall medially and latissimus laterally, between the two preserved nerves.
   Teach: A lymphadenectomy stages the cancer and, in several cancers, controls regional disease. Check: avoid node
   picking instead of an en bloc clearance, which lowers yield and leaves disease behind.
13_major-vein-injury.png [step.onco.major-vein-injury]  Major vein injury during a nodal clearance: press, control,
   repair: Press directly on the bleeding point with a finger or a swab on a stick; tell the anaesthetist, and ask for
   head-down positioning in the neck to reduce the risk of air embolism. Call for senior help and suction, improve
   exposure, and get proximal and distal control with gentle pressure or vascular clamps placed under vision. The
   axillary vein: press, call for help and repair with fine monofilament; narrowing it causes a swollen arm. Teach:
   The axillary and internal jugular veins form the boundaries of the commonest nodal clearances. Check: avoid blind
   clamping or diathermy into a pool of blood, catching the adjacent nerve.
14_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Mark the apex (highest node at level II, or level III if cleared) with a suture. If a clipped
   node was targeted, confirm it is in the specimen by imaging. Teach: Margin status and nodal yield are reported by
   the pathologist, but only from a specimen they can orient. Check: avoid a single suture with no stated convention.
15_haemostasis.png [step.core.haemostasis]  Common. Check the vein tributaries you ligated and the lateral thoracic
   vessels with the arm returned to the side.
16_suction-drain.png [step.onco.suction-drain]  Closed suction drain for the dead space after a nodal clearance: Place
   the drain in the dependent part of the dissection bed, away from the major vessels and nerves, and bring it out
   through a separate stab wound in a site that will not be irradiated or show the scar unnecessarily. Secure it,
   confirm suction holds before the skin is fully closed, and record type, number and site. Bring the drain out below
   the incision in the mid-axillary line, away from the scar and from a future radiotherapy field where possible.
   Teach: A nodal clearance leaves a dead space that fills with serous fluid and lymph. Check: avoid a drain that has
   lost suction from an air leak at the skin, which gives false reassurance.
17_counts.png [step.core.counts]  Common.
18_specimen.png [step.core.specimen]  Common.
19_skin-closure.png [step.core.skin-closure]  Common.
20_debrief.png [step.core.debrief]  Common.

E. EXCISION OF A BENIGN BREAST LUMP (FIBROADENOMA)  (folder breast-fibroadenoma-excision/)
01_consent-check.png [step.core.consent-check]  Common. Mark the lump and the side with the patient awake, sitting and
   supine. Confirm they understand surgery for a concordant fibroadenoma is optional.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. For a benign lump the equivalent check is triple assessment: examination, imaging and core biopsy all
   concordant (benign, B2). Any discordance or a phyllodes question changes the operation. Teach: A cancer operation
   is one part of a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note that
   predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. A clean breast excision: routine antibiotic prophylaxis is usually
   not needed. Follow local policy.
05_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_incision.png [step.fad.incision]  Choose an incision that balances access and cosmesis: For a lump near the areola,
   use a circumareolar incision at the areolar margin, not extending beyond about half its circumference. For a lump
   further out, place a curvilinear incision along the skin tension lines directly over it; consider an inframammary
   or axillary approach only when it gives direct access. Teach: The scar is what the patient lives with. Check: avoid
   a periareolar incision used for a lump far from the areola, requiring long tunnelling.
08_delivery.png [step.fad.delivery]  Dissect on the pseudo-capsule and deliver the lump: Deepen through the breast
   tissue to the lump and grasp it with an Allis, Babcock or a holding suture to deliver it towards the wound. Dissect
   around it in the pseudo-capsular plane with scissors or diathermy, keeping close to the lump. Teach: A fibroadenoma
   has a natural plane of compressed tissue around it. Check: avoid fragmenting the lump by grasping it too firmly,
   which leaves pieces behind and confuses histology.
09_not-found.png [step.fad.not-found]  Lump not found or not felt on the table: stop, do not go fishing: Re-examine
   with the breast in different positions and with the retractors removed. Use intra-operative ultrasound if available
   and you are trained to use it. Teach: A small or deep lump that was palpable in clinic can be hard to feel once the
   patient is asleep and the breast is flattened. Check: avoid removing a large piece of normal breast in the hope it
   contains the lump.
10_cavity.png [step.fad.cavity]  Close or reshape the glandular defect when it would dimple: Assess the cavity size
   and the thickness of the overlying tissue after haemostasis. For a larger defect, mobilise the surrounding breast
   tissue a little off the pectoral fascia or the skin and approximate the glandular edges with a few absorbable
   sutures. Teach: A small cavity fills with seroma and settles well, but a larger defect under thin skin can pull the
   skin inwards as it heals. Check: avoid closing under tension, which distorts the breast more than the cavity would
   have.
11_haemostasis.png [step.core.haemostasis]  Common. Inspect the cavity walls and the skin edges with the retractors
   released; most breast haematomas come from a small perforator in the cavity wall.
12_counts.png [step.core.counts]  Common.
13_specimen.png [step.core.specimen]  Common. Orientation sutures are not needed for a concordant benign lump; if
   phyllodes or malignancy is a possibility, orient it as for a cancer specimen.
14_skin-closure.png [step.core.skin-closure]  Common. Subcuticular absorbable suture; the scar is the part of this
   operation the patient keeps.
15_debrief.png [step.core.debrief]  Common.

F. OPEN REPAIR OF RUPTURED ABDOMINAL AORTIC ANEURYSM  (folder open-raaa-repair/)
01_consent-check.png [step.core.consent-check]  Common. Consent is often a brief conversation with a shocked patient
   or family. Discuss the high risk of death, an open abdomen and critical care, and document it. Respect a decision
   not to proceed.
02_timeout.png [step.core.timeout]  Common. Keep it short but do it: blood availability, cell salvage, graft sizes and
   the proximal control plan are stated before induction.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the F positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Prepare and drape from the nipples to the knees, including both
   groins, BEFORE induction, with the surgeon scrubbed and the knife ready.
06_induction.png [step.raaa.induction]  Induction with the surgeon scrubbed: Confirm the surgeon is scrubbed, the
   abdomen prepped and draped, and suction and clamps on the table. Anaesthetist induces with blood running and
   vasopressors ready. Teach: Loss of sympathetic tone and abdominal wall tone at induction can turn a contained
   rupture into a free one. Check: avoid inducing in the anaesthetic room.
07_midline.png [step.abd.midline]  Midline laparotomy incision: Incise through skin, fat and linea alba, staying in
   the midline: drifting off it bleeds and weakens the closure. Enter the peritoneum between forceps under direct
   vision, then extend with fingers protecting the bowel. Xiphisternum to pubis, fast. Speed matters more than
   elegance here. Teach: The midline is fast, bloodless and extensible in both directions, which is exactly what an
   unknown pathology needs. Check: avoid entering blind through a scar.
08_proximal-control.png [step.raaa.proximal-control]  Proximal aortic control: In free rupture or a massive haematoma,
   compress the aorta at the hiatus or clamp above the coeliac axis through the lesser omentum after dividing the
   crura. Alternatively, place an aortic occlusion balloon via the femoral or brachial route, or directly through the
   sac. Teach: Survival depends on how quickly the bleeding stops. Check: avoid digging blindly into the haematoma
   looking for the neck.
09_vessel-control.png [step.vasc.vessel-control]  Proximal and distal control before opening the artery: Expose the
   artery above and below the planned arteriotomy, in healthy tissue away from haematoma or disease where possible.
   Pass slings or tapes around each vessel, including the important branches, and identify where each clamp will go
   before applying any. Iliac control from the front, or with balloon catheters from inside the sac. Avoid
   circumferential iliac dissection. Teach: An artery opened without control bleeds at arterial pressure into a field
   you can no longer see. Check: avoid clamping a heavily calcified segment, which cracks the plaque and causes a
   dissection.
10_heparin.png [step.vasc.heparin]  Systemic heparin before clamping: Agree the heparin dose with the anaesthetist per
   local protocol, and give it a few minutes before the clamps go on. Record the time and dose; check clotting (for
   example ACT) during long clamp times if the unit uses it. Systemic heparin is commonly reduced or omitted in
   rupture. Decide explicitly with the anaesthetist. Teach: Static blood beyond a clamp clots within minutes. Check:
   avoid clamping before the heparin has circulated.
11_open-sac.png [step.raaa.open-sac]  Opening the sac and controlling back-bleeding: Open the sac longitudinally to
   the right of the inferior mesenteric artery, and remove thrombus quickly with cell salvage running. Oversew
   bleeding lumbar arteries from inside the sac with figure-of-eight sutures. Teach: Lumbar and inferior mesenteric
   back-bleeding can be heavy and continue after the main clamps are on. Check: avoid opening the sac before proximal
   control is secure.
12_graft.png [step.raaa.graft]  Graft anastomoses: Choose a tube graft if the iliac arteries are not aneurysmal; a
   bifurcated graft if they are. Perform the proximal anastomosis with a continuous monofilament suture taking full-
   thickness bites of the neck, with pledgets if the wall is friable. Teach: The proximal anastomosis bears the full
   arterial pressure and is where most bleeding happens. Check: avoid shallow bites on a thin neck that pull through
   when flow returns.
13_flush-backbleed.png [step.vasc.flush-backbleed]  Flushing and back-bleeding before the final sutures: Before tying
   the last suture, release the distal clamp briefly to back-bleed, then the proximal clamp to forward-flush. Irrigate
   the lumen with heparinised saline and remove any loose thrombus or intimal flaps. Teach: Clot, air and debris left
   in the lumen go straight to the distal bed when flow is restored. Check: avoid skipping the flush to save a minute
   at the end of a long operation.
14_restore-flow.png [step.vasc.restore-flow]  Restoring flow with the anaesthetist warned: Tell the anaesthetist
   before releasing each clamp so that volume and vasopressors are ready. Release slowly, one limb or one clamp at a
   time, and be ready to reapply if the pressure falls sharply. Release one iliac limb at a time after a long clamp,
   with the anaesthetist ready. Teach: Declamping releases cold, acidic, potassium-rich blood into the circulation and
   drops the pressure suddenly. Check: avoid releasing both iliac clamps together after a long clamp time.
15_perfusion-check.png [step.vasc.perfusion-check]  Confirming distal perfusion before leaving theatre: Examine both
   feet (or hands) under the drapes: colour, capillary refill, palpable pulses, and handheld Doppler signals. Perform
   completion angiography or duplex when the result is in doubt, or routinely after embolectomy. Check both legs and
   the colour of the sigmoid colon before closing. Teach: A technically perfect anastomosis with a thrombosed or
   embolised distal bed is a failed operation. Check: avoid draping the feet out of view, so that distal ischaemia is
   found in recovery.
16_haemostasis.png [step.core.haemostasis]  Common.
17_damage-control.png [step.raaa.damage-control]  Damage control and temporary abdominal closure: If the patient is
   coagulopathic, cold or acidotic, pack the areas of diffuse bleeding and stop operating. If the fascia cannot be
   closed without tension, or the airway pressure rises on closure, use a temporary abdominal closure such as negative
   pressure. Teach: After rupture, the bowel and retroperitoneum swell and the patient is often cold, acidotic and
   coagulopathic. Check: avoid closing the abdomen because it feels like finishing the operation.
18_counts.png [step.core.counts]  Common. Packs left deliberately in an open abdomen are counted and recorded as
   retained.
19_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Only if it can be done without tension. Otherwise temporary abdominal closure.
   Teach: Burst abdomen and incisional hernia are closure failures, and closure technique is one of the few variables
   entirely under the surgeon's control. Check: avoid large bites taken quickly at the end of a long case.
20_skin-closure.png [step.core.skin-closure]  Common.
21_debrief.png [step.core.debrief]  Common.

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
  surgx-mcdonald-cerclage-steps.zip   (folder mcdonald-cerclage/)
  surgx-open-myomectomy-steps.zip   (folder open-myomectomy/)
  surgx-wle-sentinel-node-biopsy-steps.zip   (folder wle-sentinel-node-biopsy/)
  surgx-axillary-lymph-node-dissection-steps.zip   (folder axillary-lymph-node-dissection/)
  surgx-breast-fibroadenoma-excision-steps.zip   (folder breast-fibroadenoma-excision/)
  surgx-open-raaa-repair-steps.zip   (folder open-raaa-repair/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
