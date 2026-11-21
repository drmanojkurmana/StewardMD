---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 13 (Splenectomy: trauma and elective, Laparoscopic anterior resection with total mesorectal excision, Pancreaticoduodenectomy, Right hepatectomy, Modified radical neck dissection): Gemini image prompt (108 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant general and colorectal surgeons and surgical oncologists. You are making 108 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Splenectomy: trauma and elective                               20 images
  B. Laparoscopic anterior resection with total mesorectal excision 22 images
  C. Pancreaticoduodenectomy (Whipple)                              22 images
  D. Right hepatectomy                                              22 images
  E. Modified radical neck dissection                               22 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Head and Neck Society and American Academy of Otolaryngology-Head and Neck Surgery, Neck dissection classification update: revisions proposed by the American Head and Neck Society and the American Academy of Otolaryngology-Head and Neck Surgery (Robbins KT et al., Arch Otolaryngol Head Neck Surg); American Society of Colon and Rectal Surgeons (ASCRS), The American Society of Colon and Rectal Surgeons Clinical Practice Guidelines for the Management of Rectal Cancer (You YN et al., Dis Colon Rectum); Annals of Surgery, Notes on the arrest of hepatic hemorrhage due to trauma (Pringle JH); Archives of Otolaryngology-Head and Neck Surgery, Consensus statement on the classification and terminology of neck dissection (Robbins KT et al.); British Committee for Standards in Haematology (BCSH), Review of guidelines for the prevention and treatment of infection in patients with an absent or dysfunctional spleen (Davies JM et al., Br J Haematol); British Journal of Surgery, The mesorectum in rectal cancer surgery: the clue to pelvic recurrence?).
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
- A. Trauma: supine, arms out, prepared from nipples to knees for a full trauma laparotomy. Elective open: supine with
  a sandbag or bolster under the left side.
- B. Modified Lloyd-Davies with legs in padded stirrups, thighs nearly flat so they do not obstruct the instruments;
  buttocks just over the end of the table for transanal access.
- C. Supine, arms out, with a thoracic epidural or alternative analgesia per the anaesthetic plan. Arterial line,
  central venous access, urinary catheter, warming and calf compression for a long operation. Slight reverse
  Trendelenburg; prepare from nipples to pubis.
- D. Supine, arms out, slight reverse Trendelenburg, with a bolster under the right side if helpful. Arterial and
  central venous lines, urinary catheter, warming, calf compression; epidural or alternative analgesia per anaesthetic
  plan.
- E. Supine with a shoulder roll, head on a ring, turned away from the side of dissection, slight reverse
  Trendelenburg. Arm on the operated side tucked and the shoulder pulled gently down to open the posterior triangle,
  without traction on the brachial plexus.
Step-specific facts:
- A. Anatomy: The spleen lies in the left upper quadrant behind ribs 9 to 11, held by the splenorenal (lienorenal)
  ligament containing the splenic vessels and the tail of the pancreas, the gastrosplenic ligament containing the
  short gastric vessels, and the splenocolic and splenophrenic attachments. Must be right: Mobilise the spleen fully
  (divide its lateral and posterior attachments) and bring it forwards into the wound before attempting to control the
  hilum.
- B. Anatomy: The mesorectum is the fatty envelope of the rectum containing its lymphatics and vessels, wrapped by the
  mesorectal (visceral) fascia. The areolar 'holy plane' lies between it and the parietal (presacral) fascia. Must be
  right: Identify the left ureter before dividing the inferior mesenteric pedicle. Stay in the holy plane: inside it
  the specimen is intact and the nerves are safe; behind the presacral fascia lie the veins and nerves.
- C. Anatomy: The head and uncinate process of the pancreas lie in the C-loop of the duodenum, wrapped around the
  superior mesenteric vein and to the right of the superior mesenteric artery. Must be right: Establish resectability
  (liver, peritoneum, vessels) before any irreversible step. Before dividing the gastroduodenal artery, test-clamp it
  and confirm a hepatic artery pulse (coeliac stenosis may make the liver depend on it).
- D. Anatomy: Couinaud's functional anatomy: the right hemiliver is segments 5 to 8, separated from the left by the
  plane of the middle hepatic vein (Cantlie's line, from the gallbladder fossa to the inferior vena cava). Must be
  right: Confirm the plan on intra-operative ultrasound before any division. Before ligating the right inflow, confirm
  the left portal vein and left hepatic artery supply the remnant (test clamp).
- E. Anatomy: Levels: Ia submental and Ib submandibular triangles; II upper jugular (skull base to hyoid), divided by
  the accessory nerve into IIa (anterior) and IIb (posterior); III mid jugular (hyoid to cricoid); IV lower jugular
  (cricoid to clavicle); V posterior triangle, between the posterior border of sternocleidomastoid and the anterior
  border of trapezius, split by the cricoid level into Va and Vb. Must be right: Identify the accessory nerve in level
  II and at the posterior border of sternocleidomastoid before clearing levels II and V; confirm with the stimulator.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 108 images)
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

A. SPLENECTOMY: TRAUMA AND ELECTIVE  (folder splenectomy/)
01_consent-check.png [step.core.consent-check]  Common. Elective: confirm the vaccines were given at least two weeks
   ago. Trauma: consent may be brief, but record lifelong infection risk for later discussion.
02_timeout.png [step.core.timeout]  Common. State blood availability, cell saver, and the plan if the spleen cannot be
   salvaged. In trauma, keep it short but do it.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Trauma: nipples to knees.
