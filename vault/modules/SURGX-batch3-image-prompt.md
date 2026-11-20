---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 3: Gemini image prompt (94 images, 5 operations)

Built from [[SURGX-image-prompt]] on 2026-11-20 from the real steps in `surgx/procedures/<id>.json` and `surgx/steps/*.json`.
The operations are haemorrhoidectomy (18), tonsillectomy (15), total-knee-replacement (20), right-hemicolectomy (23,
laparoscopic) and uro-turp (18). Paste everything inside the block into one Gemini chat.

```
ROLE
You are a senior medical illustrator working with five consultant surgeons: a colorectal surgeon, an ENT surgeon,
an orthopaedic arthroplasty surgeon, a laparoscopic colorectal surgeon and a urologist. You are making 94 teaching
images for a surgical training app used by doctors and surgical trainees. One image per step:
  A. Excisional haemorrhoidectomy (Milligan-Morgan, open)   18 images
  B. Tonsillectomy (extracapsular, cold steel or bipolar)   15 images
  C. Total knee replacement (cemented, medial parapatellar) 20 images
  D. Laparoscopic right hemicolectomy (medial to lateral)   23 images
  E. Transurethral resection of the prostate (TURP)         18 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks and operative atlases, the guidance named below and
   operative videos on YouTube. For each operation study:
   A. Haemorrhoidectomy. Guidance: ASCRS haemorrhoid guideline 2024, ACPGBI. Anatomy: anal verge, anoderm, dentate
      line, anorectal ring, internal sphincter (pale, smooth, circular white fibres), external sphincter (darker,
      striated), intersphincteric groove, the three primary haemorrhoidal complexes and their vascular pedicles,
      skin bridges. Instruments: Eisenhammer or Parks bivalve anal retractor, proctoscope, artery forceps, fine
      scissors, diathermy, absorbable transfixion suture, syringe of local anaesthetic with adrenaline.
   B. Tonsillectomy. Guidance: ENT UK, NICE IPG150, the National Prospective Tonsillectomy Audit. Anatomy: palatine
      tonsil and its white capsule, anterior pillar (palatoglossus), posterior pillar (palatopharyngeus), soft palate,
      uvula, tonsillar fossa, lower pole pedicle, postnasal space. Instruments: Boyle-Davis mouth gag with tongue blade
      and Draffin rods, reinforced or preformed tube in the groove of the blade, tonsil holding forceps, Mollison
      dissector, Eves snare, bipolar forceps, headlight, suction, throat pack, tonsil swabs.
   C. Total knee replacement. Guidance: NICE NG157, British Orthopaedic Association. Anatomy: quadriceps tendon,
      patella, patellar tendon, tibial tubercle, medial and lateral femoral condyles, tibial plateau, menisci,
      cruciate ligaments, medial collateral ligament, transepicondylar axis, Whiteside line, popliteal artery behind
      the tibia. Instruments: thigh tourniquet, leg holder at 90 degrees, oscillating saw, intramedullary femoral
      rod and guide, extramedullary tibial guide, cutting blocks, spacer blocks, trial components, femoral and tibial
      metal components, polyethylene insert, patellar button, cement gun, pulsatile lavage.
   D. Laparoscopic right hemicolectomy. Guidance: ACPGBI, NCCN colon cancer, complete mesocolic excision (CME)
      literature. Anatomy: caecum, terminal ileum, ascending colon, hepatic flexure, transverse colon, ileocolic
      artery and vein, right colic vessels, right branch of the middle colic vessels, superior mesenteric vein and
      artery, gastrocolic trunk of Henle, duodenum, head of pancreas, Toldt's fascia, white line of Toldt, right
      ureter and gonadal vessels under Toldt's fascia. Instruments: 12 mm umbilical camera port, 12 mm left lower
      quadrant port, 5 mm left upper quadrant port, optional 5 mm suprapubic port, 30-degree scope, atraumatic bowel
      graspers, energy device, clips, wound protector, linear stapler.
   E. TURP. Guidance: EAU guidelines on non-neurogenic male LUTS, NICE CG97. Anatomy: penile and bulbar urethra,
      external urethral sphincter, verumontanum, prostatic urethra, lateral lobes, median lobe, bladder neck,
      trigone, both ureteric orifices, bladder dome, prostatic capsule (white circular fibres). Instruments:
      cystoscope, continuous-flow resectoscope with 30-degree lens and cutting loop, bipolar saline or monopolar
      glycine irrigation, Otis urethrotome or sounds, Ellik evacuator, three-way catheter, irrigation bags.
2. Write back a short plan: for each step, 1 to 2 lines on what the image shows, the viewpoint and the single
   teaching point. Then go on to Phase 2 without waiting for me.
3. References are ONLY for accuracy. Never copy, trace or reproduce a frame or image from any video or website.
   Every image must be newly generated.

PHASE 2: GENERATE THE IMAGES
- Use your IMAGE GENERATION MODEL (Nano Banana / Gemini image generation) for every image.
- NEVER draw with code (no SVG, HTML, canvas, Python, matplotlib, Three.js). Code is allowed ONLY at the very end,
  to put the finished images into zip files.
- Work operation by operation (A, B, C, D, E). If you cannot make all of them in one reply, work in batches and keep
  the style identical. Do not skip any image.

HOW EVERY IMAGE MUST TEACH
- ONE teaching point per image. The action of the step is the clear centre of the picture.
- Viewpoint: the surgeon's eye view of the open field (A, B, C); the real laparoscopic view with a round vignette
  (D, inside steps); the real endoscopic view through the resectoscope, a round image with the loop at the bottom
  of the circle (E, inside steps); a clean 3D cutaway when the trainee must see through a layer; a theatre view for
  team and safety steps.
- The key structure is where the eye lands first: sharp and well lit, the background slightly softened or
  desaturated. A subtle glow or outline on the key structure is fine. A small circular close-up inset is allowed
  when the key detail is tiny.
- Instruments correct in size and position, entering through the correct port, orifice or incision.
- Orientation and laterality correct and never flipped between images of the same operation:
  A. Lithotomy. The anus is seen from the surgeon's stool: the patient's ANTERIOR (scrotum) at the TOP of the frame,
     posterior (coccyx) at the bottom, the patient's LEFT on the viewer's RIGHT. The three primary piles therefore sit
     at LEFT LATERAL (viewer's right, 3 o'clock), RIGHT POSTERIOR (viewer's lower left, 7 o'clock) and RIGHT ANTERIOR
     (viewer's upper left, 11 o'clock).
  B. The surgeon sits at the patient's head looking down into the mouth through the gag: the tongue blade at the TOP
     of the frame, the soft palate and uvula at the BOTTOM with the uvula pointing UP, the patient's RIGHT tonsil on
     the viewer's RIGHT. Operate the RIGHT tonsil first.
  C. A RIGHT knee. The arthrotomy is on the MEDIAL side (the side facing the other leg); the patella is everted or
     subluxed LATERALLY (away from the other leg).
  D. The right colon is on the patient's RIGHT. The surgeon stands on the patient's LEFT and the monitor is on the
     patient's RIGHT. In the laparoscopic view the caecum and ascending colon lie on the viewer's LEFT, the midline and
     the superior mesenteric vessels towards the viewer's RIGHT, the duodenum deep (beneath the mesocolon).
  E. The endoscopic view is oriented with the patient's anterior (12 o'clock) at the TOP. The verumontanum is a small
     mound at 6 o'clock (bottom) at the distal end of the prostatic urethra.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal and realistic.
- Patients' genitals and buttocks are draped; only the operative field is exposed, never more.

PRECISE FACTS (draw exactly this; Gemini got similar facts wrong before)
Positioning (state the angle visibly; show it from the side):
- A. Lithotomy: hips flexed about 90 degrees and abducted, legs in padded stirrups, buttocks just over the end of the
  table, arms on boards no more than 90 degrees. Legs raised and lowered together.
- B. Supine, a shoulder roll, head extended on a head ring, mouth gag suspended on Draffin rods, surgeon seated at
  the head with a headlight, both arms tucked.
- C. Supine, a padded tourniquet high on the RIGHT thigh, a foot rest keeping the knee at 90 degrees of flexion, a
  lateral thigh post, the left heel and sacrum padded, arms on boards.
- D. Supine, BOTH arms tucked, padded, strapped at the chest and thighs; table head DOWN about 15 degrees and rolled
  so the patient's LEFT side is lower (right side up).
- E. Lithotomy as in A, spinal anaesthesia: the patient is AWAKE, the anaesthetist at the head, a drape over the
  abdomen, irrigation bags hanging on a stand about 60 cm above the patient.
Step-specific facts:
- A. Each excision is a V-shaped skin incision with the point OUTWARDS, dissected up off the WHITE transverse fibres
  of the internal sphincter, which stay down on the floor of the wound. The pedicle is transfixed ABOVE the dentate
  line. Three wounds at the three primary positions with generous bridges of intact skin and mucosa between them;
  the wounds are left OPEN (no skin sutures).
- B. Dissection stays ON the white capsule; the posterior pillar mucosa is preserved; the fossa is packed with a swab
  with a tail string while the other side is done.
- C. Bone cuts: distal femur cut in 5 to 7 degrees of valgus off an intramedullary rod; proximal tibia cut at 90
  degrees to the tibial mechanical axis off an extramedullary guide, with a retractor protecting the back of the
  tibia. Components: metal femoral and tibial components, a white polyethylene insert between them, a dome-shaped
  white patellar button. Cement is dough-like and off-white.
- D. Medial-to-lateral: the ileocolic pedicle tented UP by a grasper, the peritoneum opened beneath it, the plane
  developed between the mesocolon above and Toldt's fascia with the duodenum below. Central ligation: the ileocolic
  artery and vein clipped or sealed at their origin beside the superior mesenteric vein. Extraction: a short
  periumbilical midline incision with a ring wound protector; the anastomosis is an extracorporeal stapled
  side-to-side ileocolic anastomosis with a linear stapler.
- E. The resectoscope loop cuts from the bladder neck TOWARDS the verumontanum; never distal to the verumontanum.
  The capsule is white circular fibres. The ureteric orifices are small slits on the trigone, well away from the
  resection. The three-way catheter has three arms: irrigation in, drainage out and the balloon port; the drainage
  bag shows light pink fluid.
Monitors and screens: the laparoscopic and endoscopic monitors show the surgical view only, no overlay; anaesthetic
monitors show only abstract waves and grey bars.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Specimen pots, drug syringes, irrigation bags, implant
  boxes and cement packs carry BLANK white rectangles. Consent forms, checklists and notes show only grey lines.
  Screens show only abstract grey bars or plain waves. Wristbands are plain. Clock positions are NEVER written.

STYLE (identical across all 94 images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern surgical atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs (laminar-flow hoods and gowns are fine for C); neutral clean background.
- Within each operation the same adult patient, the same team and the same instrument set in every image. Staff in
  caps and masks, generic faces, no real or identifiable person. Patients covered and dignified.
- Landscape 4:3, at least 1600 x 1200 px, PNG.

THE STEPS  (filename [step id] : scene : teaching point : check)

COMMON SAFETY STEPS (draw them for each operation with that operation's patient, team and setting)
- consent-check: pre-op bay, awake patient, surgeon marking the site with an arrow (the RIGHT side where there is a
  side) while going through a consent form with grey lines. Teach: confirm identity, operation and side with the
  awake patient. Check: arrow on the correct side; form has no text.
- team-time-out: theatre, patient on the table, whole team paused and facing each other, surgeon speaking, nobody
  holding an instrument. Teach: everyone stops and confirms before the first cut.
- prophylaxis: anaesthetist giving an IV syringe (blank label) into the cannula, compression sleeves or stockings on
  both legs (only the non-operated leg for C). Teach: antibiotic before incision plus VTE prophylaxis.
- haemostasis: the operative field dry, the key vessels or wounds inspected, a swab or bipolar in view. Teach:
  inspect systematically before closing.
- counts: scrub practitioner and circulating nurse counting together beside a BLANK count board. Teach: count before
  closure; any discrepancy stops the closure.
- specimen: specimen in a pot with a BLANK white label, surgeon and scrub reading it together. Teach: label at hand-
  off, read aloud.
- skin-closure: the closed wound with a clean dressing. Teach: tension-free closure.
- debrief: surgeon writing the operation note (grey lines) and handing over to a recovery nurse. Teach: write it now
  and hand over the plan.

A. EXCISIONAL HAEMORRHOIDECTOMY  (folder haemorrhoidectomy/)
01_consent-check.png [step.core.consent-check]  Common.
02_team-time-out.png [step.core.timeout]  Common.
03_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Side view. Teach and Check: the A lithotomy facts exactly.
05_skin-prep-draping.png [step.core.prep-drape]  Perianal skin prepared, leggings and drapes leaving only the anus
   and perianal skin exposed. Teach: prepared field, dignity kept. Check: nothing else exposed.
06_local-block.png [step.ano.local-block]  Needle infiltrating the perianal skin and ischioanal space around the
   anus, aspirating; a syringe with a blank label. Teach: calculate the safe dose, infiltrate circumferentially,
   wait for the adrenaline. Check: needle not into a pile.
07_examination-under-anaesthesia.png [step.ano.eua]  Gloved finger in a digital rectal examination; inset of a
   proctoscope view of the anal canal. Teach: confirm the diagnosis before operating. Check: describe by position.
08_sphincters.png [step.ano.sphincter-identify]  3D cutaway of the anal canal: internal sphincter pale circular
   fibres, external sphincter darker striated muscle, the intersphincteric groove, dentate line and anorectal ring,
   bivalve retractor gently placed. Teach: know the two sphincters before cutting. Check: colours distinct.
09_when-to-stop.png [step.ano.when-to-stop]  The surgeon pausing with a suspicious ulcer off the midline seen through
   the retractor, biopsy forceps taking a sample. Teach: stop and biopsy when the findings change the diagnosis.
   Check: the abnormal area is clearly different from a haemorrhoid.
10_plan-excisions.png [step.hmd.plan]  Artery forceps on the external and internal parts of each of the three primary
   piles at the correct positions, pulled gently outwards; the planned skin bridges between them highlighted.
   Teach: three excisions with generous bridges. Check: positions exactly as in the orientation rules.
11_excision.png [step.hmd.excision]  One pile being dissected up from a V-shaped skin incision (point outwards) with
   scissors, the white internal sphincter fibres visible and pushed down on the floor of the wound. Teach: stay off
   the sphincter. Check: sphincter stays in the wound bed, not on the specimen.
12_pedicle-ligation.png [step.hmd.ligation]  Transfixion suture on the narrow pedicle above the dentate line, the pile
   excised distal to the tie leaving a small cuff. Teach: transfix above the dentate line, leave a cuff. Check:
   the wound below is left open.
13_haemostasis.png [step.core.haemostasis]  Common, with the three open wounds.
14_final-inspection.png [step.ano.final-inspection]  Retractor re-inserted, the three wounds and bridges inspected,
   a finger checking the calibre of the canal. Teach: check every wound and the calibre. Check: three wounds, three
   intact bridges.
15_counts.png [step.core.counts]  Common.
16_specimen-labelling.png [step.core.specimen]  Common, three haemorrhoid specimens.
17_wound-care.png [step.ano.wound-care]  A light perianal dressing, and an inset of the patient at home in a warm
   sitz bath with fibre and a stool softener (blank packs). Teach: soft stools, warm soaks, warning signs. Check: no
   tight packing.
18_debrief-handover.png [step.core.debrief]  Common.

B. TONSILLECTOMY  (folder tonsillectomy/)
01_consent-check.png [step.core.consent-check]  Common, with an adult patient (no side arrow; both tonsils).
02_indication-check.png [step.ent.preop-data-check]  The surgeon reviewing the sleep study or episode record on a
   screen (abstract bars only) in theatre before the time-out. Teach: the investigation that justifies the operation
   is on display. Check: no text.
03_team-time-out.png [step.core.timeout]  Common.
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
05_shared-airway-plan.png [step.ent.airway-share]  Surgeon and anaesthetist at the head together, a reinforced tube
   in place, a throat pack being placed and recorded on a BLANK whiteboard. Teach: agree the airway, the throat pack
   is a counted item. Check: board blank.
06_positioning.png [step.core.positioning]  Side view. Teach and Check: the B positioning facts exactly.
07_skin-prep-draping.png [step.core.prep-drape]  Head drape and eye protection (tape and pads over the eyes), face
   and mouth exposed. Teach: eyes protected. Check: both eyes covered.
08_mouth-gag.png [step.tonsil.gag]  Boyle-Davis gag open and suspended, the tube in the groove of the tongue blade,
   full view of both tonsils and the soft palate. Teach: full view, teeth protected, ventilation unchanged. Check:
   orientation exactly as in the rules.
09_capsular-dissection.png [step.tonsil.dissection]  RIGHT tonsil held medially with tonsil forceps, the anterior
   pillar incised, the white capsule exposed and the dissector in the plane; inset of the lower pole snare. Teach:
   stay on the capsule. Check: posterior pillar mucosa intact.
10_haemostasis.png [step.core.haemostasis]  Both empty fossae inspected, bipolar on a single point, fossae dry.
   Teach: point haemostasis, not wide burning. Check: minimal char.
11_pharynx-clearance.png [step.ent.pharynx-clearance]  The throat pack being removed and held up; suction in the
   oropharynx; inset of a mirror view of the postnasal space free of clot. Teach: pack out aloud, clot out. Check:
   pack visibly removed.
12_counts.png [step.core.counts]  Common, including tonsil swabs and the throat pack.
13_specimen-labelling.png [step.core.specimen]  Common, two tonsils in one pot.
14_airway-handover.png [step.ent.airway-handover]  Recovery: patient in the tonsil position (on the side, slightly
   head down), the anaesthetist handing over to the recovery nurse. Teach: bleeding risk and what bleeding looks
   like. Check: lateral position.
15_debrief-handover.png [step.core.debrief]  Common.

C. TOTAL KNEE REPLACEMENT  (folder total-knee-replacement/)
01_consent-check.png [step.core.consent-check]  Common, arrow on the RIGHT knee.
02_team-time-out.png [step.core.timeout]  Common, in a laminar-flow theatre.
03_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
04_arthroplasty-asepsis.png [step.ortho.arthroplasty-asepsis]  Laminar-flow canopy, doors shut, few people,
   surgeons in hoods double gloving, implant boxes still closed. Teach: ultraclean air, low traffic, implants opened
   late. Check: doors closed, boxes sealed.
05_positioning.png [step.core.positioning]  Side view. Teach and Check: the C positioning facts exactly.
06_tourniquet.png [step.ortho.tourniquet]  Padded pneumatic cuff high on the right thigh, protected by a plastic
   drape from the prep fluid; inset of the tourniquet machine (abstract display) and a nurse noting the time. Teach:
   apply, decide aloud, record the time. Check: cuff above the prep line.
07_skin-prep-draping.png [step.core.prep-drape]  Right leg prepared from tourniquet to toes, foot in a stockinette,
   impervious drapes, adhesive drape on the knee. Teach: whole limb prepared. Check: right leg.
08_medial-parapatellar-approach.png [step.tkr.approach]  Midline skin incision with the knee flexed, medial
   parapatellar arthrotomy, patella subluxed laterally, the patellar tendon insertion protected. Teach: medial
   arthrotomy, protect the tendon insertion. Check: arthrotomy on the medial side.
09_bone-cuts.png [step.tkr.bone-cuts]  Two-panel image: (1) distal femoral cutting block on an intramedullary rod,
   the saw cutting; (2) tibial cutting block on an extramedullary guide, a retractor behind the tibia protecting the
   popliteal artery. Teach: alignment guides, protect the back of the tibia. Check: angles exactly as in PRECISE FACTS.
10_rotation-balance.png [step.tkr.rotation-balance]  Spacer block in the extension gap and a second view in the
   flexion gap; the transepicondylar axis and Whiteside line shown as faint lines on the femur. Teach: equal,
   rectangular gaps in flexion and extension. Check: lines without text.
11_trial-reduction.png [step.ortho.trial-reduction]  Trial components in, the knee taken from full extension to deep
   flexion, the surgeon stressing varus and valgus. Teach: stability and range with the trials. Check: trial insert
   in place.
12_implant-check.png [step.ortho.implant-check]  Surgeon and scrub reading the implant boxes (blank labels) aloud
   before opening, checking size and side. Teach: confirm type, size and side aloud. Check: boxes have no text.
13_cement-implant.png [step.ortho.cement-implant]  Bone surfaces lavaged and dried; cement applied; the tibial
   component being impacted; inset of the anaesthetist confirming readiness. Teach: cement safety pause, dry bone,
   hold still while it sets. Check: excess cement being removed.
14_periprosthetic-fracture.png [step.ortho.periprosthetic-fracture]  The surgeon stopped, a fine crack visible in the
   femoral condyle, an image intensifier C-arm being brought in. Teach: stop when the feel changes, find the extent.
   Check: crack clearly visible but small.
15_patella-closure.png [step.tkr.patella-closure]  Patellar button in place tracking centrally without the thumb,
   then layered closure of the arthrotomy with the knee flexed. Teach: no-thumb tracking test, flexed closure.
   Check: patella central in the groove.
16_haemostasis.png [step.core.haemostasis]  Common, tourniquet deflated, bleeding points checked.
17_counts.png [step.core.counts]  Common.
18_skin-closure-dressing.png [step.core.skin-closure]  Common, midline knee wound.
19_neurovascular-check.png [step.ortho.nv-check]  Surgeon feeling the dorsalis pedis pulse and checking capillary
   refill and toe movement before leaving theatre. Teach: document the distal neurovascular status. Check: right
   foot.
20_debrief-handover.png [step.core.debrief]  Common.

D. LAPAROSCOPIC RIGHT HEMICOLECTOMY  (folder right-hemicolectomy/)
01_consent-check.png [step.core.consent-check]  Common, mention of stoma risk shown by a stoma site marked on the
   right abdomen as a small circle.
02_mdt-check.png [step.onco.mdt-check]  Surgeon reviewing a CT of a right colon tumour (no text) and an MDT outcome
   sheet with grey lines. Teach: the operation matches the MDT decision and the staging. Check: CT shows the colon.
03_team-time-out.png [step.core.timeout]  Common.
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Side view. Teach and Check: the D positioning facts exactly.
06_skin-prep-draping.png [step.core.prep-drape]  Whole abdomen prepared nipple line to groins. Common.
07_pneumoperitoneum.png [step.lap.access]  3D cutaway at the umbilicus: open Hasson entry with a blunt trocar, gas
   line attached. Teach: safe entry. Check: blunt trocar just inside the peritoneum.
08_port-placement.png [step.lap.ports]  Outside view: 12 mm umbilical camera, 12 mm left lower quadrant, 5 mm left
   upper quadrant, optional 5 mm suprapubic; a light transilluminating the wall. Teach: ports on the LEFT, a hand's
   breadth apart. Check: working ports on the patient's left.
09_diagnostic-laparoscopy.png [step.lap.survey]  Laparoscopic view of the liver surface (looking for metastases) and
   peritoneum; inset of the right colon tumour. Teach: survey before touching. Check: round vignette.
10_tumour-handling.png [step.onco.tumour-handling]  Graspers holding the colon by normal bowel and mesentery away from
   the tumour. Teach: no-touch, retract by normal tissue. Check: tumour not grasped.
11_medial-to-lateral.png [step.rhc.medial-to-lateral]  Ileocolic pedicle tented up, the plane opened beneath it, the
   duodenum visible deep and kept below the plane. Teach: the mesocolic plane, duodenum identified early. Check:
   facts as in PRECISE FACTS.
12_central-ligation.png [step.rhc.central-ligation]  Ileocolic artery and vein clipped at their origin beside the
   superior mesenteric vein. Teach: central vascular ligation, careful near the SMV. Check: clips at the origin, SMV
   intact.
13_hepatic-flexure.png [step.rhc.flexure]  Energy device dividing the lateral attachments along the white line and
   the hepatic flexure being released, the duodenum seen and protected. Teach: free the colon fully, avoid the
   duodenum. Check: right colon fully mobile.
14_extraction.png [step.lap.specimen-retrieval]  Short periumbilical midline incision with a ring wound protector,
   the right colon delivered through it. Teach: protect the wound, extract intact. Check: wound protector in place.
15_bowel-handling.png [step.abd.bowel-handling]  Outside the abdomen: the bowel held by its mesentery with moist
   packs, pink and perfused. Teach: handle the mesentery, check perfusion. Check: no grasp on bowel wall.
16_anastomosis.png [step.rhc.anastomosis]  Linear stapler making a side-to-side ileocolic anastomosis, ends pink,
   mesentery untwisted. Teach: well-perfused, untwisted anastomosis. Check: stapler correct type.
17_specimen-orientation.png [step.onco.specimen-orientation]  The intact specimen (terminal ileum, caecum, ascending
   colon with mesentery) laid flat with an orientation stitch at the apical vascular tie. Teach: intact, oriented
   specimen. Check: not opened.
18_haemostasis.png [step.core.haemostasis]  Common, laparoscopic view of the mesenteric bed and the vascular clips.
19_counts.png [step.core.counts]  Common.
20_specimen-labelling.png [step.core.specimen]  Common.
21_port-closure.png [step.lap.closure]  Ports removed under vision, J-needle closing the 12 mm fascia; extraction
   wound fascia closed. Teach: close every 10 mm or larger fascial defect. Check: suture in fascia.
22_skin-closure-dressing.png [step.core.skin-closure]  Common, matching the ports of image 08 and the extraction
   wound.
23_debrief-handover.png [step.core.debrief]  Common.

E. TURP  (folder uro-turp/)
01_consent-check.png [step.core.consent-check]  Common, older man, no side arrow.
02_team-time-out.png [step.core.timeout]  Common.
03_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Side view. Teach and Check: the E positioning facts exactly.
05_skin-prep-draping.png [step.core.prep-drape]  Genitalia prepared, a urology drape with an opening only for the
   penis, a fluid collection pouch below. Teach: prepared field, dignity kept. Check: nothing else exposed.
06_cystoscopy.png [step.uro.cystoscopy]  Endoscopic view of the bladder: trigone and both ureteric orifices; inset of
   the obstructing lateral lobes from the verumontanum. Teach: inspect the whole bladder before resecting. Check:
   two ureteric orifices.
07_resectoscope-setup.png [step.uro.resectoscope]  Resectoscope sheath with obturator being introduced, irrigation
   bag at a low height (blank label), the energy generator (abstract display). Teach: right fluid for the energy,
   lowest pressure, never force the sheath. Check: bag labels blank.
08_median-lobe.png [step.turp.median-lobe]  Endoscopic view: the loop resecting the median lobe at 6 o'clock towards
   the verumontanum, both ureteric orifices visible beyond the bladder neck. Teach: identify the orifices first,
   channel at 6 o'clock to the circular fibres. Check: loop direction from the bladder neck towards the verumontanum.
09_lateral-lobes.png [step.turp.lateral-lobes]  Endoscopic view: a lateral lobe being resected down to the white
   circular capsule fibres. Teach: stop at the capsule. Check: no fat visible.
10_apex.png [step.turp.apex]  Endoscopic view: short shallow strokes at the apex with the verumontanum in view at 6
   o'clock; inset view back from the bulbar urethra showing an open channel and intact sphincter. Teach: never cut
   distal to the verumontanum. Check: verumontanum intact.
11_fluid-watch.png [step.turp.fluid-watch]  The anaesthetist talking with the awake patient and checking a sodium
   result (abstract bars), the irrigation bags low. Teach: watch for TUR syndrome, keep the pressure low. Check: no
   numbers on the display.
12_chip-evacuation.png [step.uro.chip-evacuation]  Ellik evacuator attached to the sheath, prostate chips collecting
   in its chamber. Teach: evacuate all chips, re-inspect the bladder. Check: chips in the Ellik.
13_haemostasis.png [step.core.haemostasis]  Endoscopic view: the loop coagulating a single arterial bleeder in the
   resected cavity. Teach: coagulate arterial bleeders. Check: clear view.
14_perforation-check.png [step.uro.perforation-check]  Endoscopic view at low pressure of the smooth resected cavity
   with intact capsule, both orifices intact; inset of a hand feeling the lower abdomen through the drapes. Teach:
   look for perforation and extravasation. Check: no fat or black space.
15_three-way-catheter.png [step.uro.three-way-catheter]  Three-way catheter in place with irrigation running, the
   drainage bag light pink. Teach: free drainage before inflating the balloon, light pink return. Check: three arms
   as in PRECISE FACTS.
16_counts.png [step.core.counts]  Common.
17_specimen-labelling.png [step.core.specimen]  Common, prostate chips in a pot.
18_debrief-handover.png [step.core.debrief]  Common, including the irrigation plan handed to the nurse.

QUALITY CHECK (for EVERY image before moving to the next)
- Orientation and laterality correct for that operation (see the rules above)?
- Anatomy, instrument, port or incision and position correct for this step?
- Every PRECISE FACT that applies to this image drawn exactly?
- The teaching point is the first thing the eye lands on?
- Zero text, numbers, labels, logos or watermarks, including boards, labels, packs and screens?
- Same style, patient and team as the earlier images of that operation?
If any answer is no, regenerate that image before continuing.

DELIVERY
Make FIVE zip files, one per operation, with the PNGs named exactly as above:
  surgx-haemorrhoidectomy-steps.zip       (18 images)
  surgx-tonsillectomy-steps.zip           (15 images)
  surgx-total-knee-replacement-steps.zip  (20 images)
  surgx-right-hemicolectomy-steps.zip     (23 images)
  surgx-uro-turp-steps.zip                (18 images)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the five zips as downloads.
```

