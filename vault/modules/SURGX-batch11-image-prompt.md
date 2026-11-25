---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 11 (Laparoscopic inguinal hernia repair, Open umbilical and incisional hernia repair with mesh, Lateral internal sphincterotomy, Fistula-in-ano: fistulotomy and seton, Pilonidal sinus excision): Gemini image prompt (98 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant general and colorectal surgeons. You are making 98 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Laparoscopic inguinal hernia repair                            22 images
  B. Open umbilical and incisional hernia repair with mesh          20 images
  C. Lateral internal sphincterotomy                                19 images
  D. Fistula-in-ano: fistulotomy and seton                          19 images
  E. Pilonidal sinus excision                                       18 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Society of Colon and Rectal Surgeons (ASCRS), Clinical practice guideline for the management of anal fissures; American Society of Colon and Rectal Surgeons (ASCRS), Clinical practice guidelines for the management of anorectal abscess, fistula-in-ano, and rectovaginal fistula; American Society of Colon and Rectal Surgeons (ASCRS), Clinical practice guidelines for the management of pilonidal disease; Cochrane Database of Systematic Reviews, Healing by primary closure versus open healing after surgery for pilonidal sinus; Cochrane Database of Systematic Reviews, Operative procedures for fissure in ano; Daes J, Felix E (Annals of Surgery), Critical view of the myopectoral orifice; European Hernia Society and Americas Hernia Society, Guidelines on the treatment of primary umbilical and epigastric hernias; European Hernia Society, Classification of primary and incisional abdominal wall hernias; European Hernia Society, Guidelines on the closure of abdominal wall incisions; HerniaSurge Group, International guidelines for groin hernia management; International Endohernia Society (IEHS), Guidelines for laparoscopic (TAPP) and endoscopic (TEP) treatment of inguinal hernia; Parks AG, Gordon PH, Hardcastle JD (British Journal of Surgery), A classification of fistula-in-ano).
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
- A. Supine, both arms tucked at the sides so the surgeon and camera holder can stand on the opposite side to the
  hernia. Slight Trendelenburg to move the bowel out of the pelvis, with the patient secured to the table. Monitor at
  the foot of the table.
- B. Supine, arms out, with the abdomen exposed from the costal margins to the pubis for an incisional hernia. Urinary
  catheter for long incisional repairs or those extending to the pubis.
- C. Lithotomy or prone jack-knife; record which. Either general or regional anaesthesia, or local anaesthesia in
  selected patients.
- D. Lithotomy or prone jack-knife; record which, because the position determines how findings are described. General
  or regional anaesthesia, so the sphincters can be assessed and the tract explored.
- E. Prone jack-knife with the hips flexed. Tape the buttocks apart for exposure, and release the tapes before final
  closure to check tension. Pad the face, chest, iliac crests, knees and feet; check the eyes.
Step-specific facts:
- A. Anatomy: The myopectoral orifice is bounded by the conjoint tendon above, the iliopsoas laterally, the rectus
  sheath medially and Cooper's ligament below; all groin hernias pass through it. Must be right: Clear the whole
  myopectoral orifice so that all hernia sites, including femoral and obturator, are seen and covered. Never use
  energy or fixation in the triangle of doom or the triangle of pain. Parietalise the cord adequately so the lower
  mesh edge lies flat.
- B. Anatomy: The rectus sheath is formed by the aponeuroses of the three lateral muscles; above the arcuate line it
  has anterior and posterior layers, below it only an anterior layer, with the rectus resting on transversalis fascia
  and peritoneum. Must be right: Expect bowel adherent to the sac and scar, and dissect it under direct vision.
  Preserve the lateral neurovascular bundles: they are the lateral limit of the retromuscular plane. Close the
  posterior layer completely so the mesh does not contact bowel.
- C. Anatomy: The internal anal sphincter is smooth muscle, the continuation of the circular muscle of the rectum, and
  provides most of resting anal pressure. Must be right: Make the sphincterotomy lateral, never in the posterior
  midline. Divide only internal sphincter, and only to the tailored length. Biopsy any atypical fissure before
  treating it as idiopathic. Be conservative in women and in anyone with reduced continence.
- D. Anatomy: Most fistulas arise from infection of an anal gland at the dentate line (cryptoglandular origin). The
  internal opening is usually at the dentate line, most often in the posterior midline. Must be right: Never force a
  probe. Assess how much muscle lies below the tract before cutting anything. When in doubt, place a loose seton and
  image. Send tract tissue for histology, and for tuberculosis testing where suspected.
