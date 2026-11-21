---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 14 (D2 gastrectomy for gastric cancer, Oesophagectomy, Transurethral resection of bladder tumour, Scrotal exploration with bilateral orchidopexy, Suprapubic catheter insertion, Ureteroscopy with laser lithotripsy): Gemini image prompt (112 images, 6 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant surgical oncologists and urologists. You are making 112 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. D2 gastrectomy for gastric cancer                              22 images
  B. Oesophagectomy (Ivor Lewis principles)                         22 images
  C. Transurethral resection of bladder tumour (TURBT)              18 images
  D. Scrotal exploration with bilateral orchidopexy                 16 images
  E. Suprapubic catheter insertion                                  14 images
  F. Ureteroscopy with laser lithotripsy                            20 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Urological Association (AUA) and Endourological Society, Surgical Management of Stones: AUA/Endourological Society Guideline; Annals of Surgery, International consensus on standardization of data collection for complications associated with esophagectomy: Esophagectomy Complications Consensus Group (ECCG) (Low DE et al.); British Association of Urological Surgeons (BAUS), British Association of Urological Surgeons' suprapubic catheter practice guidelines (Harrison SCW et al., BJU International); ERAS Society, Consensus guidelines for enhanced recovery after gastrectomy: Enhanced Recovery After Surgery (ERAS) Society recommendations (Mortensen K et al., Br J Surg); ERAS Society, Guidelines for perioperative care in esophagectomy: Enhanced Recovery After Surgery (ERAS) Society recommendations (Low DE et al., World J Surg); Elsevier, Campbell-Walsh-Wein Urology; European Association of Urology (EAU) and European Society for Paediatric Urology (ESPU), EAU Guidelines on Paediatric Urology: acute scrotum in children; European Association of Urology (EAU), EAU Guidelines on Non-muscle-invasive Bladder Cancer; European Association of Urology (EAU), EAU Guidelines on Urolithiasis; European Association of Urology Nurses (EAUN), Evidence-based guidelines for best practice in urological health care: catheterisation, indwelling catheters in adults, urethral and suprapubic; European Society for Medical Oncology (ESMO), Gastric cancer: ESMO Clinical Practice Guideline for diagnosis, treatment and follow-up (Lordick F et al., Ann Oncol); European Society for Medical Oncology (ESMO), Oesophageal cancer: ESMO Clinical Practice Guideline for diagnosis, treatment and follow-up (Obermannova R et al., Ann Oncol); Japanese Gastric Cancer Association (JGCA), Japanese Gastric Cancer Treatment Guidelines 2021 (6th edition) (Gastric Cancer); Lancet Oncology, Surgical treatment of gastric cancer: 15-year follow-up results of the randomised nationwide Dutch D1D2 trial (Songun I et al.); National Institute for Health and Care Excellence (NICE), Bladder cancer: diagnosis and management (NG2); National Institute for Health and Care Excellence (NICE), Oesophago-gastric cancer: assessment and management in adults (NG83); National Institute for Health and Care Excellence (NICE), Renal and ureteric stones: assessment and management (NG118); New England Journal of Medicine, Preoperative chemoradiotherapy for esophageal or junctional cancer (CROSS) (van Hagen P et al.); The Lancet, Perioperative chemotherapy with fluorouracil plus leucovorin, oxaliplatin, and docetaxel versus fluorouracil or capecitabine plus cisplatin and epirubicin for locally advanced, resectable gastric or gastro-oesophageal junction adenocarcinoma (FLOT4) (Al-Batran SE et al.)).
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
- A. Supine, arms out, with a reverse Trendelenburg tilt available; some surgeons use legs apart (French position) for
  laparoscopic gastrectomy. Self-retaining upper abdominal (costal) retractor mount fixed before draping.
- B. Abdominal phase: supine with reverse Trendelenburg (open or laparoscopic). Thoracic phase: left lateral decubitus
  (right side up) with lung isolation through a double-lumen tube or bronchial blocker, or semi-prone for a
  thoracoscopic approach.
- C. Lithotomy with padded stirrups. For lateral wall tumours, plan with the anaesthetist: general anaesthesia with
  neuromuscular blockade or an obturator nerve block reduces the obturator reflex.
- D. Supine with the legs slightly abducted; the penis taped up onto the abdomen.
- E. Supine, with slight head-down tilt to move bowel away from the bladder; lithotomy if cystoscopic guidance is
  used.
- F. Lithotomy, legs in padded supports, with the ipsilateral leg lowered or the contralateral leg raised if it helps
  the semirigid scope align with the ureter. C-arm positioned so that the whole ureter and kidney can be screened
  before draping.
Step-specific facts:
- A. Anatomy: Arterial supply: left gastric (from coeliac trunk) and right gastric (usually from the proper or common
  hepatic) along the lesser curve; right gastroepiploic (from gastroduodenal) and left gastroepiploic (from splenic)
  along the greater curve; short gastrics from the splenic artery to the fundus. Must be right: Explore and stage
  before any irreversible step; stop if metastatic disease is found. Divide vessels only after identifying the common
  hepatic, splenic and gastroduodenal arteries; know whether a replaced left hepatic artery is present.
- B. Anatomy: The gastric conduit survives on the right gastroepiploic artery and the gastroepiploic arcade along the
  greater curve, with contributions from the right gastric artery; the left gastric and short gastric vessels are
  divided. Must be right: Preserve the right gastroepiploic arcade at all times; the conduit's survival depends on it.
  Stop if unexpected metastatic disease is found in the abdomen before committing to the chest.
- C. Anatomy: The bladder wall is thin, particularly at the dome and in an elderly, distended bladder. Lateral wall
  resection lies close to the obturator nerve. The dome and posterior wall are covered by peritoneum: perforation here
  can be intraperitoneal. Must be right: Map every tumour (number, size, site, appearance) before the first cut, and
  record it as a bladder diagram. Resect completely, including the base, and send the base as a separate specimen
  containing detrusor muscle.
- D. Anatomy: The tunica vaginalis normally attaches to the posterior testis. A high attachment (the bell-clapper
  deformity) lets the testis rotate inside it, and it is usually bilateral. Must be right: Do not delay theatre for
  investigations when torsion is clinically likely. Always assess viability after detorsion and warming before
  deciding on fixation or orchidectomy.
- E. Anatomy: The full bladder rises out of the pelvis and pushes the peritoneal reflection upwards, leaving an
  extraperitoneal window above the pubic symphysis. An empty bladder lies behind the pubis, with peritoneum and bowel
  above and in front of it. Must be right: Never insert a suprapubic catheter into a bladder that is not clearly full.
  Aspirate urine with the seeker needle before inserting the trocar; no urine means stop.
- F. Anatomy: The ureter has three natural narrowings where stones lodge: the pelviureteric junction, the crossing of
  the iliac vessels at the pelvic brim, and the vesicoureteric junction, which is the narrowest. Must be right: A
  safety guidewire stays in the ureter throughout, except when a flexible scope is passed over its own working wire
  and the safety wire is retained alongside. Never force a ureteroscope or an access sheath against resistance.
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

A. D2 GASTRECTOMY FOR GASTRIC CANCER  (folder d2-gastrectomy/)
01_consent-check.png [step.core.consent-check]  Common. Consent covers both subtotal and total gastrectomy if the
   margin is in doubt, adjacent organ resection, and stopping without resection.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Confirm staging laparoscopy and cytology results, neoadjuvant chemotherapy completed and restaging done,
   and the planned extent of gastrectomy and lymphadenectomy. Teach: A cancer operation is one part of a treatment
   plan agreed by a multidisciplinary team. Check: avoid accepting an MDT note that predates new imaging or a changed
   biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. Clean-contaminated upper gastrointestinal surgery: antibiotic
   within the hour before incision, redosed for a long operation; extended pharmacological thromboprophylaxis after
   cancer surgery per local policy.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_midline.png [step.abd.midline]  Midline laparotomy incision: Incise through skin, fat and linea alba, staying in
   the midline: drifting off it bleeds and weakens the closure. Enter the peritoneum between forceps under direct
   vision, then extend with fingers protecting the bowel. Upper midline from the xiphisternum, extended below the
   umbilicus as needed; excise the xiphoid if it limits access to the hiatus. Teach: The midline is fast, bloodless
   and extensible in both directions, which is exactly what an unknown pathology needs. Check: avoid entering blind
   through a scar.
08_exploration.png [step.abd.exploration]  Systematic exploration: Follow the same sequence every time: liver and
   gallbladder, stomach and duodenum, spleen, small bowel from duodenojejunal flexure to caecum, colon and rectum,
   pelvis, retroperitoneum, hernial orifices from inside. Run the small bowel hand over hand, both surfaces, in one
   direction. Peritoneum, liver, omentum, pelvis and ovaries in a woman (Krukenberg deposits), then the tumour's
   fixity to the pancreas and the coeliac axis. Teach: The purpose of a laparotomy is to find out. Check: avoid
   stopping the exploration when the expected pathology is found.
09_unresectable-bailout.png [step.onco.unresectable-bailout]  Unexpected metastatic or unresectable disease: stop and
   decide: Explore before committing: peritoneum, liver surfaces, omentum, pelvis and the tumour's fixity, and take
   peritoneal washings for cytology if that is local practice. Biopsy suspicious deposits and send them for frozen
   section where it will change the decision. Teach: Peritoneal or liver metastases missed by staging, or a tumour
   fixed to structures that cannot be resected, mean a major resection will add risk without curing the patient.
   Check: avoid pressing on with a palliative major resection because the patient was told they would have it.
10_omentum-infrapyloric.png [step.gast.omentum-infrapyloric]  Greater curve: omentum, left gastroepiploic and
   infrapyloric stations: Separate the greater omentum from the transverse colon in the avascular plane, removing it
   with the specimen for advanced tumours as per JGCA guidance; enter the lesser sac. Towards the left, divide the
   left gastroepiploic vessels at their origin from the splenic vessels (station 4sb), preserving the spleen and the
   short gastrics for a distal gastrectomy. Teach: The greater curve nodes (stations 4sb, 4d and 6) drain the distal
   stomach. Check: avoid entering the transverse mesocolon instead of the plane between omentum and colon.
11_duodenal-transection.png [step.gast.duodenal-transection]  Suprapyloric clearance and duodenal transection: Open
   the lesser omentum close to the liver, noting any aberrant left hepatic artery, and identify the proper hepatic
   artery and the gastroduodenal artery. Clear station 5 and divide the right gastric artery at its origin; clear
   station 12a along the proper hepatic artery, keeping the common bile duct and portal vein in view. Teach: The
   suprapyloric and hepatoduodenal nodes (stations 5 and 12a) drain the antrum and pylorus, and the duodenal stump is
   where a leak is often fatal. Check: avoid excessive skeletonisation of the duodenum, leaving an ischaemic stump.
12_nodal-clearance.png [step.onco.nodal-clearance]  En bloc nodal clearance by named level or station: Before
   starting, state which levels or stations are to be cleared, as agreed at the MDT, and which non-lymphatic
   structures are to be preserved. Define the boundary structures first (vessels, nerves, muscles), then sweep the
   fibrofatty tissue off them towards the specimen, keeping the packet in one piece. Suprapancreatic clearance:
   station 8a along the common hepatic artery, 12a along the proper hepatic artery, 9 around the coeliac trunk and 11p
   along the proximal splenic artery (plus 11d for total gastrectomy), swept upwards towards the specimen. Teach: A
   lymphadenectomy stages the cancer and, in several cancers, controls regional disease. Check: avoid node picking
   instead of an en bloc clearance, which lowers yield and leaves disease behind.
13_left-gastric-pedicle.png [step.onco.left-gastric-pedicle]  Left gastric pedicle divided at its origin with its
   nodes: Open the lesser sac and lift the stomach to display the left gastric pedicle on the posterior abdominal
   wall. Define the common hepatic and splenic arteries and the coeliac trunk before ligating anything, so you know
   which vessel you are dividing. Teach: The left gastric artery carries the main lymphatic drainage of the lesser
   curve and the distal oesophagus. Check: avoid ligating the common hepatic artery in mistake for the left gastric.
14_proximal-transection.png [step.gast.proximal-transection]  Proximal clearance and transection: subtotal remnant or
   oesophagus: Clear stations 1 and 3 along the lesser curve towards the cardia, and for total gastrectomy station 2,
   the short gastrics (4sa) and station 11d, preserving the spleen. Decide the transection line using the JGCA margin
   guidance for the tumour's depth and growth pattern (wider for infiltrative tumours), measured on the opened or
   palpated stomach; send the margin for frozen section when in doubt. Teach: The proximal margin determines whether
   the resection is curative, and the tumour's growth pattern sets how much margin is needed. Check: avoid a remnant
   too small or too poorly perfused after division of the short gastrics and left gastric.
15_reconstruction.png [step.gast.reconstruction]  Reconstruction: Billroth or Roux-en-Y, tension-free and tested:
   Subtotal: choose Billroth I, Billroth II or Roux-en-Y gastrojejunostomy according to the remnant size, tension and
   unit preference. Total: Roux-en-Y oesophagojejunostomy, usually with a circular stapler, and a jejunojejunostomy
   far enough downstream to prevent bile reflux. Bring the jejunal limb up without tension or twist, through the
   mesocolon (retrocolic) or in front of the colon (antecolic), checking the limb's colour and mesenteric pulsation.
   Teach: The reconstruction must carry food without bile reflux, and the anastomosis must heal. Check: avoid an
   oesophagojejunostomy under tension because the Roux limb mesentery was not divided far enough.
16_feeding-jejunostomy.png [step.onco.feeding-jejunostomy]  Feeding jejunostomy when early enteral access is planned:
   Decide in advance, per unit protocol and the patient's nutritional risk, whether a jejunostomy is indicated. Choose
   a loop of proximal jejunum distal to any anastomosis that will lie without tension against the left upper abdominal
   wall. Most often used after total gastrectomy or in a malnourished patient; follow unit protocol. Teach: After an
   upper gastrointestinal cancer resection, oral intake may be delayed or stopped by a leak. Check: avoid fixing the
   loop so it kinks or twists, causing obstruction.
17_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Dissect the nodal stations off the specimen on a back table, or label them as you go, and
   send each in a named pot so the pathologist can report the yield and involved stations. Teach: Margin status and
   nodal yield are reported by the pathologist, but only from a specimen they can orient. Check: avoid a single suture
   with no stated convention.
18_haemostasis.png [step.core.haemostasis]  Common. Inspect the suprapancreatic bed, the duodenal stump, the splenic
   hilum and the short gastric stumps.
19_counts.png [step.core.counts]  Common.
20_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Teach: Burst abdomen and incisional hernia are closure failures, and closure
   technique is one of the few variables entirely under the surgeon's control. Check: avoid large bites taken quickly
   at the end of a long case.
21_skin-closure.png [step.core.skin-closure]  Common.
22_debrief.png [step.core.debrief]  Common.

B. OESOPHAGECTOMY (IVOR LEWIS PRINCIPLES)  (folder ivor-lewis-oesophagectomy/)
01_consent-check.png [step.core.consent-check]  Common. Consent covers stopping without resection, feeding
   jejunostomy, critical care and the realistic risk of a leak.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Confirm neoadjuvant treatment completed, restaging done, tumour level suitable for an intrathoracic
   anastomosis, and the conduit plan. Teach: A cancer operation is one part of a treatment plan agreed by a
   multidisciplinary team. Check: avoid accepting an MDT note that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common. Agree the lung isolation plan, the repositioning sequence, blood
   availability and the critical care bed before starting.
04_prophylaxis.png [step.core.prophylaxis]  Common. Clean-contaminated surgery spanning two cavities: antibiotic
   before incision and redosed for duration; mechanical and pharmacological thromboprophylaxis.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_midline.png [step.abd.midline]  Midline laparotomy incision: Incise through skin, fat and linea alba, staying in
   the midline: drifting off it bleeds and weakens the closure. Enter the peritoneum between forceps under direct
   vision, then extend with fingers protecting the bowel. Upper midline for an open abdominal phase, or laparoscopic
   ports for a hybrid or minimally invasive approach. Teach: The midline is fast, bloodless and extensible in both
   directions, which is exactly what an unknown pathology needs. Check: avoid entering blind through a scar.
08_exploration.png [step.abd.exploration]  Systematic exploration: Follow the same sequence every time: liver and
   gallbladder, stomach and duodenum, spleen, small bowel from duodenojejunal flexure to caecum, colon and rectum,
   pelvis, retroperitoneum, hernial orifices from inside. Run the small bowel hand over hand, both surfaces, in one
   direction. Peritoneum, liver and nodes at the coeliac axis before any irreversible step. Teach: The purpose of a
   laparotomy is to find out. Check: avoid stopping the exploration when the expected pathology is found.
09_unresectable-bailout.png [step.onco.unresectable-bailout]  Unexpected metastatic or unresectable disease: stop and
   decide: Explore before committing: peritoneum, liver surfaces, omentum, pelvis and the tumour's fixity, and take
   peritoneal washings for cytology if that is local practice. Biopsy suspicious deposits and send them for frozen
   section where it will change the decision. Teach: Peritoneal or liver metastases missed by staging, or a tumour
   fixed to structures that cannot be resected, mean a major resection will add risk without curing the patient.
   Check: avoid pressing on with a palliative major resection because the patient was told they would have it.
10_conduit-mobilisation.png [step.oes.conduit-mobilisation]  Mobilise the stomach as a conduit and dissect the hiatus:
   Divide the greater omentum outside the gastroepiploic arcade, leaving a cuff of omentum along the arcade, and
   identify the right gastroepiploic artery near the pylorus without skeletonising it. Divide the short gastric
   vessels close to the spleen and mobilise the fundus; free the posterior stomach from the pancreas. Teach: The
   stomach will replace the oesophagus, and it survives on a single vascular arcade along its greater curve. Check:
   avoid diathermy or clips too close to the arcade.
11_left-gastric-pedicle.png [step.onco.left-gastric-pedicle]  Left gastric pedicle divided at its origin with its
   nodes: Open the lesser sac and lift the stomach to display the left gastric pedicle on the posterior abdominal
   wall. Define the common hepatic and splenic arteries and the coeliac trunk before ligating anything, so you know
   which vessel you are dividing. Take the left gastric, coeliac and common hepatic nodes with the specimen; the
   conduit now depends on the right gastroepiploic arcade. Teach: The left gastric artery carries the main lymphatic
   drainage of the lesser curve and the distal oesophagus. Check: avoid ligating the common hepatic artery in mistake
   for the left gastric.
12_feeding-jejunostomy.png [step.onco.feeding-jejunostomy]  Feeding jejunostomy when early enteral access is planned:
   Decide in advance, per unit protocol and the patient's nutritional risk, whether a jejunostomy is indicated. Choose
   a loop of proximal jejunum distal to any anastomosis that will lie without tension against the left upper abdominal
   wall. Teach: After an upper gastrointestinal cancer resection, oral intake may be delayed or stopped by a leak.
   Check: avoid fixing the loop so it kinks or twists, causing obstruction.
13_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Close the abdomen fully before turning the patient for the chest. Teach: Burst
   abdomen and incisional hernia are closure failures, and closure technique is one of the few variables entirely
   under the surgeon's control. Check: avoid large bites taken quickly at the end of a long case.
14_thoracic-access.png [step.oes.thoracic-access]  Reposition and enter the right chest with lung isolation: Turn to
   the left lateral decubitus position, recheck lung isolation with the anaesthetist, and confirm the right lung
   deflates. Enter the chest through a right posterolateral thoracotomy, commonly in the fifth intercostal space, or
   by thoracoscopy with ports placed as per unit practice. Teach: The mid and lower thoracic oesophagus is best
   reached from the right, where the aorta is not in the way. Check: avoid opening the chest before lung isolation is
   confirmed.
15_thoracic-mobilisation.png [step.oes.thoracic-mobilisation]  Divide the azygos arch and mobilise the oesophagus en
   bloc: Divide the azygos arch with a vascular stapler or secure ligatures. Open the mediastinal pleura along the
   oesophagus and mobilise it with its periosophageal tissue, using the pericardium and airway in front and the aorta
   behind as boundaries; clip the oesophageal branches from the aorta. Teach: The thoracic oesophagus is surrounded by
   the airway, the aorta and the thoracic duct. Check: avoid energy device heat spreading to the membranous airway.
16_nodal-clearance.png [step.onco.nodal-clearance]  En bloc nodal clearance by named level or station: Before
   starting, state which levels or stations are to be cleared, as agreed at the MDT, and which non-lymphatic
   structures are to be preserved. Define the boundary structures first (vessels, nerves, muscles), then sweep the
   fibrofatty tissue off them towards the specimen, keeping the packet in one piece. Mediastinal stations:
   paraoesophageal, subcarinal and lower mediastinal nodes, taken en bloc with the oesophagus where possible, with the
   membranous airway and the aorta in view. Teach: A lymphadenectomy stages the cancer and, in several cancers,
   controls regional disease. Check: avoid node picking instead of an en bloc clearance, which lowers yield and leaves
   disease behind.
17_anastomosis.png [step.oes.anastomosis]  Form the conduit, deliver it untwisted, and make the anastomosis: Pull the
   stomach into the chest through the hiatus with the specimen, keeping the greater curve orientation constant so the
   conduit does not rotate. Create a gastric tube along the greater curve with linear staplers, removing the lesser
   curve and cardia with the specimen; oversew the staple line if that is unit practice. Teach: Leak and conduit
   necrosis are the complications that kill after oesophagectomy. Check: avoid a conduit delivered with a twist.
18_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Mark the proximal oesophageal margin and the gastric end, and label separately sent nodal
   stations. Teach: Margin status and nodal yield are reported by the pathologist, but only from a specimen they can
   orient. Check: avoid a single suture with no stated convention.
19_haemostasis.png [step.core.haemostasis]  Common. Inspect the aortic branch stumps, the azygos stumps, the bronchial
   vessels and the intercostal wound; place chest drains as per unit protocol and re-expand the lung under vision.
20_counts.png [step.core.counts]  Common. Count at closure of the abdomen and again at closure of the chest.
21_skin-closure.png [step.core.skin-closure]  Common. Close the thoracotomy in layers with rib approximation sutures
   that avoid the intercostal nerve below.
22_debrief.png [step.core.debrief]  Common. Hand over to critical care: conduit appearance, anastomosis type and
   level, nasogastric tube position (not to be repositioned blindly), drain plan, feeding plan, and leak warning
   signs.

C. TRANSURETHRAL RESECTION OF BLADDER TUMOUR (TURBT)  (folder uro-turbt/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common. Confirm the instillation plan at the time-out, and whether the tumour is
   on a lateral wall.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Draw the bladder
   diagram: number, size, site and appearance of every tumour, and suspicious flat areas. Teach: Every endoscopic
   bladder operation starts with a complete map. Check: avoid missing the dome and the anterior wall because the
   bladder was overfilled or the lens never rotated upwards.
07_bimanual.png [step.turbt.bimanual]  Bimanual examination under anaesthesia: With the bladder empty, perform a
   bimanual examination before resection, and repeat it after resection. Record whether a mass is palpable, mobile or
   fixed to the pelvic side wall. Teach: A palpable or fixed mass suggests muscle-invasive or locally advanced
   disease, and this is the only moment it can be felt with the abdomen relaxed. Check: avoid skipping it because the
   CT has been done; the two give complementary information.
08_resectoscope.png [step.uro.resectoscope]  Resectoscope set-up, irrigation fluid and urethral calibration: Confirm
   the energy platform with the team. Monopolar resection needs a non-conducting, non-haemolytic fluid such as
   glycine; bipolar resection uses normal saline. Hang the irrigant at a height that gives a clear view at the lowest
   pressure needed; higher pressure increases fluid absorption. Teach: The choice of energy and irrigation fluid
   decides whether a patient can develop TUR syndrome, and an under-calibrated urethra is where post-operative
   strictures come from. Check: avoid using saline with a monopolar loop. It does not cut, and the team turns the
   power up instead of checking the fluid.
09_resect.png [step.turbt.resect]  Resection of the exophytic tumour: Keep the bladder only partially filled so the
   wall is thicker and the tumour is close to the loop. Resect the exophytic part in controlled strokes, or en bloc
   for suitable small tumours, using cutting current and minimal coagulation. Teach: Removing the bulk first exposes
   the base and the stalk, and gives the pathologist the grade. Check: avoid resecting into an overdistended dome.
10_base.png [step.turbt.base]  Base resection with detrusor muscle: Resect the base of the tumour into the underlying
   muscle and send it as a separate specimen. Biopsy the edges where the margin is unclear, and any suspicious flat
   red areas with cold-cup forceps. Teach: Stage depends on whether the tumour invades the detrusor. Check: avoid a
   superficial base that misses muscle.
11_chip-evacuation.png [step.uro.chip-evacuation]  Chip evacuation and specimen collection: Evacuate the chips with an
   Ellik evacuator or a bladder syringe through the sheath until no further fragments return. Re-inspect the bladder
   for remaining chips, especially in the dome and behind the bladder neck. Keep the exophytic tumour and the base in
   separate labelled pots. Teach: Retained chips block the catheter and cause clot retention in recovery, and every
   chip is tissue the pathologist needs for staging or for an incidental cancer. Check: avoid aggressive Ellik
   pressure when a perforation is suspected, pushing fluid and chips outside the bladder.
12_haemostasis.png [step.core.haemostasis]  Common. Coagulate the resection edges and base at low bladder volume,
   sparingly, to avoid thermal injury through a thin wall.
13_perforation-check.png [step.uro.perforation-check]  Final inspection: perforation, orifices and landmarks: Inspect
   the resected area at low pressure: fat seen through the capsule or bladder wall, or black space beyond, means
   perforation. Check that both ureteric orifices are intact and that the verumontanum and external sphincter are
   preserved. A suspected perforation cancels the immediate chemotherapy instillation. Say so aloud and write it down.
   Teach: A perforation recognised in theatre changes the plan and is usually manageable; one recognised in recovery
   presents as abdominal distension, pain and fluid overload, and costs time the patient may not have. Check: avoid
   finishing the case because it is nearly finished when a perforation is seen.
14_three-way-catheter.png [step.uro.three-way-catheter]  Three-way catheter and continuous irrigation: Pass a three-
   way irrigating catheter of adequate size over an introducer if needed, confirming free drainage before inflating
   the balloon. Inflate the balloon with sterile water to the volume the manufacturer specifies, and record catheter
   type, size and balloon volume in the note. Teach: After a resection the bladder must stay empty and free of clot
   while the raw surface stops oozing. Check: avoid the catheter tip passing into a false passage under the bladder
   neck after a TURP; the balloon is then inflated in the prostatic fossa.
15_instillation.png [step.turbt.instillation]  Immediate single post-operative chemotherapy instillation decision:
   Decide in theatre whether the patient meets the criteria in the current bladder cancer guideline. Do not instil if
   a perforation is suspected or if continuous irrigation is needed for bleeding. Teach: A single early instillation
   reduces recurrence in appropriately selected tumours, but in a perforated or bleeding bladder it can cause serious
   extravesical toxicity. Check: avoid instilling into a bladder with an unrecognised perforation.
16_counts.png [step.core.counts]  Common.
17_specimen.png [step.core.specimen]  Common.
18_debrief.png [step.core.debrief]  Common.

D. SCROTAL EXPLORATION WITH BILATERAL ORCHIDOPEXY  (folder uro-scrotal-exploration/)
01_consent-check.png [step.core.consent-check]  Common. Record the time of onset of pain and the consent for bilateral
   fixation and possible orchidectomy.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis is not routinely needed for clean scrotal
   surgery; follow local policy.
04_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_incision.png [step.scrot.incision]  Scrotal incision and opening the tunica vaginalis: Incise along the median
   raphe, or transversely over the affected hemiscrotum. Divide the dartos and open the tunica vaginalis of the
   affected side; note the colour of any hydrocele fluid (blood-stained suggests torsion). Teach: A midline raphe
   incision reaches both testes through one wound, which matters because both sides will be fixed. Check: avoid an
   incision too small to deliver the testis comfortably.
07_detort.png [step.scrot.detort]  Identify torsion and detort: Identify the twist in the cord, count the turns, and
   note the direction. Untwist the cord fully, until the cord lies straight and the epididymis is in its normal
   posterior position. Teach: Restoring flow is the whole purpose of the operation. Check: avoid incomplete detorsion
   because the number of turns was not counted.
08_viability.png [step.scrot.viability]  Assess viability after warming: Wrap the testis in warm saline swabs and wait
   several minutes while the other side is explored. Reassess colour, and if doubt remains, make a small incision in
   the tunica albuginea and observe for fresh arterial bleeding. Teach: A testis that looks black on delivery often
   recovers colour after detorsion. Check: avoid orchidectomy on first sight of a dark testis.
09_orchidectomy.png [step.scrot.orchidectomy]  Orchidectomy for a non-viable testis: Transfix and ligate the spermatic
   cord in two places above the necrotic tissue, separately ligating the vas if preferred. Remove the testis and send
   it for histology. Teach: A dead testis left in place risks infection and prolonged pain. Check: avoid a single
   ligature on a thick oedematous cord that slips and bleeds into the scrotum.
10_fixation.png [step.scrot.fixation]  Fixation of the affected testis: Fix the testis to the scrotal wall by sutures
   through the tunica albuginea at several points, or by placing it in a dartos pouch, per surgeon practice. Avoid the
   epididymis and the vessels; place sutures superficially in the tunica albuginea. Teach: The bell-clapper anatomy
   that allowed the torsion is still there after detorsion. Check: avoid deep sutures into the testicular parenchyma.
11_contralateral.png [step.scrot.contralateral]  Contralateral fixation: Open the contralateral tunica vaginalis
   through the same midline incision or a separate one. Fix the contralateral testis by the same method. Teach: The
   anatomical predisposition is usually bilateral. Check: avoid omitting it because the operation went well on the
   affected side.
12_haemostasis.png [step.core.haemostasis]  Common. Scrotal haematoma is the commonest complication. Use bipolar
   diathermy on the dartos edges.
13_counts.png [step.core.counts]  Common.
14_specimen.png [step.core.specimen]  Common. Only if an orchidectomy or appendix testis excision was performed.
15_skin-closure.png [step.core.skin-closure]  Common. Close the dartos and the skin in layers with absorbable sutures.
16_debrief.png [step.core.debrief]  Common.

E. SUPRAPUBIC CATHETER INSERTION  (folder uro-suprapubic-catheter/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Infected urine is common in this group; follow culture results
   where available.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Where cystoscopic
   guidance is used, fill the bladder and watch the needle enter in the midline at the dome. Transillumination helps
   confirm the site. Teach: Every endoscopic bladder operation starts with a complete map. Check: avoid missing the
   dome and the anterior wall because the bladder was overfilled or the lens never rotated upwards.
07_ultrasound.png [step.spc.ultrasound]  Ultrasound: full bladder and no bowel: Confirm a distended bladder in two
   planes. Look for bowel loops between the anterior abdominal wall and the bladder along the planned track,
   especially below a scar. Teach: Bowel injury is the complication that kills after suprapubic catheterisation, and
   ultrasound is the cheapest way to prevent it. Check: avoid accepting a palpable mass as the bladder without imaging
   it.
08_seeker.png [step.spc.seeker]  Local anaesthetic and seeker needle aspiration: Infiltrate local anaesthetic into the
   skin and down the planned track. Advance a long needle perpendicular to the skin, or angled slightly towards the
   pelvis, aspirating as you go, until urine is aspirated. Teach: Aspirating urine confirms the track and depth before
   the large trocar goes in. Check: avoid multiple blind passes searching for the bladder.
09_insert.png [step.spc.insert]  Trocar or Seldinger insertion and catheter placement: Make a small skin incision at
   the site and insert the trocar along the same track as the seeker needle, with controlled pressure and a hand stop.
   Once urine flows, advance the catheter through the sheath well into the bladder, then remove the sheath per the kit
   design. Teach: The track has been proven; the risk now is depth. Check: avoid losing control of the trocar as it
   gives through the bladder wall.
10_secure.png [step.spc.secure]  Confirm drainage and secure the catheter: Confirm free drainage and clear or clearing
   urine. Secure the catheter and apply a dressing; connect to a closed drainage system. Teach: An immature tract
   closes quickly if the catheter falls out, and the replacement may need a second procedure. Check: avoid a catheter
   secured under tension that kinks and blocks.
11_haemostasis.png [step.core.haemostasis]  Common. Light pressure around the tract usually suffices; persistent
   bleeding needs ultrasound and a senior opinion.
12_counts.png [step.core.counts]  Common.
13_skin-closure.png [step.core.skin-closure]  Common. Secure the catheter with a skin suture or fixation device; do
   not close the skin around it tightly.
14_debrief.png [step.core.debrief]  Common.

F. URETEROSCOPY WITH LASER LITHOTRIPSY  (folder uro-ureteroscopy-laser/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the side against the most recent CT. Stones move: if
   the scan is old, re-image before starting.
02_timeout.png [step.core.timeout]  Common. State the laser, the scopes available, and the plan if the ureter will not
   admit the scope.
03_prophylaxis.png [step.core.prophylaxis]  Common. Use the pre-operative urine culture to choose the agent. A
   positive culture should have been treated before elective surgery.
04_positioning.png [step.core.positioning]  Teach and Check: the F positioning facts exactly.
05_fluoro-setup.png [step.uro.fluoro-setup]  Fluoroscopy, contrast and radiation safety set-up: Confirm the C-arm can
   image from the bladder to the upper pole of the kidney before the patient is draped, with the table radiolucent
   over that length. Check pregnancy status in every patient who could be pregnant, and contrast allergy, before the
   first image. Teach: Upper tract endourology is done by watching wires and stents you cannot see directly. Check:
   avoid discovering after draping that the table bar or the leg holder sits over the kidney.
06_prep-drape.png [step.core.prep-drape]  Common.
07_cystoscopy.png [step.uro.cystoscopy]  Urethrocystoscopy and systematic bladder inspection: Pass the cystoscope
   under direct vision along the whole urethra, inspecting it as you go; never advance blind against resistance. Note
   the length and occlusion of the prostatic urethra, the verumontanum, and the bladder neck. Identify the ipsilateral
   orifice and note efflux; a stone may be visible at the orifice. Teach: Every endoscopic bladder operation starts
   with a complete map. Check: avoid missing the dome and the anterior wall because the bladder was overfilled or the
   lens never rotated upwards.
08_retrograde-pyelogram.png [step.uro.retrograde-pyelogram]  Retrograde pyelogram: map the ureter and collecting
   system: Cannulate the ureteric orifice with an open-ended ureteric catheter under vision, or pass the guidewire
   first if the ureter is obstructed or tortuous. Inject dilute contrast slowly under fluoroscopy; stop when the
   pelvis and calyces are outlined. Over-distension of an infected system pushes bacteria into the bloodstream. Teach:
   The pyelogram shows where the obstruction is, how the ureter runs and how the calyces are arranged. Check: avoid
   forceful injection into an obstructed, infected kidney, followed by septic shock in recovery.
09_safety-guidewire.png [step.uro.safety-guidewire]  Safety guidewire into the renal pelvis: Pass a hydrophilic-tip or
   hybrid guidewire up the ureter under fluoroscopy, past the stone or obstruction, until it coils in the renal pelvis
   or an upper calyx. If it will not pass, change angle with a ureteric catheter or an angled wire; never push against
   a fixed resistance. Teach: The safety wire is the road home. Check: avoid pushing a stiff wire against an impacted
   stone and passing it outside the ureter.
10_infected-system-bailout.png [step.uro.infected-system-bailout]  Pus in an obstructed system: drain and stop: If
   pus, turbid urine or frank infection is found above the obstruction, abandon definitive stone treatment. Send urine
   from the renal pelvis for culture, separately labelled from the bladder sample. Teach: An infected, obstructed
   kidney is a urological emergency. Check: avoid treating the stone 'because we are already there'.
11_semirigid.png [step.ursl.semirigid]  Semirigid ureteroscopy alongside the safety wire: Enter the orifice alongside
   the safety wire, rotating the scope so the wire lifts the roof of the orifice; a second working wire can be used to
   open it. Advance only with the lumen in the centre of the view, with irrigation just enough to open it. Teach: The
   semirigid scope gives the best view and working channel in the distal and mid ureter, but it is a rigid rod in a
   mobile tube. Check: avoid advancing with the ureteric wall filling the view, which creates a submucosal tunnel.
12_flexible-access.png [step.ursl.flexible-access]  Flexible access and access sheath, when needed: Pass the flexible
   scope over a working wire, keeping the safety wire separate and in place. Use an access sheath only if it advances
   smoothly over a stiff wire under fluoroscopy; stop at the first resistance and choose a smaller sheath or none.
   Teach: Proximal ureteric and renal stones need the flexible scope. Check: avoid pushing a sheath through resistance
   because the next size down is not open.
13_lithotripsy.png [step.uro.lithotripsy]  Intracorporeal lithotripsy: Confirm the energy source (laser, pneumatic or
   ultrasonic) and, for a laser, the settings, eye protection for everyone in the room and the warning sign on the
   door. Keep the fibre or probe tip visible beyond the end of the scope and in contact with the stone, never touching
   mucosa, the guidewire or a basket. Laser settings are chosen for the goal: higher energy and lower frequency to
   fragment, lower energy and higher frequency to dust. Record them. Teach: Breaking the stone is the point of the
   operation, but the energy that breaks stone also cuts urothelium, guidewires and scopes. Check: avoid firing the
   laser with the fibre tip inside the working channel, destroying the scope.
14_fragment-clearance.png [step.uro.fragment-clearance]  Fragment retrieval and stone-free assessment: Retrieve
   fragments large enough to obstruct with a basket or grasper; never pull a fragment that is wider than the lumen it
   must pass through. Inspect systematically every calyx or ureteric segment that held stone, and screen with
   fluoroscopy for radio-opaque residual fragments. Teach: Residual fragments grow, cause colic and bring the patient
   back. Check: avoid pulling an entrapped basket and stone against resistance. Release the stone or fragment it in
   the basket instead.
15_ureter-inspection.png [step.ursl.ureter-inspection]  Withdrawal inspection of the whole ureter: Withdraw the scope
   or sheath slowly with the camera on, inspecting the full length of the ureter. Grade any injury: superficial
   mucosal, submucosal, perforation, or full-thickness with periureteric fat visible. Teach: Ureteric injuries are
   graded on withdrawal, and the grade decides whether to stent, for how long, and whether imaging is needed later.
   Check: avoid removing the access sheath blind and missing the injury it caused.
16_dj-stent.png [step.uro.dj-stent]  Double-J stent placement and position check: Choose the stent diameter and length
   for the patient and the ureter; the length can be estimated from height or measured with a graduated ureteric
   catheter. Pass the stent over the guidewire with the pusher, watching the proximal end reach the renal pelvis on
   fluoroscopy and the distal end at the orifice through the cystoscope. A stent is not mandatory after uncomplicated
   ureteroscopy. Stent after ureteric injury, residual fragments, a solitary kidney, an impacted stone, infection, or
   significant oedema. Teach: A stent drains an obstructed or injured ureter, but a stent in the wrong place either
   drains nothing or causes pain, haematuria and migration. Check: avoid pulling the wire out before the proximal coil
   is seen in the pelvis, leaving the stent in the mid-ureter.
17_stent-register.png [step.uro.stent-register]  Stent register and removal plan: Record stent type, diameter, length,
   side, string or no string, and the intended dwell time in the operative note. Enter the stent on the unit's stent
   register or tracking system and book the removal or exchange. Teach: A forgotten stent encrusts, obstructs and can
   cost the kidney. Check: avoid relying on the discharge letter to generate the removal appointment.
18_specimen.png [step.core.specimen]  Common. Stone fragments for analysis; pelvic urine for culture labelled
   separately from bladder urine.
19_counts.png [step.core.counts]  Common. Account for every wire, basket and fibre that entered the patient.
20_debrief.png [step.core.debrief]  Common. Record stone-free status, any ureteric injury and its grade, and the stent
   plan.

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
  surgx-d2-gastrectomy-steps.zip   (folder d2-gastrectomy/)
  surgx-ivor-lewis-oesophagectomy-steps.zip   (folder ivor-lewis-oesophagectomy/)
  surgx-uro-turbt-steps.zip   (folder uro-turbt/)
  surgx-uro-scrotal-exploration-steps.zip   (folder uro-scrotal-exploration/)
  surgx-uro-suprapubic-catheter-steps.zip   (folder uro-suprapubic-catheter/)
  surgx-uro-ureteroscopy-laser-steps.zip   (folder uro-ureteroscopy-laser/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