## Round 2: redo prompt (TURP 09)

```
One image from the 94 is wrong. Regenerate ONLY this one, in exactly the same style as the other TURP endoscopic
views (round vignette, black surround, 12 o'clock at the top), with the IMAGE GENERATION MODEL (never code).

uro-turp/09_lateral-lobes.png
- Endoscopic view through clear irrigation fluid inside the prostatic urethra, after the median lobe channel is cut.
- The LEFT lateral lobe (viewer's right) being shaved: the resectoscope loop drawing a chip from proximal to distal.
- Adenoma tissue is PINK-WHITE and granular, like the prostate in images 06 and 08. NOT yellow, NOT orange, NOT
  fatty. A curled pink chip lifting off the loop.
- Where the resection is complete, the floor shows the glistening WHITE capsule: fine parallel CIRCULAR fibres
  running around the channel. No yellow fat, no dark gaps, no black space anywhere.
- A few small red bleeding points only; the view stays clear.
- Teach: shave the adenoma down to the white circular fibres and stop there. Check: zero yellow anywhere.
No text, numbers or labels. Landscape 4:3, 1600 x 1200 px, PNG, same filename. Zip: surgx-batch3-fix.zip
```

## Round 2b: redo prompt (tonsillectomy 04 and 09)

```
Two more images are wrong. Regenerate ONLY these two, same style, patient and team as the other tonsillectomy
images, with the IMAGE GENERATION MODEL (never code).

1. tonsillectomy/04_antibiotic-thromboprophylaxis.png
   - Theatre, the adult patient asleep on the table, seen from the patient's side at the level of the chest.
   - The patient's arm runs continuously from the SHOULDER out onto an arm board beside the CHEST (never near the
     legs); a cannula taped on the back of that hand with an injection port.
   - The anaesthetist connects a syringe with a blank white label to the cannula PORT (needle-free, Luer connector)
     and pushes the drug. No needle into the skin.
   - Both lower legs in white compression sleeves with tubing to a pump, visible further along the table.
   - Teach: antibiotic only if indicated, VTE prophylaxis by risk. Check: the arm is attached to the body.

2. tonsillectomy/09_capsular-dissection.png
   - Surgeon's view through a Boyle-Davis gag: the curved tongue blade presses the tongue down; the reinforced
     breathing tube lies INSIDE the groove of the tongue blade, in the MIDLINE, under the blade. It must NOT cross the
     open pharynx or the uvula.
   - The uvula hangs free in the middle. The patient's RIGHT tonsil is on the viewer's LEFT.
   - That RIGHT tonsil (viewer's left) is pulled MEDIALLY with tonsil-holding forceps; the anterior pillar mucosa is
     incised; the dissector sits in the plane between the pale-white tonsil CAPSULE and the muscle of the fossa,
     with the white capsule clearly visible. The posterior pillar mucosa is intact. Bleeding minimal.
   - The left tonsil (viewer's right) untouched. No swab on any tonsil.
   - Small inset (circle): the snare closing around the LOWER pole of the tonsil.
   - Teach: stay on the capsule. Check: tube in the blade groove, right tonsil being dissected, capsule plane visible.

No text, numbers or labels. Landscape 4:3, 1600 x 1200 px, PNG, same filenames.
Put both (plus uro-turp/09_lateral-lobes.png if not already sent) in one zip: surgx-batch3-fix.zip
```
