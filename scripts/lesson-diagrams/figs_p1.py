from reg import fig, newstep
from lib import *

ST_A = {"fill": "#FFF1CC", "stroke": AMBER}
ST_R = {"fill": "#FBE3E0", "stroke": RED}
BLUE = "#3E6FA5"

def hill(P, p50, n=2.7): return 100 * P ** n / (P ** n + p50 ** n)

@fig("phy-gas-transport", 4, "Oxygen haemoglobin dissociation curves: normal sigmoid curve with P50 of 26.6 mmHg, a right shifted curve with easier oxygen release, a left shifted curve with tighter binding, and a carbon monoxide curve that is both left shifted and lowered; arterial and venous points marked.",
     "Right shift (acid, CO2, heat, 2,3-BPG) unloads oxygen; left shift and carbon monoxide trap it, so tissues are starved even at normal PaO2.")
def oxyhb_curve():
    p = Plot("x", "Oxygen-haemoglobin dissociation curve", "d", (0, 110), (0, 100), "PO2 (mmHg)", "Haemoglobin saturation (%)", 800, 560, "Normal P50 is 26.6 mmHg", [0, 20, 40, 60, 80, 100], [0, 25, 50, 75, 100], 92, 40, 84, 90, grid=True)
    p.curve(lambda x: hill(x, 26.6), TEAL, 4)
    p.curve(lambda x: hill(x, 40), RED, 3, "8 5"); p.curve(lambda x: hill(x, 18), "#3E6FA5", 3, "8 5")
    p.curve(lambda x: 0.5 * hill(x, 14), AMBER, 3, "2 4")
    p.dot(100, hill(100, 26.6), "Arterial", -10, 26, "end"); p.dot(40, hill(40, 26.6), "Venous (mixed)", 12, 24)
    p.line(p.X(26.6), p.Y(50), p.X(26.6), p.B, GREY, 1.4, "5 4"); p.line(p.L, p.Y(50), p.X(26.6), p.Y(50), GREY, 1.4, "5 4"); p.text(p.X(26.6) + 6, p.B - 8, "P50 26.6", 11.5, 600, GREY)
    p.text(p.X(58), p.Y(20), "Right shift: acid, CO2, heat, 2,3-BPG", 12.5, 700, RED); p.text(p.X(58), p.Y(13), "(unloads O2 to tissue)", 11.5, 400, RED)
    p.text(p.X(2), p.Y(92), "Left shift: HbF, alkalosis, cold, low 2,3-BPG", 12.5, 700, BLUE) if False else p.text(p.X(3), p.Y(95), "Left shift: HbF, alkalosis, cold,", 12.5, 700, BLUE); p.text(p.X(3), p.Y(89), "low 2,3-BPG (holds O2)", 12.5, 700, BLUE)
    p.text(p.X(58), p.Y(46), "Carbon monoxide (50% COHb):", 12.5, 700, AMBER); p.text(p.X(58), p.Y(40), "left shifted AND lower plateau", 12.5, 700, AMBER)
    return p

@fig("phy-membrane-potentials", 3, "Plot of one neuronal action potential against time: resting at minus 70 millivolts, threshold at minus 55, rapid depolarisation to about plus 35 as sodium channels open, repolarisation as potassium channels open, undershoot below rest, and return to rest.",
     "Sodium influx drives the upstroke; potassium efflux drives repolarisation and the undershoot.")
