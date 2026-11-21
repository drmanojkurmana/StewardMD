---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 7 (eye: injection, lacrimal, lids, trauma, orbit, squint, retina): Gemini image prompt (102 images, 7 operations)

Built 2026-11-21 from the real steps in `surgx/procedures/<id>.json`. Scene lines are generated from each step's own `how`, `why` and `pitfalls` (so they match the app text), with hand-written orientation, positioning and precise facts. Same block format as batches 4 and 5. Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with three consultant ophthalmic surgeons (medical retina, oculoplastics and strabismus/vitreoretinal). You are making 102 teaching images for a surgical training
app used by doctors and surgical trainees. One image per step:
  A. Intravitreal anti-VEGF injection (RIGHT eye)                   11 images
  B. External dacryocystorhinostomy (RIGHT side)                    16 images
  C. Chalazion incision and curettage (RIGHT upper lid)             11 images
  D. Corneal and subtarsal foreign body removal (RIGHT eye)         10 images
  E. Evisceration with orbital implant (RIGHT eye)                  19 images
  F. Strabismus surgery: rectus recession and resection (RIGHT eye) 19 images
  G. Pars plana vitrectomy for retinal detachment (RIGHT eye)       16 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from ophthalmic surgery textbooks, operative atlases, the guidance below and
   operative videos (Royal College of Ophthalmologists intravitreal guidance, the Avery 2014 expert panel, College of Optometrists clinical management guidelines, AAO Preferred Practice Patterns for strabismus and retinal detachment, oculoplastic atlases for DCR, chalazion and evisceration).
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
- A. Supine or reclined in a clean treatment room, head supported, the patient looking slightly UP and LEFT, away from
  the inferotemporal injection site.
- B. Supine, the head end of the table raised 15 to 20 degrees, head on a ring; nasal packs in the right nostril.
- C. Semi-reclined on a minor procedures couch, head supported.
- D. SEATED at a slit lamp: chin on the chin rest, forehead against the band, the doctor seated opposite with a hand
  resting on the patient's cheek.
- E, F and G. Supine, the head flat and level on a gel ring, intubated (E and F) or awake with a block (G); the surgeon
  seated at the head; the operating microscope over the right eye for F and G.
Step-specific facts:
- A. A lid speculum; povidone-iodine painted on the conjunctiva; calipers marking 4 mm behind the limbus in the
  INFEROTEMPORAL quadrant (bottom-LEFT in the microscope-orientation view); a 30G needle entering perpendicular to the
  sclera aimed at the centre of the globe; afterwards the doctor checks the patient can count fingers.
- B. A straight 10 to 15 mm skin incision about 10 mm medial to the medial canthus on the RIGHT side of the nose; the
  lacrimal sac lifted from its bony fossa; a bone window about 15 mm wide made with a punch; the sac and nasal lining
  opened as flaps and stitched together; optional thin silicone tubes from the puncta into the nose.
- C. The right upper lid everted in a chalazion clamp (ring on the conjunctival side); a VERTICAL incision on the
  conjunctival side, stopping 2 to 3 mm short of the lid margin; a small curette scooping out the contents.
- D. At the slit lamp: a small dark metal speck on the cornea off the visual axis with a faint orange rust ring; a 25G
  needle held TANGENTIAL to the cornea, bevel up, lifting it; the upper lid everted over a cotton bud to show a
  subtarsal particle; fluorescein staining the small defect green under blue light.
- E. A 360 degree peritomy; the cornea removed; an evisceration spoon separating the brown uveal tissue from the white
  inner sclera; a smooth white spherical implant placed inside the scleral shell; the sclera and Tenon's closed over it
  in layers; a clear plastic conformer in the fornices at the end. The patient is the same throughout and the LEFT eye
  stays untouched and covered.
