from reg import fig
from lib import *
import math as m

ST_A = {"fill": "#FFF1CC", "stroke": AMBER}
ST_R = {"fill": "#FBE3E0", "stroke": RED}
BLUE = "#3E6FA5"

@fig("phy-concentration", 1, "Schematic of the vasa recta hairpin beside a medullary osmotic gradient from 300 at the cortex to 1200 mOsm per kg at the papilla: the descending limb gains solute and loses water, the ascending limb loses solute and gains water, so the gradient is preserved.",
     "Vasa recta are countercurrent exchangers: they carry away water and solute without washing out the medullary gradient.")
def vasa_recta():
    f = F("x", "Vasa recta: exchanging without washing out", "d", 800, 520, "Medullary osmolality rises from cortex to papilla")
    for i, (v, c) in enumerate(((300, "#EEF6F3"), (600, "#D5ECE5"), (900, "#B7DDD2"), (1200, "#93CBBC"))):
        f.rect(110, 90 + i * 85, 330, 85, c, "none", 0, 0); f.text(100, 90 + i * 85 + 50, f"{v}", 13, 700, INK, "end")
    f.text(100, 82, "mOsm/kg", 11.5, 600, GREY, "end"); f.rect(110, 90, 330, 340, "none", INK, 1.8, 0)
    f.path("M230 100 L230 395 Q270 430 310 395 L310 100", "none", RED, 12)
    f.path("M230 100 L230 395 Q270 430 310 395 L310 100", "none", "#F3B5AD", 8)
    f.text(230, 86, "descending", 11.5, 700, RED, "middle"); f.text(310, 86, "ascending", 11.5, 700, RED, "middle")
    for y in (170, 240, 310): f.arrow(180, y, 218, y, "#3E6FA5", 2.4, 9); f.arrow(222, y + 18, 184, y + 18, TEAL, 2.4, 9)
    for y in (170, 240, 310): f.arrow(358, y, 322, y, TEAL, 2.4, 9); f.arrow(322, y + 18, 358, y + 18, "#3E6FA5", 2.4, 9)
    f.text(480, 170, "Descending limb", 13, 700, RED); f.text(480, 188, "water leaves, NaCl and urea enter", 12, 400, GREY)
    f.text(480, 260, "Ascending limb", 13, 700, RED); f.text(480, 278, "water enters, solute leaves", 12, 400, GREY)
    f.text(480, 350, "Slow flow in a hairpin", 12.5, 600, INK); f.text(480, 366, "preserves the gradient.", 12.5, 600, INK); f.text(480, 386, "High flow washes it out.", 12, 400, GREY)
    f.text(400, 480, "Blue arrow: water. Green arrow: solute.", 12, 500, GREY, "middle")
    return f

@fig("phy-membrane-transport", 2, "Plot of transport rate against concentration gradient: simple diffusion is a straight rising line, facilitated diffusion rises and saturates at a transport maximum, showing carrier specificity, saturation and competition.",
     "Carrier-mediated transport saturates (Tmax); simple diffusion never does.")
def saturation_kinetics():
    p = Plot("x", "Facilitated diffusion saturates", "d", (0, 10), (0, 100), "Concentration gradient", "Rate of transport", 800, 480, "Both run downhill without ATP", [], [], 92, 40, 84, 90)
    p.curve(lambda x: 10 * x, "#9DB5AE", 3, "7 5"); p.curve(lambda x: 100 * x / (x + 1.6), TEAL, 4)
    p.hline(100 * 8 / 9.6, GREY, "5 4", "Tmax (carriers saturated)", "left")
    p.text(p.X(5.5), p.Y(33), "Simple diffusion: linear, no limit", 12.5, 700, GREY); p.text(p.X(5.2), p.Y(94), "Facilitated: specific, saturable, competitive", 12.5, 700, TEAL)
    return p

@fig("phy-membrane-potentials", 5, "Plot of response amplitude against distance: a graded electrotonic potential decays exponentially with distance, while an action potential regenerates and keeps a constant amplitude along the axon.",
     "Graded potentials decay with distance; action potentials do not.")
def graded_vs_ap():
    p = Plot("x", "Graded potential and action potential along an axon", "d", (0, 8), (0, 110), "Distance from the stimulus (mm)", "Amplitude (% of peak)", 800, 480, "Length constant sets how far a graded potential spreads", [0, 2, 4, 6, 8], [0, 50, 100], 92, 40, 84, 90)
    p.curve(lambda x: 100 * m.exp(-x / 2.2), AMBER, 4); p.poly([(0, 100), (8, 100)], TEAL, 4)
    p.text(p.X(0.4), p.Y(106), "Action potential: all-or-none, regenerated, no decrement", 12.5, 700, TEAL); p.text(p.X(3.0), p.Y(40), "Electrotonic (graded) potential:", 12.5, 700, AMBER); p.text(p.X(3.0), p.Y(31), "decays with distance, can summate", 12, 500, AMBER)
    return p

@fig("phy-bp-regulation", 4, "Plot of organ blood flow against mean arterial pressure showing an autoregulatory plateau between about 60 and 160 mmHg, with flow falling below and rising above, and a dashed curve shifted right by sympathetic vasoconstriction.",
     "Between about 60 and 160 mmHg the organ holds flow steady; chronic hypertension shifts the plateau to the right.")
