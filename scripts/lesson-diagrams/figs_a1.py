from reg import fig
from lib import *

# ---------------- abdominal wall ----------------
@fig("ana-abdominal-wall", 2, "Diagram of the four walls of the inguinal canal: anterior wall external oblique aponeurosis, posterior wall transversalis fascia with the conjoint tendon medially, roof arching fibres of internal oblique and transversus abdominis, floor inguinal ligament.",
     "Walls of the canal: front external oblique, back transversalis fascia plus conjoint tendon, roof internal oblique and transversus, floor inguinal ligament.")
def inguinal_canal_walls():
    f = F("x", "Walls of the inguinal canal", "d", 800, 470, "Right canal, cut across its length; deep ring lateral, superficial ring medial")
    f.rect(250, 150, 300, 150, "#FFFFFF", INK, 2.4, 6)
    f.text(400, 215, "Inguinal canal", 16, 700, TEAL, "middle")
    f.text(400, 238, "spermatic cord (round ligament in women)", 12, 400, GREY, "middle")
    f.box(250, 92, 300, 40, "Roof: arching fibres of internal\noblique and transversus abdominis", TINT, TEAL, 12)
    f.box(250, 318, 300, 40, "Floor: inguinal ligament\n(lacunar ligament medially)", TINT, TEAL, 12)
    f.box(12, 175, 226, 100, "Anterior wall\nExternal oblique aponeurosis\n(+ internal oblique laterally)", "#FFFFFF", TEAL, 12.5)
    f.box(562, 175, 226, 100, "Posterior wall\nTransversalis fascia\n(+ conjoint tendon medially)", "#FFFFFF", TEAL, 12.5)
    f.arrow(238, 225, 250, 225, GREY, 1.8, 8); f.arrow(562, 225, 550, 225, GREY, 1.8, 8)
    f.line(250, 400, 335, 400, TEAL, 5); f.text(250, 424, "Deep ring (lateral)", 12.5, 700, INK); f.text(250, 442, "in transversalis fascia", 11.5, 400, GREY)
    f.line(465, 400, 550, 400, AMBER, 5); f.text(550, 424, "Superficial ring (medial)", 12.5, 700, INK, "end"); f.text(550, 442, "in external oblique aponeurosis", 11.5, 400, GREY, "end")
    return f

@fig("ana-abdominal-wall", 4, "Cross-section of the spermatic cord with three coverings from outside in: external spermatic fascia from external oblique, cremasteric fascia from internal oblique, internal spermatic fascia from transversalis fascia, enclosing the ductus deferens, arteries, pampiniform plexus and genital branch of genitofemoral nerve.",
     "Three coverings, each borrowed from an abdominal wall layer; the ilioinguinal nerve lies on the cord, not inside it.")
def spermatic_cord():
    f = F("x", "Spermatic cord: coverings and contents", "d", 800, 520, "Cross-section")
    cx, cy = 400, 252
    f.circle(cx, cy, 165, "#F4FAF8", INK, 2); f.circle(cx, cy, 132, "#E9F5F1", TEAL, 2); f.circle(cx, cy, 100, TINT, TEAL, 2)
    pts = {"Ductus deferens": (cx - 12, cy + 4, 14), "Testicular artery": (cx + 28, cy - 30, 6), "Cremasteric artery": (cx + 50, cy + 18, 5), "Artery to ductus": (cx - 38, cy - 22, 4)}
    for _, (x, y, r) in pts.items(): f.circle(x, y, r, RED if r < 10 else "#FFFFFF", INK, 1.6)
    for i in range(7): f.circle(cx - 40 + i * 14 + (i % 2) * 6, cy + 42 + (i % 3) * 7, 5, "#3E6FA5", INK, 1)
    f.circle(cx + 15, cy - 55, 3.5, AMBER, INK, 1)
    f.label(cx - 12, cy + 4, "Ductus deferens", 215, 188, 12.5, "end")
    f.label(cx - 38, cy - 22, "Artery to ductus", 215, 236, 12.5, "end")
    f.label(cx + 28, cy - 30, "Testicular artery", 600, 200, 12.5, "start")
    f.label(cx + 50, cy + 18, "Cremasteric artery", 600, 262, 12.5, "start")
    f.label(cx + 15, cy - 55, "Genital branch of", 600, 322, 12.5, "start"); f.text(605, 338, "genitofemoral nerve", 12.5, 500, INK)
    f.label(cx - 10, cy + 55, "Pampiniform plexus", 215, 332, 12.5, "end")
    f.text(215, 360, "+ lymphatics,", 11.5, 400, GREY, "end"); f.text(215, 375, "vaginal process remnant", 11.5, 400, GREY, "end")
    f.label(cx + 124, cy - 124, "External spermatic fascia (external oblique)", 690, 112 + 250, 12, "start") if False else None
    f.box(40, 440, 230, 44, "External spermatic fascia\nfrom external oblique", "#FFFFFF", LINE, 11.5, 600)
    f.box(285, 440, 230, 44, "Cremasteric fascia\nfrom internal oblique", "#FFFFFF", LINE, 11.5, 600)
    f.box(530, 440, 230, 44, "Internal spermatic fascia\nfrom transversalis fascia", "#FFFFFF", LINE, 11.5, 600)
    f.text(155, 432, "1 outermost", 11, 600, GREY, "middle"); f.text(400, 432, "2 middle", 11, 600, GREY, "middle"); f.text(645, 432, "3 innermost", 11, 600, GREY, "middle")
    return f

