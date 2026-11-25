---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 16 (Subinguinal microsurgical varicocelectomy, Radical inguinal orchidectomy for testicular tumour, Pyloromyotomy, Paediatric inguinal herniotomy, Inguinal orchidopexy for undescended testis, Paediatric circumcision): Gemini image prompt (112 images, 6 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant paediatric surgeons and urologists. You are making 112 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Subinguinal microsurgical varicocelectomy                      18 images
  B. Radical inguinal orchidectomy for testicular tumour            21 images
  C. Pyloromyotomy (Ramstedt)                                       18 images
  D. Paediatric inguinal herniotomy                                 16 images
  E. Inguinal orchidopexy for undescended testis                    21 images
  F. Paediatric circumcision                                        18 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Academy of Pediatrics (AAP) Task Force on Circumcision, Male circumcision (Technical Report), Pediatrics 2012; American Academy of Pediatrics (AAP), Assessment and management of inguinal hernias in children (Clinical Report, Pediatrics 2023); American Urological Association (AUA) and American Society for Reproductive Medicine (ASRM), Diagnosis and Treatment of Infertility in Men: AUA/ASRM Guideline; American Urological Association (AUA), Evaluation and Treatment of Cryptorchidism: AUA Guideline; British Medical Association (BMA), Non-therapeutic male circumcision (NTMC) of children: practical guidance for doctors; Cochrane, Open versus laparoscopic pyloromyotomy for pyloric stenosis (Staerkle et al, CD012827); Elsevier, Campbell-Walsh-Wein Urology; Elsevier, Holcomb and Ashcraft's Pediatric Surgery: disorders of the penis and foreskin; Elsevier, Holcomb and Ashcraft's Pediatric Surgery: hypertrophic pyloric stenosis; Elsevier, Holcomb and Ashcraft's Pediatric Surgery: inguinal hernias and hydroceles; Elsevier, Holcomb and Ashcraft's Pediatric Surgery: undescended testes and testicular tumours; European Association of Urology (EAU) and European Society for Paediatric Urology (ESPU), EAU Guidelines on Paediatric Urology: phimosis; European Association of Urology (EAU) and European Society for Paediatric Urology (ESPU), EAU Guidelines on Paediatric Urology: undescended testes; European Association of Urology (EAU), EAU Guidelines on Sexual and Reproductive Health (male infertility and varicocele); European Association of Urology (EAU), EAU Guidelines on Testicular Cancer; National Comprehensive Cancer Network (NCCN), NCCN Clinical Practice Guidelines in Oncology: Testicular Cancer).
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
- A. Supine; the operating microscope positioned before draping with a sterile cover, and the surgeon seated
  comfortably.
- B. Supine; the scrotum included in the field so the testis can be pushed up into the wound.
- C. Supine on a warmed mattress. For laparoscopy, the infant is placed at the foot of the table or across it so the
  surgeon stands at the feet. Arms secured above the head or by the sides with padding.
- D. Supine with legs slightly apart, on a warmed mattress.
- E. Supine, legs slightly abducted (frog-leg in an infant) so the scrotum is accessible, on a warmed mattress.
- F. Supine, legs slightly apart, on a warmed mattress for an infant.
Step-specific facts:
- A. Anatomy: A varicocele is dilatation of the pampiniform plexus, more common on the left because the left
  testicular vein drains at right angles into the left renal vein. Must be right: Identify the testicular artery
  before ligating anything, using magnification, Doppler and topical vasodilator. Preserve the vas deferens and its
  own vessels; they become the testis's main supply if the testicular artery is lost.
- B. Anatomy: The testis drains by lymphatics along the testicular vessels to the retroperitoneal nodes at the renal
  hilum level; the scrotal skin drains to the inguinal nodes. Must be right: Inguinal approach only; never incise the
  scrotum or the tunica for a suspected tumour. Control the cord with a soft clamp at the deep ring before handling
  the testis.
- C. Anatomy: The hypertrophied pylorus is a firm olive at the gastric outlet, just right of the midline beneath the
  liver edge. The pyloric vein (of Mayo) marks the pyloroduodenal junction on the anterior surface. Must be right: Do
  not operate until the alkalosis is corrected. The myotomy must extend from the gastric antrum onto the pylorus to
  just short of the duodenal fornix. Too short leaves an obstruction; too far perforates. Test for mucosal perforation
  before closing, every time.
- D. Anatomy: The hernia sac is the patent processus vaginalis, lying anteromedial to the cord within the cremaster.
  In infants the inguinal canal is short; the internal and external rings almost overlie one another. Must be right:
  Never grasp the vas or the vessels with forceps. Handle them only with the sac or by gentle sweeping. Ligate the sac
  at the internal ring, at the level of the extraperitoneal fat. Return the testis to the scrotum at the end and
  confirm its position.