def autoregulation():
    p = Plot("x", "Autoregulation of organ blood flow", "d", (0, 200), (0, 180), "Mean arterial pressure (mmHg)", "Blood flow (% of normal)", 800, 500, "Myogenic and metabolic mechanisms keep flow constant", [0, 40, 60, 100, 160, 200], [0, 50, 100, 150], 92, 40, 84, 90)
    pts = [(0, 0), (30, 40), (60, 95), (80, 100), (120, 100), (150, 103), (170, 130), (200, 175)]
    p.shade(60, 160, TINT); p.curve(pts, TEAL, 4)
    p.curve([(x + 30, y) for x, y in pts if x + 30 <= 200], AMBER, 3, "8 5")
    p.text(p.X(110), p.Y(150), "Plateau: autoregulation", 13, 700, TEAL, "middle"); p.text(p.X(110), p.Y(138), "about 60 to 160 mmHg", 12, 500, GREY, "middle")
    p.text(p.X(120), p.Y(60), "Chronic hypertension / sympathetic drive:", 11.5, 700, AMBER); p.text(p.X(120), p.Y(50), "plateau shifts right (dashed)", 11.5, 700, AMBER)
    p.text(p.X(5), p.Y(110), "ischaemia below the range", 11.5, 600, RED)
    return p

@fig("phy-digestion-absorption", 2, "Enterocyte schematic: SGLT1 brings glucose and galactose in with sodium, GLUT5 brings fructose in, PepT1 brings small peptides with hydrogen, GLUT2 releases all three sugars at the basolateral side, and the sodium potassium pump powers the sodium gradient.",
     "Glucose and galactose ride sodium (SGLT1); fructose uses GLUT5; all leave by GLUT2; the Na+/K+ ATPase drives it all.")
def enterocyte():
    f = F("x", "Carbohydrate and protein absorption in the enterocyte", "d", 800, 520, "Lumen on the left, blood on the right")
    f.rect(260, 120, 280, 300, "#FBEFD2", INK, 2.2, 8)
    f.text(130, 140, "LUMEN", 13, 700, TEAL, "middle"); f.text(670, 140, "BLOOD", 13, 700, RED, "middle")
    f.text(400, 150, "Enterocyte", 14, 700, INK, "middle")
    def tr(x, y, t, c):
        f.rect(x - 22, y - 22, 44, 44, c, INK, 1.6, 8); f.text(x, y + 4, t, 10, 700, INK, "middle")
    tr(260, 200, "SGLT1", "#BFE3D6"); f.arrow(150, 200, 244, 200, "#3E6FA5", 2.4, 9); f.text(120, 188, "glucose, galactose", 11.5, 600, INK, "middle"); f.text(120, 206, "+ 2 Na+", 11.5, 600, INK, "middle")
    tr(260, 270, "GLUT5", "#F5DDA6"); f.arrow(150, 270, 244, 270, AMBER, 2.4, 9); f.text(110, 270, "fructose", 11.5, 600, INK, "middle")
    tr(260, 340, "PepT1", "#F1C6C0"); f.arrow(150, 340, 244, 340, RED, 2.4, 9); f.text(120, 330, "di- and tripeptides", 11.5, 600, INK, "middle"); f.text(120, 348, "+ H+", 11.5, 600, INK, "middle")
    tr(540, 230, "GLUT2", "#BFE3D6"); f.arrow(556, 230, 650, 230, "#3E6FA5", 2.4, 9); f.text(680, 215, "glucose, galactose,", 11.5, 600, INK, "middle"); f.text(680, 233, "fructose", 11.5, 600, INK, "middle")
    tr(540, 330, "Na/K", "#E8C547"); f.text(540, 365, "Na+/K+ ATPase", 11.5, 700, INK, "middle"); f.arrow(556, 322, 640, 322, GREY, 2, 9); f.text(660, 326, "3 Na+ out", 11, 600, GREY, "middle"); f.arrow(640, 338, 556, 338, GREY, 2, 9); f.text(660, 346, "2 K+ in", 11, 600, GREY, "middle")
    f.text(400, 460, "Sodium gradient from the pump drives SGLT1; glucose-galactose malabsorption is an SGLT1 defect.", 12, 500, GREY, "middle")
    f.text(400, 480, "Oral rehydration solution works because glucose carries sodium and water.", 12, 400, GREY, "middle")
    return f

@fig("phy-female", 1, "Plot of the 28 day menstrual cycle with FSH, LH, oestradiol and progesterone: FSH rises early, oestradiol peaks before ovulation, an LH surge on day 14 triggers ovulation, progesterone peaks in the luteal phase; follicular and luteal phases and the proliferative and secretory endometrium are labelled.",
     "Oestradiol peak triggers the LH surge; LH surge ovulates; progesterone dominates the luteal phase.")
