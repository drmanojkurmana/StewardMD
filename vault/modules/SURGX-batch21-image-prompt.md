---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 21 (Adenoidectomy, Cortical and modified radical mastoidectomy, Tympanoplasty type 1, Superficial parotidectomy with facial nerve identification, Direct laryngoscopy and microlaryngoscopy with biopsy): Gemini image prompt (102 images, 5 operations)

Built 2026-11-21 by `make10.py`: positioning and precise facts come from each procedure's own chapters. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant ENT surgeons. You are making 102 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Adenoidectomy                                                  18 images
  B. Cortical and modified radical mastoidectomy                    22 images
  C. Tympanoplasty type 1 (underlay)                                22 images
  D. Superficial parotidectomy with facial nerve identification     21 images
  E. Direct laryngoscopy and microlaryngoscopy with biopsy          19 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks, operative atlases, the guidance below and
   operative videos (American Academy of Otolaryngology-Head and Neck Surgery Foundation (AAO-HNSF), Clinical Practice Guideline: Tonsillectomy in Children (Update); American Academy of Otolaryngology-Head and Neck Surgery Foundation (AAO-HNSF), Clinical Practice Guideline: Tympanostomy Tubes in Children (Update); Difficult Airway Society (DAS), Difficult Airway Society 2015 guidelines for management of unanticipated difficult intubation in adults; ENT UK and partner specialty associations (UK National Multidisciplinary Guidelines), Laryngeal cancer: United Kingdom National Multidisciplinary Guidelines (Jones TM et al., J Laryngol Otol); ENT UK and partner specialty associations (UK National Multidisciplinary Guidelines), Management of salivary gland tumours: United Kingdom National Multidisciplinary Guidelines (Sood S, McGurk M, Vaz F, J Laryngol Otol); European Academy of Otology and Neurotology and Japan Otological Society (EAONO/JOS), EAONO/JOS joint consensus statements on the definitions, classification and staging of middle ear cholesteatoma (Yung M et al., J Int Adv Otol); Laryngoscope, Theory and practice of tympanoplasty (Wullstein H); National Institute for Health and Care Excellence (NICE), Cancer of the upper aerodigestive tract: assessment and management in people aged 16 and over (NG36); National Institute for Health and Care Excellence (NICE), Otitis media with effusion in under 12s (NG233)).
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
- A. Supine on a head ring with a shoulder roll and moderate neck extension, so the nasopharynx is visible behind the
  soft palate. Mouth gag with a tongue blade sized for the child, the tube sitting in the groove, suspended on Draffin
  rods or a holder.
- B. Supine with the head turned away from the operative ear on a head ring, the mastoid uppermost. Check the neck is
  not over-rotated, particularly in older patients. Head-up tilt and the table rotated as needed so the surgeon can
  see down the canal without the patient's head being moved.
- C. Supine with the head turned away from the operative ear on a head ring, with head-up tilt. Table rotated so the
  surgeon's line of sight runs down the canal; the head is not moved during the operation. Pressure care and eye
  protection, and the tube fixed on the non-operative side.
- D. Supine with a head ring and a shoulder roll, the head turned away from the operative side and extended
  moderately. Reverse Trendelenburg tilt to reduce venous bleeding. Tube fixed on the opposite side.
- E. Supine with the neck flexed on the chest and the head extended at the atlanto-occipital joint (the sniffing
  position), on a head ring with a pillow or adjustable headrest.
Step-specific facts:
- A. Anatomy: The adenoid is lymphoid tissue on the roof and posterior wall of the nasopharynx, above the free edge of
  the soft palate. The torus tubarius and Eustachian tube openings are on the lateral walls. Injury causes scarring
  and tubal dysfunction. Must be right: Palpate the soft palate before removing any adenoid. A notch in the hard
  palate, a bifid uvula or a translucent midline zone suggests a submucous cleft. Work under vision with a mirror or
  endoscope. Blind curettage misses lateral tissue and injures the tori.
- B. Anatomy: The suprameatal (Macewen's) triangle, bounded by the temporal line above, the posterosuperior canal wall
  in front and a tangent behind, overlies the mastoid antrum, which lies roughly 1.5 cm deep in the adult and much
  closer to the surface in an infant. Must be right: Identify the lateral semicircular canal before working anywhere
  near the facial nerve, and use it to locate the nerve. Identify the tegmen and the sigmoid sinus early and follow
  them, so the cavity has known boundaries.
- C. Anatomy: The tympanic membrane has a pars tensa held in the tympanic sulcus by the fibrous annulus, and a pars
  flaccida above the lateral process of the malleus. The handle of the malleus is embedded in the pars tensa. Must be
  right: See the whole perforation edge before grafting. A bulging anterior canal wall that hides the anterior margin
  needs a canalplasty, not a guess.
- D. Anatomy: The parotid gland lies in front of the ear and over the masseter, wrapped by the parotid fascia. The
  facial nerve passes through it and divides the gland into a superficial and a deep part; this is a surgical, not an
  anatomical, plane. Must be right: Identify the facial nerve trunk using at least two landmarks before dividing any
  parotid tissue anterior to it. Divide gland tissue only after the nerve has been seen deep to it: tunnel over the
  nerve, open the forceps, see the nerve, then cut.
- E. Anatomy: The larynx has three subsites: the supraglottis (epiglottis, aryepiglottic folds, false cords,
  ventricles), the glottis (true vocal folds and the anterior and posterior commissures), and the subglottis down to
  the lower border of the cricoid. Must be right: The airway plan is agreed before induction, including what happens
  if the lesion bleeds or swells after biopsy and the patient cannot be extubated. Protect the upper teeth; never
  lever on them to gain exposure.
Screens and machines (monitors, bypass machine, laparoscopic stack, diathermy) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and organ boxes
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 102 images)
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