# ---------------- arm / elbow ----------------
@fig("ana-arm-elbow", 1, "Right cubital fossa drawn as an inverted triangle: base is the line between the humeral epicondyles, lateral border brachioradialis, medial border pronator teres. Contents from medial to lateral are median nerve, brachial artery, biceps tendon, and radial nerve.",
     "Contents from medial to lateral: median nerve, brachial artery, biceps tendon, radial nerve.")
def cubital_fossa():
    f = F("x", "Right cubital fossa", "d", 800, 470, "Front of the elbow, right arm: medial on the left of the page")
    f.path("M120 130 L680 130 L400 400 Z", "#F4FAF8", INK, 2.4)
    f.text(400, 120, "Base: line between the humeral epicondyles", 12.5, 600, TEAL, "middle")
    f.text(210, 285, "Medial border:\npronator teres", 12.5, 700, INK, "middle")
    f.text(592, 285, "Lateral border:\nbrachioradialis", 12.5, 700, INK, "middle")
    xs = [(290, "Median\nnerve", "#E8C547"), (355, "Brachial\nartery", RED), (420, "Biceps\ntendon", "#FFFFFF"), (500, "Radial\nnerve", "#E8C547")]
    for i, (x, t, c) in enumerate(xs):
        f.circle(x, 175, 17 if i != 2 else 20, c, INK, 1.8); f.text(x, 218, t, 12.5, 600, INK, "middle")
        f.text(x, 160 if False else 150, str(i + 1), 11, 700, GREY, "middle")

    f.text(400, 425, "Floor: brachialis and supinator", 12.5, 600, GREY, "middle")
    f.text(400, 452, "Medial to lateral: Median nerve, Artery, Tendon, Radial nerve", 12.5, 500, GREY, "middle")
    return f

@fig("ana-arm-elbow", 2, "Layered cross-section at the front of the elbow: skin, superficial fascia with the median cubital vein, bicipital aponeurosis, then the brachial artery and median nerve deep to the aponeurosis.",
     "The bicipital aponeurosis is a safety layer between the median cubital vein and the brachial artery and median nerve.")
def cubital_layers():
    f = F("x", "Why the median cubital vein is used for venepuncture", "d", 800, 470, "Layers from skin (top) to deep, at the cubital fossa")
    L = [("Skin", "#F4FAF8", 70), ("Superficial fascia with median cubital vein", "#DCEAF7", 62), ("Bicipital aponeurosis (barrier)", "#FFF1CC", 52), ("Deep: brachial artery and median nerve, biceps tendon", "#FBE3E0", 70), ("Brachialis (floor)", TINT, 56)]
    y = 90
    for t, c, h in L:
        f.rect(90, y, 620, h, c, INK, 1.6, 4); f.text(400, y + h / 2 + 5, t, 14, 600, INK, "middle"); y += h
    f.arrow(742, 135, 742, 122, TEAL, 0, 0) if False else None
    f.text(400, 440, "Vein sits above the aponeurosis, so the artery and nerve are protected from the needle.", 12.5, 500, GREY, "middle")
    f.circle(150, 191, 12, "#3E6FA5", INK, 1.6)
    f.circle(150, 309, 13, RED, INK, 1.6); f.circle(195, 312, 10, "#E8C547", INK, 1.6)
    return f