def action_potential():
    p = Plot("x", "The neuronal action potential", "d", (0, 5), (-100, 60), "Time (ms)", "Membrane potential (mV)", 800, 540, "Threshold -55 mV; ENa about +60 mV; EK about -90 mV", [0, 1, 2, 3, 4, 5], [-100, -70, -55, 0, 35], 92, 40, 84, 90)
    p.hline(60, "#3E6FA5", "6 4", "ENa about +60", "right"); p.hline(-90, RED, "6 4", "EK about -90", "right"); p.hline(-55, GREY, "4 4", "threshold -55", "right") if False else None
    p.line(p.L, p.Y(-55), p.R, p.Y(-55), GREY, 1.2, "4 4"); p.text(p.R - 4, p.Y(-55) - 6, "threshold -55", 11.5, 600, GREY, "end")
    pts = [(0, -70), (0.9, -70), (1.0, -56), (1.2, -10), (1.45, 35), (1.7, 25), (2.1, -35), (2.6, -72), (3.0, -84), (3.6, -80), (4.3, -73), (5, -70)]
    p.curve(pts, TEAL, 4)
    p.text(p.X(0.35), p.Y(-62), "resting -70", 11.5, 600, GREY)
    p.tag(1.0, 52, "1 Depolarisation", TEAL, 12.5, "end"); p.text(p.X(0.97), p.Y(44), "Na+ channels open", 11.5, 400, GREY, "end")
    p.tag(2.55, 33, "2 Repolarisation", TEAL, 12.5, "start"); p.text(p.X(2.55), p.Y(25), "K+ channels open, Na+ close", 11.5, 400, GREY)
    p.tag(3.35, -96, "3 After-hyperpolarisation", TEAL, 12.5, "start") if False else p.text(p.X(3.05), p.Y(-96), "3 Undershoot: K+ channels slow to close", 12, 700, TEAL)
    p.shade(1.0, 2.0, "none") if False else None
    return p

@fig("phy-cardiac-electro", 1, "Overlaid action potentials of a sinoatrial node cell and a ventricular myocyte: the node has no stable resting potential and drifts upward in phase 4 until a slow calcium upstroke, the ventricle rests at minus 90, fires rapidly through sodium channels and holds a calcium plateau.",
     "Pacemaker cells drift up by the funny current; ventricular cells snap up with sodium and plateau with calcium.")
def pacemaker_vs_ventricle():
    p = Plot("x", "Pacemaker and ventricular action potentials", "d", (0, 450), (-100, 50), "Time (ms)", "Membrane potential (mV)", 800, 540, "Phases 0 to 4 labelled; SA node drawn dashed", [0, 100, 200, 300, 400], [-90, -60, 0, 40], 92, 40, 84, 90)
    sa = [(0, -60), (60, -57), (120, -52), (180, -46), (230, -40), (255, -30), (280, 5), (300, 10), (330, -20), (360, -50), (390, -60), (450, -60)]
    p.curve([(x, y) for x, y in sa], AMBER, 3.5, "9 5")
    ve = [(0, -90), (30, -90), (35, -60), (40, 20), (50, 38), (60, 20), (90, 5), (150, 0), (230, -5), (270, -50), (300, -88), (330, -90), (450, -90)]
    p.curve(ve, TEAL, 4)
    p.text(p.X(330), p.Y(-80), "ventricle: resting -90", 11.5, 700, TEAL)
    p.text(p.X(2), p.Y(-45), "SA node: no stable rest,", 11.5, 700, AMBER) if False else p.text(p.X(80), p.Y(-30), "SA node: unstable, drifts up", 12, 700, AMBER)
    p.text(p.X(80), p.Y(-38), "(phase 4, funny current If)", 11.5, 500, AMBER)
    p.text(p.X(46), p.Y(46), "0: Na+ in", 12, 700, TEAL, "start"); p.text(p.X(95), p.Y(14), "2: Ca2+ plateau", 12, 700, TEAL, "start"); p.text(p.X(310), p.Y(-60), "3: K+ out", 12, 700, TEAL, "start")
    p.text(p.X(292), p.Y(14), "0: Ca2+ (slow)", 12, 700, AMBER, "start")
    p.text(p.X(120), p.Y(-62), "4", 12, 700, AMBER, "middle")
    return p