A. ADENOIDECTOMY  (folder adenoidectomy/)
01_consent-check.png [step.core.consent-check]  Common. Ask the parents about bleeding in the family, nasal
   regurgitation of feeds and loose teeth.
02_preop-data-check.png [step.ent.preop-data-check]  Confirm the investigation that justifies the operation: Display
   the key investigation in theatre before the time-out, not just in the notes. Confirm side and indication against it
   aloud, for example: bilateral effusion with flat tympanograms, or left-sided disease on the CT. Obstructive
   symptoms or sleep study, or audiogram and tympanogram if grommets are planned. Confirm whether tonsillectomy is
   also consented. Teach: ENT operations are often elective and sided, and each rests on one investigation: the
   audiogram and tympanogram for grommets, the CT for sinus surgery, the documented infection count or sleep study for
   tonsillectomy. Check: avoid operating on the side written on the list rather than the side shown by the
   investigation.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. No routine antibiotic prophylaxis. Dexamethasone if combined with
   tonsillectomy, per the anaesthetic plan.
05_airway-share.png [step.ent.airway-share]  Shared airway plan with the anaesthetist: Agree the airway device and its
   fixation: reinforced or preformed tube, laryngeal mask, or the existing tracheostomy or endotracheal tube. Agree
   whether a throat pack is placed, who places it, and record it on the whiteboard so its removal is a counted event.
   Preformed oral tube. Agree that the anaesthetist will watch ventilation pressures as the gag opens. Teach: In ENT
   surgery the surgeon and the anaesthetist work in the same space. Check: avoid a throat pack placed by one person
   and not recorded anywhere, then left in at extubation.
06_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
07_dental-protection.png [step.ent.dental-protection]  Dentition check and protection: Check and record loose,
   crowned, capped and missing teeth, and any loose deciduous teeth in a child, before induction. Include this in the
   consent discussion. Place a tooth guard, or folded gauze, over the upper teeth before the instrument goes in. Look
   for loose deciduous teeth before the gag goes in; a loose tooth is removed deliberately and accounted for, not
   lost. Teach: Gags and laryngoscopes lever against the upper teeth, and dental injury is one of the commonest
   reasons ENT patients complain. Check: avoid levering on the incisors to improve the view in a difficult exposure.
08_gag-palate.png [step.adeno.gag-palate]  Insert the gag and palpate the palate: Open and suspend the gag, checking
   the tube, teeth and lips as it opens. Inspect the uvula for a bifid tip and the soft palate for a translucent
   midline zone. Teach: A submucous cleft is easy to miss by looking and easy to find by feeling. Check: avoid
   palpating after the adenoid has been removed, when the information is no longer useful.
09_view.png [step.adeno.view]  See the nasopharynx: Pass a soft catheter through one or both nostrils, out of the
   mouth, and clip it to retract the soft palate forwards. View the nasopharynx with a warmed laryngeal mirror and
   headlight, or an endoscope, and note the size of the adenoid, its relation to the choanae and the position of both
   tori. Teach: Adenoid tissue in the choanae and around the tori is what causes persisting obstruction and ear
   disease, and it cannot be judged by feel. Check: avoid tensioning the palatal catheter so hard that it blanches or
   tears the palate.
10_removal.png [step.adeno.removal]  Remove the adenoid under vision, superficially: With suction diathermy or
   coblation, start at the choanae and work backwards and downwards across the pad under mirror or endoscopic vision,
   ablating the tissue rather than burning the posterior wall. With a curette, choose a size that fits between the
   tori, place it against the posterior border of the septum, and sweep down the posterior wall in one firm movement,
   keeping the handle against the upper teeth only as a guide, not a lever. Teach: The aim is a clear airway and
   choanae with the tori, the prevertebral tissue and the velopharyngeal fringe intact. Check: avoid diathermy held on
   the posterior wall until it chars, which damages the prevertebral tissue and adds to neck pain.
11_pack.png [step.adeno.pack]  Postnasal pack and wait: Place a counted postnasal pack, with a tie or string left
   outside the mouth, into the nasopharynx after curettage. Record its placement. Leave it for a few minutes, or do
   the tonsils or ears meanwhile if planned. Teach: After curettage most bleeding is from raw lymphoid tissue and
   stops with pressure. Check: avoid a pack without a tie, which can be pushed up into the nasopharynx and forgotten.
12_haemostasis.png [step.core.haemostasis]  Common. Remove the pack, release the gag for a minute, re-open and look at
   the nasopharynx again with the mirror or endoscope.
13_bleed-bailout.png [step.adeno.bleed-bailout]  Bail-out: bleeding that will not stop: Look for residual tissue,
   especially in the choanae and lateral recesses, and remove or treat it. Use suction diathermy on discrete bleeding
   points under vision, avoiding the tori. Teach: Persistent nasopharyngeal bleeding in a small child becomes a volume
   problem quickly, and the blood loss is hidden because it is swallowed. Check: avoid repeated curettage of a
   bleeding nasopharynx, which makes it worse.
14_pharynx-clearance.png [step.ent.pharynx-clearance]  Clear the pharynx: throat pack out, clot out, postnasal space
   checked: Remove the throat pack and state its removal aloud so the anaesthetist and scrub practitioner record it.
   Suction the oropharynx and, with a mirror or endoscope, the postnasal space. Remove any clot there before it is
   aspirated at extubation. Teach: A retained throat pack or a clot in the nasopharynx sitting above the larynx can
   obstruct the airway completely after extubation. Check: avoid checking only the oropharynx and missing a clot in
   the nasopharynx behind the soft palate.
15_counts.png [step.core.counts]  Common. Postnasal pack and every tonsil swab counted out before the gag is removed.
16_specimen.png [step.core.specimen]  Common. Adenoid tissue is not always sent. Send it if the appearance is unusual,
   the patient is an adult, or local policy requires it.