# ---------------- brachial plexus ----------------
@fig("ana-axilla-plexus", 2, "Schematic of the brachial plexus: five roots C5 to T1 form upper, middle and lower trunks, each splits into anterior and posterior divisions, which form lateral, posterior and medial cords giving the musculocutaneous, axillary, radial, median and ulnar nerves. Dorsal scapular and long thoracic arise from the roots.",
     "Randy Travis Drinks Cold Beer: roots, trunks, divisions, cords, branches. The long thoracic nerve comes straight off the roots.")
def brachial_plexus():
    f = F("x", "Brachial plexus", "d", 800, 560, "Roots, trunks, divisions, cords, branches (right side, schematic)")
    X = [170, 305, 420, 525, 625]
    for x, t in zip(X, ["Roots", "Trunks", "Divisions", "Cords", "Branches"]): f.text(x, 82, t, 13, 700, TEAL, "middle")
    R = {"C5": 130, "C6": 180, "C7": 230, "C8": 280, "T1": 330}
    T = {"U": 155, "M": 230, "L": 305}
    D = {"Ua": 125, "Up": 165, "Ma": 205, "Mp": 245, "La": 325, "Lp": 285}
    C = {"Lat": 160, "Post": 245, "Med": 335}
    col = TEAL
    for k, y in R.items():
        f.circle(X[0], y, 15, TINT, TEAL, 1.6); f.text(X[0], y + 4.5, k, 12, 700, INK, "middle")
    def seg(a, b, c=col): f.line(a[0], a[1], b[0], b[1], c, 3)
    for k, t in (("C5", "U"), ("C6", "U")): seg((X[0] + 15, R[k]), (X[1] - 20, T["U"]))
    seg((X[0] + 15, R["C7"]), (X[1] - 20, T["M"]))
    for k in ("C8", "T1"): seg((X[0] + 15, R[k]), (X[1] - 20, T["L"]))
    for k, y in T.items():
        f.rect(X[1] - 20, y - 14, 40, 28, TINT, TEAL, 1.6, 8); f.text(X[1], y + 4.5, {"U": "Upper", "M": "Middle", "L": "Lower"}[k], 11, 700, INK, "middle")
    for t, a, p in (("U", "Ua", "Up"), ("M", "Ma", "Mp"), ("L", "La", "Lp")):
        seg((X[1] + 20, T[t]), (X[2] - 17, D[a])); seg((X[1] + 20, T[t]), (X[2] - 17, D[p]))
    for k, y in D.items():
        f.rect(X[2] - 17, y - 11, 34, 22, "#FFFFFF", TEAL, 1.4, 6); f.text(X[2], y + 4, "A" if k[1] == "a" else "P", 11, 700, INK, "middle")
    for a in ("Ua", "Ma"): seg((X[2] + 17, D[a]), (X[3] - 20, C["Lat"]))
    for p in ("Up", "Mp", "Lp"): seg((X[2] + 17, D[p]), (X[3] - 20, C["Post"]))
    seg((X[2] + 17, D["La"]), (X[3] - 20, C["Med"]))
    for k, y in C.items():
        f.rect(X[3] - 20, y - 14, 46, 28, TINT, TEAL, 1.6, 8); f.text(X[3] + 3, y + 4.5, {"Lat": "Lateral", "Post": "Post.", "Med": "Medial"}[k], 10.5, 700, INK, "middle")
    N = {"Musculocutaneous": 125, "Axillary": 205, "Radial": 250, "Median": 295, "Ulnar": 360}
    for k, y in N.items(): f.text(X[4] + 14, y + 4.5, k, 13, 600, INK)
    seg((X[3] + 26, C["Lat"]), (X[4] + 8, N["Musculocutaneous"])); seg((X[3] + 26, C["Lat"]), (X[4] + 8, N["Median"] - 4), AMBER)
    seg((X[3] + 26, C["Med"]), (X[4] + 8, N["Median"] + 4), AMBER); seg((X[3] + 26, C["Med"]), (X[4] + 8, N["Ulnar"]))
    seg((X[3] + 26, C["Post"]), (X[4] + 8, N["Axillary"])); seg((X[3] + 26, C["Post"]), (X[4] + 8, N["Radial"]))
    f.text(X[0] - 16, 107 if False else 110, "Dorsal scapular (C5)", 11.5, 500, GREY, "end") if False else None
    f.arrow(X[0] - 15, R["C5"] - 6, 120, 112, GREY, 1.2, 6); f.text(122, 104, "Dorsal scapular", 11.5, 500, GREY, "end"); f.text(122, 118, "(C5)", 11.5, 500, GREY, "end")
    f.arrow(X[0] - 15, R["C6"] + 2, 120, 190, GREY, 1.2, 6); f.text(122, 186, "Long thoracic", 11.5, 500, GREY, "end"); f.text(122, 200, "(C5, C6, C7)", 11.5, 500, GREY, "end")
    f.arrow(X[1], T["U"] - 14, X[1], 108, GREY, 1.2, 6); f.text(X[1], 102, "Suprascapular, n. to subclavius", 11.5, 500, GREY, "middle")
    f.text(400, 430, "Randy Travis Drinks Cold Beer", 15, 700, TEAL, "middle")
    f.text(400, 452, "Roots  Trunks  Divisions  Cords  Branches", 12.5, 400, GREY, "middle")
    f.legend([(AMBER, "Median nerve takes a root from both lateral and medial cords"), (TEAL, "Other branches")], 190, 490)
    return f

