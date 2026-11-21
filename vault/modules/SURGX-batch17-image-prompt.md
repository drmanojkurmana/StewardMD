---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 17 (Operative reduction of intussusception, Laparotomy for malrotation, Laparoscopic salpingectomy for ectopic pregnancy, Laparoscopic ovarian cystectomy, Surgical management of miscarriage: manual or electric vacuum aspiration): Gemini image prompt (101 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant obstetricians and gynaecologists and paediatric surgeons. You are making 101 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Operative reduction of intussusception                         22 images
  B. Laparotomy for malrotation (Ladd procedure)                    22 images
  C. Laparoscopic salpingectomy for ectopic pregnancy               20 images
  D. Laparoscopic ovarian cystectomy                                21 images
  E. Surgical management of miscarriage: manual or electric vacuum aspiration 16 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American College of Obstetricians and Gynecologists (ACOG), Evaluation and management of adnexal masses (Practice Bulletin No.).
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
- A. Supine on a warmed mattress, with the abdomen fully exposed and a roll under the lower chest if needed.
- B. Supine on a warmed mattress, with a forced-air warmer and the abdomen fully exposed.
- C. Supine or Lloyd-Davies with arms tucked, for Trendelenburg tilt; a uterine manipulator is optional and only if
  intrauterine pregnancy has been excluded.
- D. Modified lithotomy (Lloyd-Davies) with legs in supports, arms tucked, and secured for steep head-down tilt.
  Bladder emptied before port insertion.
- E. Lithotomy with legs in supports, buttocks at the edge of the table.
Step-specific facts:
- A. Anatomy: Most childhood intussusceptions are ileocolic: the terminal ileum (intussusceptum) telescopes into the
  colon (intussuscipiens), drawing its mesentery with it. Must be right: Reduce by squeezing the apex back from distal
  to proximal; never pull the proximal bowel out of the intussuscipiens. Assess viability after reduction with warm
  packs and time, not in the first minute. Feel for a pathological lead point after every reduction.
- B. Anatomy: In malrotation the duodenojejunal flexure lies to the right of the midline and the caecum is high, so
  the base of the small bowel mesentery is very narrow and the midgut can twist around the superior mesenteric
  vessels. Must be right: Eviscerate the whole midgut before trying to understand the anatomy. Derotate anticlockwise
  until the mesentery is flat; count the turns. Resect only bowel that is clearly dead.
- C. Anatomy: The tube runs in the upper border of the broad ligament from the cornu to the fimbria, supplied by the
  mesosalpinx between the uterine and ovarian vessels. Most ectopic pregnancies are ampullary; isthmic and
  interstitial ones bleed more and rupture earlier. Must be right: In the shocked woman the first goal is to control
  bleeding: clamp or grasp the mesosalpinx before evacuating clot. Divide the mesosalpinx close to the tube to
  preserve ovarian blood supply.
- D. Anatomy: The ovary is suspended by the infundibulopelvic ligament (ovarian vessels) laterally and the utero-
  ovarian ligament medially, with its hilum on the mesovarium. Must be right: Do not perform a benign cystectomy on a
  mass that looks malignant at laparoscopy: stop and stage. Know where the ureter is before any energy is used near
  the side wall or ovarian fossa. Minimise bipolar on the ovarian bed: thermal damage destroys follicles.
- E. Anatomy: The uterus may be anteverted or retroverted; the cervical canal and uterine cavity are often angled, and
  traction on the cervix straightens them. Must be right: Know the size and direction of the uterus from the bimanual
  examination before any instrument is passed. Never apply suction if perforation is suspected. Do not use routine
  sharp curettage after aspiration.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 101 images)
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

A. OPERATIVE REDUCTION OF INTUSSUSCEPTION  (folder paeds-intussusception-reduction/)
01_consent-check.png [step.core.consent-check]  Common. Consent covers resection, stoma and appendicectomy, so no
   decision in theatre needs a second conversation.
02_timeout.png [step.core.timeout]  Common. State the enema result, whether perforation occurred, and blood
   availability.