@fig("phy-regulation", 3, "Plot of ventilation against arterial PCO2: ventilation rises roughly linearly above a PCO2 of about 40 mmHg, hypoxia steepens the slope, and very high PCO2 depresses breathing.",
     "CO2 is the main drive to breathe: ventilation climbs linearly with PaCO2, and low oxygen makes the response steeper.")
def co2_response():
    p = Plot("x", "Ventilatory response to carbon dioxide", "d", (30, 110), (0, 110), "Arterial PCO2 (mmHg)", "Ventilation (L/min)", 800, 540, "Illustrative values", [30, 40, 50, 60, 70, 80, 90, 100, 110], [0, 20, 40, 60, 80, 100], 92, 40, 84, 90, grid=True)
    def n(x): return max(0, min(80, 6 + 2.2 * (x - 40))) if x < 100 else max(0, 80 - 4 * (x - 100))
    def h(x): return max(0, min(104, 8 + 4 * (x - 40))) if x < 100 else max(0, 104 - 4 * (x - 100))
    p.curve(n, TEAL, 4, xs=(34, 110)); p.curve(h, RED, 3.5, "8 5", xs=(34, 110))
    p.vline(40, GREY, "5 4", "normal PaCO2 40", p.B - 12)
    p.text(p.X(52), p.Y(44), "Normoxia", 13, 700, TEAL); p.text(p.X(58), p.Y(98), "Hypoxia (PaO2 about 50): steeper", 12.5, 700, RED)
    p.text(p.X(100), p.Y(30), "CO2 narcosis:", 12, 600, GREY, "start"); p.text(p.X(100), p.Y(22), "drive falls", 12, 600, GREY)
    return p

@fig("phy-gfr", 3, "Cross-section of the glomerular filtration barrier from capillary lumen to urinary space: fenestrated endothelium, glomerular basement membrane with negative charge, and podocyte foot processes joined by slit diaphragms; water and small solutes pass, albumin is held back by size and charge.",
     "Three layers: fenestrated endothelium, charged basement membrane, podocyte slit diaphragm. Loss of charge gives albuminuria.")
def filtration_barrier():
    f = F("x", "Glomerular filtration barrier", "d", 800, 470, "Blood on the left, urinary (Bowman) space on the right")
    f.rect(40, 90, 130, 300, "#FBE3E0", "none", 0, 0); f.rect(340, 90, 150, 300, "#EAF2F6", "none", 0, 0)
    f.text(105, 120, "Capillary", 12.5, 700, RED, "middle"); f.text(105, 136, "lumen", 12.5, 700, RED, "middle"); f.text(415, 120, "Urinary", 12.5, 700, "#3E6FA5", "middle"); f.text(415, 136, "space", 12.5, 700, "#3E6FA5", "middle")
    for i in range(4): f.ellipse(70 + (i % 2) * 45, 180 + i * 55, 14, 9, "#C0392B", "#7A1F17", 1)
    f.rect(170, 90, 24, 300, "#F5DDA6", INK, 1.6, 0)
    for y in (120, 190, 260, 330): f.rect(170, y, 24, 16, "#FFFFFF", "none", 0, 0)
    f.rect(194, 90, 76, 300, "#BFD1E1", INK, 1.6, 0)
    for y in range(100, 385, 20): f.text(232, y + 10, "- - -", 11, 700, "#B3382C", "middle")
    for y in (90, 180, 270): f.path(f"M270 {y+4} L270 {y+84} L336 {y+84} L336 {y+4} Z", "#BFE3D6", INK, 1.6)
    f.circle(110, 285, 14, "#E8C547", INK, 1.8); f.text(110, 289, "Alb", 10, 700, INK, "middle")
    f.line(124, 285, 160, 285, RED, 3); f.line(160, 279, 160, 291, RED, 4)
    f.arrow(100, 335, 470, 335, "#3E6FA5", 3, 10); f.text(300, 358, "water, glucose, urea pass freely", 12, 600, "#3E6FA5", "middle")
    f.line(182, 140, 540, 120, GREY, 1.1); f.text(548, 118, "Fenestrated endothelium", 12.5, 700, INK); f.text(548, 134, "pores block cells, not proteins", 11.5, 400, GREY)
    f.line(232, 240, 540, 215, GREY, 1.1); f.text(548, 213, "Basement membrane", 12.5, 700, INK); f.text(548, 229, "negative charge repels albumin", 11.5, 400, GREY)
    f.line(303, 260, 540, 300, GREY, 1.1); f.text(548, 298, "Podocyte foot processes", 12.5, 700, INK); f.text(548, 314, "joined by slit diaphragms (nephrin)", 11.5, 400, GREY)
    f.text(400, 430, "Albumin (about 66 kDa, negatively charged) is repelled; in nephrotic syndrome the charge barrier is lost.", 12, 500, GREY, "middle")
    return f