@fig("ana-axilla-plexus", 4, "Side view of the thoracic outlet: first rib below, scalenus anterior in front and scalenus medius behind, subclavian vein in front of scalenus anterior, subclavian artery and lower trunk in the gap between the scalenes; a cervical rib crowds this gap.",
     "The artery and lower trunk pass between the scalenes over the first rib, so a cervical rib presses on exactly these two structures.")
def thoracic_outlet():
    f = F("x", "Thoracic outlet and a cervical rib", "d", 800, 470, "Side view, anterior to the left; interscalene gap above the first rib")
    f.path("M120 360 C300 330 520 340 700 400", "none", "#9A8F7A", 16)
    f.text(690, 428, "First rib", 12.5, 700, INK, "end")
    f.path("M280 120 L360 330 L330 335 L250 135 Z", "#E7B9B0", INK, 1.8); f.text(256, 112, "Scalenus anterior", 12.5, 700, INK, "end")
    f.path("M470 120 L440 335 L400 335 L430 125 Z", "#E7B9B0", INK, 1.8); f.text(476, 112, "Scalenus medius", 12.5, 700, INK)
    f.circle(240, 300, 20, "#3E6FA5", INK, 1.8); f.text(204, 304, "Subclavian vein", 12.5, 600, INK, "end"); f.text(204, 320, "(in front of scalenus anterior)", 11, 400, GREY, "end")
    f.circle(385, 298, 16, RED, INK, 1.8); f.text(385, 303, "A", 12, 700, "#FFFFFF", "middle")
    f.circle(418, 300, 13, "#E8C547", INK, 1.8); f.text(418, 305, "T1", 10, 700, INK, "middle")
    f.label(385, 285, "Subclavian artery", 520, 205, 12.5, "start"); f.label(418, 290, "Lower trunk (C8, T1)", 520, 238, 12.5, "start")
    f.path("M330 270 C380 225 470 235 480 300", "none", AMBER, 7, "10 6")
    f.text(580, 275, "Cervical rib", 12.5, 700, AMBER, "start") if False else None
    f.label(480, 292, "Cervical rib (extra, from C7)", 560, 320, 12.5, "start", AMBER)
    f.text(388, 186, "interscalene", 12.5, 600, TEAL, "middle"); f.text(388, 202, "gap", 12.5, 600, TEAL, "middle")
    return f

# ---------------- basal ganglia ----------------
@fig("ana-basal-ganglia-limbic", 1, "Wiring diagram of the basal ganglia. Cortex excites striatum. Direct pathway: striatum D1 inhibits GPi, which frees the thalamus to excite cortex. Indirect pathway: striatum D2 inhibits GPe, which frees the subthalamic nucleus to excite GPi, which inhibits thalamus. Substantia nigra pars compacta dopamine excites D1 cells and inhibits D2 cells.",
     "Direct pathway releases movement (two inhibitions make an excitation); indirect pathway brakes it; dopamine pushes toward movement.")