17_airway-handover.png [step.ent.airway-handover]  Airway handover to recovery and the ward: State the airway: tube or
   tracheostomy type and size, whether the cuff is up, whether the upper airway is patent, and whether the patient can
   be oxygenated from above. State the bleeding risk and what bleeding would look like: frequent swallowing, fresh
   blood from mouth or nose, rising heart rate in a child. Lateral position. Fresh blood from the nose or mouth, or
   repeated swallowing, means bleeding until examined. Teach: Most ENT airway catastrophes happen after the operation,
   in recovery or on the ward, in the hands of people who were not in theatre. Check: avoid a handover that covers the
   operation but not what to do if the airway fails.
18_debrief.png [step.core.debrief]  Common.

B. CORTICAL AND MODIFIED RADICAL MASTOIDECTOMY  (folder mastoidectomy/)
01_consent-check.png [step.core.consent-check]  Common. Confirm consent covers the possible conversion from canal wall
   up to canal wall down, and ossicular reconstruction or a staged procedure.
02_preop-data-check.png [step.ent.preop-data-check]  Confirm the investigation that justifies the operation: Display
   the key investigation in theatre before the time-out, not just in the notes. Confirm side and indication against it
   aloud, for example: bilateral effusion with flat tympanograms, or left-sided disease on the CT. Temporal bone CT on
   screen and the audiogram. Read aloud the side, the tegmen height, the sigmoid position and any fistula or facial
   canal dehiscence. Teach: ENT operations are often elective and sided, and each rests on one investigation: the
   audiogram and tympanogram for grommets, the CT for sinus surgery, the documented infection count or sleep study for
   tonsillectomy. Check: avoid operating on the side written on the list rather than the side shown by the
   investigation.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic per local policy and any culture results; in acute
   mastoiditis the patient is already on treatment and pus is sent from the cavity.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
06_facial-nerve-monitor.png [step.ent.facial-nerve-monitor]  Facial nerve monitoring: set up, test and agree no
   paralysis: Agree with the anaesthetist before induction that no further neuromuscular blocking drug is given after
   intubation, and confirm that any block has worn off before dissection near the nerve. Place recording electrodes in
   the facial muscles the system requires, usually orbicularis oculi and orbicularis oris on the operative side, with
   the ground and return electrodes as the manufacturer specifies. The head is turned away and draped for hours: agree
   tube fixation and the no-relaxant plan at the same conversation. Teach: Facial nerve monitoring helps the surgeon
   find and follow the nerve, but only if it works. Check: avoid a repeat dose of relaxant given during the case
   without the surgeon being told.
07_prep-drape.png [step.core.prep-drape]  Common. Shave a narrow strip behind the ear if needed; keep the pinna and
   face exposed under a clear drape.
08_microscope-setup.png [step.ent.microscope-setup]  Operating microscope set-up and surgeon ergonomics: Choose the
   objective lens focal length for the operation: a shorter working distance for the ear, a longer one that reaches
   down the laryngoscope for the larynx. Confirm it before draping. Balance the microscope, set the interpupillary
   distance and eyepiece dioptres, and drape it sterile if it will be handled in the field. Otological objective;
   position for both the mastoid and the canal views. Teach: Ear and laryngeal surgery is done at high magnification
   with millimetre margins. Check: avoid starting with the wrong objective lens and discovering it after draping.
09_bloodless-field.png [step.ent.bloodless-field]  Bloodless field: head-up tilt, vasoconstrictor infiltration and the
   wait: Ask for a head-up tilt and agree with the anaesthetist on a calm, normotensive or modestly lowered blood
   pressure and heart rate, using their preferred technique. Infiltrate local anaesthetic with adrenaline in the
   correct plane: under the mucoperichondrium for the septum, into the canal skin at four quadrants and the postaural
   sulcus for the ear. Aspirate before each injection. Postaural and canal infiltration. Infiltration near the
   stylomastoid foramen can cause a temporary facial weakness; note it for the recovery check. Teach: Nasal and ear
   surgery is done through a small opening under magnification, where a few drops of blood hide the plane, the nerve
   or the flap edge. Check: avoid incising immediately after injection, which gives a wet field and wastes the
   vasoconstrictor.
10_postaural-exposure.png [step.ent.postaural-exposure]  Postaural incision, temporalis fascia graft and mastoid
   cortex exposure: Incise a few millimetres behind the postauricular sulcus, curving from above the pinna to the
   mastoid tip. In a young child the mastoid tip is undeveloped and the facial nerve exits superficially, so keep the
   lower end of the incision high and shallow. Raise the skin flap in the plane just superficial to the temporalis
   fascia above, and harvest a generous piece of fascia with a clean, thin layer of areolar tissue removed. Press and
   dry it for use as a graft. In acute mastoiditis, a subperiosteal abscess is opened and pus sent before the cortex
   is drilled. Teach: The postaural approach gives a wide view of the mastoid cortex and the posterior canal, and the
   same incision yields temporalis fascia, the commonest graft for the drum. Check: avoid carrying the lower end of
   the incision deep over an infant's mastoid and dividing the facial nerve where it exits.
11_otologic-drill.png [step.ent.otologic-drill]  Safe drilling of the temporal bone: Use the largest burr that fits
   the space. Cutting burrs remove bone quickly on the cortex and in pneumatised air cells; switch to diamond burrs
   near the facial nerve, dura, sigmoid sinus, semicircular canals and ossicles. Drill with continuous suction-
   irrigation to cool the bone and keep the field visible. Heat from a dry diamond burr can injure the facial nerve
   through intact bone. Teach: The drill removes bone a fraction of a millimetre from the facial nerve, the dura, the
   sigmoid sinus and the inner ear. Check: avoid drilling a deep, narrow hole, so the floor of the cavity cannot be
   seen in relation to the landmarks.