06_midline.png [step.abd.midline]  Midline laparotomy incision: Incise through skin, fat and linea alba, staying in
   the midline: drifting off it bleeds and weakens the closure. Enter the peritoneum between forceps under direct
   vision, then extend with fingers protecting the bowel. Trauma: midline, always. A left subcostal incision is an
   option for elective open splenectomy. Teach: The midline is fast, bloodless and extensible in both directions,
   which is exactly what an unknown pathology needs. Check: avoid entering blind through a scar.
07_exploration.png [step.abd.exploration]  Systematic exploration: Follow the same sequence every time: liver and
   gallbladder, stomach and duodenum, spleen, small bowel from duodenojejunal flexure to caecum, colon and rectum,
   pelvis, retroperitoneum, hernial orifices from inside. Run the small bowel hand over hand, both surfaces, in one
   direction. Trauma: evacuate clot, pack all four quadrants with the left upper quadrant packed firmly, let the
   anaesthetist catch up, then explore systematically for other injuries. Teach: The purpose of a laparotomy is to
   find out. Check: avoid stopping the exploration when the expected pathology is found.
08_mobilise.png [step.spl.mobilise]  Mobilising the spleen forwards into the wound: With the left hand, draw the
   spleen gently medially; divide the splenophrenic and splenorenal (lienorenal) peritoneal reflections lateral to the
   spleen with scissors. Develop the avascular plane behind the spleen and the tail of the pancreas with blunt finger
   dissection, lifting both forwards together. Teach: The splenic hilum is deep and posterior. Check: avoid pulling on
   the spleen before its attachments are divided, which tears the capsule and increases bleeding.
09_salvage-decision.png [step.spl.salvage-decision]  Salvage or remove: the trauma decision: Inspect the injury once
   the spleen is mobilised: capsular tears, parenchymal lacerations, hilar injury and fragmentation. Consider salvage
   (topical haemostats, suture splenorrhaphy, mesh wrap, partial splenectomy) only for a stable patient with an
   isolated, limited injury and no hilar involvement. Teach: Preserving the spleen avoids lifelong infection risk, but
   a repair that bleeds again in an unstable patient is lethal. Check: avoid time spent on a complex repair while the
   patient becomes cold and coagulopathic.
10_short-gastrics.png [step.spl.short-gastrics]  Dividing the short gastric vessels: Open the gastrosplenic ligament
   in its lower, more accessible part and work upwards. Divide each vessel between ties or clips close to the spleen,
   or with an energy device, keeping the stomach wall out of the tie. Teach: The short gastrics tether the spleen to
   the greater curve. Check: avoid including the gastric wall in the tie, which causes gastric necrosis or a fistula
   days later.
11_hilum.png [step.spl.hilum]  Controlling and dividing the splenic hilum: Compress the hilum between finger and thumb
   if bleeding, and identify the tail of the pancreas, separating it from the hilum. Ligate the artery before the vein
   where they can be separated, which allows the spleen to auto-transfuse; in elective immune thrombocytopenia, this
   is when platelets are given. Teach: The hilum carries the splenic artery and vein and lies against the tail of the
   pancreas. Check: avoid a mass clamp across the hilum that includes the pancreatic tail.
12_major-bleed.png [step.hpb.major-bleed]  Major haemorrhage: press, tell, call, then repair or pack: Put pressure on
   the bleeding: a finger, a swab on a stick or packs, and hold it. Do not clamp or clip into a pool of blood. Tell
   the anaesthetist clearly, ask for the major haemorrhage protocol to be activated if blood loss is heavy, and ask
   for a second experienced surgeon, a cell saver and vascular instruments. Splenic bleeding: compress the hilum
   between finger and thumb, or pack the bed, while the hilum is clamped and ligated; complete the splenectomy rather
   than attempt salvage in a deteriorating patient. Teach: In upper abdominal surgery the large veins (portal,
   superior mesenteric, splenic, hepatic and the cava) tear rather than cut, and clamping blindly makes a small hole
   large. Check: avoid blind clamping or deep suturing into a field of blood, which converts a bleed into a bile duct
   or pancreatic injury.
13_accessory.png [step.spl.accessory]  Searching for accessory spleens: Inspect the hilum, the gastrosplenic and
   splenocolic ligaments, the greater omentum and the area of the tail of the pancreas. Remove any accessory spleens
   in elective haematological cases. Teach: An accessory spleen left behind after splenectomy for immune
   thrombocytopenia or haemolysis can enlarge and cause relapse. Check: avoid omitting the search in an elective case
   for immune thrombocytopenia.
14_haemostasis.png [step.core.haemostasis]  Common. Inspect the splenic bed, the diaphragm, the short gastric ties,
   the hilum and the tail of the pancreas.
15_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. Selective: when the pancreatic tail was injured or is doubtful. Send drain
   amylase. Teach: A drain tells you what is happening in a space you cannot see. Check: avoid a drain placed 'just in
   case', which then becomes a route for infection.
16_counts.png [step.core.counts]  Common.
17_specimen.png [step.core.specimen]  Common. Weigh the spleen if haematology wants it; send it intact for histology
   when a lymphoma or tumour is possible.
18_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Teach: Burst abdomen and incisional hernia are closure failures, and closure
   technique is one of the few variables entirely under the surgeon's control. Check: avoid large bites taken quickly
   at the end of a long case.
19_skin-closure.png [step.core.skin-closure]  Common.
20_debrief.png [step.core.debrief]  Common. Record asplenia, the vaccination plan, antibiotic prophylaxis, accessory
   spleens found, and the pancreatic tail status.

