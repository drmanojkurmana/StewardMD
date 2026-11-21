---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 4: Gemini image prompt (93 images, 5 operations)

Built 2026-11-21 from the real steps in `surgx/procedures/<id>.json`, the batch 3 prompt ([[SURGX-batch3-image-prompt]])
and every fault Gemini made in batches 2 and 3 (generic flat-table positioning, yellow "fat" prostate, a hand detached
from the arm, a tube crossing the open throat, a face-on mouth view). The operations are laparotomy (19),
modified-radical-mastectomy (18), total-hip-replacement (22), total-abdominal-hysterectomy (22) and
chest-drain-insertion (12). Paste everything inside the block into ONE NEW Gemini chat.

```
ROLE
You are a senior medical illustrator working with five consultant surgeons: an emergency general surgeon, a breast
surgeon, an orthopaedic hip surgeon, a gynaecologist and a thoracic surgeon. You are making 93 teaching images for a
surgical training app used by doctors and surgical trainees. One image per step:
  A. Exploratory laparotomy (midline)                          19 images
  B. Modified radical mastectomy (RIGHT breast)                18 images
  C. Total hip replacement, posterior approach (RIGHT hip)     22 images
  D. Total abdominal hysterectomy (Pfannenstiel)               22 images
  E. Intercostal chest drain insertion (RIGHT side, awake)     12 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks and operative atlases, the guidance named below and
   operative videos. For each operation study:
   A. Exploratory laparotomy. Guidance: ASGBI/RCS emergency laparotomy (NELA), WSES, European Hernia Society
      guideline on abdominal wall closure (small bites). Anatomy: skin, subcutaneous fat, linea alba, preperitoneal
      fat, peritoneum, falciform ligament, liver, gallbladder, stomach, duodenum, spleen, small bowel from the
      duodenojejunal flexure to the ileocaecal valve, colon, rectum, pelvis, both paracolic gutters, mesentery.
      Instruments: scalpel, diathermy, two artery forceps to tent the peritoneum, Balfour or Bookwalter
      self-retaining retractor, large moist abdominal packs, Yankauer and pool suction, warm saline jug,
      continuous looped slowly absorbable suture (PDS), skin staples, tube drain, stoma appliance.
   B. Modified radical mastectomy. Guidance: ABS (Association of Breast Surgery), NICE NG101, ASCO/NCCN. Anatomy:
      breast with the nipple-areola complex, the superficial fascia plane between subcutaneous fat and breast
      tissue (the mastectomy plane), pectoralis major and its fascia, pectoralis minor, clavipectoral fascia,
      internal mammary perforators near the sternum, latissimus dorsi, serratus anterior, axillary vein, long
      thoracic nerve (on serratus, chest-wall side), thoracodorsal nerve and vessels (to latissimus),
      intercostobrachial nerve (crossing the axilla), level I and level II nodes. Instruments: scalpel, diathermy,
      skin hooks or flap retractors, Langenbeck and Deaver retractors, clips, two closed suction drains,
      orientation sutures.
   C. Total hip replacement, posterior (Southern/Moore) approach. Guidance: NICE TA304 and NG157 principles, BOA,
      National Joint Registry. Anatomy: greater and lesser trochanters, gluteus maximus and its fascia lata,
      short external rotators (piriformis, gemelli, obturator internus), quadratus femoris, sciatic nerve running
      behind them, posterior capsule, femoral head and neck, acetabulum with its transverse acetabular ligament and
      the cotyloid fossa, femoral canal. Instruments: lateral positioner with front and back pelvic supports,
      oscillating saw, Hohmann retractors, acetabular reamers, acetabular cup with an introducer and alignment
      guide, box chisel, femoral broaches (rasps), trial neck and head, cement gun with pressuriser, femoral stem,
      ceramic or metal head, image intensifier (C-arm).
   D. Total abdominal hysterectomy. Guidance: RCOG, NICE NG88 (heavy menstrual bleeding), ACOG. Anatomy: uterus,
      cervix, fallopian tubes, ovaries, round ligaments, broad ligament (anterior and posterior leaves),
      infundibulopelvic ligament with the ovarian vessels, utero-ovarian ligament, vesicouterine fold, bladder,
      uterine artery and vein at the level of the internal os, ureter passing UNDER the uterine artery about 2 cm
      lateral to the cervix ("water under the bridge") and crossing the iliac bifurcation at the pelvic brim,
      cardinal and uterosacral ligaments, vaginal vault, rectum and pouch of Douglas. Instruments: Pfannenstiel
      incision, self-retaining retractor (Balfour or Alexis), large moist packs, straight and curved clamps
      (Kocher, Zeppelin or Heaney), long scissors, absorbable ligatures, swab weighing scale, suction canister.
   E. Intercostal chest drain insertion. Guidance: British Thoracic Society pleural disease guideline 2023,
      ATLS. Anatomy: the "safe triangle" bounded by the anterior border of latissimus dorsi, the lateral border
      of pectoralis major, a horizontal line at the level of the nipple (5th intercostal space) and an apex below
      the axilla; ribs, intercostal muscles, the neurovascular bundle running in the groove on the LOWER border of
      each rib, parietal pleura, lung, diaphragm. Instruments: ultrasound probe, skin marker, syringe and needle with
      local anaesthetic, Seldinger kit (introducer needle, guidewire, dilator, 12 French drain), scalpel, curved
      Spencer Wells or Roberts forceps, large-bore drain WITHOUT a trocar, strong non-absorbable suture,
      transparent dressing, underwater seal bottle.
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
- Viewpoint: the surgeon's eye view of the open field for operative steps; a clean 3D cutaway when the trainee must
  see through a layer (abdominal wall layers, rib and intercostal space); a pure SIDE VIEW for every positioning
  step; a theatre view for team and safety steps. Step A9 alone is a laparoscopic view with a round vignette.
- The key structure is where the eye lands first: sharp and well lit, the background slightly softened or
  desaturated. A subtle glow or outline on the key structure is fine. A small circular close-up inset is allowed
  when the key detail is tiny.
- Instruments correct in size and position, entering through the correct incision.
- Orientation and laterality correct and never flipped between images of the same operation:
  A. Patient supine, head at the TOP of the frame for all field views; the midline incision runs top to bottom.
  B. RIGHT breast. Patient supine, head at the TOP of the frame, the RIGHT arm out to the viewer's LEFT on an arm
     board, so the axilla is on the viewer's LEFT; the sternum towards the viewer's RIGHT.
  C. RIGHT hip, patient in the LEFT lateral decubitus position (lying on the left side, right side up). Field views
     look down on the right buttock and thigh: the patient's HEAD towards the TOP of the frame, the patient's BACK
     towards the viewer's LEFT (posterior), the front of the thigh towards the viewer's RIGHT. The sciatic nerve is
     therefore on the viewer's LEFT, behind the short rotators.
  D. Patient supine, the surgeon on the patient's LEFT; field views with the patient's HEAD at the TOP of the frame
     and the pubic symphysis and bladder at the BOTTOM; the patient's RIGHT on the viewer's LEFT.
  E. RIGHT hemithorax. The patient sits up at 45 degrees, the RIGHT arm raised behind the head, so the right lateral
     chest wall faces the viewer; the patient's HEAD towards the TOP of the frame, the FRONT of the chest towards the
     viewer's RIGHT, the back towards the viewer's LEFT.
- BODIES MUST BE WHOLE AND CONNECTED. Every hand belongs to an arm that runs to a shoulder of a visible body; every
  patient limb is continuous with the patient. Never draw a hand or arm floating near the legs or on the wrong side.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal and realistic. Fat is yellow ONLY where real fat is (subcutaneous fat,
  omentum, mesentery, axillary fat, preperitoneal fat); muscle is red-brown; fascia and capsule are white.
- Patients' genitals and breasts not being operated on are draped; only the operative field is exposed, never more.

PRECISE FACTS (draw exactly this; Gemini got similar facts wrong before)
Positioning (state the angle visibly; draw a NEW pure side view at table height; never reuse a generic theatre scene):
- A. Supine, flat, both arms out on padded arm boards at NO MORE than 90 degrees, a safety strap across the thighs,
  heels padded, warming blanket over the chest and legs, urinary catheter bag hanging below the table.
- B. Supine, the RIGHT arm abducted to 90 degrees (not more) on a padded arm board, a small folded sheet under the
  right shoulder blade, the table tilted slightly away (left side down) so the right chest wall is presented.
- C. LEFT lateral decubitus, pelvis exactly vertical (perpendicular to the floor), held by a padded support against
  the pubic symphysis in front and one against the sacrum behind, an axillary roll under the down-side chest wall,
  a pillow between the knees, the left (down) leg slightly flexed and padded at the fibular head.
- D. Supine with 10 to 15 degrees head DOWN (Trendelenburg), both arms out on boards, legs flat (or in low Lloyd-
  Davies only if drawn very clearly), urinary catheter in place.
- E. Sitting up at 45 degrees on a trolley, the RIGHT arm raised with the hand behind the head, the right lateral
  chest wall exposed, patient AWAKE and comfortable, a nurse beside them.
Step-specific facts:
- A. Midline incision through skin, fat and the white linea alba; the peritoneum lifted between two artery forceps and
  opened with a knife under direct vision. Exploration in a fixed sequence (liver, stomach, spleen, small bowel from
  the duodenojejunal flexure, colon, pelvis). Bowel handled with the whole hand and moist packs, holding the
  mesentery. Mass closure: continuous looped slowly absorbable suture, SMALL BITES 5 mm from the edge and 5 mm apart
  in the linea alba only (no fat, no muscle). An end stoma (colostomy) in the left iliac fossa through the rectus
  muscle, away from the umbilicus, the costal margin, the belt line and scars, pink and well perfused, mucocutaneous
  sutures. A drain through a separate stab wound in clean skin, never through the main wound.
- B. Ellipse oriented obliquely towards the axilla, including the nipple-areola complex and the biopsy site. Flaps
  raised in the plane between subcutaneous fat and breast tissue, flap thickness about 5 to 8 mm, uniform, held up by
  skin hooks under tension. Breast lifted off pectoralis major WITH its fascia, from medial to lateral; the internal
  mammary perforators near the sternal edge clipped. Axilla: the axillary vein at the top as the upper limit; the
  long thoracic nerve running vertically down the chest wall on serratus anterior (preserved); the thoracodorsal
  nerve and vessels running down to latissimus dorsi (preserved); the intercostobrachial nerve crossing the axilla.
  Two closed suction drains, one under the flaps and one in the axilla, through separate stab incisions.
- C. Incision centred on the posterior third of the greater trochanter, curving towards the posterior superior iliac
  spine. Gluteus maximus split in line with its fibres. Short external rotators detached from the trochanter and
  tagged with stay sutures, then reflected BACKWARDS over the sciatic nerve to protect it. Dislocation by flexion,
  adduction and internal rotation. Neck cut with an oscillating saw at the planned level above the lesser
  trochanter. Acetabulum reamed concentrically to bleeding subchondral bone. Cup at about 40 degrees of inclination
  and 15 to 20 degrees of anteversion. Femur prepared with the knee flexed and the tibia VERTICAL, box chisel then
  broaches of increasing size. Cement is dough-like and off-white. Components: a metal cup or a cup with a white
  polyethylene liner, a polished metal stem, a ceramic (white) or metal ball head.
- D. Pfannenstiel: a curved transverse incision two fingers' breadth above the symphysis, rectus sheath opened
  transversely, recti separated in the midline. Straight clamps at each cornu for traction. The round ligament
  divided between clamps and the broad ligament opened. The ureter seen through the posterior leaf of the broad
  ligament, crossing the iliac bifurcation at the pelvic brim. Uterine vessels clamped PERPENDICULAR to the uterus at
  the level of the internal os, close to the uterus; the ureter runs UNDER the uterine artery about 2 cm lateral.
  The bladder pushed down off the cervix in the midline avascular plane before the lower pedicles are taken.
  Cardinal and uterosacral pedicles taken in small bites, each just medial to the last. The vault closed with
  angle sutures.
- E. The safe triangle drawn as a faint outline on the skin (no text): anterior border of latissimus dorsi behind,
  lateral border of pectoralis major in front, a horizontal line at nipple level below, apex below the axilla. The
  needle and every instrument go over the UPPER border of the rib below the space (the neurovascular bundle is on the
  LOWER border of the rib above). Large-bore technique: skin incision parallel to the rib, blunt spreading with
  curved forceps, a gloved finger sweeping inside the pleura, the drain placed without a trocar. Seldinger
  technique: needle, guidewire, dilator, 12 French drain over the wire. Underwater seal bottle on the floor BELOW
  the chest, the tube end submerged about 2 to 3 cm, fluid swinging in the tube.
Monitors and screens: the laparoscopic monitor (A9) shows the surgical view only, no overlay; anaesthetic monitors
and the ultrasound show only abstract waves and grey bars.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Specimen pots, drug syringes, implant boxes, cement packs and
  drain bottles carry BLANK white rectangles. Consent forms, checklists, notes and the MDT sheet show only grey lines.
  Screens show only abstract grey bars or plain waves. Wristbands are plain. Angles are NEVER written; show them by
  the drawing itself.

STYLE (identical across all 93 images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern surgical atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs (laminar-flow hoods and gowns are fine for C); neutral clean background.
- Within each operation the same adult patient, the same team and the same instrument set in every image. Staff in
  caps and masks, generic faces, no real or identifiable person. Patients covered and dignified.
- Landscape 4:3, exactly 1600 x 1200 px, PNG.

THE STEPS  (filename [step id] : scene : teaching point : check)

COMMON SAFETY STEPS (draw them for each operation with that operation's patient, team and setting)
- consent-check: pre-op bay, awake patient, surgeon marking the site with an arrow (the RIGHT side where there is a
  side) while going through a consent form with grey lines. Teach: confirm identity, operation and side with the
  awake patient. Check: arrow on the correct side; form has no text.
- team-time-out: theatre, patient on the table, whole team paused and facing each other, surgeon speaking, nobody
  holding an instrument. Teach: everyone stops and confirms before the first cut.
- prophylaxis: the patient's arm runs from the shoulder onto an arm board beside the CHEST; the anaesthetist connects
  a syringe (blank label) to the cannula PORT (needle-free, no needle into the skin); compression sleeves on both legs
  (only the non-operated leg for C). Teach: antibiotic before incision plus VTE prophylaxis. Check: arm attached.
- prep-drape: the operative area painted with antiseptic from the incision outwards, widely, then drapes leaving only
  the field. Teach: prepare widely, let it dry before drapes and diathermy.
- haemostasis: the operative field dry, the key vessels or pedicles inspected, a swab or bipolar in view. Teach:
  inspect systematically before closing.
- counts: scrub practitioner and circulating nurse counting together beside a BLANK count board. Teach: count before
  closure; any discrepancy stops the closure.
- specimen: specimen in a pot with a BLANK white label, surgeon and scrub reading it together. Teach: label at hand-
  off, read aloud.
- skin-closure: the closed wound with a clean dressing. Teach: tension-free closure.
- debrief: surgeon writing the operation note (grey lines) and handing over to a recovery nurse. Teach: write it now
  and hand over the plan.

A. EXPLORATORY LAPAROTOMY  (folder laparotomy/)
01_consent-check.png [step.core.consent-check]  Common, emergency setting: an unwell adult on a trolley, no side
   arrow (midline); a relative present. 
02_team-time-out.png [step.core.timeout]  Common, emergency theatre.
03_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
04_positioning.png [step.core.positioning]  Side view. Teach and Check: the A positioning facts exactly.
05_skin-prep-draping.png [step.core.prep-drape]  Common: whole abdomen nipple line to mid-thigh, flanks included.
06_midline-incision.png [step.abd.midline]  3D cutaway of the abdominal wall at the umbilicus: skin, yellow fat, the
   WHITE linea alba split in the midline, the peritoneum lifted between two artery forceps and nicked with a blade,
   bowel safely below. Teach: stay in the midline, open the peritoneum under direct vision. Check: no bowel under the
   blade.
07_systematic-exploration.png [step.abd.exploration]  Surgeon's view of the open abdomen with a self-retaining
   retractor; a gloved hand examining the liver; a small inset showing the fixed route as a faint dotted path over a
   simple abdominal silhouette (liver, stomach, spleen, small bowel, colon, pelvis), no numbers. Teach: same sequence
   every time. Check: no text.
08_bowel-handling.png [step.abd.bowel-handling]  A loop of small bowel held in both whole hands on moist packs, held
   by its mesentery; a pink, peristalsing segment beside a dusky one; inset of a pulsating mesenteric arcade. Teach:
   handle with the whole hand, assess colour, peristalsis and pulsation. Check: no instrument grasping the bowel wall.
09_diagnostic-laparoscopy.png [step.lap.survey]  Laparoscopic view (round vignette) of the right upper quadrant: liver
   surface and gallbladder, a grasper lifting the edge of the liver, free fluid in the right paracolic gutter. Teach:
   survey before touching the target. Check: round vignette.
10_damage-control-decision.png [step.lapa.damage-control]  Theatre: the open abdomen packed around the liver with
   large packs, a temporary closure (negative-pressure dressing) being applied; the anaesthetist at the head with
   blood products hanging (blank labels) and an abstract monitor; the surgeon and anaesthetist talking. Teach: decide
   on physiology, control bleeding and contamination, close temporarily. Check: no numbers on the monitor.
11_peritoneal-toilet.png [step.abd.lavage]  Warm saline poured from a jug into the pelvis while a pool sucker
   aspirates it; clear fluid. Teach: wash out all four quadrants and the pelvis, aspirate completely. Check: no fluid
   left pooling.
12_stoma-formation.png [step.abd.stoma]  End colostomy matured in the left iliac fossa through the rectus muscle,
   pink, spouted slightly, mucocutaneous sutures; a faint outline of the umbilicus, costal margin and belt line well
   away. Teach: site it where the patient can see and care for it, tension-free and perfused. Check: away from the
   umbilicus and scars.
13_drain-placement.png [step.abd.drain]  A tube drain brought out through a separate stab wound in clean skin of the
   right flank, secured with a suture, the main midline wound separate. Teach: separate stab, secure, record it.
   Check: drain not through the main wound.
14_haemostasis.png [step.core.haemostasis]  Common, with the open abdomen and packs removed.
15_counts.png [step.core.counts]  Common, including the large abdominal packs.
16_specimen-labelling.png [step.core.specimen]  Common, a resected bowel segment in a large pot.
17_mass-closure.png [step.abd.mass-closure]  Close-up of the linea alba being closed with a continuous looped suture,
   SMALL BITES 5 mm from the edge and 5 mm apart, only the white fascia in each bite; inset of the suture length beside
   the wound length (the suture about four times longer). Teach: small bites, at least 4 to 1 suture to wound length.
   Check: no fat or muscle in the bites.
18_skin-closure-dressing.png [step.core.skin-closure]  Common, midline wound with skin staples and a dressing.
19_debrief-handover.png [step.core.debrief]  Common, handover to critical care (a critical care bed, not recovery).

B. MODIFIED RADICAL MASTECTOMY  (folder modified-radical-mastectomy/)
01_consent-check.png [step.core.consent-check]  Common, an adult woman, arrow on the RIGHT breast; the patient's chest
   covered by a gown except a small area by the arrow.
02_mdt-check.png [step.onco.mdt-check]  Surgeon reviewing a mammogram of the right breast on a light box or screen
   (no text) and an MDT outcome sheet with grey lines. Teach: the operation matches the MDT decision, side and extent.
   Check: images show a breast, no text.
03_team-time-out.png [step.core.timeout]  Common.
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Side view. Teach and Check: the B positioning facts exactly.
06_skin-prep-draping.png [step.core.prep-drape]  Common: right chest wall, axilla and upper arm prepared; the right
   arm wrapped in a sterile stockinette so it can be moved.
07_incision-flaps.png [step.mrm.incision-flaps]  The oblique ellipse around the nipple-areola complex cut; the upper
   skin flap lifted with skin hooks and dissected in the plane between the subcutaneous fat and the breast tissue,
   uniform thickness; inset cross-section showing skin, a thin layer of fat on the flap, the plane, then the breast.
   Teach: raise even flaps in the mastectomy plane. Check: flap neither paper-thin nor thick.
08_pectoral-fascia.png [step.mrm.pectoral]  The breast being lifted off pectoralis major WITH its white fascia, from
   medial to lateral; a clip on an internal mammary perforator at the sternal edge. Teach: take the fascia, control
   the perforators. Check: muscle left bare and intact.
09_tumour-handling.png [step.onco.tumour-handling]  The specimen held and retracted by its normal edges with gauze,
   the tumour area untouched, wound edges protected with moist packs. Teach: no-touch, retract by normal tissue.
   Check: no instrument on the tumour.
10_axilla-entry.png [step.onco.axilla-entry]  The lateral border of pectoralis major retracted; the clavipectoral
   fascia opened just behind it, exposing yellow axillary fat. Teach: enter the axilla through the clavipectoral
   fascia. Check: on the viewer's LEFT (right axilla).
11_axillary-clearance.png [step.mrm.axillary-clearance]  The cleared axilla: the axillary vein across the top; the
   long thoracic nerve running down the chest wall on serratus anterior; the thoracodorsal nerve and vessels running
   down to latissimus dorsi; pectoralis minor retracted; nerves gently highlighted. Teach: clear levels I and II,
   preserve both nerves, keep below the vein. Check: both nerves clearly visible and intact.
12_specimen-orientation.png [step.onco.specimen-orientation]  The mastectomy specimen with the axillary tail laid flat
   on a green towel, a short suture at the superior edge and a long suture at the lateral (axillary) edge. Teach:
   orient with the agreed convention before it leaves the field. Check: two different suture lengths, no text.
13_haemostasis.png [step.core.haemostasis]  Common, the chest wall and axilla with the perforator clips.
14_drains.png [step.mrm.drains]  Two closed suction drains, one under the flaps and one in the axilla, each brought out
   through its own stab incision low on the lateral chest wall and secured. Teach: drain the dead space through
   separate stabs. Check: two drains, two stabs.
15_counts.png [step.core.counts]  Common.
16_specimen-labelling.png [step.core.specimen]  Common, the mastectomy specimen in a large pot, RIGHT side.
17_skin-closure-dressing.png [step.core.skin-closure]  Common, the oblique wound closed flat without dog-ears.
18_debrief-handover.png [step.core.debrief]  Common.

C. TOTAL HIP REPLACEMENT, POSTERIOR APPROACH  (folder total-hip-replacement/)
01_consent-check.png [step.core.consent-check]  Common, arrow on the RIGHT hip.
02_team-time-out.png [step.core.timeout]  Common, in a laminar-flow theatre, the patient already in the lateral
   position.
03_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common (sleeve on the LEFT leg only).
04_arthroplasty-asepsis.png [step.ortho.arthroplasty-asepsis]  Laminar-flow canopy, doors shut, few people, surgeons
   in hoods double gloving, implant boxes still sealed. Teach: ultraclean air, low traffic, implants opened late.
   Check: doors closed, boxes sealed.
05_positioning.png [step.core.positioning]  Side view from the FRONT of the table (looking at the patient's front).
   Teach and Check: the C positioning facts exactly.
06_skin-prep-draping.png [step.core.prep-drape]  Common: right buttock and whole right leg prepared to the foot, the
   foot in a stockinette, impervious drapes, adhesive drape over the hip.
07_posterior-approach.png [step.ortho.posterior-hip-approach]  The gluteus maximus split; the short external rotators
   detached from the trochanter, tagged with stay sutures and reflected backwards (viewer's LEFT) over the sciatic
   nerve, which is seen as a white cord beneath them; the posterior capsule opened. Teach: reflect the rotators back
   to protect the sciatic nerve. Check: nerve on the viewer's left, protected.
08_neck-osteotomy.png [step.ortho.neck-osteotomy]  The hip dislocated by flexion, adduction and internal rotation (the
   knee pointing towards the floor, the leg over the front of the table); the femoral head out of the socket; the saw
   cutting the neck at the planned level above the lesser trochanter. Teach: dislocate gently, cut at the planned
   level. Check: cut above the lesser trochanter.
09_acetabular-reaming.png [step.thr.acetabulum-prep]  Retractors around the acetabulum (anterior, posterior over the
   reflected rotators, inferior at the transverse ligament); a hemispherical reamer in the socket; the floor showing
   red bleeding subchondral bone. Teach: ream concentrically to bleeding bone. Check: reamer centred in the socket.
10_cup-orientation.png [step.thr.cup]  The cup being impacted with an introducer whose alignment guide shows the angle
   in the drawing (about 40 degrees of inclination and 15 to 20 degrees of anteversion), inset of a pelvis model with
   the cup orientation shown by a faint line. Teach: aim for the planned inclination and anteversion. Check: no
   numbers written.
11_femoral-broaching.png [step.ortho.femoral-canal-prep]  The leg flexed, adducted and internally rotated with the
   tibia VERTICAL; a broach (rasp) being driven down the femoral canal. Teach: tibia vertical shows femoral version;
   increase broach size stepwise. Check: tibia vertical.
12_trial-reduction.png [step.ortho.trial-reduction]  Trial head and neck reduced; the surgeon flexing and internally
   rotating the hip to test posterior stability; inset comparing the two knees side by side for leg length. Teach:
   test stability and length with the trials. Check: trial components in place.
13_implant-check.png [step.ortho.implant-check]  Surgeon and scrub reading the stem, cup and head boxes (blank labels)
   aloud before opening. Teach: confirm type, size and side aloud. Check: no text.
14_cement-implant.png [step.ortho.cement-implant]  The femoral canal being filled retrograde with off-white dough
   cement from a cement gun; inset of the anaesthetist confirming readiness at the head. Teach: cement safety pause,
   then pressurise. Check: canal filled from the bottom up.
15_final-reduction.png [step.ortho.hip-final-reduction]  The definitive head impacted on the clean taper and the hip
   reduced with traction; the head seated in the cup. Teach: clean the taper, reduce, re-check stability. Check: no
   soft tissue in the joint.
16_periprosthetic-fracture.png [step.ortho.periprosthetic-fracture]  The surgeon stopped, a fine crack visible running
   down the calcar of the proximal femur; a C-arm image intensifier being brought in. Teach: stop when the feel
   changes, find the extent. Check: crack small but clear.
17_posterior-repair.png [step.ortho.posterior-repair]  The capsular and rotator stay sutures passed through drill holes
   in the greater trochanter and tied, closing the posterior soft tissues over the joint. Teach: repair the posterior
   capsule and rotators to cut dislocation risk. Check: sutures through bone.
18_haemostasis.png [step.core.haemostasis]  Common.
19_counts.png [step.core.counts]  Common.
20_skin-closure-dressing.png [step.core.skin-closure]  Common, the curved posterior hip wound.
21_neurovascular-check.png [step.ortho.nv-check]  Patient now supine, the surgeon feeling the dorsalis pedis pulse and
   asking the patient (or checking with a pin) for foot dorsiflexion; an abduction pillow between the legs. Teach:
   check the sciatic and common peroneal nerves and pulses before leaving theatre. Check: RIGHT foot.
22_debrief-handover.png [step.core.debrief]  Common.

D. TOTAL ABDOMINAL HYSTERECTOMY  (folder total-abdominal-hysterectomy/)
01_consent-check.png [step.core.consent-check]  Common, an adult woman, no side arrow; the form shows grey lines and a
   small drawing of a uterus and both ovaries.
02_team-time-out.png [step.core.timeout]  Common.
03_preop-check.png [step.obg.preop-check]  A nurse showing the surgeon a negative pregnancy test (a single control line
   only) and the blood results on a screen (abstract bars). Teach: confirm pregnancy status and the work-up on the day.
   Check: no text.
04_antibiotic-thromboprophylaxis.png [step.core.prophylaxis]  Common.
05_positioning.png [step.core.positioning]  Side view. Teach and Check: the D positioning facts exactly.
06_skin-prep-draping.png [step.core.prep-drape]  Common: lower abdomen and upper thighs prepared, catheter in place.
07_pfannenstiel.png [step.obg.pfannenstiel]  3D cutaway of the lower abdominal wall: the curved transverse skin
   incision two fingers above the symphysis, the rectus sheath opened transversely, the two recti separated in the
   midline, the peritoneum opened vertically high up, away from the bladder. Teach: open high, away from the bladder.
   Check: bladder shown low and safe.
08_systematic-exploration.png [step.abd.exploration]  Through the incision with a self-retaining retractor, a gloved
   hand palpating the upper abdomen (liver edge) before the bowel is packed away; the enlarged fibroid uterus in view.
   Teach: explore before you operate. Check: bowel not yet packed.
09_round-ligament.png [step.tah.round-ligament]  Straight clamps on both cornua lifting the uterus; the RIGHT round
   ligament (viewer's LEFT) divided between clamps; the anterior leaf of the broad ligament opened. Teach: traction,
   divide the round ligament, open the broad ligament. Check: clamps close to the uterus.
10_ureter-identification.png [step.obg.ureter-identification]  The posterior leaf of the broad ligament opened; the
   ureter visible crossing the iliac bifurcation at the pelvic brim, beneath the infundibulopelvic ligament, gently
   highlighted; inset showing it peristalsing (a subtle wave). Teach: see the ureter before taking pelvic pedicles.
   Check: ureter clearly separate from the ovarian vessels.
11_adnexal-pedicle.png [step.tah.adnexal-pedicle]  Ovaries conserved: a clamp across the tube and utero-ovarian
   ligament close to the uterus; the healthy ovary left behind. Teach: decide conserve or remove; clamp close to the
   uterus when conserving. Check: ovary outside the clamp.
12_bladder-reflection.png [step.tah.bladder]  The vesicouterine peritoneum incised transversely and the bladder pushed
   down off the cervix in the midline with a swab on a stick, showing the white avascular plane. Teach: push the
   bladder down before the lower pedicles. Check: plane in the midline.
13_uterine-vessels.png [step.tah.uterine-vessels]  A curved clamp placed PERPENDICULAR to the uterus at the level of
   the internal os, hugging the uterus; a cutaway inset showing the ureter running UNDER the uterine artery about
   2 cm lateral. Teach: clamp close to the uterus, the ureter is just lateral and below. Check: ureter not in the
   clamp.
14_cervix-vault.png [step.tah.cervix-vault]  The uterus removed; the vaginal vault held with clamps at the angles and
   being closed with a continuous suture; the uterosacral ligaments attached to the vault angles. Teach: small bites
   medial to the last, secure the angles, close the vault. Check: angle sutures in place.
15_bailout.png [step.tah.bailout]  The surgeon paused, a dense adhesion of bladder to the cervix seen; a second
   consultant arriving to scrub; inset showing the planned subtotal level (cervix left) as a faint line. Teach: when
   the plane is lost, stop, call for help, consider subtotal. Check: no text.
16_haemostasis.png [step.core.haemostasis]  Common, the pelvic pedicles and vault inspected.
17_blood-loss.png [step.obg.blood-loss]  A nurse weighing used swabs on a scale and reading the suction canister (blank
   labels, abstract display), announcing to the anaesthetist. Teach: measure, say it aloud, agree the next step.
   Check: no numbers.
18_specimen-labelling.png [step.core.specimen]  Common, the uterus and cervix in a large pot.
19_counts.png [step.core.counts]  Common, including vaginal swabs if used.
20_transverse-closure.png [step.obg.transverse-closure]  The rectus sheath being closed transversely with a continuous
   suture starting beyond each angle. Teach: include the angles, continuous delayed-absorbable suture. Check: both
   angles included.
21_skin-closure-dressing.png [step.core.skin-closure]  Common, a subcuticular Pfannenstiel wound.
22_debrief-handover.png [step.core.debrief]  Common.

E. INTERCOSTAL CHEST DRAIN INSERTION  (folder chest-drain-insertion/)
01_consent-check.png [step.core.consent-check]  Common, on the ward or emergency bay, an arrow on the RIGHT side of the
   chest.
02_team-time-out.png [step.core.timeout]  A procedure room or ward bay: doctor, nurse and the awake patient pausing
   together before starting; the ultrasound machine beside the bed.
03_positioning.png [step.core.positioning]  Side view. Teach and Check: the E positioning facts exactly.
04_safe-triangle-ultrasound.png [step.cd.site]  The RIGHT lateral chest wall with the safe triangle outlined faintly on
   the skin (latissimus dorsi behind, pectoralis major in front, nipple level below, apex below the axilla); an
   ultrasound probe on the chest; the site marked with a small cross. Teach: use the safe triangle, confirm with
   ultrasound. Check: site inside the triangle; no text.
05_skin-prep-draping.png [step.core.prep-drape]  Common: the right lateral chest prepared and a fenestrated drape over
   the safe triangle.
06_local-anaesthesia.png [step.cd.anaesthesia]  3D cutaway through the chest wall: the needle passing just OVER THE
   UPPER BORDER of the rib, infiltrating down to the parietal pleura; the syringe aspirating air or fluid; the
   neurovascular bundle on the LOWER border of the rib above, highlighted and untouched. Teach: go over the top of the
   rib, aspirate to confirm. Check: bundle avoided.
07_seldinger.png [step.cd.seldinger]  Small-bore drain over a guidewire: the wire in the pleural space, the dilator
   passed, the 12 French drain being advanced over the wire, the operator holding the wire throughout. Teach: never
   let go of the wire. Check: wire end held.
08_blunt-dissection.png [step.cd.blunt]  Large-bore technique: an incision parallel to the rib; curved forceps
   spreading over the top of the rib; a gloved finger inside the pleura sweeping; the drain without a trocar alongside.
   Teach: blunt dissection and a finger sweep, never a trocar. Check: no trocar.
09_secure-seal.png [step.cd.secure]  The drain stitched to the skin, a transparent dressing, a tape tag (omental tag)
   holding the tube; the tube running down to an underwater seal bottle on the floor below the chest, its end
   submerged about 2 to 3 cm. Teach: secure it, bottle below the chest, tube under water. Check: bottle below the chest.
10_counts.png [step.core.counts]  A nurse counting the procedure-pack items and sharps into a sharps bin with the
   doctor; a small blank count sheet. Teach: account for every sharp and the guidewire.
11_confirm-position.png [step.cd.confirm]  The water in the tube swinging with breathing and bubbling in the bottle;
   inset of a chest X-ray (no text) with the drain tip in the right pleural space and the lung re-expanding. Teach:
   swinging, bubbling or draining, then an X-ray. Check: drain on the RIGHT.
12_debrief-handover.png [step.core.debrief]  Doctor handing over to the ward nurse at the bedside: drain observations
   chart (grey lines), the bottle visible, the patient comfortable. Teach: hand over what to watch and when to call.

QUALITY CHECK (for EVERY image, at FULL SIZE, before moving to the next)
- Orientation and laterality correct for that operation (see the rules above)?
- Every hand, arm and leg attached to a body, on the correct side?
- Anatomy, instrument, incision and position correct for this step?
- Every PRECISE FACT that applies to this image drawn exactly?
- Fat yellow only where real fat is; fascia and capsule white?
- The teaching point is the first thing the eye lands on?
- Zero text, numbers, labels, logos or watermarks, including boards, labels, packs and screens?
- Same style, patient and team as the earlier images of that operation?
If any answer is no, regenerate that image before continuing.

DELIVERY
Make FIVE zip files, one per operation, with the PNGs named exactly as above:
  surgx-laparotomy-steps.zip                     (19 images)
  surgx-modified-radical-mastectomy-steps.zip    (18 images)
  surgx-total-hip-replacement-steps.zip          (22 images)
  surgx-total-abdominal-hysterectomy-steps.zip   (22 images)
  surgx-chest-drain-insertion-steps.zip          (12 images)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the five zips as downloads.
```

