from reg import fig
from lib import *

HEMI = "M130 270 C120 190 190 110 330 100 C470 90 620 110 680 200 C720 260 700 330 640 350 C600 365 560 350 520 345 C480 340 450 380 400 385 C340 392 300 370 260 355 C190 340 140 330 130 270 Z"

@fig("ana-cerebellum", 1, "Coronal schematic of the cerebellum showing vermis in the centre, intermediate zone, and lateral hemisphere, with the four deep nuclei from medial to lateral: fastigial, globose, emboliform and dentate.",
     "Lateral to medial: dentate, emboliform, globose, fastigial. Each nucleus serves the zone above it.")
def cerebellar_nuclei():
    f = F("x", "Deep cerebellar nuclei and their zones", "d", 800, 500, "Coronal slice; labelled on the right side only, the left mirrors it")
    cx, cy = 400, 220
    f.ellipse(cx, cy, 300, 105, "#F4FAF8", INK, 2.2)
    f.rect(cx - 45, cy - 100, 90, 200, "#FFF1CC", "none", 0, 0); f.ellipse(cx, cy, 300, 105, "none", INK, 2.2)
    f.line(cx + 45, cy - 100, cx + 45, cy + 100, GREY, 1.2, "5 4"); f.line(cx - 45, cy - 100, cx - 45, cy + 100, GREY, 1.2, "5 4")
    f.line(cx + 115, cy - 98, cx + 115, cy + 98, GREY, 1.2, "5 4"); f.line(cx - 115, cy - 98, cx - 115, cy + 98, GREY, 1.2, "5 4")
    for sg in (-1, 1):
        f.ellipse(cx + sg * 30, cy + 10, 14, 17, "#8F9A3F", INK, 1.6); f.ellipse(cx + sg * 62, cy + 12, 11, 14, "#B7791F", INK, 1.6)
        f.ellipse(cx + sg * 88, cy + 10, 12, 15, "#3E6FA5", INK, 1.6)
        f.path(f"M{cx+sg*135} {cy-14} C{cx+sg*175} {cy-26} {cx+sg*190} {cy+4} {cx+sg*168} {cy+14} C{cx+sg*160} {cy+2} {cx+sg*150} {cy+20} {cx+sg*140} {cy+14} Z", "#C0392B", INK, 1.6)
    f.text(cx, 104, "Vermis", 12.5, 700, INK, "middle"); f.text(cx + 80, 104, "Intermediate", 12.5, 700, INK, "middle"); f.text(cx + 205, 104, "Lateral hemisphere", 12.5, 700, INK, "middle")
    f.text(cx, 345, "Trunk,\ngait", 12, 600, GREY, "middle"); f.text(cx + 80, 345, "Limb\nmovement", 12, 600, GREY, "middle"); f.text(cx + 205, 345, "Planning,\ncoordination", 12, 600, GREY, "middle")
    f.box(cx - 70, 385, 120, 44, "Fastigial", "#FFFFFF", "#8F9A3F", 13); f.box(cx + 55, 385, 135, 44, "Globose and\nemboliform", "#FFFFFF", "#B7791F", 12.5); f.box(cx + 200, 385, 120, 44, "Dentate", "#FFFFFF", "#C0392B", 13)
    f.text(cx - 10, 452, "Mnemonic, lateral to medial: Don't Eat Greasy Foods", 13, 700, TEAL, "middle")
    f.text(cx - 10, 474, "(Dentate, Emboliform, Globose, Fastigial)", 12, 400, GREY, "middle")
    return f

@fig("ana-cerebral-circulation", 2, "Coronal brain section colour coded by artery: anterior cerebral artery supplies the medial strip, middle cerebral artery the lateral convexity, posterior cerebral artery the inferior medial surface, each labelled with its typical deficit.",
     "ACA: leg. MCA: face and arm, language. PCA: vision.")
def cerebral_territories():
    f = F("x", "Cerebral artery territories", "d", 800, 540, "Coronal section; deficits appear on the opposite side of the body")
    cx, cy, rx, ry = 300, 262, 180, 148
    clip_ellipse(f, "cb", cx, cy, rx, ry)
    f.ellipse(cx, cy, rx, ry, "#DCEAF7", INK, 2)
    f.add('<g clip-path="url(#cb)">')
    f.rect(cx - 62, cy - 160, 124, 190, "#BFE3D6", "none", 0, 0)
    f.rect(cx - 200, cy + 75, 400, 90, "#F5DDA6", "none", 0, 0)
    f.add("</g>")
    f.ellipse(cx, cy, rx, ry, "none", INK, 2)
    f.line(cx, cy - ry, cx, cy + 70, INK, 2.4)
    f.ellipse(cx, cy + 20, 70, 14, "none", GREY, 1.4)
    f.text(cx, cy + 4, "corpus callosum", 10.5, 500, GREY, "middle") if False else None
    f.label(cx + 28, cy - 80, "Anterior cerebral artery", 530, 130, 13, "start"); f.text(535, 148, "Contralateral leg weakness,", 12, 400, GREY); f.text(535, 163, "abulia, incontinence", 12, 400, GREY)
    f.label(cx + 130, cy - 20, "Middle cerebral artery", 530, 250, 13, "start"); f.text(535, 268, "Face and arm weakness; aphasia", 12, 400, GREY); f.text(535, 283, "(dominant), neglect (non-dominant)", 12, 400, GREY)
    f.label(cx + 60, cy + 120, "Posterior cerebral artery", 530, 380, 13, "start"); f.text(535, 398, "Contralateral homonymous", 12, 400, GREY); f.text(535, 413, "hemianopia, macula spared", 12, 400, GREY)
    f.text(400, 505, "Penetrating lenticulostriate branches of the MCA supply the internal capsule and basal ganglia.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-cerebral-cortex", 2, "Lateral view of the left cerebral hemisphere showing Broca area in the inferior frontal gyrus, Wernicke area in the posterior superior temporal gyrus, and the arcuate fasciculus connecting them, with three aphasia types listed below.",
     "Broca: expressive. Wernicke: receptive. Arcuate fasciculus lesion: repetition fails (conduction aphasia).")