def menstrual_cycle():
    p = Plot("x", "The menstrual cycle", "d", (0, 28), (0, 110), "Day of cycle", "Relative level", 800, 610, "Illustrative curves; ovulation on day 14", [0, 7, 14, 21, 28], [], 92, 40, 90, 130)
    p.shade(0, 14, "#F5F9F8"); p.shade(14, 28, "#FBF3E0"); p.vline(14, GREY, "6 4", None)
    p.curve([(0, 35), (3, 45), (7, 30), (11, 18), (13, 25), (14, 55), (15, 25), (18, 10), (22, 8), (26, 12), (28, 30)], "#8F9A3F", 3)
    p.curve([(0, 12), (5, 12), (10, 14), (12, 25), (13, 55), (14, 100), (15, 45), (16, 20), (20, 12), (25, 10), (28, 12)], RED, 3)
    p.curve([(0, 12), (4, 15), (8, 30), (11, 60), (13, 95), (14, 80), (16, 40), (19, 55), (21, 65), (24, 45), (26, 20), (28, 12)], BLUE, 3.5)
    p.curve([(0, 5), (13, 6), (14, 12), (16, 40), (19, 75), (21, 100), (24, 70), (26, 25), (28, 8)], AMBER, 3.5)
    p.text(p.X(7), p.T - 4, "Follicular phase", 12.5, 700, GREY, "middle"); p.text(p.X(21), p.T - 4, "Luteal phase", 12.5, 700, GREY, "middle")
    p.text(p.X(14.3), p.Y(106), "ovulation", 12, 700, INK)
    p.legend([("#8F9A3F", "FSH"), (RED, "LH"), (BLUE, "Oestradiol"), (AMBER, "Progesterone")], 120, p.B + 60) if False else None
    for i, (c, t) in enumerate(((RED, "LH"), ("#8F9A3F", "FSH"), (BLUE, "Oestradiol"), (AMBER, "Progesterone"))):
        p.rect(120 + i * 150, 526, 24, 5, c, c, 0, 2); p.text(150 + i * 150, 532, t, 12, 600, INK)
    p.text(p.X(7), 508, "Endometrium: menses then proliferative (oestrogen)", 11.5, 600, GREY, "middle") if False else p.text(120, 556, "Endometrium: menses, then proliferative (oestrogen)", 11.5, 600, GREY)
    p.text(480, 556, "Secretory (progesterone)", 11.5, 600, GREY)
    return p

@fig("phy-female", 2, "Plot of hormone levels across pregnancy: hCG rises from implantation to a peak at about 8 to 10 weeks then falls to a plateau, progesterone shifts from corpus luteum to placenta around weeks 7 to 9 and keeps rising, oestriol rises steadily to term.",
     "hCG peaks at 8 to 10 weeks and then falls; the placenta takes over progesterone from the corpus luteum around weeks 7 to 9.")
def pregnancy_hormones():
    p = Plot("x", "Hormones of pregnancy", "d", (0, 40), (0, 110), "Weeks from last menstrual period", "Relative level", 800, 500, "Illustrative curves", [0, 8, 16, 24, 32, 40], [], 92, 40, 84, 90)
    p.curve([(0, 0), (3, 2), (5, 15), (7, 60), (9, 100), (10, 95), (12, 70), (15, 35), (20, 25), (30, 25), (40, 25)], RED, 4)
    p.curve([(0, 10), (4, 30), (7, 38), (10, 45), (20, 62), (30, 82), (40, 100)], AMBER, 3.5)
    p.curve([(0, 0), (10, 4), (20, 18), (30, 50), (40, 100)], BLUE, 3.5)
    p.vline(8, GREY, "6 4", "luteal to placental shift", p.B - 14)
    p.text(p.X(10.5), p.Y(102), "hCG (peak 8 to 10 weeks)", 12.5, 700, RED); p.text(p.X(24), p.Y(48), "Progesterone", 12.5, 700, AMBER); p.text(p.X(19), p.Y(8), "Oestriol (fetoplacental, rises to term)", 12.5, 700, BLUE)
    return p

@fig("phy-hypoxia-environment", 2, "Plot of absolute pressure and relative gas volume against diving depth: pressure rises by one atmosphere per 10 metres of sea water, so a gas volume halves at 10 metres and falls to a quarter at 30 metres, following Boyle law.",
     "Pressure adds one atmosphere per 10 m; air in the lungs and sinuses halves at 10 m, which drives barotrauma and bubble formation on ascent.")
def boyle():
    p = Plot("x", "Depth, pressure and gas volume (Boyle's law)", "d", (0, 60), (0, 7), "Depth (metres of sea water)", "Pressure (atm) and volume (fraction of surface)", 800, 500, "Absolute pressure = 1 + depth / 10 atm", [0, 10, 20, 30, 40, 50, 60], [0, 1, 2, 4, 6], 92, 40, 84, 90, grid=True)
    p.curve(lambda x: 1 + x / 10, RED, 4); p.curve(lambda x: 1 / (1 + x / 10), BLUE, 4)
    p.dot(10, 2, "10 m: 2 atm", -12, -8, "end"); p.dot(10, 0.5, "volume 1/2", 12, -12); p.dot(30, 4, "30 m: 4 atm", -12, -8, "end"); p.dot(30, 0.25, "volume 1/4", 12, -12)
    p.text(p.X(14), p.Y(4.9), "Pressure (atm)", 12.5, 700, RED); p.text(p.X(36), p.Y(0.8), "Gas volume (fraction of surface volume)", 12.5, 700, BLUE)
    return p

@fig("phy-mechanics", 2, "Two connected alveoli of different size: by the law of Laplace pressure equals two times surface tension divided by radius, so without surfactant the small alveolus has higher pressure and would empty into the large one; surfactant lowers tension more in the small alveolus and equalises pressure.",
     "Laplace: P = 2T/r. Surfactant lowers surface tension, more so in small alveoli, preventing collapse; premature infants lack it.")