@fig("phy-haemodynamics", 1, "Two tubes: laminar flow with parallel streamlines and a parabolic velocity profile, and turbulent flow with chaotic eddies that happens when the Reynolds number exceeds about 2000, with the Reynolds number formula.",
     "Turbulence is noisy: it causes murmurs and bruits where narrowing raises velocity.")
def laminar_turbulent():
    f = F("x", "Laminar and turbulent flow", "d", 800, 500, "Re = density x velocity x diameter / viscosity; turbulence above about 2000")
    for (y, kind) in ((90, "lam"), (280, "tur")):
        f.rect(80, y, 640, 120, "#FBE3E0", INK, 2.4, 0)
        if kind == "lam":
            for k, (dy, L) in enumerate(((-40, 150), (-20, 270), (0, 340), (20, 270), (40, 150))):
                f.arrow(400 - L / 2, y + 60 + dy, 400 + L / 2, y + 60 + dy, "#3E6FA5", 2.6, 9)
            f.path(smooth([(475, y + 20), (535, y + 40), (570, y + 60), (535, y + 80), (475, y + 100)]), "none", AMBER, 3, "5 4")
            f.text(400, y - 12, "Laminar: parabolic profile, fastest at the centre, silent", 13, 700, TEAL, "middle")
        else:
            for (x0, yy) in ((140, 330), (250, 310), (330, 340), (440, 320), (540, 335), (610, 305)):
                f.path(f"M{x0} {yy} q18 -30 36 -6 t36 4 t30 -8", "none", "#3E6FA5", 2.4); f.circle(x0 + 20, yy - 10, 12, "none", RED, 1.4)
            f.text(400, y - 12, "Turbulent: eddies, loses energy, makes murmurs and bruits", 13, 700, RED, "middle")
    f.text(400, 440, "Raised by higher velocity, wider vessel, lower viscosity. Anaemia and stenosis both promote turbulence.", 12.5, 500, GREY, "middle")
    f.text(400, 462, "Poiseuille: resistance is proportional to length x viscosity / radius to the fourth power.", 12.5, 500, GREY, "middle")
    return f

# ---- new steps and their figures: cardiac cycle ----
newstep("phy-cardiac-cycle", 1,
    "A **Wiggers diagram** plots aortic, ventricular and atrial pressure, ventricular volume, the ECG and heart sounds on one time axis. The aortic valve opens when ventricular pressure exceeds aortic pressure and closes at the dicrotic notch. The mitral valve opens when ventricular pressure falls below atrial pressure. Follow the vertical event lines to read every phase.",
    "A Wiggers diagram plots aortic, ventricular and atrial pressure, ventricular volume, the ECG and heart sounds on one time axis. The aortic valve opens when ventricular pressure exceeds aortic pressure and closes at the dicrotic notch. The mitral valve opens when ventricular pressure falls below atrial pressure. Follow the vertical event lines to read every phase.")