12_cortical.png [step.mastoid.cortical]  Cortical mastoidectomy: tegmen, sigmoid, antrum, lateral canal: With a large
   cutting burr, drill a triangle bounded by the temporal line above, a line just behind the posterior canal wall in
   front, and the mastoid tip below, saucerising as you go deeper. Identify the tegmen by its colour and the change in
   bone texture, and follow it backwards. Identify the sigmoid sinus plate posteriorly. Thin both, do not expose them.
   Teach: Every mastoid operation starts here, and the order matters. Check: avoid starting too far anteriorly and
   drilling into the canal or towards the facial nerve.
13_canal-wall-down.png [step.mastoid.canal-wall-down]  Take the posterior canal wall down to the facial ridge: Open
   the attic by removing the bone of the scutum and lateral attic wall, protecting the ossicles, and follow disease
   forwards. Remove the posterior bony canal wall progressively, with a large burr laterally and a diamond burr
   medially, keeping the canal skin elevated and protected. Teach: A canal wall down operation turns the mastoid,
   attic and canal into one cavity that can be inspected for life. Check: avoid a high facial ridge left because of
   fear of the nerve, giving a discharging cavity. Lower it under control instead.
14_disease-clearance.png [step.mastoid.disease-clearance]  Clear cholesteatoma and assess the ossicles: Lift the
   matrix in one sheet where possible, working from known anatomy towards the disease, with gentle suction and a moist
   cottonoid. Assess the ossicles: check the incus, the incudostapedial joint, the stapes superstructure and mobility.
   Separate the incudostapedial joint before working on the incus or malleus near an intact stapes. Teach: Residual
   matrix becomes recurrent disease, but matrix stripped off the stapes footplate or a fistula can cost the patient
   their hearing and balance. Check: avoid pulling matrix off the stapes and opening the vestibule.
15_complication-bailout.png [step.mastoid.complication-bailout]  Bail-out: sinus bleeding, dural exposure, facial
   nerve injury or fistula: Sigmoid sinus bleeding: press with a cottonoid and oxidised cellulose or gelatin sponge,
   tilt the head up only modestly, and tell the anaesthetist because of the risk of air embolism. Do not diathermy the
   sinus or pack it so tightly that it thromboses into the jugular system. Dural exposure or cerebrospinal fluid leak:
   stop drilling there. Repair a leak with fascia or a multilayer graft; a dural tear with brain herniation needs
   senior or neurosurgical help. Teach: Each of these is survivable when recognised and handled calmly at the time,
   and dangerous when it is hidden or chased with the drill. Check: avoid packing sigmoid sinus bleeding with so much
   material that it propagates thrombosis.
16_graft-meatoplasty.png [step.mastoid.graft-meatoplasty]  Graft the middle ear and make an adequate meatoplasty:
   Place gelatin sponge in the middle ear for support, then lay temporalis fascia over the stapes head or footplate
   and on to the facial ridge, or over an ossicular reconstruction if one is used. Replace the canal skin over the
   facial ridge and cavity edges where possible. Teach: In a canal wall down operation, a graft rebuilds a closed,
   aerated middle ear for hearing, and the meatoplasty decides whether the cavity can be seen and cleaned for the rest
   of the patient's life. Check: avoid a meatoplasty that looks generous in theatre but is too small after healing.
17_haemostasis.png [step.core.haemostasis]  Common. Bone wax for bleeding bone and emissary veins; never diathermy on
   the sigmoid sinus.
18_counts.png [step.core.counts]  Common.
19_specimen.png [step.core.specimen]  Common. Cholesteatoma matrix and any granulations to histology; pus to
   microbiology in acute disease.
20_skin-closure.png [step.core.skin-closure]  Common. Layered closure of the musculoperiosteal flap and skin, ear pack
   in the canal, and a mastoid head bandage.
21_facial-function-check.png [step.ent.facial-function-check]  Document facial nerve function before the patient
   leaves recovery: Once the patient is awake enough to cooperate, ask them to close the eyes tightly, raise the
   eyebrows, smile and puff out the cheeks. Compare both sides. Record the result with a recognised scale such as
   House-Brackmann, with the time and the examiner's name. Teach: A facial weakness found the next morning cannot be
   dated: it may be an immediate injury that needs urgent re-exploration, or delayed oedema that usually recovers.
   Check: avoid not examining the face until the ward round, so the onset can no longer be established.
22_debrief.png [step.core.debrief]  Common. Record which landmarks were identified, the state of the ossicles and any
   fistula or dehiscence, and the plan for second look or surveillance.

C. TYMPANOPLASTY TYPE 1 (UNDERLAY)  (folder tympanoplasty-underlay/)
01_consent-check.png [step.core.consent-check]  Common. Consent covers ossicular reconstruction or staging if the
   chain is found to be abnormal, and conversion if cholesteatoma is found.
02_preop-data-check.png [step.ent.preop-data-check]  Confirm the investigation that justifies the operation: Display
   the key investigation in theatre before the time-out, not just in the notes. Confirm side and indication against it
   aloud, for example: bilateral effusion with flat tympanograms, or left-sided disease on the CT. Audiogram on
   display: side, the size of the air-bone gap, and the bone conduction in the operated ear. Teach: ENT operations are
   often elective and sided, and each rests on one investigation: the audiogram and tympanogram for grommets, the CT
   for sinus surgery, the documented infection count or sleep study for tonsillectomy. Check: avoid operating on the
   side written on the list rather than the side shown by the investigation.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis per local policy; it is not routinely
   required for a clean, dry ear.
05_airway-share.png [step.ent.airway-share]  Shared airway plan with the anaesthetist: Agree the airway device and its
   fixation: reinforced or preformed tube, laryngeal mask, or the existing tracheostomy or endotracheal tube. Agree
   whether a throat pack is placed, who places it, and record it on the whiteboard so its removal is a counted event.
   Laryngeal mask or tube by agreement; a smooth emergence without coughing protects the graft. Teach: In ENT surgery
   the surgeon and the anaesthetist work in the same space. Check: avoid a throat pack placed by one person and not
   recorded anywhere, then left in at extubation.