def surfactant():
    f = F("x", "Why alveoli need surfactant", "d", 800, 520, "Law of Laplace: P = 2T / r")
    for (cx, tag) in ((200, "Without surfactant"), (600, "With surfactant")):
        f.text(cx, 100, tag, 15, 700, TEAL if cx > 400 else RED, "middle")
        f.circle(cx - 55, 230, 38, "#F4FAF8", INK, 2.4); f.circle(cx + 50, 220, 70, "#F4FAF8", INK, 2.4)
        f.line(cx - 17, 230, cx - 20, 230, INK, 2) if False else f.rect(cx - 20, 224, 8, 12, "#F4FAF8", "none", 0, 0)
        f.text(cx - 55, 235, "small", 12, 700, INK, "middle"); f.text(cx + 50, 225, "large", 12, 700, INK, "middle")
    f.arrow(172, 320, 258, 320, RED, 3.5, 12) if False else None
    f.arrow(215, 300, 150, 300, RED, 0, 0) if False else None
    f.text(200, 345, "Small alveolus: higher pressure", 12.5, 700, RED, "middle"); f.arrow(165, 360, 245, 360, RED, 3.5, 12); f.text(200, 385, "air flows small to large: collapse (atelectasis)", 12, 500, GREY, "middle")
    f.text(600, 345, "Surfactant lowers T more as r shrinks", 12.5, 700, TEAL, "middle"); f.text(600, 365, "pressures equalise: alveoli stay open", 12, 500, GREY, "middle")
    f.text(400, 440, "Surfactant: dipalmitoylphosphatidylcholine from type II pneumocytes.", 12.5, 600, INK, "middle")
    f.text(400, 462, "Absent in prematurity: respiratory distress syndrome; antenatal steroids speed its production.", 12, 400, GREY, "middle")
    return f

@fig("phy-pancreas", 1, "Pancreatic duct cell: carbonic anhydrase makes bicarbonate inside, a chloride bicarbonate exchanger and CFTR chloride channel at the apical membrane secrete bicarbonate into the lumen, basolateral sodium hydrogen exchange and the sodium potassium pump support it, and secretin acts through cAMP to open CFTR.",
     "Secretin raises cAMP, opens CFTR, and the duct secretes bicarbonate; cystic fibrosis blocks this and thickens secretions.")
def duct_cell():
    f = F("x", "Pancreatic duct cell bicarbonate secretion", "d", 800, 520, "Lumen at the top, blood at the bottom")
    f.rect(180, 150, 440, 230, "#FBEFD2", INK, 2.2, 8)
    f.text(70, 130, "LUMEN", 13, 700, TEAL); f.text(70, 410, "BLOOD", 13, 700, RED)
    f.text(400, 180, "Duct cell", 14, 700, INK, "middle")
    f.rect(250, 140, 34, 22, "#E8C547", INK, 1.6, 6); f.text(267, 154, "CFTR", 9.5, 700, INK, "middle"); f.arrow(267, 140, 267, 100, GREY, 2, 9); f.text(267, 92, "Cl- out", 11.5, 600, INK, "middle")
    f.rect(400, 140, 60, 22, "#BFE3D6", INK, 1.6, 6); f.text(430, 154, "Cl-/HCO3-", 10, 700, INK, "middle"); f.arrow(430, 140, 430, 100, GREY, 2, 9); f.text(430, 92, "HCO3- out", 11.5, 600, INK, "middle"); f.arrow(500, 100, 466, 140, GREY, 1.6, 8) if False else None
    f.text(400, 240, "CO2 + H2O  <->  H+ + HCO3-  (carbonic anhydrase)", 12.5, 700, TEAL, "middle")
    f.rect(260, 370, 70, 22, "#F5DDA6", INK, 1.6, 6); f.text(295, 384, "Na+/H+", 10, 700, INK, "middle"); f.arrow(295, 370, 295, 340, GREY, 2, 9) if False else f.arrow(295, 392, 295, 424, GREY, 2, 9); f.text(295, 440, "H+ out to blood", 11.5, 600, INK, "middle")
    f.rect(470, 370, 80, 22, "#E8C547", INK, 1.6, 6); f.text(510, 384, "Na+/K+ ATPase", 9.5, 700, INK, "middle")
    f.text(400, 295, "Secretin (S cells) -> cAMP -> opens CFTR", 12.5, 700, AMBER, "middle")
    f.text(400, 480, "Cystic fibrosis: CFTR defect, thick pancreatic secretions, malabsorption.", 12.5, 500, GREY, "middle")
    return f

@fig("phy-rbc-haemoglobin", 1, "Biconcave red cell in cross-section with diameter about 7.5 micrometres, and a haemoglobin molecule of two alpha and two beta chains each with a haem iron; adult HbA is alpha two beta two, HbF alpha two gamma two, HbA2 alpha two delta two.",
     "Biconcave shape gives a high surface to volume ratio and flexibility; HbA is two alpha and two beta chains, each with one haem.")