03_physiology-gate.png [step.paeds.physiology-gate]  Paediatric physiology check before anaesthesia: Confirm today's
   weight and that drug and fluid doses on the chart are calculated from it. Review the latest electrolytes, gas and
   glucose against the agreed criteria for this operation. Teach: Infants decompensate quickly and tolerate an
   uncorrected metabolic, glucose or temperature problem badly. Check: avoid proceeding because the list is booked
   when the bloods do not meet the agreed criteria.
04_infant-laparotomy-prep.png [step.paeds.infant-laparotomy-prep]  Resuscitation, decompression and lines before a
   paediatric laparotomy: Confirm that weight-based isotonic fluid boluses have restored perfusion: heart rate,
   capillary refill, urine output and lactate or base deficit moving in the right direction. Pass a nasogastric tube
   on free drainage and aspirate it before induction to reduce the aspiration risk. Teach: Children with
   intussusception or midgut volvulus are often more dehydrated and acidotic than they look, and they decompensate
   abruptly at induction. Check: avoid delaying a child with suspected volvulus for full correction of every number:
   resuscitate in parallel and go, because the bowel is dying while you wait.
05_prophylaxis.png [step.core.prophylaxis]  Common. Treat as contaminated surgery if perforation is suspected; agent
   per local policy.
06_warming.png [step.paeds.warming]  Thermal care for the infant: Warm the theatre before the infant arrives, and use
   a forced-air warmer or warming mattress. Cover the head and limbs and expose only the operative field. Teach:
   Infants have a large surface area for their mass and little subcutaneous fat. Check: avoid prolonged exposure
   during positioning and draping while the team waits.
07_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
08_prep-drape.png [step.core.prep-drape]  Common. Prepare the whole abdomen: the apex may be in the left colon.
09_transverse-laparotomy.png [step.paeds.transverse-laparotomy]  Transverse laparotomy in an infant or child: Make a
   transverse incision in the right upper quadrant above the umbilicus for malrotation, or on the right side over the
   palpable mass for intussusception, extending across the midline as needed. Divide the rectus muscle with diathermy,
   controlling the superior epigastric vessels, and divide or split the lateral muscles in layers. Right-sided
   transverse incision, placed over the mass felt under anaesthesia. Teach: In infants and young children the abdomen
   is wider than it is long. Check: avoid an incision too small, so ischaemic bowel is delivered through a tight
   wound.
10_deliver.png [step.intus.deliver]  Finding and delivering the intussusception: Follow the colon from the caecal area
   to find the apex of the mass, which may lie anywhere from the right colon to the pelvis. Deliver the mass and the
   adjacent bowel into the wound, mobilising the right colon if needed to bring it up without traction. Teach:
   Reduction is safest when it is done under direct vision with the bowel outside the wound. Check: avoid lifting the
   mass out by pulling on the ileum.
11_reduce.png [step.intus.reduce]  Manual reduction by retrograde squeezing: Hold the colon just distal to the apex
   and squeeze the apex gently backwards towards the caecum, like expressing a tube from its far end. Keep steady,
   patient pressure; the last part through the ileocaecal valve is always the slowest and oedema yields with time.
   Teach: Pushing the apex back from below spreads force over the whole wall. Check: avoid a final tug on the ileum to
   finish the reduction.
12_bowel-handling.png [step.abd.bowel-handling]  Handling and assessing bowel: Handle with the whole hand and moist
   packs; grasp the mesentery, not the bowel wall. Assess viability by colour, peristalsis, mesenteric pulsation and
   bleeding from a cut edge, and re-assess after warm packs and time. Wrap the reduced bowel in warm moist packs and
   wait several minutes. Look for colour, peristalsis and mesenteric pulsation; multiple or deep serosal splits count
   against viability. Teach: Bowel handled roughly becomes ileus, adhesions and, at the extreme, a serosal tear that
   becomes a leak. Check: avoid deciding viability in the first 30 seconds.
13_lead-point.png [step.intus.lead-point]  Searching for a pathological lead point: After reduction, palpate the
   terminal ileum, caecum and colon for a discrete intraluminal mass. Distinguish the soft, thickened Peyer patch of
   idiopathic intussusception from a firm discrete lesion. Teach: A missed lead point means recurrence or a missed
   diagnosis such as lymphoma. Check: avoid resecting a Peyer patch as a tumour.