def bg_pathways():
    f = F("x", "Basal ganglia: direct and indirect pathways", "d", 800, 560, "Green arrow excites, red bar inhibits; dopamine tips the balance toward movement")
    B = {"ctx": (330, 80, 140, 40, "Motor cortex"), "str": (315, 170, 170, 44, "Striatum\n(caudate, putamen)"), "gpe": (110, 270, 130, 40, "GPe"), "stn": (110, 380, 130, 40, "Subthalamic\nnucleus"),
         "gpi": (330, 330, 140, 44, "GPi / SNr"), "thal": (330, 450, 140, 40, "Thalamus (VA, VL)"), "snc": (590, 170, 150, 44, "Substantia nigra\npars compacta")}
    for k, (x, y, w, h, t) in B.items(): f.box(x, y, w, h, t, TINT if k != "snc" else "#FFF1CC", TEAL if k != "snc" else AMBER, 12.5)
    def exc(a, b, dx=0): f.arrow(a[0], a[1], b[0], b[1], TEAL, 2.4, 10)
    def inh(a, b):
        f.line(a[0], a[1], b[0], b[1], RED, 2.4)
        ang = math.atan2(b[1] - a[1], b[0] - a[0]); px, py = -math.sin(ang) * 9, math.cos(ang) * 9
        f.line(b[0] - px, b[1] - py, b[0] + px, b[1] + py, RED, 3.5)
    exc((400, 120), (400, 170)); f.text(410, 150, "glutamate +", 11.5, 500, TEAL)
    inh((380, 214), (380, 330)); f.text(372, 262, "D1 direct", 12, 700, INK, "end"); f.text(372, 278, "GABA", 11, 400, GREY, "end")
    inh((330, 200), (175, 270)); f.text(250, 220, "D2 indirect", 12, 700, INK, "end")
    inh((175, 310), (175, 380)); exc((240, 400), (330, 365)) ; f.text(262, 372, "+", 14, 700, TEAL)
    inh((400, 374), (400, 450)); exc((470, 470), (520, 470)) if False else None
    exc((470, 470), (545, 470)); f.line(545, 470, 545, 100, TEAL, 2.4); f.line(545, 100, 470, 100, TEAL, 2.4); f.arrow(500, 100, 472, 100, TEAL, 2.4, 10)
    f.text(560, 330, "thalamus excites", 11.5, 500, TEAL); f.text(560, 346, "cortex when freed", 11.5, 500, TEAL)
    f.arrow(590, 192, 472, 192, TEAL, 2.4, 10); f.text(530, 184, "D1 +", 12, 700, TEAL, "middle")
    inh((650, 214), (470, 206)) if False else None
    f.path("M665 214 C665 250 520 235 472 205", "none", RED, 2.4); f.text(640, 250, "D2 minus", 12, 700, RED, "middle")
    f.line(468, 200, 476, 214, RED, 3.5) if False else None
    return f

# ---------------- blood supply of the brain ----------------
@fig("ana-blood-supply-brain", 0, "Circle of Willis seen from below: the anterior communicating artery joins the two anterior cerebral arteries, each internal carotid gives middle cerebral and anterior cerebral branches, posterior communicating arteries join the carotids to the posterior cerebral arteries, which arise from the basilar artery formed by the two vertebral arteries.",
     "Anterior circulation (carotids) and posterior circulation (basilar) are joined by the communicating arteries.")