def rbc_hb():
    f = F("x", "Red cell and haemoglobin", "d", 800, 480, "Cross-section of the cell and structure of haemoglobin")
    f.path("M80 200 C80 140 150 130 200 160 C250 130 320 140 320 200 C320 260 250 270 200 240 C150 270 80 260 80 200 Z", "#E3A19A", INK, 2.4)
    f.line(80, 330, 320, 330, INK, 1.5); f.line(80, 324, 80, 336, INK, 1.5); f.line(320, 324, 320, 336, INK, 1.5); f.text(200, 352, "about 7.5 micrometres", 12.5, 600, INK, "middle")
    f.text(200, 100, "Biconcave disc, no nucleus", 14, 700, TEAL, "middle")
    f.text(200, 380, "Large surface area to volume ratio, deformable", 12, 500, GREY, "middle"); f.text(200, 398, "Lifespan about 120 days; energy from glycolysis only", 12, 500, GREY, "middle")
    for (x, y, t, c) in ((520, 170, "alpha", "#C9D8EC"), (620, 170, "beta", "#F5DDA6"), (520, 270, "beta", "#F5DDA6"), (620, 270, "alpha", "#C9D8EC")):
        f.circle(x, y, 42, c, INK, 1.8); f.text(x, y + 5, t, 13, 700, INK, "middle"); f.circle(x + (14 if x < 570 else -14), y - 14, 8, "#B3382C", INK, 1.4)
    f.text(570, 100, "Haemoglobin A (alpha 2 beta 2)", 14, 700, TEAL, "middle")
    f.text(570, 345, "Each chain: one haem, one Fe2+, one O2 (four per molecule)", 12, 500, GREY, "middle")
    f.text(570, 380, "HbF: alpha 2 gamma 2    HbA2: alpha 2 delta 2", 12, 600, INK, "middle")
    f.text(570, 400, "Foetal Hb binds 2,3-BPG poorly, so it has higher O2 affinity", 11.5, 400, GREY, "middle")
    return f

@fig("phy-secretions-hormones", 1, "Parietal cell: carbonic anhydrase makes hydrogen and bicarbonate, the apical H+ K+ ATPase pumps hydrogen into the lumen for potassium, K+ and Cl- channels supply the ions, a basolateral Cl- HCO3- exchanger sends bicarbonate to blood (alkaline tide); acetylcholine, gastrin and histamine stimulate and proton pump inhibitors block the pump.",
     "Histamine, gastrin and acetylcholine all converge on the proton pump; omeprazole blocks the pump itself.")
def parietal_cell():
    f = F("x", "Parietal cell acid secretion", "d", 800, 540, "Lumen at the top, blood at the bottom")
    f.rect(170, 150, 460, 250, "#F6E8E4", INK, 2.2, 8)
    f.text(60, 130, "LUMEN", 13, 700, TEAL); f.text(60, 430, "BLOOD", 13, 700, RED); f.text(400, 178, "Parietal cell", 14, 700, INK, "middle")
    f.rect(250, 140, 70, 22, "#E8C547", INK, 1.6, 6); f.text(285, 154, "H+/K+ ATPase", 9, 700, INK, "middle"); f.arrow(268, 140, 268, 100, RED, 2.4, 9); f.arrow(300, 100, 300, 140, GREY, 2, 9)
    f.text(255, 90, "H+ out", 11.5, 700, RED, "middle"); f.text(318, 90, "K+ in", 11.5, 600, GREY, "middle")
    f.rect(430, 140, 40, 22, "#BFE3D6", INK, 1.6, 6); f.text(450, 154, "Cl-", 10, 700, INK, "middle"); f.arrow(450, 140, 450, 100, GREY, 2, 9)
    f.text(400, 240, "CO2 + H2O -> H+ + HCO3-   (carbonic anhydrase)", 12.5, 700, TEAL, "middle")
    f.rect(260, 390, 80, 22, "#BFE3D6", INK, 1.6, 6); f.text(300, 404, "Cl-/HCO3-", 10, 700, INK, "middle"); f.arrow(300, 412, 300, 450, GREY, 2, 9); f.text(300, 468, "HCO3- to blood (alkaline tide)", 11.5, 600, INK, "middle")
    f.circle(470, 400, 14, "#F5DDA6", INK, 1.6); f.text(470, 404, "M3", 10, 700, INK, "middle"); f.circle(520, 400, 14, "#F5DDA6", INK, 1.6); f.text(520, 404, "CCK2", 8, 700, INK, "middle"); f.circle(570, 400, 14, "#F5DDA6", INK, 1.6); f.text(570, 404, "H2", 10, 700, INK, "middle")
    f.text(470, 440, "ACh", 11.5, 700, INK, "middle"); f.text(520, 440, "gastrin", 11.5, 700, INK, "middle"); f.text(570, 440, "histamine", 11.5, 700, INK, "middle")
    f.text(400, 506, "PPIs (omeprazole) block the pump; H2 blockers block histamine; both lower acid.", 12, 500, GREY, "middle")
    return f

@fig("phy-skeletal-muscle", 5, "Length tension curves of skeletal muscle: active tension peaks at an optimal sarcomere length of about 2.0 to 2.2 micrometres where filament overlap is maximal and falls at shorter and longer lengths, while passive tension rises steeply when stretched beyond that.",
     "Maximum active force at optimal overlap; too short or too long reduces force; passive tension from titin and connective tissue rises on stretch.")
def length_tension():
    p = Plot("x", "Length-tension relationship", "d", (1.0, 4.0), (0, 110), "Sarcomere length (micrometres)", "Tension (% of maximum)", 800, 500, "Skeletal muscle", [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0], [0, 50, 100], 92, 40, 84, 90)
    act = [(1.2, 0), (1.5, 35), (1.7, 70), (2.0, 100), (2.2, 100), (2.6, 78), (3.0, 45), (3.4, 12), (3.65, 0)]
    pas = [(1.0, 0), (2.2, 0), (2.6, 5), (3.0, 20), (3.4, 55), (3.7, 100)]
    p.shade(2.0, 2.2, TINT)
    p.curve(act, TEAL, 4); p.curve(pas, AMBER, 3.5, "7 5")
    p.curve([(x, a + (dict(pas).get(x, 0) if False else 0)) for x, a in act], TEAL, 0)
    p.text(p.X(2.1), p.Y(108), "optimum 2.0 to 2.2", 12, 700, GREY, "middle")
    p.text(p.X(2.8), p.Y(88), "Active tension", 12.5, 700, TEAL); p.text(p.X(3.2), p.Y(60), "Passive tension", 12.5, 700, AMBER)
    p.text(p.X(1.05), p.Y(60), "too short:", 11.5, 600, GREY); p.text(p.X(1.05), p.Y(52), "filaments collide", 11.5, 600, GREY)
    p.text(p.X(3.3), p.Y(26), "too long: little overlap", 11.5, 600, GREY)
    return p

