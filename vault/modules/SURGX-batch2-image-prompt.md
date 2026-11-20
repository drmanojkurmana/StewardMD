---
tags: [surgx, media, prompt, gemini]
---
# SURGX batch 2: Gemini image prompt (70 images, 4 operations)

Built from [[SURGX-image-prompt]] on 2026-11-20, using the real steps in `surgx/procedures/<id>.json` and `surgx/steps/*.json`.
The operations are lap-cholecystectomy (19), hernia-repair (14, open Lichtenstein), lscs (18) and total-thyroidectomy (19).
Paste everything inside the block into one Gemini chat.

```
ROLE
You are a senior medical illustrator working with four consultant surgeons: a general surgeon, a hernia surgeon,
an obstetrician and an endocrine surgeon. You are making 70 teaching images for a surgical training app used by
doctors and surgical trainees. The images cover FOUR operations, one image per step:
  A. Laparoscopic cholecystectomy          19 images
  B. Open inguinal hernia repair (Lichtenstein mesh)  14 images
  C. Lower segment caesarean section (LSCS)            18 images
  D. Total thyroidectomy                   19 images
GOAL: a trainee who looks at an image for 3 seconds understands exactly what is done in that step and why.
Correctness and clarity come first, beauty second. The quality must be the best you can produce.

PHASE 1: UNDERSTAND EACH OPERATION FIRST (before generating any image)
1. Research each operation in depth from surgical textbooks and operative atlases, the guidelines named below and
   operative videos on YouTube. For each operation study:
   A. Lap chole. Guidance: SAGES Safe Cholecystectomy and the Tokyo Guidelines 2018. Anatomy: liver, gallbladder
      (fundus, body, infundibulum/Hartmann's pouch), cystic duct, cystic artery, common hepatic duct, common bile
      duct, hepatocystic (Calot) triangle, cystic plate, Rouviere's sulcus, duodenum, falciform ligament.
      Instruments: 10 mm umbilical camera port, 10 mm epigastric port, two 5 mm right subcostal ports, 30-degree
      scope, Veress needle or Hasson trocar, atraumatic graspers, Maryland dissector, hook diathermy, clip applier
      with titanium or polymer clips, laparoscopic scissors, retrieval bag.
   B. Lichtenstein. Guidance: HerniaSurge International Guidelines 2018. Anatomy: inguinal ligament, pubic
      tubercle, anterior superior iliac spine, external oblique aponeurosis, superficial and deep rings, spermatic
      cord, cremaster, ilioinguinal nerve, iliohypogastric nerve, genital branch of the genitofemoral nerve,
      indirect sac (lateral to the inferior epigastric vessels), direct defect (Hesselbach triangle), conjoint
      tendon/internal oblique, shelving edge, rectus sheath. Instruments: scalpel, self-retaining retractor,
      Penrose/rubber sling, flat polypropylene mesh about 7.5 x 15 cm, polypropylene suture, needle holder.
   C. LSCS. Guidance: NICE NG192 Caesarean birth and RCOG. Anatomy: Joel-Cohen incision, rectus sheath, rectus
      muscles, parietal peritoneum, bladder, uterovesical fold, lower uterine segment, round ligaments, uterine
      angles, fetal head, placenta, tubes and ovaries. Instruments: Doyen retractor, Green-Armytage clamps,
      cord clamps, absorbable suture on a large round-bodied needle, swabs, suction, scales for swabs.
   D. Total thyroidectomy. Guidance: British Association of Endocrine and Thyroid Surgeons and the International
      Neural Monitoring Study Group. Anatomy: platysma, anterior jugular veins, strap muscles (sternohyoid,
      sternothyroid), thyroid lobes and isthmus, superior pole vessels, external branch of the superior laryngeal
      nerve, cricothyroid muscle, inferior thyroid artery, recurrent laryngeal nerve, tracheo-oesophageal groove,
      tubercle of Zuckerkandl, ligament of Berry, upper and lower parathyroid glands, vagus nerve in the carotid
      sheath, trachea. Instruments: nerve-monitoring endotracheal tube with surface electrodes at the vocal cords,
      handheld stimulating probe, fine bipolar diathermy, fine ties, small retractors, loupes.
2. Write back a short plan: for each step, 1 to 2 lines on what the image shows, the viewpoint and the single
   teaching point. Then go on to Phase 2 without waiting for me.
3. References are ONLY for accuracy. Never copy, trace or reproduce a frame or image from any video or website.
   Every image must be newly generated.

PHASE 2: GENERATE THE IMAGES
- Use your IMAGE GENERATION MODEL (Nano Banana / Gemini image generation) for every image.
- NEVER draw with code (no SVG, HTML, canvas, Python, matplotlib, Three.js). Code is allowed ONLY at the very end,
  to put the finished images into zip files.
- Work operation by operation (A, then B, C, D). If you cannot make all of them in one reply, work in batches and
  keep the style identical. Do not skip any image.

HOW EVERY IMAGE MUST TEACH
- ONE teaching point per image. The action of the step is the clear centre of the picture.
- Viewpoint: the real laparoscopic camera view (round vignette, 30-degree scope look) for steps inside the abdomen
  in operation A; the surgeon's eye view of the open field for the open steps in B, C and D; a clean 3D cutaway when
  the trainee must see through a layer; a theatre view for team and safety steps.
- The key structure is where the eye lands first: sharp and well lit, the background slightly softened or
  desaturated. A subtle glow or outline on the key structure is fine. A small circular close-up inset is allowed
  when the key detail is tiny (a nerve, a clip, a parathyroid).
- Instruments correct in size and position, entering through the correct port or incision.
- Laterality correct and never flipped between images of the same operation:
  A. The gallbladder is on the patient's RIGHT. In the laparoscopic view (camera at the umbilicus looking towards the
     head) the liver is at the TOP, the gallbladder hangs below it on the viewer's LEFT half, the duodenum is at the
     bottom, and the common bile duct runs on the viewer's RIGHT of the gallbladder neck.
  B. A RIGHT inguinal hernia in an adult man. In the open field seen from above with the patient's head at the top of
     the frame, the operative groin is on the viewer's LEFT, the pubic tubercle points towards the midline (viewer's
     right), the deep ring is lateral (viewer's left).
  C. The open field is seen from above with the mother's head at the TOP of the frame: the bladder is at the bottom
     (towards her feet), the uterine fundus at the top.
  D. The neck is seen from above with the chin at the TOP of the frame and the sternal notch at the bottom. Operate the patient's RIGHT lobe
     first; in that view the patient's right is on the viewer's LEFT.
- Uncluttered: nothing that does not serve the teaching point.
- Tissue realistic, not gory; blood minimal and realistic.

PRECISE FACTS (draw exactly this; Gemini got similar facts wrong before)
Positioning (state the angle visibly, show it from the side):
- A. Lap chole: table head UP by 15 to 20 degrees (reverse Trendelenburg) AND rolled so the patient's LEFT side is
  lower (right side up). BOTH arms tucked at the sides, padded. Safety strap across the thighs, heels padded.
- B. Lichtenstein: supine, table flat or head down by about 10 degrees. One arm out on an arm board at no more than
  90 degrees, the other tucked. Strap across the thighs.
- C. LSCS: supine with a 15-degree LEFT lateral tilt (a wedge under the RIGHT hip) so the uterus falls off the
  vena cava. Both arms out on padded boards at no more than 90 degrees. Spinal anaesthesia: the mother is AWAKE, a
  low screen across her chest, the anaesthetist at her head. Pregnant abdomen at term.
- D. Thyroid: supine, a shoulder roll under BOTH shoulders, neck extended, head on a soft ring, table head up by
  about 15 degrees. BOTH arms tucked at the sides. The nerve-monitoring tube is in the mouth with its cable going to
  the anaesthetist.
Ligatures, clips and knots:
- Clips (A): the cystic duct and cystic artery each get TWO clips on the patient side and ONE on the gallbladder
  side, and are divided between them. Clips sit at right angles across the structure, fully across it, the tips of
  the clip applier visible beyond it. Never clip anything before the Critical View is shown.
- Mesh (B): a flat rectangular polypropylene mesh with rounded medial corner, overlapping the pubic tubercle by 2 cm,
  lower edge sutured with a continuous polypropylene suture to the shelving edge of the inguinal ligament, upper edge
  to the internal oblique, the lateral end split into two tails that wrap round the cord and cross to make a new deep
  ring. Laid with a slight dome, not stretched flat.
- Uterine closure (C): two layers, continuous, absorbable suture, both angles secured first with a stitch beyond
  each angle.
- Thyroid (D): superior pole vessels tied individually close to the capsule, never one mass tie.
Step-specific facts:
- A. Critical View of Safety = three things together: the hepatocystic triangle cleared of fat and fibrous tissue,
  the lower third of the gallbladder lifted off the cystic plate (liver visible behind), and exactly TWO structures
  (cystic duct and cystic artery) entering the gallbladder. Retraction: fundus pushed UP over the liver, infundibulum
  pulled LATERALLY (viewer's left) and DOWN, never up.
- B. The three nerves: ilioinguinal on the cord, iliohypogastric under the external oblique above the cord, genital
  branch of the genitofemoral with the cord. Show them as fine yellow-white cords.
- C. The uterine incision is TRANSVERSE in the lower segment, below the reflected bladder, with a curve slightly
  upward at each end. The baby's head is delivered by the surgeon's hand cupped under it, with fundal pressure from
  the assistant. Baby generic, healthy colour, no identifiable face.
- D. The recurrent laryngeal nerve runs UP in the tracheo-oesophageal groove, close to the inferior thyroid artery,
  and enters the larynx under the ligament of Berry. Parathyroids are small (5 mm) caramel-brown ovals, NOT the
  same colour as thyroid. The handheld stimulating probe touches the nerve; a separate monitor shows only a wave.
Monitors and screens: the laparoscopy monitor shows the surgical view only, no overlay; the nerve-monitor screen
shows ONLY an abstract wave on a dark background, no numbers.

NO TEXT ANYWHERE (generated text comes out garbled)
- No letters, numbers, words, labels, logos or watermarks in any image.
- Count boards are BLANK whiteboards with an empty grid. Specimen pots and drug labels carry BLANK white rectangles.
  Consent forms and checklists show only grey lines. Screens show only abstract grey bars or a plain wave.
  Wristbands are plain.

STYLE (identical across all 70 images)
- Premium 3D medical illustration, semi-realistic, the quality of a modern surgical atlas.
- Soft, even clinical lighting; sharp focus; natural tissue colour.
- Operating-theatre green drapes and scrubs; neutral clean background.
- Within each operation the same adult patient, the same team and the same instrument set in every image.
  Staff in caps and masks, generic faces, no real or identifiable person. Patients covered and dignified; only the
  operative field exposed.
- Landscape 4:3, at least 1600 x 1200 px, PNG.

THE STEPS  (filename : scene : teaching point : check)

A. LAPAROSCOPIC CHOLECYSTECTOMY  (folder lap-cholecystectomy/)
01_consent-check.png  [step.core.consent-check]
   Scene: pre-op bay, awake adult patient on a trolley; the surgeon draws an arrow on the right upper abdomen while
   reading a consent form (grey lines only) with the patient. Teach: confirm identity, operation and site with the
   awake patient. Check: arrow on the patient's right upper abdomen; form has no text.
02_team-time-out.png  [step.core.timeout]
   Scene: theatre, patient anaesthetised and draped, whole team paused around the table facing each other, the
   surgeon speaking. Teach: everyone stops and confirms before incision. Check: nobody holding an instrument.
03_antibiotic-thromboprophylaxis.png  [step.core.prophylaxis]
   Scene: anaesthetist giving an IV syringe into the cannula, calf compression sleeves on both legs. Teach: antibiotic
   within the hour before incision plus VTE prophylaxis. Check: syringe label blank; both legs have sleeves.
04_positioning.png  [step.core.positioning]
   Scene: side view of the whole table. Teach and Check: the A positioning facts exactly (15 to 20 degrees head UP,
   left side lower, both arms tucked, strap, pads).
05_skin-prep-draping.png  [step.core.prep-drape]
   Scene: whole abdomen painted from nipples to groins and flank to flank, drapes leaving it all exposed. Teach:
   prepare wide enough to convert to open. Check: the field includes the right subcostal region and umbilicus.
06_pneumoperitoneum.png  [step.lap.access]
   Scene: 3D cutaway at the umbilicus: open (Hasson) entry through the fascia with a blunt trocar entering the
   peritoneal cavity, gas line attached, the bowel falling away below. Teach: safe entry; open entry when in doubt.
   Check: trocar tip blunt and just inside the peritoneum, not near bowel.
07_port-placement.png  [step.lap.ports]
   Scene: outside view of the inflated abdomen with four ports: 10 mm umbilical (camera), 10 mm epigastric, 5 mm
   right midclavicular subcostal, 5 mm right anterior axillary; a light behind the wall transilluminating vessels.
   Teach: ports a hand's breadth apart, placed under vision. Check: exactly four ports in those positions.
08_diagnostic-laparoscopy.png  [step.lap.survey]
   Scene: laparoscopic view sweeping the abdomen: liver, gallbladder, stomach, bowel, all quadrants (inset of pelvis).
   Teach: look everywhere before touching the target. Check: round scope vignette.
09_retraction.png  [step.chole.retraction]
   Scene: laparoscopic view; one grasper pushes the fundus UP over the liver, a second pulls Hartmann's pouch
   LATERALLY and DOWN, opening the hepatocystic triangle; small arrows show the directions. Teach: fundus up,
   infundibulum lateral. Check: infundibulum pulled to the viewer's left and down, never up.
10_critical-view-of-safety.png  [step.chole.cvs]
   Scene: laparoscopic view of a perfectly cleared triangle; exactly two structures (cystic duct lower, cystic artery
   upper) entering the gallbladder; lower third of the gallbladder off the liver with the liver seen through the
   window. Teach: the three criteria of the Critical View. Check: two and only two structures; no clips yet.
11_clip-divide.png  [step.chole.divide]
   Scene: laparoscopic view: cystic duct with two clips on the patient side and one on the gallbladder side,
   scissors dividing between them; the cystic artery already clipped the same way. Teach: clip and divide only after
   the Critical View. Check: clip count and position exactly as in PRECISE FACTS.
12_gallbladder-off-plate.png  [step.chole.plate]
   Scene: laparoscopic view: hook diathermy in the areolar plane between gallbladder and liver bed, gallbladder lifted
   for counter-traction, clips visible below. Teach: stay in the plane, check the bed and clips before the last
   attachment. Check: the liver capsule is intact.
13_specimen-retrieval.png  [step.lap.specimen-retrieval]
   Scene: laparoscopic view: gallbladder going into an open retrieval bag; small inset outside showing the bag
   coming out through the umbilical port. Teach: bag, then extraction through the largest port. Check: bag fully
   encloses the gallbladder.
14_haemostasis.png  [step.core.haemostasis]
   Scene: laparoscopic view of the empty gallbladder bed and clipped stumps, irrigation-suction probe in place, the
   bed dry. Teach: inspect systematically, including after releasing retraction. Check: no active bleeding.
15_counts.png  [step.core.counts]
   Scene: scrub practitioner and circulating nurse counting swabs together beside a BLANK count board. Teach: count
   before closure. Check: board blank, no marks.
16_specimen-labelling.png  [step.core.specimen]
   Scene: gallbladder in a specimen pot with a BLANK white label; scrub practitioner and surgeon checking it together.
   Teach: label at hand-off, read aloud. Check: label blank.
17_port-closure.png  [step.lap.closure]
   Scene: 3D cutaway at the umbilicus: J-needle closing the 10 mm fascial defect; inset of ports removed under
   vision. Teach: close fascia of every 10 mm port, desufflate fully. Check: suture is in the fascia, not skin.
18_skin-closure-dressing.png  [step.core.skin-closure]
   Scene: four small closed port wounds with clean dressings in the right positions. Teach: tension-free closure.
   Check: four wounds matching image 07.
19_debrief-handover.png  [step.core.debrief]
   Scene: surgeon writing the operation note (grey lines only) and handing over to a recovery nurse. Teach: write
   it now and hand over the plan. Check: no readable text.

B. OPEN INGUINAL HERNIA REPAIR, LICHTENSTEIN  (folder hernia-repair/)
01_consent-check.png  [step.core.consent-check]
   Scene: awake adult man; surgeon marks an arrow on the RIGHT groin. Teach: side confirmed with the awake patient.
   Check: arrow on the RIGHT groin.
02_team-time-out.png  [step.core.timeout]  Scene, teach, check as A02 with this patient.
03_antibiotic-thromboprophylaxis.png  [step.core.prophylaxis]  Scene, teach, check as A03 with this patient.
04_positioning.png  [step.core.positioning]
   Scene: side view of the table. Teach and Check: the B positioning facts exactly.
05_skin-prep-draping.png  [step.core.prep-drape]
   Scene: right groin and lower abdomen prepared from umbilicus to upper thigh, scrotum covered, drapes framing the
   field. Teach: wide prep, dry before draping. Check: right side.
06_incision-canal.png  [step.hern.incision]
   Scene: surgeon's view: oblique incision 2 cm above and parallel to the medial two thirds of the inguinal ligament;
   the external oblique aponeurosis opened along its fibres from the superficial ring, the ilioinguinal nerve visible
   just beneath. Teach: open along the fibres, protect the nerve beneath. Check: incision line runs parallel to the
   ligament, from pubic tubercle laterally.
07_cord-nerves.png  [step.hern.cord]
   Scene: cord lifted in a rubber sling at the pubic tubercle; the three nerves highlighted; floor of the canal
   visible. Teach: sling the cord, identify and preserve all three nerves. Check: three nerves in correct relation.
08_sac.png  [step.hern.sac]
   Scene: indirect sac separated from the cord up to the deep ring, being transfixed at its neck; inset of a direct
   sac being invaginated. Teach: high dissection of the indirect sac; invert a direct one. Check: sac lateral to the
   inferior epigastric vessels.
09_mesh.png  [step.hern.mesh]
   Scene: mesh in place exactly as in PRECISE FACTS: medial corner over the pubic tubercle, lower edge sutured to the
   shelving edge, tails crossed round the cord lateral to the deep ring, slight dome. Teach: overlap, fixation, new
   deep ring. Check: suture not into periosteum; femoral vessels not touched.
10_haemostasis.png  [step.core.haemostasis]
   Scene: field with the mesh in place, fine bipolar on a small vessel, the field dry. Teach: check before closing.
   Check: no pooling blood.
11_counts.png  [step.core.counts]  Scene, teach, check as A15.
12_specimen-labelling.png  [step.core.specimen]
   Scene: excised sac in a pot with a BLANK label, the surgeon and scrub checking it. Teach: record every specimen,
   including none sent. Check: label blank.
13_skin-closure-dressing.png  [step.core.skin-closure]
   Scene: external oblique closed over the cord, then subcuticular skin closure and a clean dressing on the right
   groin. Teach: layered tension-free closure. Check: right side.
14_debrief-handover.png  [step.core.debrief]  Scene, teach, check as A19 with this patient.

C. LOWER SEGMENT CAESAREAN SECTION  (folder lscs/)
01_consent-check.png  [step.core.consent-check]
   Scene: awake pregnant woman at term, the obstetrician going through a consent form (grey lines) with her and her
   partner. Teach: consent and identity with the awake woman. Check: no text on the form.
02_team-time-out.png  [step.core.timeout]
   Scene: theatre time-out including the midwife and the neonatal team beside a ready resuscitaire. Teach: whole team
   including neonatal team. Check: resuscitaire visible.
03_antibiotic-thromboprophylaxis.png  [step.core.prophylaxis]
   Scene: anaesthetist giving IV antibiotic before skin incision; compression stockings on both legs. Teach:
   antibiotic BEFORE incision, not after cord clamping. Check: blank syringe label.
04_positioning.png  [step.core.positioning]
   Scene: view from the foot of the table. Teach and Check: the C positioning facts exactly (15-degree left tilt,
   wedge under the RIGHT hip, arms out on boards, awake mother, low screen).
05_skin-prep-draping.png  [step.core.prep-drape]
   Scene: abdomen prepared, urinary catheter in place, drapes leaving the lower abdomen exposed. Teach: catheter and
   wide prep. Check: catheter tubing visible.
06_joel-cohen-entry.png  [step.cs.entry]
   Scene: 3D cutaway: straight transverse skin incision 3 cm above the symphysis, layers opened bluntly, fingers
   stretching the rectus apart, peritoneum opened high away from the bladder. Teach: blunt layered entry, open
   peritoneum high. Check: bladder shown low and safe.
07_uterine-incision.png  [step.cs.uterine-incision]
   Scene: Doyen retractor holding the bladder down, uterovesical fold reflected, short transverse incision in the
   lower segment with membranes bulging, fingers extending it bluntly sideways. Teach: transverse lower segment,
   blunt extension. Check: incision below the reflected bladder fold, not on the upper segment.
08_delivery-of-baby.png  [step.cs.delivery]
   Scene: surgeon's hand cupped under the fetal head, flexing and lifting it through the incision; assistant's hand
   pressing on the fundus. Teach: hand under the head plus fundal pressure. Check: hand below the head, not pulling
   the neck.
09_placenta-uterotonic.png  [step.cs.placenta]
   Scene: placenta delivered by controlled cord traction; inset of the anaesthetist giving the uterotonic; the
   uterus firm. Teach: uterotonic, then complete placenta and empty cavity. Check: syringe label blank.
10_uterine-closure.png  [step.cs.uterine-closure]
   Scene: both angles secured, continuous absorbable suture closing the lower segment; inset showing the two layers.
   Teach: angles first, two layers. Check: as in PRECISE FACTS.
11_adnexal-check.png  [step.obg.adnexal-check]
   Scene: the surgeon gently lifting and inspecting one tube to its fimbrial end and the ovary, the other side in
   view. Teach: inspect both tubes and ovaries and record. Check: both sides shown.
12_haemostasis.png  [step.core.haemostasis]
   Scene: closed uterus, angles and suture line inspected, swab on a stick, field dry. Teach: check the angles and
   the suture line. Check: no active bleeding.
13_blood-loss.png  [step.obg.blood-loss]
   Scene: used swabs weighed on scales, suction canister beside them, the surgeon speaking to the anaesthetist.
   Teach: measure, not estimate; say it aloud. Check: scale display shows only abstract bars.
14_counts.png  [step.core.counts]  Scene, teach, check as A15, with large abdominal swabs.
15_rectus-sheath-closure.png  [step.cs.sheath]
   Scene: continuous absorbable suture closing the rectus sheath. Teach: close the sheath; fat only if over 2 cm.
   Check: suture in the sheath.
16_skin-closure-dressing.png  [step.core.skin-closure]
   Scene: neat transverse suprapubic subcuticular closure and a clean dressing. Teach: tension-free closure.
   Check: incision matches image 06.
17_rhesus-anti-d.png  [step.obg.rhesus]
   Scene: recovery: midwife checking a blood-group result (abstract bars) and an anti-D syringe with a BLANK label
   beside the mother holding her baby. Teach: check rhesus status and give anti-D if needed. Check: no text.
18_debrief-handover.png  [step.core.debrief]
   Scene: obstetrician handing over to the recovery midwife, note with grey lines only. Teach: note and plan now.
   Check: no readable text.

D. TOTAL THYROIDECTOMY  (folder total-thyroidectomy/)
01_consent-check.png  [step.core.consent-check]
   Scene: awake adult patient; the surgeon discussing consent, including the voice and calcium risks, with the form
   (grey lines). Teach: consent with the awake patient. Check: no text.
02_mdt-check.png  [step.onco.mdt-check]
   Scene: surgeon reviewing neck imaging (an ultrasound/CT of a thyroid nodule, no text) and an MDT outcome sheet
   (grey lines). Teach: the operation matches the MDT decision and the diagnosis. Check: imaging shows a thyroid.
03_team-time-out.png  [step.core.timeout]
   Scene: time-out; the anaesthetist confirming the nerve-monitoring tube is connected. Teach: everyone pauses,
   monitoring confirmed. Check: monitor screen shows only a wave.
04_antibiotic-thromboprophylaxis.png  [step.core.prophylaxis]  Scene, teach, check as A03 with this patient.
05_positioning.png  [step.core.positioning]
   Scene: side view of the table. Teach and Check: the D positioning facts exactly (shoulder roll, neck extended,
   head ring, 15 degrees head up, arms tucked).
06_skin-prep-draping.png  [step.core.prep-drape]
   Scene: neck prepared from jaw to upper chest, drapes framing the neck with the sternal notch visible. Teach: wide
   prep. Check: the marked skin crease visible.
07_collar-incision.png  [step.thyr.incision]
   Scene: skin-crease incision two finger-breadths above the sternal notch, subplatysmal flaps raised, strap muscles
   separated in the midline exposing the gland. Teach: flaps above the anterior jugular veins, open the midline.
   Check: incision in a natural skin crease.
08_vagal-baseline.png  [step.thyr.ionm-baseline]
   Scene: carotid sheath opened, the handheld probe on the vagus nerve between the carotid artery and jugular vein;
   inset of the monitor with a plain wave. Teach: get the vagal signal before dissection. Check: probe on the vagus,
   not the artery.
09_superior-pole.png  [step.thyr.superior-pole]
   Scene: upper pole retracted down and out, opening the avascular space; the external branch of the superior
   laryngeal nerve on the cricothyroid muscle highlighted; vessels tied individually close to the capsule. Teach:
   protect the external branch, tie close to the gland. Check: individual ties, not one mass tie.
10_parathyroids.png  [step.thyr.parathyroids]
   Scene: lobe rotated medially; an upper and a lower parathyroid (caramel-brown ovals) swept laterally on their
   small vessels; inferior thyroid artery branches tied close to the gland. Teach: keep each parathyroid on its blood
   supply. Check: parathyroid colour distinct from thyroid.
11_recurrent-laryngeal-nerve.png  [step.thyr.rln]
   Scene: the RIGHT recurrent laryngeal nerve in the tracheo-oesophageal groove crossing the inferior thyroid artery,
   traced up to the larynx; stimulating probe touching it. Teach: find, confirm and trace the nerve before dividing
   anything. Check: nerve course exactly as in PRECISE FACTS.
12_berry-ligament.png  [step.thyr.berry]
   Scene: fine instruments dividing the ligament of Berry close to the gland with the nerve kept in view just
   beneath; the isthmus being divided. Teach: nerve in view at the most dangerous point. Check: no diathermy near the
   nerve.
13_signal-check.png  [step.thyr.ionm-decision]
   Scene: first lobe removed; probe on the nerve proximally; inset of the monitor with a plain wave. Teach: confirm
   the signal before starting the second side. Check: monitor has no numbers.
14_specimen-orientation.png  [step.onco.specimen-orientation]
   Scene: the whole intact thyroid on a tray with orientation sutures on the upper pole of one side, the surgeon
   placing a stitch. Teach: orient the intact specimen for the pathologist. Check: specimen intact, not opened.
15_haemostasis.png  [step.core.haemostasis]
   Scene: empty thyroid bed, both nerves and the parathyroids visible, the field dry, the anaesthetist raising the
   pressure (inset). Teach: check after a Valsalva or pressure rise. Check: no bleeding.
16_counts.png  [step.core.counts]  Scene, teach, check as A15.
17_specimen-labelling.png  [step.core.specimen]
   Scene: thyroid in a specimen pot with a BLANK label, surgeon and scrub reading it together. Teach: label at hand-
   off. Check: label blank.
18_skin-closure-dressing.png  [step.core.skin-closure]
   Scene: straps re-approximated in the midline, platysma closed, neat subcuticular collar closure and a clean
   dressing. Teach: layered closure. Check: incision matches image 07.
19_debrief-handover.png  [step.core.debrief]
   Scene: handover to the ward nurse at the bedside with a haematoma kit (clip remover, scissors) clearly at the bed.
   Teach: hand over the airway and calcium plan; haematoma kit at the bed. Check: no readable text.

QUALITY CHECK (for EVERY image before moving to the next)
- Laterality correct for that operation (see the laterality rules above)?
- Anatomy, instrument, port or incision and position correct for this step?
- Every PRECISE FACT that applies to this image drawn exactly?
- The teaching point is the first thing the eye lands on?
- Zero text, numbers, labels, logos or watermarks, including boards, labels and screens?
- Same style, patient and team as the earlier images of that operation?
If any answer is no, regenerate that image before continuing.

DELIVERY
Make FOUR zip files, one per operation, with the PNGs named exactly as above:
  surgx-lap-cholecystectomy-steps.zip   (19 images)
  surgx-hernia-repair-steps.zip         (14 images)
  surgx-lscs-steps.zip                  (18 images)
  surgx-total-thyroidectomy-steps.zip   (19 images)
Put credits.txt in each zip: for each image the filename, a one-line description and the reference sources you
studied (titles and links). Then give me the four zips as downloads.
```