14_resect.png [step.intus.resect]  Resection when reduction fails or the bowel is not viable: Resect the involved
   segment, usually as a limited ileocolic resection, dividing the mesentery close to the bowel since this is a benign
   resection unless a tumour is suspected. Restore continuity with a primary handsewn anastomosis when the child is
   stable and the ends are healthy. Teach: An irreducible, perforated or gangrenous intussusception, or one with a
   lead point, needs resection. Check: avoid an anastomosis on ends of doubtful perfusion in a septic child.
15_anastomosis-handsewn.png [step.bowel.anastomosis-handsewn]  Handsewn anastomosis: Confirm both ends bleed and lie
   together without tension; mobilise further rather than pull. Single-layer extramucosal interrupted or continuous
   technique with a slowly absorbable monofilament suture, end-to-end or end-to-side. Only after resection: single-
   layer extramucosal ileocolic anastomosis with fine monofilament, correcting the calibre mismatch on the ileal side.
   Teach: A handsewn anastomosis adapts to bowel of mismatched calibre, to thick oedematous wall and to settings
   without a stapler. Check: avoid strangulating the edges by tying too tightly, which causes ischaemia rather than
   strength.
16_incidental-appendicectomy.png [step.paeds.incidental-appendicectomy]  Appendicectomy at laparotomy for malrotation
   or intussusception: Confirm that appendicectomy was included in the consent discussion. Divide the mesoappendix
   between ligatures, ligate the base with absorbable suture and remove the appendix; manage the stump per the
   surgeon's usual practice. Teach: After a Ladd procedure the caecum lies in the left upper abdomen, so later
   appendicitis presents in the wrong place. Check: avoid ligating the base across an oedematous caecum after a
   difficult reduction.
17_haemostasis.png [step.core.haemostasis]  Common.
18_specimen.png [step.core.specimen]  Common. Any resected segment goes for histology with the question of a lead
   point stated.
19_counts.png [step.core.counts]  Common.
20_transverse-closure.png [step.paeds.transverse-closure]  Closing a transverse paediatric laparotomy: Return the
   bowel to the abdomen. If closure would raise ventilation pressures markedly, discuss a temporary abdominal closure
   with the anaesthetist rather than forcing it. Close in one or two layers (posterior sheath with peritoneum, then
   the anterior sheath and muscle) with absorbable sutures sized for the child. Teach: Dehiscence after a paediatric
   laparotomy is usually a technical failure, made more likely by distension, sepsis and poor nutrition. Check: avoid
   forcing closure over distended bowel, causing respiratory compromise and abdominal compartment syndrome.
21_skin-closure.png [step.core.skin-closure]  Common.
22_debrief.png [step.core.debrief]  Common. Record how far the intussusception reached, whether manual reduction was
   complete, viability, any lead point and whether the appendix was removed.

B. LAPAROTOMY FOR MALROTATION (LADD PROCEDURE)  (folder paeds-ladd-procedure/)
01_consent-check.png [step.core.consent-check]  Common. Consent includes resection, stoma, second look and
   appendicectomy. In volvulus, this conversation happens in minutes, not hours.
02_timeout.png [step.core.timeout]  Common. State that the bowel may be ischaemic and blood must be available.
03_physiology-gate.png [step.paeds.physiology-gate]  Paediatric physiology check before anaesthesia: Confirm today's
   weight and that drug and fluid doses on the chart are calculated from it. Review the latest electrolytes, gas and
   glucose against the agreed criteria for this operation. In suspected volvulus, the gate is safety for induction,
   not a complete correction; resuscitation continues in theatre. Teach: Infants decompensate quickly and tolerate an
   uncorrected metabolic, glucose or temperature problem badly. Check: avoid proceeding because the list is booked
   when the bloods do not meet the agreed criteria.
04_infant-laparotomy-prep.png [step.paeds.infant-laparotomy-prep]  Resuscitation, decompression and lines before a
   paediatric laparotomy: Confirm that weight-based isotonic fluid boluses have restored perfusion: heart rate,
   capillary refill, urine output and lactate or base deficit moving in the right direction. Pass a nasogastric tube
   on free drainage and aspirate it before induction to reduce the aspiration risk. Teach: Children with
   intussusception or midgut volvulus are often more dehydrated and acidotic than they look, and they decompensate
   abruptly at induction. Check: avoid delaying a child with suspected volvulus for full correction of every number:
   resuscitate in parallel and go, because the bowel is dying while you wait.