def circle_of_willis():
    f = F("x", "Circle of Willis", "d", 800, 600, "View from below, front of the brain at the top; patient right is on the left of the page")
    A, P = TEAL, AMBER
    for sg in (-1, 1):
        x = lambda d: 400 + sg * d
        thick(f, [(x(15), 150), (x(32), 195), (x(72), 245)], A, 9)       # A1
        thick(f, [(x(15), 150), (x(15), 105), (x(22), 70)], A, 8)       # A2 continuing
        thick(f, [(x(72), 245), (x(150), 235), (x(250), 218)], A, 10)   # MCA
        thick(f, [(x(110), 330), (x(88), 290), (x(72), 245)], "#8F9A3F", 6)  # PComm (from ICA to PCA)
        thick(f, [(x(110), 330), (x(150), 360), (x(240), 372)], P, 10)  # PCA (to side)
        thick(f, [(x(24), 355), (x(70), 340), (x(110), 330)], P, 9)   # P1 to PCA junction
        thick(f, [(x(100), 300), (x(72), 245)], A, 11) if False else None
        thick(f, [(x(105), 285), (x(88), 262), (x(72), 245)], A, 11)  # ICA terminal segment
        thick(f, [(x(24), 355), (x(40), 410), (x(32), 395)], P, 4) if False else None
        thick(f, [(x(10), 480), (x(32), 555)], P, 9)  # vertebral
    thick(f, [(400, 357), (400, 480)], P, 12)  # basilar
    thick(f, [(385, 150), (415, 150)], "#8F9A3F", 7)  # AComm
    f.label(400, 150, "Anterior communicating", 450, 128, 12.5, "start")
    f.label(315, 175, "Anterior cerebral (A1)", 90, 185, 12.5, "end") if False else None
    f.label(348, 220, "Anterior cerebral", 250, 170, 12.5, "end")
    f.label(250, 235, "Middle cerebral", 150, 205, 12.5, "end")
    f.label(550, 235, "Middle cerebral", 650, 205, 12.5, "start")
    f.label(452, 220, "Anterior cerebral", 550, 170, 12.5, "start")
    f.label(311, 290, "Posterior communicating", 210, 320, 12.5, "end"); f.label(305, 268, "Internal carotid (terminal)", 210, 275, 12.5, "end")
    f.label(555, 362, "Posterior cerebral", 650, 395, 12.5, "start")
    f.label(300, 355, "Posterior cerebral", 130, 395, 12.5, "end") if False else None
    f.label(400, 440, "Basilar artery", 470, 440, 12.5, "start")
    f.label(375, 540, "Vertebral", 270, 560, 12.5, "end"); f.label(425, 540, "Vertebral", 530, 560, 12.5, "start")
    f.label(300, 270, "Internal carotid", 130, 215, 12.5, "end") if False else None
    f.text(60, 560, "R", 22, 700, GREY); f.text(740, 560, "L", 22, 700, GREY, "end")
    f.legend([(A, "Anterior circulation (carotid)"), (P, "Posterior circulation (vertebrobasilar)"), ("#8F9A3F", "Communicating arteries")], 52, 90)
    return f

@fig("ana-blood-supply-brain", 3, "Cross-section of the spinal cord showing one anterior spinal artery supplying the front two thirds and two posterior spinal arteries supplying the back one third.",
     "Anterior spinal artery: ventral two thirds. Two posterior spinal arteries: dorsal third.")
def spinal_cord_arteries():
    f = F("x", "Arterial supply of the spinal cord", "d", 800, 470, "Cross-section, dorsal at the top")
    cx, cy = 400, 260
    clip_ellipse(f, "c1", cx, cy, 150, 105)
    f.ellipse(cx, cy, 150, 105, "#F4FAF8", INK, 2.2)
    f.add('<g clip-path="url(#c1)">'); f.rect(cx - 160, cy - 115, 320, 36 + 20, "#FFF1CC", "none", 0, 0)
    f.rect(cx - 160, cy - 60 + 5, 320, 180, TINT, "none", 0, 0); f.add("</g>")
    f.ellipse(cx, cy, 150, 105, "none", INK, 2.2)
    f.path(f"M{cx} {cy+8} C{cx-40} {cy-30} {cx-85} {cy-60} {cx-60} {cy-85} C{cx-40} {cy-40} {cx-20} {cy-10} {cx} {cy}", "#BFD9D1", INK, 1.2) if False else None
    f.ellipse(cx - 28, cy - 38, 30, 46, "#BFD9D1", "#5C7D75", 1.4, 28); f.ellipse(cx + 28, cy - 38, 30, 46, "#BFD9D1", "#5C7D75", 1.4, -28)
    f.ellipse(cx - 42, cy + 45, 36, 28, "#BFD9D1", "#5C7D75", 1.4, -20); f.ellipse(cx + 42, cy + 45, 36, 28, "#BFD9D1", "#5C7D75", 1.4, 20)
    f.circle(cx, cy + 5, 6, "#FFFFFF", "#5C7D75", 1.4)
    f.circle(cx, cy + 112, 9, RED, INK, 1.8); f.circle(cx - 78, cy - 100, 7, RED, INK, 1.8); f.circle(cx + 78, cy - 100, 7, RED, INK, 1.8)
    f.label(cx, cy + 112, "Anterior spinal artery (1)", 560, 395, 13, "start")
    f.label(cx - 78, cy - 100, "Posterior spinal arteries (2)", 120, 130, 13, "end") if False else None
    f.label(cx - 78, cy - 100, "Posterior spinal", 265, 150, 13, "end"); f.text(260, 166, "artery", 13, 500, INK, "end"); f.label(cx + 78, cy - 100, "Posterior spinal", 535, 150, 13, "start"); f.text(540, 166, "artery", 13, 500, INK)
    f.text(cx + 160, cy - 62, "dorsal third", 12.5, 600, GREY); f.text(cx + 160, cy + 80, "ventral two thirds", 12.5, 600, GREY)
    f.text(400, 445, "Occlusion of the anterior artery spares dorsal columns (vibration and position sense).", 12.5, 500, GREY, "middle")
    return f

