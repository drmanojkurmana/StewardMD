from reg import fig
from lib import *

ST_A = {"fill": "#FFF1CC", "stroke": AMBER}
ST_R = {"fill": "#FBE3E0", "stroke": RED}

@fig("ana-pharynx-tonsils", 2, "Flow diagram of the Killian dehiscence: thyropharyngeus with oblique fibres above, cricopharyngeus with horizontal fibres below forming the upper oesophageal sphincter, and a weak gap between them where a Zenker pharyngeal pouch bulges out.",
     "Zenker diverticulum is a false, pulsion pouch through Killian dehiscence, above cricopharyngeus.")
def killian():
    return graph("x", "Killian dehiscence and Zenker diverticulum", "d", [[("a", "Thyropharyngeus\n(oblique fibres)")], [("b", "Killian dehiscence\n(weak gap, posterior wall)")], [("c", "Cricopharyngeus\n(horizontal fibres, upper oesophageal sphincter)")], [("d", "Zenker diverticulum: mucosa\nbulges through the gap")]],
                 [("a", "b"), ("b", "c"), ("b", "d")], "Both parts belong to the inferior constrictor", cw=420, rh=56, gap=28, top=96, nodestyle={"b": ST_A, "d": ST_R},
                 notes=["Presents with dysphagia, regurgitation of food and halitosis."])

@fig("ana-pharynx", 1, "Table of the gaps in the pharyngeal wall and what passes through each: above the superior constrictor, between superior and middle, between middle and inferior, and below the inferior constrictor.",
     "Three constrictors make four gaps; each transmits a predictable set of structures.")
def pharyngeal_gaps():
    return pathways("x", "Gaps in the pharyngeal wall", "d", ["Gap", "Structures passing"],
        [("Above superior constrictor", "Auditory tube, levator veli palatini, ascending palatine artery"), ("Between superior and middle", "Stylopharyngeus, glossopharyngeal nerve, stylohyoid ligament"), ("Between middle and inferior", "Internal laryngeal nerve, superior laryngeal vessels"), ("Below inferior constrictor", "Recurrent laryngeal nerve, inferior laryngeal vessels")],
        "Three constrictors overlap from below upward, leaving the gaps", widths=[230, 460], rh=48, gap=12, top=104)

@fig("ana-pharynx", 3, "Schematic of the palatine tonsil in its fossa with palatoglossal arch in front, palatopharyngeal arch behind, superior constrictor lateral, crypts on the medial surface, tonsillar branch of facial artery, paratonsillar vein, jugulodigastric node, and glossopharyngeal nerve.",
     "Know the arches, the blood supply from the facial artery and the paratonsillar vein, the jugulodigastric node, and CN IX.")
def tonsil_relations():
    f = F("x", "Palatine tonsil: boundaries and supply", "d", 800, 520, "Tonsillar fossa, seen from the oropharynx")
    f.ellipse(400, 260, 80, 110, "#F1C6C0", INK, 2.4)
    for dy in (-60, -20, 20, 60): f.path(f"M360 {260+dy} Q400 {250+dy} 440 {260+dy}", "none", "#B3382C", 1.4)
    f.text(400, 266, "Tonsil", 14, 700, INK, "middle")
    f.path("M330 120 Q300 250 330 400", "none", "#C0392B", 8); f.text(300, 255, "Palatoglossal", 12, 700, INK, "end"); f.text(300, 271, "arch (anterior)", 12, 700, INK, "end")
    f.path("M470 120 Q500 250 470 400", "none", "#C0392B", 8); f.text(500, 255, "Palatopharyngeal", 12, 700, INK); f.text(500, 271, "arch (posterior)", 12, 700, INK)
    f.text(400, 118, "Supratonsillar fossa", 12, 600, GREY, "middle")
    f.text(400, 425, "Lateral: superior constrictor (the internal carotid lies deep to it)", 12, 600, GREY, "middle")
    f.text(40, 470, "Artery: tonsillar branch of the facial artery. Vein: paratonsillar (external palatine) vein.", 12, 500, INK)
    f.text(40, 490, "Lymph: jugulodigastric node. Nerve: glossopharyngeal (CN IX).", 12, 500, INK)
    return f

@fig("ana-pleura-lungs", 2, "Table of surface levels of lung and pleura in ribs: lung reaches rib 6 at the midclavicular line, rib 8 at the midaxillary line and rib 10 posteriorly; pleura reaches rib 8, rib 10 and rib 12 at the same lines.",
     "Lung 6, 8, 10. Pleura 8, 10, 12. The costodiaphragmatic recess lies in the gap.")
def pleura_levels():
    return pathways("x", "Pleural and lung surface levels", "d", ["Reference line", "Lower edge of lung", "Lower edge of pleura"],
        [("Midclavicular line", "Rib 6", "Rib 8"), ("Midaxillary line", "Rib 8", "Rib 10"), ("Paravertebral (posterior)", "Rib 10 (T10)", "Rib 12 (T12)")],
        "The gap is the costodiaphragmatic recess: the site for pleural taps", widths=[230, 200, 200], rh=54, gap=14, top=100,)