06_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
07_prep-drape.png [step.core.prep-drape]  Common.
08_microscope-setup.png [step.ent.microscope-setup]  Operating microscope set-up and surgeon ergonomics: Choose the
   objective lens focal length for the operation: a shorter working distance for the ear, a longer one that reaches
   down the laryngoscope for the larynx. Confirm it before draping. Balance the microscope, set the interpupillary
   distance and eyepiece dioptres, and drape it sterile if it will be handled in the field. Teach: Ear and laryngeal
   surgery is done at high magnification with millimetre margins. Check: avoid starting with the wrong objective lens
   and discovering it after draping.
09_bloodless-field.png [step.ent.bloodless-field]  Bloodless field: head-up tilt, vasoconstrictor infiltration and the
   wait: Ask for a head-up tilt and agree with the anaesthetist on a calm, normotensive or modestly lowered blood
   pressure and heart rate, using their preferred technique. Infiltrate local anaesthetic with adrenaline in the
   correct plane: under the mucoperichondrium for the septum, into the canal skin at four quadrants and the postaural
   sulcus for the ear. Aspirate before each injection. Infiltrate the canal skin slowly at four quadrants, watching it
   blanch without blebbing, and the postaural sulcus if that approach is used. Teach: Nasal and ear surgery is done
   through a small opening under magnification, where a few drops of blood hide the plane, the nerve or the flap edge.
   Check: avoid incising immediately after injection, which gives a wet field and wastes the vasoconstrictor.
10_postaural-exposure.png [step.ent.postaural-exposure]  Postaural incision, temporalis fascia graft and mastoid
   cortex exposure: Incise a few millimetres behind the postauricular sulcus, curving from above the pinna to the
   mastoid tip. In a young child the mastoid tip is undeveloped and the facial nerve exits superficially, so keep the
   lower end of the incision high and shallow. Raise the skin flap in the plane just superficial to the temporalis
   fascia above, and harvest a generous piece of fascia with a clean, thin layer of areolar tissue removed. Press and
   dry it for use as a graft. For a permeatal or endoscopic approach, harvest fascia or tragal perichondrium through a
   small separate incision instead. Teach: The postaural approach gives a wide view of the mastoid cortex and the
   posterior canal, and the same incision yields temporalis fascia, the commonest graft for the drum. Check: avoid
   carrying the lower end of the incision deep over an infant's mastoid and dividing the facial nerve where it exits.
11_freshen.png [step.tymp.freshen]  Freshen the perforation edge: With a Rosen needle or sickle knife, incise just
   outside the epithelial rim all the way round the perforation. Remove the rim with cupped forceps as a ring, so you
   can see that it is complete. Teach: A perforation persists because its edge has healed as a rim of squamous
   epithelium. Check: avoid incomplete freshening anteriorly, where the edge is hard to see.
12_flap.png [step.tymp.flap]  Raise the tympanomeatal flap and enter the middle ear: Make two radial canal incisions,
   roughly at 12 and 6 o'clock positions, joined by a curved incision several millimetres lateral to the annulus.
   Elevate the canal skin medially in one sheet with a round knife, keeping the elevator on bone and the bleeding
   controlled with adrenaline cottonoids. Teach: The flap gives access to the middle ear without enlarging the
   perforation, and carries the annulus that will hold the graft. Check: avoid tearing the flap by elevating in more
   than one direction at a time.
13_otologic-drill.png [step.ent.otologic-drill]  Safe drilling of the temporal bone: Use the largest burr that fits
   the space. Cutting burrs remove bone quickly on the cortex and in pneumatised air cells; switch to diamond burrs
   near the facial nerve, dura, sigmoid sinus, semicircular canals and ossicles. Drill with continuous suction-
   irrigation to cool the bone and keep the field visible. Heat from a dry diamond burr can injure the facial nerve
   through intact bone. Only if needed: a canalplasty of the anterior canal wall bulge, with the canal skin protected
   and the burr kept off the drum remnant and malleus. Teach: The drill removes bone a fraction of a millimetre from
   the facial nerve, the dura, the sigmoid sinus and the inner ear. Check: avoid drilling a deep, narrow hole, so the
   floor of the cavity cannot be seen in relation to the landmarks.
14_middle-ear.png [step.tymp.middle-ear]  Inspect the middle ear and test the ossicular chain: Inspect the mucosa, the
   round window niche, the oval window, the incudostapedial joint and the visible part of the facial canal. Palpate
   the malleus handle gently and watch the incus and stapes move; look for the round window reflex as a sign of a
   mobile chain. Teach: A type 1 tympanoplasty only restores hearing if the chain conducts. Check: avoid moving the
   malleus vigorously enough to transmit trauma to the stapes.
15_cholesteatoma-bailout.png [step.tymp.cholesteatoma-bailout]  Bail-out: cholesteatoma or an abnormal chain: If
   cholesteatoma is found, remove it only if it is limited, fully visible and consented for; otherwise stop, close,
   and plan a properly consented and imaged mastoid operation. If the incus is eroded or the stapes fixed, perform an
   ossiculoplasty only if consented and equipped; otherwise graft the drum now and stage the ossicular reconstruction.
   Teach: A tympanoplasty that covers cholesteatoma hides it under a healthy-looking drum until it has eroded further.
   Check: avoid extending a day-case myringoplasty into a mastoid operation without consent or imaging.
16_graft.png [step.tymp.graft]  Place the underlay graft: Fill the middle ear, particularly anteriorly towards the
   Eustachian tube, with gelatin sponge to support the graft. Trim the dried fascia so it overlaps the perforation
   edge generously on all sides. Teach: An underlay graft sits medial to the drum remnant, supported from below, so
   the remnant's raw edge grows across it. Check: avoid too little anterior support, so the graft drops away from the
   anterior edge.