- E. Anatomy: The testis descends behind the processus vaginalis; when the processus stays patent it lies anteromedial
  to the cord and must be separated from it to gain length. Must be right: Re-examine under anaesthesia: the operation
  depends on where the testis is now, not where it was in clinic. Never grasp the vas or the vessels with forceps;
  handle the testis by the gubernaculum or tunica.
- F. Anatomy: The prepuce has an outer skin layer and an inner mucosal layer that meet at the preputial ring; in young
  boys the inner layer is physiologically adherent to the glans. Must be right: Stop if the anatomy is abnormal: a
  hooded prepuce or a ventral defect means hypospadias until proven otherwise. Bipolar diathermy only. Monopolar
  current concentrated in the penile shaft can cause catastrophic tissue necrosis.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 112 images)
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

A. SUBINGUINAL MICROSURGICAL VARICOCELECTOMY  (folder uro-varicocelectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the indication meets the guideline criteria (clinical
   varicocele with abnormal semen parameters, or adolescent growth failure, or pain) and record it.
02_scrotal-imaging-check.png [step.uro.scrotal-imaging-check]  Scrotal ultrasound and examination reviewed before
   incision: Review the scrotal ultrasound yourself: both testes seen and described, the lesion characterised, and the
   contralateral testis normal or its abnormality noted. Examine the patient awake: side, the testis felt separately
   from the swelling where possible, and the cord. Confirm the grade, testicular volumes and semen results; a right-
   sided or non-decompressing varicocele needs abdominal imaging first. Teach: A hydrocele, a varicocele or a 'benign'
   swelling can hide a testicular tumour, and the operation planned for a benign lesion is the wrong one for a cancer.
   Check: avoid operating on an adult hydrocele through the scrotum without an ultrasound of the testis behind it.
03_timeout.png [step.core.timeout]  Common. Check the microscope, Doppler and papaverine or lidocaine are in the room
   before incision.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_incision.png [step.vari.incision]  Subinguinal incision over the external ring: Palpate the external ring and make
   a short transverse or oblique incision just below it. Divide Camper's and Scarpa's fascia, controlling the
   superficial external pudendal vessels. Teach: The subinguinal approach avoids opening the external oblique
   aponeurosis, which means less pain and faster recovery, at the cost of more veins and smaller arteries at this
   level; the microscope makes that trade worthwhile. Check: avoid an incision placed too low on the scrotum, where
   the cord is less well defined.
08_cord-delivery.png [step.uro.cord-delivery]  Delivering and isolating the spermatic cord: Identify the cord at the
   external ring or in the opened canal and pass a finger or a right-angle around it close to the pubic tubercle,
   keeping the dissection on the cord. Lift the cord on a soft sling, a Penrose drain or a tape, and confirm that all
   of it is encircled. At the subinguinal level, lift the cord through the wound on a sling, below the external ring;
   the canal is not opened. Teach: Every inguinal or subinguinal cord operation depends on lifting the whole cord
   cleanly into the wound. Check: avoid leaving a strand of cord or cremaster outside the sling, with veins or tumour
   in it.
09_open-fascia.png [step.vari.open-fascia]  Open the cord fasciae under the microscope: Bring the microscope in and
   open the external spermatic fascia and cremaster longitudinally. Identify the vas with its vessels and keep it
   separate, outside the dissection, throughout. Teach: The veins, artery and lymphatics lie inside the internal
   spermatic fascia. Check: avoid bringing the vas into the dissection compartment and ligating its vessels.
10_artery.png [step.vari.artery]  Identify and protect the testicular artery: Apply topical papaverine or plain
   lidocaine to dilate the artery and reverse spasm. Look for pulsation under magnification and confirm with the
   micro-Doppler. Teach: Loss of the testicular artery can cause atrophy of the very testis the operation is meant to
   help. Check: avoid relying on visible pulsation alone when the artery is in spasm.
11_lymphatics.png [step.vari.lymphatics]  Identify and preserve the lymphatics: Look for thin, clear, non-pulsatile
   channels with no blood within them; under magnification some show valves. Separate them from the veins and protect
   them. Teach: Lymphatic ligation is the main cause of hydrocele after varicocelectomy. Check: avoid ligating
   collapsed small veins and lymphatics together in one bundle.
12_veins.png [step.vari.veins]  Ligate and divide the internal spermatic veins: Ligate each internal spermatic vein
   individually with fine ties or clips and divide it, with the artery and lymphatics held clear on their loops.
   Dissect the small veins adherent to the artery off it and ligate them separately. Teach: Every internal spermatic
   vein left patent can carry reflux and cause persistence or recurrence; every artery or lymphatic caught causes
   harm. Check: avoid mass ligation of a bundle containing an artery.
13_external-veins.png [step.vari.external-veins]  External spermatic and cremasteric veins: Inspect the cremasteric
   layer and the floor of the cord for dilated external spermatic veins. Ligate and divide dilated veins, avoiding the
   vas and its vessels and the genital nerve. Teach: Dilated veins outside the internal spermatic fascia can maintain
   the varicocele. Check: avoid including the vas or its vessels when taking cremasteric veins at the floor of the
   cord.
14_artery-bailout.png [step.vari.artery-bailout]  Artery not found, or injured: If the artery cannot be identified
   with confidence despite vasodilator and Doppler, ligate only vessels that are unequivocally veins and leave the
   rest. If the artery is injured, consider microsurgical repair if skills allow; otherwise rely on collateral supply
   from the deferential and cremasteric arteries, which is why the vas and its vessels are preserved. Teach: The
   operation is elective and for fertility or comfort; it must not cost the testis. Check: avoid completing a full
   ligation 'to avoid recurrence' with the artery not identified.
15_haemostasis.png [step.core.haemostasis]  Common.
16_counts.png [step.core.counts]  Common.
17_skin-closure.png [step.core.skin-closure]  Common. Close Scarpa's fascia and skin with absorbable sutures; local
   anaesthetic infiltration to the wound.
18_debrief.png [step.core.debrief]  Common. Record arteries, lymphatics and vas preserved, the number of veins
   ligated, and the semen analysis plan.

B. RADICAL INGUINAL ORCHIDECTOMY FOR TESTICULAR TUMOUR  (folder uro-inguinal-orchidectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm side with the patient and the ultrasound; record that
   sperm banking and a prosthesis were offered and the patient's decision.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Markers drawn before the knife; staging planned or done; the operation is not delayed for staging. Teach:
   A cancer operation is one part of a treatment plan agreed by a multidisciplinary team. Check: avoid accepting an
   MDT note that predates new imaging or a changed biopsy result.
03_scrotal-imaging-check.png [step.uro.scrotal-imaging-check]  Scrotal ultrasound and examination reviewed before
   incision: Review the scrotal ultrasound yourself: both testes seen and described, the lesion characterised, and the
   contralateral testis normal or its abnormality noted. Examine the patient awake: side, the testis felt separately
   from the swelling where possible, and the cord. Review the contralateral testis: a lesion there changes the plan.
   Teach: A hydrocele, a varicocele or a 'benign' swelling can hide a testicular tumour, and the operation planned for
   a benign lesion is the wrong one for a cancer. Check: avoid operating on an adult hydrocele through the scrotum
   without an ultrasound of the testis behind it.
04_timeout.png [step.core.timeout]  Common.
05_prophylaxis.png [step.core.prophylaxis]  Common. Prophylaxis per local policy, particularly if a prosthesis is to
   be inserted.
06_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common. Include the scrotum in the field.
08_incision.png [step.orch.incision]  Inguinal incision and opening of the canal: Make an incision in the groin crease
   above and parallel to the inguinal ligament, from over the deep ring towards the pubic tubercle. Divide Camper's
   and Scarpa's fascia and expose the external oblique aponeurosis and the superficial ring. Teach: The inguinal
   approach reaches the cord at the deep ring, where it can be controlled and ligated high, and keeps the scrotum
   untouched. Check: avoid opening the aponeurosis with a deep cut that divides the nerve beneath.
09_cord-delivery.png [step.uro.cord-delivery]  Delivering and isolating the spermatic cord: Identify the cord at the
   external ring or in the opened canal and pass a finger or a right-angle around it close to the pubic tubercle,
   keeping the dissection on the cord. Lift the cord on a soft sling, a Penrose drain or a tape, and confirm that all
   of it is encircled. Here the canal is opened, the cord is lifted at the pubic tubercle, and the ilioinguinal nerve
   is protected out of the way. Teach: Every inguinal or subinguinal cord operation depends on lifting the whole cord
   cleanly into the wound. Check: avoid leaving a strand of cord or cremaster outside the sling, with veins or tumour
   in it.
10_cord-clamp.png [step.orch.cord-clamp]  Early cord control at the deep ring: Dissect the cord up to the deep ring.
   Apply a soft non-crushing clamp or a tightened rubber sling across the whole cord at the deep ring. Teach: Clamping
   the cord before the testis is handled closes the venous and lymphatic exit from the tumour while it is being
   manipulated, which is the oncological principle of the operation. Check: avoid pulling the testis up into the wound
   to find the cord, before it is clamped.
11_tumour-handling.png [step.onco.tumour-handling]  Oncological handling: no touch, wound protection, clean field:
   Handle the tumour-bearing tissue as little as possible; retract the specimen by its normal edges, not by the
   tumour. Control the vascular pedicle early where the operation allows it, before the tumour is mobilised. The
   testis is never squeezed or incised; it is handled through its coverings. Teach: Tumour cells shed into the wound,
   the peritoneum or a port site produce a recurrence that no adjuvant therapy fully reverses. Check: avoid grasping
   the tumour with a toothed instrument to improve exposure.
12_deliver.png [step.orch.deliver]  Deliver the testis from the scrotum: Invaginate the scrotum with a hand from below
   to push the testis up the cord into the wound, while gentle traction is applied on the cord. Divide the
   gubernacular attachment with diathermy, staying close to the testis and away from the scrotal skin. Teach: The
   testis comes up into the groin wound within its coverings. Check: avoid diathermy through the scrotal skin while
   dividing the gubernaculum.
13_doubt-bailout.png [step.orch.doubt-bailout]  Diagnostic doubt or solitary testis: inguinal exploration and frozen
   section: With the cord clamped and the field isolated with packs, open the tunica vaginalis and inspect the testis.
   Excise the lesion for frozen section where testis-sparing surgery is being considered, with the agreement of the
   patient in advance. Teach: Not every testicular lesion is malignant, and in a solitary testis or bilateral disease
   every millimetre of testis matters. Check: avoid opening the testis without cord control or field isolation.
14_high-ligation.png [step.orch.high-ligation]  High ligation and division of the cord: Separate the vas from the
   vessels at the deep ring. Ligate the vas and the vessels separately, transfixing the vascular bundle, with non-
   absorbable ligatures. Teach: The cord is the first route of spread. Check: avoid a single mass ligature on a bulky
   cord that slips once it retracts.
15_prosthesis.png [step.orch.prosthesis]  Testicular prosthesis, if chosen: Change gloves and confirm the size with
   the patient's earlier choice. Place the prosthesis in the scrotum through the inguinal wound, low in the cavity.
   Teach: Many men value a prosthesis, and it is easier to place at the time of orchidectomy. Check: avoid placing a
   prosthesis into a cavity contaminated by a breached tumour or a haematoma.
16_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Send the testis and cord intact with the cord end marked; never bivalve it in theatre. Teach:
   Margin status and nodal yield are reported by the pathologist, but only from a specimen they can orient. Check:
   avoid a single suture with no stated convention.
17_haemostasis.png [step.core.haemostasis]  Common. Inspect the scrotal cavity and the cord stump; scrotal haematoma
   and retroperitoneal bleeding from the stump are the important bleeds.
18_canal-closure.png [step.orch.canal-closure]  Close the external oblique with the nerve protected: Lay the
   ilioinguinal nerve back on the floor of the canal and keep it in view. Close the external oblique aponeurosis with
   a continuous absorbable suture, recreating the superficial ring without narrowing it. Teach: The aponeurosis is the
   strength layer of the groin; closing it restores the canal and, done carelessly, entraps the ilioinguinal nerve in
   the suture line. Check: avoid catching the nerve in the closure and causing chronic groin pain.
19_counts.png [step.core.counts]  Common.
20_skin-closure.png [step.core.skin-closure]  Common.
21_debrief.png [step.core.debrief]  Common. Record the level of ligation, the marker suture, prosthesis details if
   inserted, and the plan for post-operative markers and MDT.

C. PYLOROMYOTOMY (RAMSTEDT)  (folder pyloromyotomy/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_physiology-gate.png [step.paeds.physiology-gate]  Paediatric physiology check before anaesthesia: Confirm today's
   weight and that drug and fluid doses on the chart are calculated from it. Review the latest electrolytes, gas and
   glucose against the agreed criteria for this operation. Chloride and bicarbonate within the agreed criteria. If
   not, cancel and keep correcting. Teach: Infants decompensate quickly and tolerate an uncorrected metabolic, glucose
   or temperature problem badly. Check: avoid proceeding because the list is booked when the bloods do not meet the
   agreed criteria.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic per local paediatric policy. Pharmacological
   thromboprophylaxis does not apply in infants.
05_warming.png [step.paeds.warming]  Thermal care for the infant: Warm the theatre before the infant arrives, and use
   a forced-air warmer or warming mattress. Cover the head and limbs and expose only the operative field. Teach:
   Infants have a large surface area for their mass and little subcutaneous fat. Check: avoid prolonged exposure
   during positioning and draping while the team waits.
06_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common.
08_local-anaesthetic.png [step.paeds.local-anaesthetic]  Weight-based local anaesthetic infiltration: Agree the agent,
   concentration and maximum dose by weight with the anaesthetist before infiltration, and record it. Aspirate before
   injecting and infiltrate slowly. Teach: Wound infiltration or a regional block reduces opioid need, and opioids
   increase the risk of post-operative apnoea in infants. Check: avoid the anaesthetist gives a caudal block and the
   surgeon infiltrates a further full dose without either knowing.
09_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Open
   umbilical entry in an infant. Use the lowest insufflation pressure and flow that give a view, agreed with the
   anaesthetist. For an open operation, use a right upper quadrant transverse or circumumbilical incision instead.
   Teach: Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
10_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Working instruments through stab incisions in the right and left upper quadrants, without ports
   where possible. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
11_expose.png [step.pyl.expose]  Exposing and stabilising the pylorus: Identify the pylorus beneath the liver edge;
   lift the liver gently if needed. Grasp the duodenum just distal to the pylorus (laparoscopic) or deliver the
   pylorus into the wound (open), holding it between finger and thumb. Teach: A stable, well-presented pylorus makes
   the myotomy controlled. Check: avoid grasping the duodenum too firmly and causing a serosal tear.
12_myotomy.png [step.pyl.myotomy]  Seromuscular incision and spreading: Incise the serosa and superficial muscle
   longitudinally on the avascular surface, from the antrum to just short of the pyloroduodenal junction. Spread the
   muscle with a pyloric spreader until the submucosa bulges into the gap along the whole length. Teach: The operation
   relieves the obstruction by dividing every hypertrophied muscle fibre while leaving the mucosa intact. Check: avoid
   spreading at the duodenal end with force, which tears the fornix.
13_leak-test.png [step.pyl.leak-test]  Testing mucosal integrity: Ask the anaesthetist to insufflate air through the
   nasogastric tube while the duodenum is occluded distally. Look for bubbles or bile at the myotomy, particularly at
   the duodenal end. Teach: A perforation repaired now is a minor event; a perforation discovered on day two is
   peritonitis in an infant. Check: avoid omitting the test in a myotomy that 'looked fine'.
14_haemostasis.png [step.core.haemostasis]  Common. Ooze from the cut muscle edges stops once the pylorus is returned;
   do not diathermy near the mucosa.
15_counts.png [step.core.counts]  Common.
16_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
17_skin-closure.png [step.core.skin-closure]  Common.
18_debrief.png [step.core.debrief]  Common.

D. PAEDIATRIC INGUINAL HERNIOTOMY  (folder paeds-herniotomy/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side with the child awake and the parent present.
   Bilateral hernias are common; confirm what was consented.
02_timeout.png [step.core.timeout]  Common.
03_physiology-gate.png [step.paeds.physiology-gate]  Paediatric physiology check before anaesthesia: Confirm today's
   weight and that drug and fluid doses on the chart are calculated from it. Review the latest electrolytes, gas and
   glucose against the agreed criteria for this operation. Gestation and post-menstrual age decide the apnoea
   monitoring plan. Teach: Infants decompensate quickly and tolerate an uncorrected metabolic, glucose or temperature
   problem badly. Check: avoid proceeding because the list is booked when the bloods do not meet the agreed criteria.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotics are not routinely needed for a clean elective
   herniotomy; follow local policy.
05_warming.png [step.paeds.warming]  Thermal care for the infant: Warm the theatre before the infant arrives, and use
   a forced-air warmer or warming mattress. Cover the head and limbs and expose only the operative field. Teach:
   Infants have a large surface area for their mass and little subcutaneous fat. Check: avoid prolonged exposure
   during positioning and draping while the team waits.
06_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common. Include the scrotum in the field so the testis can be checked and
   repositioned.
08_local-anaesthetic.png [step.paeds.local-anaesthetic]  Weight-based local anaesthetic infiltration: Agree the agent,
   concentration and maximum dose by weight with the anaesthetist before infiltration, and record it. Aspirate before
   injecting and infiltrate slowly. Coordinate with any caudal or ilioinguinal block already given. Teach: Wound
   infiltration or a regional block reduces opioid need, and opioids increase the risk of post-operative apnoea in
   infants. Check: avoid the anaesthetist gives a caudal block and the surgeon infiltrates a further full dose without
   either knowing.
09_access.png [step.hern.access]  Skin crease incision and opening the canal: Make a short incision in the lowest
   inguinal skin crease over the internal ring. Divide Scarpa fascia and identify the external oblique aponeurosis and
   external ring. Teach: In an infant the rings nearly overlie each other, so the sac can often be reached through the
   external ring without opening the aponeurosis, minimising dissection around the cord. Check: avoid making the
   incision too low, over the external ring in an older child, which hinders high ligation.
10_sac.png [step.hern.sac]  Separating the sac from the vas and vessels: Lift the cremaster and identify the sac on
   the anteromedial aspect of the cord. Gently sweep the vas and vessels off the posterior surface of the sac with
   fine non-toothed instruments. Teach: This is the step that decides fertility and testicular viability. Check: avoid
   grasping the vas with forceps.
11_ligate.png [step.hern.ligate]  High ligation of the sac: Twist the sac to reduce any contents and confirm it is
   empty. Transfix and ligate the neck at the level of the internal ring with an absorbable suture. Teach: Recurrence
   after herniotomy is usually a residual sac. Check: avoid ligating too low, below the internal ring.
12_haemostasis.png [step.core.haemostasis]  Common.
13_testis.png [step.hern.testis]  Returning the testis to the scrotum: Gently pull the testis down into the scrotum at
   the end of the procedure. Confirm by palpation that it lies in the scrotum before the drapes come off. Teach:
   Traction during dissection often draws the testis up into the canal. Check: avoid forgetting to check after a
   difficult dissection.
14_counts.png [step.core.counts]  Common.
15_skin-closure.png [step.core.skin-closure]  Common. Subcuticular absorbable suture or tissue adhesive in a nappy
   area.
16_debrief.png [step.core.debrief]  Common.

E. INGUINAL ORCHIDOPEXY FOR UNDESCENDED TESTIS  (folder paeds-orchidopexy/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side with a parent present. Confirm whether the
   opposite testis is normal and what has been consented for a non-viable testis.
02_timeout.png [step.core.timeout]  Common.
03_physiology-gate.png [step.paeds.physiology-gate]  Paediatric physiology check before anaesthesia: Confirm today's
   weight and that drug and fluid doses on the chart are calculated from it. Review the latest electrolytes, gas and
   glucose against the agreed criteria for this operation. Today's weight for analgesia and local anaesthetic doses;
   gestation for any infant under the local apnoea age threshold. Teach: Infants decompensate quickly and tolerate an
   uncorrected metabolic, glucose or temperature problem badly. Check: avoid proceeding because the list is booked
   when the bloods do not meet the agreed criteria.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotics are not routinely needed for a clean groin operation;
   follow local policy.
05_warming.png [step.paeds.warming]  Thermal care for the infant: Warm the theatre before the infant arrives, and use
   a forced-air warmer or warming mattress. Cover the head and limbs and expose only the operative field. Teach:
   Infants have a large surface area for their mass and little subcutaneous fat. Check: avoid prolonged exposure
   during positioning and draping while the team waits.
06_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
07_eua.png [step.orch.eua]  Examination under anaesthesia confirms the plan: Before preparation, examine both sides
   with warm hands, milking from the anterior superior iliac spine towards the scrotum. If the testis reaches the
   bottom of the scrotum without tension and stays there, it is retractile: do not proceed with orchidopexy. Teach:
   Under anaesthesia a retractile testis may come down fully, and a testis felt in clinic may become impalpable.
   Check: avoid operating on a retractile testis because the child is already asleep.
08_prep-drape.png [step.core.prep-drape]  Common. Include the scrotum and both groins in the field.
09_local-anaesthetic.png [step.paeds.local-anaesthetic]  Weight-based local anaesthetic infiltration: Agree the agent,
   concentration and maximum dose by weight with the anaesthetist before infiltration, and record it. Aspirate before
   injecting and infiltrate slowly. Count any caudal or ilioinguinal block already given against the single maximum
   dose. Teach: Wound infiltration or a regional block reduces opioid need, and opioids increase the risk of post-
   operative apnoea in infants. Check: avoid the anaesthetist gives a caudal block and the surgeon infiltrates a
   further full dose without either knowing.
10_access.png [step.orch.access]  Groin crease incision and finding the testis: Make a short incision in the lower
   inguinal skin crease over the internal ring. Divide Scarpa fascia carefully and look for the testis in the
   superficial pouch before going deeper. Teach: Many palpable undescended testes lie in the superficial inguinal
   pouch, outside the canal. Check: avoid cutting through Scarpa fascia boldly onto a superficially placed testis.
11_mobilise.png [step.orch.mobilise]  Mobilising the testis and dividing the gubernaculum: Grasp the gubernaculum or
   the tunica, never the testis or cord, and free the testis from its attachments. Identify the vas before dividing
   the gubernaculum close to the lower pole with bipolar diathermy. Teach: The gubernaculum and cremaster tether the
   testis. Check: avoid dividing the gubernaculum before seeing the vas.
12_processus.png [step.orch.processus]  Separating and ligating the patent processus vaginalis: Open the processus
   anteriorly and identify the vas and vessels on its posterior wall. Separate the processus from the cord structures
   with fine non-toothed instruments, sweeping the vas and vessels away rather than grasping them. Teach: The patent
   processus is both a hernia sac and the main tether shortening the cord. Check: avoid tearing a thin processus and
   losing its proximal end.
13_length.png [step.orch.length]  Gaining length on the vessels: Retract the internal ring upwards and free the
   lateral peritoneal bands from the testicular vessels in the retroperitoneum. Test whether the testis reaches the
   bottom of the scrotum without tension. Teach: A testis fixed under tension retracts or becomes atrophic. Check:
   avoid accepting a testis that only reaches the upper scrotum under traction.
14_bailout.png [step.orch.bailout]  When the testis will not reach, or is not viable: If length is insufficient after
   full mobilisation, fix the testis at the lowest point it reaches without tension and plan a second-stage operation
   after an interval agreed by the consultant. If only a small remnant (nubbin) at the end of blind-ending vas and
   vessels is found, excise it and send it for histology. Teach: Forcing an inadequate cord into the scrotum risks
   losing the testis. Check: avoid dividing the testicular vessels in an unplanned open operation.
15_dartos-pouch.png [step.orch.dartos-pouch]  Placing the testis in a subdartos pouch: Make a transverse incision in
   the scrotal skin and develop a pouch between skin and dartos with blunt dissection. Pass a clamp up through the
   dartos into the groin and draw the testis down by the gubernaculum remnant, keeping the cord in its natural
   orientation. Teach: A pouch between the scrotal skin and the dartos holds the testis in the scrotum without sutures
   through it. Check: avoid twisting the cord as the testis is pulled through.
16_haemostasis.png [step.core.haemostasis]  Common. Bipolar diathermy near the cord; a scrotal haematoma can compress
   the newly placed testis.
17_specimen.png [step.core.specimen]  Common. Usually none. A non-viable remnant (nubbin) that is excised is sent for
   histology.
18_counts.png [step.core.counts]  Common.
19_skin-closure.png [step.core.skin-closure]  Common. Close the external oblique aponeurosis without narrowing the
   ring around the cord, then Scarpa fascia, then absorbable subcuticular sutures to groin and scrotum.
20_daycase-discharge.png [step.paeds.daycase-discharge]  Day-case discharge criteria and parent instructions: Confirm
   the child is awake, drinking, comfortable on a weight-based analgesia plan, and that the wound is dry before
   discharge. Confirm the child has passed urine, or that the family knows exactly what to do if the child has not
   passed urine within the time agreed locally. Teach: Most complications of day-case genital surgery in children,
   such as bleeding, urinary retention and wound infection, declare themselves after the family has gone home. Check:
   avoid instructions given only verbally to a tired parent at the end of the day.
21_debrief.png [step.core.debrief]  Common. Record the pre-operative position, testis size and appearance, final
   position, and any plan for a second stage.

F. PAEDIATRIC CIRCUMCISION  (folder paeds-circumcision/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the indication, that the consent is from a person with
   parental responsibility, and for non-therapeutic circumcision that the legal and professional requirements are met.
02_timeout.png [step.core.timeout]  Common.
03_physiology-gate.png [step.paeds.physiology-gate]  Paediatric physiology check before anaesthesia: Confirm today's
   weight and that drug and fluid doses on the chart are calculated from it. Review the latest electrolytes, gas and
   glucose against the agreed criteria for this operation. Confirm the bleeding history was asked and any haematology
   plan is in place. Teach: Infants decompensate quickly and tolerate an uncorrected metabolic, glucose or temperature
   problem badly. Check: avoid proceeding because the list is booked when the bloods do not meet the agreed criteria.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotics are not routinely needed; follow local policy.
05_positioning.png [step.core.positioning]  Teach and Check: the F positioning facts exactly.
06_anatomy-check.png [step.circ.anatomy-check]  Anatomy check: stop if circumcision is wrong for this penis: Before
   any incision, look at the meatal position, the ventral prepuce and the shaft with the child asleep. A hooded
   prepuce with a deficient ventral foreskin, a ventral meatus, chordee, a buried or webbed penis, or a megaprepuce
   means stop. Teach: The foreskin is the tissue a hypospadias or buried penis repair depends on. Check: avoid
   assuming the clinic examination was complete.
07_prep-drape.png [step.core.prep-drape]  Common. Aqueous antiseptic on genital skin per local policy; let it dry
   before any diathermy.
08_local-anaesthetic.png [step.paeds.local-anaesthetic]  Weight-based local anaesthetic infiltration: Agree the agent,
   concentration and maximum dose by weight with the anaesthetist before infiltration, and record it. Aspirate before
   injecting and infiltrate slowly. Dorsal penile or ring block, or a caudal, with plain local anaesthetic only: never
   with adrenaline. Teach: Wound infiltration or a regional block reduces opioid need, and opioids increase the risk
   of post-operative apnoea in infants. Check: avoid the anaesthetist gives a caudal block and the surgeon infiltrates
   a further full dose without either knowing.
09_adhesiolysis.png [step.circ.adhesiolysis]  Freeing the inner prepuce from the glans: Gently dilate the preputial
   opening with fine artery forceps. Retract the foreskin and separate the inner layer from the glans with a blunt
   probe, sweeping circumferentially down to the coronal sulcus. Teach: The inner prepuce is adherent to the glans in
   young boys. Check: avoid forcing a scarred lichen sclerosus ring and tearing it; a dorsal slit first is safer.
10_marking.png [step.circ.marking]  Marking the outer and inner incisions: With the foreskin lying in its natural
   position over the glans, mark the outer skin circumferentially at the level of the corona. Retract the foreskin and
   mark the inner layer a short distance proximal to the coronal sulcus, leaving a narrow cuff, following the V of the
   frenulum ventrally. Teach: Most cosmetic complaints and concealed penis follow excessive or uneven skin removal.
   Check: avoid marking with the skin stretched forward, which removes too much shaft skin.
11_excision.png [step.circ.excision]  Excising the prepuce with the glans protected: Incise the outer and inner marks
   superficially, through skin only, and excise the sleeve of prepuce between them with fine scissors, staying
   superficial to Buck fascia. If using a dorsal slit, place the scissor blade under the foreskin only after the glans
   is freed and the tip is seen to be in the preputial space. Teach: Glans injury and amputation are the catastrophic
   complications of circumcision, and they happen when the glans is not seen at the moment of cutting. Check: avoid
   cutting across a clamp without seeing the glans.
12_frenulum.png [step.circ.frenulum]  Securing the frenular artery: Identify the frenular artery in the ventral V and
   coagulate it precisely with bipolar, or ligate it with a fine absorbable suture. Place the ventral approximating
   suture superficially, taking skin and mucosa only. Teach: The frenular artery is the usual source of bleeding after
   circumcision, and it lies over the urethra. Check: avoid a deep figure-of-eight suture that catches the urethra.
13_haemostasis.png [step.core.haemostasis]  Common. Bipolar diathermy only, on precisely identified vessels. Check the
   frenular area last and with the penis in its natural position.
14_skin-closure.png [step.core.skin-closure]  Common. Place fine absorbable interrupted sutures at 12, 6, 3 and 9
   o'clock to align outer skin to inner mucosa, then fill between, without tension or overlap.
15_specimen.png [step.core.specimen]  Common. Send the foreskin for histology when lichen sclerosus is suspected, and
   otherwise per local policy.
16_counts.png [step.core.counts]  Common.
17_daycase-discharge.png [step.paeds.daycase-discharge]  Day-case discharge criteria and parent instructions: Confirm
   the child is awake, drinking, comfortable on a weight-based analgesia plan, and that the wound is dry before
   discharge. Confirm the child has passed urine, or that the family knows exactly what to do if the child has not
   passed urine within the time agreed locally. Teach: Most complications of day-case genital surgery in children,
   such as bleeding, urinary retention and wound infection, declare themselves after the family has gone home. Check:
   avoid instructions given only verbally to a tired parent at the end of the day.
18_debrief.png [step.core.debrief]  Common. Record the meatal appearance and any meatal procedure.

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
  surgx-uro-varicocelectomy-steps.zip   (folder uro-varicocelectomy/)
  surgx-uro-inguinal-orchidectomy-steps.zip   (folder uro-inguinal-orchidectomy/)
  surgx-pyloromyotomy-steps.zip   (folder pyloromyotomy/)
  surgx-paeds-herniotomy-steps.zip   (folder paeds-herniotomy/)
  surgx-paeds-orchidopexy-steps.zip   (folder paeds-orchidopexy/)
  surgx-paeds-circumcision-steps.zip   (folder paeds-circumcision/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