## Round 2: redo prompt (5 images)

```
Five of the 93 images are wrong. Regenerate ONLY these five, with the IMAGE GENERATION MODEL (never code), in exactly
the same style, patient and team as the rest of their operation. Draw each one NEW; do not edit the earlier image.

1. modified-radical-mastectomy/05_positioning.png
   - View from the FOOT of the table, looking up the table at table height, so the arm angle is obvious.
   - Patient supine; the RIGHT arm (viewer's LEFT) out on a padded arm board at EXACTLY 90 degrees to the body,
     straight out sideways, palm up, the arm board at right angles to the table. NOT along the side.
   - A small folded sheet under the right shoulder blade lifting the right chest slightly; the left arm at the side.
   - Teach: arm out at 90 degrees and no more, to open the axilla without stretching the brachial plexus.
     Check: the right angle between arm and body is the first thing the eye sees.

2. total-hip-replacement/12_trial-reduction.png
   - Same LEFT lateral decubitus patient and posterior wound as images 07 to 11 (patient's head to the TOP of the frame,
     back to the viewer's LEFT). Inside the wound: a trial femoral neck and head seated in the acetabular cup; only the
     parts visible through a real incision (no loose or whole pelvis bone, no bone held in the hand).
   - The assistant holds the leg below the knee and has flexed the hip to 90 degrees with internal rotation to test
     posterior stability; the head stays in the cup.
   - Small inset: both knees side by side at the same level (leg length check).
   - Teach: test stability and length with the trials before choosing implants. Check: anatomy looks like a real wound.

3. total-hip-replacement/16_periprosthetic-fracture.png
   - Same LEFT lateral decubitus patient as images 05 to 15 (lying on the left side, right hip up), NOT on the back.
   - Close-up of the wound: the broach handle stopped in the femoral canal; a clear, thin, dark crack running a few
     centimetres DOWN the medial calcar of the proximal femur, gently highlighted so it is obvious.
   - In the background, a radiographer bringing a C-arm image intensifier towards the hip.
   - Teach: stop when the feel or sound changes, find the full extent. Check: crack clearly visible; patient lateral.

4. total-abdominal-hysterectomy/05_positioning.png
   - Pure side view at table height, the floor line drawn.
   - The WHOLE table top (one straight line from head to foot) tilted 10 to 15 degrees HEAD DOWN (Trendelenburg):
     the head end clearly lower than the foot end. Do NOT bend the table or raise only the leg section.
   - Patient supine, legs flat, both arms out on boards, a shoulder support at the top of the table, a urinary
     catheter bag hanging below the table.
   - Teach: head down lets the bowel fall out of the pelvis. Check: the whole table slopes, head lowest.

5. chest-drain-insertion/09_secure-seal.png
   - Same patient as images 03 to 08: sitting up at 45 degrees, the drain in the RIGHT lateral chest wall.
     Draw him from his RIGHT side so the right chest faces the viewer (his face turned towards the viewer's RIGHT,
     exactly as in image 04). The drain must NOT be on the left side.
   - The drain stitched to the skin, a transparent dressing, a tape tag holding the tube; the tube running down to an
     underwater seal bottle on the floor BELOW the chest, its end submerged about 2 to 3 cm.
   - Teach: secure it, bottle below the chest, tube under water. Check: right side; bottle below the chest.

No text, numbers or labels. Landscape 4:3, 1600 x 1200 px, PNG, same filenames, each in its operation's folder.
Put all five in ONE zip: surgx-batch4-fix.zip
```

