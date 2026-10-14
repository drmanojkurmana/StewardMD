from reg import fig
from lib import *

WARM, BLUE, RD = "#F5DDA6", "#DCEAF7", "#FBE3E0"
ST_A = {"fill": "#FFF1CC", "stroke": AMBER}
ST_R = {"fill": RD, "stroke": RED}

@fig("ana-gut-diaphragm", 1, "Flow diagram of midgut development: rapid elongation at week 6 pushes loops into the umbilical cord, the loop rotates 90 degrees anticlockwise around the superior mesenteric artery while herniated, returns by week 10 with a further 180 degrees, giving 270 degrees in total, then fixes.",
     "The midgut turns 270 degrees anticlockwise around the superior mesenteric artery; failures give omphalocele, malrotation and volvulus.")
def midgut_rotation():
    return graph("x", "Midgut rotation around the superior mesenteric artery", "d", [[("a", "Week 6: rapid elongation\nphysiological herniation into the cord")], [("b", "Herniated loop turns 90 degrees\nanticlockwise (seen from the front)")], [("c", "Week 10: loops return to the abdomen,\nturning a further 180 degrees")], [("d", "Total 270 degrees; colon fixes,\nascending and descending become retroperitoneal")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Axis of rotation: the superior mesenteric artery", cw=420, rh=52, gap=30, top=92,
                 notes=["Failure to return: omphalocele. Incomplete rotation: malrotation and volvulus."])

@fig("ana-heart-vessels", 0, "Flow diagram of atrial septation: septum primum grows down, the ostium primum closes, perforations form the ostium secundum, septum secundum grows beside it leaving the foramen ovale, which acts as a one-way flap.",
     "Right-to-left flow through the foramen ovale bypasses the lungs in the fetus; the flap shuts at birth.")
def atrial_septation():
    return graph("x", "Atrial septation", "d", [[("a", "Septum primum grows\ndownwards from the roof")], [("b", "Ostium primum closes against\nthe endocardial cushions")], [("c", "Perforations join to form\nthe ostium secundum")], [("d", "Septum secundum grows to the right\nof the primum, leaving the foramen ovale")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Fetal blood passes right atrium to left atrium through the foramen ovale", cw=420, rh=52, gap=30, top=92,
                 notes=["After birth the left atrial pressure rises, the flap fuses: fossa ovalis.", "Persistent opening: patent foramen ovale or atrial septal defect."])

@fig("ana-heart-vessels", 4, "Table of fetal structures and their adult remnants: ductus arteriosus becomes ligamentum arteriosum, ductus venosus becomes ligamentum venosum, umbilical vein becomes ligamentum teres hepatis, umbilical arteries become medial umbilical ligaments, foramen ovale becomes fossa ovalis.",
     "Every fetal shunt leaves a ligament or a fossa.")
def fetal_remnants():
    return pathways("x", "Fetal shunts and their adult remnants", "d", ["Fetal structure", "Adult remnant"],
        [("Ductus arteriosus", "Ligamentum arteriosum"), ("Ductus venosus", "Ligamentum venosum"), ("Umbilical vein", "Ligamentum teres hepatis"), ("Umbilical arteries", "Medial umbilical ligaments"), ("Foramen ovale", "Fossa ovalis")],
        "Closure starts with the first breaths and clamping of the cord", widths=[280, 280], rh=46, gap=14, top=100)

@fig("ana-implantation-placenta", 2, "Three stages of chorionic villi: primary villi are a trophoblast core only, secondary villi gain a mesenchymal core, and tertiary villi contain fetal capillaries.",
     "Villi become functional exchange units only when they carry fetal vessels (tertiary stage).")
def chorionic_villi():
    return graph("x", "Chorionic villi in three stages", "d", [[("a", "Primary villus\nTrophoblast only"), ("b", "Secondary villus\nTrophoblast + mesoderm core"), ("c", "Tertiary villus\nCore with fetal blood vessels")]],
                 [("a", "b"), ("b", "c")], "Second week to the end of the third week", cw=230, rh=70, gap=10, top=110, nodestyle={"c": ST_A},
                 notes=["Tertiary villi connect to the embryonic circulation: exchange begins in week 3."])

@fig("ana-implantation-placenta", 5, "Yolk sac and its fates: it appears in week 2 and contributes primitive blood cells, primordial germ cells, the gut lining and the vitelline duct, whose remnant is Meckel diverticulum.",
     "Meckel diverticulum is a persistent vitelline duct remnant.")
def yolk_sac_fates():
    return graph("x", "Yolk sac: what it gives rise to", "d", [[("y", "Yolk sac (from hypoblast, week 2)")], [("a", "Primitive blood\ncells"), ("b", "Primordial germ\ncells (migrate to gonad)"), ("c", "Gut tube\nendoderm"), ("d", "Vitelline duct")], [None, None, None, ("e", "Remnant: Meckel\ndiverticulum")]],
                 [("y", "a"), ("y", "b"), ("y", "c"), ("y", "d"), ("d", "e")], "Early nutrition is from the yolk sac; later the placenta takes over", cw=170, rh=56, gap=44, top=96, nodestyle={"e": ST_R})

@fig("ana-intestines", 4, "Two columns separating colon parts that have a mesentery and are mobile (transverse colon, sigmoid colon, appendix) from parts that are retroperitoneal and fixed (ascending colon, descending colon).",
     "Transverse and sigmoid colon hang on mesocolons; ascending and descending colon are plastered to the back wall.")
def colon_mesenteries():
    f = F("x", "Mobile and fixed parts of the colon", "d", 800, 400, "Rectum: upper part with peritoneum, lower part without")
    f.box(60, 100, 300, 190, "Intraperitoneal, with a mesentery\n\nTransverse colon (transverse mesocolon)\nSigmoid colon (sigmoid mesocolon)\nAppendix (mesoappendix)\nCaecum: free, usually no mesentery", "#F4FAF8", TEAL, 13, 600)
    f.box(440, 100, 300, 190, "Secondarily retroperitoneal, fixed\n\nAscending colon\nDescending colon\nPeritoneum covers front and sides only", "#F4FAF8", AMBER, 13, 600)
    f.text(210, 88, "Can twist (volvulus)", 13, 700, TEAL, "middle"); f.text(590, 88, "Cannot twist", 13, 700, AMBER, "middle")
    f.text(400, 345, "Sigmoid volvulus is a surgical emergency; the sigmoid mesocolon has a narrow root.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-joints-cartilage", 3, "Table of joint classes with examples: fibrous sutures and gomphoses, primary cartilaginous joints (synchondroses) such as the first costochondral joint and epiphyseal plate, secondary cartilaginous joints (symphyses) such as the pubic symphysis, and synovial joints.",
     "Primary cartilaginous joints use hyaline cartilage; secondary use fibrocartilage and sit in the midline.")
def joint_classes():
    return pathways("x", "Classification of joints with examples", "d", ["Class", "Examples", "Movement"],
        [("Fibrous", "Skull sutures, gomphosis (tooth), syndesmosis (distal tibiofibular)", "None or little"), ("Primary cartilaginous (synchondrosis)", "First costochondral joint, epiphyseal plate; hyaline cartilage", "None; temporary"),
         ("Secondary cartilaginous (symphysis)", "Manubriosternal joint, pubic symphysis, intervertebral discs; fibrocartilage", "Slight"), ("Synovial", "Hinge, pivot, ball and socket, plane, saddle, condyloid", "Free")],
        widths=[230, 340, 130], rh=52, gap=12, top=100)

@fig("ana-joints-cartilage", 1, "Layer diagram of articular cartilage from surface to bone: superficial zone with tangential collagen, middle zone, deep zone with vertical collagen, tidemark, calcified cartilage and subchondral bone; there is no perichondrium, no nerves and no vessels.",
     "Collagen fibres run parallel to the surface at the top and vertical at the bottom; the tidemark separates calcified cartilage.")
def articular_layers():
    f = F("x", "Layers of articular cartilage", "d", 800, 440, "Joint space at the top")
    L = [("Superficial zone: collagen parallel to surface", "#E6EEF5", 50), ("Middle zone: oblique collagen", "#D3E0EC", 60), ("Deep zone: collagen vertical, anchors to bone", "#BFD1E1", 70), ("Calcified cartilage (below the tidemark)", "#A9BFD3", 40), ("Subchondral bone", "#E6DCC8", 50)]
    y = 90
    for t, c, h in L:
        f.rect(90, y, 620, h, c, INK, 1.4, 0); f.text(400, y + h / 2 + 5, t, 13.5, 600, INK, "middle"); y += h
    f.line(70, 90 + 180, 730, 90 + 180, AMBER, 2.2, "6 4"); f.text(738 - 8, 90 + 175, "tidemark", 12, 700, AMBER, "end") if False else f.text(722, 270, "tidemark", 12, 700, AMBER)
    f.text(400, 405, "Articular cartilage has no perichondrium, no nerves, no vessels; nutrition from synovial fluid.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-kidney-posterior-wall", 3, "Table of lumbar plexus branches with root values and what each supplies: iliohypogastric T12 L1, ilioinguinal L1, genitofemoral L1 L2, lateral femoral cutaneous L2 L3, femoral L2 to L4, obturator L2 to L4.",
     "Femoral and obturator both come from L2 to L4; femoral from the posterior divisions, obturator from the anterior.")
def lumbar_plexus():
    return pathways("x", "Lumbar plexus branches", "d", ["Nerve", "Roots", "Main territory"],
        [("Iliohypogastric", "T12, L1", "Suprapubic and gluteal skin; abdominal wall muscles"), ("Ilioinguinal", "L1", "Inguinal canal; skin of root of penis or mons, scrotum or labium"), ("Genitofemoral", "L1, L2", "Cremaster (genital branch); femoral triangle skin"),
         ("Lateral femoral cutaneous", "L2, L3", "Skin of lateral thigh"), ("Femoral", "L2 to L4 (posterior divisions)", "Quadriceps, sartorius, iliacus; anterior thigh, saphenous skin"), ("Obturator", "L2 to L4 (anterior divisions)", "Adductors; medial thigh skin")],
        widths=[200, 200, 290], rh=44, gap=10, top=100)

@fig("ana-knee-popliteal", 1, "Diamond-shaped popliteal fossa: biceps femoris upper lateral, semimembranosus and semitendinosus upper medial, lateral and medial heads of gastrocnemius lower, with contents from superficial to deep tibial nerve, popliteal vein, popliteal artery.",
     "Nerve, vein, artery from superficial to deep; the artery lies against the femur, so it tears with a supracondylar fracture.")
def popliteal_fossa():
    f = F("x", "Popliteal fossa: boundaries and contents", "d", 800, 520, "Posterior view of the right knee")
    f.path("M400 100 L560 250 L400 400 L240 250 Z", "#F4FAF8", INK, 2.4)
    f.text(250, 150, "Upper lateral: biceps femoris", 12.5, 700, INK, "end") if False else None
    f.text(235, 160, "Biceps femoris", 13, 700, INK, "end"); f.text(235, 177, "(upper lateral)", 11.5, 400, GREY, "end")
    f.text(565, 160, "Semimembranosus and", 13, 700, INK); f.text(565, 177, "semitendinosus (upper medial)", 11.5, 400, GREY)
    f.text(235, 365, "Lateral head of", 13, 700, INK, "end"); f.text(235, 382, "gastrocnemius", 13, 700, INK, "end")
    f.text(565, 365, "Medial head of", 13, 700, INK); f.text(565, 382, "gastrocnemius", 13, 700, INK)
    f.circle(400, 215, 16, "#E8C547", INK, 1.8); f.circle(400, 255, 13, "#3E6FA5", INK, 1.8); f.circle(400, 292, 11, RED, INK, 1.8)
    f.line(416, 215, 600, 245, GREY, 1.1); f.text(604, 249, "Tibial nerve (most superficial)", 12.5, 700, INK)
    f.line(413, 255, 600, 270, GREY, 1.1); f.text(604, 274, "Popliteal vein", 12.5, 700, INK)
    f.line(411, 292, 600, 295, GREY, 1.1); f.text(604, 299, "Popliteal artery (deepest)", 12.5, 700, INK)
    f.text(400, 450, "Common peroneal nerve runs along the medial edge of biceps femoris.", 12.5, 500, GREY, "middle")
    f.text(400, 472, "Roof: popliteal fascia. Floor: popliteal surface of femur, capsule, popliteus.", 12, 400, GREY, "middle")
    return f

@fig("ana-knee-popliteal", 5, "Table of knee bursitis names: housemaid knee is the prepatellar bursa, clergyman knee is the infrapatellar bursa, Baker cyst is the semimembranosus gastrocnemius bursa communicating with the joint.",
     "Housemaid: kneeling in front. Clergyman: kneeling upright. Baker cyst: bulge behind the joint.")
def knee_bursae():
    return pathways("x", "Bursae around the knee", "d", ["Name", "Bursa", "Cause or note"],
        [("Housemaid's knee", "Prepatellar", "Prolonged kneeling, swelling in front of the patella"), ("Clergyman's knee", "Infrapatellar (deep)", "Kneeling upright, swelling below the patella"), ("Baker's cyst", "Semimembranosus-gastrocnemius", "Communicates with the joint; swelling in the popliteal fossa")],
        widths=[190, 220, 280], rh=56, gap=14, top=100)

@fig("ana-larynx", 2, "Table of laryngeal nerve supply: external branch of the superior laryngeal nerve supplies cricothyroid only, internal branch gives sensation above the vocal cords, recurrent laryngeal nerve supplies all other intrinsic muscles and sensation below the cords.",
     "External superior laryngeal: cricothyroid only. Recurrent laryngeal: every other intrinsic muscle.")
def laryngeal_nerves():
    return pathways("x", "Nerve supply of the larynx", "d", ["Nerve (branch of the vagus)", "Motor", "Sensory"],
        [("Superior laryngeal: external branch", "Cricothyroid only (tenses cords)", "None"), ("Superior laryngeal: internal branch", "None", "Mucosa above the vocal cords"), ("Recurrent laryngeal", "All other intrinsic muscles", "Mucosa below the vocal cords")],
        "Posterior cricoarytenoid is the only muscle that opens the cords", widths=[250, 230, 210], rh=56, gap=14, top=104)

@fig("ana-leg-ankle", 1, "Cross-section of the leg with tibia and fibula and four compartments: anterior (dorsiflexion, deep peroneal nerve), lateral (eversion, superficial peroneal nerve), superficial posterior (plantar flexion, tibial nerve), deep posterior (inversion and toe flexion, tibial nerve).",
     "Four compartments, three nerves: deep peroneal, superficial peroneal, tibial; the calf muscles gastrocnemius and soleus sit in the superficial posterior compartment.")
def leg_compartments():
    f = F("x", "Compartments of the leg", "d", 800, 540, "Cross-section through the mid leg: front at the top")
    cx, cy = 400, 285
    f.circle(cx, cy, 150, "#F4FAF8", INK, 2.4)
    f.ellipse(cx - 40, cy - 30, 30, 22, "#E6DCC8", INK, 2); f.text(cx - 40, cy - 26, "Tibia", 11, 700, INK, "middle")
    f.ellipse(cx + 95, cy + 5, 13, 13, "#E6DCC8", INK, 2); f.text(cx + 112, cy + 38, "Fibula", 11, 700, INK, "start")
    f.line(cx - 12, cy - 18, cx + 84, cy + 2, GREY, 2)
    f.line(cx + 108, cy - 5, cx + 70, cy - 132, GREY, 1.6); f.line(cx + 108, cy + 12, cx + 40, cy + 144, GREY, 1.6)
    f.text(cx - 20, cy - 80, "ANTERIOR", 12, 700, TEAL, "middle"); f.text(cx + 100, cy - 80, "LATERAL", 11, 700, TEAL, "middle")
    f.text(cx - 5, cy + 50, "DEEP POSTERIOR", 12, 700, TEAL, "middle"); f.text(cx - 5, cy + 100, "SUPERFICIAL POSTERIOR", 12, 700, TEAL, "middle")
    f.text(60, 120, "Anterior", 14, 700, TEAL); f.text(60, 142, "Dorsiflexion", 12, 500, INK); f.text(60, 160, "Deep peroneal nerve", 12, 400, GREY)
    f.text(620, 120, "Lateral", 14, 700, TEAL); f.text(620, 142, "Eversion", 12, 500, INK); f.text(620, 160, "Superficial peroneal n.", 12, 400, GREY)
    f.text(60, 430, "Deep posterior", 14, 700, TEAL); f.text(60, 452, "Inversion, toe flexion", 12, 500, INK); f.text(60, 470, "Tibial nerve", 12, 400, GREY)
    f.text(560, 430, "Superficial posterior", 14, 700, TEAL); f.text(560, 452, "Plantar flexion (calf)", 12, 500, INK); f.text(560, 470, "Tibial nerve", 12, 400, GREY)
    return f

@fig("ana-leg-ankle", 4, "Table of ankle ligaments: medial deltoid ligament is strong and rarely torn, lateral ligaments are anterior talofibular, calcaneofibular and posterior talofibular, with the anterior talofibular most often sprained in inversion injury.",
     "Inversion sprains tear the anterior talofibular ligament first.")
def ankle_ligaments():
    return pathways("x", "Ligaments of the ankle", "d", ["Side", "Ligament", "Clinical point"],
        [("Medial", "Deltoid: tibionavicular, tibiocalcaneal, tibiotalar", "Strong; eversion injury more often fractures the malleolus"), ("Lateral", "Anterior talofibular", "Weakest and most often torn, in inversion"),
         ("Lateral", "Calcaneofibular", "Torn second in severe inversion"), ("Lateral", "Posterior talofibular", "Strongest lateral band; rarely torn")],
        widths=[110, 290, 290], rh=48, gap=12, top=100)

@fig("ana-liver-biliary", 2, "Schematic of a liver sinusoid: blood in the sinusoid lumen with a Kupffer cell, fenestrated endothelium, the space of Disse containing a stellate cell that stores vitamin A, then hepatocytes with a bile canaliculus between them.",
     "Plasma crosses the fenestrated endothelium into the space of Disse; stellate cells here become collagen-producing in cirrhosis.")
def sinusoid():
    f = F("x", "Sinusoid, space of Disse and hepatocytes", "d", 800, 480, "Blood flows from portal tract to central vein; bile flows the opposite way")
    f.rect(80, 90, 640, 90, "#FBE3E0", INK, 1.6, 0); f.text(400, 78, "Sinusoid lumen", 12.5, 700, RED, "middle")
    for i in range(7): f.ellipse(120 + i * 85, 135, 14, 8, "#C0392B", "#7A1F17", 1.2)
    f.circle(300, 105, 14, "#9F7AB8", INK, 1.5); f.label(300, 105, "Kupffer cell (macrophage)", 330, 70, 12, "start") if False else f.text(318, 100, "Kupffer cell", 11.5, 600, INK)
    f.line(80, 182, 720, 182, INK, 3, "14 8")
    f.text(735, 186, "fenestrated endothelium", 11.5, 600, INK) if False else f.text(400, 198, "fenestrated endothelium (no basement membrane)", 11.5, 600, GREY, "middle")
    f.rect(80, 205, 640, 28, "#FFF1CC", INK, 1.2, 0); f.text(400, 224, "Space of Disse", 12.5, 700, INK, "middle"); f.ellipse(560, 219, 22, 9, "#F1C6C0", INK, 1.4); f.text(590, 223, "stellate (Ito) cell: vitamin A", 11.5, 600, INK) if False else f.text(630, 223, "stellate cell", 11.5, 600, INK)
    f.rect(80, 233, 640, 120, "#E4D7C2", INK, 1.6, 0)
    for i in range(3): f.ellipse(160 + i * 180, 290, 70, 40, "#EFE2CC", INK, 1.4); f.circle(160 + i * 180, 290, 11, "#8C6FA0", INK, 1.2)
    f.rect(238, 283, 24, 14, "#B7D8CB", TEAL, 1.2, 4) if False else None
    for i in range(2): f.circle(250 + i * 180, 290, 6, "#9AD0A6", TEAL, 1.6)
    f.text(250, 345 if False else 340, "bile canaliculus", 11.5, 600, TEAL, "middle")
    f.text(160, 380, "Hepatocyte", 12.5, 700, INK, "middle")
    f.text(400, 430, "Stellate cells store vitamin A; activated in fibrosis they lay down collagen.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-liver-portal", 1, "Couinaud liver segments in the standard layout: top row VII, VIII, IVa, II; bottom row VI, V, IVb, III; caudate lobe I separate; vertical planes of the right, middle and left hepatic veins and a transverse portal plane.",
     "Eight segments, each with its own portal pedicle; hepatic veins run between segments, the portal plane splits upper from lower.")
def couinaud():
    f = F("x", "Couinaud segments of the liver", "d", 800, 520, "Anterior view, patient right on the left of the page")
    xs = [100, 255, 410, 565]; w, h = 140, 120
    top = [("VII", "#BFE3D6"), ("VIII", "#BFE3D6"), ("IVa", "#F5DDA6"), ("II", "#DCEAF7")]
    bot = [("VI", "#BFE3D6"), ("V", "#BFE3D6"), ("IVb", "#F5DDA6"), ("III", "#DCEAF7")]
    for i in range(4):
        f.box(xs[i], 130, w, h, top[i][0], top[i][1], INK, 24, 700); f.box(xs[i], 262, w, h, bot[i][0], bot[i][1], INK, 24, 700)
    f.circle(400, 100, 0, "none", "none", 0)
    f.text(170, 120, "Right lobe", 14, 700, TEAL, "middle") if False else None
    f.text(250, 112, "Right lobe", 14, 700, TEAL, "middle"); f.text(485, 112, "Left lobe (IV: medial, II and III: lateral)", 13, 700, TEAL, "middle")
    for x, t in ((247.5, "right hepatic vein plane"), (402.5, "middle hepatic vein plane"), (557.5, "left hepatic vein plane")):
        f.line(x, 126, x, 388, "#3E6FA5", 2, "6 4"); f.text(x, 408, t, 10.5, 600, "#3E6FA5", "middle")
    f.line(88, 256, 720, 256, RED, 2.2, "6 4"); f.text(724, 252, "portal", 11, 700, RED); f.text(724, 266, "plane", 11, 700, RED)
    f.circle(60, 190, 22, "#F1C6C0", INK, 1.8); f.text(60, 196, "I", 16, 700, INK, "middle"); f.text(60, 232, "Caudate", 10.5, 600, GREY, "middle")
    f.text(400, 460, "Segment I (caudate) drains directly into the IVC and is supplied by both portal branches.", 12.5, 500, GREY, "middle")
    f.text(400, 482, "Cantlie line (middle hepatic vein) divides the liver into functional right and left.", 12, 400, GREY, "middle")
    return f

@fig("ana-liver-portal", 5, "Table of the four portosystemic anastomoses: lower oesophagus (left gastric to azygos, varices), anorectal junction (superior rectal to middle and inferior rectal, haemorrhoids), umbilicus (paraumbilical to superficial epigastric, caput medusae), retroperitoneum (colic veins to renal and lumbar veins).",
     "When portal pressure rises, blood detours through these four sites, causing varices, haemorrhoids and caput medusae.")
def portosystemic():
    return pathways("x", "Portosystemic anastomoses", "d", ["Site", "Portal side", "Systemic side", "Result"],
        [("Lower oesophagus", "Left gastric vein", "Oesophageal veins to azygos", "Oesophageal varices"), ("Anorectal junction", "Superior rectal vein", "Middle and inferior rectal veins", "Haemorrhoids"),
         ("Umbilicus", "Paraumbilical veins", "Superficial epigastric veins", "Caput medusae"), ("Retroperitoneum", "Colic veins", "Renal, lumbar veins (Retzius)", "Usually silent")],
        "Portal hypertension opens these valveless connections", widths=[145, 150, 195, 150], rh=50, gap=12, top=104)

@fig("ana-lymphoid-vessels", 1, "Schematic of a lymph node: afferent lymphatics enter through the capsule into the subcapsular sinus, cortex holds B cell follicles, paracortex holds T cells and high endothelial venules, medulla has cords and sinuses, efferent lymphatic leaves at the hilum.",
     "Lymph flows in through many afferents and out through one efferent at the hilum; T cells sit in the paracortex, B cells in follicles.")
def lymph_node():
    f = F("x", "Structure of a lymph node", "d", 800, 520)
    f.path("M180 250 C180 110 380 80 520 130 C640 170 640 360 520 400 C380 450 180 400 180 250 Z", "#EAF2F6", INK, 2.4)
    f.path("M215 250 C215 135 380 108 505 150 C605 185 605 345 505 380 C380 425 215 375 215 250 Z", "#F4FAF8", GREY, 1.4)
    for (x, y) in ((300, 160), (400, 150), (470, 190), (560, 250)): f.circle(x, y, 20, "#9FB6C9", INK, 1.4)
    f.path("M330 230 C380 210 450 230 480 280", "none", "#E6A93F", 20); f.path("M330 230 C380 210 450 230 480 280", "none", "#F5DDA6", 16)
    f.rect(300, 300, 150, 56, "#E4C9C4", INK, 1.2, 14)
    f.circle(490, 330, 12, "#3E6FA5", INK, 1.5)
    for x in (260, 360, 460): f.arrow(x, 66, x + (0 if x == 360 else (20 if x < 360 else -20)), 112, GREY, 1.8, 8)
    f.text(360, 56, "Afferent lymphatics (many)", 12.5, 700, INK, "middle")
    f.label(300, 160, "Subcapsular sinus and cortex: B cell follicles", 80, 100 if False else 90, 12, "end") if False else None
    f.label(400, 150, "Cortex: B cell follicles", 610, 90, 12.5, "start")
    f.label(430, 240, "Paracortex: T cells, HEVs", 615, 170, 12.5, "start")
    f.label(375, 330, "Medulla: cords and sinuses", 130, 440, 12.5, "end") if False else f.label(375, 330, "Medulla: cords, sinuses", 200, 440, 12.5, "end")
    f.label(490, 330, "Hilum: efferent lymphatic, artery, vein", 650, 470, 12.5, "start") if False else f.label(490, 330, "Efferent lymphatic at hilum", 560, 465, 12.5, "start")
    return f

@fig("ana-lymphoid-vessels", 4, "Table comparing elastic arteries, muscular arteries and arterioles by wall structure and function.",
     "Elastic arteries buffer pulsatile flow; muscular arteries and arterioles control distribution and resistance.")
def vessel_walls():
    return pathways("x", "Arteries by wall structure", "d", ["Vessel type", "Wall feature", "Function"],
        [("Elastic (aorta, pulmonary trunk)", "Thick media of elastic lamellae", "Dampen pulsatile flow (Windkessel)"), ("Muscular (femoral, coronary)", "Thick media of smooth muscle", "Regulate regional flow"), ("Arterioles", "One to three smooth muscle layers", "Main site of resistance"),
         ("Veins", "Thin media, valves, large lumen", "Capacitance; about 65 percent of blood")],
        widths=[220, 240, 230], rh=50, gap=12, top=100)

@fig("ana-male-reproductive", 3, "Inside view of the bladder floor: the trigone is the smooth triangle with the two ureteric orifices at the upper corners and the internal urethral orifice at the lower apex, with the interureteric ridge across the top.",
     "Trigone: two ureteric orifices and the internal urethral orifice; it is smooth because it derives from the mesonephric ducts.")
def bladder_trigone():
    f = F("x", "Trigone of the bladder", "d", 800, 480, "Bladder opened from the front")
    f.path("M110 140 C110 90 690 90 690 140 L610 300 C580 360 470 400 400 410 C330 400 220 360 190 300 Z", "#EAF2F6", INK, 2.4)
    f.path("M290 190 L510 190 L400 330 Z", "#BFE3D6", TEAL, 2.4)
    f.line(290, 190, 510, 190, TEAL, 5); f.circle(290, 190, 8, "#FFFFFF", INK, 2); f.circle(510, 190, 8, "#FFFFFF", INK, 2); f.circle(400, 330, 9, "#FFFFFF", INK, 2)
    f.text(275, 178, "Right ureteric", 12, 700, INK, "end"); f.text(275, 194, "orifice", 12, 700, INK, "end"); f.text(525, 178, "Left ureteric", 12, 700, INK); f.text(525, 194, "orifice", 12, 700, INK)
    f.text(400, 180, "interureteric ridge", 11, 600, TEAL, "middle")
    f.text(420, 352, "Internal urethral orifice", 12, 700, INK); f.text(400, 262, "Trigone", 15, 700, TEAL, "middle")
    f.text(400, 445, "Trigone mucosa is smooth and fixed; the rest of the bladder is rugose and folds when empty.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-male-reproductive", 4, "Table of accessory gland secretions: seminal vesicles alkaline fluid rich in fructose and prostaglandins, prostate citric acid, acid phosphatase, PSA and zinc, bulbourethral glands mucus.",
     "Fructose in semen comes from the seminal vesicles; citric acid and PSA from the prostate.")
def accessory_glands():
    return pathways("x", "Accessory gland secretions", "d", ["Gland", "Secretes", "Clinical note"],
        [("Seminal vesicles", "Alkaline fluid: fructose, choline, prostaglandins", "Fructose test in forensics; the largest share of semen"), ("Prostate", "Citric acid, acid phosphatase, PSA, zinc, fibrinolysin", "PSA marker; liquefies the coagulum"), ("Bulbourethral glands", "Mucus pre-ejaculate", "Lubricates and neutralises urethral acid")],
        widths=[170, 290, 230], rh=56, gap=14, top=100)

@fig("ana-mediastinum", 2, "Side view of the mediastinum: a plane at the sternal angle divides superior from inferior; the inferior mediastinum is divided by the pericardium into anterior, middle and posterior parts with their contents.",
     "Sternal angle level (T4 and T5) splits superior from inferior; the pericardium splits the inferior mediastinum into three.")
def mediastinum_divisions():
    f = F("x", "Divisions of the mediastinum", "d", 800, 520, "Left lateral view: sternum at the left, vertebral column at the right")
    f.rect(130, 90, 18, 340, "#E6DCC8", INK, 1.6, 4); f.text(139, 80, "Sternum", 12, 700, INK, "middle")
    f.rect(610, 90, 22, 340, "#E6DCC8", INK, 1.6, 4); f.text(621, 80, "Vertebrae", 12, 700, INK, "middle")
    f.line(120, 200, 650, 200, RED, 2.2, "6 4"); f.text(660, 205, "Sternal angle", 11.5, 700, RED); f.text(660, 220, "(T4 and T5)", 11.5, 400, RED)
    f.text(380, 150, "SUPERIOR", 14, 700, TEAL, "middle"); f.text(380, 172, "thymus, great vessels, trachea, oesophagus", 12, 400, GREY, "middle")
    f.ellipse(360, 330, 110, 90, "#FBE3E0", INK, 2); f.text(360, 322, "MIDDLE", 13, 700, TEAL, "middle"); f.text(360, 340, "heart in pericardium", 11.5, 500, INK, "middle"); f.text(360, 356, "great vessel roots", 11.5, 500, INK, "middle")
    f.text(215, 330, "ANTERIOR", 12, 700, TEAL, "middle"); f.text(215, 348, "fat, nodes", 11, 400, GREY, "middle")
    f.text(552, 322, "POSTERIOR", 12, 700, TEAL, "middle"); f.text(552, 340, "oesophagus,", 11, 400, GREY, "middle"); f.text(552, 354, "descending", 11, 400, GREY, "middle"); f.text(552, 368, "aorta, thoracic", 11, 400, GREY, "middle"); f.text(552, 382, "duct, azygos", 11, 400, GREY, "middle")
    f.text(400, 470, "Inferior mediastinum = anterior + middle + posterior, relative to the pericardium.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-mediastinum", 4, "Flow diagram of the thoracic duct: starts at the cisterna chyli near T12, passes through the aortic opening, ascends in the posterior mediastinum between aorta and azygos vein, crosses to the left around T5, and drains into the junction of the left internal jugular and subclavian veins.",
     "Thoracic duct: cisterna chyli, aortic hiatus, crosses midline at T5, empties at the left venous angle.")
def thoracic_duct():
    return graph("x", "Course of the thoracic duct", "d", [[("a", "Cisterna chyli (near T12)")], [("b", "Through the aortic opening of the diaphragm")], [("c", "Posterior mediastinum:\nbetween aorta and azygos vein")], [("d", "Crosses to the left about T5")], [("e", "Left venous angle:\nleft internal jugular and subclavian vein")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e")], "Drains the whole body except the right head, neck, arm and right chest", cw=380, rh=48, gap=24, top=92,
                 notes=["The right lymphatic duct drains the right upper quadrant."])

@fig("ana-muscle-nervous", 1, "Diagram of a sarcomere relaxed and contracted: thin actin filaments anchored to Z lines, thick myosin in the A band centred on the M line; on contraction the I band and H zone shorten while the A band stays the same length.",
     "Contraction shortens the I band and H zone; the A band keeps its length.")
def sarcomere():
    f = F("x", "Sarcomere: relaxed and contracted", "d", 800, 520, "Z line to Z line is one sarcomere")
    def sarc(y, zw, ov):
        x0 = 150; z1 = x0; z2 = x0 + zw
        mid = (z1 + z2) / 2; ml = 160  # myosin half length
        f.line(z1, y - 40, z1, y + 40, INK, 4); f.line(z2, y - 40, z2, y + 40, INK, 4)
        for dy in (-20, -6, 8, 22): f.line(mid - 120, y + dy, mid + 120, y + dy, "#B3382C", 6, None, "butt")
        for dy in (-28, -14, 0, 14, 28):
            f.line(z1, y + dy, z1 + ov, y + dy, "#0B6B5B", 2.2); f.line(z2, y + dy, z2 - ov, y + dy, "#0B6B5B", 2.2)
        return z1, z2, mid
    z1, z2, mid = sarc(190, 420, 150)
    f.text(z1, 120, "Z", 13, 700, INK, "middle"); f.text(z2, 120, "Z", 13, 700, INK, "middle"); f.text(mid, 120, "M", 13, 700, INK, "middle")
    f.text(mid, 250, "H zone", 12, 600, GREY, "middle"); f.line(mid - 20, 232, mid + 20, 232, GREY, 1.6)
    f.line(mid - 120, 256 + 14, mid + 120, 256 + 14, AMBER, 3); f.text(mid, 292, "A band (myosin length, constant)", 12, 700, AMBER, "middle")
    f.text(z1 + 70, 250, "I band", 12, 600, GREY, "middle"); f.text(z2 - 70, 250, "I band", 12, 600, GREY, "middle")
    f.text(60, 196, "Relaxed", 14, 700, TEAL)
    z1, z2, mid = sarc(400, 300, 150)
    f.text(60, 406, "Contracted", 14, 700, TEAL)
    f.line(mid - 120, 450, mid + 120, 450, AMBER, 3); f.text(mid, 472, "A band unchanged", 12, 700, AMBER, "middle")
    f.legend([("#0B6B5B", "Actin (thin)"), ("#B3382C", "Myosin (thick)")], 600, 100)
    f.text(540 if False else 560, 400, "I band and H zone narrow", 12.5, 600, INK) if False else f.text(520, 360, "I band and H zone narrow", 12.5, 600, INK)
    return f

@fig("ana-muscle-nervous", 4, "Table matching glial cells to location and function: oligodendrocytes myelinate many CNS axons, Schwann cells myelinate one PNS segment, astrocytes form the blood brain barrier, microglia are the CNS macrophages from mesoderm, ependymal cells line the ventricles.",
     "Oligodendrocyte: CNS myelin, many axons. Schwann cell: PNS myelin, one segment of one axon.")
def glia():
    return pathways("x", "Glial cells and what they do", "d", ["Cell", "Location", "Function"],
        [("Oligodendrocyte", "CNS", "Myelin; one cell wraps many axons"), ("Schwann cell", "PNS", "Myelin; one cell, one segment of one axon"), ("Astrocyte", "CNS", "Blood brain barrier, potassium buffering, scar"),
         ("Microglia", "CNS (mesoderm origin)", "Resident macrophage"), ("Ependymal cell", "Ventricles, central canal", "Line cavities, help circulate CSF")],
        widths=[190, 190, 310], rh=44, gap=10, top=100)

def glyph(f, kind, x, y):
    if kind == "fusiform":
        f.path(f"M{x-60} {y} Q{x} {y-34} {x+60} {y} Q{x} {y+34} {x-60} {y} Z", TINT, INK, 1.8)
    elif kind == "strap":
        f.rect(x - 62, y - 14, 124, 28, TINT, INK, 1.8, 4)
        for i in range(6): f.line(x - 52 + i * 21, y - 14, x - 52 + i * 21, y + 14, LINE, 1)
    elif kind == "uni":
        f.line(x - 60, y - 22, x + 60, y - 22, INK, 4)
        for i in range(8): f.line(x - 52 + i * 15, y - 22, x - 32 + i * 15, y + 20, TEAL, 2)
        f.line(x - 60, y + 22, x + 40, y + 22, INK, 2)
    elif kind == "bi":
        f.line(x - 60, y, x + 60, y, INK, 5)
        for i in range(7):
            f.line(x - 52 + i * 16, y, x - 36 + i * 16, y - 22, TEAL, 2); f.line(x - 52 + i * 16, y, x - 36 + i * 16, y + 22, TEAL, 2)
    elif kind == "multi":
        for i in range(4): f.line(x - 54 + i * 36, y - 24, x - 30 + i * 36, y + 4, TEAL, 2.2); f.line(x - 54 + i * 36, y + 24, x - 30 + i * 36, y - 4, TEAL, 2.2)
        f.line(x - 62, y - 24, x + 62, y - 24, INK, 2.5); f.line(x - 62, y + 24, x + 62, y + 24, INK, 2.5)
    elif kind == "conv":
        f.path(f"M{x-60} {y-30} L{x+50} {y} L{x-60} {y+30} Z", TINT, INK, 1.8)
        for d in (-20, -10, 0, 10, 20): f.line(x - 60, y + d * 1.4, x + 50, y, LINE, 1)
        f.line(x + 50, y, x + 66, y, INK, 4)
    else:
        f.ellipse(x, y, 52, 24, "none", INK, 1.8); f.ellipse(x, y, 30, 10, "none", INK, 1.8)
        f.circle(x, y, 3, INK, INK, 0)

@fig("ana-muscles-nerves-vessels", 1, "Seven muscle fibre arrangements drawn as line glyphs: fusiform, strap, unipennate, bipennate, multipennate, convergent and circular, each with an example muscle.",
     "Pennate muscles pack more fibres and so produce more force; strap muscles give range.")
def muscle_shapes():
    f = F("x", "Muscle fibre arrangements", "d", 800, 520, "Fibre direction versus the line of pull")
    items = (("fusiform", "Fusiform", "Biceps brachii"), ("strap", "Strap", "Sartorius"), ("uni", "Unipennate", "Extensor digitorum longus"), ("bi", "Bipennate", "Rectus femoris"), ("multi", "Multipennate", "Deltoid"), ("conv", "Convergent", "Pectoralis major"), ("circ", "Circular", "Orbicularis oculi"))
    for i, (k, t, e) in enumerate(items):
        x = 130 + (i % 4) * 180; y = 140 + (i // 4) * 200
        glyph(f, k, x, y); f.text(x, y + 56, t, 13.5, 700, TEAL, "middle"); f.text(x, y + 76, e, 11.5, 400, GREY, "middle")
    f.text(400, 500, "Pennate arrangements trade range for force.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-neck-triangles", 3, "Lateral neck diagram: sternocleidomastoid runs from mastoid to sternum and divides the anterior triangle in front from the posterior triangle behind, the omohyoid subdividing the posterior triangle; contents of each are listed.",
     "Anterior triangle: carotid sheath, glands. Posterior triangle: accessory nerve, brachial plexus trunks, cervical plexus branches.")
def neck_triangles():
    f = F("x", "Triangles of the neck", "d", 800, 520, "Right lateral view: face to the left")
    f.path("M150 120 L720 120 L700 380 L150 380 Z", "#F4FAF8", INK, 2)
    f.path("M600 120 L650 120 L310 380 L255 380 Z", "#E7B9B0", INK, 2); f.text(500, 250, "Sternocleidomastoid", 12.5, 700, INK, "middle")
    f.line(255, 380, 700, 380, "#BDB39F", 8); f.text(400, 402, "Clavicle", 12, 600, INK, "middle")
    f.text(150, 108, "Mandible (above)", 12, 700, INK)
    f.line(700, 120, 700, 380, "#BDB39F", 5); f.text(712, 250, "Trapezius", 12, 700, INK)
    f.path("M420 380 L700 290", "none", AMBER, 4); f.text(600, 330, "omohyoid", 11.5, 700, AMBER, "middle")
    f.text(260, 170, "ANTERIOR triangle", 13, 700, TEAL, "middle"); f.text(260, 190, "carotid sheath, submandibular", 11.5, 400, GREY, "middle"); f.text(260, 205, "gland, thyroid, hyoid muscles", 11.5, 400, GREY, "middle")
    f.text(610, 165, "POSTERIOR triangle", 13, 700, TEAL, "middle"); f.text(610, 183, "accessory nerve, cervical", 11.5, 400, GREY, "middle"); f.text(610, 197, "plexus branches", 11.5, 400, GREY, "middle")
    f.text(560, 362, "supraclavicular part", 11, 400, GREY, "middle")
    f.text(400, 450, "Anterior triangle: midline, mandible, sternocleidomastoid. Posterior: sternocleidomastoid, trapezius, clavicle.", 12, 500, GREY, "middle")
    return f

@fig("ana-nerve-injuries", 1, "Table of radial nerve injury by level: axilla (crutch palsy) loses triceps and wrist drop; spiral groove spares triceps with wrist drop; posterior interosseous branch gives finger drop without sensory loss.",
     "Triceps preserved: injury is at or below the spiral groove. Sensation preserved with finger drop: posterior interosseous nerve.")
def radial_levels():
    return pathways("x", "Radial nerve injury by level", "d", ["Level", "Cause", "Deficit"],
        [("Axilla", "Crutch, Saturday night palsy", "Triceps lost; wrist drop; sensory loss over dorsal hand"), ("Spiral groove", "Mid-shaft humeral fracture", "Triceps spared; wrist drop; dorsal hand sensory loss"), ("Posterior interosseous", "Supinator arcade, elbow trauma", "Finger drop; wrist extension weak but present; no sensory loss")],
        widths=[160, 210, 320], rh=56, gap=14, top=100)

@fig("ana-nerves-veins", 2, "Table of lower limb nerve injuries: common peroneal at the fibular neck gives foot drop, tibial gives loss of plantar flexion and sole sensation, femoral gives quadriceps weakness and loss of knee jerk, superior gluteal gives Trendelenburg sign.",
     "Match the nerve to the gait or sign: foot drop, calcaneovalgus, knee giving way, Trendelenburg.")
def leg_nerve_injuries():
    return pathways("x", "Lower limb nerve injuries", "d", ["Nerve", "Typical site", "Motor and sensory loss"],
        [("Common peroneal", "Fibular neck", "Foot drop, steppage gait; dorsum of foot numb"), ("Tibial", "Popliteal fossa, posterior knee", "No plantar flexion or inversion; calcaneovalgus; sole numb"),
         ("Femoral", "Pelvic or inguinal trauma", "Quadriceps weak, knee gives way, knee jerk lost; anterior thigh numb"), ("Superior gluteal", "Intramuscular injection", "Trendelenburg sign; waddling gait")],
        widths=[160, 200, 330], rh=52, gap=12, top=100)

@fig("ana-nervous-senses", 4, "Timeline of neural tube closure: rostral neuropore closes around day 25 and failure gives anencephaly, caudal neuropore closes around day 28 and failure gives spina bifida; folic acid reduces risk.",
     "Rostral failure: anencephaly. Caudal failure: spina bifida. Folic acid before conception lowers the risk.")
def neural_tube():
    return graph("x", "Neural tube closure", "d", [[("a", "Fusion starts at the cervical region,\nzips both ways (about week 4)")], [("r", "Rostral neuropore closes\nabout day 25"), ("c", "Caudal neuropore closes\nabout day 28")], [("r2", "Failure: anencephaly\n(raised alpha-fetoprotein)"), ("c2", "Failure: spina bifida\n(myelomeningocele, occulta)")]],
                 [("a", "r"), ("a", "c"), ("r", "r2"), ("c", "c2")], "Defects arise before many women know they are pregnant", cw=290, rh=60, gap=44, top=96, nodestyle={"r2": ST_R, "c2": ST_R},
                 notes=["Folic acid in the periconception period reduces neural tube defect risk."])

@fig("ana-nose-sinuses", 1, "Table of where each paranasal sinus drains: frontal, maxillary and anterior ethmoid into the middle meatus via the ostiomeatal complex, posterior ethmoid into the superior meatus, sphenoid into the sphenoethmoidal recess, nasolacrimal duct into the inferior meatus.",
     "Most sinuses drain through the middle meatus, so ostiomeatal blockage causes sinusitis in several sinuses at once.")
def sinus_drainage():
    return pathways("x", "Where the sinuses drain", "d", ["Structure", "Opens into"],
        [("Frontal, maxillary, anterior ethmoid sinuses", "Middle meatus (ostiomeatal complex, hiatus semilunaris)"), ("Middle ethmoid sinus", "Middle meatus (on the bulla)"), ("Posterior ethmoid sinus", "Superior meatus"), ("Sphenoid sinus", "Sphenoethmoidal recess"), ("Nasolacrimal duct", "Inferior meatus")],
        "Maxillary ostium is high on the medial wall, so drainage is against gravity", widths=[320, 380], rh=44, gap=12, top=104)

@fig("ana-orbit", 2, "Flow diagram of the ciliary ganglion: parasympathetic fibres from the Edinger Westphal nucleus via the oculomotor nerve synapse in the ganglion and reach sphincter pupillae and ciliary muscle by short ciliary nerves; sympathetic fibres pass through without synapsing.",
     "Only the parasympathetic fibres synapse in the ciliary ganglion; sympathetic and sensory fibres pass through.")
def ciliary_ganglion():
    return graph("x", "Ciliary ganglion pathways", "d", [[("a", "Edinger-Westphal nucleus"), ("s", "Superior cervical ganglion\n(sympathetic)"), ("n", "Nasociliary nerve (V1)\nsensory from cornea")], [("b", "Oculomotor nerve\n(inferior division)"), ("c", "Internal carotid plexus\nthen ciliary ganglion"), ("l", "Long root:\nno synapse")], [("d", "Ciliary ganglion:\nsynapse here"), None, None], [("e", "Short ciliary nerves:\nsphincter pupillae, ciliary muscle"), ("f", "Dilator pupillae\n(no synapse)"), ("g", "Cornea and iris\nsensation")]],
                 [("a", "b"), ("b", "d"), ("d", "e"), ("s", "c"), ("c", "f"), ("n", "l"), ("l", "g")], "Parasympathetic synapses; sympathetic and sensory fibres pass through", cw=230, rh=58, gap=30, top=96, nodestyle={"d": ST_A})

@fig("ana-organ-systems", 2, "Table of airway epithelium by level: trachea and bronchi pseudostratified ciliated columnar with goblet cells and cartilage, bronchioles simple columnar to cuboidal with club cells and no cartilage, alveoli type I and type II pneumocytes.",
     "Cartilage and glands stop at the bronchioles; club (Clara) cells take over secretion there.")
def airway_epithelium():
    return pathways("x", "Airway epithelium by level", "d", ["Level", "Lining", "Support"],
        [("Trachea and bronchi", "Pseudostratified ciliated columnar with goblet cells", "C-shaped rings, then plates, glands"), ("Bronchioles", "Simple columnar to cuboidal ciliated, club (Clara) cells", "No cartilage, no glands, smooth muscle"), ("Respiratory bronchioles", "Cuboidal, few cilia", "Some alveoli open off the wall"),
         ("Alveoli", "Type I (gas exchange), type II (surfactant)", "Thin septa with capillaries")],
        widths=[170, 310, 210], rh=50, gap=12, top=100)

@fig("ana-parotid-infratemporal", 4, "Flow diagram of Frey syndrome: normally glossopharyngeal parasympathetic fibres run via the otic ganglion and auriculotemporal nerve to the parotid; after injury, regrowing fibres join the sympathetic supply of sweat glands, so eating causes facial sweating.",
     "Misdirected parasympathetic regrowth after parotid surgery causes sweating and flushing when eating.")
def frey():
    return graph("x", "Frey syndrome (gustatory sweating)", "d", [[("a", "Glossopharyngeal nerve (CN IX)\ntympanic and lesser petrosal nerves"), ("x", "Surgery or trauma to the\nauriculotemporal nerve")], [("b", "Otic ganglion"), ("y", "Parasympathetic fibres regrow\ninto sweat glands and vessels")], [("c", "Auriculotemporal nerve:\nparotid secretion (normal)"), ("z", "Eating: sweating and flushing\nover the preauricular cheek")]],
                 [("a", "b"), ("b", "c"), ("x", "y"), ("y", "z")], "Left: normal pathway. Right: after injury", cw=330, rh=60, gap=40, top=96, nodestyle={"x": ST_R, "y": ST_R, "z": ST_R})

@fig("ana-pectoral-breast", 0, "Flow diagram of breast lymph drainage: about three quarters drains to axillary nodes (anterior pectoral, central, apical) and the medial part to parasternal nodes along the internal thoracic artery, then to subclavian trunks.",
     "Most breast lymph goes to the axilla (anterior then central then apical nodes); medial quadrants also drain to parasternal nodes.")
def breast_lymph():
    return graph("x", "Lymphatic drainage of the breast", "d", [[("b", "Breast")], [("a", "Axillary nodes\n(about 75 percent)"), ("p", "Parasternal nodes\n(medial; internal thoracic)")], [("c", "Central, then apical nodes"), ("s", "Opposite breast and\nabdominal nodes (rare)")], [("t", "Subclavian lymph trunk")]],
                 [("b", "a"), ("b", "p"), ("a", "c"), ("p", "s", "", "dash"), ("c", "t")], "Level I lateral, II behind, III medial to pectoralis minor", cw=260, rh=58, gap=36, top=96, nodestyle={"b": ST_A},
                 notes=["Sentinel node biopsy samples the first axillary node, usually anterior (pectoral) group."])

@fig("ana-pectoral-breast", 1, "Sagittal diagram of the breast: pectoralis major and fascia deep, retromammary space, Cooper suspensory ligaments, 15 to 20 lobes with lactiferous ducts converging on the nipple through lactiferous sinuses.",
     "Cooper ligaments tether skin to fascia; each lobe drains by its own lactiferous duct to the nipple.")
def breast_sagittal():
    f = F("x", "Structure of the breast", "d", 800, 520, "Sagittal section")
    f.rect(560, 80, 70, 360, "#E7B9B0", INK, 1.8, 6); f.text(595, 70, "Pectoralis major", 12, 700, INK, "middle")
    f.line(550, 80, 550, 440, GREY, 2); f.text(540, 440, "fascia", 11, 500, GREY, "end")
    f.path("M550 120 C400 120 250 190 210 260 C250 340 400 400 550 400", "#FBEFD6", INK, 2.2)
    f.circle(190, 260, 14, "#E8B7A8", INK, 2); f.text(170, 220, "Nipple", 12, 700, INK, "end")
    for dy in (-60, -30, 0, 30, 60):
        f.path(f"M{210+20} 260 C310 {260+dy*0.4} 420 {260+dy*1.1} 520 {260+dy*1.4}", "none", "#B58A3C", 2)
        f.ellipse(500, 260 + dy * 1.4, 22, 13, "#F3D793", INK, 1.2)
    f.ellipse(240, 260, 14, 10, "#F3D793", INK, 1.4); f.text(240, 292, "lactiferous sinus", 11, 600, INK, "middle")
    for (x, y) in ((330, 160), (400, 150), (470, 160)): f.line(x, y - 6, x - 10, 118 + 3, "#8C6FA0", 2)
    f.text(430, 105, "Cooper ligaments to skin", 12, 600, "#8C6FA0", "middle")
    pass
    f.text(380, 428, "15 to 20 lobes, one lactiferous duct each", 12, 600, INK, "middle")
    f.text(400, 480, "Retromammary space lets the breast move over pectoralis major.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-pelvis-perineum", 1, "Diamond-shaped perineum divided by a line between the ischial tuberosities into the anterior urogenital triangle and the posterior anal triangle, bounded by pubic symphysis, ischiopubic rami, ischial tuberosities, sacrotuberous ligaments and coccyx.",
     "A transverse line through the ischial tuberosities splits the diamond into urogenital and anal triangles.")
def perineum_diamond():
    f = F("x", "The perineum", "d", 800, 520, "Inferior view in lithotomy position: front at the top")
    f.path("M400 100 L560 260 L400 440 L240 260 Z", "#F4FAF8", INK, 2.4)
    f.line(240, 260, 560, 260, RED, 2.4, "6 4")
    f.circle(240, 260, 12, "#E6DCC8", INK, 1.8); f.circle(560, 260, 12, "#E6DCC8", INK, 1.8)
    f.text(220, 285, "Ischial", 12, 700, INK, "end"); f.text(220, 301, "tuberosity", 12, 700, INK, "end"); f.text(580, 285, "Ischial", 12, 700, INK); f.text(580, 301, "tuberosity", 12, 700, INK)
    f.text(400, 90, "Pubic symphysis", 12.5, 700, INK, "middle"); f.text(400, 462, "Coccyx", 12.5, 700, INK, "middle")
    f.text(280, 170, "Ischiopubic ramus", 12, 600, GREY, "end"); f.text(520, 170, "Ischiopubic ramus", 12, 600, GREY)
    f.text(280, 380, "Sacrotuberous", 12, 600, GREY, "end"); f.text(280, 396, "ligament", 12, 600, GREY, "end"); f.text(520, 380, "Sacrotuberous", 12, 600, GREY); f.text(520, 396, "ligament", 12, 600, GREY)
    f.text(400, 190, "UROGENITAL TRIANGLE", 13, 700, TEAL, "middle"); f.text(400, 212, "urethra, vagina or penile root", 11.5, 400, GREY, "middle")
    f.text(400, 316, "ANAL TRIANGLE", 13, 700, TEAL, "middle"); f.text(400, 336, "anal canal, ischioanal fossae", 11.5, 400, GREY, "middle")
    return f

@fig("ana-pharyngeal", 1, "Table of pharyngeal arch derivatives with nerve, muscles and skeleton: arch 1 trigeminal (mandible, malleus, incus, mastication), arch 2 facial (stapes, styloid, hyoid lesser horn, facial expression), arch 3 glossopharyngeal (stylopharyngeus, greater horn of hyoid), arches 4 and 6 vagus (laryngeal cartilages).",
     "Each arch has one nerve: V, VII, IX, X. The nerve predicts the muscles it supplies.")
def arch_derivatives():
    return pathways("x", "Pharyngeal arch derivatives", "d", ["Arch and nerve", "Muscles", "Skeleton"],
        [("1: trigeminal (V2, V3)", "Mastication, mylohyoid, anterior digastric, tensor tympani", "Mandible, malleus, incus"), ("2: facial (VII)", "Facial expression, stapedius, stylohyoid, posterior digastric", "Stapes, styloid process, lesser horn of hyoid"),
         ("3: glossopharyngeal (IX)", "Stylopharyngeus", "Greater horn and body of hyoid"), ("4 and 6: vagus (X)", "Pharyngeal and laryngeal muscles, cricothyroid (4)", "Laryngeal cartilages")],
        widths=[170, 270, 250], rh=52, gap=12, top=100)

@fig("ana-pharyngeal", 3, "Table of pharyngeal pouch derivatives: first pouch middle ear and auditory tube, second palatine tonsil, third inferior parathyroid and thymus, fourth superior parathyroid; DiGeorge syndrome results from failure of the third and fourth pouches.",
     "Third pouch: inferior parathyroid and thymus. Fourth pouch: superior parathyroid. DiGeorge: 3rd and 4th pouch failure.")
def pouch_derivatives():
    return pathways("x", "Pharyngeal pouch derivatives", "d", ["Pouch", "Becomes"],
        [("First", "Middle ear cavity, mastoid antrum, auditory tube"), ("Second", "Palatine tonsil (epithelial lining)"), ("Third", "Inferior parathyroid (dorsal), thymus (ventral)"), ("Fourth", "Superior parathyroid (+ C cells via ultimobranchial body)")],
        "Inferior parathyroid is from the higher pouch: its migration crosses the superior one", widths=[150, 520], rh=48, gap=12, top=100)