@fig("ana-pleura-lungs", 4, "Table contrasting pulmonary and bronchial circulations by origin, area served and venous drainage.",
     "Bronchial veins partly drain to the pulmonary veins, which adds a small physiological shunt.")
def lung_circulations():
    return pathways("x", "Two blood supplies of the lung", "d", ["Circulation", "Source", "Serves", "Drains to"],
        [("Pulmonary", "Right ventricle, pulmonary trunk", "Gas exchange at alveoli", "Pulmonary veins to left atrium"), ("Bronchial", "Aorta or intercostal arteries", "Bronchial tree to respiratory bronchioles, pleura", "Azygos veins; some into pulmonary veins")],
        widths=[140, 190, 190, 170], rh=64, gap=14, top=100)

@fig("ana-scalp-face", 4, "Coronal section of the cavernous sinus: pituitary medially, internal carotid artery and abducens nerve within the sinus, and in the lateral wall from above downward the oculomotor, trochlear, ophthalmic and maxillary nerves, with the sphenoid sinus below.",
     "In the sinus: ICA and CN VI. In the lateral wall top to bottom: III, IV, V1, V2.")
def cavernous_sinus():
    f = F("x", "Cavernous sinus, coronal section", "d", 800, 520, "One side shown; the pituitary lies medial, the nerves in the lateral wall")
    f.rect(250, 140, 340, 260, "#F4FAF8", INK, 1.2, 4) if False else None
    f.path("M300 160 L560 160 L560 330 L300 330 Z", "#EAF2F6", INK, 2.4)
    f.rect(170, 120, 130, 50, "#F5DDA6", INK, 1.8, 14); f.text(235, 150, "Pituitary", 13, 700, INK, "middle")
    f.circle(380, 255, 22, RED, INK, 2); f.text(380, 260, "ICA", 12, 700, "#FFFFFF", "middle")
    f.circle(450, 285, 9, "#E8C547", INK, 1.8); f.text(470, 289, "CN VI", 12, 700, INK)
    for i, (t, y) in enumerate((("III oculomotor", 185), ("IV trochlear", 212), ("V1 ophthalmic", 239), ("V2 maxillary", 266))):
        f.circle(535, y, 8, "#E8C547", INK, 1.6); f.text(560 + 22, y + 4, t, 12, 700, INK)
    f.rect(170, 350, 420, 70, "#D6EAF0", INK, 1.6, 12); f.text(380, 390, "Sphenoid sinus", 13, 700, INK, "middle")
    f.line(535, 185, 535, 266, GREY, 1.2)
    f.text(400, 470, "Lateral wall nerves are III, IV, V1, V2. Within the sinus: ICA (with sympathetic plexus) and VI.", 12.5, 500, GREY, "middle")
    f.text(400, 490, "Infection from the face (danger triangle) can spread here via the ophthalmic veins.", 12, 400, GREY, "middle")
    return f

@fig("ana-shoulder", 1, "Bar chart of shoulder abduction by range: supraspinatus initiates the first 15 degrees, deltoid carries 15 to about 90 degrees, and trapezius with serratus anterior rotate the scapula to take abduction from 90 to 180 degrees.",
     "Supraspinatus starts abduction, deltoid carries the middle range, scapular rotation by trapezius and serratus anterior completes it.")
def abduction_phases():
    p = Plot("x", "Phases of shoulder abduction", "d", (0, 180), (0, 4), "Abduction angle (degrees)", "", 800, 400, "Scapulohumeral rhythm: about 2 degrees of humerus to 1 of scapula", [0, 15, 90, 180], None, 60, 40, 100, 80)
    for (a, b, c, t, y) in ((0, 15, TEAL, "Supraspinatus", 3), (15, 90, "#3E6FA5", "Deltoid", 2), (90, 180, AMBER, "Trapezius + serratus anterior (scapular rotation)", 1)):
        p.rect(p.X(a), p.Y(y + 0.7), p.X(b) - p.X(a), p.Y(y) - p.Y(y + 0.7) + 0, c, "none", 0, 4)
        p.text(p.X(b) + 6 if b < 90 else p.X(a) + 8, p.Y(y + 0.35) + 5, t, 12.5, 700, INK if b < 90 else "#FFFFFF")
    return p

@fig("ana-skull-cranial-cavity", 1, "Superior view of the skull showing coronal suture between frontal and parietal bones, sagittal suture between the parietals, lambdoid suture behind with bregma and lambda marked.",
     "Coronal, sagittal, lambdoid sutures; bregma where coronal meets sagittal, lambda where sagittal meets lambdoid.")