def language_areas():
    f = F("x", "Language areas of the dominant hemisphere", "d", 800, 540, "Left hemisphere, lateral view: front of the brain on the left of the page")
    f.path(HEMI, "#F4FAF8", INK, 2.2)
    f.path("M330 262 C400 262 470 250 545 218", "none", GREY, 2); f.path("M420 108 C415 160 405 200 395 238", "none", GREY, 2)
    f.text(425, 122, "central sulcus", 11, 500, GREY); f.text(330, 288, "lateral sulcus", 11, 500, GREY)
    f.ellipse(265, 222, 38, 28, "#BFE3D6", TEAL, 2); f.text(265, 226, "Broca", 12.5, 700, INK, "middle")
    f.ellipse(545, 280, 44, 28, "#F5DDA6", AMBER, 2); f.text(545, 284, "Wernicke", 12.5, 700, INK, "middle")
    f.path("M535 250 C520 160 330 140 280 205", "none", RED, 4); f.arrow(300, 190, 282, 205, RED, 4, 10)
    f.text(410, 168, "arcuate fasciculus", 12, 600, RED, "middle")
    f.text(265, 262 if False else 262, "inferior frontal gyrus", 11, 500, GREY, "middle") if False else None
    f.text(140, 395 if False else 120, "Inferior frontal gyrus", 11.5, 500, GREY) if False else None
    f.box(40, 420, 230, 96, "Broca (expressive)\nNon-fluent, effortful speech\nComprehension intact\nRepetition impaired", "#FFFFFF", TEAL, 12)
    f.box(285, 420, 230, 96, "Wernicke (receptive)\nFluent but meaningless speech\nComprehension impaired\nRepetition impaired", "#FFFFFF", AMBER, 12)
    f.box(530, 420, 230, 96, "Conduction (arcuate)\nFluent, comprehension intact\nRepetition impaired\nNames wrong words", "#FFFFFF", RED, 12)
    return f

@fig("ana-cerebrum", 4, "Coronal brain schematic showing three fibre classes: commissural fibres crossing in the corpus callosum, association fibres arching within one hemisphere, and projection fibres running through the internal capsule to the brainstem.",
     "Commissural cross the midline, association stay in one hemisphere, projection connect cortex with lower centres.")
def fibre_types():
    f = F("x", "Three classes of white matter fibres", "d", 800, 520, "Coronal section of the cerebrum")
    cx, cy = 400, 240
    f.ellipse(cx, cy, 250, 150, "#F4FAF8", INK, 2.2); f.line(cx, cy - 150, cx, cy - 45, INK, 2.2)
    f.path("M250 205 C320 190 480 190 550 205", "none", AMBER, 11); f.text(400, 178, "Corpus callosum", 12.5, 700, AMBER, "middle")
    for d in (0, 1):
        f.path(f"M{455+d*30} 160 C{520+d*10} 130 {580+d*10} 170 {590} {215-d*20}", "none", TEAL, 4)
    f.path("M470 150 C560 120 600 190 600 250", "none", TEAL, 3) if False else None
    f.path("M440 210 C460 250 470 290 440 320", "none", TEAL, 4) if False else None
    for dx in (-18, 0, 18):
        f.path(f"M{270+dx*2} 140 C{285+dx} 200 {310+dx} 240 {330} 285", "none", RED, 4)
        f.line(330, 285, 335, 395 - 0, RED, 4) if dx == 0 else None
    f.arrow(335, 360, 335, 410, RED, 4, 11)
    f.text(560, 280, "Cingulum, arcuate and uncinate", 11.5, 500, TEAL, "start") if False else None
    f.box(40, 430, 230, 66, "Commissural\ncorpus callosum,\nanterior commissure", "#FFFFFF", AMBER, 11.5)
    f.box(285, 430, 230, 66, "Association\nwithin one hemisphere\n(SLF, uncinate, cingulum)", "#FFFFFF", TEAL, 11)
    f.box(530, 430, 230, 66, "Projection\ncorona radiata,\ninternal capsule", "#FFFFFF", RED, 11.5)
    f.text(250, 262, "projection", 12, 700, RED, "middle")
    f.text(560, 135, "association", 12, 700, TEAL, "middle")
    return f

@fig("ana-colon-rectum", 2, "Coronal diagram of the rectum with three lateral curves, three transverse folds (upper and lower on the left, the largest middle fold on the right), and peritoneal cover: upper third front and sides, middle third front only, lower third none.",
     "Peritoneum covers less of the rectum as you go down; the middle transverse fold is the largest and sits on the right.")
