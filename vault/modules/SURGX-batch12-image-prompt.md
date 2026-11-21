---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 12 (Laparoscopic Nissen fundoplication, Laparoscopic sleeve gastrectomy, Left hemicolectomy and sigmoid colectomy, Open and subtotal cholecystectomy, Laparoscopic common bile duct exploration): Gemini image prompt (109 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant general and colorectal surgeons. You are making 109 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Laparoscopic Nissen fundoplication                             21 images
  B. Laparoscopic sleeve gastrectomy                                22 images
  C. Left hemicolectomy and sigmoid colectomy                       22 images
  D. Open and subtotal cholecystectomy                              22 images
  E. Laparoscopic common bile duct exploration                      22 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Society for Metabolic and Bariatric Surgery (ASMBS) and International Federation for the Surgery of Obesity and Metabolic Disorders (IFSO), Indications for metabolic and bariatric surgery; American Society of Colon and Rectal Surgeons (ASCRS), The American Society of Colon and Rectal Surgeons Clinical Practice Guidelines for the Management of Colon Cancer (Vogel JD et al., Dis Colon Rectum); American Society of Colon and Rectal Surgeons (ASCRS), The American Society of Colon and Rectal Surgeons Clinical Practice Guidelines for the Management of Left-sided Colonic Diverticulitis (Hall J et al., Dis Colon Rectum); British Society of Gastroenterology (BSG), Updated guideline on the management of common bile duct stones (CBDS) (Williams E et al., Gut); Cochrane Database of Systematic Reviews, Surgical versus endoscopic treatment of bile duct stones (Dasari BV et al.); Cochrane Database of Systematic Reviews, T-tube drainage versus primary closure after laparoscopic common bile duct exploration (Gurusamy KS, Koti R, Davidson BR); ERAS Society, Guidelines for perioperative care in bariatric surgery: ERAS Society recommendations; ERAS Society, Guidelines for perioperative care in elective colorectal surgery: Enhanced Recovery After Surgery (ERAS) Society recommendations: 2018 (Gustafsson UO et al., World J Surg); European Society of Gastrointestinal Endoscopy (ESGE), Endoscopic management of common bile duct stones: European Society of Gastrointestinal Endoscopy (ESGE) guideline (Manes G et al., Endoscopy); International Sleeve Gastrectomy Expert Panel, Consensus statement: best practice guidelines based on experience of more than 12,000 cases; Journal of the American College of Surgeons, Subtotal cholecystectomy: 'fenestrating' vs 'reconstituting' subtypes and the prevention of bile duct injury: definition of the optimal procedure in difficult operative conditions (Strasberg SM, Pucci MJ, Brunt LM, Deziel DJ); National Institute for Health and Care Excellence (NICE), Colorectal cancer (NG151); National Institute for Health and Care Excellence (NICE), Diverticular disease: diagnosis and management (NG147); Society of American Gastrointestinal and Endoscopic Surgeons (SAGES), Guidelines for the management of hiatal hernia; Society of American Gastrointestinal and Endoscopic Surgeons (SAGES), Guidelines for the surgical treatment of gastroesophageal reflux (GERD); Society of American Gastrointestinal and Endoscopic Surgeons (SAGES), Safe Cholecystectomy Program: Critical View of Safety and the universal culture of safety; Tokyo Guidelines Steering Committee (J Hepatobiliary Pancreat Sci), Tokyo Guidelines 2018: surgical management of acute cholecystitis: safe steps in laparoscopic cholecystectomy for acute cholecystitis (Wakabayashi G et al.); World Society of Emergency Surgery (WSES), 2020 WSES guidelines for the detection and management of bile duct injury during cholecystectomy (de'Angelis N et al., World J Emerg Surg); World Society of Emergency Surgery (WSES), 2020 World Society of Emergency Surgery updated guidelines for the diagnosis and treatment of acute calculus cholecystitis (Pisano M et al., World J Emerg Surg)).
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
- A. Supine in steep reverse Trendelenburg, with legs apart (French position) or the surgeon on the patient's right,
  according to unit practice. Secure the patient firmly with footplates or supports before tilting. Arms out or tucked
  to allow the assistant and camera holder to stand comfortably.
- B. Supine on a bariatric-rated table, legs apart (French position) or surgeon on the right, according to unit
  practice. Steep reverse Trendelenburg; secure the patient with footplates and straps before tilting. Pad pressure
  areas carefully and use intermittent pneumatic compression devices.
- C. Modified Lloyd-Davies with legs in padded stirrups, thighs flat, arms tucked, for transanal stapler access. Head
  down and right side down for the pelvic and medial dissection; head up and right side down for the splenic flexure.
- D. Supine, with the right side of the abdomen accessible and arms out on boards abducted no more than 90 degrees.
  Reverse Trendelenburg with a slight left tilt to let the colon and duodenum fall away from the porta. A radiolucent
  table or the ability to bring in fluoroscopy for cholangiography.
- E. Supine, reverse Trendelenburg with left tilt, as for laparoscopic cholecystectomy. Radiolucent table, with the
  C-arm positioned and tested before draping. Second monitor or picture-in-picture for the choledochoscope image.
Step-specific facts:
- A. Anatomy: The oesophageal hiatus is formed by the right crus of the diaphragm, which splits around the oesophagus;
  the aorta passes behind it through the aortic hiatus. Must be right: Identify and preserve both vagus nerves. Obtain
  adequate intra-abdominal oesophageal length without tension. Close the crura snugly but not tightly. Pass the bougie
  only under vision and with explicit communication; stop at resistance.
- B. Anatomy: The greater curvature is supplied by the gastroepiploic arcade and, at the top, the short gastric
  vessels from the spleen. The lesser curvature, which forms the sleeve, keeps its supply from the left and right
  gastric arteries. Must be right: Communicate every bougie and tube movement with the anaesthetist; remove all other
  intragastric tubes before stapling. Keep the incisura wide and the staple line straight and symmetrical. Stay away
  from the gastro-oesophageal junction with the last firing.
- C. Anatomy: The descending and sigmoid colon are supplied by the inferior mesenteric artery (left colic and sigmoid
  branches) and the marginal artery; the splenic flexure has a variable supply from the left branch of the middle
  colic artery. Must be right: Identify the left ureter before dividing the vascular pedicle or the mesentery.
- D. Anatomy: The hepatocystic triangle (cystic duct, common hepatic duct, inferior liver edge) contains the cystic
  artery; in severe inflammation it may be fused and impossible to display. Must be right: If the Critical View of
  Safety cannot be achieved, do not divide any tubular structure: choose a bail-out. Fundus-first dissection must hug
  the gallbladder wall; if the plane disappears near the neck, stop and convert to a subtotal cholecystectomy.
- E. Anatomy: The supraduodenal common bile duct lies anterolaterally in the hepatoduodenal ligament, with the hepatic
  artery medially and the portal vein behind. Must be right: Confirm the anatomy (Critical View of Safety and
  cholangiogram) before opening any duct. Prefer the transcystic route when it can work; choledochotomy only in a
  dilated duct.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 109 images)
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

A. LAPAROSCOPIC NISSEN FUNDOPLICATION  (folder lap-nissen-fundoplication/)
01_consent-check.png [step.core.consent-check]  Common. Confirm objective reflux evidence and manometry are in the
   notes; the type of wrap may change if motility is poor.
02_timeout.png [step.core.timeout]  Common. State the bougie size and who will pass it at the time-out.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
07_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Ports are placed high in the upper abdomen, aiming at the hiatus, with a separate port for the
   liver retractor. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
08_liver-retraction.png [step.hernia.liver-retraction]  Retracting the left lobe of the liver: Place a liver retractor
   through a subxiphoid or epigastric port, according to the system the unit uses. Lift the left lateral segment
   upward and forward, resting the retractor on the undersurface, not levering against the capsule. Teach: The hiatus
   lies behind the left lateral segment of the liver. Check: avoid prolonged pressure on a fatty liver producing a
   capsular tear or ischaemic patch.
09_short-gastrics.png [step.hernia.short-gastrics]  Dividing the short gastric vessels and freeing the fundus: Enter
   the lesser sac through the gastrocolic omentum at the mid greater curvature and work upwards, keeping the energy
   device close to the gastric wall but not on it. Divide the short gastric vessels under tension from the assistant's
   traction, taking the short top vessels carefully because the stomach and spleen lie close together there. Many
   surgeons divide the upper short gastric vessels to make a tension-free wrap; follow the unit's practice. Teach: The
   fundus has to be free to wrap without tension, and in a sleeve gastrectomy the whole greater curvature must be
   mobilised so no fundus is left behind. Check: avoid traction on the spleen producing a capsular tear.
10_hiatal-dissection.png [step.hernia.hiatal-dissection]  Dissecting the hiatus and the crura: Open the pars flaccida
   of the lesser omentum to reach the right crus, preserving a replaced or accessory left hepatic artery if one is
   present. Divide the phreno-oesophageal membrane over the front of the oesophagus and dissect along the inner edge
   of each crus, keeping the crural muscle covered by its fascia. Teach: Hiatal dissection is where the vagi, the
   pleura, the aorta and the oesophagus are injured. Check: avoid stripping the crural fascia, which leaves crura that
   will not hold sutures.
11_sac-reduction.png [step.hernia.sac-reduction]  Reducing the sac and judging its contents: Define the neck of the
   sac at the edge of the defect before pulling on anything; traction without a defined neck tears the sac and what
   lies in it. Reduce with gentle counter-traction, sac towards you and tissues away, staying on the sac wall rather
   than the structures around it. In a hiatal hernia, reduce the sac from the mediastinum and excise it from the
   junction, preserving the vagi. Teach: Most hernia complications start with the sac: contents injured during
   reduction, non-viable bowel returned to the abdomen, or a sac left partly unreduced that becomes the recurrence.
   Check: avoid reducing a tight hernia en masse with the constriction still intact.
12_oesophageal-length.png [step.nis.oesophageal-length]  Mediastinal mobilisation and intra-abdominal oesophageal
   length: With the sling around the oesophagus and vagi, dissect the oesophagus in the lower mediastinum
   circumferentially, keeping close to it and away from the pleura and aorta. Aim for about 2 to 3 cm of tension-free
   intra-abdominal oesophagus with the gastro-oesophageal junction lying below the hiatus without traction. Teach: A
   wrap placed under tension on a short oesophagus pulls up into the chest. Check: avoid judging the junction position
   with traction on the sling, which overestimates the length.
13_convert.png [step.hernia.convert]  Bailout: convert, stop, or call for help: Name the trigger before you start:
   anatomy that cannot be identified, bleeding that obscures the view, suspected perforation, or no progress over a
   set time. When a trigger occurs, stop dissecting, control what you can with pressure or a grasper, and tell the
   anaesthetist and scrub team. Stop or convert for uncontrolled bleeding, suspected perforation, or anatomy at the
   hiatus you cannot define. Teach: Conversion is a safe outcome, not a failure. Check: avoid converting only after
   the injury rather than before it.
14_bougie.png [step.hernia.bougie]  Passing the calibration bougie safely: Confirm all other tubes, temperature probes
   and the nasogastric tube are removed before the bougie is passed. Ask the anaesthetist to pass it slowly while you
   watch the gastro-oesophageal junction, straightening the junction with gentle downward traction on the stomach or
   sling. Teach: The bougie sets the calibre of the wrap or the sleeve, and its passage is a recognised cause of
   oesophageal and gastric perforation. Check: avoid stapling across a bougie or a temperature probe that nobody
   mentioned.
15_crural-repair.png [step.hernia.crural-repair]  Crural closure: Close the crura posteriorly with interrupted non-
   absorbable sutures, taking good bites of crural muscle with its fascia, from below upwards. Keep the aorta in view
   below the lowest suture and avoid the pleura laterally. Teach: Recurrent hiatal herniation is the commonest
   anatomical failure of antireflux and bariatric surgery. Check: avoid closing too tightly, which causes persistent
   dysphagia.
16_wrap.png [step.nis.wrap]  Constructing a short, floppy 360 degree wrap: Pass the posterior fundus behind the
   oesophagus from left to right through the retro-oesophageal window, above the posterior vagus or including it with
   the oesophagus as your technique dictates. Perform a 'shoe-shine' manoeuvre, moving the fundus back and forth
   behind the oesophagus, to confirm the correct part of the fundus is used and that it lies without tension or twist.
   Teach: The wrap restores a high-pressure zone at the gastro-oesophageal junction. Check: avoid using the body of
   the stomach instead of the fundus, producing a twisted, tight wrap.
17_haemostasis.png [step.core.haemostasis]  Common. Inspect the spleen, the short gastric bed, the liver under the
   retractor and the hiatus at low pressure.
18_counts.png [step.core.counts]  Common.
19_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
20_skin-closure.png [step.core.skin-closure]  Common.
21_debrief.png [step.core.debrief]  Common. Record crural sutures, wrap type, length and calibration, and whether the
   pleura was breached.

B. LAPAROSCOPIC SLEEVE GASTRECTOMY  (folder lap-sleeve-gastrectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm MDT approval, reflux assessment and the
   irreversibility of the operation.
02_timeout.png [step.core.timeout]  Common. State the bougie size, the stapler loads planned and who will manage the
   tubes.
03_prophylaxis.png [step.core.prophylaxis]  Common. Weight-adjusted antibiotic and thromboprophylaxis dosing per local
   protocol; mechanical prophylaxis from induction.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Many
   bariatric surgeons use optical entry in the left upper quadrant; long ports and instruments are needed. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
07_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
08_liver-retraction.png [step.hernia.liver-retraction]  Retracting the left lobe of the liver: Place a liver retractor
   through a subxiphoid or epigastric port, according to the system the unit uses. Lift the left lateral segment
   upward and forward, resting the retractor on the undersurface, not levering against the capsule. Teach: The hiatus
   lies behind the left lateral segment of the liver. Check: avoid prolonged pressure on a fatty liver producing a
   capsular tear or ischaemic patch.
09_start-point.png [step.slv.start-point]  Marking the antral starting point: Identify the pylorus by its vein and the
   thickened muscle, and measure along the greater curvature. Start the greater curve dissection and the first firing
   at the distance the unit has standardised; the expert consensus describes a range of about 2 to 6 cm from the
   pylorus. Teach: Where the resection starts decides how much antrum is kept. Check: avoid starting the stapling at
   the pylorus itself.
10_short-gastrics.png [step.hernia.short-gastrics]  Dividing the short gastric vessels and freeing the fundus: Enter
   the lesser sac through the gastrocolic omentum at the mid greater curvature and work upwards, keeping the energy
   device close to the gastric wall but not on it. Divide the short gastric vessels under tension from the assistant's
   traction, taking the short top vessels carefully because the stomach and spleen lie close together there. Divide
   the gastroepiploic branches close to the stomach from the starting point up to the angle of His, freeing the
   posterior fundus completely. Teach: The fundus has to be free to wrap without tension, and in a sleeve gastrectomy
   the whole greater curvature must be mobilised so no fundus is left behind. Check: avoid traction on the spleen
   producing a capsular tear.
11_hiatal-dissection.png [step.hernia.hiatal-dissection]  Dissecting the hiatus and the crura: Open the pars flaccida
   of the lesser omentum to reach the right crus, preserving a replaced or accessory left hepatic artery if one is
   present. Divide the phreno-oesophageal membrane over the front of the oesophagus and dissect along the inner edge
   of each crus, keeping the crural muscle covered by its fascia. Inspect the hiatus; if a hiatal hernia is present,
   reduce it and expose both crura. Teach: Hiatal dissection is where the vagi, the pleura, the aorta and the
   oesophagus are injured. Check: avoid stripping the crural fascia, which leaves crura that will not hold sutures.
12_crural-repair.png [step.hernia.crural-repair]  Crural closure: Close the crura posteriorly with interrupted non-
   absorbable sutures, taking good bites of crural muscle with its fascia, from below upwards. Keep the aorta in view
   below the lowest suture and avoid the pleura laterally. Only if a hiatal hernia is found. Teach: Recurrent hiatal
   herniation is the commonest anatomical failure of antireflux and bariatric surgery. Check: avoid closing too
   tightly, which causes persistent dysphagia.
13_bougie.png [step.hernia.bougie]  Passing the calibration bougie safely: Confirm all other tubes, temperature probes
   and the nasogastric tube are removed before the bougie is passed. Ask the anaesthetist to pass it slowly while you
   watch the gastro-oesophageal junction, straightening the junction with gentle downward traction on the stomach or
   sling. Teach: The bougie sets the calibre of the wrap or the sleeve, and its passage is a recognised cause of
   oesophageal and gastric perforation. Check: avoid stapling across a bougie or a temperature probe that nobody
   mentioned.
14_stapling.png [step.slv.stapling]  Stapling the sleeve along the bougie: With the bougie lying against the lesser
   curvature and confirmed in the antrum, fire the first loads across the antrum with a staple height suited to the
   thick antral wall, angled to keep the incisura wide. Fire successive loads parallel to the bougie, keeping the
   anterior and posterior walls symmetrical: pull the stomach laterally evenly so neither wall is taken more than the
   other. Teach: The staple line decides the shape of the sleeve and where it fails. Check: avoid narrowing at the
   incisura.
15_convert.png [step.hernia.convert]  Bailout: convert, stop, or call for help: Name the trigger before you start:
   anatomy that cannot be identified, bleeding that obscures the view, suspected perforation, or no progress over a
   set time. When a trigger occurs, stop dissecting, control what you can with pressure or a grasper, and tell the
   anaesthetist and scrub team. Stop or convert for uncontrolled bleeding, a stapler misfire across the junction, or
   loss of orientation. Teach: Conversion is a safe outcome, not a failure. Check: avoid converting only after the
   injury rather than before it.
16_leak-check.png [step.bowel.leak-check]  Checking the repair or anastomosis: Inspect the whole circumference,
   including the mesenteric border and the crotch of a stapled anastomosis. Confirm the lumen is patent by palpation
   between finger and thumb. Test the sleeve with methylene blue via the orogastric tube or air under saline or
   endoscopy, according to unit practice. Teach: A defect found on the table costs a stitch. Check: avoid a negative
   air test treated as a guarantee: it excludes a technical hole, not later ischaemic breakdown.
17_haemostasis.png [step.core.haemostasis]  Common. Raise the blood pressure towards normal and inspect the whole
   staple line, the gastroepiploic bed and the spleen.
18_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Teach: Bringing an infected or neoplastic specimen through the abdominal wall
   unprotected causes port-site infection and, in malignancy, port-site recurrence. Check: avoid a bag torn during
   extraction, spilling contents into the wound.
19_counts.png [step.core.counts]  Common.
20_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Close the extraction site and any 12 mm port fascia; this is
   difficult in a thick abdominal wall and a suture passer helps. Teach: A port-site hernia through an unclosed 10 mm
   fascial defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing
   all ports at once with the camera already out.
21_specimen.png [step.core.specimen]  Common.
22_debrief.png [step.core.debrief]  Common. Record the start point, bougie size, staple loads, reinforcement, leak
   test result and any hiatal repair.

C. LEFT HEMICOLECTOMY AND SIGMOID COLECTOMY  (folder left-hemicolectomy-sigmoid/)
01_consent-check.png [step.core.consent-check]  Common. Both stoma sites marked. For benign disease, record that the
   decision to operate was shared and why.
02_timeout.png [step.core.timeout]  Common. State the indication (cancer or benign), because it changes the level of
   the vascular tie and the distal margin.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Prepare the perineum as well as the abdomen; urinary catheter in.
06_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
07_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
08_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. For cancer, inspect the liver and peritoneum. For
   diverticular disease, define the extent of the inflamed segment and any fistula before dissecting. Teach: The first
   look answers a question the imaging could not, and it is the only chance to find the second diagnosis before
   attention narrows to the first. Check: avoid going straight to the target and missing a second pathology.
09_left-medial-to-lateral.png [step.bowel.left-medial-to-lateral]  Medial-to-lateral mobilisation of the left colon
   and sigmoid, ureter first: Lift the sigmoid mesentery up and to the left so the inferior mesenteric pedicle tents
   away from the aorta; incise the peritoneum at the sacral promontory beneath it. Enter the areolar plane behind the
   mesocolon (Toldt's fascia) and sweep the retroperitoneum down, working laterally towards the abdominal wall and
   cephalad towards the pancreas. In an inflammatory mass, start medially in uninflamed tissue at the promontory and
   find the ureter there, then work towards the mass. Teach: Lifting the sigmoid and descending mesocolon off the
   retroperitoneum in the embryological plane keeps the lymphatic envelope intact and keeps the left ureter, gonadal
   vessels and hypogastric nerves behind the plane. Check: avoid dissecting too deep, so the ureter and gonadal
   vessels are lifted up with the mesocolon and later divided with it.
10_ima-ligation.png [step.bowel.ima-ligation]  Inferior mesenteric artery and vein ligation: Cancer: skeletonise the
   inferior mesenteric artery near its origin and divide it a short distance from the aorta (high tie), keeping the
   preaortic nerves on the aorta; alternatively divide it just below the left colic artery with clearance of the
   apical nodes (low tie), as the unit and MDT plan. Divide the inferior mesenteric vein separately at the inferior
   border of the pancreas, lateral to the duodenojejunal flexure, when length is needed for a low anastomosis. Cancer:
   oncological tie of the inferior mesenteric artery; for a splenic flexure cancer, also divide the left branch of the
   middle colic vessels. Benign: divide close to the bowel. Teach: The level of the vascular tie sets the lymph node
   yield for a cancer, the reach of the colon to the pelvis, and the blood supply of the proximal limb. Check: avoid
   taking the preaortic nerve plexus with a high tie, causing sexual and bladder dysfunction.
11_splenic-flexure.png [step.bowel.splenic-flexure]  Splenic flexure mobilisation: Decide early whether length is
   needed: routinely for a low anastomosis, selectively for a sigmoid colectomy. Combine approaches: medial
   (continuing the retromesocolic plane up over the pancreas), lateral (along the white line) and from the lesser sac
   (dividing the gastrocolic omentum to the left of the middle colic vessels). Selective for a sigmoid colectomy;
   mobilise whenever the colon will not reach the rectum without tension. Teach: A colorectal anastomosis must lie in
   the pelvis without tension. Check: avoid downward traction on the colon that avulses the splenic capsule.
12_distal-transection.png [step.lhc.distal-transection]  Choosing and dividing the distal resection line: Mobilise
   into the upper mesorectum just far enough to reach a soft, untethered segment; avoid unnecessary pelvic dissection
   in benign disease. Diverticular disease: divide at the upper rectum, identified where the taeniae coli splay out
   into a continuous muscle coat. Teach: Where the distal line falls decides whether the operation cures the problem.
   Check: avoid dividing at the level of the sigmoid in diverticular disease because the pelvis looked difficult.
13_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Wound protector at the extraction site. Exteriorise the colon and choose the proximal
   division point. Teach: Bringing an infected or neoplastic specimen through the abdominal wall unprotected causes
   port-site infection and, in malignancy, port-site recurrence. Check: avoid a bag torn during extraction, spilling
   contents into the wound.
14_bowel-division.png [step.bowel.bowel-division]  Dividing the bowel: Pack off the field with moist swabs before
   division. Divide with a linear cutting stapler, or between non-crushing and crushing clamps, at the point already
   prepared on the mesenteric border. Proximal division on soft, pliable, well-perfused colon. In diverticular disease
   it is not necessary to remove every diverticulum-bearing segment, only the thickened, diseased colon. Teach:
   Division is where contamination of the field happens. Check: avoid including the mesentery in the staple line,
   which bleeds and devascularises the end.
15_circular-anastomosis.png [step.bowel.circular-anastomosis]  Circular stapled colorectal anastomosis (double-
   stapled): Confirm proximal perfusion at the chosen division point (pulsatile bleeding from the marginal vessel, or
   an objective perfusion assessment where available), then insert the anvil into the proximal colon and secure it
   with a purse-string. Check that the proximal limb reaches the pelvis without tension and that the mesentery runs
   straight from the pedicle without a twist. Sigmoid colectomy: colorectal end-to-end or side-to-end circular stapled
   anastomosis. For a splenic flexure left hemicolectomy with a colocolic join, a stapled side-to-side or handsewn
   anastomosis is used instead. Teach: The circular stapler allows an anastomosis deep in the pelvis that cannot be
   sewn by hand. Check: avoid incomplete doughnuts, which mean a gap in the anastomosis: test, repair, and consider
   defunctioning or redoing it.
16_leak-check.png [step.bowel.leak-check]  Checking the repair or anastomosis: Inspect the whole circumference,
   including the mesenteric border and the crotch of a stapled anastomosis. Confirm the lumen is patent by palpation
   between finger and thumb. Air leak test for every colorectal anastomosis: saline in the pelvis, clamp above, air
   via the anus. Teach: A defect found on the table costs a stitch. Check: avoid a negative air test treated as a
   guarantee: it excludes a technical hole, not later ischaemic breakdown.
17_colorectal-bailout.png [step.bowel.colorectal-bailout]  Deciding against an unprotected anastomosis: defunction or
   end colostomy: Decide deliberately, with the reasons recorded: anastomotic height, prior pelvic radiotherapy,
   incomplete doughnuts or a positive leak test, doubtful perfusion, contamination, malnutrition, steroids or
   immunosuppression, and the patient's physiology. Defunction: form a loop ileostomy at the pre-marked right iliac
   fossa site (see the loop ileostomy procedure) after closure of the main wound. In emergency or contaminated
   surgery, a Hartmann's procedure or an anastomosis with defunctioning are valid outcomes, not failures. Teach: A
   colorectal anastomotic leak is the complication that kills after this operation. Check: avoid defunctioning reduces
   the harm of a leak but does not prevent a leak: an ischaemic anastomosis still needs to be redone or abandoned.
18_haemostasis.png [step.core.haemostasis]  Common.
19_counts.png [step.core.counts]  Common.
20_specimen.png [step.core.specimen]  Common. Cancer: mark the high tie for the apical node. Fistula: send the bladder
   or vaginal margin separately if excised.
21_skin-closure.png [step.core.skin-closure]  Common. Close the extraction site fascia and every 10 mm or larger port.
22_debrief.png [step.core.debrief]  Common. Record ureter seen, level of tie, where the anastomosis lies (rectum or
   colon), doughnuts and air test, and the stoma decision.

D. OPEN AND SUBTOTAL CHOLECYSTECTOMY  (folder open-subtotal-cholecystectomy/)
01_consent-check.png [step.core.consent-check]  Common. If converting, the consent must already cover open surgery and
   subtotal cholecystectomy; this is why they belong in every laparoscopic cholecystectomy consent.
02_timeout.png [step.core.timeout]  Common. On conversion, run a fresh team pause: why we are converting, what
   instruments are needed, who else should be called.
03_prophylaxis.png [step.core.prophylaxis]  Common. Usually treatment, not prophylaxis: therapeutic antibiotics for
   cholecystitis; redose for a long operation.
04_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_upper-access.png [step.hpb.upper-access]  Upper abdominal incision and fixed retraction: Choose the incision for
   the operation: right subcostal (Kocher) for the gallbladder and bile duct; bilateral subcostal (rooftop or
   chevron), a reversed L (J) or an upper midline for the liver and pancreas. Divide the rectus and the oblique
   muscles with diathermy, ligating the superior epigastric vessels; preserve the intercostal nerves at the lateral
   end where possible. Right subcostal incision, or an extension of the port sites on conversion. A fixed costal
   retractor makes the open operation safer than the laparoscopic one you abandoned. Teach: Upper abdominal organs sit
   high under the costal margin. Check: avoid a short subcostal incision that forces deep retraction on the liver and
   tears its capsule.
07_exposure.png [step.ochole.exposure]  Open exposure: packs, retraction and landmarks: Decompress a tense gallbladder
   with a trocar and suction, and send the contents for culture. Separate omentum, colon and duodenum from the
   gallbladder with gentle blunt dissection, staying on the gallbladder wall; beware a cholecystoenteric fistula.
   Teach: In a severely inflamed field the landmarks are hidden. Check: avoid sharp dissection of the duodenum off the
   gallbladder, causing a duodenal injury that is missed.
08_fundus-first.png [step.ochole.fundus-first]  Fundus-first (dome-down) dissection on the gallbladder wall: Incise
   the peritoneum around the fundus a few millimetres from the liver and develop the plane between the gallbladder and
   the cystic plate. Work down both sides towards the neck, keeping the gallbladder wall in sight at all times and
   staying anterior to Rouviere's sulcus. Teach: Starting at the fundus, away from the inflamed triangle, lets the
   gallbladder be separated from the liver in a plane that is easier to find. Check: avoid following the plane deep
   behind the gallbladder neck into the hilum, producing a combined bile duct and arterial (vasculobiliary) injury.
09_cholangiogram.png [step.hpb.cholangiogram]  Intra-operative cholangiography: Flush the catheter and tubing to
   remove every air bubble; bubbles mimic stones. Cannulate the cystic duct through a small ductotomy (or, when the
   triangle is obliterated, inject through the gallbladder), and secure the catheter with a clip or a loop. Use when
   the anatomy is uncertain or duct stones are suspected; in a fused triangle, contrast can be injected through the
   gallbladder or Hartmann's pouch. Teach: A cholangiogram shows the anatomy of the ducts and any stones within them.
   Check: avoid accepting a cholangiogram that fills only the distal duct: that pattern can mean the catheter is in
   the common bile duct, not the cystic duct.
10_stop-rule.png [step.ochole.stop-rule]  The stop rule: complete, subtotal or abandon: Ask: can the Critical View of
   Safety (or, open, an equally unambiguous identification of the cystic duct and artery entering the gallbladder) be
   achieved without dissecting in a fused, inflamed triangle? If yes, proceed to divide the cystic duct and artery.
   Teach: Bile duct injuries are rarely technical slips; they are decisions to continue when the anatomy is not clear.
   Check: avoid 'Just a few more minutes' of dissection in a frozen triangle.
11_cystic-control.png [step.ochole.cystic-control]  Dividing the cystic duct and artery (total cholecystectomy): Only
   after unambiguous identification: ligate the cystic artery close to the gallbladder with ties or clips. Milk any
   stones in the cystic duct back into the gallbladder; perform a cholangiogram through the duct if indicated. Teach:
   Division is irreversible. Check: avoid tying a short cystic duct flush with the common duct, narrowing it.
12_subtotal.png [step.ochole.subtotal]  Subtotal cholecystectomy: fenestrating or reconstituting: Open the gallbladder
   along its free surface and remove all stones, including those impacted in Hartmann's pouch; flush and inspect the
   inside of the pouch and the cystic duct orifice. Excise the free anterior wall, leaving the posterior wall on the
   liver where it is fused, and diathermise or scrape the exposed mucosa. Teach: Leaving part of the gallbladder
   behind avoids the triangle altogether. Check: avoid leaving stones behind in the pouch or cystic duct.
13_pringle.png [step.hpb.pringle]  Pringle manoeuvre: sling, clamp, time, release: Open the lesser omentum, pass a
   finger through the foramen of Winslow (epiploic foramen) behind the ligament, and place a sling or tape around it
   before you need it. Clamp by tightening the tourniquet or with a soft vascular clamp, tell the anaesthetist and
   start a clock; call out the time at intervals. For bleeding from the cystic artery stump, the triangle or the liver
   bed: compress, then Pringle, so the bleeding point can be seen and sutured precisely. Teach: Occluding the
   hepatoduodenal ligament stops hepatic arterial and portal inflow. Check: avoid forgetting the clamp is on, or not
   recording the total ischaemic time.
14_duct-injury.png [step.ochole.duct-injury]  Suspected bile duct injury: stop, define, drain, refer: Suspect an
   injury when bile is seen from an unexpected opening, a second duct is found, the cholangiogram does not fill the
   proximal ducts, or a tubular structure was divided before the anatomy was clear. Stop dissecting. Do not place more
   clips or sutures in the hilum. Teach: The outcome of a bile duct injury depends more on what happens next than on
   the injury itself. Check: avoid attempting an end-to-end duct repair or a hepaticojejunostomy without the expertise
   or the right timing.
15_bile-leak-check.png [step.hpb.bile-leak-check]  Checking for bile leakage before closure: Dry the operative field
   and place a clean white swab against the raw surface, duct closure or anastomosis for a minute, then inspect it for
   yellow or green staining. After liver resection, consider a formal leak test where available, injecting saline, air
   or a fat emulsion through the cystic duct stump and watching the cut surface. Check the remnant edges, the cystic
   duct orifice and the liver bed with a white swab. Teach: Bile leaks are among the commonest complications of
   biliary and liver surgery. Check: avoid treating a negative swab test as proof that no leak will occur: necrosis of
   a cauterised duct leaks days later.
16_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. A subhepatic drain after every subtotal cholecystectomy, and after any open
   cholecystectomy with bile staining; record what output would trigger an ERCP. Teach: A drain tells you what is
   happening in a space you cannot see. Check: avoid a drain placed 'just in case', which then becomes a route for
   infection.
17_haemostasis.png [step.core.haemostasis]  Common.
18_counts.png [step.core.counts]  Common.
19_specimen.png [step.core.specimen]  Common. Send the gallbladder, or the excised walls, for histology every time;
   open it in theatre to check for an unexpected mass.
20_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Subcostal incision: close in layers (posterior and anterior sheaths) with a
   slowly absorbable suture. Teach: Burst abdomen and incisional hernia are closure failures, and closure technique is
   one of the few variables entirely under the surgeon's control. Check: avoid large bites taken quickly at the end of
   a long case.
21_skin-closure.png [step.core.skin-closure]  Common.
22_debrief.png [step.core.debrief]  Common. Record why the operation was converted or subtotal, which subtype, whether
   all stones were removed, and what the cholangiogram showed.

E. LAPAROSCOPIC COMMON BILE DUCT EXPLORATION  (folder lap-cbd-exploration/)
01_consent-check.png [step.core.consent-check]  Common. Consent covers post-operative ERCP, a T-tube or stent, and
   conversion.
02_timeout.png [step.core.timeout]  Common. Confirm the choledochoscope works, the C-arm is in place, and the fall-
   back ERCP plan is agreed.
03_prophylaxis.png [step.core.prophylaxis]  Common. Bile with stones is often colonised; treat cholangitis with
   therapeutic antibiotics per local protocol.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
07_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Add a 5 mm port in the right upper quadrant in line with the cystic or common duct for the
   choledochoscope. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
08_cvs-first.png [step.cbde.cvs-first]  Critical View of Safety before any duct is opened: Dissect the hepatocystic
   triangle to the Critical View of Safety with lateral retraction of the infundibulum. Clip and divide the cystic
   artery; place a clip on the cystic duct close to the gallbladder only, keeping the duct open for cholangiography
   and transcystic access. Teach: Duct exploration means deliberately opening a duct. Check: avoid removing the
   gallbladder first and losing the retraction that exposes the duct.
09_cholangiogram.png [step.hpb.cholangiogram]  Intra-operative cholangiography: Flush the catheter and tubing to
   remove every air bubble; bubbles mimic stones. Cannulate the cystic duct through a small ductotomy (or, when the
   triangle is obliterated, inject through the gallbladder), and secure the catheter with a clip or a loop. Define
   stone number, size and position, the duct diameter, and the cystic duct anatomy: these decide the route. Teach: A
   cholangiogram shows the anatomy of the ducts and any stones within them. Check: avoid accepting a cholangiogram
   that fills only the distal duct: that pattern can mean the catheter is in the common bile duct, not the cystic
   duct.
10_route-decision.png [step.cbde.route-decision]  Choosing the route: transcystic or choledochotomy: Favour
   transcystic when stones are few and small enough to pass through the (dilated) cystic duct, lie below the cystic
   duct junction, and the cystic duct is not too narrow or tortuous. Favour choledochotomy when stones are large,
   numerous, or above the cystic junction, and the common duct is dilated. Many surgeons use a minimum duct diameter
   of around 8 mm; follow your unit's threshold. Teach: The transcystic route leaves the common duct intact and avoids
   a duct closure, so it has fewer bile leaks and strictures. Check: avoid choledochotomy in a narrow duct because it
   is the technique the surgeon prefers.
11_transcystic.png [step.cbde.transcystic]  Transcystic exploration: Extend the cystic ductotomy close to the common
   duct junction and, if needed, dilate the cystic duct gently with a balloon dilator under vision. Pass a small-
   calibre choledochoscope or a wire basket under fluoroscopy down the duct, capture stones and withdraw them through
   the cystic duct; small stones may be flushed through the ampulla with saline. Teach: Working through the cystic
   duct uses an opening that will be ligated anyway, so clearance can be achieved without any incision in the common
   duct. Check: avoid over-dilating the cystic duct and tearing it into the common duct.
12_choledochotomy.png [step.cbde.choledochotomy]  Anterior vertical choledochotomy: Clear the peritoneum over the
   anterior supraduodenal duct below the cystic duct junction, with minimal lateral dissection. Place stay sutures
   either side if helpful, then open the duct vertically with scissors or a micro-knife, without energy. Teach: A
   short vertical incision on the front of the supraduodenal duct avoids the axial arteries at 3 and 9 o'clock and can
   be closed without narrowing the duct. Check: avoid using diathermy on the duct wall, causing a thermal stricture.
13_clearance.png [step.cbde.clearance]  Stone clearance and confirming a clear duct: Irrigate with saline under
   pressure to flush stones out of the opening; use the choledochoscope to see each remaining stone and capture it
   with a basket or a balloon. Inspect the duct distally to the ampulla (seeing it open) and proximally to both
   hepatic ducts. Teach: A retained stone defeats the purpose of the operation and stresses the duct closure. Check:
   avoid pushing a stone up into the intrahepatic ducts and losing it.
14_duct-closure.png [step.cbde.duct-closure]  Closing the choledochotomy: Primary closure with a fine absorbable
   monofilament, continuous or interrupted, with small even bites, when the duct is clear and the ampulla drains
   freely. Close over a T-tube, brought out through a separate stab and with the closure snug around it, when there is
   distal oedema, cholangitis or concern about retained fragments, or an antegrade stent as the unit prefers. Teach:
   The closure must be watertight without narrowing the duct. Check: avoid bites that are too deep or too wide,
   narrowing the lumen.
15_abandon.png [step.cbde.abandon]  When the duct cannot be cleared: drain, stent or convert: If clearance fails after
   reasonable attempts, place an antegrade stent across the ampulla or a T-tube so that the duct is drained and ERCP
   is easier. If the duct has not been opened, ligate the cystic duct, complete the cholecystectomy and arrange post-
   operative ERCP. Teach: An uncleared duct is not a failure if it is left safe. Check: avoid repeated instrumentation
   of an impacted stone until the duct perforates.
16_bile-leak-check.png [step.hpb.bile-leak-check]  Checking for bile leakage before closure: Dry the operative field
   and place a clean white swab against the raw surface, duct closure or anastomosis for a minute, then inspect it for
   yellow or green staining. After liver resection, consider a formal leak test where available, injecting saline, air
   or a fat emulsion through the cystic duct stump and watching the cut surface. Inspect the choledochotomy closure
   and the cystic duct stump with a white swab. Teach: Bile leaks are among the commonest complications of biliary and
   liver surgery. Check: avoid treating a negative swab test as proof that no leak will occur: necrosis of a
   cauterised duct leaks days later.
17_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. Subhepatic drain after every choledochotomy; record what output would prompt
   imaging. Teach: A drain tells you what is happening in a space you cannot see. Check: avoid a drain placed 'just in
   case', which then becomes a route for infection.
18_haemostasis.png [step.core.haemostasis]  Common.
19_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Complete the cholecystectomy off the cystic plate as in a standard laparoscopic
   cholecystectomy, then bag the gallbladder and any retrieved stones. Teach: Bringing an infected or neoplastic
   specimen through the abdominal wall unprotected causes port-site infection and, in malignancy, port-site
   recurrence. Check: avoid a bag torn during extraction, spilling contents into the wound.
20_counts.png [step.core.counts]  Common. Count baskets, balloons and stones retrieved; a lost stone in the abdomen is
   retrieved.
21_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
22_debrief.png [step.core.debrief]  Common. Record the route, stones retrieved, whether clearance was confirmed and
   how, the closure method, and any planned ERCP.

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
  surgx-lap-nissen-fundoplication-steps.zip   (folder lap-nissen-fundoplication/)
  surgx-lap-sleeve-gastrectomy-steps.zip   (folder lap-sleeve-gastrectomy/)
  surgx-left-hemicolectomy-sigmoid-steps.zip   (folder left-hemicolectomy-sigmoid/)
  surgx-open-subtotal-cholecystectomy-steps.zip   (folder open-subtotal-cholecystectomy/)
  surgx-lap-cbd-exploration-steps.zip   (folder lap-cbd-exploration/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