@fig("phy-smooth-cardiac-muscle", 3, "Trace of single unit smooth muscle membrane potential with slow waves oscillating between about minus 65 and minus 45 millivolts; action potential spikes occur on the crests when the threshold is crossed and these trigger contraction.",
     "Slow waves set the rhythm; only the spikes on top of them, when threshold is crossed, produce contraction.")
def slow_waves():
    p = Plot("x", "Slow waves and spikes in gut smooth muscle", "d", (0, 20), (-80, -10), "Time (s)", "Membrane potential (mV)", 800, 480, "Basic electrical rhythm", [0, 5, 10, 15, 20], [-70, -50, -30], 92, 40, 84, 90)
    p.line(p.L, p.Y(-40), p.R, p.Y(-40), GREY, 1.4, "5 4"); p.text(p.L + 6, p.Y(-40) - 6, "threshold", 11.5, 600, GREY)
    pts = []
    for i in range(0, 401):
        t = i * 0.05; v = -56 + 10 * math.sin(2 * math.pi * t / 5 - math.pi / 2)
        if 5 <= t <= 10:
            v += 0
        pts.append((t, v))
    p.poly(pts, TEAL, 3.5)
    for tc in (7.5, 12.5):
        p.poly([(tc - 0.35, -48), (tc - 0.2, -25), (tc - 0.1, -15), (tc + 0.05, -30), (tc + 0.3, -48)], AMBER, 3.5)
    p.text(p.X(2.5), p.Y(-72), "slow wave (no contraction)", 12, 600, TEAL, "middle"); p.text(p.X(7.5), p.Y(-12), "spikes: contraction", 12, 700, AMBER, "middle")
    p.text(p.X(15), p.Y(-72), "Rate set by the interstitial cells of Cajal", 12, 500, GREY, "middle")
    return p

@fig("phy-taste-smell", 2, "Top view of the tongue showing the V of circumvallate papillae at the back, foliate papillae on the posterior sides, fungiform papillae over the tip and sides, and filiform papillae over the surface without taste buds, with the cranial nerve for each region.",
     "Anterior two thirds: chorda tympani (VII). Posterior third including circumvallate: glossopharyngeal (IX). Filiform papillae have no taste buds.")
def tongue_papillae():
    f = F("x", "Papillae of the tongue", "d", 800, 540, "Dorsal view, tip at the bottom")
    f.path("M400 480 C310 470 270 400 275 320 C280 230 300 130 400 110 C500 130 520 230 525 320 C530 400 490 470 400 480 Z", "#F1C6C0", INK, 2.4)
    f.line(300, 215, 400, 275, "#8E5A52", 1.6, "5 4"); f.line(500, 215, 400, 275, "#8E5A52", 1.6, "5 4")
    for (x, y) in ((322, 214), (345, 232), (368, 250), (400, 272), (432, 250), (455, 232), (478, 214)): f.circle(x, y, 8, "#C0392B", INK, 1.4)
    for dy in range(0, 5): f.line(285, 180 + dy * 10, 305, 184 + dy * 10, "#7A1F17", 2); f.line(515, 180 + dy * 10, 495, 184 + dy * 10, "#7A1F17", 2)
    import random
    random.seed(4)
    for _ in range(40):
        x = random.uniform(305, 495); y = random.uniform(330, 470)
        if ((x - 400) / 115) ** 2 + ((y - 400) / 85) ** 2 < 1: f.circle(x, y, 3.2, "#E8C547", INK, 0.8)
    f.text(400, 320, "filiform: rough surface, no taste buds", 11.5, 600, "#7A1F17", "middle")
    f.label(322, 214, "Circumvallate (V-shaped row)", 255, 140, 12.5, "end"); f.text(250, 158, "CN IX", 11.5, 700, TEAL, "end")
    f.label(285, 205, "Foliate (posterior sides)", 255, 235, 12.5, "end"); f.text(250, 253, "CN IX (VII anteriorly)", 11.5, 700, TEAL, "end")
    f.label(330, 400, "Fungiform (tip and sides)", 255, 430, 12.5, "end"); f.text(250, 448, "chorda tympani (CN VII)", 11.5, 700, TEAL, "end")
    f.text(560, 150, "Sulcus terminalis marks", 12, 500, GREY); f.text(560, 166, "the V; foramen caecum", 12, 500, GREY); f.text(560, 182, "at its apex", 12, 500, GREY)
    f.text(400, 520, "Circumvallate are the largest papillae and carry the most taste buds.", 12.5, 500, GREY, "middle")
    return f