05_prophylaxis.png [step.core.prophylaxis]  Common.
06_warming.png [step.paeds.warming]  Thermal care for the infant: Warm the theatre before the infant arrives, and use
   a forced-air warmer or warming mattress. Cover the head and limbs and expose only the operative field. Eviscerated
   bowel loses heat fast: warm packs and fluids ready before incision. Teach: Infants have a large surface area for
   their mass and little subcutaneous fat. Check: avoid prolonged exposure during positioning and draping while the
   team waits.
07_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
08_prep-drape.png [step.core.prep-drape]  Common.
09_transverse-laparotomy.png [step.paeds.transverse-laparotomy]  Transverse laparotomy in an infant or child: Make a
   transverse incision in the right upper quadrant above the umbilicus for malrotation, or on the right side over the
   palpable mass for intussusception, extending across the midline as needed. Divide the rectus muscle with diathermy,
   controlling the superior epigastric vessels, and divide or split the lateral muscles in layers. Right upper
   quadrant transverse incision above the umbilicus. Teach: In infants and young children the abdomen is wider than it
   is long. Check: avoid an incision too small, so ischaemic bowel is delivered through a tight wound.
10_eviscerate.png [step.ladd.eviscerate]  Eviscerating the midgut and recognising the volvulus: Deliver the entire
   small bowel and right colon out of the wound onto warm moist packs. Find the narrow mesenteric root and the twist
   around it; note the direction and the colour of the bowel. Teach: The anatomy of a volvulus cannot be understood
   from inside the abdomen. Check: avoid trying to derotate inside the abdomen.
11_derotate.png [step.ladd.derotate]  Derotating the volvulus anticlockwise: Hold the whole midgut in both hands and
   rotate it anticlockwise as viewed from the front, one full turn at a time. Continue until the mesentery lies flat
   with no twist at its root; count and record the number of turns. Teach: Volvulus is usually clockwise, so
   anticlockwise derotation, often remembered as turning back the clock, untwists it. Check: avoid rotating clockwise
   because the twist was not identified first.
12_bowel-handling.png [step.abd.bowel-handling]  Handling and assessing bowel: Handle with the whole hand and moist
   packs; grasp the mesentery, not the bowel wall. Assess viability by colour, peristalsis, mesenteric pulsation and
   bleeding from a cut edge, and re-assess after warm packs and time. In midgut volvulus resect only clearly necrotic
   bowel. Where a long length is of doubtful viability, preserve it and plan a second look rather than resect. Teach:
   Bowel handled roughly becomes ileus, adhesions and, at the extreme, a serosal tear that becomes a leak. Check:
   avoid deciding viability in the first 30 seconds.
13_second-look.png [step.ladd.second-look]  Doubtful viability: preserve, close temporarily and look again: Resect
   only segments that are clearly necrotic or perforated, leaving the ends closed if continuity is not safe. If a long
   length remains doubtful, complete the derotation, do not perform a full resection, and close the abdomen
   temporarily or with a silo. Teach: Ischaemic midgut that looks doubtful after derotation often recovers. Check:
   avoid resecting every segment that looks dusky at the first look.
14_bands.png [step.ladd.bands]  Dividing Ladd bands and confirming duodenal patency: Identify the peritoneal bands
   running from the caecum and ascending colon across the duodenum to the right upper quadrant. Divide them close to
   the colon, freeing the duodenum and straightening it so it runs directly down the right side of the abdomen. Teach:
   Ladd bands compress the duodenum; dividing them relieves the extrinsic obstruction. Check: avoid leaving bands
   across the second part of the duodenum.
15_mesentery.png [step.ladd.mesentery]  Widening the mesentery and placing the bowel in non-rotation: Divide the
   peritoneum and adhesions on the anterior surface of the mesentery between the duodenum and the caecum to separate
   them widely. Keep the superior mesenteric vessels in view throughout and divide only peritoneum and adhesions,
   never vessels in the pedicle. Teach: Volvulus happens because the mesenteric base is narrow. Check: avoid dividing
   vessels while widening the mesentery.
