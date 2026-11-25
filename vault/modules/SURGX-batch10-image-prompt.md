---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 10 (Abscess incision and drainage, Hartmann's procedure, Loop ileostomy: formation and closure, Laparoscopic repair of perforated duodenal ulcer, Small bowel resection with anastomosis): Gemini image prompt (98 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant general and colorectal surgeons. You are making 98 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Abscess incision and drainage                                  11 images
  B. Hartmann's procedure                                           24 images
  C. Loop ileostomy: formation and closure                          20 images
  D. Laparoscopic repair of perforated duodenal ulcer               20 images
  E. Small bowel resection with anastomosis                         23 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Society of Colon and Rectal Surgeons (ASCRS), Clinical Practice Guidelines for Ostomy Surgery; American Society of Colon and Rectal Surgeons (ASCRS), Clinical Practice Guidelines for the Treatment of Left-Sided Colonic Diverticulitis; ERAS Society, Guidelines for Perioperative Care in Elective Colorectal Surgery: ERAS Society Recommendations 2018; Infectious Diseases Society of America (IDSA), Practice guidelines for the diagnosis and management of skin and soft tissue infections; World Society of Emergency Surgery (WSES), 2020 update of the WSES guidelines for the management of acute colonic diverticulitis in the emergency setting; World Society of Emergency Surgery (WSES), Bologna guidelines for diagnosis and management of adhesive small bowel obstruction (ASBO): 2017 update; World Society of Emergency Surgery (WSES), Perforated and bleeding peptic ulcer: WSES guidelines; World Society of Emergency Surgery (WSES), The management of intra-abdominal infections from a global perspective: 2017 WSES guidelines).
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
- A. Position so the incision lies at the most dependent point of the cavity. Lithotomy or prone jack-knife for
  perianal and pilonidal collections. Good light and an assistant. Both are underrated.
- B. Modified Lloyd-Davies with legs in padded stirrups, giving access to the anus for a transanal stapler or rectal
  washout and to the pelvis for a second assistant. Thighs nearly flat so the legs do not obstruct the instruments;
  protect the common peroneal nerve at the fibular head.
- C. Supine, or modified Lloyd-Davies when the ileostomy is formed as part of a pelvic operation. Arms out; the right
  side of the abdomen fully exposed.
- D. Supine, French position (legs apart) or American, with reverse Trendelenburg for the upper abdomen and
  Trendelenburg later for pelvic washout. Strap the patient securely; the table will tilt in several directions.
- E. Supine, arms out. Warming from the start; hypothermia worsens coagulopathy and anastomotic healing.
Step-specific facts:
- A. Anatomy: The skin overlying an abscess is thinned and inflamed; the true cavity is almost always larger and
  deeper than the surface suggests. Must be right: Reconsider the diagnosis in any patient with pain out of
  proportion, crepitus, dusky skin or systemic toxicity. That is necrotising infection, and this operation is the
  wrong one. Break down every loculus.
- B. Anatomy: The sigmoid colon is on a mesentery whose root crosses the left common iliac vessels and the left ureter
  at the pelvic brim. The ureter lies under the intersigmoid recess, behind the mesentery, not in it. Must be right:
  Identify the left ureter before dividing anything in the sigmoid mesentery, and again before transecting the rectal
  stump. In a severely inflamed field, ureteric stents may help a later identification but do not prevent injury.
- C. Anatomy: The loop is taken from the terminal ileum, typically 20 to 30 cm proximal to the ileocaecal valve, far
  enough to allow a later anastomosis without encroaching on the valve and close enough to minimise high output. Must
  be right: Mark the proximal limb with a stitch before delivery. A twisted or reversed loop ileostomy that
  defunctions nothing is a recognised and avoidable error. Confirm the distal anastomosis has healed before closure.