@fig("phy-cardiac-cycle", 2, "Wiggers diagram of one cardiac cycle with left ventricular, aortic and left atrial pressure, ventricular volume, ECG and heart sounds, marked with mitral valve closure, aortic valve opening, aortic valve closure with the dicrotic notch, and mitral valve opening.",
     "Phases in order: atrial systole, isovolumetric contraction, ejection, isovolumetric relaxation, rapid filling, diastasis.")
def wiggers():
    f = F("x", "The cardiac cycle (Wiggers diagram)", "d", 800, 640, "One beat at 75 per minute: about 0.8 s")
    L, R = 110, 760
    X = lambda t: L + t / 0.8 * (R - L)
    def panel(y0, y1, lo, hi, name, ticks):
        f.line(L, y0, L, y1, INK, 2); f.line(L, y1, R, y1, INK, 2)
        f.text(L - 10, (y0 + y1) / 2, name, 12, 700, INK, "end")
        for tv in ticks: f.text(L - 6, y1 - (tv - lo) / (hi - lo) * (y1 - y0) + 4, str(tv), 10.5, 400, GREY, "end")
        return lambda v: y1 - (v - lo) / (hi - lo) * (y1 - y0)
    P = panel(110, 330, 0, 130, "Pressure\n(mmHg)", [0, 40, 80, 120])
    V = panel(360, 450, 40, 130, "LV volume\n(mL)", [50, 120])
    E = panel(480, 540, -1, 2, "ECG", [])
    S = panel(560, 600, 0, 1, "Sounds", [])
    def draw(fn, ts, color, w=3):
        pts = [(X(t), fn(t)) for t in ts]
        f.path(smooth(pts), "none", color, w)
    import math as m
    T = [i * 0.01 for i in range(0, 81)]
    def lvp(t):
        pts = [(0, 6), (0.08, 8), (0.1, 10), (0.15, 80), (0.2, 118), (0.27, 124), (0.35, 112), (0.45, 98), (0.49, 40), (0.52, 5), (0.6, 4), (0.8, 8)]
        return interp(pts, t)
    def aop(t):
        pts = [(0, 80), (0.1, 80), (0.15, 82), (0.22, 116), (0.27, 124), (0.35, 114), (0.45, 104), (0.47, 100), (0.5, 105), (0.6, 96), (0.8, 82)]
        return interp(pts, t)
    def lap(t):
        pts = [(0, 6), (0.05, 11), (0.1, 6), (0.13, 9), (0.3, 7), (0.45, 12), (0.52, 12), (0.58, 4), (0.7, 6), (0.8, 7)]
        return interp(pts, t)
    def vol(t):
        pts = [(0, 105), (0.1, 120), (0.15, 120), (0.28, 90), (0.45, 50), (0.52, 50), (0.65, 100), (0.8, 106)]
        return interp(pts, t)
    def interp(pts, t):
        for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
            if t0 <= t <= t1: return v0 + (v1 - v0) * (t - t0) / (t1 - t0 or 1)
        return pts[-1][1]
    f.path("M" + " L".join(f"{X(t):.1f} {P(aop(t)):.1f}" for t in T), "none", RED, 3)
    f.path("M" + " L".join(f"{X(t):.1f} {P(lvp(t)):.1f}" for t in T), "none", TEAL, 3.5)
    f.path("M" + " L".join(f"{X(t):.1f} {P(lap(t)):.1f}" for t in T), "none", AMBER, 3)
    f.path("M" + " L".join(f"{X(t):.1f} {V(vol(t)):.1f}" for t in T), "none", BLUE, 3)
    ecg = [(0, 0), (0.02, 0), (0.04, 0.3), (0.06, 0), (0.08, 0), (0.095, -0.15), (0.105, 1.8), (0.115, -0.4), (0.13, 0), (0.25, 0), (0.33, 0.5), (0.4, 0), (0.8, 0)]
    f.path("M" + " L".join(f"{X(t):.1f} {E(v):.1f}" for t, v in ecg), "none", INK, 2.2)
    for t, c in ((0.11, "S1"), (0.46, "S2"), (0.58, "S3")):
        f.rect(X(t) - 5, S(0.9), 10, S(0.1) - S(0.9), INK, "none", 0, 2); f.text(X(t), S(0) + 14, c, 11.5, 700, INK, "middle")
    for k, (t, lab) in enumerate(((0.1, "MV closes"), (0.15, "AV opens"), (0.46, "AV closes"), (0.52, "MV opens"))):
        f.line(X(t), 100, X(t), 605, GREY, 1.1, "4 4"); f.text(X(t), 76 + (k % 2) * 14, lab, 10.5, 700, GREY, "middle")
    for (a, b, t) in ((0.0, 0.1, "Atrial\\nsystole"), (0.1, 0.15, ""), (0.15, 0.46, "Ejection"), (0.46, 0.52, ""), (0.52, 0.65, "Rapid\\nfilling"), (0.65, 0.8, "Diastasis")):
        if t: f.text((X(a) + X(b)) / 2, 624, t.replace("\\n", " "), 11, 700, TEAL, "middle")
    f.text(X(0.125), 636, "IVC", 10.5, 700, TEAL, "middle"); f.text(X(0.49), 636, "IVR", 10.5, 700, TEAL, "middle")
    f.legend([(TEAL, "LV pressure"), (RED, "Aortic pressure"), (AMBER, "LA pressure"), (BLUE, "LV volume (lower panel)")], 540, 232)
    f.text(X(0.46), P(112) - 6, "dicrotic notch", 10.5, 600, RED, "start") if False else None
    return f