17_flap-replace.png [step.tymp.flap-replace]  Replace the flap and pack the canal: Lay the tympanomeatal flap back
   over the posterior edge of the graft, with the annulus in the sulcus and the canal skin flat on bone. Place gelatin
   sponge in the canal against the drum and flap to hold them. Teach: The tympanomeatal flap holds the posterior graft
   edge in place and covers bare bone. Check: avoid a rolled flap edge left over the graft, causing blunting or a
   pearl.
18_haemostasis.png [step.core.haemostasis]  Common. Bipolar to the postaural wound only. In the canal, control is with
   adrenaline cottonoids and patience.
19_skin-closure.png [step.core.skin-closure]  Common. Layered closure of the postaural wound and a mastoid head
   bandage.
20_counts.png [step.core.counts]  Common. Count cottonoids, including the tiny pledgets used in the canal.
21_facial-function-check.png [step.ent.facial-function-check]  Document facial nerve function before the patient
   leaves recovery: Once the patient is awake enough to cooperate, ask them to close the eyes tightly, raise the
   eyebrows, smile and puff out the cheeks. Compare both sides. Record the result with a recognised scale such as
   House-Brackmann, with the time and the examiner's name. Teach: A facial weakness found the next morning cannot be
   dated: it may be an immediate injury that needs urgent re-exploration, or delayed oedema that usually recovers.
   Check: avoid not examining the face until the ward round, so the onset can no longer be established.
22_debrief.png [step.core.debrief]  Common. Record perforation size and site, the state of the ossicles, the graft and
   its position, and whether the chorda was preserved.

D. SUPERFICIAL PAROTIDECTOMY WITH FACIAL NERVE IDENTIFICATION  (folder superficial-parotidectomy/)
01_consent-check.png [step.core.consent-check]  Common. Facial weakness, Frey syndrome and ear lobe numbness
   discussed; mark the side; document whether nerve sacrifice has been discussed if malignancy is possible.
02_mdt-check.png [step.onco.mdt-check]  MDT decision, staging and diagnosis confirmed: Confirm the documented MDT
   outcome names this operation, on this side or segment, with this extent of nodal surgery. Confirm the tissue
   diagnosis (histology or cytology) and that staging is complete for this tumour type, with imaging available in
   theatre. Cytology or core biopsy and imaging on display. For a presumed benign tumour, confirm the imaging shows a
   superficial lobe lesion. Teach: A cancer operation is one part of a treatment plan agreed by a multidisciplinary
   team. Check: avoid accepting an MDT note that predates new imaging or a changed biopsy result.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic per local policy for a clean head and neck operation;
   VTE prophylaxis by risk assessment.
05_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
06_facial-nerve-monitor.png [step.ent.facial-nerve-monitor]  Facial nerve monitoring: set up, test and agree no
   paralysis: Agree with the anaesthetist before induction that no further neuromuscular blocking drug is given after
   intubation, and confirm that any block has worn off before dissection near the nerve. Place recording electrodes in
   the facial muscles the system requires, usually orbicularis oculi and orbicularis oris on the operative side, with
   the ground and return electrodes as the manufacturer specifies. Teach: Facial nerve monitoring helps the surgeon
   find and follow the nerve, but only if it works. Check: avoid a repeat dose of relaxant given during the case
   without the surgeon being told.
07_prep-drape.png [step.core.prep-drape]  Common. Ear, face to the lateral canthus and the corner of the mouth, and
   the upper neck in the field.
08_incision-flap.png [step.parotid.incision-flap]  Modified Blair incision and skin flap: Incise in the preauricular
   crease, curve around the ear lobe towards the mastoid, then down into a skin crease in the upper neck, about two
   finger breadths below the angle of the mandible to stay clear of the marginal mandibular branch. Raise the anterior
   skin flap in the plane just superficial to the parotid fascia, forwards to the anterior border of the gland, with
   skin hooks and traction-countertraction. Teach: The incision must give access to the trunk behind and the branches
   in front while staying in natural creases. Check: avoid dissecting below the parotid fascia at the anterior border
   and dividing a branch as it emerges.
09_mobilise.png [step.parotid.mobilise]  Mobilise the gland posteriorly: great auricular nerve, sternocleidomastoid,
   cartilage, digastric: Identify the great auricular nerve on the sternocleidomastoid. Preserve its posterior branch
   if the tumour allows; divide the anterior branch if it enters the gland. Separate the parotid tail from the
   anterior border of the sternocleidomastoid, ligating the external jugular vein or its branches if necessary. Teach:
   The facial nerve trunk can only be found once the tail and back of the gland are freed from the sternocleidomastoid
   and the ear canal cartilage, and the posterior belly of digastric is seen. Check: avoid starting the deep search
   for the nerve before the digastric has been seen.
10_trunk.png [step.parotid.trunk]  Identify the facial nerve trunk: Dissect bluntly in the plane between the cartilage
   and the posterior belly of digastric, spreading parallel to the expected course of the nerve and controlling small
   vessels with bipolar. Use at least two landmarks: the trunk lies deep and slightly anteroinferior to the tragal
   pointer, deep to the medial end of the tympanomastoid suture, and at the depth of the upper border of the
   digastric. Teach: Everything that follows is dissected from the trunk forwards. Check: avoid mistaking a fibrous
   band or a vessel for the nerve; confirm by course, appearance and stimulation together.
11_nerve-dissection.png [step.parotid.nerve-dissection]  Dissect along the nerve and lift off the superficial lobe:
   Follow the trunk to the pes anserinus. Pass fine artery forceps along the superficial surface of the nerve, open
   them to lift the gland, look to confirm the nerve is deep, then divide the tissue between the blades. Follow the
   division nearest the tumour last, so you work towards the tumour with the nerve already displayed. Teach: The
   superficial lobe is removed by following the nerve and its branches, dividing only the gland that lies superficial
   to them. Check: avoid dividing tissue before the nerve has been seen deep to it.