def skull_sutures():
    f = F("x", "Sutures of the skull vault", "d", 800, 570, "Superior view: front at the top")
    f.ellipse(400, 290, 200, 220, "#F4FAF8", INK, 2.4)
    f.path("M215 215 Q400 150 585 215", "none", INK, 3); f.line(400, 183, 400, 400, INK, 3); f.path("M262 410 Q400 460 538 410 L400 400 Z", "none", INK, 3) if False else None
    f.path("M225 400 L400 395 L575 400", "none", INK, 3)
    f.circle(400, 183, 7, AMBER, INK, 1.6); f.circle(400, 397, 7, AMBER, INK, 1.6)
    f.text(400, 160, "Bregma", 12.5, 700, AMBER, "middle") if False else f.text(414, 176, "Bregma", 12.5, 700, AMBER)
    f.text(414, 420, "Lambda", 12.5, 700, AMBER)
    f.text(400, 130, "Frontal bone", 13, 700, TEAL, "middle") if False else f.text(400, 140, "FRONTAL", 13, 700, TEAL, "middle")
    f.text(310, 295, "PARIETAL", 13, 700, TEAL, "middle"); f.text(490, 295, "PARIETAL", 13, 700, TEAL, "middle"); f.text(400, 470, "OCCIPITAL", 13, 700, TEAL, "middle")
    f.text(600, 205, "Coronal suture", 12.5, 600, INK); f.text(420, 290 if False else 330, "Sagittal suture", 12.5, 600, INK) if False else f.text(412, 340, "Sagittal", 12.5, 600, INK); f.text(412, 356, "suture", 12.5, 600, INK)
    f.text(610, 395, "Lambdoid suture", 12.5, 600, INK)
    f.text(400, 548, "Sutures are fibrous joints; they ossify in adult life.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-skull-cranial-cavity", 4, "Flow diagram of dural venous sinus drainage: superior sagittal sinus and straight sinus (from inferior sagittal sinus and great cerebral vein) meet at the confluence of sinuses, then transverse sinuses, sigmoid sinuses and internal jugular veins; the cavernous sinus drains via petrosal sinuses.",
     "Everything drains to the confluence, then transverse, sigmoid, internal jugular vein.")
def venous_sinuses():
    return graph("x", "Dural venous sinuses: where the blood goes", "d", [[("a", "Superior sagittal\nsinus"), ("b", "Inferior sagittal sinus\n+ great cerebral vein"), ("c", "Cavernous sinus")], [("d", "Confluence of sinuses"), ("e", "Straight sinus"), ("f", "Petrosal sinuses")], [("g", "Transverse sinuses (R, L)")], [("h", "Sigmoid sinuses")], [("i", "Internal jugular veins")]],
                 [("b", "e"), ("a", "d"), ("e", "d"), ("d", "g"), ("g", "h"), ("h", "i"), ("c", "f"), ("f", "h", "", "dash")], "Dural folds: falx cerebri holds the superior and inferior sagittal sinuses", cw=220, rh=50, gap=26, top=96)

@fig("ana-spinal-cord", 1, "Cross-section of the spinal cord with labelled grey matter horns and white matter tracts: dorsal columns, lateral corticospinal tract, anterolateral spinothalamic tract, anterior corticospinal tract.",
     "Dorsal columns: fine touch and position, same side. Lateral corticospinal: motor, crossed. Spinothalamic: pain and temperature, crossed.")
def cord_section():
    f = F("x", "Spinal cord cross-section: grey matter and tracts", "d", 800, 540, "Dorsal at the top; labels on the right side only, the left mirrors it")
    cx, cy = 400, 290
    f.ellipse(cx, cy, 170, 130, "#F4FAF8", INK, 2.4)
    f.path(f"M{cx} {cy-8} C{cx-30} {cy-100} {cx-60} {cy-110} {cx-80} {cy-96} C{cx-100} {cy-70} {cx-60} {cy-20} {cx-100} {cy-5} C{cx-130} {cy+5} {cx-130} {cy+50} {cx-90} {cy+80} C{cx-50} {cy+65} {cx-20} {cy+40} {cx} {cy+30} C{cx+20} {cy+40} {cx+50} {cy+65} {cx+90} {cy+80} C{cx+130} {cy+50} {cx+130} {cy+5} {cx+100} {cy-5} C{cx+60} {cy-20} {cx+100} {cy-70} {cx+80} {cy-96} C{cx+60} {cy-110} {cx+30} {cy-100} {cx} {cy-8} Z", "#BFD9D1", "#5C7D75", 1.6)
    f.circle(cx, cy + 8, 5, "#FFFFFF", "#5C7D75", 1.4)
    f.path(f"M{cx+8} {cy-100} L{cx+55} {cy-100} L{cx+30} {cy-30} L{cx+8} {cy-40} Z", "#F5DDA6", AMBER, 1.6)
    f.path(f"M{cx+110} {cy-50} L{cx+150} {cy-20} L{cx+140} {cy+20} L{cx+105} {cy+10} Z", "#E7B9B0", RED, 1.6)
    f.path(f"M{cx+110} {cy+30} L{cx+138} {cy+40} L{cx+110} {cy+90} L{cx+80} {cy+85} Z", "#C9D8EC", "#3E6FA5", 1.6)
    f.path(f"M{cx+10} {cy+100} L{cx+40} {cy+98} L{cx+30} {cy+118} L{cx+10} {cy+118} Z", "#DCEAF7", "#3E6FA5", 1.4)
    f.label(cx + 28, cy - 70, "Dorsal columns (gracilis, cuneatus)", 565, 130, 12.5, "start") if False else f.label(cx + 30, cy - 80, "Dorsal columns", 560, 150, 12.5, "start")
    f.text(565, 168, "fine touch, vibration, position", 11, 400, GREY)
    f.label(cx + 135, cy - 20, "Lateral corticospinal", 600, 260, 12.5, "start"); f.text(605, 278, "voluntary motor, crossed", 11, 400, GREY)
    f.label(cx + 120, cy + 60, "Spinothalamic", 580, 400, 12.5, "start"); f.text(585, 418, "pain, temperature, crossed", 11, 400, GREY)
    f.label(cx + 30, cy + 108, "Anterior corticospinal", 580, 480, 12.5, "start") if False else f.label(cx + 30, cy + 108, "Anterior corticospinal", 520, 490, 12.5, "start")
    f.text(215, 190, "DORSAL horn", 12, 700, TEAL, "end"); f.text(215, 206, "sensory", 11, 400, GREY, "end")
    f.text(215, 380, "VENTRAL horn", 12, 700, TEAL, "end"); f.text(215, 396, "lower motor neurons", 11, 400, GREY, "end")
    return f