@fig("phy-tubular", 1, "Thick ascending limb cell: NKCC2 on the apical membrane brings sodium potassium and two chloride in, ROMK returns potassium to the lumen creating a lumen positive voltage, the basolateral sodium potassium pump and chloride channel complete transport, and the positive voltage pushes calcium and magnesium through the paracellular path; the segment is water impermeable and loop diuretics block NKCC2.",
     "NKCC2 is the loop diuretic target; the lumen-positive voltage drives paracellular calcium and magnesium reabsorption, which diuretics lose.")
def tal_cell():
    f = F("x", "Thick ascending limb of the loop of Henle", "d", 800, 520, "Lumen on the left, blood on the right; the segment is impermeable to water")
    f.rect(280, 110, 240, 300, "#FBEFD2", INK, 2.2, 8)
    f.text(130, 130, "LUMEN (+ voltage)", 13, 700, TEAL, "middle"); f.text(670, 130, "BLOOD", 13, 700, RED, "middle"); f.text(400, 140, "TAL cell", 14, 700, INK, "middle")
    f.rect(266, 190, 28, 60, "#E8C547", INK, 1.6, 8); f.text(280, 224, "NKCC2", 8.5, 700, INK, "middle"); f.arrow(150, 220, 262, 220, "#3E6FA5", 2.4, 9); f.text(110, 200, "Na+, K+, 2Cl-", 12, 700, INK, "middle")
    f.rect(266, 290, 28, 44, "#BFE3D6", INK, 1.6, 8); f.text(280, 316, "ROMK", 8.5, 700, INK, "middle"); f.arrow(262, 312, 160, 312, GREY, 2.4, 9); f.text(110, 304, "K+ recycles", 12, 600, INK, "middle")
    f.rect(506, 330, 28, 50, "#E8C547", INK, 1.6, 8); f.text(520, 360, "Na/K", 8.5, 700, INK, "middle"); f.arrow(538, 352, 640, 352, GREY, 2.4, 9); f.text(680, 346, "Na+ out", 11.5, 600, INK, "middle")
    f.rect(506, 230, 28, 50, "#BFE3D6", INK, 1.6, 8); f.text(520, 260, "ClC-Kb", 7.5, 700, INK, "middle"); f.arrow(538, 252, 640, 252, GREY, 2.4, 9); f.text(680, 246, "Cl- out", 11.5, 600, INK, "middle")
    f.line(280, 110, 280, 86, GREY, 1.2); f.text(280, 440, "Paracellular Ca2+ and Mg2+", 12.5, 700, AMBER, "middle"); f.text(280, 458, "follow the lumen-positive voltage", 12, 400, GREY, "middle"); f.arrow(268, 420, 268, 300, AMBER, 2.4, 9) if False else None
    f.text(400, 494, "Furosemide blocks NKCC2: salt wasting, hypokalaemia, calcium loss. Dilutes tubular fluid.", 12, 500, GREY, "middle")
    return f

@fig("phy-motility", 0, "Flow diagram of swallowing: voluntary oral phase pushes the bolus back, involuntary pharyngeal phase raises the soft palate and larynx and tilts the epiglottis while the upper oesophageal sphincter relaxes, then oesophageal peristalsis moves the bolus and the lower oesophageal sphincter relaxes.",
     "Only the oral phase is voluntary; achalasia is failure of the lower oesophageal sphincter to relax.")
def swallowing():
    from lib import graph
    return graph("x", "Swallowing in three phases", "d", [[("a", "Oral (voluntary): tongue pushes the bolus to the pharynx")], [("b", "Pharyngeal (reflex): palate rises, larynx lifts,\nepiglottis closes, upper sphincter relaxes")], [("c", "Oesophageal: primary peristalsis, then secondary peristalsis")], [("d", "Lower oesophageal sphincter relaxes (NO, VIP)")]],
                 [("a", "b"), ("b", "c"), ("c", "d")], "Pharyngeal and oesophageal phases are brainstem and enteric reflexes", cw=440, rh=56, gap=28, top=92, nodestyle={"b": ST_A},
                 notes=["Achalasia: loss of inhibitory neurons, sphincter fails to relax, bird-beak on barium swallow."])

@fig("phy-calcium", 2, "Table of causes and features of hypercalcaemia: primary hyperparathyroidism and malignancy are the commonest causes, with stones, bones, groans and psychic moans, and first line treatment with saline then bisphosphonate.",
     "Stones, bones, groans, moans. Fluids first, then a bisphosphonate.")
def hypercalcaemia():
    from lib import pathways
    return pathways("x", "Hypercalcaemia", "d", ["Cause", "Mechanism"],
        [("Primary hyperparathyroidism", "PTH adenoma: stones, bones, groans, psychic moans"), ("Malignancy", "PTHrP, osteolytic metastases, myeloma"), ("Drugs", "Thiazides, lithium, vitamin D excess"), ("Granulomatous disease", "Sarcoid: 1-alpha-hydroxylase makes calcitriol"), ("Treatment", "Saline rehydration first, then bisphosphonate; treat cause")],
        widths=[220, 470], rh=46, gap=10, top=100)

@fig("phy-calcium", 3, "Table of causes and signs of hypocalcaemia: hypoparathyroidism after thyroid surgery, DiGeorge syndrome, pseudohypoparathyroidism, with Chvostek sign, Trousseau sign, perioral tingling and tetany.",
     "Chvostek: tap the facial nerve, the cheek twitches. Trousseau: cuff inflation causes carpal spasm.")