## Round 3: redo prompt (2 images)

Round 2 result: mastectomy 05, hip 16 (cropped to the wound close-up; the wide view drew the femur and crack on the
skin of the buttock) and chest drain 09 wired. Hip 12 still shows the femur as a short stub ending in mid-air and no
visible 90 degree flexion; hysterectomy 05 has the whole table tilted correctly but the lower legs float above the leg
section.

```
Two images are still wrong. Regenerate ONLY these two with the IMAGE GENERATION MODEL (never code), same style,
patient and team as the rest of their operation. Draw each one NEW.

1. total-hip-replacement/12_trial-reduction.png
   - Wide view from the patient's BACK: the patient lying on the LEFT side (right hip up), head to the viewer's LEFT.
   - The assistant holds the RIGHT knee and lower leg and has bent the hip to a clear RIGHT ANGLE (thigh pointing
     straight forwards, away from the viewer, knee bent), with the lower leg turned so the foot swings UP towards
     the ceiling (internal rotation).
   - In the wound only: the metal trial head sitting inside the cup, its neck running into the femur, and the femur
     CONTINUING out of sight under the muscle down the thigh. No bone end, no stub, no bone visible outside the wound.
   - Keep the small inset of both knees side by side at the same level.
   - Teach: test stability in flexion and internal rotation, and leg length, with the trials. Check: right angle at
     the hip is obvious; femur continuous.

2. total-abdominal-hysterectomy/05_positioning.png
   - Same as before: pure side view, floor line, the WHOLE table top in one straight line tilted 10 to 15 degrees
     head DOWN, shoulder support, catheter bag below the table.
   - The legs lie FLAT ON the leg section along their whole length, heels resting on a gel pad. No gap between the
     legs and the table anywhere.
   - Both arms out on arm boards. A drape over the patient from chest to knees.
   - Teach: head down lets the bowel fall out of the pelvis. Check: legs touching the table; the whole table slopes.

No text, numbers or labels. Landscape 4:3, 1600 x 1200 px, PNG, same filenames, each inside a folder with the
operation's name. Put both in ONE zip: surgx-batch4-fix2.zip
```