@fig("ana-spleen", 2, "Flow diagram of red pulp filtration: arterioles open into the cords of Billroth where macrophages inspect red cells, which squeeze through slits in the sinusoid wall to reach the splenic vein; rigid abnormal cells are trapped and destroyed.",
     "Normal red cells squeeze through the sinusoid slits; spherocytes and old cells get trapped and eaten.")
def red_pulp():
    return graph("x", "Red pulp: the spleen's red cell filter", "d", [[("a", "Penicillar arterioles\n(open-ended)")], [("b", "Cords of Billroth:\nmacrophages inspect red cells")], [("c", "Normal cells squeeze through\nslits into the sinusoids"), ("d", "Rigid or abnormal cells\ntrapped, phagocytosed")], [("e", "Splenic vein")]],
                 [("a", "b"), ("b", "c"), ("b", "d"), ("c", "e")], "White pulp: PALS (T cells), follicles (B cells), marginal zone", cw=290, rh=56, gap=36, top=96, nodestyle={"d": ST_R},
                 notes=["Hereditary spherocytosis: spherocytes are trapped in the cords, causing splenomegaly."])

@fig("ana-stomach-duodenum", 2, "Table of the four parts of the duodenum with vertebral level and key features: D1 bulb at L1 with the commonest ulcer site, D2 with the major papilla, D3 crossing IVC and aorta behind the SMA, D4 to the duodenojejunal flexure at L2.",
     "D1 bulb: ulcers. D2: ampulla. D3: crosses between aorta and SMA. D4: ends at the duodenojejunal flexure.")
def duodenum_parts():
    return pathways("x", "Parts of the duodenum", "d", ["Part", "Level", "Key points"],
        [("D1 (superior, bulb)", "L1", "Commonest site of peptic ulcer; posterior ulcer can erode gastroduodenal artery"), ("D2 (descending)", "L1 to L3", "Major duodenal papilla (ampulla of Vater) on medial wall"), ("D3 (horizontal)", "L3", "Crosses IVC and aorta; SMA and SMV in front of it"),
         ("D4 (ascending)", "L3 to L2", "Ends at duodenojejunal flexure, suspended by the ligament of Treitz")],
        widths=[170, 100, 420], rh=52, gap=12, top=100)

@fig("ana-stomach-spleen", 1, "Hub diagram of the stomach bed: structures on which the posterior wall of the stomach rests, from the diaphragm, left kidney and suprarenal gland, spleen, pancreas, transverse mesocolon and splenic artery.",
     "The stomach bed: diaphragm, left suprarenal, left kidney, pancreas, spleen, transverse mesocolon, splenic artery.")
def stomach_bed():
    f = F("x", "Stomach bed", "d", 800, 500, "Structures behind the stomach, separated from it by the lesser sac")
    f.ellipse(400, 240, 110, 60, "#F1C6C0", INK, 2.4); f.text(400, 246, "Stomach", 16, 700, INK, "middle")
    items = [(100, 110, "Diaphragm"), (330, 100, "Left suprarenal gland"), (560, 110, "Left kidney (upper part)"), (100, 340, "Spleen"), (330, 350, "Pancreas"), (560, 340, "Transverse mesocolon"), (240, 410, "Splenic artery (upper border of pancreas)")]
    for x, y, t in items:
        f.box(x, y, 190 if len(t) < 30 else 320, 44, t, TINT, TEAL, 12.5)
    f.text(400, 482, "Bed structures are separated from the stomach by the lesser sac.", 12, 500, GREY, "middle")
    f.box(150, 400, 120, 1, "", "none", "none", 1) if False else None
    return f

@fig("ana-stomach-spleen", 3, "Flow diagram of stomach nerve supply: left vagus becomes the anterior vagal trunk giving the anterior nerve of Latarjet and hepatic branch; right vagus becomes the posterior trunk giving the posterior nerve of Latarjet, the nerve of Grassi to the fundus and the coeliac branch.",
     "Anterior trunk is the left vagus; posterior trunk is the right vagus; the nerve of Grassi supplies the fundus and is cut in vagotomy.")