def rectum():
    f = F("x", "Rectum: curves, folds and peritoneal cover", "d", 800, 520, "Anterior view; about 12 cm long, starts at S3")
    pts = [(300, 120), (330, 170), (270, 250), (320, 335), (300, 400), (300, 450)]
    f.path(smooth(pts), "none", INK, 66); f.path(smooth(pts), "none", TINT, 60)
    f.text(300, 88, "S3: teniae coalesce", 12, 700, TEAL, "middle")
    f.line(270, 190, 305, 190, INK, 4); f.line(280, 285, 340, 285, INK, 4) if False else None
    f.line(255, 205, 295, 205, INK, 4); f.line(300, 262, 340, 262, INK, 4); f.line(280, 345, 320, 345, INK, 4)
    f.label(255, 205, "Upper fold (left)", 150, 170, 12.5, "end"); f.label(340, 262, "Middle fold (right, largest)", 420, 262, 12.5, "start") if False else None
    f.label(340, 262, "Middle fold (right)", 440, 232, 12.5, "start"); f.label(280, 345, "Lower fold (left)", 150, 380, 12.5, "end")
    f.line(262, 440, 338, 440, GREY, 1.5, "5 4"); f.text(262, 462, "anorectal junction", 12, 600, GREY, "end")
    X = 560
    for (y1, y2, t, t2, c) in ((110, 220, "Upper third", "peritoneum front and sides", "#BFE3D6"), (220, 330, "Middle third", "peritoneum front only", "#F5DDA6"), (330, 440, "Lower third", "no peritoneum (below the pouch)", "#F1C6C0")):
        f.rect(X, y1 + 4, 14, y2 - y1 - 8, c, INK, 1.2, 3); f.text(X + 26, (y1 + y2) / 2 - 2, t, 13, 700, INK); f.text(X + 26, (y1 + y2) / 2 + 16, t2, 11.5, 400, GREY)
    f.text(400, 502, "Peritoneum reflects to the bladder or to the uterus (pouch of Douglas).", 12, 400, GREY, "middle")
    return f

def mini_cart(f, x, y, w, h, kind):
    f.rect(x, y, w, h, "#EAF2F6" if kind != "fibro" else "#F5EFE3", LINE, 1.2, 6)
    if kind == "hyaline":
        for (a, b) in ((0.2, 0.3), (0.55, 0.65), (0.8, 0.25), (0.35, 0.7), (0.75, 0.75)):
            cx, cy = x + a * w, y + b * h
            f.ellipse(cx - 6, cy, 6, 8, "#9FB6C9", "#5C7D95", 1.2); f.ellipse(cx + 6, cy, 6, 8, "#9FB6C9", "#5C7D95", 1.2)
    elif kind == "elastic":
        for i in range(7):
            yy = y + 12 + i * (h - 24) / 6
            f.path(f"M{x+6} {yy:.0f} C{x+w*0.3:.0f} {yy-12:.0f} {x+w*0.6:.0f} {yy+12:.0f} {x+w-6:.0f} {yy:.0f}", "none", "#5B3A29", 1.4)
        for (a, b) in ((0.25, 0.3), (0.65, 0.5), (0.4, 0.78)): f.ellipse(x + a * w, y + b * h, 7, 9, "#EAF2F6", "#5C7D95", 1.4)
    else:
        for i in range(7): f.line(x + 6, y + 12 + i * (h - 24) / 6, x + w - 6, y + 12 + i * (h - 24) / 6, "#A58B64", 2)
        for (a, b) in ((0.2, 0.28), (0.5, 0.52), (0.78, 0.74), (0.3, 0.8)): f.ellipse(x + a * w, y + b * h, 8, 5, "#FFFFFF", "#5C7D95", 1.4)

@fig("ana-connective-cartilage-bone", 1, "Three cartilage types shown as microscopic motifs: hyaline with paired chondrocytes in clear matrix, elastic with a dense network of elastic fibres, fibrocartilage with parallel collagen bundles and rows of cells, with sites and perichondrium status listed.",
     "Hyaline and elastic cartilage have a perichondrium; fibrocartilage and articular cartilage do not, so they heal poorly.")
def cartilage_types():
    f = F("x", "Three types of cartilage", "d", 800, 470, "Cartilage has no blood vessels: chondrocytes are nourished by diffusion")
    info = (("hyaline", "Hyaline", "Type II collagen", "Articular surfaces, costal, nasal,\ntrachea, epiphyseal plate", "Perichondrium: yes\n(not on articular surface)"),
            ("elastic", "Elastic", "Type II collagen + elastin", "External ear, epiglottis,\nEustachian tube", "Perichondrium: yes"),
            ("fibro", "Fibrocartilage", "Type I collagen", "Intervertebral disc, pubic symphysis,\nmenisci", "Perichondrium: none"))
    for i, (k, t, c, s, p) in enumerate(info):
        x = 28 + i * 258
        mini_cart(f, x, 80, 230, 130, k)
        f.text(x + 115, 238, t, 15, 700, TEAL, "middle"); f.text(x + 115, 258, c, 12, 600, INK, "middle")
        f.text(x + 115, 286, s, 11.5, 400, GREY, "middle"); f.text(x + 115, 336, p, 11.5, 600, INK, "middle")
    f.text(400, 440, "Fibrocartilage is the only type with no perichondrium and with type I collagen.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-cranial-nerves", 1, "Course of the facial nerve: internal acoustic meatus, geniculate ganglion giving greater petrosal nerve, facial canal giving nerve to stapedius and chorda tympani, stylomastoid foramen giving posterior auricular and digastric branches, then the parotid plexus with five terminal branches.",
     "Branches come off in order of the nerve's route; the parotid plexus gives temporal, zygomatic, buccal, marginal mandibular and cervical branches.")
def facial_course():
    f = F("x", "Course and branches of the facial nerve (CN VII)", "d", 800, 600, "In order along the nerve; boxes on the right leave at that level")
    T = [(86, "Internal acoustic meatus"), (178, "Geniculate ganglion"), (270, "Facial canal (descends)"), (362, "Stylomastoid foramen (exit)"), (454, "Parotid plexus")]
    for i, (y, t) in enumerate(T):
        f.box(40, y, 230, 48, t, TINT, TEAL, 13)
        if i < 4: f.arrow(155, y + 48, 155, T[i + 1][0], TEAL, 2.4, 10)
    def br(y, h, t, ya, c=LINE):
        f.box(335, y, 440, h, t, "#FFFFFF", c, 11.5); f.arrow(270, ya, 333, y + h / 2, GREY, 1.6, 8)
    br(172, 60, "Greater petrosal nerve\nLacrimal, nasal and palatine glands", 202)
    br(256, 36, "Nerve to stapedius", 285)
    br(300, 60, "Chorda tympani\nTaste anterior two thirds; submandibular, sublingual glands", 295)
    br(374, 60, "Posterior auricular, posterior belly of digastric, stylohyoid", 386)
    br(446, 62, "Temporal, Zygomatic, Buccal, Marginal mandibular, Cervical\n\"To Zanzibar By Motor Car\"", 478, AMBER)
    f.text(400, 552, "LMN lesion (Bell palsy): whole ipsilateral face weak. UMN lesion: forehead spared.", 12.5, 600, INK, "middle")
    f.text(400, 574, "Motor root loops around the abducens nucleus (facial colliculus).", 12, 400, GREY, "middle")
    return f