16_incidental-appendicectomy.png [step.paeds.incidental-appendicectomy]  Appendicectomy at laparotomy for malrotation
   or intussusception: Confirm that appendicectomy was included in the consent discussion. Divide the mesoappendix
   between ligatures, ligate the base with absorbable suture and remove the appendix; manage the stump per the
   surgeon's usual practice. Teach: After a Ladd procedure the caecum lies in the left upper abdomen, so later
   appendicitis presents in the wrong place. Check: avoid ligating the base across an oedematous caecum after a
   difficult reduction.
17_haemostasis.png [step.core.haemostasis]  Common.
18_specimen.png [step.core.specimen]  Common. Appendix and any resected bowel, labelled with the finding of volvulus.
19_counts.png [step.core.counts]  Common.
20_transverse-closure.png [step.paeds.transverse-closure]  Closing a transverse paediatric laparotomy: Return the
   bowel to the abdomen. If closure would raise ventilation pressures markedly, discuss a temporary abdominal closure
   with the anaesthetist rather than forcing it. Close in one or two layers (posterior sheath with peritoneum, then
   the anterior sheath and muscle) with absorbable sutures sized for the child. Teach: Dehiscence after a paediatric
   laparotomy is usually a technical failure, made more likely by distension, sepsis and poor nutrition. Check: avoid
   forcing closure over distended bowel, causing respiratory compromise and abdominal compartment syndrome.
21_skin-closure.png [step.core.skin-closure]  Common.
22_debrief.png [step.core.debrief]  Common. Record the direction and number of turns, viability, length of bowel
   resected and remaining, duodenal patency, and the second-look plan.