def stomach_nerves():
    return graph("x", "Vagal supply of the stomach", "d", [[("l", "Left vagus"), ("r", "Right vagus")], [("a", "Anterior vagal trunk"), ("p", "Posterior vagal trunk")], [("a1", "Anterior nerve of Latarjet\nHepatic branch"), ("p1", "Posterior nerve of Latarjet\nNerve of Grassi (fundus)\nCoeliac branch")]],
                 [("l", "a"), ("r", "p"), ("a", "a1"), ("p", "p1")], "Truncal vagotomy cuts both trunks above the branches", cw=320, rh=66, gap=34, top=96,
                 notes=["Nerve of Grassi (criminal nerve): missed in vagotomy, causing recurrent ulcer."])

@fig("ana-submandibular-tongue", 3, "Flow diagram of hypoglossal lesions: a lower motor neuron lesion gives ipsilateral wasting and fasciculation with the tip deviating toward the lesion; an upper motor neuron lesion gives no wasting and deviation away from the cortical lesion.",
     "The tongue pushes toward the weak side: toward the lesion in LMN, away from the lesion in UMN.")
def hypoglossal():
    return graph("x", "Tongue deviation on protrusion", "d", [[("g", "Genioglossus protrudes the tongue;\neach side pushes it to the opposite side")], [("l", "LMN lesion (nerve or nucleus)"), ("u", "UMN lesion (cortex, capsule)")], [("l2", "Ipsilateral weakness,\natrophy and fasciculation"), ("u2", "No wasting; weakness is\ncontralateral to the lesion")], [("l3", "Tip deviates TOWARD the lesion"), ("u3", "Tip deviates AWAY from the lesion")]],
                 [("g", "l"), ("g", "u"), ("l", "l2"), ("u", "u2"), ("l2", "l3"), ("u2", "u3")], "Hypoglossal nerve (CN XII) supplies all tongue muscles except palatoglossus", cw=300, rh=58, gap=30, top=96, nodestyle={"l3": ST_R, "u3": ST_A})

@fig("ana-thigh", 3, "Branching diagram of the profunda femoris artery: arises about 4 cm below the inguinal ligament and gives medial circumflex femoral, lateral circumflex femoral and four perforating arteries, supplying all three thigh compartments.",
     "Profunda femoris is the main artery of the thigh; its perforators supply the posterior compartment.")
def profunda():
    return graph("x", "Profunda femoris branches", "d", [[("f", "Femoral artery")], [("p", "Profunda femoris\n(about 4 cm below the inguinal ligament)")], [("m", "Medial circumflex\nfemoral"), ("l", "Lateral circumflex\nfemoral"), ("pf", "Perforating arteries\n(four)")], [("a", "Femoral head and neck;\ncruciate anastomosis"), ("b", "Ascending, transverse and\ndescending branches"), ("c", "Posterior and medial\ncompartments")]],
                 [("f", "p"), ("p", "m"), ("p", "l"), ("p", "pf"), ("m", "a"), ("l", "b"), ("pf", "c")], "Largest branch of the femoral artery", cw=240, rh=58, gap=34, top=96, nodestyle={"p": ST_A})

@fig("ana-thigh", 4, "Diagram of the great saphenous vein: starts in front of the medial malleolus, ascends the medial leg and thigh with the saphenous nerve, and enters the femoral vein at the saphenofemoral junction after receiving superficial tributaries.",
     "The saphenous nerve travels with the vein below the knee, which is why cut-down can injure it.")