@fig("ana-diencephalon", 3, "Table-style diagram linking each thalamic nucleus to its inputs and cortical targets: VPL to somatosensory cortex, VPM to face and taste, VL to motor cortex, VA to premotor cortex, LGN to visual cortex, MGN to auditory cortex, anterior nucleus to cingulate gyrus, dorsomedial to prefrontal cortex.",
     "Each thalamic nucleus is a relay with one main input and one main cortical target.")
def thalamic_relays():
    return pathways("x", "Thalamic nuclei as relays", "d", ["Input", "Thalamic nucleus", "Cortical target"],
        [("Medial lemniscus, spinothalamic", "VPL (body)", "Postcentral gyrus"), ("Trigeminal lemniscus, taste", "VPM (face)", "Postcentral gyrus, insula"),
         ("Cerebellum (dentate)", "VL", "Primary motor cortex"), ("Globus pallidus (GPi)", "VA", "Premotor, supplementary motor"),
         ("Retina (optic tract)", "Lateral geniculate", "Primary visual (V1)"), ("Inferior colliculus", "Medial geniculate", "Primary auditory"),
         ("Mammillary bodies", "Anterior", "Cingulate gyrus"), ("Amygdala, hypothalamus", "Dorsomedial", "Prefrontal cortex")],
        "All relay nuclei project to cortex; the reticular nucleus does not", widths=[250, 190, 250], rh=38, gap=12, top=100)

@fig("ana-digestive", 2, "Layered diagram of the duodenal wall from the lumen outward: mucosa with villi and crypts, muscularis mucosae, submucosa containing Brunner glands that secrete alkaline mucus, muscularis externa and outer adventitia or serosa.",
     "Brunner glands in the submucosa are the histological signature of the duodenum.")
def duodenal_wall():
    f = F("x", "Wall of the duodenum", "d", 800, 520, "Lumen at the top, layers in order")
    f.text(60, 108, "LUMEN", 12, 700, GREY)
    for i in range(6):
        x = 90 + i * 60
        f.path(f"M{x} 150 L{x} 112 Q{x+20} 96 {x+40} 112 L{x+40} 150", "#F5DDA6", INK, 1.6)
    f.rect(80, 150, 380, 56, "#F9ECD0", INK, 1.6, 0); f.text(270, 183, "Mucosa: villi + crypts of Lieberkuhn", 12.5, 600, INK, "middle")
    f.rect(80, 206, 380, 18, "#E4C9C4", INK, 1.4, 0)
    f.rect(80, 224, 380, 86, TINT, INK, 1.6, 0)
    for i in range(5): f.ellipse(120 + i * 70, 268 if i % 2 else 258, 26, 20, "#9FD3C3", TEAL, 1.6)
    f.text(270, 296, "Submucosa: Brunner glands", 12.5, 700, INK, "middle")
    f.rect(80, 310, 380, 40, "#E8C7C0", INK, 1.6, 0); f.text(270, 335, "Muscularis externa (circular, longitudinal)", 12.5, 600, INK, "middle")
    f.rect(80, 350, 380, 22, "#F4FAF8", INK, 1.6, 0); f.text(270, 366, "Serosa / adventitia", 12, 600, INK, "middle")
    f.line(460, 178, 520, 150, GREY, 1.2); f.text(526, 154, "Enterocytes, goblet cells", 12.5, 500, INK)
    f.line(460, 214, 520, 214, GREY, 1.2); f.text(526, 218, "Muscularis mucosae", 12.5, 500, INK)
    f.line(460, 262, 520, 262, GREY, 1.2); f.text(526, 255, "Brunner glands (compound", 12.5, 700, TEAL); f.text(526, 271, "tubuloalveolar): alkaline mucus,", 12.5, 700, TEAL); f.text(526, 287, "neutralises acid chyme", 12.5, 700, TEAL)
    f.line(460, 361, 520, 361, GREY, 1.2); f.text(526, 365, "D1 serosa; D2 to D4 adventitia", 12.5, 500, INK)
    f.text(400, 430, "Brunner glands: only in the duodenum. Peyer patches: ileum. Plicae are tallest in the jejunum.", 12.5, 500, GREY, "middle")
    f.text(400, 452, "The duct of each gland opens into a crypt.", 12.5, 400, GREY, "middle")
    return f

def acinus(f, cx, cy, kind, R=56):
    f.circle(cx, cy, R, "#F7F2FA" if kind == "serous" else "#F2F6F6", INK, 1.8)
    n = 8
    for i in range(n):
        a = 2 * math.pi * i / n
        f.line(cx + R * 0.28 * math.cos(a), cy + R * 0.28 * math.sin(a), cx + R * math.cos(a), cy + R * math.sin(a), LINE, 1.2)
        if kind == "serous":
            f.circle(cx + R * 0.68 * math.cos(a + math.pi / n), cy + R * 0.68 * math.sin(a + math.pi / n), 5.5, "#35508A", "#35508A", 0)
            for j in range(3): f.circle(cx + R * 0.42 * math.cos(a + 0.2 + j * 0.2), cy + R * 0.42 * math.sin(a + 0.2 + j * 0.2), 1.8, "#A090B8", "#A090B8", 0)
        else:
            px, py = cx + R * 0.88 * math.cos(a + math.pi / n), cy + R * 0.88 * math.sin(a + math.pi / n)
            f.ellipse(px, py, 7, 3.2, "#35508A", "#35508A", 0, math.degrees(a + math.pi / n) + 90)
    f.circle(cx, cy, R * 0.2 if kind == "serous" else R * 0.3, "#FFFFFF", GREY, 1.2)

