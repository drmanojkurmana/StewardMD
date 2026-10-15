"""Batch 10: 8 original medicine SVGs (stroke clock, sodium ladder, potassium
steps, HF diuretics, aortic murmurs, TB ATT, DKA vs HHS, gap math). ASCII only,
no em/en dashes. Palette and 800x520 stage match the bank (lib.py)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import lib
from lib import F, INK, TEAL, TINT, AMBER, GREY, RED, LINE
MEDIA = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "prep/lessons/media"))

def save(f, stem):
    f.name = stem
    lib.CUR[0] = stem
    open(f"{MEDIA}/{stem}.svg", "w").write(f.build())
    return stem, round(f.w / f.h, 4)

def h2(f, y, left, right):
    f.box(30, y, 355, 150, left, TINT, TEAL)
    f.box(415, y, 355, 150, right, "#FFFFFF", LINE)

def stroke_clock():
    t = "Stroke: the clock decides"
    d = "Last-known-well starts every countdown: alteplase to 4.5 hours, thrombectomy for large vessels to 24 hours, then aspirin, clopidogrel and statin."
    f = F("x", t, d, sub="Last-known-well starts every countdown")
    f.line(60, 110, 740, 110, GREY, 2.4)
    for x, lab, sub2 in [(60, "Onset", "last-known-well"), (330, "4.5 h", "alteplase gate"), (740, "24 h", "thrombectomy gate")]:
        f.line(x, 100, x, 120, INK, 2.4)
        f.text(x, 140, lab, 13, 700, INK, "middle")
        f.text(x, 157, sub2, 11.5, 400, GREY, "middle")
    f.box(30, 185, 355, 120, "ISCHAEMIC: alteplase to 4.5 h", TINT, TEAL)
    f.box(415, 185, 355, 120, "Large vessel: thrombectomy to 24 h", TINT, TEAL)
    f.box(30, 325, 355, 90, "Then: aspirin + clopidogrel + statin", "#FFFFFF", LINE)
    f.box(415, 325, 355, 90, "Bleed: lower BP, reverse, operate", "#FFF1CC", AMBER)
    f.text(400, 455, "Lysis with bleed kills.", 12.5, 600, RED, "middle")
    f.text(400, 477, "Unsafe swallow drowns: screen first, NG only. Malignant infarct: hemicraniectomy saves.", 12.5, 500, GREY, "middle")
    return f

def sodium_ladder():
    t = "Sodium: volume sorts, speed kills"
    d = "Hypovolemic takes isotonic fill, euvolemic SIADH restricts fluids with salt tablets, central DI takes DDAVP; seizures or coma take 100 mL hypertonic, and correction stays at 8 to 10 per day."
    f = F("x", t, d, sub="Fix the cause, respect the ceiling")
    f.box(30, 80, 230, 120, "HYPOvolemic: isotonic fill", TINT, TEAL, size=12.5)
    f.box(285, 80, 230, 120, "EUvolemic SIADH: restrict + salt tabs", TINT, TEAL, size=12.5)
    f.box(540, 80, 230, 120, "Central DI: DDAVP spray", TINT, TEAL, size=12.5)
    f.box(180, 225, 440, 80, "Seizures or coma: hypertonic 100 mL", "#FFF1CC", AMBER)
    f.rect(30, 330, 740, 64, "#FFFFFF", LINE, 1.6)
    f.rect(30, 330, 500, 64, TINT, TEAL, 0, 8)
    f.text(280, 368, "Ceiling: 8 to 10 per day", 13, 700, INK, "middle")
    f.text(635, 360, "Faster risks", 12.5, 600, RED, "middle")
    f.text(635, 378, "myelinolysis", 12.5, 600, RED, "middle")
    f.text(400, 430, "Overcorrection: DDAVP clamp. Chronic: go slow.", 12.5, 500, GREY, "middle")
    f.text(400, 452, "Treat the tumour, adrenal or thyroid behind it.", 12.5, 500, GREY, "middle")
    return f

def potassium_steps():
    t = "High potassium: protect, shift, remove"
    d = "Calcium guards the membrane when the ECG changes, insulin with glucose plus salbutamol shifts potassium in, and patiromer or dialysis removes it; peaked T to wide QRS to sine means act now."
    f = F("x", t, d, sub="Calcium first when the ECG changes")
    f.box(30, 80, 230, 150, "PROTECT: calcium guards membrane", TINT, TEAL, size=12.5)
    f.box(285, 80, 230, 150, "SHIFT: insulin + glucose, salbutamol", TINT, TEAL, size=12.5)
    f.box(540, 80, 230, 150, "REMOVE: patiromer binds, dialysis", TINT, TEAL, size=12.5)
    f.rect(30, 255, 740, 90, "#FFFFFF", LINE, 1.6)
    f.text(400, 285, "Peaked T  to  flat P  to  wide QRS  to  sine: act", 13, 700, INK, "middle")
    f.text(400, 312, "Magnesium for torsades. Stop ACE and trimethoprim.", 12.5, 500, GREY, "middle")
    f.text(400, 385, "Rebound glucose: watch after insulin. Refeeding: slow plus thiamine.", 12.5, 500, GREY, "middle")
    f.text(400, 407, "Unmonitored arrest kills: continuous ECG until steady.", 12.5, 600, RED, "middle")
    return f

def hf_diuretics():
    t = "Diuretics: dry the lungs, not the future"
    d = "Diuretics ease congestion only and add no survival: double the home oral dose as IV bolus or infusion, and resistance means urine sodium 90 or less after 3 days of high-dose loops."
    f = F("x", t, d, sub="Congestion only: no survival gain")
    f.box(120, 90, 250, 110, "Home oral dose", "#FFFFFF", LINE)
    f.arrow(370, 145, 420, 145, GREY, 2)
    f.text(395, 128, "2x", 13, 700, INK, "middle")
    f.box(430, 90, 250, 110, "IV bolus or infusion", TINT, TEAL)
    f.box(120, 235, 560, 110, "Resistance: urine sodium 90 or less after 3 days of high-dose loops", "#FFF1CC", AMBER, size=12.5)
    f.text(400, 385, "Twice the dose, watch the kidneys and potassium.", 12.5, 500, GREY, "middle")
    f.text(400, 407, "Four pillars treat the failure; water pills only dry it.", 12.5, 500, GREY, "middle")
    return f

def murmur_as_ar():
    t = "Aortic valve: narrow vs leaky"
    d = "Stenosis faints with SAD, rises slow, and crescendos to the carotids; regurgitation collapses the pulse, widens the pressure, and murmurs early diastolic at the left sternal edge."
    f = F("x", t, d, sub="SAD faints, leaks collapse")
    f.box(30, 80, 355, 200, "STENOSIS: SAD syncope angina dyspnoea. Slow-rising pulse, narrow pressure. Crescendo systolic to carotids, S4. TAVR if high risk; Bentall for root.", TINT, TEAL, size=11.5)
    f.box(415, 80, 355, 200, "REGURG: collapsing pulse, wide pressure. Early diastolic murmur, left sternal edge. Austin Flint, pistol shot, Duroziez. Marfan root: dissection alarm.", "#FFFFFF", LINE, size=11.5)
    f.text(207, 320, "Systole: crescendo", 12.5, 700, INK, "middle")
    f.path("M80 360 L207 360 L250 332 L293 388 L336 360 L340 360", "none", TEAL, 2.2)
    f.line(70, 388, 350, 388, LINE, 1.4)
    f.text(592, 320, "Diastole: decrescendo", 12.5, 700, INK, "middle")
    f.line(450, 332, 460, 332, GREY, 1.4)
    f.path("M465 332 L720 388", "none", TEAL, 2.2)
    f.line(450, 388, 730, 388, LINE, 1.4)
    f.text(207, 412, "S1 --- S2", 11.5, 500, GREY, "middle")
    f.text(592, 412, "S2 --- S1", 11.5, 500, GREY, "middle")
    f.text(400, 460, "Pregnancy and AF with MS: the mitral side decompensates and clots.", 12.5, 500, GREY, "middle")
    return f

def tb_att():
    t = "TB: 2 months of four, 4 months of two"
    d = "Daily 2HRZE then 4HR under DOTS: steroids for meningeal or pericardial disease, bedaquiline with delamanid for MDR, timed ART with IRIS watch for HIV."
    f = F("x", t, d, sub="Daily DOTS to the finish")
    f.box(60, 90, 320, 90, "Intensive: 2HRZE daily", TINT, TEAL)
    f.arrow(380, 135, 420, 135, GREY, 2)
    f.box(420, 90, 320, 90, "Continuation: 4HR daily", TINT, TEAL)
    f.text(400, 208, "DOTS observes every dose; monthly sputum and weight.", 12.5, 500, GREY, "middle")
    f.box(30, 240, 230, 120, "Steroids: meningeal + pericardial", "#FFFFFF", LINE, size=12)
    f.box(285, 240, 230, 120, "MDR: bedaquiline + delamanid", "#FFFFFF", LINE, size=12)
    f.box(540, 240, 230, 120, "HIV: time ART, watch IRIS", "#FFFFFF", LINE, size=12)
    f.text(400, 400, "Yellow: stop for liver. Red-green blur: ethambutol eyes.", 12.5, 600, RED, "middle")
    f.text(400, 422, "Gouty joints: pyrazinamide. Default breeds MDR.", 12.5, 500, GREY, "middle")
    return f

def dka_hhs():
    t = "Sugar crises: DKA vs HHS"
    d = "DKA vomits with Kussmaul breath and fruity ketones and resolves with fluids, potassium then insulin; HHS is drowsy and hyperosmolar and corrects slow."
    f = F("x", t, d, sub="Fluids and potassium first, insulin after")
    f.box(30, 80, 355, 220, "DKA: vomiting, Kussmaul, fruity. Fluids + potassium, then insulin. Check beta-hydroxybutyrate. Metformin first fails here.", TINT, TEAL, size=12)
    f.box(415, 80, 355, 220, "HHS: drowsy, very high osmolarity. Slow correction, gentle fluids. Watch the brain as water returns.", "#FFFFFF", LINE, size=12)
    f.text(400, 345, "SGLT2 with normal sugar can still keto: check ketones.", 12.5, 600, RED, "middle")
    f.text(400, 367, "Hypos warn drivers. Sick-day rules: never stop basal.", 12.5, 500, GREY, "middle")
    return f

def gap_delta():
    t = "Acidosis: let the gap sort it"
    d = "Normal gap means RTA, diarrhoea, saline or ureteral diversion; high gap means renal failure, lactic, DKA or toxic ingestion; urine gap positive points to kidney, negative to gut."
    f = F("x", t, d, sub="Urine gap points to kidney or gut")
    f.box(30, 80, 355, 170, "NORMAL gap: RTA, diarrhoea, saline infusion, ureteral diversion", "#FFFFFF", LINE, size=12)
    f.box(415, 80, 355, 170, "HIGH gap: renal failure, lactic, DKA, toxic ingestion", TINT, TEAL, size=12)
    f.box(120, 280, 280, 90, "Urine gap POSITIVE: kidney (RTA)", TINT, TEAL, size=12.5)
    f.box(420, 280, 280, 90, "Urine gap NEGATIVE: gut (diarrhoea)", "#FFFFFF", LINE, size=12.5)
    f.text(400, 410, "Delta gap and delta ratio unmask mixed disorders.", 12.5, 500, GREY, "middle")
    f.text(400, 432, "Type 1 distal: urine pH above 5.5. Type 4: aldosterone low, potassium high.", 12.5, 500, GREY, "middle")
    return f

MADE = []
MADE.append(save(stroke_clock(), "med-stroke-clock"))
MADE.append(save(sodium_ladder(), "med-sodium-ladder"))
MADE.append(save(potassium_steps(), "med-potassium-steps"))
MADE.append(save(hf_diuretics(), "med-hf-diuretics"))
MADE.append(save(murmur_as_ar(), "med-murmur-as-ar"))
MADE.append(save(tb_att(), "med-tb-att"))
MADE.append(save(dka_hhs(), "med-dka-hhs"))
MADE.append(save(gap_delta(), "med-gap-delta"))
print("wrote", len(MADE))
for w in lib.WARN: print("WARN", w)