def great_saphenous():
    return graph("x", "Great saphenous vein", "d", [[("a", "Dorsal venous arch, in front\nof the medial malleolus")], [("b", "Up the medial leg with the saphenous nerve,\nbehind the medial femoral condyle")], [("c", "Saphenous opening in the fascia lata")], [("d", "Saphenofemoral junction:\njoins the femoral vein")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Superficial tributaries: epigastric, circumflex iliac, external pudendal, thigh veins", cw=400, rh=54, gap=30, top=96, nodestyle={"d": ST_A},
                 notes=["Used for cut-down and bypass grafts; Trendelenburg test checks the junction."])

@fig("ana-trachea-bronchi", 1, "Cross-section of the trachea: anterior C-shaped hyaline cartilage ring open posteriorly, trachealis smooth muscle and fibroelastic tissue closing the gap, and the oesophagus lying behind.",
     "C-shaped rings keep the trachea open; trachealis lets it narrow in cough and lets a swallowed bolus bulge into the airway side.")
def trachea_section():
    f = F("x", "Trachea in cross-section", "d", 800, 480, "Anterior at the top")
    cx, cy = 400, 240
    f.path(f"M{cx-52} {cy+60} A75 75 0 1 1 {cx+52} {cy+60}", "none", "#7C9AAE", 22)
    f.path(f"M{cx-52} {cy+60} A75 75 0 1 1 {cx+52} {cy+60}", "none", "#BFD1E1", 16)
    f.rect(cx - 56, cy + 52, 112, 22, "#E7B9B0", INK, 1.6, 6)
    f.ellipse(cx, cy + 118, 52, 26, "#F1C6C0", INK, 1.8)
    f.text(cx, cy + 125, "Oesophagus", 12.5, 700, INK, "middle")
    f.text(cx, cy - 4, "Lumen", 13, 700, TEAL, "middle")
    f.label(cx - 70, cy - 40, "C-shaped hyaline cartilage ring", 190, 130, 13, "end") if False else f.label(cx - 70, cy - 40, "C-shaped hyaline ring", 200, 160, 13, "end")
    f.label(cx, cy + 63, "Trachealis", 580, 300, 13, "start")
    f.text(585, 318, "smooth muscle + fibroelastic", 11.5, 400, GREY)
    f.text(400, 440, "Cartilage rings number about 16 to 20; the carina divides the trachea at about T4 and T5.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-urinary-male-genital", 2, "Axial diagram of the prostate with urethra in the centre, transition zone around it (benign prostatic hyperplasia), central zone around the ejaculatory ducts, peripheral zone at the back (most cancers, palpable on rectal examination) and anterior fibromuscular stroma in front.",
     "Peripheral zone: cancer and palpable on rectal exam. Transition zone: benign enlargement.")
def prostate_zones():
    f = F("x", "Zones of the prostate (McNeal)", "d", 800, 520, "Axial section: front at the top, rectum below")
    cx, cy = 400, 260
    f.ellipse(cx, cy, 190, 130, "#F1C6C0", INK, 2.4)
    f.path(f"M{cx-175} {cy+20} C{cx-150} {cy+100} {cx+150} {cy+100} {cx+175} {cy+20} C{cx+120} {cy+40} {cx-120} {cy+40} {cx-175} {cy+20} Z", "#E8B6A8", INK, 1.6)
    f.ellipse(cx, cy - 20, 90, 60, "#F5DDA6", INK, 1.8)
    f.path(f"M{cx-70} {cy+30} L{cx+70} {cy+30} L{cx+30} {cy+10} L{cx-30} {cy+10} Z", "#BFE3D6", INK, 1.6)
    f.ellipse(cx, cy - 30, 18, 24, "#FFFFFF", INK, 2)
    f.circle(cx - 14, cy + 22, 4, INK, INK, 0); f.circle(cx + 14, cy + 22, 4, INK, INK, 0)
    f.label(cx, cy - 30, "Urethra", 650, 130, 12.5, "start") if False else None
    f.label(cx, cy - 36, "Urethra", 640, 245, 12.5, "start")
    f.label(cx - 140, cy + 50, "Peripheral zone (about 70 percent)", 90, 400, 12.5, "start") if False else f.label(cx - 150, cy + 60, "Peripheral zone", 220, 430, 12.5, "end"); f.text(215, 448, "most cancers, felt on DRE", 11.5, 400, GREY, "end")
    f.label(cx + 20, cy + 22, "Central zone", 600, 430, 12.5, "start"); f.text(605, 448, "around ejaculatory ducts", 11.5, 400, GREY)
    f.label(cx + 60, cy - 40, "Transition zone", 640, 160, 12.5, "start"); f.text(645, 178, "benign hyperplasia (BPH)", 11.5, 400, GREY)
    f.label(cx - 110, cy - 80, "Anterior fibromuscular stroma", 170, 120, 12.5, "end") if False else f.label(cx - 120, cy - 95, "Anterior fibromuscular", 215, 100, 12.5, "end"); f.text(210, 116, "stroma", 12.5, 500, INK, "end")
    f.text(400, 495, "Peripheral zone is the largest; transition zone surrounds the urethra and presses on it in BPH.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-urogenital", 0, "Flow diagram of kidney development in three stages: pronephros vestigial, mesonephros transient with the mesonephric duct, metanephros permanent with the ureteric bud forming the collecting system and metanephric mesenchyme forming the nephrons.",
     "Ureteric bud makes the collecting system and ureter; metanephric mesenchyme makes the nephron up to the distal tubule.")
def kidney_development():
    return graph("x", "Three kidneys of the embryo", "d", [[("a", "Pronephros (week 4)\nvestigial, cervical"), ("b", "Mesonephros\ntransient; its duct persists"), ("c", "Metanephros (week 5)\npermanent kidney")], [None, ("b2", "Mesonephric duct:\nductus deferens, epididymis"), ("c1", "Ureteric bud:\nureter, pelvis, calyces, collecting ducts")], [None, None, ("c2", "Metanephric mesenchyme:\nglomerulus to distal tubule")]],
                 [("a", "b"), ("b", "c"), ("b", "b2"), ("c", "c1"), ("c", "c2")], "All arise from intermediate mesoderm", cw=240, rh=64, gap=30, top=96, nodestyle={"c": ST_A})

@fig("ana-urogenital", 4, "Flow diagram of testicular descent: gubernaculum anchors the caudal pole, processus vaginalis evaginates the abdominal wall, testis passes through the inguinal canal and reaches the scrotum; persistence of the process gives indirect hernia or hydrocele, failure to descend gives cryptorchidism.",
     "Failed descent: cryptorchidism. Persistent processus vaginalis: indirect hernia or hydrocele.")
def testis_descent():
    return graph("x", "Descent of the testis", "d", [[("a", "Testis forms near the kidney;\ngubernaculum attaches to its lower pole")], [("b", "Processus vaginalis pushes out\nthrough the abdominal wall (inguinal canal)")], [("c", "Gubernaculum shortens; testis\nfollows into the scrotum by birth")], [("d", "Process persists:\nindirect hernia, hydrocele"), ("e", "Failure to descend:\ncryptorchidism (cancer risk)")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("c", "e")], "Testis lies behind the processus vaginalis, which becomes the tunica vaginalis", cw=330, rh=58, gap=30, top=96, nodestyle={"d": ST_R, "e": ST_R})

@fig("ana-urogenital", 5, "Table of renal anomalies with cause: horseshoe kidney fused at lower poles and trapped under the inferior mesenteric artery, pelvic kidney from failed ascent, renal agenesis from absent ureteric bud, and Potter sequence from bilateral agenesis.",
     "Horseshoe kidney: lower poles fuse and ascent stops at the inferior mesenteric artery.")
def renal_anomalies():
    return pathways("x", "Renal anomalies and their cause", "d", ["Anomaly", "Cause", "Note"],
        [("Horseshoe kidney", "Fusion of lower poles", "Trapped under the inferior mesenteric artery; usually asymptomatic"), ("Pelvic kidney", "Failure of ascent", "Ectopic, may obstruct labour"), ("Unilateral agenesis", "Ureteric bud fails to form", "Contralateral kidney hypertrophies"), ("Bilateral agenesis (Potter)", "No ureteric bud", "Oligohydramnios, lung hypoplasia, limb and face changes")],
        widths=[170, 190, 320], rh=52, gap=12, top=100)

@fig("ana-ventricles-meninges", 1, "Flow diagram of CSF circulation: produced by choroid plexus in the lateral ventricles, passes through the interventricular foramina to the third ventricle, the cerebral aqueduct to the fourth ventricle, exits through the median and lateral apertures into the subarachnoid space and is absorbed by arachnoid granulations into the superior sagittal sinus.",
     "CSF is made in the ventricles and absorbed at the arachnoid granulations; a block anywhere upstream dilates the ventricles.")
def csf_flow():
    return graph("x", "CSF circulation", "d", [[("a", "Choroid plexus: lateral ventricles\n(also third and fourth ventricles)")], [("b", "Interventricular foramina (of Monro)")], [("c", "Third ventricle")], [("d", "Cerebral aqueduct (of Sylvius)")], [("e", "Fourth ventricle")], [("f", "Median aperture (Magendie) and\nlateral apertures (Luschka)")], [("g", "Subarachnoid space, arachnoid granulations,\nsuperior sagittal sinus")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f"), ("f", "g")], "About 500 mL made per day, 150 mL present at any time", cw=420, rh=48, gap=16, top=90, nodestyle={"d": ST_A},
                 notes=["Aqueduct stenosis: obstructive hydrocephalus above the block."])

@fig("ana-vertebral-column", 1, "Table of upper cervical and spinal fractures by name, level and mechanism: Jefferson burst fracture of C1, hangman fracture of C2 pars, odontoid fracture of the dens, clay shoveler fracture of C7 spinous process.",
     "Jefferson: C1 ring from axial load. Hangman: C2 pars from hyperextension. Odontoid: dens of C2.")
def cervical_fractures():
    return pathways("x", "Named cervical fractures", "d", ["Fracture", "Level and site", "Mechanism"],
        [("Jefferson", "C1 ring, burst", "Axial load on the head"), ("Hangman (traumatic spondylolisthesis)", "C2 pars interarticularis, bilateral", "Hyperextension with distraction"), ("Odontoid", "Dens of C2 (types I to III)", "Flexion or extension injury"), ("Clay shoveler", "C7 (or T1) spinous process", "Muscle avulsion in heavy lifting")],
        "The spinal canal is wide at C2, so cord injury in hangman fracture is often absent", widths=[200, 250, 240], rh=52, gap=12, top=104)

@fig("ana-visual-auditory-pathways", 1, "Flow diagram of the auditory pathway: cochlea, cochlear nerve, cochlear nuclei, superior olivary complex, lateral lemniscus, inferior colliculus, medial geniculate body, auditory cortex in the superior temporal gyrus.",
     "E COLI: Eighth nerve, Cochlear nucleus, Olivary complex, Lateral lemniscus, Inferior colliculus, then thalamus and cortex. Bilateral from the olive upward.")
def auditory_pathway():
    return graph("x", "Auditory pathway", "d", [[("a", "Cochlea (hair cells)")], [("b", "Cochlear nerve (CN VIII)")], [("c", "Cochlear nuclei (medulla/pons)")], [("d", "Superior olivary complex: first bilateral input")], [("e", "Lateral lemniscus")], [("f", "Inferior colliculus (midbrain)")], [("g", "Medial geniculate body (thalamus)")], [("h", "Auditory cortex: Heschl gyrus, superior temporal gyrus")]],
                 [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f"), ("f", "g"), ("g", "h")], "Mnemonic E COLI; unilateral deafness only if the lesion is below the olive", cw=400, rh=40, gap=14, top=90, nodestyle={"d": ST_A})

@fig("ana-visual-pathways", 1, "Table of visual pathway lesion sites and field defects: optic nerve gives ipsilateral blindness, chiasm bitemporal hemianopia, optic tract contralateral homonymous hemianopia, Meyer loop contralateral upper quadrantanopia, parietal radiation lower quadrantanopia, occipital cortex homonymous hemianopia with macular sparing.",
     "Pie in the sky: temporal lobe. Pie on the floor: parietal lobe. Macular sparing: occipital cortex.")
def visual_lesions():
    return pathways("x", "Visual pathway lesions and field defects", "d", ["Lesion site", "Field defect"],
        [("Optic nerve", "Blindness in that eye"), ("Optic chiasm", "Bitemporal hemianopia"), ("Optic tract or lateral geniculate", "Contralateral homonymous hemianopia"), ("Meyer loop (temporal lobe)", "Contralateral superior quadrantanopia (pie in the sky)"),
         ("Parietal radiation", "Contralateral inferior quadrantanopia (pie on the floor)"), ("Occipital cortex (PCA)", "Contralateral homonymous hemianopia, macular sparing")],
        "Retina, optic nerve, chiasm, tract, geniculate, radiation, cortex", widths=[300, 390], rh=44, gap=10, top=100)

@fig("ana-wall-diaphragm", 1, "Section through an intercostal space showing the costal groove on the lower border of the rib above containing, from top to bottom, vein, artery, nerve, with the collateral branch below.",
     "VAN from top to bottom in the costal groove; insert the needle just above the rib below, away from the groove.")
def intercostal_bundle():
    f = F("x", "Intercostal neurovascular bundle", "d", 800, 440, "Section through one intercostal space")
    f.rect(120, 90, 560, 55, "#E6DCC8", INK, 2, 10); f.text(400, 124, "Rib above", 14, 700, INK, "middle")
    f.rect(120, 295, 560, 55, "#E6DCC8", INK, 2, 10); f.text(400, 329, "Rib below", 14, 700, INK, "middle")
    f.rect(120, 145, 560, 150, "#F4FAF8", GREY, 1, 0); f.text(660, 220, "intercostal muscles", 11, 400, GREY, "end")
    f.path("M300 145 Q400 185 500 145", "none", INK, 2)
    f.circle(340, 158, 9, "#3E6FA5", INK, 1.8); f.circle(400, 168, 8, RED, INK, 1.8); f.circle(460, 158, 7, "#E8C547", INK, 1.8)
    f.text(340, 200 if False else 184, "Vein", 12.5, 700, INK, "middle"); f.text(400, 198, "Artery", 12.5, 700, INK, "middle"); f.text(460, 184, "Nerve", 12.5, 700, INK, "middle")
    f.circle(430, 280, 5, "#E8C547", INK, 1.2); f.text(445, 284, "collateral branch", 11, 500, GREY)
    f.text(400, 395, "Costal groove: order from top, Vein, Artery, Nerve (VAN). Needle goes above the lower rib.", 12.5, 600, INK, "middle")
    return f

@fig("ana-wall-diaphragm", 3, "Table of diaphragm openings with level and contents: caval opening at T8 with IVC and right phrenic nerve, oesophageal opening at T10 with oesophagus and vagal trunks, aortic opening at T12 with aorta, thoracic duct and azygos vein.",
     "I 8 10 Eggs At 12: IVC at T8, oesophagus at T10, aorta at T12.")
def diaphragm_openings():
    return pathways("x", "Openings of the diaphragm", "d", ["Opening", "Level", "Contents"],
        [("Caval", "T8", "Inferior vena cava, right phrenic nerve branches"), ("Oesophageal", "T10", "Oesophagus, anterior and posterior vagal trunks, left gastric vessels"), ("Aortic", "T12", "Aorta, thoracic duct, azygos vein")],
        "I 8 10 Eggs At 12", widths=[150, 90, 440], rh=54, gap=14, top=100)

@fig("ss-neurology-localization", 2, "Table of the rule of 4 for brainstem localisation: four cranial nerves in the medulla IX to XII, four in the pons V to VIII, four above the pons I to IV; four midline M structures and four lateral S structures.",
     "Cranial nerves 1 to 4 above the pons, 5 to 8 in the pons, 9 to 12 in the medulla. Midline structures begin with M, lateral with S.")
def rule_of_four():
    return pathways("x", "The rule of 4 in the brainstem", "d", ["Rule", "Members"],
        [("4 cranial nerves above the pons", "I, II, III, IV"), ("4 cranial nerves in the pons", "V, VI, VII, VIII"), ("4 cranial nerves in the medulla", "IX, X, XI, XII"), ("4 midline structures (M)", "Motor pathway, Medial lemniscus, MLF, Motor nuclei of III, IV, VI, XII"),
         ("4 lateral structures (S)", "Spinocerebellar tract, Spinothalamic tract, Sensory nucleus of V, Sympathetic fibres")],
        widths=[280, 410], rh=48, gap=10, top=100)