- D. Anatomy: Most perforated duodenal ulcers are anterior, on the first part of the duodenum just distal to the
  pylorus. The pyloric vein (of Mayo) marks the pylorus. A posterior duodenal ulcer bleeds into the gastroduodenal
  artery rather than perforating. Must be right: Biopsy any gastric perforation, because a perforated gastric cancer
  can look exactly like a benign ulcer. Do not attempt to close a friable perforation primarily under tension. The
  omentum seals the hole; the sutures only hold the omentum.
- E. Anatomy: The small bowel runs roughly from the duodenojejunal flexure to the ileocaecal valve. Total length
  varies widely between people, which is why the length LEFT is measured rather than the length removed. Must be
  right: Assess viability over time, after relief of obstruction and with warm packs, before deciding the extent of
  resection.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 98 images)
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

A. ABSCESS INCISION AND DRAINAGE  (folder abscess-drainage/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common. A bedside procedure still gets a check of identity, site, allergy and
   anticoagulation. The checklist scales down; it does not disappear.
03_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
04_prep-drape.png [step.core.prep-drape]  Common.
05_local.png [step.st.local]  Local anaesthesia for an inflamed field: Infiltrate a field block in healthy tissue
   around the abscess rather than into it. Check the maximum safe dose for the patient's weight and whether adrenaline
   is appropriate for that site. Teach: Local anaesthetic works poorly in the acidic tissue of an abscess, which is
   why patients remember these procedures. Check: avoid injecting into the cavity, which hurts and does not work.
06_incision.png [step.st.incision]  Incision over the collection: Incise at the point of maximal fluctuance, along
   skin tension lines where cosmesis matters, and at the most dependent point where drainage matters. Make the
   incision long enough to allow the cavity to be explored and to keep draining as it heals. Teach: The incision must
   be long enough and placed so the cavity drains with gravity, or the abscess reforms and the patient returns. Check:
   avoid a stab incision that closes over within a day.
07_culture.png [step.st.culture]  Pus for culture: Aspirate or swab pus from within the cavity at the moment it is
   opened, before irrigation. Send in an appropriate container, and request anaerobic culture where the site suggests
   it. Teach: Pus obtained at drainage is the specimen that guides therapy. Check: avoid irrigating first, then
   swabbing.
08_deloculate.png [step.st.deloculate]  Breaking down loculations: Explore the whole cavity with a finger or a blunt
   instrument and break every septum. Feel for the extent in every direction, particularly deep, where the cavity is
   usually larger than the skin suggests. Teach: An abscess that is not fully de-loculated is an abscess that has been
   partly drained, and it is the commonest reason for recurrence and readmission. Check: avoid stopping at the first
   gush of pus.
09_pack.png [step.st.pack]  Irrigation, packing and leaving the wound open: Irrigate with saline until the effluent is
   clear. Pack lightly if at all: the purpose is to keep the skin edges apart, not to fill the cavity under pressure.
   Teach: An abscess cavity closed primarily becomes an abscess again. Check: avoid tight packing, which causes pain
   and pressure necrosis.
10_specimen.png [step.core.specimen]  Common. Send the wall of a chronic or atypical abscess for histology as well as
   culture: tuberculosis and malignancy both present this way.
11_debrief.png [step.core.debrief]  Common.

B. HARTMANN'S PROCEDURE  (folder hartmanns-procedure/)
01_consent-check.png [step.core.consent-check]  Common. Say the word 'stoma' and say that it may be permanent. Many
   Hartmann's colostomies are never reversed.
02_stoma-siting.png [step.bowel.stoma-siting]  Pre-operative stoma siting: Mark the site before theatre whenever time
   allows, ideally with a stoma specialist nurse, for any operation in which a stoma is possible. Examine the patient
   lying, sitting and standing. Choose a flat area of at least the size of the appliance flange, within the rectus
   sheath, below the belt line and where the patient can see it. Left iliac fossa for an end colostomy. Mark it even
   in an emergency if the patient can sit up for one minute. Teach: Most stoma leaks, skin problems and appliance
   failures trace back to where the stoma was put. Check: avoid siting on the supine anaesthetised patient, where a
   deep crease becomes visible only when the patient sits up on day two.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. This is treatment, not prophylaxis: therapeutic antibiotics should
   already be running. Redose if the operation is long or blood loss is heavy.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_midline.png [step.abd.midline]  Midline laparotomy incision: Incise through skin, fat and linea alba, staying in
   the midline: drifting off it bleeds and weakens the closure. Enter the peritoneum between forceps under direct
   vision, then extend with fingers protecting the bowel. Teach: The midline is fast, bloodless and extensible in both
   directions, which is exactly what an unknown pathology needs. Check: avoid entering blind through a scar.
08_exploration.png [step.abd.exploration]  Systematic exploration: Follow the same sequence every time: liver and
   gallbladder, stomach and duodenum, spleen, small bowel from duodenojejunal flexure to caecum, colon and rectum,
   pelvis, retroperitoneum, hernial orifices from inside. Run the small bowel hand over hand, both surfaces, in one
   direction. Grade the contamination and look at the whole colon. A perforated cancer, a second lesion or a
   synchronous ischaemia changes the operation. Teach: The purpose of a laparotomy is to find out. Check: avoid
   stopping the exploration when the expected pathology is found.
09_bowel-handling.png [step.abd.bowel-handling]  Handling and assessing bowel: Handle with the whole hand and moist
   packs; grasp the mesentery, not the bowel wall. Assess viability by colour, peristalsis, mesenteric pulsation and
   bleeding from a cut edge, and re-assess after warm packs and time. Teach: Bowel handled roughly becomes ileus,
   adhesions and, at the extreme, a serosal tear that becomes a leak. Check: avoid deciding viability in the first 30
   seconds.
10_mobilise.png [step.hartmann.mobilise]  Lateral mobilisation and ureter identification: Divide the congenital
   adhesions and the white line of Toldt lateral to the sigmoid and descending colon. Develop the plane between the
   mesocolon and the retroperitoneum medially, keeping the gonadal vessels and ureter down on the posterior wall.
   Teach: The left ureter is injured during sigmoid mobilisation when the surgeon dissects in an inflamed field
   without first finding it. Check: avoid lifting the ureter up with the mesentery by dissecting too deep in an
   inflammatory mass.
11_mesentery-division.png [step.bowel.mesentery-division]  Dividing the mesentery: Transilluminate the mesentery to
   see the arcades and choose a line that preserves supply to both retained ends. Score the peritoneum on both faces,
   then divide between clips or ties, or with a vessel-sealing device in thin mesentery. For benign disease divide
   close to the bowel and preserve the superior rectal artery; for suspected cancer divide at the oncological level.
   Teach: The mesenteric division decides the blood supply of both cut ends. Check: avoid tied pedicles slipping in an
   oedematous mesentery, producing a mesenteric haematoma that compromises the anastomosis.
12_rectal-stump.png [step.hartmann.rectal-stump]  Transecting and securing the rectal stump: Identify the rectosigmoid
   junction where the taeniae splay out, at about the level of the sacral promontory. Clear the mesorectum from the
   bowel wall at the point of division, keeping close to the bowel for benign disease to protect the hypogastric
   nerves. Teach: The rectal stump is closed blind and left in a contaminated pelvis. Check: avoid dividing through
   diverticular sigmoid because the dissection became difficult, leaving a stump that dehisces.
13_bowel-division.png [step.bowel.bowel-division]  Dividing the bowel: Pack off the field with moist swabs before
   division. Divide with a linear cutting stapler, or between non-crushing and crushing clamps, at the point already
   prepared on the mesenteric border. Proximal division on soft, well-perfused descending or sigmoid colon that will
   reach the abdominal wall. Teach: Division is where contamination of the field happens. Check: avoid including the
   mesentery in the staple line, which bleeds and devascularises the end.
14_lavage.png [step.abd.lavage]  Peritoneal toilet: Remove particulate contamination mechanically from all four
   quadrants and the pelvis. Irrigate with warm saline and aspirate it completely; fluid left behind is a collection.
   Teach: Removing contamination is part of source control, but lavage does not substitute for closing the hole that
   produced it. Check: avoid lavage of a compartment that has not been fully opened, so the subphrenic collection is
   missed.
15_haemostasis.png [step.core.haemostasis]  Common.
16_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. A pelvic drain is reasonable after a contaminated pelvic field; it does not
   prevent a stump leak but may reveal one. Teach: A drain tells you what is happening in a space you cannot see.
   Check: avoid a drain placed 'just in case', which then becomes a route for infection.
17_counts.png [step.core.counts]  Common.
18_specimen.png [step.core.specimen]  Common.
19_trephine.png [step.bowel.trephine]  Creating the stoma trephine: Excise a disc of skin at the marked site, roughly
   the diameter of the bowel being brought out; do not excise subcutaneous fat, just part it. Incise the anterior
   rectus sheath in a cruciate or vertical line, split the rectus muscle in the line of its fibres, and retract it.
   Teach: The trephine is a hole in the abdominal wall that must be large enough to keep the stoma perfused and small
   enough not to become a parastomal hernia. Check: avoid misaligned layers, which kink the bowel as it passes through
   and cause outflow obstruction.
20_stoma.png [step.abd.stoma]  Stoma formation: Site away from the costal margin, the umbilicus, the belt line, scars
   and skin creases, through the rectus muscle, where the patient can see it. Bring out a tension-free, well-perfused
   segment; check the colour after the abdomen is closed. Deliver the colon end through the trephine before closing
   the abdomen, with its mesentery oriented and without twist. Teach: A badly sited stoma is a lifelong problem for
   the patient and a daily one for the stoma nurse. Check: avoid siting the stoma under a skin fold that is only
   apparent when the patient sits up.
21_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Teach: Burst abdomen and incisional hernia are closure failures, and closure
   technique is one of the few variables entirely under the surgeon's control. Check: avoid large bites taken quickly
   at the end of a long case.
22_skin-closure.png [step.core.skin-closure]  Common. In heavy contamination, consider leaving the skin open or using
   delayed primary closure.
23_stoma-mature.png [step.bowel.stoma-mature]  Maturing the stoma and checking viability: Mature only after the main
   wound is closed and covered, so faecal contamination does not reach it. Ileostomy: evert to a spout of roughly 2 to
   3 cm (Brooke technique) using three-point sutures through the bowel edge, the seromuscular layer at the skin level
   and the dermis. End colostomy: flush or slightly raised, full-thickness to dermis. Teach: Small bowel effluent is
   caustic. Check: avoid sutures through the dermal surface rather than the dermis, which leave mucosal implants on
   the skin.
24_debrief.png [step.core.debrief]  Common.

C. LOOP ILEOSTOMY: FORMATION AND CLOSURE  (folder loop-ileostomy/)
01_consent-check.png [step.core.consent-check]  Common. Formation: explain high output and dehydration. Closure:
   explain bowel function after reversal, which can be erratic for months after a low anastomosis.
02_stoma-siting.png [step.bowel.stoma-siting]  Pre-operative stoma siting: Mark the site before theatre whenever time
   allows, ideally with a stoma specialist nurse, for any operation in which a stoma is possible. Examine the patient
   lying, sitting and standing. Choose a flat area of at least the size of the appliance flange, within the rectus
   sheath, below the belt line and where the patient can see it. Usually right iliac fossa, within the rectus. Teach:
   Most stoma leaks, skin problems and appliance failures trace back to where the stoma was put. Check: avoid siting
   on the supine anaesthetised patient, where a deep crease becomes visible only when the patient sits up on day two.
03_timeout.png [step.core.timeout]  Common. Run it at both the formation and the closure operation.
04_prophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
06_prep-drape.png [step.core.prep-drape]  Common.
07_select-loop.png [step.ileo.select-loop]  Selecting and orienting the loop: Identify the ileocaecal junction and
   select a mobile loop of terminal ileum roughly 20 to 30 cm proximal to it. Check that the loop reaches the trephine
   site easily. Teach: The loop must defunction what lies distal to it, reach the skin without tension and be closable
   later. Check: avoid selecting a loop too close to the valve.
08_trephine.png [step.bowel.trephine]  Creating the stoma trephine: Excise a disc of skin at the marked site, roughly
   the diameter of the bowel being brought out; do not excise subcutaneous fat, just part it. Incise the anterior
   rectus sheath in a cruciate or vertical line, split the rectus muscle in the line of its fibres, and retract it.
   Two fingers usually suffice. A loop needs a little more room than an end stoma. Teach: The trephine is a hole in
   the abdominal wall that must be large enough to keep the stoma perfused and small enough not to become a parastomal
   hernia. Check: avoid misaligned layers, which kink the bowel as it passes through and cause outflow obstruction.
09_deliver-loop.png [step.ileo.deliver-loop]  Delivering the loop and placing the rod: Pass a tape or soft sling
   around the loop through a window in the mesentery close to the bowel. Deliver the loop gently through the trephine
   with the marked proximal limb in the planned position, usually inferior. Teach: Delivery without twisting and
   without tearing the mesentery keeps the stoma perfused and functional. Check: avoid pulling the loop through a
   tight trephine, which tears the mesentery.
10_stoma-mature.png [step.bowel.stoma-mature]  Maturing the stoma and checking viability: Mature only after the main
   wound is closed and covered, so faecal contamination does not reach it. Ileostomy: evert to a spout of roughly 2 to
   3 cm (Brooke technique) using three-point sutures through the bowel edge, the seromuscular layer at the skin level
   and the dermis. Spout the afferent limb; mature the efferent limb flush. Formation ends here: haemostasis, counts,
   closure and debrief follow. Teach: Small bowel effluent is caustic. Check: avoid sutures through the dermal surface
   rather than the dermis, which leave mucosal implants on the skin.
11_closure-mobilise.png [step.ileo.closure-mobilise]  Closure: freeing the stoma from the abdominal wall: Incise
   around the mucocutaneous junction leaving a narrow skin cuff, or excise it. Dissect through the subcutaneous fat
   down to the fascia with the bowel under gentle traction. Teach: Closure is often taught as a minor operation, but
   most of its complications come from this step: enterotomies made while freeing a stoma that is densely adherent to
   fascia and peritoneum. Check: avoid dissecting on the bowel wall rather than on the fascia.
12_anastomosis-stapled.png [step.bowel.anastomosis-stapled]  Stapled side-to-side (functional end-to-end) anastomosis:
   Decide first whether an anastomosis is safe at all: haemodynamic instability, vasopressors, gross contamination,
   malnutrition and doubtful viability favour a stoma or a delayed anastomosis. Lay the two limbs side by side along
   their antimesenteric borders, make enterotomies at the corner, and fire a linear cutting stapler, keeping the
   mesentery clear. Closure option A: resect the stoma segment and make a stapled side-to-side anastomosis. Teach: An
   anastomosis heals only if it is well perfused, tension-free and made between healthy ends. Check: avoid overlapping
   staple lines at the crotch without reinforcement.
13_anastomosis-handsewn.png [step.bowel.anastomosis-handsewn]  Handsewn anastomosis: Confirm both ends bleed and lie
   together without tension; mobilise further rather than pull. Single-layer extramucosal interrupted or continuous
   technique with a slowly absorbable monofilament suture, end-to-end or end-to-side. Closure option B: trim the edges
   and close the enterotomy transversely by hand, or resect and anastomose end-to-end. Choose one option. Teach: A
   handsewn anastomosis adapts to bowel of mismatched calibre, to thick oedematous wall and to settings without a
   stapler. Check: avoid strangulating the edges by tying too tightly, which causes ischaemia rather than strength.
14_leak-check.png [step.bowel.leak-check]  Checking the repair or anastomosis: Inspect the whole circumference,
   including the mesenteric border and the crotch of a stapled anastomosis. Confirm the lumen is patent by palpation
   between finger and thumb. Teach: A defect found on the table costs a stitch. Check: avoid a negative air test
   treated as a guarantee: it excludes a technical hole, not later ischaemic breakdown.
15_fascia-closure.png [step.ileo.fascia-closure]  Closure: returning the bowel and closing the fascia: Return the
   anastomosis to the abdomen without tension or twist. Close the posterior and anterior sheath with a slowly
   absorbable or non-absorbable suture, taking good bites of healthy fascia. Teach: The old stoma site is a weak
   point. Check: avoid taking bowel in a fascial bite.
16_haemostasis.png [step.core.haemostasis]  Common.
17_counts.png [step.core.counts]  Common.
18_specimen.png [step.core.specimen]  Common. Closure: send the resected stoma segment if the unit policy requires;
   formation produces no specimen.
19_skin-closure.png [step.core.skin-closure]  Common. Closure wound: purse-string approximation leaving a small
   central defect to drain.
20_debrief.png [step.core.debrief]  Common.

D. LAPAROSCOPIC REPAIR OF PERFORATED DUODENAL ULCER  (folder lap-perforated-duodenal-ulcer/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Therapeutic antibiotics for peritonitis should already be running.
04_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. Open
   (Hasson) entry is safer in a distended septic abdomen. Teach: Access is where laparoscopy injures people. Check:
   avoid repeated blind Veress attempts.
07_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
08_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. Find the perforation by following the fibrin and bile to
   the anterior duodenum. If it is gastric, it needs a biopsy. Teach: The first look answers a question the imaging
   could not, and it is the only chance to find the second diagnosis before attention narrows to the first. Check:
   avoid going straight to the target and missing a second pathology.
09_expose.png [step.pdu.expose]  Exposing and assessing the perforation: Lift the liver edge to expose the pylorus and
   first part of the duodenum. Aspirate contaminated fluid around the perforation and send a sample for culture.
   Teach: The size, site and tissue quality of the perforation decide whether a laparoscopic patch is the right
   operation. Check: avoid starting the repair before deciding whether this perforation suits a laparoscopic patch.
10_patch.png [step.pdu.patch]  Omental patch repair: Place three interrupted absorbable sutures across the
   perforation, taking full-thickness bites of healthy duodenum well back from the edge, oriented along the long axis
   so the pylorus is not narrowed. Leave the sutures untied. Teach: A perforated ulcer edge is inflamed and holds
   sutures poorly. Check: avoid tying the sutures to close the hole before laying the omentum.
11_leak-check.png [step.bowel.leak-check]  Checking the repair or anastomosis: Inspect the whole circumference,
   including the mesenteric border and the crotch of a stapled anastomosis. Confirm the lumen is patent by palpation
   between finger and thumb. Air via the nasogastric tube with the repair under saline, or dilute methylene blue.
   Teach: A defect found on the table costs a stitch. Check: avoid a negative air test treated as a guarantee: it
   excludes a technical hole, not later ischaemic breakdown.
12_convert.png [step.pdu.convert]  When to convert or change the operation: Convert to open for haemodynamic
   deterioration, poor view, an inability to wash out adequately, or tissue that will not hold a patch. A large
   perforation may need a jejunal serosal patch, a pyloric exclusion, a resection, or a controlled duodenostomy: these
   are senior and often open decisions. Teach: Laparoscopy is a means to a good repair and a thorough washout, not an
   end. Check: avoid persisting laparoscopically because conversion feels like failure.
13_lavage.png [step.abd.lavage]  Peritoneal toilet: Remove particulate contamination mechanically from all four
   quadrants and the pelvis. Irrigate with warm saline and aspirate it completely; fluid left behind is a collection.
   Laparoscopic washout of all four quadrants, subphrenic spaces and pelvis with warm saline until the return is
   clear. Teach: Removing contamination is part of source control, but lavage does not substitute for closing the hole
   that produced it. Check: avoid lavage of a compartment that has not been fully opened, so the subphrenic collection
   is missed.
14_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. A drain near the repair is optional; WSES does not mandate one. Teach: A
   drain tells you what is happening in a space you cannot see. Check: avoid a drain placed 'just in case', which then
   becomes a route for infection.
15_haemostasis.png [step.core.haemostasis]  Common.
16_counts.png [step.core.counts]  Common.
17_specimen.png [step.core.specimen]  Common. Biopsy only for a gastric perforation. Duodenal ulcers are not routinely
   biopsied.
18_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Teach: A port-site hernia through an unclosed 10 mm fascial
   defect can strangulate, and it presents days later to someone who was not in theatre. Check: avoid removing all
   ports at once with the camera already out.
19_skin-closure.png [step.core.skin-closure]  Common.
20_debrief.png [step.core.debrief]  Common. Hand over the Helicobacter pylori test, the drug review and any biopsy
   result to chase.

E. SMALL BOWEL RESECTION WITH ANASTOMOSIS  (folder small-bowel-resection/)
01_consent-check.png [step.core.consent-check]  Common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_midline.png [step.abd.midline]  Midline laparotomy incision: Incise through skin, fat and linea alba, staying in
   the midline: drifting off it bleeds and weakens the closure. Enter the peritoneum between forceps under direct
   vision, then extend with fingers protecting the bowel. Teach: The midline is fast, bloodless and extensible in both
   directions, which is exactly what an unknown pathology needs. Check: avoid entering blind through a scar.
07_exploration.png [step.abd.exploration]  Systematic exploration: Follow the same sequence every time: liver and
   gallbladder, stomach and duodenum, spleen, small bowel from duodenojejunal flexure to caecum, colon and rectum,
   pelvis, retroperitoneum, hernial orifices from inside. Run the small bowel hand over hand, both surfaces, in one
   direction. Run the entire small bowel from the duodenojejunal flexure to the ileocaecal valve. There may be a
   second lesion. Teach: The purpose of a laparotomy is to find out. Check: avoid stopping the exploration when the
   expected pathology is found.
08_bowel-handling.png [step.abd.bowel-handling]  Handling and assessing bowel: Handle with the whole hand and moist
   packs; grasp the mesentery, not the bowel wall. Assess viability by colour, peristalsis, mesenteric pulsation and
   bleeding from a cut edge, and re-assess after warm packs and time. Relieve the obstruction first, wrap the segment
   in warm packs, and reassess after several minutes before deciding what to resect. Teach: Bowel handled roughly
   becomes ileus, adhesions and, at the extreme, a serosal tear that becomes a leak. Check: avoid deciding viability
   in the first 30 seconds.
09_define-margins.png [step.sbr.define-margins]  Deciding the extent of resection: Mark the proximal and distal limits
   on bowel that is clearly viable: pink, peristalsing, with pulsatile mesenteric vessels and bleeding from the
   serosa. For a tumour, take an adequate margin with the draining mesentery as the oncological plan requires. Teach:
   Every centimetre resected unnecessarily may matter later, and every centimetre of dead bowel left behind will
   perforate. Check: avoid resecting a long segment of dusky but recoverable bowel immediately after releasing a band.
10_mesentery-division.png [step.bowel.mesentery-division]  Dividing the mesentery: Transilluminate the mesentery to
   see the arcades and choose a line that preserves supply to both retained ends. Score the peritoneum on both faces,
   then divide between clips or ties, or with a vessel-sealing device in thin mesentery. Teach: The mesenteric
   division decides the blood supply of both cut ends. Check: avoid tied pedicles slipping in an oedematous mesentery,
   producing a mesenteric haematoma that compromises the anastomosis.
11_bowel-division.png [step.bowel.bowel-division]  Dividing the bowel: Pack off the field with moist swabs before
   division. Divide with a linear cutting stapler, or between non-crushing and crushing clamps, at the point already
   prepared on the mesenteric border. Teach: Division is where contamination of the field happens. Check: avoid
   including the mesentery in the staple line, which bleeds and devascularises the end.
12_anastomosis-stapled.png [step.bowel.anastomosis-stapled]  Stapled side-to-side (functional end-to-end) anastomosis:
   Decide first whether an anastomosis is safe at all: haemodynamic instability, vasopressors, gross contamination,
   malnutrition and doubtful viability favour a stoma or a delayed anastomosis. Lay the two limbs side by side along
   their antimesenteric borders, make enterotomies at the corner, and fire a linear cutting stapler, keeping the
   mesentery clear. Option A, if an anastomosis is safe. Teach: An anastomosis heals only if it is well perfused,
   tension-free and made between healthy ends. Check: avoid overlapping staple lines at the crotch without
   reinforcement.
13_anastomosis-handsewn.png [step.bowel.anastomosis-handsewn]  Handsewn anastomosis: Confirm both ends bleed and lie
   together without tension; mobilise further rather than pull. Single-layer extramucosal interrupted or continuous
   technique with a slowly absorbable monofilament suture, end-to-end or end-to-side. Option B, for thick, oedematous
   or mismatched bowel. Choose one. Teach: A handsewn anastomosis adapts to bowel of mismatched calibre, to thick
   oedematous wall and to settings without a stapler. Check: avoid strangulating the edges by tying too tightly, which
   causes ischaemia rather than strength.
14_mesenteric-defect.png [step.sbr.mesenteric-defect]  Closing the mesenteric defect: Close the cut edges of the
   mesentery with interrupted or continuous absorbable sutures, taking only the peritoneum. Watch the anastomotic ends
   for colour change as you close. Teach: An open mesenteric window can trap a loop of small bowel and cause an
   internal hernia. Check: avoid deep bites that ligate a vessel or create a haematoma.
15_leak-check.png [step.bowel.leak-check]  Checking the repair or anastomosis: Inspect the whole circumference,
   including the mesenteric border and the crotch of a stapled anastomosis. Confirm the lumen is patent by palpation
   between finger and thumb. Teach: A defect found on the table costs a stitch. Check: avoid a negative air test
   treated as a guarantee: it excludes a technical hole, not later ischaemic breakdown.
16_measure-length.png [step.sbr.measure-length]  Measuring and recording residual small bowel: Measure the remaining
   small bowel along the antimesenteric border without stretching, from the duodenojejunal flexure to the anastomosis
   and from the anastomosis to the valve or stoma. Record the total, whether the valve and colon remain, and the
   length and site of what was removed. Teach: The residual length, the presence of the ileocaecal valve and
   continuity with the colon predict the risk of intestinal failure. Check: avoid estimating rather than measuring.
17_lavage.png [step.abd.lavage]  Peritoneal toilet: Remove particulate contamination mechanically from all four
   quadrants and the pelvis. Irrigate with warm saline and aspirate it completely; fluid left behind is a collection.
   Teach: Removing contamination is part of source control, but lavage does not substitute for closing the hole that
   produced it. Check: avoid lavage of a compartment that has not been fully opened, so the subphrenic collection is
   missed.
18_haemostasis.png [step.core.haemostasis]  Common.
19_counts.png [step.core.counts]  Common.
20_specimen.png [step.core.specimen]  Common.
21_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Teach: Burst abdomen and incisional hernia are closure failures, and closure
   technique is one of the few variables entirely under the surgeon's control. Check: avoid large bites taken quickly
   at the end of a long case.
22_skin-closure.png [step.core.skin-closure]  Common.
23_debrief.png [step.core.debrief]  Common. State the residual length, the valve status and whether a second look is
   planned.

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
  surgx-abscess-drainage-steps.zip   (folder abscess-drainage/)
  surgx-hartmanns-procedure-steps.zip   (folder hartmanns-procedure/)
  surgx-loop-ileostomy-steps.zip   (folder loop-ileostomy/)
  surgx-lap-perforated-duodenal-ulcer-steps.zip   (folder lap-perforated-duodenal-ulcer/)
  surgx-small-bowel-resection-steps.zip   (folder small-bowel-resection/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