@fig("ana-digestive", 5, "Serous acinus with round dark basal nuclei and granular cytoplasm beside a mucous acinus with flattened basal nuclei and pale cytoplasm, and a list of glands that are serous, mucous or mixed.",
     "Serous cells: round nuclei, dark. Mucous cells: flattened basal nuclei, pale.")
def acini():
    f = F("x", "Serous and mucous acini", "d", 800, 440, "Cross-section of one acinus, lumen in the centre")
    acinus(f, 200, 190, "serous"); acinus(f, 600, 190, "mucous")
    f.text(200, 290, "Serous", 16, 700, TEAL, "middle"); f.text(600, 290, "Mucous", 16, 700, TEAL, "middle")
    f.text(200, 312, "Round central nuclei, dark granular cytoplasm", 12, 500, INK, "middle"); f.text(200, 330, "Parotid, pancreas, von Ebner glands", 12, 400, GREY, "middle")
    f.text(600, 312, "Flattened basal nuclei, pale foamy cytoplasm", 12, 500, INK, "middle"); f.text(600, 330, "Sublingual (mostly), palatine glands, Brunner", 12, 400, GREY, "middle")
    f.text(400, 400, "Submandibular gland: mixed, mostly serous; mucous acini carry serous demilunes.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-duodenum-pancreas-biliary", 1, "Anterior view of the C-shaped duodenum around the head of the pancreas, with neck, body and tail running to the left, the superior mesenteric vein and artery crossing the third part, and labels for the common bile duct, ampulla and posterior relations.",
     "The pancreatic head sits in the C-loop; the CBD runs behind it and the SMV and SMA cross the third part of the duodenum.")
def pancreas_cloop():
    f = F("x", "Pancreas and the duodenal C-loop", "d", 800, 560, "Anterior view: patient right on the left of the page")
    thick(f, [(420, 150), (330, 135), (250, 175), (240, 280), (250, 390), (330, 430), (440, 432), (520, 410), (545, 340), (545, 300)], "#F1C6A0", 28)
    f.path(smooth([(420, 150), (330, 135), (250, 175), (240, 280), (250, 390), (330, 430), (440, 432), (520, 410), (545, 340), (545, 300)]), "none", INK, 1.5, "3 3")
    f.path("M285 215 C285 190 360 190 395 230 C440 260 540 250 650 200 C690 190 700 215 660 235 C560 300 420 315 385 330 C340 380 285 370 285 320 Z", "#F5DDA6", INK, 2)
    f.circle(425, 275, 8, "#3E6FA5", INK, 1.8); f.circle(455, 275, 8, RED, INK, 1.8)
    f.line(425, 283, 425, 440, "#3E6FA5", 4); f.line(455, 283, 455, 440, RED, 4)
    f.text(425, 462, "SMV", 12, 700, INK, "middle"); f.text(458, 462, "SMA", 12, 700, INK, "start")
    f.text(310, 120, "D1 (bulb)", 12, 700, TEAL, "end"); f.text(222, 285, "D2", 12, 700, TEAL, "end"); f.text(390, 455, "D3", 12, 700, TEAL, "end"); f.text(565, 345, "D4", 12, 700, TEAL)
    f.text(325, 300, "Head", 14, 700, INK, "middle"); f.text(460, 220, "Neck", 12.5, 700, INK, "middle") if False else None
    f.text(560, 255, "Body", 13, 700, INK, "middle"); f.text(670, 190, "Tail (to splenic hilum)", 12, 700, INK, "middle")
    f.circle(257, 255, 5, INK, INK, 0); f.label(257, 255, "Major duodenal papilla (ampulla of Vater)", 40, 215, 12, "start") if False else None
    f.label(257, 255, "Ampulla of Vater", 120, 232, 12, "end")
    f.circle(458, 520, 0, "none", "none", 0)
    f.text(60, 505, "Behind the head: common bile duct, IVC, right renal vein. Uncinate process lies behind the SMV.", 12.5, 500, GREY)
    f.text(60, 527, "The SMV lies to the right of the SMA.", 12.5, 500, GREY)
    return f

@fig("ana-ear", 1, "Chain of ossicles: tympanic membrane to malleus, incus and stapes footplate in the oval window, with tensor tympani on the malleus supplied by CN V3 and stapedius on the stapes supplied by CN VII.",
     "Sound passes membrane, malleus, incus, stapes; two small muscles dampen loud sound.")
def ossicle_chain():
    return graph("x", "Middle ear ossicles and muscles", "d", [[("tm", "Tympanic\nmembrane"), ("m", "Malleus"), ("i", "Incus"), ("s", "Stapes"), ("ow", "Oval window\n(perilymph)")], [None, ("tt", "Tensor tympani\n(CN V3)"), None, ("st", "Stapedius\n(CN VII)"), None]],
                 [("tm", "m"), ("m", "i"), ("i", "s"), ("s", "ow"), ("tt", "m"), ("st", "s")], "Air vibrations become fluid waves in the cochlea", rh=60, gap=66, top=100, nodestyle={"tt": {"fill": "#FFF1CC", "stroke": AMBER}, "st": {"fill": "#FFF1CC", "stroke": AMBER}},
                 notes=["Malleus handle attaches at the umbo; stapes footplate sits in the oval window.", "Both muscles contract reflexively in loud noise."])