- F. A muscle hook passed under the whole width of the MEDIAL rectus (nasal side, viewer's RIGHT); a double-armed fine
  suture woven through the muscle near its insertion with locking bites at each edge; calipers measuring the new
  position behind the insertion; the needle passed shallowly through the sclera.
- G. Three small trocar cannulas through the sclera 3.5 to 4 mm behind the limbus (infusion inferotemporally, two
  working ports superiorly); a light pipe and a cutter inside the eye seen through a wide-angle viewing lens; the
  retina flattened, laser spots around a horseshoe tear; at the end a gas bubble filling the upper part of the eye.
Screens and machines (phaco machine, laser, microscope monitor) show only abstract grey bars or waves, never numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Implant boxes, drug syringes, specimen pots and drop bottles
  carry BLANK white rectangles. Consent forms, biometry printouts, checklists and notes show only grey lines.
  Angles, distances and powers are NEVER written; show them by the drawing itself.

STYLE (identical across all 102 images)
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

A. INTRAVITREAL ANTI-VEGF INJECTION (RIGHT EYE)  (folder intravitreal-injection/)
01_consent-check.png [step.core.consent-check]  Common. Confirm the eye against the treatment plan; patients with
   bilateral disease are a wrong-eye risk.
02_timeout.png [step.core.timeout]  Common. Read the patient, eye, drug, dose and batch aloud.
03_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Topical drops, with a pledget or subconjunctival local if preferred.
   Teach: The anaesthetic decides how still the eye is, how much the patient feels and which complications are
   possible. Check: avoid a sharp-needle block in a long myopic eye.
04_positioning.png [step.core.positioning]  Teach and Check: the A positioning facts exactly.
05_povidone-iodine.png [step.eye.povidone-iodine]  Povidone-iodine 5% to the conjunctival sac: Instil povidone-iodine
   5% into the conjunctival sac and paint the lids and lashes with 5 to 10%. Leave it in contact for about three
   minutes before the first incision or injection. Povidone-iodine 5% to the conjunctiva and the injection site, and
   to the lid margins; masks or no talking to limit droplets. Teach: Endophthalmitis is the infection that loses an
   eye after intraocular surgery, and the bacteria come from the patient's own lids and conjunctiva. Check: avoid
   instilling it and starting immediately, before it has had contact time.
06_lid-speculum.png [step.eye.lid-speculum]  Microscope, lash drape and lid speculum: Set the microscope: patient's
   head level, the eye centred, focus and red reflex checked, foot pedal and the surgeon's posture comfortable. Apply
   an adhesive drape that tucks the lashes and lid margins away from the field. A speculum keeps lashes and lid
   margins away from the needle. Teach: The lashes and lid margins carry the bacteria that cause endophthalmitis, and
   a poorly set microscope makes every later step harder. Check: avoid lashes left free in the field.
07_site.png [step.ivi.site]  Choosing and marking the injection site: Measure 3.5 to 4 mm from the limbus with
   calipers (3.5 mm in pseudophakic eyes, 4 mm in phakic eyes), usually inferotemporal. Reapply povidone-iodine to the
   marked site. Teach: The pars plana window is narrow: too anterior hits the ciliary body or lens, too posterior
   risks the retina. Check: avoid estimating the distance by eye.
08_inject.png [step.ivi.inject]  Injecting the drug: Steady the globe; insert the 30G needle perpendicular to the
   sclera, aimed towards the centre of the eye. Inject the dose slowly, withdraw the needle, and press the site
   briefly with a sterile cotton bud to limit reflux. Teach: A controlled, slow injection with the needle aimed at the
   centre of the globe avoids the lens and the retina and limits reflux. Check: avoid aiming towards the lens in a
   phakic eye.
09_perfusion.png [step.ivi.perfusion]  Perfusion and pressure check: Ask the patient to count fingers or see hand
   movements, or look at the optic disc for perfusion. Measure the pressure if vision is poor or the eye has glaucoma.
   Teach: The injected volume raises the eye pressure briefly; in a glaucomatous eye it can stop the central retinal
   artery. Check: avoid sending the patient home without checking vision.
10_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Explain the endophthalmitis warning signs for the coming
   days and give the emergency number. Teach: Most sight-threatening problems after eye surgery declare themselves at
   home: increasing pain, redness and falling vision mean endophthalmitis or raised pressure until proven otherwise.
   Check: avoid discharging without a same-day emergency contact.
11_debrief.png [step.core.debrief]  Common.

B. EXTERNAL DACRYOCYSTORHINOSTOMY (RIGHT SIDE)  (folder external-dcr/)
01_consent-check.png [step.core.consent-check]  Common. Mark the side; bilateral disease is common.
02_timeout.png [step.core.timeout]  Common.
03_prophylaxis.png [step.core.prophylaxis]  Common. Antibiotic prophylaxis per local policy, especially with a history
   of dacryocystitis.
04_positioning.png [step.core.positioning]  Teach and Check: the B positioning facts exactly.
05_bloodless-field.png [step.ent.bloodless-field]  Bloodless field: head-up tilt, vasoconstrictor infiltration and the
   wait: Ask for a head-up tilt and agree with the anaesthetist on a calm, normotensive or modestly lowered blood
   pressure and heart rate, using their preferred technique. Infiltrate local anaesthetic with adrenaline in the
   correct plane: under the mucoperichondrium for the septum, into the canal skin at four quadrants and the postaural
   sulcus for the ear. Aspirate before each injection. Pack the nose with vasoconstrictor on the operative side;
   infiltrate the incision with local anaesthetic and adrenaline. Teach: Nasal and ear surgery is done through a small
   opening under magnification, where a few drops of blood hide the plane, the nerve or the flap edge. Check: avoid
   incising immediately after injection, which gives a wet field and wastes the vasoconstrictor.
06_prep-drape.png [step.core.prep-drape]  Common.
07_incision.png [step.dcr.incision]  Skin incision and exposure of the anterior lacrimal crest: Make a straight or
   gently curved incision about 10 mm medial to the medial canthus, starting at the level of the tendon and running
   down for 10 to 15 mm. Spread orbicularis bluntly, retract the angular vein laterally or medially, and expose the
   anterior lacrimal crest. Teach: The incision gives access to the lacrimal fossa while avoiding the angular vein and
   keeping a good scar. Check: avoid cutting the angular vein.
08_sac.png [step.dcr.sac]  Reflecting periosteum and the lacrimal sac: Elevate the periosteum and the sac laterally
   out of the lacrimal fossa with a rougine, back to the posterior lacrimal crest. Identify the sac and confirm it
   with a probe through the canaliculus. Teach: The sac is lifted out of its fossa so the bone behind can be removed
   without opening the sac prematurely. Check: avoid tearing the sac during elevation.
09_ostium.png [step.dcr.ostium]  Creating the bony ostium: Break into the thin lacrimal bone and enlarge the opening
   with bone punches. Extend it to about 15 mm, including the anterior lacrimal crest, keeping below the level of the
   medial canthal tendon. Teach: The ostium is the new drainage route into the nose: it needs to be large (about 15 by
   15 mm) and low enough, without going up into the skull base. Check: avoid an ostium too small to stay open.
10_flaps.png [step.dcr.flaps]  Sac and nasal mucosal flaps: Open the sac with an H-shaped or U-shaped incision guided
   by a probe, and the nasal mucosa in the same way. Suture the posterior flaps together (if feasible), then the
   anterior flaps, with fine absorbable sutures. Teach: Joining the sac lining to the nasal mucosa as a mucosa-lined
   channel is what keeps the ostium open. Check: avoid flaps under tension.
11_tubes.png [step.dcr.tubes]  Silicone intubation (when used): Pass the probes of the silicone tube through the upper
   and lower canaliculi into the ostium and out through the nose. Tie or clip the ends in the nose loosely, so they do
   not cheese-wire the punctum. Teach: Tubes support the canalicular system and the ostium in canalicular disease or a
   small sac; they are not needed in every case. Check: avoid tubes tied too tight.
12_bailout.png [step.dcr.bailout]  Bailout: an unexpected sac finding or bleeding that will not stop: If the sac
   contains a mass or looks abnormal, take a biopsy and send it; do not complete the drainage until the histology is
   known. For heavy bleeding, pack, raise the head, ask the anaesthetist about blood pressure, use bone wax or
   bipolar, and repack the nose. Teach: A stone, a tumour or uncontrolled bleeding changes the operation. Check: avoid
   completing the anastomosis over an unrecognised tumour.
13_haemostasis.png [step.core.haemostasis]  Common.
14_counts.png [step.core.counts]  Common. Count every nasal pack out as well as swabs and needles.
15_skin-closure.png [step.core.skin-closure]  Common. Close orbicularis and skin carefully; this scar is on the face.
16_debrief.png [step.core.debrief]  Common.

C. CHALAZION INCISION AND CURETTAGE (RIGHT UPPER LID)  (folder chalazion-incision-curettage/)
01_consent-check.png [step.core.consent-check]  Common. Mark the lid (upper or lower, right or left).
02_timeout.png [step.core.timeout]  Common.
03_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Topical drops, then local anaesthetic with adrenaline infiltrated
   subcutaneously and subconjunctivally around the lesion. Teach: The anaesthetic decides how still the eye is, how
   much the patient feels and which complications are possible. Check: avoid a sharp-needle block in a long myopic
   eye.
04_positioning.png [step.core.positioning]  Teach and Check: the C positioning facts exactly.
05_prep-drape.png [step.core.prep-drape]  Common.
06_clamp.png [step.chal.clamp]  Applying the chalazion clamp: Place the ring of the clamp on the conjunctival side
   around the lesion and the solid plate on the skin side. Tighten it just enough to stop bleeding and evert the lid.
   Teach: The clamp everts the lid, controls bleeding and protects the cornea, so the incision can be made accurately
   on the conjunctival side. Check: avoid over-tightening.
07_incise.png [step.chal.incise]  Vertical incision and curettage: Incise vertically through the conjunctiva and
   tarsus over the lesion, stopping 2 to 3 mm short of the lid margin. Curette out the contents in all directions, and
   excise the wall with fine scissors. Teach: A vertical incision follows the meibomian glands and spares the lid
   margin; thorough curettage and removal of the wall reduce recurrence. Check: avoid incising horizontally across the
   glands.
08_specimen.png [step.core.specimen]  Common. Send the contents and wall for histology if recurrent or atypical, and
   in older adults.
09_haemostasis.png [step.core.haemostasis]  Common. Remove the clamp and press firmly for several minutes.
10_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Antibiotic ointment and a firm pad for a few hours. Teach:
   Most sight-threatening problems after eye surgery declare themselves at home: increasing pain, redness and falling
   vision mean endophthalmitis or raised pressure until proven otherwise. Check: avoid discharging without a same-day
   emergency contact.
11_debrief.png [step.core.debrief]  Common.

D. CORNEAL AND SUBTARSAL FOREIGN BODY REMOVAL (RIGHT EYE)  (folder corneal-foreign-body-removal/)
01_consent-check.png [step.core.consent-check]  Common. Verbal consent; record the visual acuity first.
02_mechanism-check.png [step.fb.mechanism-check]  Mechanism and penetrating injury check: Ask how it happened:
   hammering metal on metal, grinding, or anything high-velocity raises suspicion of penetration. Look for a full-
   thickness wound, a positive Seidel test, an irregular pupil, a shallow chamber, hyphaema or a lens opacity. Teach:
   A tiny entry wound from a high-velocity metal fragment can hide an intraocular foreign body. Check: avoid skipping
   the mechanism history.
03_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Topical anaesthetic drops only. Teach: The anaesthetic decides how
   still the eye is, how much the patient feels and which complications are possible. Check: avoid a sharp-needle
   block in a long myopic eye.
04_positioning.png [step.core.positioning]  Teach and Check: the D positioning facts exactly.
05_evert.png [step.fb.evert]  Everting the upper lid: Ask the patient to look down; evert the upper lid over a cotton
   bud placed at the upper border of the tarsus. Sweep the tarsal conjunctiva with a moist cotton bud; double-evert
   with a retractor if the history suggests a particle high in the fornix. Teach: Subtarsal foreign bodies scratch the
   cornea with every blink and are missed if the lid is not everted. Check: avoid not everting the lid when there are
   vertical linear abrasions.
06_remove.png [step.fb.remove]  Removing the foreign body and rust ring: Try a moist cotton bud first for loose
   particles. For embedded particles, rest your hand on the patient's cheek and lift the particle out with the bevel
   of a 25G or 27G needle held tangentially to the cornea. Teach: Removal should take the foreign body and as little
   cornea as possible. Check: avoid approaching the cornea head-on.
07_fluorescein.png [step.fb.fluorescein]  Fluorescein and Seidel check after removal: Stain with fluorescein; measure
   the epithelial defect. Repeat the Seidel test over the site. Teach: Checking the defect afterwards shows its size
   for follow-up and confirms the cornea is not leaking. Check: avoid not documenting the defect size.
08_penetrating-bailout.png [step.fb.penetrating-bailout]  Bailout: a leak or signs of penetration: Stop; do not press
   on the eye or remove a protruding object. Apply a rigid shield (no pad), give anti-emetic and analgesia, keep nil
   by mouth. Teach: If the eye is open, every further manipulation can push contents out. Check: avoid padding an open
   globe with pressure.
09_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Antibiotic cover and clear return advice; eye protection
   advice for work. Teach: Most sight-threatening problems after eye surgery declare themselves at home: increasing
   pain, redness and falling vision mean endophthalmitis or raised pressure until proven otherwise. Check: avoid
   discharging without a same-day emergency contact.
10_debrief.png [step.core.debrief]  Common.

E. EVISCERATION WITH ORBITAL IMPLANT (RIGHT EYE)  (folder evisceration/)
01_consent-check.png [step.core.consent-check]  Common. Mark the eye clearly and confirm with the patient and the
   notes; check the B-scan excluding a tumour is in the notes.
02_timeout.png [step.core.timeout]  Common. Read the eye aloud twice and look at the mark: wrong-eye removal is a
   never event.
03_prophylaxis.png [step.core.prophylaxis]  Common.
04_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. General anaesthesia with a long-acting retrobulbar or peribulbar block
   for post-operative pain. Teach: The anaesthetic decides how still the eye is, how much the patient feels and which
   complications are possible. Check: avoid a sharp-needle block in a long myopic eye.
05_positioning.png [step.core.positioning]  Teach and Check: the E positioning facts exactly.
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
09_conj-peritomy.png [step.eye.conj-peritomy]  Conjunctival peritomy and Tenon's dissection: Lift the conjunctiva with
   non-toothed forceps and open it at the limbus (limbus-based or fornix-based as planned) with blunt-tipped scissors.
   Dissect Tenon's capsule from the sclera bluntly in the plane above the muscles. A 360 degree peritomy at the
   limbus, freeing Tenon's from the anterior sclera. Teach: Conjunctiva is the covering that protects a bleb, a muscle
   repair or an implant. Check: avoid toothed forceps on the conjunctival edge.
10_keratectomy.png [step.evis.keratectomy]  Removing the cornea: Enter the anterior chamber at the limbus and excise
   the cornea circumferentially. Teach: Removing the cornea gives access to the contents and allows the scleral shell
   to close without tension over the implant. Check: avoid an irregular excision that makes closure difficult.
11_contents.png [step.evis.contents]  Removing the intraocular contents completely: Separate the uvea from the sclera
   with an evisceration spoon, working round the whole circumference to the optic nerve. Lift out the contents in one
   piece where possible. Teach: Retained uveal tissue is linked to sympathetic ophthalmia in the remaining eye. Check:
   avoid leaving pigmented uveal tissue.
12_implant.png [step.evis.implant]  Sizing and placing the orbital implant: Make relaxing sclerotomies posteriorly if
   needed to fit a larger implant. Size with sizers and choose the implant that fits without tension. Teach: The
   implant replaces volume so the prosthesis sits level with the other eye. Check: avoid an oversized implant.
13_closure.png [step.evis.closure]  Closing the sclera and Tenon's: Close the sclera over the implant with absorbable
   sutures, overlapping or edge to edge without tension. Close Tenon's as a separate layer over it. Teach: Layered
   closure over the implant is the barrier against exposure and extrusion. Check: avoid closure under tension.
14_conj-closure.png [step.eye.conj-closure]  Conjunctival closure: Lay the conjunctiva back in its anatomical
   position, edges flat and not inverted. Close with fine absorbable sutures or tissue glue, anchoring to the limbus
   where needed. Close conjunctiva as a separate layer over Tenon's, without tension. Teach: A conjunctival closure
   has to cover what lies under it: a leak over a bleb drains the eye flat, and an exposed suture or implant becomes
   infected. Check: avoid a gap at the limbus that leaks.
15_specimen.png [step.core.specimen]  Common. Send the contents for histology.
16_haemostasis.png [step.core.haemostasis]  Common.
17_counts.png [step.core.counts]  Common.
18_conformer.png [step.evis.conformer]  Conformer and pressure dressing: Insert a conformer of suitable size into the
   fornices. Apply antibiotic ointment and a firm pressure dressing. Teach: The conformer holds the fornices open so a
   prosthesis can be fitted later; the pressure dressing limits swelling and bleeding. Check: avoid no conformer,
   leading to a contracted socket.
19_debrief.png [step.core.debrief]  Common.

F. STRABISMUS SURGERY: RECTUS RECESSION AND RESECTION (RIGHT EYE)  (folder strabismus-recession-resection/)
01_consent-check.png [step.core.consent-check]  Common. Mark the eye or eyes and record the plan: muscle, recession or
   resection, millimetres.
02_timeout.png [step.core.timeout]  Common. Read each muscle and amount aloud against the written plan.
03_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. General anaesthesia is usual; adults with adjustable sutures may have
   local. Teach: The anaesthetic decides how still the eye is, how much the patient feels and which complications are
   possible. Check: avoid a sharp-needle block in a long myopic eye.
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
08_forced-duction.png [step.strab.forced-duction]  Forced duction test: Grasp the conjunctiva at the limbus with
   toothed forceps and move the eye passively in each direction, pushing it slightly back into the orbit. Compare with
   the expected free movement and record any restriction. Teach: A restricted eye (thyroid, scarring, fracture)
   behaves differently from a weak muscle; the plan changes if passive movement is limited. Check: avoid skipping it
   in a patient with a restrictive history.
09_conj-peritomy.png [step.eye.conj-peritomy]  Conjunctival peritomy and Tenon's dissection: Lift the conjunctiva with
   non-toothed forceps and open it at the limbus (limbus-based or fornix-based as planned) with blunt-tipped scissors.
   Dissect Tenon's capsule from the sclera bluntly in the plane above the muscles. Limbal or fornix incision over the
   muscle to be operated. Teach: Conjunctiva is the covering that protects a bleb, a muscle repair or an implant.
   Check: avoid toothed forceps on the conjunctival edge.
10_isolate.png [step.strab.isolate]  Isolating the rectus muscle: Pass a muscle hook under the insertion from behind,
   then a second hook from the other side to confirm the entire width is engaged. Clear the intermuscular septum and
   check ligaments a short way back, staying close to the muscle. Teach: The whole muscle must be on the hook: a split
   muscle is undercorrected and may slip. Check: avoid hooking only part of the muscle.
11_secure.png [step.strab.secure]  Securing and disinserting the muscle: Place a double-armed 6-0 absorbable suture
   through the muscle near the insertion with a full-width weave and locking bites at each edge. Cut the muscle from
   the sclera close to the insertion, leaving a small stump. Teach: A secure locking suture through the muscle before
   it is cut is what stops the muscle being lost into the orbit. Check: avoid cutting before the suture is locked.
12_recess.png [step.strab.recess]  Recession: reattaching the muscle further back: Measure the recession from the
   original insertion with calipers (or use a hang-back technique). Pass each needle partial-thickness through the
   sclera, tangentially, with the bevel visible through the sclera. Teach: Moving the insertion back weakens the
   muscle by a measured amount. Check: avoid a deep needle pass.
13_resect.png [step.strab.resect]  Resection: shortening the muscle: Measure the planned length back from the
   insertion and place the locking suture there. Clamp, excise the muscle in front of the suture, and reattach to the
   original insertion stump with partial-thickness passes. Teach: Removing a measured length and reattaching at the
   original insertion strengthens the muscle. Check: avoid excising before the suture is secure.
14_oculocardiac.png [step.strab.oculocardiac]  Bailout: oculocardiac reflex: Warn the anaesthetist before traction;
   watch the heart rate. If bradycardia occurs, release traction immediately. Teach: Traction on an extraocular muscle
   can slow the heart abruptly, especially in children. Check: avoid continuing to pull through a falling heart rate.
15_lost-muscle.png [step.strab.lost-muscle]  Bailout: a slipped or lost muscle: Stop pulling; use good light and two
   assistants with retractors. Follow the capsule (the muscle's sheath) hand over hand posteriorly without grabbing
   fat. Teach: A muscle that retracts into the orbit becomes hard to find quickly; a calm, structured search through
   Tenon's usually recovers it. Check: avoid blind grabbing of orbital fat.
16_conj-closure.png [step.eye.conj-closure]  Conjunctival closure: Lay the conjunctiva back in its anatomical
   position, edges flat and not inverted. Close with fine absorbable sutures or tissue glue, anchoring to the limbus
   where needed. Teach: A conjunctival closure has to cover what lies under it: a leak over a bleb drains the eye
   flat, and an exposed suture or implant becomes infected. Check: avoid a gap at the limbus that leaks.
17_counts.png [step.core.counts]  Common.
18_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Teach: Most sight-threatening problems after eye surgery
   declare themselves at home: increasing pain, redness and falling vision mean endophthalmitis or raised pressure
   until proven otherwise. Check: avoid discharging without a same-day emergency contact.
19_debrief.png [step.core.debrief]  Common.

G. PARS PLANA VITRECTOMY FOR RETINAL DETACHMENT (RIGHT EYE)  (folder pars-plana-vitrectomy/)
01_consent-check.png [step.core.consent-check]  Common. Mark the eye; record macula on or off, which sets the urgency.
02_timeout.png [step.core.timeout]  Common. Confirm the eye, the tamponade agent and its concentration; tell the
   anaesthetist not to use nitrous oxide.
03_anaesthesia.png [step.eye.anaesthesia]  Ocular anaesthesia: topical, sub-Tenon, peribulbar or general: Agree the
   technique with the anaesthetist and the patient: topical (with or without intracameral local), sub-Tenon,
   peribulbar, retrobulbar, or general anaesthesia for children, long cases and patients who cannot lie still. Read
   the axial length before any sharp-needle block: a long myopic eye or a staphyloma raises the risk of globe
   perforation, so prefer sub-Tenon or topical. Peribulbar, sub-Tenon or general anaesthesia. Teach: The anaesthetic
   decides how still the eye is, how much the patient feels and which complications are possible. Check: avoid a
   sharp-needle block in a long myopic eye.
04_positioning.png [step.core.positioning]  Teach and Check: the G positioning facts exactly.
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
08_ports.png [step.ppv.ports]  Placing the trocar cannulas and the infusion: Insert three trocar cannulas through the
   pars plana 3.5 mm (pseudophakic) or 4 mm (phakic) behind the limbus, with an oblique tunnel. Connect the infusion
   to the inferotemporal cannula. Teach: The infusion maintains the eye's pressure throughout. Check: avoid turning on
   the infusion before seeing the tip.
09_core.png [step.ppv.core]  Core vitrectomy and posterior vitreous detachment: Remove the central vitreous with a
   high cut rate and moderate vacuum under wide-angle viewing. Induce a posterior vitreous detachment if not present
   (triamcinolone helps visualise the gel). Teach: Removing the vitreous relieves traction on the retina. Check: avoid
   high vacuum near mobile retina.
10_retina.png [step.ppv.retina]  Flattening the retina and treating the breaks: Drain subretinal fluid through a break
   or a drainage retinotomy, or flatten with perfluorocarbon liquid. Apply endolaser around every break (and 360
   degrees if planned). Teach: The retina must be flat and every break sealed with laser or cryotherapy, or it will
   detach again. Check: avoid missing a break.
11_tamponade.png [step.ppv.tamponade]  Fluid-air exchange and tamponade: Exchange fluid for air, draining residual
   subretinal fluid. Inject the tamponade: a non-expansile gas mixture (for example SF6 about 20%, C3F8 about 14%) or
   silicone oil. Teach: The gas or oil holds the retina against the wall while the laser scars mature. Check: avoid
   pure expansile gas.
12_suprachoroidal-haemorrhage.png [step.eye.suprachoroidal-haemorrhage]  Bailout: suprachoroidal haemorrhage:
   Recognise it: the red reflex darkens, the chamber shallows, the eye hardens and the iris or lens comes forward.
   Close every wound immediately with sutures, with a finger over the wound while the stitch is placed. Teach:
   Bleeding into the suprachoroidal space can push the eye contents out of an open wound within minutes. Check: avoid
   continuing the operation through a darkening red reflex.
13_wound-check.png [step.eye.wound-check]  Watertight wound and eye pressure check: Hydrate the corneal or scleral
   wound edges if needed and check that they hold when pressed gently. Paint fluorescein over the wound (Seidel test)
   or watch for a leak while pressing beside it. Remove the cannulas and check each sclerotomy for a leak; suture any
   that leak, especially with gas or oil. Teach: A leaking wound lets bacteria in and lets the eye go soft; a pressure
   that is too high hurts and can close the retinal circulation. Check: avoid leaving a soft eye with a gaping wound.
14_counts.png [step.core.counts]  Common.
15_shield-postop.png [step.eye.shield-postop]  Eye protection, drops and the warning signs: Apply a clear shield or
   pad as the operation requires; tell the patient to wear the shield at night. Prescribe the post-operative drops
   (antibiotic, steroid, others) with a written schedule. Gas wristband on, posture explained in writing, no flying or
   nitrous oxide. Teach: Most sight-threatening problems after eye surgery declare themselves at home: increasing
   pain, redness and falling vision mean endophthalmitis or raised pressure until proven otherwise. Check: avoid
   discharging without a same-day emergency contact.
16_debrief.png [step.core.debrief]  Common.

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
  surgx-intravitreal-injection-steps.zip   (folder intravitreal-injection/)
  surgx-external-dcr-steps.zip   (folder external-dcr/)
  surgx-chalazion-incision-curettage-steps.zip   (folder chalazion-incision-curettage/)
  surgx-corneal-foreign-body-removal-steps.zip   (folder corneal-foreign-body-removal/)
  surgx-evisceration-steps.zip   (folder evisceration/)
  surgx-strabismus-recession-resection-steps.zip   (folder strabismus-recession-resection/)
  surgx-pars-plana-vitrectomy-steps.zip   (folder pars-plana-vitrectomy/)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the zips as downloads.
```