# ---------------- sesamoid ----------------
@fig("ana-bones-ossification", 2, "Four common sesamoid bones and the tendon each lies in: patella in quadriceps tendon, pisiform in flexor carpi ulnaris tendon, fabella in lateral head of gastrocnemius, and paired sesamoids in flexor hallucis brevis.",
     "A sesamoid is a bone inside a tendon; the patella is the largest.")
def sesamoids():
    return graph("x", "Sesamoid bones and their tendons", "d", [[("a", "Patella"), ("b", "Pisiform"), ("c", "Fabella"), ("d", "Hallux sesamoids\n(two)")], [("e", "Quadriceps\ntendon"), ("f", "Flexor carpi\nulnaris tendon"), ("g", "Lateral head of\ngastrocnemius"), ("h", "Flexor hallucis\nbrevis")]],
                 [("e", "a"), ("f", "b"), ("g", "c"), ("h", "d")], "Bone forms inside a tendon where it is under friction; it acts as a pulley", cw=170, rh=58, gap=90, top=110,
                 notes=["Largest sesamoid: patella. Ossifies after birth, unlike most bones that ossify before."])

# ---------------- brainstem ----------------
@fig("ana-brainstem", 1, "Course of the corticospinal tract from motor cortex through the internal capsule, cerebral peduncle, basis pontis and medullary pyramid to the pyramidal decussation where about 85 to 90 percent cross to form the lateral corticospinal tract; the rest descend uncrossed as the anterior tract.",
     "Most corticospinal fibres cross at the medulla and spinal cord junction, so a lesion above the decussation causes opposite-side weakness.")
def pyramidal_decussation():
    f = F("x", "Corticospinal tract and the pyramidal decussation", "d", 800, 620, "Descending motor pathway, level by level")
    L = [("Motor cortex (precentral gyrus)", "Cortex"), ("Posterior limb of internal capsule", "Capsule"), ("Cerebral peduncle (crus cerebri)", "Midbrain"), ("Basis pontis", "Pons"), ("Medullary pyramid", "Medulla")]
    y = 80
    for t, lv in L:
        f.box(230, y, 300, 44, t, TINT, TEAL, 13); f.text(215, y + 27, lv, 12, 700, GREY, "end")
        if y < 80 + 4 * 66: f.arrow(380, y + 44, 380, y + 66, TEAL, 2.2, 9)
        y += 66
    f.arrow(380, 80 + 4 * 66 + 44, 380, 80 + 5 * 66, TEAL, 2.2, 9)
    f.box(230, 410, 300, 50, "Pyramidal decussation\nabout 85 to 90% cross", "#FFF1CC", AMBER, 13)
    f.text(215, 440, "Cervicomedullary", 12, 700, GREY, "end"); f.text(215, 456, "junction", 12, 700, GREY, "end")
    f.arrow(300, 460, 270, 520, RED, 2.2, 9); f.arrow(460, 460, 490, 520, TEAL, 2.2, 9)
    f.box(120, 524, 270, 50, "Lateral corticospinal tract\n(crossed: limbs)", "#FFFFFF", RED, 12.5); f.box(430, 524, 250, 50, "Anterior corticospinal tract\n(uncrossed: trunk)", "#FFFFFF", TEAL, 12.5)
    f.text(570, 150, "Lesion above the decussation:", 12.5, 700, INK, "start") if False else None
    f.text(560, 120, "Lesion above the", 12.5, 700, INK); f.text(560, 138, "decussation: weakness", 12.5, 700, INK); f.text(560, 156, "on the opposite side", 12.5, 700, INK)
    f.text(560, 190, "Lesion below it: same", 12.5, 700, INK); f.text(560, 208, "side as the lesion", 12.5, 700, INK)
    return f
