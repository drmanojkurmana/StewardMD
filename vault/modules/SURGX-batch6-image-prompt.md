---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 6 (eye: cataract, glaucoma, refractive, pterygium): Gemini image prompt (105 images, 6 operations)

Built 2026-11-21 from the real steps in `surgx/procedures/<id>.json`. Scene lines are generated from each step's own `how`, `why` and `pitfalls` (so they match the app text), with hand-written orientation, positioning and precise facts. Same block format as batches 4 and 5. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant ophthalmic surgeons (cataract, glaucoma and cornea/refractive). You are making 105 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Phacoemulsification with foldable lens implant (RIGHT eye)     20 images
  B. Manual small-incision cataract surgery, SICS (RIGHT eye)       20 images
  C. Trabeculectomy with mitomycin C (RIGHT eye)                    19 images
  D. Photorefractive keratectomy, PRK (RIGHT eye)                   14 images
  E. LASIK (RIGHT eye)                                              15 images
  F. Pterygium excision with conjunctival autograft (RIGHT eye, nasal) 17 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from ophthalmic surgery textbooks, operative atlases, the guidance below and
   operative videos (NICE NG77 cataract and NG81 glaucoma, Royal College of Ophthalmologists, ESCRS endophthalmitis guidance, AAO Preferred Practice Patterns, the Gogate and Ruit SICS trials, the Moorfields Safer Surgery System, Cochrane on pterygium autograft).
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
- Viewpoint: the surgeon's view down the operating microscope for intraocular and ocular surface steps (the eye filling the frame, a soft round vignette, instruments entering from the edges); a clean cross-section inset of the eye when the trainee must see inside (capsule, angle, vitreous cavity, cornea layers); a whole-body view for positioning; a theatre or clinic view for team and safety steps.
- The key structure is where the eye lands first: sharp and well lit, the background slightly softened. A subtle glow
  or outline on the key structure is fine. A small circular close-up or cross-section inset is allowed when the key
  detail is tiny or lies inside the eye.
- Instruments correct in size and position, entering through the correct incision.
- Orientation and laterality: the RIGHT eye is operated in every operation. In microscope views the patient's forehead (superior limbus, 12 o'clock) is at the TOP of the frame and the patient's nose is on the viewer's RIGHT (the right eye seen from above with the head at the top, as if the patient faces you). Include a hint of the nose bridge at the right edge of the frame whenever the side matters (nasal pterygium, nasal structures). Never flip this between images of the same operation.
- BODIES MUST BE WHOLE AND CONNECTED. Every hand belongs to an arm that runs to a shoulder of a visible body. The same
  patient keeps the same face, age and hair in every image of an operation; never swap the patient.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal. Cornea clear and glossy; sclera white; iris with its natural pattern;
  conjunctiva thin and translucent with fine vessels; lens grey-white or yellow-brown when cataractous; fat yellow
  ONLY where real fat is (orbit, eyelid, subcutaneous).
- Patients covered and dignified; only the operative field exposed.

PRECISE FACTS (draw exactly this)
Positioning (a NEW whole-body view for each operation; never reuse a generic theatre scene):
- A, B, C and F. Supine, the head flat and level on a gel head ring, chin and forehead in one horizontal plane, the
  head at the very end of the table; the surgeon SEATED at the head of the table with the operating microscope over the
  right eye; arms by the sides, a light blanket. Side view at table height so the flat head and the seated surgeon
  are obvious.
- D and E. Supine on the laser bed, head level in the head rest, the laser head directly above the right eye; the
  left eye covered with an opaque shield; the patient awake and looking up at the fixation light.
Step-specific facts:
- A. Clear corneal main incision about 2.2 to 2.8 mm at the TOP-LEFT (temporal-superior) of the cornea in the
  microscope view, plus a small side port. Capsulorhexis round, central, about 5 to 5.5 mm, edge continuous. Phaco tip
  in the centre of the bag, away from the cornea. The foldable lens unfolding inside the capsular bag, centred.
- B. A small fornix-based conjunctival flap at 12 o'clock; a frown or straight scleral incision 6 to 7 mm long, 1.5 to 2
  mm behind the limbus; a tunnel dissected forwards into clear cornea; the nucleus delivered out of the tunnel on an
  irrigating vectis; a rigid lens with loop haptics placed in the bag.
- C. Corneal traction suture pulling the eye down; fornix-based peritomy at 12 o'clock; small white sponges soaked in
  mitomycin C under Tenon's well back from the cut edge; a rectangular half-thickness scleral flap about 4 by 3 mm at
  the limbus; a small block removed under it with a punch and a peripheral iridectomy; fine nylon flap sutures;
  conjunctiva closed watertight to the limbus.
- D. Epithelium removed over the central 8 to 9 mm (alcohol in a small metal well, then a sponge); the bare stroma
  matt; the laser beam shown as a faint violet spot pattern centred on the pupil; a clear soft bandage contact lens at
  the end.
- E. A suction ring or femtosecond interface docked on the cornea; a thin hinged flap with a SUPERIOR hinge lifted with
  a spatula and folded back over the hinge; the laser on the exposed bed; the flap laid back with even gutters.