newstep("phy-cardiac-cycle", 4,
    "The **Frank-Starling law** says the heart ejects what it receives: greater end-diastolic filling stretches sarcomeres toward their optimal length and raises stroke volume. Sympathetic stimulation or a positive inotrope lifts the whole curve, while heart failure flattens it. This matches output to venous return beat by beat, without any nervous or hormonal signal.",
    "The Frank-Starling law says the heart ejects what it receives: greater end-diastolic filling stretches sarcomeres toward their optimal length and raises stroke volume. Sympathetic stimulation or a positive inotrope lifts the whole curve, while heart failure flattens it. This matches output to venous return beat by beat, without any nervous or hormonal signal.")

@fig("phy-cardiac-cycle", 5, "Frank-Starling curves of stroke volume against end-diastolic volume: normal curve rising then flattening, a higher steeper curve with increased contractility, and a flatter curve in heart failure.",
     "Same filling, more output with a positive inotrope; in failure the curve flattens and output falls.")
def frank_starling():
    p = Plot("x", "Frank-Starling relationship", "d", (0, 10), (0, 100), "End-diastolic volume (preload)", "Stroke volume", 800, 520, "Illustrative curves", [], [], 92, 40, 84, 90)
    import math as m
    p.curve(lambda x: 100 * (1 - m.exp(-0.45 * x)) * 0.8, TEAL, 4); p.curve(lambda x: 100 * (1 - m.exp(-0.55 * x)) * 0.98, "#3E6FA5", 3.5); p.curve(lambda x: 100 * (1 - m.exp(-0.35 * x)) * 0.42, RED, 3.5)
    p.text(p.X(7.0), p.Y(97), "Increased contractility", 12.5, 700, "#3E6FA5"); p.text(p.X(6.2), p.Y(70), "Normal", 13, 700, TEAL); p.text(p.X(6.5), p.Y(33), "Heart failure", 12.5, 700, RED)
    p.text(p.X(0.3), p.Y(8), "low preload", 11.5, 600, GREY); p.text(p.X(9.9), p.Y(5), "high preload", 11.5, 600, GREY, "end")
    p.dot(4, 100 * (1 - m.exp(-0.45 * 4)) * 0.8, "Normal operating point", 12, 22)
    return p