- E. Anatomy: The pits lie in the midline of the natal cleft over the sacrum and coccyx, often several in a line.
  Tracts usually run cranially and may emerge laterally as secondary openings. Must be right: Map every pit and
  lateral opening before incising. Excise only diseased tissue. Prefer off-midline closure over midline closure when
  closing primarily. Do not close primarily over active infection. Check flap tension with the buttock tapes released.
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

A. LAPAROSCOPIC INGUINAL HERNIA REPAIR  (folder lap-inguinal-hernia-repair/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side, examine both groins and confirm consent for the
   contralateral side if a second defect may be repaired.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_access.png [step.lap.access]  Establishing pneumoperitoneum: Prefer an open (Hasson) cut-down in a previously
   operated abdomen, in the very thin and in the very obese. Empty the stomach and the bladder before entry. TAPP:
   open umbilical access. TEP: go to the next step instead, and use the Veress only to vent an accidental
   pneumoperitoneum. Teach: Access is where laparoscopy injures people. Check: avoid repeated blind Veress attempts.
07_tep-space.png [step.lih.tep-space]  TEP: entering and developing the preperitoneal space: Make a small
   infraumbilical incision, incise the anterior rectus sheath on the side of the hernia and retract the rectus muscle
   laterally. Pass a balloon dissector or the telescope along the anterior surface of the posterior rectus sheath
   towards the pubis, in the midline behind the muscle. Teach: In TEP the whole operation happens in a space that does
   not exist until you make it. Check: avoid entering the peritoneum at the posterior sheath and then working with a
   collapsing space.
08_ports.png [step.lap.ports]  Port placement: Place the camera port first, inspect beneath the intended sites, then
   place every subsequent port under direct vision. Transilluminate the abdominal wall to avoid the inferior
   epigastric vessels. Teach: Ports placed for the anatomy you have, rather than for the textbook, are the difference
   between a comfortable operation and a fight. Check: avoid ports placed too close together, so the instruments fight
   each other.
09_survey.png [step.lap.survey]  Diagnostic laparoscopy and survey: Before touching the target, look at the liver,
   gallbladder, stomach, small bowel, colon, pelvis and both paracolic gutters. Note the character and volume of any
   free fluid, and aspirate it for culture where relevant. In TAPP, inspect both myopectoral orifices from inside
   before raising any flap, and the contents of any incarcerated hernia. Teach: The first look answers a question the
   imaging could not, and it is the only chance to find the second diagnosis before attention narrows to the first.
   Check: avoid going straight to the target and missing a second pathology.
10_peritoneal-flap.png [step.lih.peritoneal-flap]  TAPP: raising the peritoneal flap: Incise the peritoneum from the
   medial umbilical ligament to the anterior superior iliac spine, a few centimetres above the defect and the deep
   ring. Develop the upper flap down in the areolar plane anterior to the transversalis fascia, then the lower flap,
   keeping the peritoneum intact. Teach: The flap opens the preperitoneal space from inside and must later cover the
   mesh completely. Check: avoid starting the incision too low, over the defect, which leaves no flap to close.
11_landmarks.png [step.lih.landmarks]  Defining the myopectoral orifice and its danger zones: Clear the space of
   Retzius medially to the pubic symphysis and Cooper's ligament, crossing the midline in a bilateral repair. Identify
   the inferior epigastric vessels, the iliopubic tract, the vas deferens (or round ligament) and the gonadal vessels.
   Teach: From behind, the groin is a different anatomy. Check: avoid dissecting in the triangle of doom with an
   energy device.
12_convert.png [step.hernia.convert]  Bailout: convert, stop, or call for help: Name the trigger before you start:
   anatomy that cannot be identified, bleeding that obscures the view, suspected perforation, or no progress over a
   set time. When a trigger occurs, stop dissecting, control what you can with pressure or a grasper, and tell the
   anaesthetist and scrub team. Convert to TAPP or open if the TEP space keeps collapsing or the landmarks cannot be
   defined; convert to open for uncontrolled bleeding. Teach: Conversion is a safe outcome, not a failure. Check:
   avoid converting only after the injury rather than before it.
13_sac-reduction.png [step.hernia.sac-reduction]  Reducing the sac and judging its contents: Define the neck of the
   sac at the edge of the defect before pulling on anything; traction without a defined neck tears the sac and what
   lies in it. Reduce with gentle counter-traction, sac towards you and tissues away, staying on the sac wall rather
   than the structures around it. Indirect sacs are reduced off the cord; direct sacs and the pseudosac of
   transversalis fascia are reduced from the defect. Look for and reduce a cord lipoma. Teach: Most hernia
   complications start with the sac: contents injured during reduction, non-viable bowel returned to the abdomen, or a
   sac left partly unreduced that becomes the recurrence. Check: avoid reducing a tight hernia en masse with the
   constriction still intact.
14_parietalisation.png [step.lih.parietalisation]  Parietalisation of the cord structures: After reducing the indirect
   sac, continue separating the peritoneum from the vas and the gonadal vessels proximally, well beyond the deep ring.
   Dissect with blunt instruments along the cord structures; avoid diathermy on the vas and the vessels. Teach: The
   lower edge of the mesh can only lie flat if the peritoneum is lifted well off the vas and gonadal vessels. Check:
   avoid stopping parietalisation at the deep ring, so the mesh edge rolls up.
15_contamination-bailout.png [step.hernia.contamination-bailout]  Bailout: enterotomy or contamination in a mesh
   repair: Stop and say aloud that the bowel has been opened or that contamination is present, so the team changes
   gear with you. Control spillage first, then repair the enterotomy in healthy tissue, transversely, or resect if the
   segment is damaged; inspect the adjacent loops for a second injury. Teach: A bowel injury or unexpected
   contamination changes the operation. Check: avoid completing the planned permanent mesh repair 'because the leak
   was small'.
16_mesh-handling.png [step.hernia.mesh-handling]  Choosing, sizing and handling the mesh: Measure the defect after the
   sac is reduced and the edges are defined, not from the skin, and size the mesh for the overlap the repair needs.
   Choose the mesh for the plane: a standard synthetic mesh for the extraperitoneal and retromuscular planes; a mesh
   designed for peritoneal contact only if it will lie against bowel. Teach: Mesh repair halves recurrence compared
   with suture alone for most hernias, but only when the mesh is large enough, lies flat in the chosen plane and stays
   clean. Check: avoid a mesh cut down to fit a small dissection rather than a dissection enlarged to fit the right
   mesh.
17_mesh-place.png [step.lih.mesh-place]  Positioning and fixing the mesh in the preperitoneal space: Introduce a mesh
   of adequate size; HerniaSurge recommends at least 10 by 15 cm for an adult. Position it to overlap the pubic
   symphysis medially, cover Cooper's ligament and the femoral canal, and lie lateral to the deep ring, with the lower
   edge lying on the parietalised peritoneum. Teach: The mesh must cover the whole myopectoral orifice, direct,
   indirect and femoral spaces, with overlap. Check: avoid a mesh too small to cover the femoral space.
18_flap-closure.png [step.lih.flap-closure]  Closing the peritoneum and deflating under vision: TAPP: close the
   peritoneal flap completely over the mesh with a running suture or tacks, leaving no gap and no mesh exposed. Close
   any tear in the peritoneum found during the dissection. Teach: Exposed mesh adheres to bowel, and a gap in the
   peritoneal closure can trap a loop of bowel. Check: avoid a partial flap closure with mesh visible at one corner.
19_counts.png [step.core.counts]  Common.
20_closure.png [step.lap.closure]  Desufflation and port-site closure: Inspect the operative field again at low
   insufflation pressure: bleeding tamponaded by pneumoperitoneum appears as the pressure falls. Remove ports under
   vision and check each site from inside for bleeding. Close the anterior rectus sheath at the TEP camera site and
   every port of 10 mm or more. Teach: A port-site hernia through an unclosed 10 mm fascial defect can strangulate,
   and it presents days later to someone who was not in theatre. Check: avoid removing all ports at once with the
   camera already out.
21_skin-closure.png [step.core.skin-closure]  Common.
22_debrief.png [step.core.debrief]  Common.

B. OPEN UMBILICAL AND INCISIONAL HERNIA REPAIR WITH MESH  (folder open-ventral-hernia-repair/)
01_consent-check.png [step.core.consent-check]  Common. Mark the hernia standing and record whether the umbilicus may
   be excised.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_incision.png [step.vhr.incision]  Incision and exposure of the hernia: Umbilical or paraumbilical: a curved
   infraumbilical or supraumbilical incision at the edge of the umbilicus, sized to the defect. Incisional: excise the
   old scar through a midline incision, removing thin or ulcerated skin, but keep enough skin for closure without
   tension. Teach: The incision has to reach healthy fascia in every direction around the defect and must not
   devascularise the skin. Check: avoid cutting straight down into a sac that lies just under thin skin and entering
   adherent bowel.
07_sac-reduction.png [step.hernia.sac-reduction]  Reducing the sac and judging its contents: Define the neck of the
   sac at the edge of the defect before pulling on anything; traction without a defined neck tears the sac and what
   lies in it. Reduce with gentle counter-traction, sac towards you and tissues away, staying on the sac wall rather
   than the structures around it. Open the sac to divide adhesions under vision in incisional hernias; a small
   umbilical sac may simply be reduced. Teach: Most hernia complications start with the sac: contents injured during
   reduction, non-viable bowel returned to the abdomen, or a sac left partly unreduced that becomes the recurrence.
   Check: avoid reducing a tight hernia en masse with the constriction still intact.
08_contamination-bailout.png [step.hernia.contamination-bailout]  Bailout: enterotomy or contamination in a mesh
   repair: Stop and say aloud that the bowel has been opened or that contamination is present, so the team changes
   gear with you. Control spillage first, then repair the enterotomy in healthy tissue, transversely, or resect if the
   segment is damaged; inspect the adjacent loops for a second injury. Teach: A bowel injury or unexpected
   contamination changes the operation. Check: avoid completing the planned permanent mesh repair 'because the leak
   was small'.
09_defect-assess.png [step.vhr.defect-assess]  Measuring the defect and choosing the repair: Define the fascial edges
   all round, then palpate and inspect the whole length of the previous incision for further defects. Measure the
   width and length of the defect, and classify it using the EHS system (location and width) for the record. Teach:
   The repair is chosen after the fascia is defined, not from the clinic note. Check: avoid repairing one defect and
   missing a second along the same scar.
10_retrorectus.png [step.vhr.retrorectus]  Developing the retromuscular plane: Incise the posterior rectus sheath
   about half to one centimetre from its medial edge, on each side, so a strong medial edge remains for closure. Lift
   the rectus muscle off the posterior sheath with blunt dissection, controlling perforating vessels as they are met.
   Teach: The retromuscular space between the rectus muscle and the posterior sheath is well vascularised and
   separated from the bowel, so a mesh there is protected and integrates well. Check: avoid dividing the neurovascular
   bundles at the lateral edge of the plane, denervating the rectus muscle.
11_posterior-closure.png [step.vhr.posterior-closure]  Closing the posterior layer: Close the posterior sheath and
   peritoneum in the midline with a continuous slowly absorbable suture, including any opened sac edges. Repair every
   buttonhole made during the dissection. Teach: The posterior sheath and peritoneum separate the mesh from the bowel.
   Check: avoid leaving small holes in the posterior layer that later let bowel touch the mesh.
12_mesh-handling.png [step.hernia.mesh-handling]  Choosing, sizing and handling the mesh: Measure the defect after the
   sac is reduced and the edges are defined, not from the skin, and size the mesh for the overlap the repair needs.
   Choose the mesh for the plane: a standard synthetic mesh for the extraperitoneal and retromuscular planes; a mesh
   designed for peritoneal contact only if it will lie against bowel. Teach: Mesh repair halves recurrence compared
   with suture alone for most hernias, but only when the mesh is large enough, lies flat in the chosen plane and stays
   clean. Check: avoid a mesh cut down to fit a small dissection rather than a dissection enlarged to fit the right
   mesh.
13_mesh-sublay.png [step.vhr.mesh-sublay]  Placing the mesh in the sublay position: Size the mesh to overlap the
   defect generously in every direction; incisional repairs need wider overlap than primary umbilical repairs. Lay the
   mesh flat on the closed posterior layer, extending into the dissected space, with no folds. Teach: In sublay the
   mesh is held in place by intra-abdominal pressure against the rectus muscles, and the overlap beyond the defect,
   not the number of sutures, prevents recurrence. Check: avoid a mesh cut small to fit a limited dissection.
14_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. A suction drain in the retromuscular or subcutaneous space is a unit
   decision; bring it out through separate clean skin away from the mesh. Teach: A drain tells you what is happening
   in a space you cannot see. Check: avoid a drain placed 'just in case', which then becomes a route for infection.
15_haemostasis.png [step.core.haemostasis]  Common. Check the perforating vessels in the retromuscular plane before
   closing over the mesh: a haematoma here becomes a mesh infection.
16_counts.png [step.core.counts]  Common.
17_mass-closure.png [step.abd.mass-closure]  Mass closure of the abdominal wall: Use a continuous slowly-absorbable
   suture with a suture length to wound length ratio of at least four to one. Take small bites close to the edge
   rather than large bites far from it. Close the anterior sheath over the mesh with a small-bite technique and a
   suture length to wound length ratio of at least four to one, without tension. Teach: Burst abdomen and incisional
   hernia are closure failures, and closure technique is one of the few variables entirely under the surgeon's
   control. Check: avoid large bites taken quickly at the end of a long case.
18_specimen.png [step.core.specimen]  Common. Send excised omentum or bowel; the sac and skin are sent if they look
   abnormal.
19_skin-closure.png [step.core.skin-closure]  Common. Reattach the umbilical stalk to the fascia to restore the
   umbilicus, and close dead space without strangulating fat.
20_debrief.png [step.core.debrief]  Common.

C. LATERAL INTERNAL SPHINCTEROTOMY  (folder lateral-internal-sphincterotomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the patient has had the incontinence risk explained in
   their own terms, and the baseline continence is recorded.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Routine antibiotic prophylaxis is not standard; follow local
   policy.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_local-block.png [step.ano.local-block]  Local anaesthetic infiltration for perianal and sacrococcygeal surgery:
   Calculate the maximum safe dose for the patient's weight before drawing up, and agree with the anaesthetist what
   has already been given. Infiltrate perianal skin and the intersphincteric and ischioanal spaces circumferentially
   for anal procedures, or around the tracts and pits for pilonidal surgery, aspirating before each injection.
   Infiltrate lateral to the canal at the sphincterotomy site; avoid injecting into the fissure. Teach: Local
   infiltration with a vasoconstrictor reduces bleeding, opens tissue planes and lowers early post-operative pain and
   opioid use, and it allows many anorectal operations to be done as day cases with less urinary retention. Check:
   avoid exceeding the weight-based maximum dose by adding several syringes without counting.
07_eua.png [step.ano.eua]  Examination under anaesthesia: confirm the diagnosis before the operation: Inspect the
   perianal skin, then perform a careful digital rectal examination, assessing sphincter tone, any induration and any
   mass. Perform proctoscopy around the full circumference and rigid or flexible sigmoidoscopy as indicated, looking
   for proctitis, polyps and tumour. Confirm the fissure is typical. A lateral, multiple, painless or large fissure
   needs biopsy and investigation. Teach: The pre-operative diagnosis in anorectal surgery is often made in an awake
   patient in pain. Check: avoid proceeding with the planned operation on a lesion that looks wrong.
08_sphincter-identify.png [step.ano.sphincter-identify]  Identifying the internal and external sphincters: Place a
   bivalve anal retractor gently; over-stretching the anus is itself a cause of sphincter injury. Palpate the
   intersphincteric groove between the lower edge of the internal sphincter and the subcutaneous external sphincter.
   Palpate the intersphincteric groove on the chosen lateral side and the hypertonic lower edge of the internal
   sphincter. Teach: Faecal incontinence is the injury of anorectal surgery and it is usually permanent. Check: avoid
   using a self-retaining retractor opened forcibly, stretching the sphincters.
09_when-to-stop.png [step.ano.when-to-stop]  Bailout: stop, change the plan, or come back another day: Stop if the
   examination shows something that changes the diagnosis: suspected tumour, Crohn's disease, an atypical ulcer,
   sepsis not yet drained or a fistula higher than expected. Take biopsies, drain any sepsis and place a loose seton
   where a fistula tract is uncertain or complex, and plan definitive surgery after imaging and discussion. An
   atypical fissure, unexpected sepsis or a thin sphincter: biopsy and choose a sphincter-preserving alternative.
   Teach: Anorectal operations are elective and the sphincter does not regrow. Check: avoid completing a fistulotomy
   on a tract that crosses most of the external sphincter because the patient was consented for it.
10_approach.png [step.lis.approach]  Approach to the lateral internal sphincter: open or closed: Choose the left or
   right lateral position, away from the fissure and away from any previous anal scar. Open technique: make a short
   radial or circumferential incision over the intersphincteric groove and display the lower edge of the internal
   sphincter. Teach: The sphincterotomy is placed laterally, away from the fissure, because a posterior midline
   division leaves a keyhole deformity and soiling. Check: avoid posterior midline sphincterotomy.
11_division.png [step.lis.division]  Dividing the internal sphincter to a tailored length: Divide the internal
   sphincter from its lower edge upwards, under vision or against the finger in the canal. Limit the division to the
   length of the fissure or to the dentate line, whichever is shorter. Teach: Healing depends on relieving the
   hypertonia, and continence depends on not dividing too much. Check: avoid dividing to the dentate line routinely
   regardless of fissure length.
12_check.png [step.lis.check]  Confirming the division and dealing with the fissure: Palpate the site: a gap in the
   internal sphincter should be felt where the tight band was. Apply pressure for a few minutes to prevent an
   intersphincteric haematoma, particularly after a closed sphincterotomy. Teach: A palpable gap confirms the
   hypertonic band is released. Check: avoid not checking the division and leaving the hypertonia unaltered.
13_haemostasis.png [step.core.haemostasis]  Common. Direct pressure for a few minutes; an intersphincteric haematoma
   is the commonest early problem.
14_final-inspection.png [step.ano.final-inspection]  Final inspection of the anal canal: Re-insert the anal retractor
   gently and inspect every wound and pedicle for bleeding, including the internal apex of each wound. Check the anal
   calibre with a finger or a standard dilator size the unit uses: the canal should admit an anal retractor without
   tension. Teach: Bleeding, an over-tight canal and a missed second lesion are all visible at the end of the
   operation and invisible once the patient is awake and the swelling starts. Check: avoid leaving a forgotten swab or
   pack in the rectum.
15_counts.png [step.core.counts]  Common.
16_specimen.png [step.core.specimen]  Common. Send any fissure biopsy, sentinel tag or papilla labelled by position,
   or record that none was sent.
17_skin-closure.png [step.core.skin-closure]  Common. Open technique: leave the small wound open or close it loosely
   with absorbable sutures. Closed technique: no closure needed.
18_wound-care.png [step.ano.wound-care]  Dressing, bowel regimen and the plan for the open wound: Apply a light
   dressing; avoid tight packing of the anal canal, which increases pain and urinary retention. Prescribe a stool
   softener and fibre from the day of surgery, with regular simple analgesia and minimal opioid. Teach: Most anorectal
   and pilonidal wounds are left open or are under tension during defaecation. Check: avoid discharging a patient on
   opioids without a laxative.
19_debrief.png [step.core.debrief]  Common.

D. FISTULA-IN-ANO: FISTULOTOMY AND SETON  (folder fistula-in-ano-surgery/)
01_consent-check.png [step.core.consent-check]  Common. Consent should explicitly allow seton placement instead of
   fistulotomy if the tract is higher than expected.
02_timeout.png [step.core.timeout]  Common. Display any MRI and state the expected tract anatomy at the time-out.
03_prophylaxis.png [step.core.prophylaxis]  Common. Follow local policy; antibiotics are for surrounding cellulitis or
   specific indications, not routine fistula surgery.
04_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_local-block.png [step.ano.local-block]  Local anaesthetic infiltration for perianal and sacrococcygeal surgery:
   Calculate the maximum safe dose for the patient's weight before drawing up, and agree with the anaesthetist what
   has already been given. Infiltrate perianal skin and the intersphincteric and ischioanal spaces circumferentially
   for anal procedures, or around the tracts and pits for pilonidal surgery, aspirating before each injection. Teach:
   Local infiltration with a vasoconstrictor reduces bleeding, opens tissue planes and lowers early post-operative
   pain and opioid use, and it allows many anorectal operations to be done as day cases with less urinary retention.
   Check: avoid exceeding the weight-based maximum dose by adding several syringes without counting.
07_eua.png [step.ano.eua]  Examination under anaesthesia: confirm the diagnosis before the operation: Inspect the
   perianal skin, then perform a careful digital rectal examination, assessing sphincter tone, any induration and any
   mass. Perform proctoscopy around the full circumference and rigid or flexible sigmoidoscopy as indicated, looking
   for proctitis, polyps and tumour. Note every external opening, its distance from the verge and its position, and
   feel for induration and secondary tracts. Teach: The pre-operative diagnosis in anorectal surgery is often made in
   an awake patient in pain. Check: avoid proceeding with the planned operation on a lesion that looks wrong.
08_sphincter-identify.png [step.ano.sphincter-identify]  Identifying the internal and external sphincters: Place a
   bivalve anal retractor gently; over-stretching the anus is itself a cause of sphincter injury. Palpate the
   intersphincteric groove between the lower edge of the internal sphincter and the subcutaneous external sphincter.
   Teach: Faecal incontinence is the injury of anorectal surgery and it is usually permanent. Check: avoid using a
   self-retaining retractor opened forcibly, stretching the sphincters.
09_internal-opening.png [step.fia.internal-opening]  Finding the internal opening: Note the position and distance of
   each external opening from the anal verge and apply Goodsall's rule as a guide, knowing its exceptions (anterior
   openings further from the verge often track posteriorly). Palpate for the indurated cord of the tract running
   towards the canal. Teach: A fistula is cured only when the internal opening is dealt with. Check: avoid forcing a
   probe and creating a false internal opening, usually higher than the true one.
10_classify.png [step.fia.classify]  Classifying the tract and deciding: lay open or seton: With the probe in the
   tract, palpate how much sphincter lies below it and where it crosses relative to the anorectal ring. Classify the
   tract using the Parks system (intersphincteric, trans-sphincteric, suprasphincteric, extrasphincteric) and look for
   secondary extensions or a horseshoe component. Teach: The decision to divide muscle is the decision about
   continence. Check: avoid underestimating the sphincter involved because the patient is relaxed under anaesthesia.
11_when-to-stop.png [step.ano.when-to-stop]  Bailout: stop, change the plan, or come back another day: Stop if the
   examination shows something that changes the diagnosis: suspected tumour, Crohn's disease, an atypical ulcer,
   sepsis not yet drained or a fistula higher than expected. Take biopsies, drain any sepsis and place a loose seton
   where a fistula tract is uncertain or complex, and plan definitive surgery after imaging and discussion. Uncertain
   anatomy, high or complex tract, Crohn's disease or suspicion of malignancy: loose seton, biopsy and MRI, not
   division. Teach: Anorectal operations are elective and the sphincter does not regrow. Check: avoid completing a
   fistulotomy on a tract that crosses most of the external sphincter because the patient was consented for it.
12_fistulotomy.png [step.fia.fistulotomy]  Fistulotomy: laying open a simple low tract: With the probe through both
   openings, divide the skin, subcutaneous tissue and the sphincter fibres overlying the probe in one line. Curette
   the granulation tissue from the base of the tract and send it for histology, and for tuberculosis culture where
   clinically suspected. Teach: Fistulotomy has the highest healing rate of any fistula operation, provided the tract
   is simple and low. Check: avoid dividing muscle along a false track created by the probe.
13_seton.png [step.fia.seton]  Placing a loose draining seton: Pass the seton material (for example a silicone sling
   or a non-absorbable suture) along the probe through the tract. Lay open the skin and subcutaneous portion only,
   below the sphincter, so the seton sits comfortably. Teach: A loose seton keeps the tract draining, controls sepsis
   and protects the sphincter while the anatomy is defined and definitive surgery is planned. Check: avoid tying the
   seton tight, turning a draining seton into a cutting one without consent.
14_haemostasis.png [step.core.haemostasis]  Common.
15_final-inspection.png [step.ano.final-inspection]  Final inspection of the anal canal: Re-insert the anal retractor
   gently and inspect every wound and pedicle for bleeding, including the internal apex of each wound. Check the anal
   calibre with a finger or a standard dilator size the unit uses: the canal should admit an anal retractor without
   tension. Teach: Bleeding, an over-tight canal and a missed second lesion are all visible at the end of the
   operation and invisible once the patient is awake and the swelling starts. Check: avoid leaving a forgotten swab or
   pack in the rectum.
16_counts.png [step.core.counts]  Common.
17_specimen.png [step.core.specimen]  Common. Send tract curettings for histology, and for tuberculosis culture or PCR
   where clinically suspected.
18_wound-care.png [step.ano.wound-care]  Dressing, bowel regimen and the plan for the open wound: Apply a light
   dressing; avoid tight packing of the anal canal, which increases pain and urinary retention. Prescribe a stool
   softener and fibre from the day of surgery, with regular simple analgesia and minimal opioid. Teach: Most anorectal
   and pilonidal wounds are left open or are under tension during defaecation. Check: avoid discharging a patient on
   opioids without a laxative.
19_debrief.png [step.core.debrief]  Common. Record the internal opening, tract type, sphincter involvement, the
   patient's position and whether fistulotomy or seton was done.

E. PILONIDAL SINUS EXCISION  (folder pilonidal-sinus-excision/)
01_consent-check.png [step.core.consent-check]  Common. Agree the planned wound technique (open or off-midline
   closure) and the time to heal with the patient beforehand.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Follow local policy; prophylaxis is commonly given for flap
   closure.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common. Clip hair before preparation, and keep the anus excluded from the
   field with an adhesive drape.
06_mapping.png [step.pns.mapping]  Mapping the pits and tracts: Shave or clip the area if not already done, and
   identify every midline pit and every lateral opening. Pass a fine probe gently along each tract to define its
   direction and length; most run cranially from the midline pits. Teach: Recurrence after pilonidal surgery usually
   comes from a pit or a lateral tract that was not included. Check: avoid missing a lateral opening hidden in the
   hair.
07_local-block.png [step.ano.local-block]  Local anaesthetic infiltration for perianal and sacrococcygeal surgery:
   Calculate the maximum safe dose for the patient's weight before drawing up, and agree with the anaesthetist what
   has already been given. Infiltrate perianal skin and the intersphincteric and ischioanal spaces circumferentially
   for anal procedures, or around the tracts and pits for pilonidal surgery, aspirating before each injection.
   Infiltrate around the marked ellipse, not into the tracts; adrenaline helps a dry field. Teach: Local infiltration
   with a vasoconstrictor reduces bleeding, opens tissue planes and lowers early post-operative pain and opioid use,
   and it allows many anorectal operations to be done as day cases with less urinary retention. Check: avoid exceeding
   the weight-based maximum dose by adding several syringes without counting.
08_excision.png [step.pns.excision]  Excising the sinus and its tracts: Incise around the marked pits and tracts with
   a narrow ellipse, or an asymmetric ellipse when an off-midline closure is planned. Excise the tracts with a margin
   of healthy fat, following the stained or probed tracts, and stop when the tissue is clean. Teach: The aim is to
   remove all diseased pits and tracts with as little healthy tissue as possible. Check: avoid excising far more
   tissue than the disease, leaving a wound that will not close.
09_closure-decision.png [step.pns.closure-decision]  Choosing how to close: open, midline or off-midline: If closing
   primarily, choose an off-midline technique (for example Karydakis, Bascom cleft lift or a rhomboid Limberg flap) in
   preference to midline closure; the ASCRS guideline recommends off-midline over midline closure. Leave the wound
   open to heal by secondary intention if there is acute sepsis, gross contamination or when the patient and the unit
   prefer it; it heals more slowly but avoids a failed closure. Teach: The choice of wound management decides healing
   time and recurrence. Check: avoid midline primary closure by default.
10_haemostasis.png [step.core.haemostasis]  Common.
11_offmidline.png [step.pns.offmidline]  Off-midline closure: flattening the cleft: Karydakis: after an asymmetric
   elliptical excision, mobilise a flap of skin and fat from the medial edge, advance it across the midline and suture
   its deep part to the fascia on the opposite side, so the final scar lies lateral to the midline. Cleft lift
   (Bascom): excise the skin of the cleft asymmetrically, raise a thin flap and advance it to obliterate the cleft, so
   the suture line lies off the midline. Teach: An off-midline closure works by flattening the natal cleft and placing
   the scar away from the midline, where friction, moisture and hair drive recurrence. Check: avoid releasing the
   tapes only after closure and finding the flap under tension.
12_leave-open.png [step.pns.leave-open]  Bailout: abandon primary closure and leave the wound open: Abandon closure if
   the flap will not lie without tension with the tapes released, if unexpected pus or an undrained cavity is found,
   or if the flap edge looks dusky. Remove any sutures already placed, irrigate, and dress the wound lightly to heal
   by secondary intention. Teach: A flap closed under tension, over hidden infection or with doubtful blood supply
   breaks down, and a failed closure heals more slowly than a wound left open from the start. Check: avoid persisting
   with a tight closure because the patient was told they would have one.
13_drain.png [step.abd.drain]  Drain placement: Place a drain when you want early warning of a specific complication,
   or to drain an established collection. Bring it out through a separate stab wound in clean skin, secure it, and
   record the type and site in the note. A suction drain under a flap reduces seroma; bring it out away from the
   suture line. Teach: A drain tells you what is happening in a space you cannot see. Check: avoid a drain placed
   'just in case', which then becomes a route for infection.
14_counts.png [step.core.counts]  Common.
15_specimen.png [step.core.specimen]  Common. Send the specimen; malignancy in chronic pilonidal disease is rare but
   described.
16_skin-closure.png [step.core.skin-closure]  Common. Open wound: dress lightly, do not pack tightly. Flap: close skin
   without tension.
17_wound-care.png [step.ano.wound-care]  Dressing, bowel regimen and the plan for the open wound: Apply a light
   dressing; avoid tight packing of the anal canal, which increases pain and urinary retention. Prescribe a stool
   softener and fibre from the day of surgery, with regular simple analgesia and minimal opioid. Hair control and who
   changes the dressing are part of the plan, not an afterthought. Teach: Most anorectal and pilonidal wounds are left
   open or are under tension during defaecation. Check: avoid discharging a patient on opioids without a laxative.
18_debrief.png [step.core.debrief]  Common.

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
  surgx-lap-inguinal-hernia-repair-steps.zip   (folder lap-inguinal-hernia-repair/)
  surgx-open-ventral-hernia-repair-steps.zip   (folder open-ventral-hernia-repair/)
  surgx-lateral-internal-sphincterotomy-steps.zip   (folder lateral-internal-sphincterotomy/)
  surgx-fistula-in-ano-surgery-steps.zip   (folder fistula-in-ano-surgery/)
  surgx-pilonidal-sinus-excision-steps.zip   (folder pilonidal-sinus-excision/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