- F. A fleshy triangular pterygium growing from the NASAL conjunctiva (toward the nose, viewer's RIGHT) onto the cornea;
  the head lifted off the cornea; a bare white scleral bed; a thin, transparent graft taken from the SUPERIOR bulbar
  conjunctiva (12 o'clock) and laid on the bed with its limbal edge against the limbus, held with fibrin glue.
Screens and machines (phaco machine, laser, microscope monitor) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and drop bottles
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 105 images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern ophthalmic surgery atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs; neutral clean background; the laser suite for refractive steps.
- Within each operation the same adult patient, the same team and the same instrument set in every image. Staff in
  caps and masks, generic faces, no real or identifiable person.
- Landscape 4:3, exactly 1600 x 1200 px, PNG.

THE STEPS  (filename [step id]  scene : teaching point : check)
Each line quotes what that step does in the app. Draw the ONE moment that shows it best. Where a step is a check,
a decision or a bailout (biometry, refractive check, mechanism check, posterior capsule tear, suprachoroidal
haemorrhage), draw the people and the thing being checked or the complication being handled, for example the surgeon
comparing a blank biometry sheet with the unopened lens box, or the darkening red reflex and the surgeon suturing the
wound. Use the PRECISE FACTS above wherever they apply.

COMMON SAFETY STEPS (draw them for each operation with that operation's patient, team and setting)
- consent-check: pre-op bay, the awake patient, the surgeon marking an arrow ABOVE THE RIGHT EYEBROW (the operated
  eye) while going through a consent form with grey lines. Teach: confirm identity, operation and eye with the awake
  patient. Check: arrow above the right brow, nothing written.
- timeout: theatre, patient on the table, whole team paused and facing each other, surgeon speaking, nobody holding an
  instrument; for lens operations the scrub nurse holds the unopened implant box (blank label) beside a biometry sheet
  (grey lines). Teach: everyone stops and confirms before the first cut.
- prophylaxis: the anaesthetist or nurse connects a syringe (blank label) to the cannula PORT on the arm (needle-free).
  Teach: prophylaxis per protocol. Check: arm attached to the patient.
- prep-drape: lids and skin around the right eye cleaned with antiseptic, then a clear adhesive eye drape over the eye
  with the lashes tucked away under it. Teach: prepare and isolate the lashes.
- haemostasis: a fine wet-field cautery tip touching a single bleeding point; the field dry.
- counts: scrub practitioner and circulating nurse counting blades, needles and sponges beside a BLANK count board.
  Teach: count before closure; any discrepancy stops the closure.
- specimen: the excised tissue in a small pot with a BLANK white label, surgeon and scrub reading it together.
- skin-closure: the closed wound with a clean dressing.
- debrief: surgeon writing the operation note (grey lines) and handing over to a recovery nurse; the patient sitting up
  with a clear eye shield.

A. PHACOEMULSIFICATION WITH FOLDABLE LENS IMPLANT (RIGHT EYE)  (folder phacoemulsification/)
01_consent-check.png [step.core.consent-check]  Common. Mark the operative eye above the brow; ask the patient which
   eye and why. Second-eye surgery is a common wrong-site setting.
02_biometry-iol-check.png [step.eye.biometry-iol-check]  Biometry and lens implant check: Before the patient is in
   theatre, confirm the biometry belongs to this patient and this eye: axial length, keratometry, the formula and the
   target refraction. Choose the implant model and power from the plan, plus a back-up lens for the sulcus if the
   capsule fails. Teach: A wrong lens implant gives a large refractive surprise that needs another operation. Check:
   avoid using the fellow eye's biometry.
03_timeout.png [step.core.timeout]  Common. Read the implant model and power aloud against the biometry printout for
   this eye.
04_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Topical with intracameral local suits most cooperative adults; sub-
   Tenon for longer or complex cases. Teach: The anaesthetic decides how still the eye is, how much the patient feels
   and which complications are possible. Check: avoid a sharp-needle block in a long myopic eye.
05_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
06_povidone-iodine.png [step.eye.povidone-iodine]  Povidone-iodine 5% to the conjunctival sac: Instil povidone-iodine
   5% into the conjunctival sac and paint the lids and lashes with 5 to 10%. Leave it in contact for about three
   minutes before the first incision or injection. Teach: Endophthalmitis is the infection that loses an eye after
   intraocular surgery, and the bacteria come from the patient's own lids and conjunctiva. Check: avoid instilling it
   and starting immediately, before it has had contact time.
07_prep-drape.png [step.core.prep-drape]  Common. Clean the lids and periocular skin; the drape must tuck the lashes
   away.
08_lid-speculum.png [step.eye.lid-speculum]  Microscope, lash drape and lid speculum: Set the microscope: patient's
   head level, the eye centred, focus and red reflex checked, foot pedal and the surgeon's posture comfortable. Apply
   an adhesive drape that tucks the lashes and lid margins away from the field. Teach: The lashes and lid margins
   carry the bacteria that cause endophthalmitis, and a poorly set microscope makes every later step harder. Check:
   avoid lashes left free in the field.
09_incisions.png [step.phaco.incisions]  Main and side-port corneal incisions: Fixate the eye and make the side port
   with a 15 degree blade. Fill the chamber with viscoelastic through the side port. Teach: A well-built tunnel
   incision self-seals at the end and keeps the chamber stable. Check: avoid an incision too far back that lets the
   iris prolapse.
10_capsulorhexis.png [step.phaco.capsulorhexis]  Continuous curvilinear capsulorhexis: Fill the chamber with cohesive
   viscoelastic so the lens is flat and the capsule is under no tension. Start a flap with a cystotome or forceps and
   tear in a continuous circle, regrasping often and pulling towards the centre. Teach: A round, central, continuous
   tear of the anterior capsule about 5 to 5.5 mm wide resists tearing out during phaco and holds the implant centred.
   Check: avoid a shallow chamber that lets the tear run out.
11_hydrodissection.png [step.phaco.hydrodissection]  Hydrodissection and rotation of the nucleus: Pass a cannula just
   under the anterior capsule edge and inject balanced salt slowly until a fluid wave crosses the red reflex. Press
   gently on the centre of the lens to release trapped fluid, so it does not blow out the posterior capsule. Teach:
   Freeing the lens from its capsule lets the nucleus rotate, so it can be removed with less stress on the zonules and
   the posterior capsule. Check: avoid forceful injection with a sealed rhexis (capsular block syndrome).
12_nucleus.png [step.phaco.nucleus]  Nucleus removal with phaco (divide and conquer or chop): Set the bottle height
   and fluidics for the technique; confirm a stable chamber. Sculpt a groove (divide and conquer) or chop the nucleus,
   crack it into segments, and emulsify each segment in the centre of the bag. Teach: This is where ultrasound energy
   is used inside the eye. Check: avoid phaco near the endothelium.
13_cortex.png [step.phaco.cortex]  Cortex removal with irrigation and aspiration: Engage cortex under the capsule edge
   with the aspiration port facing up, then strip it towards the centre. Use a bimanual system for subincisional
   cortex. Teach: Retained cortex causes inflammation and raised pressure; aspirating carelessly catches the posterior
   capsule. Check: avoid aspirating with the port facing the posterior capsule.
14_iol.png [step.phaco.iol]  Implant insertion into the capsular bag: Fill the bag with cohesive viscoelastic. Load
   the foldable implant in the injector the right way up, and inject it into the bag through the main incision,
   guiding the leading haptic in. Teach: A lens centred in the bag gives the planned refraction and is stable for
   life. Check: avoid inserting the implant upside down.
15_posterior-capsule-rupture.png [step.eye.posterior-capsule-rupture]  Bailout: posterior capsule rupture and vitreous
   loss: Stop the phaco or irrigation: keep the instrument in the eye and inject dispersive viscoelastic before
   withdrawing, so the chamber does not collapse. Tell the team. Lower the bottle height and the flow. Teach: A tear
   in the posterior capsule is the commonest serious complication of cataract surgery. Check: avoid pulling out the
   phaco probe and collapsing the chamber.
16_intracameral-antibiotic.png [step.eye.intracameral-antibiotic]  Intracameral antibiotic at the end of cataract
   surgery: Use the agent and dose of local policy, for example cefuroxime 1 mg in 0.1 mL or moxifloxacin, prepared
   and checked by two people or from a ready-made product. Inject into the anterior chamber through the side port
   after the wound is sealed. Teach: Intracameral antibiotic at the end of cataract surgery substantially reduces
   endophthalmitis. Check: avoid preparing the dilution alone at the end of a long list.
17_wound-check.png [step.eye.wound-check]  Watertight wound and eye pressure check: Hydrate the corneal or scleral
   wound edges if needed and check that they hold when pressed gently. Paint fluorescein over the wound (Seidel test)
   or watch for a leak while pressing beside it. Teach: A leaking wound lets bacteria in and lets the eye go soft; a
   pressure that is too high hurts and can close the retinal circulation. Check: avoid leaving a soft eye with a
   gaping wound.
18_counts.png [step.core.counts]  Common. Blades and needles accounted for; the used implant packaging kept for the
   record.
19_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Teach: Most sight-threatening problems after eye surgery
   declare themselves at home: increasing pain, redness and falling vision mean endophthalmitis or raised pressure
   until proven otherwise. Check: avoid discharging without a same-day emergency contact.
20_debrief.png [step.core.debrief]  Common.

B. MANUAL SMALL-INCISION CATARACT SURGERY, SICS (RIGHT EYE)  (folder manual-sics/)
01_consent-check.png [step.core.consent-check]  Common. Mark the operative eye; confirm the eye with the patient in
   their own language.
02_biometry-iol-check.png [step.eye.biometry-iol-check]  Biometry and lens implant check: Before the patient is in
   theatre, confirm the biometry belongs to this patient and this eye: axial length, keratometry, the formula and the
   target refraction. Choose the implant model and power from the plan, plus a back-up lens for the sulcus if the
   capsule fails. Teach: A wrong lens implant gives a large refractive surprise that needs another operation. Check:
   avoid using the fellow eye's biometry.
03_timeout.png [step.core.timeout]  Common. Read the implant model and power aloud; confirm the back-up implant is in
   the room.
04_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Peribulbar or sub-Tenon block is usual for SICS. Teach: The
   anaesthetic decides how still the eye is, how much the patient feels and which complications are possible. Check:
   avoid a sharp-needle block in a long myopic eye.
05_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
06_povidone-iodine.png [step.eye.povidone-iodine]  Povidone-iodine 5% to the conjunctival sac: Instil povidone-iodine
   5% into the conjunctival sac and paint the lids and lashes with 5 to 10%. Leave it in contact for about three
   minutes before the first incision or injection. Teach: Endophthalmitis is the infection that loses an eye after
   intraocular surgery, and the bacteria come from the patient's own lids and conjunctiva. Check: avoid instilling it
   and starting immediately, before it has had contact time.
07_prep-drape.png [step.core.prep-drape]  Common.
08_lid-speculum.png [step.eye.lid-speculum]  Microscope, lash drape and lid speculum: Set the microscope: patient's
   head level, the eye centred, focus and red reflex checked, foot pedal and the surgeon's posture comfortable. Apply
   an adhesive drape that tucks the lashes and lid margins away from the field. Teach: The lashes and lid margins
   carry the bacteria that cause endophthalmitis, and a poorly set microscope makes every later step harder. Check:
   avoid lashes left free in the field.
09_tunnel.png [step.sics.tunnel]  Fornix-based conjunctival flap and sclerocorneal tunnel: Make a small fornix-based
   conjunctival flap and apply light wet-field cautery to the sclera. Make a partial-thickness frown or straight
   external incision about 6 to 7 mm long, 1.5 to 2 mm behind the limbus. Teach: The tunnel is the whole idea of SICS:
   a self-sealing, sutureless wound big enough to deliver the nucleus. Check: avoid a superficial tunnel that
   buttonholes.
10_capsulotomy.png [step.sics.capsulotomy]  Anterior capsulotomy: Under viscoelastic, perform a large continuous
   curvilinear capsulorhexis (about 6 to 7 mm) with relaxing cuts if needed, or a can-opener capsulotomy in a white
   cataract. Stain the capsule with trypan blue when the red reflex is poor. Teach: The nucleus has to come out of the
   bag, so the opening must be large enough to let it prolapse without tearing round to the posterior capsule. Check:
   avoid a small rhexis that traps the nucleus.
11_prolapse.png [step.sics.prolapse]  Hydrodissection and prolapsing the nucleus into the chamber: Hydrodissect until
   the nucleus is free; with a large rhexis, one pole can be prolapsed with the fluid wave. Rotate or dial the nucleus
   out of the bag into the anterior chamber. Teach: Bringing the nucleus out of the bag into the anterior chamber,
   rather than levering it out from the bag, keeps the posterior capsule and zonules safe. Check: avoid forcing a
   nucleus through a small rhexis.
12_delivery.png [step.sics.delivery]  Delivering the nucleus through the tunnel: Slide an irrigating vectis under the
   nucleus, or use viscoexpression or the fish-hook technique per training. Apply gentle pressure on the posterior lip
   of the tunnel so the nucleus glides out with the fluid. Teach: Delivery is the step that can damage the endothelium
   or tear the iris if the tunnel is too small or the nucleus is pushed rather than guided. Check: avoid forcing a
   large nucleus through a small tunnel.
13_cortex-iol.png [step.sics.cortex-iol]  Cortex aspiration and implant insertion: Aspirate cortex with a Simcoe
   cannula or an irrigation-aspiration system, port facing up. Fill the bag with viscoelastic and place the implant in
   the bag; dial it centred. Teach: Clean cortex removal and an implant centred in the bag decide the final vision and
   the long-term stability. Check: avoid aspirating the posterior capsule.
14_posterior-capsule-rupture.png [step.eye.posterior-capsule-rupture]  Bailout: posterior capsule rupture and vitreous
   loss: Stop the phaco or irrigation: keep the instrument in the eye and inject dispersive viscoelastic before
   withdrawing, so the chamber does not collapse. Tell the team. Lower the bottle height and the flow. Teach: A tear
   in the posterior capsule is the commonest serious complication of cataract surgery. Check: avoid pulling out the
   phaco probe and collapsing the chamber.
15_suprachoroidal-haemorrhage.png [step.eye.suprachoroidal-haemorrhage]  Bailout: suprachoroidal haemorrhage:
   Recognise it: the red reflex darkens, the chamber shallows, the eye hardens and the iris or lens comes forward.
   Close every wound immediately with sutures, with a finger over the wound while the stitch is placed. Teach:
   Bleeding into the suprachoroidal space can push the eye contents out of an open wound within minutes. Check: avoid
   continuing the operation through a darkening red reflex.
16_intracameral-antibiotic.png [step.eye.intracameral-antibiotic]  Intracameral antibiotic at the end of cataract
   surgery: Use the agent and dose of local policy, for example cefuroxime 1 mg in 0.1 mL or moxifloxacin, prepared
   and checked by two people or from a ready-made product. Inject into the anterior chamber through the side port
   after the wound is sealed. Teach: Intracameral antibiotic at the end of cataract surgery substantially reduces
   endophthalmitis. Check: avoid preparing the dilution alone at the end of a long list.
17_wound-check.png [step.eye.wound-check]  Watertight wound and eye pressure check: Hydrate the corneal or scleral
   wound edges if needed and check that they hold when pressed gently. Paint fluorescein over the wound (Seidel test)
   or watch for a leak while pressing beside it. Check the tunnel self-seals; reposit the conjunctival flap over it
   and cauterise lightly. Teach: A leaking wound lets bacteria in and lets the eye go soft; a pressure that is too
   high hurts and can close the retinal circulation. Check: avoid leaving a soft eye with a gaping wound.
18_counts.png [step.core.counts]  Common.
19_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Teach: Most sight-threatening problems after eye surgery
   declare themselves at home: increasing pain, redness and falling vision mean endophthalmitis or raised pressure
   until proven otherwise. Check: avoid discharging without a same-day emergency contact.
20_debrief.png [step.core.debrief]  Common.

C. TRABECULECTOMY WITH MITOMYCIN C (RIGHT EYE)  (folder trabeculectomy/)
01_consent-check.png [step.core.consent-check]  Common. Mark the eye; the patient must understand that the frequent
   early visits are part of the operation.
02_timeout.png [step.core.timeout]  Common. Confirm the eye, the antimetabolite and its concentration, and the time it
   will be applied.
03_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Sub-Tenon or peribulbar is usual; general anaesthesia for those who
   cannot lie still. Teach: The anaesthetic decides how still the eye is, how much the patient feels and which
   complications are possible. Check: avoid a sharp-needle block in a long myopic eye.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_povidone-iodine.png [step.eye.povidone-iodine]  Povidone-iodine 5% to the conjunctival sac: Instil povidone-iodine
   5% into the conjunctival sac and paint the lids and lashes with 5 to 10%. Leave it in contact for about three
   minutes before the first incision or injection. Teach: Endophthalmitis is the infection that loses an eye after
   intraocular surgery, and the bacteria come from the patient's own lids and conjunctiva. Check: avoid instilling it
   and starting immediately, before it has had contact time.
06_prep-drape.png [step.core.prep-drape]  Common.
07_lid-speculum.png [step.eye.lid-speculum]  Microscope, lash drape and lid speculum: Set the microscope: patient's
   head level, the eye centred, focus and red reflex checked, foot pedal and the surgeon's posture comfortable. Apply
   an adhesive drape that tucks the lashes and lid margins away from the field. Teach: The lashes and lid margins
   carry the bacteria that cause endophthalmitis, and a poorly set microscope makes every later step harder. Check:
   avoid lashes left free in the field.
08_traction.png [step.trab.traction]  Corneal traction suture: Place a 7-0 or 8-0 partial-thickness suture in the
   superior peripheral cornea. Clip it to the drape so the eye looks down and the superior conjunctiva is exposed.
   Teach: Rotating the eye down exposes the superior limbus where the bleb will lie, under the upper lid. Check: avoid
   a full-thickness corneal pass that leaks.
09_conj-peritomy.png [step.eye.conj-peritomy]  Conjunctival peritomy and Tenon's dissection: Lift the conjunctiva with
   non-toothed forceps and open it at the limbus (limbus-based or fornix-based as planned) with blunt-tipped scissors.
   Dissect Tenon's capsule from the sclera bluntly in the plane above the muscles. Fornix-based peritomy at the
   superior limbus, with a wide posterior Tenon's pocket so the bleb is diffuse. Teach: Conjunctiva is the covering
   that protects a bleb, a muscle repair or an implant. Check: avoid toothed forceps on the conjunctival edge.
10_mmc.png [step.trab.mmc]  Applying mitomycin C: Soak small sponges in mitomycin C at the agreed concentration (for
   example 0.2 to 0.4 mg/mL). Place them under Tenon's well back over a wide area, keeping them away from the cut
   conjunctival edge. Teach: The antimetabolite stops the bleb scarring shut, which is the main reason
   trabeculectomies fail. Check: avoid mitomycin C on the conjunctival edge.
11_flap.png [step.trab.flap]  Partial-thickness scleral flap: Mark a rectangular or trapezoidal flap about 4 by 3 mm
   at the limbus. Dissect it at about half scleral thickness forwards into clear cornea. Teach: The scleral flap is
   the guard over the drainage hole: its thickness and the tightness of its sutures control how much aqueous leaves
   the eye. Check: avoid a thin flap that tears or a deep one that exposes the ciliary body.
12_sclerostomy.png [step.trab.sclerostomy]  Sclerostomy and peripheral iridectomy: Enter the chamber under the flap
   just behind the clear cornea. Remove a block of corneoscleral tissue with a punch. Teach: The sclerostomy is the
   opening that lets aqueous out. Check: avoid a posterior sclerostomy into the ciliary body.
13_titrate.png [step.trab.titrate]  Flap sutures and titration of flow: Close the flap corners with 10-0 nylon,
   including releasable or adjustable sutures as planned. Inflate the chamber through the paracentesis and watch the
   flow at the flap edges: slow percolation, not a gush. Teach: Early overdrainage causes the commonest complications.
   Check: avoid leaving the flap loose.
14_conj-closure.png [step.eye.conj-closure]  Conjunctival closure: Lay the conjunctiva back in its anatomical
   position, edges flat and not inverted. Close with fine absorbable sutures or tissue glue, anchoring to the limbus
   where needed. Anchor the conjunctiva to the limbus watertight and check with fluorescein: any leak over a bleb is
   significant. Teach: A conjunctival closure has to cover what lies under it: a leak over a bleb drains the eye flat,
   and an exposed suture or implant becomes infected. Check: avoid a gap at the limbus that leaks.
15_suprachoroidal-haemorrhage.png [step.eye.suprachoroidal-haemorrhage]  Bailout: suprachoroidal haemorrhage:
   Recognise it: the red reflex darkens, the chamber shallows, the eye hardens and the iris or lens comes forward.
   Close every wound immediately with sutures, with a finger over the wound while the stitch is placed. Teach:
   Bleeding into the suprachoroidal space can push the eye contents out of an open wound within minutes. Check: avoid
   continuing the operation through a darkening red reflex.
16_wound-check.png [step.eye.wound-check]  Watertight wound and eye pressure check: Hydrate the corneal or scleral
   wound edges if needed and check that they hold when pressed gently. Paint fluorescein over the wound (Seidel test)
   or watch for a leak while pressing beside it. Reform the chamber through the paracentesis; check the bleb forms and
   the chamber stays deep. Teach: A leaking wound lets bacteria in and lets the eye go soft; a pressure that is too
   high hurts and can close the retinal circulation. Check: avoid leaving a soft eye with a gaping wound.
17_counts.png [step.core.counts]  Common.
18_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Teach: Most sight-threatening problems after eye surgery
   declare themselves at home: increasing pain, redness and falling vision mean endophthalmitis or raised pressure
   until proven otherwise. Check: avoid discharging without a same-day emergency contact.
19_debrief.png [step.core.debrief]  Common.

D. PHOTOREFRACTIVE KERATECTOMY, PRK (RIGHT EYE)  (folder prk/)
01_consent-check.png [step.core.consent-check]  Common. Elective surgery on healthy eyes: written consent at a
   separate visit, with a cooling-off period per standards.
02_refractive-check.png [step.eye.refractive-check]  Refractive surgery check: stable refraction, corneal safety and
   the laser plan: Confirm a stable refraction for at least a year, from records, and a cycloplegic refraction where
   indicated. Review topography and tomography for keratoconus or forme fruste keratoconus, and pachymetry for enough
   residual stromal bed. Teach: Laser refractive surgery is elective surgery on a healthy eye, so the threshold for
   harm is very low. Check: avoid treating a suspect topography.
03_timeout.png [step.core.timeout]  Common. At the laser: patient name, eye, refraction and treatment profile read
   aloud from the plan.
04_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
05_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Topical anaesthetic drops only. Teach: The anaesthetic decides how
   still the eye is, how much the patient feels and which complications are possible. Check: avoid a sharp-needle
   block in a long myopic eye.
06_prep-drape.png [step.core.prep-drape]  Common. Clean the lids and tape or drape the lashes away from the field.
07_lid-speculum.png [step.eye.lid-speculum]  Microscope, lash drape and lid speculum: Set the microscope: patient's
   head level, the eye centred, focus and red reflex checked, foot pedal and the surgeon's posture comfortable. Apply
   an adhesive drape that tucks the lashes and lid margins away from the field. Teach: The lashes and lid margins
   carry the bacteria that cause endophthalmitis, and a poorly set microscope makes every later step harder. Check:
   avoid lashes left free in the field.
08_epithelium.png [step.prk.epithelium]  Removing the epithelium: Remove the epithelium over the planned zone: 20%
   alcohol in a well for about 20 to 30 seconds then a sponge sweep, a rotating brush, or a transepithelial laser
   profile. Dry the alcohol up and irrigate so none spills onto the limbus. Teach: The laser must treat bare, evenly
   exposed stroma. Check: avoid alcohol spilling outside the well.
09_excimer-ablation.png [step.eye.excimer-ablation]  Excimer laser ablation with eye tracking: Check the laser has
   passed its calibration test that day. Ask the patient to fixate on the light; engage the eye tracker and confirm
   centration over the pupil or visual axis before firing. Teach: The ablation removes a precise depth of stroma to
   change the corneal curvature. Check: avoid firing without confirming centration.
10_laser-interruption.png [step.eye.laser-interruption]  Bailout: laser interruption, decentration or loss of
   tracking: Take the foot off the pedal as soon as the patient moves, the tracker disengages or the laser faults. Re-
   establish fixation and centration; most lasers allow the treatment to resume from where it stopped. Teach: A
   treatment that has gone off centre or stopped half way cannot simply be repeated from the start. Check: avoid
   restarting the full treatment after a partial ablation.
11_mmc.png [step.prk.mmc]  Mitomycin C to reduce haze (when indicated): Apply a sponge soaked in mitomycin C 0.02% to
   the ablated area for the time in the protocol (often 12 to 30 seconds). Irrigate thoroughly with chilled balanced
   salt. Teach: After deeper ablations, haze can blur vision for months. Check: avoid exceeding the protocol time.
12_bandage.png [step.prk.bandage]  Bandage contact lens: Place a soft bandage contact lens and check it centres and
   moves slightly. Start antibiotic and steroid drops; give the removal date in writing. Teach: The bandage lens
   reduces pain and protects the new epithelium. Check: avoid a tight lens that does not move.
13_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Bandage lens in, drops explained, and the warning that
   increasing pain or discharge after day two is infection until proven otherwise. Teach: Most sight-threatening
   problems after eye surgery declare themselves at home: increasing pain, redness and falling vision mean
   endophthalmitis or raised pressure until proven otherwise. Check: avoid discharging without a same-day emergency
   contact.
14_debrief.png [step.core.debrief]  Common.

E. LASIK (RIGHT EYE)  (folder lasik/)
01_consent-check.png [step.core.consent-check]  Common. Elective surgery on healthy eyes: written consent at a
   separate visit.
02_refractive-check.png [step.eye.refractive-check]  Refractive surgery check: stable refraction, corneal safety and
   the laser plan: Confirm a stable refraction for at least a year, from records, and a cycloplegic refraction where
   indicated. Review topography and tomography for keratoconus or forme fruste keratoconus, and pachymetry for enough
   residual stromal bed. Teach: Laser refractive surgery is elective surgery on a healthy eye, so the threshold for
   harm is very low. Check: avoid treating a suspect topography.
03_timeout.png [step.core.timeout]  Common. At each laser: patient, eye, refraction and treatment read aloud.
04_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
05_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Topical anaesthetic drops; an oral anxiolytic per local practice.
   Teach: The anaesthetic decides how still the eye is, how much the patient feels and which complications are
   possible. Check: avoid a sharp-needle block in a long myopic eye.
06_prep-drape.png [step.core.prep-drape]  Common. Clean the lids, drape the lashes away.
07_lid-speculum.png [step.eye.lid-speculum]  Microscope, lash drape and lid speculum: Set the microscope: patient's
   head level, the eye centred, focus and red reflex checked, foot pedal and the surgeon's posture comfortable. Apply
   an adhesive drape that tucks the lashes and lid margins away from the field. Teach: The lashes and lid margins
   carry the bacteria that cause endophthalmitis, and a poorly set microscope makes every later step harder. Check:
   avoid lashes left free in the field.
08_flap.png [step.lasik.flap]  Creating the corneal flap: Mark the cornea so the flap can be realigned. Dock the
   suction interface centred on the cornea; check suction before creating the flap. Teach: The flap gives LASIK its
   fast, painless recovery but is also where its specific complications come from. Check: avoid a decentred dock.
09_suction-loss.png [step.lasik.suction-loss]  Bailout: suction loss or an incomplete flap: If suction breaks during
   flap creation, stop. With a femtosecond laser, redocking and repeating may be possible per the manufacturer. If the
   flap is incomplete, buttonholed or a free cap, do not lift it and do not ablate: replace it, protect it, and plan
   surface ablation or a new flap after the cornea has settled (often three months). Teach: A flap cut through after
   suction loss can be irregular, thin or incomplete. Check: avoid lifting and ablating on a buttonholed flap.
10_flap-lift.png [step.lasik.flap-lift]  Lifting the flap: Under the excimer microscope, open the flap edge with a
   spatula and lift it smoothly to the hinge. Fold it back onto a dry surface, protecting the hinge from the laser.
   Teach: A clean lift exposes the bed evenly for the ablation without tearing the flap or the hinge. Check: avoid
   tearing the flap edge.
11_excimer-ablation.png [step.eye.excimer-ablation]  Excimer laser ablation with eye tracking: Check the laser has
   passed its calibration test that day. Ask the patient to fixate on the light; engage the eye tracker and confirm
   centration over the pupil or visual axis before firing. Teach: The ablation removes a precise depth of stroma to
   change the corneal curvature. Check: avoid firing without confirming centration.
12_laser-interruption.png [step.eye.laser-interruption]  Bailout: laser interruption, decentration or loss of
   tracking: Take the foot off the pedal as soon as the patient moves, the tracker disengages or the laser faults. Re-
   establish fixation and centration; most lasers allow the treatment to resume from where it stopped. Teach: A
   treatment that has gone off centre or stopped half way cannot simply be repeated from the start. Check: avoid
   restarting the full treatment after a partial ablation.
13_reposition.png [step.lasik.reposition]  Flap reposition and interface irrigation: Lay the flap back and irrigate
   the interface to wash out debris. Smooth the flap from the hinge outwards with a moist sponge; align the marks and
   the gutter evenly all round. Teach: Debris or folds left in the interface cause inflammation, striae and poor
   vision. Check: avoid leaving debris in the interface.
14_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Shield at night, no rubbing, review the next day. Teach:
   Most sight-threatening problems after eye surgery declare themselves at home: increasing pain, redness and falling
   vision mean endophthalmitis or raised pressure until proven otherwise. Check: avoid discharging without a same-day
   emergency contact.
15_debrief.png [step.core.debrief]  Common.

F. PTERYGIUM EXCISION WITH CONJUNCTIVAL AUTOGRAFT (RIGHT EYE, NASAL)  (folder pterygium-excision-autograft/)
01_consent-check.png [step.core.consent-check]  Common. Mark the eye and the side of the pterygium (nasal or
   temporal).
02_timeout.png [step.core.timeout]  Common.
03_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Topical drops with subconjunctival local anaesthetic under the
   pterygium is usual. Teach: The anaesthetic decides how still the eye is, how much the patient feels and which
   complications are possible. Check: avoid a sharp-needle block in a long myopic eye.
04_positioning.png [step.core.positioning]  Teach and Check: the F positioning facts exactly.
05_povidone-iodine.png [step.eye.povidone-iodine]  Povidone-iodine 5% to the conjunctival sac: Instil povidone-iodine
   5% into the conjunctival sac and paint the lids and lashes with 5 to 10%. Leave it in contact for about three
   minutes before the first incision or injection. Teach: Endophthalmitis is the infection that loses an eye after
   intraocular surgery, and the bacteria come from the patient's own lids and conjunctiva. Check: avoid instilling it
   and starting immediately, before it has had contact time.
06_prep-drape.png [step.core.prep-drape]  Common.
07_lid-speculum.png [step.eye.lid-speculum]  Microscope, lash drape and lid speculum: Set the microscope: patient's
   head level, the eye centred, focus and red reflex checked, foot pedal and the surgeon's posture comfortable. Apply
   an adhesive drape that tucks the lashes and lid margins away from the field. Teach: The lashes and lid margins
   carry the bacteria that cause endophthalmitis, and a poorly set microscope makes every later step harder. Check:
   avoid lashes left free in the field.
08_excise.png [step.ptg.excise]  Excising the pterygium head and body: Separate the head from the cornea by blunt
   avulsion or careful dissection in the plane above Bowman's layer. Excise the conjunctival body and dissect the
   abnormal subconjunctival Tenon's off the sclera, staying anterior to the muscle insertion. Teach: The head comes
   off the cornea and the body with its fibrovascular Tenon's is removed. Check: avoid dissecting into the muscle.
09_cornea.png [step.ptg.cornea]  Smoothing the cornea: Remove residual fibrovascular tissue from the cornea with a
   blade or diamond burr. Keep the keratectomy superficial and smooth. Teach: Residual tissue on the cornea gives an
   irregular surface and invites recurrence. Check: avoid a deep, irregular keratectomy.
10_graft-harvest.png [step.ptg.graft-harvest]  Harvesting the conjunctival autograft: Measure the bed and mark a graft
   about 0.5 to 1 mm larger at the superior bulbar conjunctiva. Balloon the conjunctiva with saline or local
   anaesthetic, and dissect a thin graft free of Tenon's up to the limbus. Teach: A thin, Tenon-free graft with its
   limbal edge marked is what lowers the recurrence rate. Check: avoid including Tenon's in the graft.
11_graft-secure.png [step.ptg.graft-secure]  Securing the graft limbus to limbus: Slide the graft onto the bed with
   its limbal edge at the limbus, epithelial side up. Secure with fibrin glue or interrupted absorbable sutures,
   smoothing out folds and expressing any blood under it. Teach: The limbal edge of the graft carries stem cells that
   act as a barrier; facing the cornea, it reduces recurrence. Check: avoid an inverted graft (epithelium down).
12_bailout.png [step.ptg.bailout]  Bailout: scleral thinning, muscle exposure or an atypical lesion: If the medial
   rectus is exposed or cut, identify the ends and repair with absorbable suture, or call a strabismus surgeon. If the
   sclera is very thin, avoid further cautery and cover it (graft or patch). Teach: Unexpected findings change the
   operation: thin sclera may need a patch, a damaged muscle needs repair, and a lesion that looks like neoplasia
   needs a different, no-touch excision with margins. Check: avoid treating a neoplastic lesion as a simple pterygium.
13_haemostasis.png [step.core.haemostasis]  Common. Light wet-field cautery only to the bleeding points; heavy cautery
   thins sclera.
14_specimen.png [step.core.specimen]  Common. Send the pterygium for histology; label atypical features.
15_counts.png [step.core.counts]  Common.
16_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Pad overnight; drops explained. Teach: Most sight-
   threatening problems after eye surgery declare themselves at home: increasing pain, redness and falling vision mean
   endophthalmitis or raised pressure until proven otherwise. Check: avoid discharging without a same-day emergency
   contact.
17_debrief.png [step.core.debrief]  Common.

QUALITY CHECK (for EVERY image, at FULL SIZE, before moving to the next)
- RIGHT eye operated, and the orientation rule followed?
- Same patient as the other images of that operation?
- Every hand, arm and head attached to a body?
- Anatomy, instrument, incision and position correct for this step? Every PRECISE FACT that applies drawn exactly?
- The teaching point is the first thing the eye lands on?
- Zero text, numbers, labels, logos or watermarks, including boxes, printouts and screens?
If any answer is no, regenerate that image before continuing.

DELIVERY
Make one zip file per operation, each containing a FOLDER with the operation's folder name and the PNGs inside it,
named exactly as above:
  surgx-phacoemulsification-steps.zip   (folder phacoemulsification/)
  surgx-manual-sics-steps.zip   (folder manual-sics/)
  surgx-trabeculectomy-steps.zip   (folder trabeculectomy/)
  surgx-prk-steps.zip   (folder prk/)
  surgx-lasik-steps.zip   (folder lasik/)
  surgx-pterygium-excision-autograft-steps.zip   (folder pterygium-excision-autograft/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```

## Round 1 part A result and redo prompt (3 images)

Gemini's first share held only phaco, SICS and trabeculectomy. Wired 56 of 59. Held back: SICS 10 (a different, distorted
eye with pink lumps above and beside it), SICS 14 (a gel blob lying on the nasal conjunctiva outside the eye), SICS 15
(a finger pressing on the globe instead of over the wound). Note: trabeculectomy 09 to 16 show a grey-green iris and
lighter skin than 07 and 08 (brown iris); kept because the surgery is right.

```
Three SICS images are wrong. Regenerate ONLY these three with the IMAGE GENERATION MODEL (never code), in exactly the
same style, microscope view, patient (dark iris, dense yellow-brown cataract), speculum and drape as images 08, 09, 11
and 12 of manual-sics. RIGHT eye, forehead at the TOP, the nose and the pink caruncle on the viewer's RIGHT only.

1. manual-sics/10_capsulotomy.png
   - The same eye as image 09: the small fornix-based conjunctival flap at 12 o'clock folded back, the scleral tunnel
     opening at the top. ONE caruncle, on the viewer's right. No other pink tissue.
   - The anterior chamber filled with viscoelastic; a bent cystotome needle entering through the tunnel making a LARGE
     round capsulorhexis (about 6 to 7 mm) over the dense yellow-brown nucleus; trypan blue staining the capsule edge.
   - Teach: a large opening so the nucleus can come out of the bag. Check: same eye as image 09.

2. manual-sics/14_posterior-capsule-rupture.png
   - The same eye after the nucleus is out: a tear in the posterior capsule seen against the red reflex, clear vitreous
     strands coming forward through the tear towards the tunnel at 12 o'clock.
   - A vitrectomy cutter entering through the tunnel, with a separate irrigation cannula through a side port.
   - NOTHING lying on the conjunctiva outside the eye. Small cross-section inset of the torn posterior capsule.
   - Teach: stop, keep the chamber formed, clear the vitreous with a cutter. Check: everything is inside the eye.

3. manual-sics/15_suprachoroidal-haemorrhage.png
   - The same eye: the red reflex turning dark red to black, the iris bulging forward, the chamber shallow.
   - The surgeon placing a quick suture across the scleral tunnel at 12 o'clock with a needle holder, while an
     assistant's gloved fingertip presses GENTLY ON THE TUNNEL WOUND ITSELF (not on the globe elsewhere).
   - Small inset: a dark dome of blood under the choroid.
   - Teach: close the eye at once; do not keep operating. Check: no pressure on the globe away from the wound.

No text, numbers or labels. Landscape 4:3, 1600 x 1200 px, PNG, same filenames, in a folder named manual-sics.
Put all three in ONE zip: surgx-batch6-fix.zip
```