12_tumour-handling.png [step.onco.tumour-handling]  Oncological handling: no touch, wound protection, clean field:
   Handle the tumour-bearing tissue as little as possible; retract the specimen by its normal edges, not by the
   tumour. Control the vascular pedicle early where the operation allows it, before the tumour is mobilised. Retract
   by normal gland, never the tumour. Any capsular breach or spillage is irrigated, recorded, and reported to the MDT.
   Teach: Tumour cells shed into the wound, the peritoneum or a port site produce a recurrence that no adjuvant
   therapy fully reverses. Check: avoid grasping the tumour with a toothed instrument to improve exposure.
13_trunk-bailout.png [step.parotid.trunk-bailout]  Bail-out: the trunk cannot be found, or the nerve is involved: If
   the trunk cannot be found safely, call a senior and use a retrograde approach: find a peripheral branch, such as
   the marginal mandibular branch where it crosses the facial vessels or the buccal branch alongside the parotid duct,
   and follow it back. Consider finding the nerve in the mastoid segment by drilling, if that expertise is available.
   Teach: Some tumours sit over the trunk, and revision surgery distorts the landmarks. Check: avoid spreading deeper
   and deeper behind a large tumour without a landmark.
14_final-stimulation.png [step.parotid.final-stimulation]  Stimulate the nerve before closing: Stimulate the trunk at
   a low current and watch each branch territory, or the monitor channels, respond. Stimulate any branch that did not
   respond, distal to the area of dissection, to localise the problem. Teach: A nerve that responds to stimulation at
   the trunk at the end of the operation is very likely to recover even if the face is weak afterwards. Check: avoid
   not recording the stimulation result, so a weak face the next day cannot be interpreted.
15_specimen-orientation.png [step.onco.specimen-orientation]  Orienting the cancer specimen for the pathologist: Mark
   orientation with sutures or clips using the convention agreed with your pathology department, and write that
   convention on the request form. Keep the specimen intact: do not open, slice or palpate-bisect it in theatre unless
   the pathologist asks. Teach: Margin status and nodal yield are reported by the pathologist, but only from a
   specimen they can orient. Check: avoid a single suture with no stated convention.
16_haemostasis.png [step.core.haemostasis]  Common. Bipolar on low power, away from nerve branches. Ask for a Valsalva
   manoeuvre to reveal venous bleeding.
17_counts.png [step.core.counts]  Common.
18_specimen.png [step.core.specimen]  Common. Send the whole specimen; request frozen section only if the result will
   change what is done today.
19_skin-closure.png [step.core.skin-closure]  Common. Suction drain brought out away from the incision, layered
   closure. A sternocleidomastoid or SMAS flap may be used to fill the defect.
20_facial-function-check.png [step.ent.facial-function-check]  Document facial nerve function before the patient
   leaves recovery: Once the patient is awake enough to cooperate, ask them to close the eyes tightly, raise the
   eyebrows, smile and puff out the cheeks. Compare both sides. Record the result with a recognised scale such as
   House-Brackmann, with the time and the examiner's name. Teach: A facial weakness found the next morning cannot be
   dated: it may be an immediate injury that needs urgent re-exploration, or delayed oedema that usually recovers.
   Check: avoid not examining the face until the ward round, so the onset can no longer be established.
21_debrief.png [step.core.debrief]  Common. Record how the trunk was identified, which branches were dissected,
   whether the capsule was intact, and the great auricular nerve status.

E. DIRECT LARYNGOSCOPY AND MICROLARYNGOSCOPY WITH BIOPSY  (folder microlaryngoscopy-biopsy/)
01_consent-check.png [step.core.consent-check]  Common. Teeth, voice change and the airway risks discussed. For
   suspected cancer, the patient knows this is a diagnostic operation and when results are expected.
02_preop-data-check.png [step.ent.preop-data-check]  Confirm the investigation that justifies the operation: Display
   the key investigation in theatre before the time-out, not just in the notes. Confirm side and indication against it
   aloud, for example: bilateral effusion with flat tympanograms, or left-sided disease on the CT. Flexible
   nasendoscopy images and the imaging on screen. Agree the subsites to examine and biopsy. Teach: ENT operations are
   often elective and sided, and each rests on one investigation: the audiogram and tympanogram for grommets, the CT
   for sinus surgery, the documented infection count or sleep study for tonsillectomy. Check: avoid operating on the
   side written on the list rather than the side shown by the investigation.
03_timeout.png [step.core.timeout]  Common.
04_prophylaxis.png [step.core.prophylaxis]  Common. No routine antibiotics. VTE assessment. The anaesthetist may give
   dexamethasone to reduce airway oedema.
05_airway-share.png [step.ent.airway-share]  Shared airway plan with the anaesthetist: Agree the airway device and its
   fixation: reinforced or preformed tube, laryngeal mask, or the existing tracheostomy or endotracheal tube. Agree
   whether a throat pack is placed, who places it, and record it on the whiteboard so its removal is a counted event.
   Microlaryngoscopy tube, jet ventilation or tubeless technique agreed; laser fire precautions if a laser is used.
   For an obstructing lesion, the surgeon is scrubbed at induction with the tracheostomy set open. Teach: In ENT
   surgery the surgeon and the anaesthetist work in the same space. Check: avoid a throat pack placed by one person
   and not recorded anywhere, then left in at extubation.
06_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
07_dental-protection.png [step.ent.dental-protection]  Dentition check and protection: Check and record loose,
   crowned, capped and missing teeth, and any loose deciduous teeth in a child, before induction. Include this in the
   consent discussion. Place a tooth guard, or folded gauze, over the upper teeth before the instrument goes in.
   Teach: Gags and laryngoscopes lever against the upper teeth, and dental injury is one of the commonest reasons ENT
   patients complain. Check: avoid levering on the incisors to improve the view in a difficult exposure.