C. LAPAROSCOPIC SALPINGECTOMY FOR ECTOPIC PREGNANCY  (folder lap-salpingectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm side from imaging if known, but the side is confirmed
   at laparoscopy, not marked on the skin.
02_timeout.png [step.core.timeout]  Common. State the haemodynamic status, blood available and the conversion plan.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry.
   Catheterise first. The anaesthetist should expect a fall in blood pressure as pneumoperitoneum is established in a
   hypovolaemic woman. Teach: Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
07_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
08_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Find the bleeding tube first; a full survey follows once
   bleeding is controlled. Teach: The first look answers a question the imaging could not, and it is the only chance
   to find the second diagnosis before attention narrows to the first. Check: avoid going straight to the target and
   missing a second pathology.
09_control.png [step.salp.control]  Controlling the bleeding and evacuating haemoperitoneum: Identify the affected
   tube, lift it with an atraumatic grasper and hold it to tamponade the mesosalpinx. Then evacuate clot and blood
   with high-flow suction and irrigation to clear the field. Teach: In a ruptured ectopic the bleeding source is small
   and accessible. Check: avoid suctioning for minutes before grasping the tube in an unstable woman.
10_excise.png [step.salp.excise]  Salpingectomy: Starting at the fimbrial end or the isthmus, coagulate and divide the
   mesosalpinx close to the tube in short steps. Divide the tube at the isthmus close to the cornu. Teach: Removing
   the tube with its pregnancy is definitive and avoids persistent trophoblast. Check: avoid coagulating into the
   ovarian hilum.
11_adnexal-check.png [step.obg.adnexal-check]  Inspect both tubes and ovaries: Inspect the contralateral tube along
   its length, including the fimbrial end, and both ovaries. Note adhesions, hydrosalpinx, endometriosis, cysts or
   other pathology. The contralateral tube determines fertility counselling and is the basis for salpingectomy over
   salpingotomy. Teach: The state of the remaining tube and both ovaries determines future fertility, the choice
   between salpingectomy and salpingotomy, and what the woman is told afterwards. Check: avoid omitting the check
   because the main procedure is complete.
12_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Bag the tube; trophoblast left in the abdomen can implant and persist. Teach: Bringing
   an infected or neoplastic specimen through the abdominal wall unprotected causes port-site infection and, in
   malignancy, port-site recurrence. Check: avoid a bag torn during extraction, spilling contents into the wound.
13_haemostasis.png [step.core.haemostasis]  Common. Irrigate the pelvis and inspect the mesosalpinx stump at low
   pressure.
14_blood-loss.png [step.obg.blood-loss]  Quantify blood loss and agree the next step: Measure suction volumes
   (subtracting irrigation and amniotic fluid) and weigh swabs. State the measured blood loss aloud to the
   anaesthetist and scribe before closure. Count the haemoperitoneum evacuated as blood loss. Teach: Visual estimates
   of blood loss are consistently low. Check: avoid reporting an estimated rather than measured loss.
15_counts.png [step.core.counts]  Common.
16_specimen.png [step.core.specimen]  Common. Send for histology to confirm trophoblast; record the woman's wishes
   about the tissue.
17_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
18_skin-closure.png [step.core.skin-closure]  Common.
19_rhesus.png [step.obg.rhesus]  Rhesus status and anti-D: Confirm the woman's blood group and antibody status before
   she leaves recovery. If rhesus-negative, ensure anti-D immunoglobulin is prescribed and given per national guidance
   for this procedure, with any test needed to decide the dose. NICE NG126 advises anti-D for rhesus-negative women
   having surgical management of an ectopic pregnancy. Teach: A rhesus-negative woman exposed to fetal red cells can
   become sensitised, which threatens every future pregnancy. Check: avoid assuming the ward will remember after
   discharge from theatre.
20_debrief.png [step.core.debrief]  Common.

D. LAPAROSCOPIC OVARIAN CYSTECTOMY  (folder lap-ovarian-cystectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the side and whether oophorectomy is consented if the
   ovary cannot be preserved.
02_timeout.png [step.core.timeout]  Common.
03_preop-check.png [step.obg.preop-check]  Confirm the indication, pregnancy status and pre-operative work-up: Confirm
   pregnancy status on the day: a negative test before elective gynaecological surgery, or a confirmed intrauterine
   pregnancy and gestation before an obstetric procedure. Look at the imaging that justifies the operation yourself,
   and confirm it matches the side and the plan on the consent form. Ultrasound features, risk score and tumour
   markers support a benign diagnosis; if not, this operation should not be on the list. Teach: Gynaecological and
   obstetric operations rest on a scan, a test result and a plan agreed in clinic. Check: avoid proceeding on a report
   without looking at the images.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_lithotomy-eua.png [step.obg.lithotomy-eua]  Lithotomy, bladder and examination under anaesthesia: Lift and lower
   both legs together into the supports, avoid extreme hip flexion and abduction, and pad the lateral knee over the
   common peroneal nerve. Empty the bladder with an in-and-out catheter, or leave a catheter, as the procedure plan
   requires. Catheterise to empty the bladder and place the uterine manipulator. Teach: The size, position and
   mobility of the uterus and the state of the cervix under anaesthesia decide the direction of every instrument that
   follows. Check: avoid instrumenting a retroverted uterus as if it were anteverted.
07_prep-drape.png [step.core.prep-drape]  Common.
08_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Teach:
   Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
09_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
10_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Take peritoneal washings before handling the cyst if there
   is any doubt about its nature. Look at the upper abdomen, peritoneum and omentum. Teach: The first look answers a
   question the imaging could not, and it is the only chance to find the second diagnosis before attention narrows to
   the first. Check: avoid going straight to the target and missing a second pathology.
11_adnexal-check.png [step.obg.adnexal-check]  Inspect both tubes and ovaries: Inspect the contralateral tube along
   its length, including the fimbrial end, and both ovaries. Note adhesions, hydrosalpinx, endometriosis, cysts or
   other pathology. Inspect the cyst surface for excrescences, and both ovaries and tubes, before starting. Teach: The
   state of the remaining tube and both ovaries determines future fertility, the choice between salpingectomy and
   salpingotomy, and what the woman is told afterwards. Check: avoid omitting the check because the main procedure is
   complete.
12_suspicion.png [step.ovc.suspicion]  Unexpected features of malignancy, or an operation that cannot be finished
   safely: If you see surface excrescences, solid areas, ascites or peritoneal deposits, do not perform a cystectomy.
   Take washings, photograph the findings, biopsy peritoneal deposits if appropriate, and avoid rupturing the mass.
   Teach: Rupturing an early ovarian cancer upstages it and can change treatment. Check: avoid completing the
   cystectomy because the list was booked for it.
13_ureter-identification.png [step.obg.ureter-identification]  Identify the ureter before dividing pelvic pedicles:
   Before clamping or sealing the infundibulopelvic ligament or working near the ovarian fossa, see the ureter
   peristalse where it crosses the iliac vessels at the brim. Trace it down the pelvic side wall towards where it
   passes under the uterine artery. Especially with an endometrioma adherent to the ovarian fossa. Teach: The ureter
   crosses the pelvic brim beside the infundibulopelvic ligament and passes beneath the uterine artery close to the
   side of the cervix. Check: avoid assuming a structure seen once at the brim is safe all the way down.
14_incision.png [step.ovc.incision]  Incising the ovarian cortex: Stabilise the ovary with an atraumatic grasper on
   the utero-ovarian ligament. Incise the cortex on the antimesenteric surface, away from the hilum, with scissors or
   a fine monopolar needle, just deep enough to reach the cyst wall. Teach: The right incision, on the antimesenteric
   side and just through the thin cortex, finds the cleavage plane without entering the cyst and keeps away from the
   hilar vessels. Check: avoid a deep incision that enters the cyst.
15_enucleation.png [step.ovc.enucleation]  Stripping the cyst from the ovary: Find the plane between the cyst wall and
   the stroma, then grasp the cyst wall and the ovarian edge with two atraumatic graspers. Strip with gentle traction
   and countertraction, regrasping close to the plane as it advances. Teach: Removing the cyst intact in its plane
   preserves as much cortex as possible and avoids spillage. Check: avoid tearing the cyst off the hilum, causing
   brisk bleeding.
16_bed-haemostasis.png [step.ovc.bed-haemostasis]  Ovary-sparing haemostasis of the cyst bed: Irrigate to find
   specific bleeding points and coagulate only those, briefly, with bipolar. For general oozing, use pressure, a
   haemostatic agent or a fine suture rather than broad diathermy. Teach: The ovarian bed oozes, and the instinct to
   coagulate it widely destroys the follicles the operation was meant to preserve. Check: avoid painting the whole
   ovarian bed with bipolar.
17_specimen-retrieval.png [step.lap.specimen-retrieval]  Specimen retrieval: Use a retrieval bag for any infected,
   perforated or potentially malignant specimen. Extract through the largest port, extending the fascial incision
   rather than tearing the bag. Bag the cyst before any deliberate drainage; aspirate inside the bag if needed to
   extract it. After any spillage, irrigate copiously until clear. Teach: Bringing an infected or neoplastic specimen
   through the abdominal wall unprotected causes port-site infection and, in malignancy, port-site recurrence. Check:
   avoid a bag torn during extraction, spilling contents into the wound.
18_specimen.png [step.core.specimen]  Common.
19_counts.png [step.core.counts]  Common.
20_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
21_debrief.png [step.core.debrief]  Common. Record cyst nature, spillage, ovarian tissue preserved, washings taken,
   and the contralateral ovary.

E. SURGICAL MANAGEMENT OF MISCARRIAGE: MANUAL OR ELECTRIC VACUUM ASPIRATION  (folder evacuation-rpoc/)
01_consent-check.png [step.core.consent-check]  Common. Record the woman's choices about histology and the sensitive
   disposal of the pregnancy tissue.
02_timeout.png [step.core.timeout]  Common.
03_preop-check.png [step.obg.preop-check]  Confirm the indication, pregnancy status and pre-operative work-up: Confirm
   pregnancy status on the day: a negative test before elective gynaecological surgery, or a confirmed intrauterine
   pregnancy and gestation before an obstetric procedure. Look at the imaging that justifies the operation yourself,
   and confirm it matches the side and the plan on the consent form. An intrauterine pregnancy confirmed on scan, the
   gestation, and the blood group result. Teach: Gynaecological and obstetric operations rest on a scan, a test result
   and a plan agreed in clinic. Check: avoid proceeding on a report without looking at the images.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis and screening for infection per local
   policy.
05_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
06_lithotomy-eua.png [step.obg.lithotomy-eua]  Lithotomy, bladder and examination under anaesthesia: Lift and lower
   both legs together into the supports, avoid extreme hip flexion and abduction, and pad the lateral knee over the
   common peroneal nerve. Empty the bladder with an in-and-out catheter, or leave a catheter, as the procedure plan
   requires. The bimanual examination sets the size and axis of the uterus for every instrument that follows. Teach:
   The size, position and mobility of the uterus and the state of the cervix under anaesthesia decide the direction of
   every instrument that follows. Check: avoid instrumenting a retroverted uterus as if it were anteverted.
07_prep-drape.png [step.core.prep-drape]  Common.
08_dilate.png [step.erpc.dilate]  Cervical traction and gentle dilatation: Grasp the anterior lip of the cervix with a
   vulsellum or tenaculum and apply steady traction to straighten the uterine axis. Avoid routine sounding; if used,
   pass the sound gently along the axis found on examination. Teach: Traction on the cervix straightens the canal and
   the cavity, and most perforations happen during sounding or dilatation of an unstraightened, unprimed cervix.
   Check: avoid pushing a dilator with force against resistance.
09_evacuate.png [step.erpc.evacuate]  Vacuum aspiration of the uterine cavity: Insert the cannula gently through the
   os until it meets slight resistance short of the fundus, then withdraw it slightly. Apply vacuum (release the
   valves of the charged manual syringe, or start the electric suction). Teach: Suction removes tissue with less blood
   loss, fewer adhesions and less perforation risk than sharp curettage. Check: avoid advancing the cannula forcibly
   against the fundus.
10_completeness.png [step.erpc.completeness]  Confirming the cavity is empty and tissue was obtained: Recognise the
   end-points: a gritty feel as the cannula passes over the wall, red or pink foam and no further tissue in the
   cannula, and the uterus contracting around the cannula. Inspect the aspirate, rinsed and floated in saline in a
   clear dish, for chorionic villi or the gestational sac. Teach: Retained tissue means a repeat procedure, and an
   evacuation that yields no pregnancy tissue may mean the pregnancy was never in the uterus. Check: avoid sending
   tissue without looking at it.
11_perforation.png [step.erpc.perforation]  Suspected uterine perforation: Suspect perforation when an instrument
   passes further than the expected uterine size, resistance is suddenly lost, fat or bowel appears in the aspirate,
   or bleeding or haemodynamics change abruptly. Stop immediately and do not apply or continue suction. Teach: A
   perforation by a sound or small dilator with no suction applied is often harmless. Check: avoid continuing suction
   to finish the evacuation after perforation.
12_blood-loss.png [step.obg.blood-loss]  Quantify blood loss and agree the next step: Measure suction volumes
   (subtracting irrigation and amniotic fluid) and weigh swabs. State the measured blood loss aloud to the
   anaesthetist and scribe before closure. If bleeding continues after the cavity is empty, give a uterotonic per
   local protocol, then reassess for retained tissue, cervical laceration or perforation. Teach: Visual estimates of
   blood loss are consistently low. Check: avoid reporting an estimated rather than measured loss.
13_specimen.png [step.core.specimen]  Common. Send the tissue for histology to confirm pregnancy and exclude molar
   pregnancy, handled with the sensitivity the woman chose.
14_rhesus.png [step.obg.rhesus]  Rhesus status and anti-D: Confirm the woman's blood group and antibody status before
   she leaves recovery. If rhesus-negative, ensure anti-D immunoglobulin is prescribed and given per national guidance
   for this procedure, with any test needed to decide the dose. Teach: A rhesus-negative woman exposed to fetal red
   cells can become sensitised, which threatens every future pregnancy. Check: avoid assuming the ward will remember
   after discharge from theatre.
15_counts.png [step.core.counts]  Common. Include every vaginal swab and the speculum.
16_debrief.png [step.core.debrief]  Common. Record uterine size and axis, cannula size, whether pregnancy tissue was
   seen, and that perforation was excluded.

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
  surgx-paeds-intussusception-reduction-steps.zip   (folder paeds-intussusception-reduction/)
  surgx-paeds-ladd-procedure-steps.zip   (folder paeds-ladd-procedure/)
  surgx-lap-salpingectomy-steps.zip   (folder lap-salpingectomy/)
  surgx-lap-ovarian-cystectomy-steps.zip   (folder lap-ovarian-cystectomy/)
  surgx-evacuation-rpoc-steps.zip   (folder evacuation-rpoc/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