def epi_glyph(f, kind, x, y, w):
    h = 84
    if kind == "nonker":
        for r in range(4):
            for c in range(int(w // 34)):
                cy = y + h - 14 - r * 15 if r else y + h - 18
                f.ellipse(x + 17 + c * 34 + (r % 2) * 6, y + h - 12 - r * 18, 16, 7 + (3 - r) * 0.2 if r < 3 else 6, "#F5DDA6", INK, 1); f.circle(x + 17 + c * 34 + (r % 2) * 6, y + h - 12 - r * 18, 2.4, "#35508A", "#35508A", 0)
    elif kind == "ker":
        for r in range(3):
            for c in range(int(w // 34)):
                f.ellipse(x + 17 + c * 34 + (r % 2) * 6, y + h - 12 - r * 18, 16, 7, "#F5DDA6", INK, 1); f.circle(x + 17 + c * 34 + (r % 2) * 6, y + h - 12 - r * 18, 2.4, "#35508A", "#35508A", 0)
        for c in range(int(w // 34)): f.rect(x + c * 34 + 2, y + 6, 30, 7, "#E2B3A8", INK, 1, 2)
    elif kind == "trans":
        for c in range(int(w // 34)):
            f.ellipse(x + 17 + c * 34, y + h - 12, 15, 9, "#D8E4EE", INK, 1); f.ellipse(x + 17 + c * 34 + 12, y + h - 36, 15, 11, "#D8E4EE", INK, 1)
        for c in range(int(w // 52)): f.path(f"M{x+c*52+6} {y+30} Q{x+c*52+26} {y+2} {x+c*52+46} {y+30} Z", "#C3D5E4", INK, 1.2)
    elif kind == "pseudo":
        for c in range(int(w // 22)):
            top = y + 18 + (c % 3) * 8
            f.rect(x + c * 22 + 3, top, 16, y + h - top, "#D9EBD9", INK, 1, 3); f.circle(x + c * 22 + 11, y + h - 14 - (c % 3) * 14, 3, "#35508A", "#35508A", 0)
            if c % 4 != 3:
                for j in range(3): f.line(x + c * 22 + 5 + j * 5, top, x + c * 22 + 5 + j * 5, top - 8, INK, 1)
    elif kind == "col":
        for c in range(int(w // 24)):
            f.rect(x + c * 24 + 2, y + 18, 20, h - 18, "#FBEFD2", INK, 1, 2); f.circle(x + c * 24 + 12, y + h - 16, 3, "#35508A", "#35508A", 0)
            for j in range(4): f.line(x + c * 24 + 6 + j * 4, y + 18, x + c * 24 + 6 + j * 4, y + 11, INK, 0.9)
    else:
        for c in range(int(w // 34)):
            f.rect(x + c * 34 + 3, y + 24, 28, 28, "#DCEAF7", INK, 1.2, 2); f.circle(x + c * 34 + 17, y + 38, 4.5, "#35508A", "#35508A", 0)
    f.line(x, y + h, x + w, y + h, INK, 2.5)

@fig("ana-epithelium", 1, "Six epithelia drawn as cell layers: non-keratinised and keratinised stratified squamous, transitional, pseudostratified ciliated columnar, simple columnar with microvilli, and simple cuboidal, each with where it is found.",
     "Match the epithelium to the site: oral cavity and vagina, skin, bladder, airway, gut, kidney tubules.")
def epithelia():
    f = F("x", "High-yield epithelia and where they sit", "d", 800, 600, "Basement membrane drawn as the heavy line under each")
    items = (("nonker", "Non-keratinised stratified squamous", "Oral cavity, oesophagus, vagina, cornea"), ("ker", "Keratinised stratified squamous", "Epidermis of skin"), ("trans", "Transitional (urothelium)", "Renal pelvis, ureter, bladder"),
             ("pseudo", "Pseudostratified ciliated columnar", "Trachea, bronchi, nasal cavity"), ("col", "Simple columnar, microvilli", "Small intestine, colon"), ("cub", "Simple cuboidal", "Kidney tubules, thyroid follicles"))
    for i, (k, t, s) in enumerate(items):
        x = 24 + (i % 3) * 262; y = 80 + (i // 3) * 255
        epi_glyph(f, k, x, y, 226)
        f.text(x + 113, y + 112, t, 11.5, 700, TEAL, "middle", 252) if len(t) < 40 else f.text(x + 113, y + 112, t, 11, 700, TEAL, "middle")
        f.text(x + 113, y + 132, s, 11, 400, INK, "middle")
    return f

@fig("ana-female-reproductive", 0, "Table diagram of the five ligaments of the uterus with their attachments and roles: cardinal ligament main support, uterosacral keeps anteversion, round ligament to labium majus, broad ligament peritoneal fold, pubocervical to pubis.",
     "The cardinal ligament is the main support; the round ligament holds the uterus anteverted and runs through the inguinal canal.")
def uterine_ligaments():
    return pathways("x", "Ligaments that hold the uterus", "d", ["Ligament", "Runs between", "Role"],
        [("Cardinal (transverse cervical)", "Cervix and vaginal vault to lateral pelvic wall", "Main support; uterine artery crosses above the ureter"), ("Uterosacral", "Cervix to sacrum", "Keeps the cervix back (anteversion)"),
         ("Round ligament", "Uterine horn, deep inguinal ring, labium majus", "Pulls fundus forward (anteversion)"), ("Pubocervical", "Cervix to pubis", "Supports the front of the cervix"),
         ("Broad ligament", "Peritoneal fold, uterus to pelvic side wall", "Not a true support; contains tube, ovarian ligament")],
        "Anteverted: cervix points back. Anteflexed: body bends forward on the cervix", widths=[200, 280, 250], rh=60, gap=12, top=104)

@fig("ana-foot", 4, "Sole of the right foot showing the medial plantar nerve territory over the medial two thirds of the sole and medial three and a half toes, and the lateral plantar nerve over the lateral third and lateral one and a half toes.",
     "Medial plantar: medial 3.5 toes. Lateral plantar: lateral 1.5 toes. Think of it like the median and ulnar nerves of the hand.")
def sole_nerves():
    f = F("x", "Plantar nerves of the foot", "d", 800, 540, "Sole of the right foot; big toe on the left of the page")
    dx = 40
    f.add('<g transform="translate(%d,0)">' % dx)
    sole = "M335 200 C320 260 345 330 350 380 C355 430 360 490 410 500 C460 505 490 470 495 420 C500 360 510 250 505 205 Z"
    f.path(sole, TINT, INK, 2.2)
    f.add('<clipPath id="so"><path d="%s"/></clipPath>' % sole); f.add('<g clip-path="url(#so)">'); f.rect(455, 190, 80, 330, "#F5DDA6", "none", 0, 0); f.add("</g>"); f.path(sole, "none", INK, 2.2)
    f.line(455, 205, 455, 400, GREY, 1.4, "5 4")
    toes = [(350, 152, 28), (404, 128, 17), (440, 135, 16), (472, 150, 15), (500, 175, 13)]
    for i, (x, y, r) in enumerate(toes): f.circle(x, y, r, TINT if i < 3 else "#F5DDA6", INK, 1.8)
    x, y, r = toes[3]
    f.circle(x, y, r, TINT, INK, 1.8); f.path(f"M{x} {y-r} A{r} {r} 0 0 1 {x} {y+r} Z", "#F5DDA6", INK, 1.8)
    f.text(420, 466, "heel", 12, 600, INK, "middle")
    f.circle(380, 300, 2.6, INK, INK, 0); f.circle(485, 300, 2.6, INK, INK, 0)
    f.add("</g>")
    f.line(380 + dx, 300, 250, 300, GREY, 1.1); f.text(244, 304, "Medial plantar nerve", 13, 500, INK, "end"); f.text(244, 322, "Medial 3.5 toes,", 11.5, 400, GREY, "end"); f.text(244, 337, "medial two thirds of sole", 11.5, 400, GREY, "end")
    f.line(485 + dx, 300, 600, 300, GREY, 1.1); f.text(606, 304, "Lateral plantar nerve", 13, 500, INK); f.text(606, 322, "Lateral 1.5 toes,", 11.5, 400, GREY); f.text(606, 337, "lateral third of sole", 11.5, 400, GREY)
    f.text(40, 130, "Medial plantar muscles (LAFF):", 12, 700, TEAL); f.text(40, 148, "1st Lumbrical, Abductor hallucis,", 11.5, 400, GREY); f.text(40, 163, "Flexor hallucis brevis,", 11.5, 400, GREY); f.text(40, 178, "Flexor digitorum brevis", 11.5, 400, GREY)
    f.text(620, 130, "Lateral plantar:", 12, 700, AMBER); f.text(620, 148, "all other intrinsic muscles", 11.5, 400, GREY); f.text(620, 163, "and the interossei", 11.5, 400, GREY)
    f.text(400, 524, "Both are terminal branches of the tibial nerve.", 12.5, 500, GREY, "middle")
    return f

@fig("ana-forearm-hand", 6, "Two views of the left forearm. In supination radius and ulna lie parallel with the radius lateral; in pronation the radius crosses over the ulna, pivoting about an axis from the radial head to the ulnar head.",
     "Pronation crosses the radius over the ulna; the radius rotates at both the proximal and distal radioulnar joints.")
def pronation():
    f = F("x", "Supination and pronation", "d", 800, 520, "Left forearm, front view; the radius rotates round the ulna")
    for (x, t, mode) in ((200, "Supinated", 0), (580, "Pronated", 1)):
        f.text(x, 96, t, 15, 700, TEAL, "middle")
        f.line(x, 130, x, 360, "#7A8FB5", 10); f.circle(x, 365, 9, "#7A8FB5", INK, 1.5)
        if not mode: f.line(x + 34, 135, x + 40, 355, AMBER, 9)
        else: f.line(x + 34, 135, x - 28, 355, AMBER, 9)
        f.circle(x + 34, 132, 11, AMBER, INK, 1.5)
        f.line(x + 34, 132, x, 365, GREY, 1.4, "5 4")
        f.text(x - 18, 140, "Ulna", 12, 700, INK, "end"); f.text(x + 52, 132, "Radius", 12, 700, INK)
    f.text(200, 410, "Supinators: supinator, biceps brachii", 12.5, 600, INK, "middle"); f.text(580, 410, "Pronators: pronator teres, pronator quadratus", 12.5, 600, INK, "middle")
    f.text(400, 460, "Dashed line: axis through the radial head and the ulnar head.", 12.5, 500, GREY, "middle")
    f.text(400, 480, "The middle radioulnar joint is a fibrous interosseous membrane and does not rotate.", 12, 400, GREY, "middle")
    return f

@fig("ana-gametogenesis", 2, "Outcomes of nondisjunction: normal meiosis gives four normal gametes; nondisjunction in meiosis I gives four abnormal gametes, two with an extra chromosome and two missing one; nondisjunction in meiosis II gives two normal gametes, one with an extra and one missing.",
     "Meiosis I error: all four gametes abnormal. Meiosis II error: two normal, two abnormal.")
def nondisjunction():
    return graph("x", "Nondisjunction in meiosis", "d", [[("n", "Normal meiosis"), ("a", "Nondisjunction\nin meiosis I"), ("b", "Nondisjunction\nin meiosis II")], [("n2", "Four gametes: n\n(all normal)"), ("a2", "Two gametes n+1\nTwo gametes n-1"), ("b2", "Two gametes n\nOne n+1, one n-1")]],
                 [("n", "n2"), ("a", "a2"), ("b", "b2")], "n = haploid chromosome number; n+1 gives trisomy at fertilisation, n-1 gives monosomy", rh=64, gap=60, top=100,
                 nodestyle={"a": {"fill": "#FFF1CC", "stroke": AMBER}, "b": {"fill": "#FFF1CC", "stroke": AMBER}},
                 notes=["Trisomy 21 (Down syndrome) is most often from maternal meiosis I nondisjunction.", "Risk rises with maternal age."])

@fig("ana-gluteal-hip", 1, "Posterior view of the greater and lesser sciatic foramina: the piriformis divides the greater foramen, with the superior gluteal nerve and vessels above it and the sciatic, inferior gluteal, pudendal and other nerves below it; the lesser foramen carries the obturator internus tendon, pudendal nerve, internal pudendal vessels and nerve to obturator internus.",
     "Piriformis is the landmark: superior gluteal above, everything else below. The pudendal nerve leaves through the greater foramen and re-enters through the lesser.")
def sciatic_foramina():
    f = F("x", "Greater and lesser sciatic foramina", "d", 800, 540, "Posterior view of the gluteal region (schematic)")
    f.box(30, 90, 400, 62, "ABOVE piriformis\nSuperior gluteal nerve and vessels", "#DCEAF7", "#3E6FA5", 13)
    f.box(30, 158, 400, 36, "PIRIFORMIS", "#E7B9B0", INK, 14)
    f.box(30, 200, 400, 210, "BELOW piriformis\nInferior gluteal nerve and vessels\nSciatic nerve\nPosterior cutaneous nerve of thigh\nNerve to quadratus femoris\nPudendal nerve, internal pudendal vessels\nNerve to obturator internus", "#F4FAF8", TEAL, 12.5, 600)
    f.text(230, 78, "Greater sciatic foramen", 14, 700, TEAL, "middle")
    f.box(490, 200, 280, 160, "Tendon of obturator internus\nPudendal nerve\nInternal pudendal vessels\nNerve to obturator internus", "#FFF1CC", AMBER, 12.5, 600)
    f.text(630, 188, "Lesser sciatic foramen", 14, 700, AMBER, "middle")
    f.arrow(432, 330, 488, 290, RED, 2.6, 10)
    f.text(460, 270, "pudendal n.", 11.5, 700, RED, "middle"); f.text(460, 284, "hooks round", 11.5, 700, RED, "middle"); f.text(460, 298, "ischial spine", 11.5, 700, RED, "middle")
    f.text(400, 450, "Lesser foramen mnemonic PIN: Pudendal nerve, Internal pudendal vessels, Nerve to obturator internus.", 12.5, 600, INK, "middle")
    f.text(400, 472, "Spine and sacrospinous ligament separate the two foramina.", 12, 400, GREY, "middle")
    return f

def stick(f, x, tilt, stance_right=True, label=""):
    f.circle(x, 112, 22, "#FFFFFF", INK, 2.4)
    top = (x, 140); pr, pl = (x + 55, 270 - tilt), (x - 55, 270 + tilt)
    f.line(x, 140, x, 225, INK, 4); f.line(pl[0], pl[1], pr[0], pr[1], TEAL, 6)
    f.line(x - 80 if False else x - 40, 160, x + 40, 160, INK, 3)
    f.line(pr[0], pr[1], pr[0], 440, INK, 5); f.line(pl[0], pl[1], pl[0], pl[1] + 55, INK, 5); f.line(pl[0], pl[1] + 55, pl[0] + 36, pl[1] + 95, INK, 5)

@fig("ana-gluteal-hip", 3, "Flow diagram of the Trendelenburg test: standing on the right leg needs right gluteus medius and minimus, supplied by the superior gluteal nerve, to hold the pelvis level; if they fail the pelvis drops on the left, a positive sign.",
     "The pelvis drops on the side opposite the weak stance-side abductors.")
def trendelenburg():
    return graph("x", "Trendelenburg test: why the pelvis drops", "d", [[("a", "Stand on the right leg\n(left foot lifted)")], [("b", "Right gluteus medius and minimus\nabduct the hip and fix the pelvis")], [("c", "Normal: pelvis stays level"), ("d", "Weak or paralysed:\nleft pelvis drops (positive)")]],
                 [("a", "b"), ("b", "c"), ("b", "d")], "Nerve supply: superior gluteal nerve (L4, L5, S1)", cw=300, rh=60, gap=40, top=96,
                 nodestyle={"d": {"fill": "#FBE3E0", "stroke": RED}}, notes=["Causes: superior gluteal nerve injury, hip dislocation, coxa vara, polio.", "The patient lurches over the weak side to compensate (Trendelenburg gait)."])

@fig("ana-gluteal-hip", 4, "Flow diagram of femoral head blood supply: medial circumflex femoral artery gives retinacular branches to the head as the main supply, lateral circumflex femoral is a lesser contributor, and the obturator artery gives the artery of the ligament of the head, minor in adults.",
     "The medial circumflex femoral artery dominates; an intracapsular neck fracture can tear its retinacular branches and cause avascular necrosis.")
def femoral_head_supply():
    return graph("x", "Blood supply of the femoral head", "d", [[("m", "Medial circumflex\nfemoral artery"), ("l", "Lateral circumflex\nfemoral artery"), ("o", "Obturator artery")], [("r", "Retinacular branches\n(lateral retinacular key)"), None, ("t", "Artery of the ligament\nof the head")], [("h", "Head of femur")]],
                 [("m", "r"), ("r", "h"), ("o", "t"), ("t", "h"), ("l", "h", "", "dash")], "Main supply: medial circumflex; lateral circumflex lesser; ligament artery minor in adults", cw=220, rh=58, gap=48, top=96,
                 nodestyle={"m": {"fill": "#FBE3E0", "stroke": RED}, "r": {"fill": "#FBE3E0", "stroke": RED}}, notes=["Intracapsular neck fracture can tear the retinacular vessels: avascular necrosis."])