## Round 2: regenerate two images (2026-11-20)
The other 68 are in the app. Gemini drew the same generic flat-table theatre scene for every positioning step, so these two
are wrong. Paste into the same Gemini chat:

```
Two images from the 70 are wrong. Regenerate ONLY these two, in exactly the same style, patient and team as the rest
of their operation, with the IMAGE GENERATION MODEL (never code). Do NOT reuse or edit the earlier generic theatre
scene; draw each one new, as a pure SIDE VIEW of the operating table at eye level, so the table angle is obvious.

1. lap-cholecystectomy/04_positioning.png
   - Camera exactly side-on from the patient's RIGHT side, at table height.
   - The table top is visibly TILTED: the HEAD end is HIGHER than the foot end by 20 degrees (reverse Trendelenburg).
     The floor line and the table top must clearly form that angle.
   - Small inset (circle, lower corner) viewed from the foot of the table: the table rolled so the patient's LEFT side is
     LOWER and the RIGHT side higher, by about 15 degrees.
   - BOTH arms tucked at the patient's sides inside the drape, not on arm boards. A padded foot board against both
     soles, a safety strap across the thighs, padding under the heels.
   - Patient anaesthetised, covered with a green drape from chest to feet; anaesthetist at the head.
   - Teach: head up and left side down so the bowel falls away from the gallbladder. Check: the tilt is unmistakable.

2. total-thyroidectomy/05_positioning.png
   - Camera exactly side-on, at table height, close enough that the head, neck and shoulders fill the left half.
   - A firm roll under BOTH shoulders (across the upper back, at shoulder-blade level); the neck EXTENDED so the chin
     is lifted and the front of the neck is stretched and prominent; the back of the head resting in a soft ring.
   - The table head end HIGHER than the foot end by about 15 degrees (reverse Trendelenburg), clearly visible.
   - BOTH arms tucked at the sides. The nerve-monitoring breathing tube in the mouth, its cable going to the
     anaesthetist at the head.
   - Teach: shoulder roll and neck extension open the neck; head up reduces venous bleeding. Check: shoulder roll and
     neck extension are the first thing the eye lands on.

No text, numbers, labels or angle markings anywhere. Landscape 4:3, 1600 x 1200 px, PNG, same filenames.
Put both in one zip: surgx-batch2-fix.zip
```