B. LAPAROSCOPIC ANTERIOR RESECTION WITH TOTAL MESORECTAL EXCISION  (folder lap-anterior-resection-tme/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the MDT decision, the MRI and the neoadjuvant record;
   both stoma sites marked; consent covers a defunctioning or permanent stoma and bladder and sexual dysfunction.
02_timeout.png [step.core.timeout]  Common. State the tumour height from the anal verge and the planned anastomotic
   level; confirm blood is available and the open pelvic set is in theatre.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Prepare the abdomen and the perineum; insert a urinary catheter.
   Rectal washout before transection per unit practice.
06_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
07_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Place the right iliac fossa port at the intended ileostomy site where possible, and angle the
   stapling port so the rectum can be divided in one or two firings. Teach: Ports placed for the anatomy you have,
   rather than for the textbook, are the difference between a comfortable operation and a fight. Check: avoid ports
   placed too close together, so the instruments fight each other.
08_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Staging laparoscopy: liver, peritoneum and pelvis before
   committing. Pack the small bowel out of the pelvis into the upper abdomen. Teach: The first look answers a question
   the imaging could not, and it is the only chance to find the second diagnosis before attention narrows to the
   first. Check: avoid going straight to the target and missing a second pathology.
09_left-medial-to-lateral.png [step.bowel.left-medial-to-lateral]  Medial-to-lateral mobilisation of the left colon
   and sigmoid, ureter first: Lift the sigmoid mesentery up and to the left so the inferior mesenteric pedicle tents
   away from the aorta; incise the peritoneum at the sacral promontory beneath it. Enter the areolar plane behind the
   mesocolon (Toldt's fascia) and sweep the retroperitoneum down, working laterally towards the abdominal wall and
   cephalad towards the pancreas. Teach: Lifting the sigmoid and descending mesocolon off the retroperitoneum in the
   embryological plane keeps the lymphatic envelope intact and keeps the left ureter, gonadal vessels and hypogastric
   nerves behind the plane. Check: avoid dissecting too deep, so the ureter and gonadal vessels are lifted up with the
   mesocolon and later divided with it.
10_ima-ligation.png [step.bowel.ima-ligation]  Inferior mesenteric artery and vein ligation: Cancer: skeletonise the
   inferior mesenteric artery near its origin and divide it a short distance from the aorta (high tie), keeping the
   preaortic nerves on the aorta; alternatively divide it just below the left colic artery with clearance of the
   apical nodes (low tie), as the unit and MDT plan. Divide the inferior mesenteric vein separately at the inferior
   border of the pancreas, lateral to the duodenojejunal flexure, when length is needed for a low anastomosis. For
   rectal cancer the vascular tie is oncological: high or low tie as planned, with the IMV divided at the pancreas for
   length. Teach: The level of the vascular tie sets the lymph node yield for a cancer, the reach of the colon to the
   pelvis, and the blood supply of the proximal limb. Check: avoid taking the preaortic nerve plexus with a high tie,
   causing sexual and bladder dysfunction.
11_splenic-flexure.png [step.bowel.splenic-flexure]  Splenic flexure mobilisation: Decide early whether length is
   needed: routinely for a low anastomosis, selectively for a sigmoid colectomy. Combine approaches: medial
   (continuing the retromesocolic plane up over the pancreas), lateral (along the white line) and from the lesser sac
   (dividing the gastrocolic omentum to the left of the middle colic vessels). Routinely mobilise for a low
   anastomosis; a tension-free reach is not negotiable. Teach: A colorectal anastomosis must lie in the pelvis without
   tension. Check: avoid downward traction on the colon that avulses the splenic capsule.
12_posterior.png [step.tme.posterior]  Posterior mesorectal dissection in the holy plane: Continue the medial plane
   down over the sacral promontory, lifting the rectum forwards and the mesorectum with it, so the areolar 'angel
   hair' tissue of the holy plane is put on stretch. Identify the hypogastric nerves at the promontory and sweep them
   posterolaterally, keeping them on the pelvic side. Teach: The posterior plane is the easiest to find and the one
   that sets up the whole dissection. Check: avoid blunt dissection with a hand or a peanut, which tears presacral
   veins and the mesorectum.
13_anterolateral.png [step.tme.anterolateral]  Lateral and anterior mesorectal dissection: Develop the lateral planes
   from the posterior dissection, alternating sides, keeping the pelvic side-wall nerves (inferior hypogastric plexus)
   laterally and dividing the lateral ligaments close to the mesorectal fascia. Incise the peritoneum anteriorly at
   the base of the rectovesical or rectouterine pouch. Teach: The lateral and anterior planes are where the
   circumferential margin is most often lost and where the pelvic autonomic nerves and the neurovascular bundles are
   injured. Check: avoid coning in laterally and leaving mesorectum behind.
14_transection.png [step.tme.transection]  Confirming the distal margin and transecting the rectum: Confirm the lower
   edge of the tumour by digital rectal examination or endoscopy before clamping, and mark the level. Low rectal
   cancer: complete the mesorectal dissection to the pelvic floor and divide the rectum with a clear distal mural
   margin as planned by the MDT. Upper rectal cancer: divide the mesorectum at right angles to the bowel at the
   planned distance below the tumour, without coning. Teach: The distal margin and the number of stapler firings are
   both decided here. Check: avoid transecting above the tumour's lower edge because it was assumed rather than
   checked.
15_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Wound protector at the extraction site (often a Pfannenstiel or left iliac fossa
   incision). Divide the proximal colon extracorporeally at a well-perfused point. Teach: Bringing an infected or
   neoplastic specimen through the abdominal wall unprotected causes port-site infection and, in malignancy, port-site
   recurrence. Check: avoid a bag torn during extraction, spilling contents into the wound.
16_circular-anastomosis.png [step.bowel.circular-anastomosis]  Circular stapled colorectal anastomosis (double-
   stapled): Confirm proximal perfusion at the chosen division point (pulsatile bleeding from the marginal vessel, or
   an objective perfusion assessment where available), then insert the anvil into the proximal colon and secure it
   with a purse-string. Check that the proximal limb reaches the pelvis without tension and that the mesentery runs
   straight from the pedicle without a twist. Teach: The circular stapler allows an anastomosis deep in the pelvis
   that cannot be sewn by hand. Check: avoid incomplete doughnuts, which mean a gap in the anastomosis: test, repair,
   and consider defunctioning or redoing it.
17_leak-check.png [step.bowel.leak-check]  Checking the repair or anastomosis: Inspect the whole circumference,
   including the mesenteric border and the crotch of a stapled anastomosis. Confirm the lumen is patent by palpation
   between finger and thumb. Air leak test: fill the pelvis with saline, clamp the colon above the anastomosis,
   insufflate air transanally and watch for bubbles. A leak needs repair and usually a defunctioning stoma or a redo.
   Check the pelvis for bleeding at the same time. Teach: A defect found on the table costs a stitch. Check: avoid a
   negative air test treated as a guarantee: it excludes a technical hole, not later ischaemic breakdown.
18_colorectal-bailout.png [step.bowel.colorectal-bailout]  Deciding against an unprotected anastomosis: defunction or
   end colostomy: Decide deliberately, with the reasons recorded: anastomotic height, prior pelvic radiotherapy,
   incomplete doughnuts or a positive leak test, doubtful perfusion, contamination, malnutrition, steroids or
   immunosuppression, and the patient's physiology. Defunction: form a loop ileostomy at the pre-marked right iliac
   fossa site (see the loop ileostomy procedure) after closure of the main wound. Teach: A colorectal anastomotic leak
   is the complication that kills after this operation. Check: avoid defunctioning reduces the harm of a leak but does
   not prevent a leak: an ischaemic anastomosis still needs to be redone or abandoned.
19_counts.png [step.core.counts]  Common.
20_specimen.png [step.core.specimen]  Common. Photograph the specimen front and back and grade the mesorectum
   (complete, nearly complete, incomplete) before it goes; do not open it unless your pathologist asks.
21_skin-closure.png [step.core.skin-closure]  Common. Close the extraction site fascia and every 10 mm or larger port;
   mature the ileostomy last.
22_debrief.png [step.core.debrief]  Common. Record TME plane quality, doughnuts, air test, ureter seen, nerves
   preserved and the stoma decision with its reasons.

C. PANCREATICODUODENECTOMY (WHIPPLE)  (folder pancreaticoduodenectomy/)
01_consent-check.png [step.core.consent-check]  Common. Consent covers a bypass instead of resection, vascular
   resection and the unit's own outcome figures.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Pancreatic-protocol CT on screen, resectability status recorded, neoadjuvant therapy completed and re-
   staged, biliary stent status and bile culture known. Teach: A cancer operation is one part of a treatment plan
   agreed by a multidisciplinary team. Check: avoid accepting an MDT note that predates new imaging or a changed
   biopsy result.
03_timeout.png [step.core.timeout]  Common. Anticipated critical events: venous resection, blood loss, frozen
   sections, expected duration.
04_prophylaxis.png [step.core.prophylaxis]  Common. If stented, use the bile culture to guide the antibiotic choice
   per local protocol; redose during a long operation.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_upper-access.png [step.hpb.upper-access]  Upper abdominal incision and fixed retraction: Choose the incision for
   the operation: right subcostal (Kocher) for the gallbladder and bile duct; bilateral subcostal (rooftop or
   chevron), a reversed L (J) or an upper midline for the liver and pancreas. Divide the rectus and the oblique
   muscles with diathermy, ligating the superior epigastric vessels; preserve the intercostal nerves at the lateral
   end where possible. Bilateral subcostal (rooftop) or upper midline, with a fixed costal-margin retractor. Teach:
   Upper abdominal organs sit high under the costal margin. Check: avoid a short subcostal incision that forces deep
   retraction on the liver and tears its capsule.
08_exploration.png [step.abd.exploration]  Systematic exploration: Follow the same sequence every time: liver and
   gallbladder, stomach and duodenum, spleen, small bowel from duodenojejunal flexure to caecum, colon and rectum,
   pelvis, retroperitoneum, hernial orifices from inside. Run the small bowel hand over hand, both surfaces, in one
   direction. First question: is there metastatic disease? Inspect the liver, peritoneum, omentum, root of the
   mesentery and nodes beyond the resection field; biopsy anything suspicious for frozen section before going further.
   Teach: The purpose of a laparotomy is to find out. Check: avoid stopping the exploration when the expected
   pathology is found.
09_ious.png [step.hpb.ious]  Intra-operative ultrasound before committing: Scan the whole liver systematically,
   segment by segment, before any mobilisation that alters its shape. Trace the hepatic veins to the vena cava and the
   portal pedicles to the hilum, and mark the relevant vessels on the liver surface with diathermy. Teach: Pre-
   operative imaging is a map made weeks ago. Check: avoid scanning only the known lesion and missing a small
   contralateral metastasis that makes the resection futile.
10_kocher.png [step.whip.kocher]  Kocher manoeuvre and assessment of the head: Incise the peritoneum lateral to the
   second part of the duodenum and reflect the duodenum and pancreatic head medially, exposing the inferior vena cava
   and the left renal vein. Continue to the left until the aorta and the origin of the superior mesenteric artery can
   be palpated behind the head. Teach: Mobilising the duodenum and pancreatic head off the inferior vena cava lets the
   surgeon feel the tumour between the fingers and judge its relationship to the superior mesenteric artery, and gives
   the posterior plane of the specimen. Check: avoid dissecting into the pancreatic head instead of behind it.
11_hepatoduodenal.png [step.hpb.hepatoduodenal]  Dissecting the hepatoduodenal ligament: Palpate the ligament between
   finger and thumb before dissecting, feeling for a pulse behind the bile duct on the right, which suggests a
   replaced right hepatic artery from the superior mesenteric artery. Open the peritoneum over the ligament and
   identify the common bile duct anterolaterally, the hepatic artery medially and the portal vein posteriorly.
   Cholecystectomy, then expose the common hepatic duct, the common hepatic artery and the portal vein. Test-clamp the
   gastroduodenal artery and confirm a hepatic artery pulse before dividing it. Teach: The hepatoduodenal ligament
   carries the inflow of the whole liver: the bile duct, the hepatic artery and the portal vein. Check: avoid assuming
   textbook anatomy because the CT report did not mention a variant.
12_neck-tunnel.png [step.whip.neck-tunnel]  Tunnel behind the pancreatic neck: the resectability gate: Below the
   pancreas, identify the superior mesenteric vein (follow the middle colic or gastrocolic trunk to it) and dissect
   upwards on its anterior surface. Above the pancreas, after dividing the gastroduodenal artery, identify the portal
   vein and dissect downwards behind the neck. Teach: Separating the pancreatic neck from the front of the superior
   mesenteric and portal veins shows whether the tumour invades them. Check: avoid forcing the tunnel through tumour,
   tearing the vein.
13_bailout.png [step.whip.bailout]  Unresectable at operation: stop, biopsy, bypass: Stop before the point of no
   return if there are metastases, superior mesenteric artery or coeliac involvement, or unreconstructable venous
   involvement. Obtain tissue for diagnosis if it is not already available. Teach: Finding metastases or arterial
   encasement after the incision is common. Check: avoid committing to resection in the hope that it will turn out
   resectable.
14_resection.png [step.whip.resection]  Division and resection: stomach, bile duct, jejunum, neck, uncinate: Divide
   the stomach (classic) or the first part of the duodenum beyond the pylorus (pylorus-preserving) with a stapler.
   Divide the common hepatic duct above the cystic duct junction; send a margin for frozen section if the unit does;
   place a bulldog clamp on the proximal duct. Teach: The specimen is freed in a set order so that the last
   attachment, the uncinate process on the superior mesenteric artery, is dissected under full vision. Check: avoid
   mass clamping the uncinate, which leaves tissue on the artery and risks bleeding.
15_reconstruction.png [step.whip.reconstruction]  Reconstruction: pancreatic, biliary and gastric anastomoses: Bring
   the jejunal limb up through the mesocolon (or retromesenteric route). Pancreatic anastomosis:
   pancreaticojejunostomy (duct-to-mucosa or invagination) or pancreaticogastrostomy, according to surgeon preference,
   gland texture and duct size; consider a duct stent. Teach: The pancreatic anastomosis is the source of most serious
   complications. Check: avoid tension on the pancreatic anastomosis from a short limb.
16_bile-leak-check.png [step.hpb.bile-leak-check]  Checking for bile leakage before closure: Dry the operative field
   and place a clean white swab against the raw surface, duct closure or anastomosis for a minute, then inspect it for
   yellow or green staining. After liver resection, consider a formal leak test where available, injecting saline, air
   or a fat emulsion through the cystic duct stump and watching the cut surface. Check the hepaticojejunostomy and the
   pancreatic anastomosis; look at the superior mesenteric artery bed and the venous margin for bleeding at the same
   time. Teach: Bile leaks are among the commonest complications of biliary and liver surgery. Check: avoid treating a
   negative swab test as proof that no leak will occur: necrosis of a cauterised duct leaks days later.
17_major-bleed.png [step.hpb.major-bleed]  Major haemorrhage: press, tell, call, then repair or pack: Put pressure on
   the bleeding: a finger, a swab on a stick or packs, and hold it. Do not clamp or clip into a pool of blood. Tell
   the anaesthetist clearly, ask for the major haemorrhage protocol to be activated if blood loss is heavy, and ask
   for a second experienced surgeon, a cell saver and vascular instruments. Portal or superior mesenteric vein tears:
   digital pressure, proximal and distal control, then repair with fine monofilament. Call a vascular-capable
   colleague early. Teach: In upper abdominal surgery the large veins (portal, superior mesenteric, splenic, hepatic
   and the cava) tear rather than cut, and clamping blindly makes a small hole large. Check: avoid blind clamping or
   deep suturing into a field of blood, which converts a bleed into a bile duct or pancreatic injury.
18_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. Drains near the pancreatic and biliary anastomoses per unit policy; record
   the drain amylase plan. Teach: A drain tells you what is happening in a space you cannot see. Check: avoid a drain
   placed 'just in case', which then becomes a route for infection.
19_counts.png [step.core.counts]  Common.
20_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Mark the superior mesenteric artery margin, the venous groove, the pancreatic neck and the
   bile duct margins per the pathology protocol; send frozen sections of the neck and bile duct margins if the unit
   uses them. Teach: Margin status and nodal yield are reported by the pathologist, but only from a specimen they can
   orient. Check: avoid a single suture with no stated convention.
21_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Teach: Burst abdomen and incisional hernia are closure failures, and closure
   technique is one of the few variables entirely under the surgeon's control. Check: avoid large bites taken quickly
   at the end of a long case.
22_debrief.png [step.core.debrief]  Common. Record resectability findings, vessel anatomy and any variant, venous
   resection, gland texture and duct size (fistula risk), anastomosis type, drains, and the drain amylase and bleeding
   plan.

D. RIGHT HEPATECTOMY  (folder right-hepatectomy/)
01_consent-check.png [step.core.consent-check]  Common.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Remnant volume and liver quality documented, portal vein embolisation result if done, chemotherapy
   interval, and the planned resection named in Brisbane 2000 terms. Teach: A cancer operation is one part of a
   treatment plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note that predates new imaging or
   a changed biopsy result.
03_timeout.png [step.core.timeout]  Common. Agree low central venous pressure targets, blood availability, cell saver
   and Pringle timing with the anaesthetist.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Prepare the chest as well, in case a thoracoabdominal extension or
   pleural drain is needed.
07_upper-access.png [step.hpb.upper-access]  Upper abdominal incision and fixed retraction: Choose the incision for
   the operation: right subcostal (Kocher) for the gallbladder and bile duct; bilateral subcostal (rooftop or
   chevron), a reversed L (J) or an upper midline for the liver and pancreas. Divide the rectus and the oblique
   muscles with diathermy, ligating the superior epigastric vessels; preserve the intercostal nerves at the lateral
   end where possible. Reversed L (J) or rooftop incision; divide the falciform ligament up to the suprahepatic
   inferior vena cava to expose the hepatic vein confluence. Teach: Upper abdominal organs sit high under the costal
   margin. Check: avoid a short subcostal incision that forces deep retraction on the liver and tears its capsule.
08_ious.png [step.hpb.ious]  Intra-operative ultrasound before committing: Scan the whole liver systematically,
   segment by segment, before any mobilisation that alters its shape. Trace the hepatic veins to the vena cava and the
   portal pedicles to the hilum, and mark the relevant vessels on the liver surface with diathermy. Map every lesion,
   the middle and right hepatic veins and the left pedicle; mark the middle hepatic vein on the surface. Confirm
   nothing in the remnant changes the plan. Teach: Pre-operative imaging is a map made weeks ago. Check: avoid
   scanning only the known lesion and missing a small contralateral metastasis that makes the resection futile.
09_mobilise.png [step.hep.mobilise]  Mobilising the right liver off the diaphragm and the vena cava: Divide the right
   triangular and coronary ligaments and separate the bare area from the diaphragm, rotating the liver gently to the
   left. Separate the right adrenal gland from the liver, ligating the adrenal vein if necessary. Teach: The right
   liver is held by its triangular and coronary ligaments and drained by short veins into the inferior vena cava.
   Check: avoid forceful rotation that avulses a short hepatic vein from the cava.
10_hepatoduodenal.png [step.hpb.hepatoduodenal]  Dissecting the hepatoduodenal ligament: Palpate the ligament between
   finger and thumb before dissecting, feeling for a pulse behind the bile duct on the right, which suggests a
   replaced right hepatic artery from the superior mesenteric artery. Open the peritoneum over the ligament and
   identify the common bile duct anterolaterally, the hepatic artery medially and the portal vein posteriorly.
   Cholecystectomy, then hilar dissection: identify the right hepatic artery and right portal vein, and confirm the
   left hepatic artery and left portal vein before anything is divided. Sling the hepatoduodenal ligament for a
   Pringle. Teach: The hepatoduodenal ligament carries the inflow of the whole liver: the bile duct, the hepatic
   artery and the portal vein. Check: avoid assuming textbook anatomy because the CT report did not mention a variant.
11_inflow.png [step.hep.inflow]  Inflow control: right hepatic artery and right portal vein: Test-clamp the right
   hepatic artery and confirm a pulse in the left hepatic artery; then ligate and divide it. Isolate the right portal
   vein, ligating the small caudate branch from its back if it is in the way, test-clamp and confirm left portal flow
   (ultrasound helps); then divide it with a vascular stapler or oversewn ties. Teach: Dividing the right-sided inflow
   before transection reduces bleeding and produces a visible demarcation line that marks the true plane between the
   right and left liver. Check: avoid ligating the right portal vein too close to the bifurcation, narrowing the left
   portal vein.
12_outflow.png [step.hep.outflow]  Outflow control: the right hepatic vein: With the liver mobilised and the caval
   ligament divided, develop the space between the right and middle hepatic veins from above and pass a clamp or sling
   around the right hepatic vein. Divide it with a vascular stapler, or between vascular clamps with an oversewn caval
   stump, with the anaesthetist warned. Teach: Controlling the right hepatic vein reduces back-bleeding during
   transection and avoids a catastrophic tear at the end of the operation. Check: avoid blunt dissection around the
   vein behind a large tumour, tearing it.
13_pringle.png [step.hpb.pringle]  Pringle manoeuvre: sling, clamp, time, release: Open the lesser omentum, pass a
   finger through the foramen of Winslow (epiploic foramen) behind the ligament, and place a sling or tape around it
   before you need it. Clamp by tightening the tourniquet or with a soft vascular clamp, tell the anaesthetist and
   start a clock; call out the time at intervals. Intermittent clamping during transection, commonly in cycles of
   about 15 minutes with about 5 minutes of reperfusion, per unit protocol; record the total time. Teach: Occluding
   the hepatoduodenal ligament stops hepatic arterial and portal inflow. Check: avoid forgetting the clamp is on, or
   not recording the total ischaemic time.
14_transection.png [step.hep.transection]  Parenchymal transection along the demarcation line: Ask the anaesthetist to
   keep the central venous pressure low (commonly quoted as below about 5 cm H2O) before starting. Score the liver
   capsule along the demarcation line, checked against the ultrasound mark; place stay sutures on either side. Teach:
   Transection is where most blood is lost and where the remnant's outflow and bile ducts can be injured. Check: avoid
   transecting while the central venous pressure is high, causing constant back-bleeding.
15_major-bleed.png [step.hpb.major-bleed]  Major haemorrhage: press, tell, call, then repair or pack: Put pressure on
   the bleeding: a finger, a swab on a stick or packs, and hold it. Do not clamp or clip into a pool of blood. Tell
   the anaesthetist clearly, ask for the major haemorrhage protocol to be activated if blood loss is heavy, and ask
   for a second experienced surgeon, a cell saver and vascular instruments. Liver bleeding: inflow is controlled by
   the Pringle; back-bleeding needs a lower central venous pressure, compression and suture of the hepatic vein
   branch. Caval injury: compress, control, repair with fine monofilament; pack if physiology fails. Teach: In upper
   abdominal surgery the large veins (portal, superior mesenteric, splenic, hepatic and the cava) tear rather than
   cut, and clamping blindly makes a small hole large. Check: avoid blind clamping or deep suturing into a field of
   blood, which converts a bleed into a bile duct or pancreatic injury.
16_bile-leak-check.png [step.hpb.bile-leak-check]  Checking for bile leakage before closure: Dry the operative field
   and place a clean white swab against the raw surface, duct closure or anastomosis for a minute, then inspect it for
   yellow or green staining. After liver resection, consider a formal leak test where available, injecting saline, air
   or a fat emulsion through the cystic duct stump and watching the cut surface. White test or leak test through the
   cystic duct stump; suture leaking ducts on the cut surface. Teach: Bile leaks are among the commonest complications
   of biliary and liver surgery. Check: avoid treating a negative swab test as proof that no leak will occur: necrosis
   of a cauterised duct leaks days later.
17_haemostasis.png [step.core.haemostasis]  Common. With the Pringle off and the central venous pressure restored
   towards normal, inspect the cut surface, the diaphragm, the adrenal and the caval bed.
18_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. Selective, per unit policy; if placed, it is for early warning of bile leak
   or bleeding. Teach: A drain tells you what is happening in a space you cannot see. Check: avoid a drain placed
   'just in case', which then becomes a route for infection.
19_counts.png [step.core.counts]  Common.
20_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Mark the transection margin and any close margin; ink per pathology protocol. Teach: Margin
   status and nodal yield are reported by the pathologist, but only from a specimen they can orient. Check: avoid a
   single suture with no stated convention.
21_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Before closing, fix the falciform ligament back to stop the remnant rotating
   and kinking the left hepatic vein outflow. Teach: Burst abdomen and incisional hernia are closure failures, and
   closure technique is one of the few variables entirely under the surgeon's control. Check: avoid large bites taken
   quickly at the end of a long case.
22_debrief.png [step.core.debrief]  Common. Record resection in Brisbane terms, total Pringle time, blood loss,
   remnant appearance and colour, bile leak test, and the liver failure watch plan.

E. MODIFIED RADICAL NECK DISSECTION  (folder modified-radical-neck-dissection/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side. Consent explicitly for sacrifice of the
   accessory nerve, internal jugular vein or sternocleidomastoid if found involved.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Confirm the levels to be cleared and which non-lymphatic structures are to be preserved, against the
   latest imaging. Teach: A cancer operation is one part of a treatment plan agreed by a multidisciplinary team.
   Check: avoid accepting an MDT note that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common. State the anticipated critical events aloud: carotid manipulation,
   possible vein injury, chyle leak on the left.
04_prophylaxis.png [step.core.prophylaxis]  Common. A neck dissection alone is clean; if combined with a resection
   opening the upper aerodigestive tract it is clean-contaminated and prophylaxis follows local policy.
05_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common. Prepare from the lower lip to below the clavicle and back to the
   trapezius, leaving the ear lobe and mandible visible as landmarks.
07_incision-flaps.png [step.mrnd.incision-flaps]  Incision and subplatysmal flaps: Use an incision that suits the
   primary and previous radiotherapy, commonly a hockey-stick or apron incision in a skin crease; avoid a trifurcation
   directly over the carotid. Raise flaps deep to platysma, up to the lower border of the mandible, down to the
   clavicle, back to the anterior border of trapezius and forward to the midline. Teach: The incision must give access
   from the mandible to the clavicle and from the midline to trapezius, while keeping skin flap blood supply intact
   and keeping a scar off the carotid. Check: avoid flaps raised too thin, superficial to platysma, which necrose
   after radiotherapy.
08_level-i.png [step.mrnd.level-i]  Level I: submental and submandibular triangles: Protect the marginal mandibular
   nerve by dividing the facial vein low, below the submandibular gland, and reflecting it upwards with the fascia
   (the Hayes Martin manoeuvre), or by identifying the nerve directly. Clear level Ia between the anterior bellies of
   digastric down to mylohyoid, then mobilise the submandibular gland and its nodes from anterior to posterior. Teach:
   Level I drains the oral cavity and lip and must be cleared when involved or at risk. Check: avoid dissecting above
   the facial vein near the mandible, where the nerve lies.
09_accessory-nerve.png [step.mrnd.accessory-nerve]  Find and preserve the spinal accessory nerve: Release the anterior
   border of sternocleidomastoid and retract the muscle laterally; find the nerve in level II as it crosses the
   internal jugular vein, below the posterior belly of digastric, or as it enters the deep surface of the muscle. Find
   it again at the posterior border of sternocleidomastoid, a little above the point where the great auricular nerve
   winds round the muscle, and follow it across the posterior triangle towards trapezius. Teach: Preserving the
   accessory nerve is the main functional gain of a modified over a radical dissection. Check: avoid traction on the
   nerve while clearing level IIb, which causes a palsy with the nerve in continuity.
10_posterior-triangle.png [step.mrnd.posterior-triangle]  Level V: posterior triangle above the prevertebral fascia:
   Define the anterior border of trapezius and dissect the fibrofatty tissue forwards off the floor, keeping the
   accessory nerve in view. Identify the prevertebral fascia over the scalene and levator scapulae muscles and stay on
   its surface. Teach: Clearing the posterior triangle exposes the floor of the neck. Check: avoid dissecting through
   the prevertebral fascia to remove a little more fat.
11_carotid-sheath.png [step.mrnd.carotid-sheath]  Unwrap the carotid sheath and preserve the internal jugular vein:
   Open the fascia over the internal jugular vein along its length and peel the specimen medially off the vein,
   ligating each tributary individually. Identify the vagus nerve between the vein and the carotid, and the
   hypoglossal nerve crossing the carotid bifurcation region, before ligating anything near them. Teach: The nodes of
   levels II to IV lie along the internal jugular vein, so the specimen is peeled off the carotid sheath. Check: avoid
   tearing a tributary flush with the vein wall.
12_nodal-clearance.png [step.onco.nodal-clearance]  En bloc nodal clearance by named level or station: Before
   starting, state which levels or stations are to be cleared, as agreed at the MDT, and which non-lymphatic
   structures are to be preserved. Define the boundary structures first (vessels, nerves, muscles), then sweep the
   fibrofatty tissue off them towards the specimen, keeping the packet in one piece. Sweep the specimen from posterior
   to anterior and from inferior to superior off the prevertebral fascia and the carotid sheath, delivering levels II
   to V in continuity with level I. Teach: A lymphadenectomy stages the cancer and, in several cancers, controls
   regional disease. Check: avoid node picking instead of an en bloc clearance, which lowers yield and leaves disease
   behind.
13_major-vein-injury.png [step.onco.major-vein-injury]  Major vein injury during a nodal clearance: press, control,
   repair: Press directly on the bleeding point with a finger or a swab on a stick; tell the anaesthetist, and ask for
   head-down positioning in the neck to reduce the risk of air embolism. Call for senior help and suction, improve
   exposure, and get proximal and distal control with gentle pressure or vascular clamps placed under vision. The
   internal jugular vein is the usual culprit, often at a tributary or the jugulo-facial junction. Head down, press,
   control, repair. Teach: The axillary and internal jugular veins form the boundaries of the commonest nodal
   clearances. Check: avoid blind clamping or diathermy into a pool of blood, catching the adjacent nerve.
14_thoracic-duct.png [step.mrnd.thoracic-duct]  Base of the neck: lymphatic ligation and chyle check: At the lower
   limit of level IV, dissect gently and ligate or clip the fibrofatty tissue between the internal jugular vein and
   the clavicle rather than diathermying across it. Ask the anaesthetist for a sustained Valsalva (positive airway
   pressure) and watch the base of the neck for clear or milky fluid. Teach: The thoracic duct and its branches enter
   the venous confluence at the base of level IV, especially on the left. Check: avoid assuming a dry field in a
   fasted patient means no chyle: the leak may only appear when feeding starts.
15_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Pin the specimen out on a board and label each level, or send levels separately in labelled
   pots as your pathologist prefers. Teach: Margin status and nodal yield are reported by the pathologist, but only
   from a specimen they can orient. Check: avoid a single suture with no stated convention.
16_haemostasis.png [step.core.haemostasis]  Common. Valsalva to test the internal jugular vein tributaries and the
   base of the neck.
17_suction-drain.png [step.onco.suction-drain]  Closed suction drain for the dead space after a nodal clearance: Place
   the drain in the dependent part of the dissection bed, away from the major vessels and nerves, and bring it out
   through a separate stab wound in a site that will not be irradiated or show the scar unnecessarily. Secure it,
   confirm suction holds before the skin is fully closed, and record type, number and site. One or two drains along
   the posterior triangle and the carotid sheath, kept away from the vein and the carotid. Teach: A nodal clearance
   leaves a dead space that fills with serous fluid and lymph. Check: avoid a drain that has lost suction from an air
   leak at the skin, which gives false reassurance.
18_counts.png [step.core.counts]  Common.
19_specimen.png [step.core.specimen]  Common.
20_skin-closure.png [step.core.skin-closure]  Common. Close platysma as a separate layer; in an irradiated neck make
   sure the carotid is covered by healthy tissue.
21_haematoma-handover.png [step.neck.haematoma-handover]  Airway and haematoma handover after neck surgery: Hand over
   explicitly to recovery and the ward: the operation, any concern about haemostasis, nerve monitoring results and the
   voice plan. Ensure a haematoma kit (stitch cutter or clip remover, scalpel, gauze) is at the bedside and that staff
   know the DESATS warning features and the SCOOP bedside release sequence per the DAS, BAETS and ENT UK guidance.
   Teach: A neck haematoma can obstruct the airway within minutes, and the people who see it first are recovery and
   ward staff, not the surgeon. Check: avoid a handover of 'routine neck obs' without saying what to look for or what
   to do.
22_debrief.png [step.core.debrief]  Common.

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
  surgx-splenectomy-steps.zip   (folder splenectomy/)
  surgx-lap-anterior-resection-tme-steps.zip   (folder lap-anterior-resection-tme/)
  surgx-pancreaticoduodenectomy-steps.zip   (folder pancreaticoduodenectomy/)
  surgx-right-hepatectomy-steps.zip   (folder right-hepatectomy/)
  surgx-modified-radical-neck-dissection-steps.zip   (folder modified-radical-neck-dissection/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