def hypocalcaemia():
    from lib import pathways
    return pathways("x", "Hypocalcaemia", "d", ["Cause or sign", "Detail"],
        [("Hypoparathyroidism", "Often after thyroid or parathyroid surgery"), ("DiGeorge syndrome (22q11)", "Absent parathyroids with cardiac defects and facial changes"), ("Pseudohypoparathyroidism", "PTH resistance: short fourth metacarpal (Albright)"), ("Chvostek sign", "Tap over facial nerve: facial twitching"), ("Trousseau sign", "Blood pressure cuff inflated: carpal spasm")],
        "Neuromuscular excitability rises: perioral tingling, tetany, seizures, long QT", widths=[240, 450], rh=46, gap=10, top=100)

@fig("phy-blood-groups", 2, "Comparison of major and minor crossmatch: major crossmatch mixes donor red cells with recipient serum to detect recipient antibodies to donor cells, minor crossmatch mixes donor serum with recipient cells; emergency uses O negative red cells.",
     "Major crossmatch protects the recipient and is the one that matters; in an emergency use group O negative.")
def crossmatch():
    from lib import graph
    return graph("x", "Crossmatching", "d", [[("a", "Major crossmatch:\ndonor red cells + recipient serum"), ("b", "Minor crossmatch:\ndonor serum + recipient red cells")], [("c", "Detects recipient antibodies\nagainst donor cells (matters most)"), ("d", "Detects donor antibodies\n(largely replaced by screening)")], [("e", "Emergency: group O negative red cells\nwhile typing is completed")]],
                 [("a", "c"), ("b", "d"), ("c", "e", "", "dash")], "Type and screen first; electronic issue if no antibodies", cw=320, rh=58, gap=40, top=96, nodestyle={"e": ST_A})

@fig("phy-thyroid", 1, "Table of thyroid hormone actions by system: raises basal metabolic rate and heat production, upregulates beta receptors, essential for fetal and childhood brain and bone growth, speeds gut motility.",
     "Thyroid hormone raises metabolism, heat, heart rate and gut motility; in infancy it is essential for brain development.")
def thyroid_actions():
    from lib import pathways
    return pathways("x", "Actions of thyroid hormone", "d", ["System", "Effect"],
        [("Metabolism", "Basal metabolic rate and oxygen use rise; heat production"), ("Heart", "Beta-1 receptors upregulated: tachycardia, higher output"), ("Nervous system", "Brain development in the fetus and infant; tremor, anxiety in excess"), ("Growth", "Bone maturation; deficiency causes cretinism"), ("Gut", "Motility rises: diarrhoea in excess, constipation in deficiency")],
        widths=[160, 530], rh=44, gap=10, top=100)

@fig("phy-thyroid", 2, "Table of Graves disease features: thyroid stimulating antibodies, eye signs of lid lag and exophthalmos, pretibial myxoedema, thyroid storm with fever and agitation, and carbimazole or propylthiouracil treatment.",
     "Graves disease: TSH receptor stimulating antibodies; only Graves has eye disease and pretibial myxoedema.")
def graves():
    from lib import pathways
    return pathways("x", "Graves disease", "d", ["Feature", "Detail"],
        [("Cause", "Stimulating antibodies to the TSH receptor (type II hypersensitivity)"), ("Eye", "Lid lag, exophthalmos, ophthalmoplegia (not seen in other causes)"), ("Skin", "Pretibial myxoedema, thyroid acropachy"), ("Storm", "Fever, agitation, tachycardia: emergency"), ("Treatment", "Carbimazole, propylthiouracil in pregnancy, beta blocker, radioiodine")],
        widths=[160, 530], rh=46, gap=10, top=100)

@fig("phy-male", 1, "Table of testosterone sources and actions: made by Leydig cells from cholesterol under LH, converted to DHT in the prostate and skin by 5-alpha reductase, causing male external genitalia, prostate growth and hair, with anabolic effects on muscle and bone, erythropoiesis and libido.",
     "Testosterone builds muscle and red cells; DHT makes the external genitalia, prostate and hair; hypogonadism reverses these.")
def testosterone():
    from lib import pathways
    return pathways("x", "Testosterone and DHT", "d", ["Hormone", "Source", "Effects"],
        [("Testosterone", "Leydig cells, under LH", "Muscle and bone anabolism, erythropoiesis, libido, voice deepening, spermatogenesis"), ("Dihydrotestosterone (DHT)", "5-alpha reductase in prostate, skin, genitalia", "External genitalia, prostate growth, facial and body hair, male-pattern baldness")],
        "5-alpha reductase inhibitors (finasteride) shrink the prostate", widths=[170, 210, 290], rh=64, gap=14, top=104)

@fig("phy-mixed", 1, "Table of kidney injury biomarkers: cystatin C freely filtered marker of GFR, NGAL early marker of acute kidney injury from tubular injury, KIM-1 marker of proximal tubular damage, IL-18 inflammatory marker in acute tubular necrosis.",
     "NGAL and KIM-1 rise within hours of tubular injury, earlier than creatinine.")
def kidney_biomarkers():
    from lib import pathways
    return pathways("x", "Kidney biomarkers", "d", ["Marker", "What it shows"],
        [("Cystatin C", "GFR: freely filtered, unaffected by muscle mass"), ("NGAL", "Neutrophil gelatinase-associated lipocalin: early acute kidney injury"), ("KIM-1", "Kidney injury molecule 1: proximal tubular damage"), ("IL-18", "Inflammation in acute tubular necrosis")],
        "Creatinine rises only after about half of the filtration has been lost", widths=[170, 520], rh=48, gap=12, top=104)