08_insert.png [step.mll.insert]  Introduce the laryngoscope without using the teeth: Open the mouth with the fingers
   of the left hand, protecting the upper teeth and lips with the tooth guard. Insert the laryngoscope along the right
   side of the tongue, moving the tongue to the left, and advance in the midline to see the epiglottis. Teach:
   Exposure of the larynx is achieved by lifting the tongue and hyoid forward along the laryngoscope's axis. Check:
   avoid pivoting on the upper incisors to gain an anterior view.
09_survey.png [step.mll.survey]  Systematic examination and lesion mapping before biopsy: Examine in a fixed order:
   oral cavity, tongue base and vallecula, epiglottis, aryepiglottic folds, false cords, ventricles, true cords,
   anterior and posterior commissures, subglottis, then piriform fossae, posterior pharyngeal wall and postcricoid
   region. Use 0, 30 and 70 degree endoscopes to see the ventricles, the undersurface of the cords and the subglottis.
   Teach: The MDT stages the tumour from this examination. Check: avoid biopsying the first abnormality seen and
   stopping the examination.
10_suspend.png [step.mll.suspend]  Suspend the laryngoscope: Attach the suspension arm to the laryngoscope and rest it
   on a chest support or a Mayo table, not the chest wall. Adjust to bring the lesion into the centre of the view,
   using the minimum force needed. Teach: Suspension frees both hands for microsurgery and gives a stable view under
   the microscope. Check: avoid excessive suspension force for a long time, causing tongue numbness and taste change.
11_microscope-setup.png [step.ent.microscope-setup]  Operating microscope set-up and surgeon ergonomics: Choose the
   objective lens focal length for the operation: a shorter working distance for the ear, a longer one that reaches
   down the laryngoscope for the larynx. Confirm it before draping. Balance the microscope, set the interpupillary
   distance and eyepiece dioptres, and drape it sterile if it will be handled in the field. Long focal length
   objective so the microscope works down the laryngoscope; leave room for instruments. Teach: Ear and laryngeal
   surgery is done at high magnification with millimetre margins. Check: avoid starting with the wrong objective lens
   and discovering it after draping.
12_biopsy.png [step.mll.biopsy]  Biopsy: deep enough for diagnosis, conservative on the vocal fold: For a suspected
   cancer, take biopsies from the edge of the lesion where tumour meets normal mucosa, avoiding necrotic centres, and
   take enough tissue for diagnosis. Send separately any biopsy from a different subsite. For a benign vocal fold
   lesion or leukoplakia, grasp the lesion with fine forceps, retract it medially and excise it with microscissors at
   its base, or raise a microflap, preserving the superficial lamina propria and the vocal ligament. Teach: A
   suspected cancer needs tissue deep enough to show invasion, from the living edge of the tumour. Check: avoid a
   superficial biopsy of a cancer that shows only dysplasia, leading to a repeat anaesthetic.
13_airway-bailout.png [step.mll.airway-bailout]  Bail-out: failed exposure, bleeding or a threatened airway: Failed
   exposure: try a different laryngoscope, external counter-pressure and head repositioning. If still inadequate, stop
   and plan a flexible endoscopic biopsy or a different approach rather than forcing. Bleeding: pressure with an
   adrenaline patty and suction diathermy, under vision, while the anaesthetist protects the airway. Do not extubate
   until it has stopped. Teach: The larynx is the airway. Check: avoid extubating a patient whose bulky lesion has
   just been biopsied without a plan for reintubation.
14_haemostasis.png [step.core.haemostasis]  Common. Adrenaline-soaked patties on strings, pressure, and suction
   diathermy for discrete points. Reinspect after the patties come out.
15_pharynx-clearance.png [step.ent.pharynx-clearance]  Clear the pharynx: throat pack out, clot out, postnasal space
   checked: Remove the throat pack and state its removal aloud so the anaesthetist and scrub practitioner record it.
   Suction the oropharynx and, with a mirror or endoscope, the postnasal space. Remove any clot there before it is
   aspirated at extubation. Every patty and the tooth guard accounted for; the larynx and hypopharynx free of clot
   before extubation. Teach: A retained throat pack or a clot in the nasopharynx sitting above the larynx can obstruct
   the airway completely after extubation. Check: avoid checking only the oropharynx and missing a clot in the
   nasopharynx behind the soft palate.
16_counts.png [step.core.counts]  Common. Patties counted out by number and checked against the strings.
17_specimen.png [step.core.specimen]  Common. Each biopsy site in a separate, labelled pot with the subsite named;
   state the clinical question on the form.
18_airway-handover.png [step.ent.airway-handover]  Airway handover to recovery and the ward: State the airway: tube or
   tracheostomy type and size, whether the cuff is up, whether the upper airway is patent, and whether the patient can
   be oxygenated from above. State the bleeding risk and what bleeding would look like: frequent swallowing, fresh
   blood from mouth or nose, rising heart rate in a child. State the lesion, the bleeding and swelling risk, and the
   plan if stridor develops. Teach: Most ENT airway catastrophes happen after the operation, in recovery or on the
   ward, in the hands of people who were not in theatre. Check: avoid a handover that covers the operation but not
   what to do if the airway fails.
19_debrief.png [step.core.debrief]  Common. Draw or describe the lesion map by subsite, attach the photographs, and
   record exposure difficulty and the laryngoscope that worked.

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
  surgx-adenoidectomy-steps.zip   (folder adenoidectomy/)
  surgx-mastoidectomy-steps.zip   (folder mastoidectomy/)
  surgx-tympanoplasty-underlay-steps.zip   (folder tympanoplasty-underlay/)
  surgx-superficial-parotidectomy-steps.zip   (folder superficial-parotidectomy/)
  surgx-microlaryngoscopy-biopsy-steps.zip   (folder microlaryngoscopy-biopsy/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
