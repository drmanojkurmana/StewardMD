#!/usr/bin/env python3
"""tools/prep-fill3-charts-b.py - Draw PrepNucleus fill3 slice-B teaching charts.

Anaesthesia (10) + psychiatry (8). Same deterministic pattern as
tools/prep-fill3-charts-a.py: numbers embedded below and re-emitted to
chart-data.json (exact values + authority strings for MCQ generation).

Usage: MPLCONFIGDIR=/tmp/img-fill3/mplcache /tmp/img-fill3/venvs/mpl/bin/python \\
         tools/prep-fill3-charts-b.py --out /tmp/img-fill3/charts/b
"""
import argparse
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

PAPER, INK, INK2 = "#f3f2ee", "#13203d", "#556079"
PRUSSIAN, AMBER, AMBER_D = "#0f3460", "#efc07b", "#c98a2e"
OK, BAD, EDGE = "#1c7a4a", "#b42318", "#e3e1da"

plt.rcParams.update({"font.size": 13, "axes.edgecolor": INK2, "axes.labelcolor": INK,
                     "xtick.color": INK, "ytick.color": INK, "text.color": INK,
                     "figure.facecolor": PAPER, "axes.facecolor": "#ffffff",
                     "savefig.facecolor": PAPER, "savefig.dpi": 110})

DATA = {}


def fig(short=False):
    f, a = plt.subplots(figsize=(12.7, 6.2 if short else 8.2))
    return f, a


def save(f, out, name):
    p = os.path.join(out, name + ".png")
    f.savefig(p, bbox_inches="tight")
    plt.close(f)
    return p


def capno_trace(kind):
    """Return (t, co2) for one breath + a second breath; kinds: normal,
    obstruction, rebreathing, arrest (second breath crashes)."""
    t1 = np.linspace(0, 4, 220)
    if kind == "normal":
        y1 = 38 * (1 - np.exp(-((t1 - 0.6) / 0.35).clip(min=0) ** 1.2))
        y1 = np.where(t1 < 0.6, 0, y1)
        y1 = np.where(t1 > 3.2, 38 * np.exp(-(t1 - 3.2) / 0.15), y1)
    elif kind == "obstruction":
        y1 = 45 * (1 - np.exp(-((t1 - 0.6) / 1.1).clip(min=0)))
        y1 = np.where(t1 < 0.6, 0, y1)
        y1 = np.where(t1 > 3.4, 45 * np.exp(-(t1 - 3.4) / 0.2), y1)
    elif kind == "rebreathing":
        y1 = 8 + 40 * (1 - np.exp(-((t1 - 0.6) / 0.4).clip(min=0) ** 1.2))
        y1 = np.where(t1 < 0.6, 8, y1)
        y1 = np.where(t1 > 3.2, 8 + 40 * np.exp(-(t1 - 3.2) / 0.2), y1)
    elif kind == "arrest":
        y1 = 38 * (1 - np.exp(-((t1 - 0.6) / 0.35).clip(min=0) ** 1.2))
        y1 = np.where(t1 < 0.6, 0, y1)
        y1 = np.where(t1 > 3.2, 38 * np.exp(-(t1 - 3.2) / 0.15), y1)
    t2 = t1 + 4.6
    if kind == "arrest":
        y2 = 8 * (1 - np.exp(-((t2 - 5.2) / 0.5).clip(min=0)))
        y2 = np.where(t2 < 5.2, 0, y2)
        y2 = np.where(t2 > 7.8, 8 * np.exp(-(t2 - 7.8) / 0.2), y2)
    else:
        y2 = y1.copy()
    t = np.concatenate([t1, t2])
    y = np.concatenate([y1, y2])
    return t, y


# ---------------- anaesthesia ----------------

def c_capno_normal(out):
    t, y = capno_trace("normal")
    f, a = fig()
    a.plot(t, y, color=PRUSSIAN, lw=3)
    a.axhline(38, color=INK2, ls="--", lw=1.5)
    a.text(9.0, 39.5, "ETCO2 38 mmHg", fontsize=11)
    for x0, x1, lab, yy in [(0.02, 0.55, "I: dead space", 50.5),
                           (0.62, 1.4, "II: upslope", 47.5),
                           (1.5, 3.15, "III: plateau", 50.5)]:
        a.annotate("", xy=(x0, yy - 1.5), xytext=(x1, yy - 1.5),
                   arrowprops={"arrowstyle": "<->", "color": INK2, "lw": 1.5})
        a.text((x0 + x1) / 2, yy, lab, ha="center", fontsize=10)
    a.text(3.6, 20, "Inspiration:\nsharp fall to 0", fontsize=11, color=OK,
           weight="bold", bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 9.5); a.set_ylim(0, 55)
    a.set_xlabel("Time (s)"); a.set_ylabel("CO2 (mmHg)")
    a.set_title("Normal time capnogram: phases I-III, ETCO2 35-40 mmHg")
    save(f, out, "capno-normal")
    DATA["capno-normal"] = {
        "numbers": {"etco2": 38, "baseline": 0},
        "authority": "Normal capnogram: phase I flat at zero (anatomical dead "
        "space), phase II steep upstroke (mixed air), phase III near-flat "
        "plateau ending at ETCO2 38 mmHg, then a sharp inspiratory fall back "
        "to zero."}


def c_capno_obstruction(out):
    t, y = capno_trace("obstruction")
    f, a = fig()
    a.plot(t, y, color=BAD, lw=3)
    a.text(5.0, 30, "Shark-fin: slow rising\nlimb, no clear plateau\nETCO2 45 mmHg",
           fontsize=12, color=BAD, weight="bold",
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 9.5); a.set_ylim(0, 55)
    a.set_xlabel("Time (s)"); a.set_ylabel("CO2 (mmHg)")
    a.set_title("Obstructive capnogram: prolonged upstroke (bronchospasm)")
    save(f, out, "capno-obstruction")
    DATA["capno-obstruction"] = {
        "numbers": {"etco2": 45},
        "authority": "Shark-fin capnogram: slow rising phase II and a slurred "
        "plateau with ETCO2 45 mmHg means obstructed expiration: "
        "bronchospasm, kinked tube, mucus plug, or COPD/asthma."}


def c_capno_rebreathing(out):
    t, y = capno_trace("rebreathing")
    f, a = fig()
    a.plot(t, y, color=AMBER_D, lw=3)
    a.axhline(8, color=BAD, ls="--", lw=2)
    a.text(5.2, 12, "Baseline never reaches 0\n(inspired CO2 8 mmHg)",
           fontsize=12, color=BAD, weight="bold",
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 9.5); a.set_ylim(0, 60)
    a.set_xlabel("Time (s)"); a.set_ylabel("CO2 (mmHg)")
    a.set_title("Rebreathing capnogram: raised baseline (exhausted soda lime)")
    save(f, out, "capno-rebreathing")
    DATA["capno-rebreathing"] = {
        "numbers": {"inspired_co2": 8, "etco2": 48},
        "authority": "A baseline stuck at 8 mmHg means inspired CO2: exhausted "
        "soda lime, faulty unidirectional valves, or too-low fresh gas flow. "
        "ETCO2 climbs (48 mmHg here) and must not be read as adequate "
        "ventilation."}


def c_capno_arrest(out):
    t, y = capno_trace("arrest")
    f, a = fig()
    a.plot(t, y, color=BAD, lw=3)
    a.annotate("", xy=(4.4, 8), xytext=(4.4, 30),
               arrowprops={"arrowstyle": "->", "color": BAD, "lw": 3})
    a.text(6.4, 22, "Sudden fall 38 -> 8 mmHg\nwith hypotension:\ncardiac arrest or\nmassive pulmonary embolism",
           fontsize=12, color=BAD, weight="bold",
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 9.5); a.set_ylim(0, 55)
    a.set_xlabel("Time (s)"); a.set_ylabel("CO2 (mmHg)")
    a.set_title("Crash capnogram: sudden ETCO2 fall (perfusion failure)")
    save(f, out, "capno-arrest")
    DATA["capno-arrest"] = {
        "numbers": {"before": 38, "after": 8},
        "authority": "ETCO2 crashing from 38 to 8 mmHg with hypotension means "
        "CO2 is no longer delivered to the lungs: cardiac arrest or massive "
        "pulmonary embolism. (A fall to absolute zero instead means "
        "disconnection or oesophageal intubation.)"}


def c_vent_pv(out):
    v = np.linspace(0, 600, 300)
    p_norm = 5 + 15 * (v / 600) ** 1.15
    p_ards = 10 + 2 * (v / 600) + 26 * (v / 600) ** 3.2
    f, a = fig()
    a.plot(p_norm, v, color=PRUSSIAN, lw=3, label="Normal compliance")
    a.plot(p_ards, v, color=BAD, lw=3, label="ARDS: stiff, beaked loop")
    a.axvline(30, color=BAD, ls="--", lw=2)
    a.text(30.5, 480, "Keep plateau < 30 cmH2O", fontsize=11, color=BAD,
           weight="bold")
    a.annotate("Lower inflection ~10:\nrecruitment above it", xy=(11, 120),
               xytext=(17, 60),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=11)
    a.set_xlim(0, 40); a.set_ylim(0, 650)
    a.set_xlabel("Airway pressure (cmH2O)"); a.set_ylabel("Volume (mL)")
    a.set_title("Pressure-volume loops: normal vs ARDS")
    a.legend(fontsize=11)
    save(f, out, "vent-pv-loop")
    DATA["vent-pv-loop"] = {
        "numbers": {"plateau_limit": 30, "lower_inflection": 10, "vt_ml_kg": 6},
        "authority": "ARDS flattens the pressure-volume loop (stiff lungs) "
        "with a lower inflection near 10 cmH2O. Lung-protective ventilation "
        "uses 6 mL/kg tidal volume with PEEP above the inflection and "
        "plateau pressure below 30 cmH2O."}


def c_vent_flowvol(out):
    ve = np.linspace(0, 1, 200)
    f, a = fig()
    a.plot(ve * 4.0, 7 * np.sin(np.pi * ve) ** 0.8, color=PRUSSIAN, lw=3,
           label="Normal ventilated loop")
    copd = 3.6 * np.sin(np.pi * ve) ** 1.8
    a.plot(ve * 4.6, copd, color=BAD, lw=3,
           label="COPD: scooped, low peak, air trapping")
    a.annotate("Flow never reaches 0:\nauto-PEEP", xy=(4.35, 0.7),
               xytext=(2.6, 2.8),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=11,
               color=BAD, weight="bold")
    a.set_xlim(0, 5.0); a.set_ylim(0, 8)
    a.set_xlabel("Volume (L)"); a.set_ylabel("Expiratory flow (L/s)")
    a.set_title("Ventilator flow-volume loops: normal vs COPD")
    a.legend(fontsize=10.5)
    save(f, out, "vent-flow-volume")
    DATA["vent-flow-volume"] = {
        "numbers": {},
        "authority": "COPD scoops the expiratory limb and lowers peak flow; "
        "when flow never returns to zero before the next breath, gas is "
        "trapped (auto-PEEP). Lengthen expiratory time or accept permissive "
        "hypercapnia."}


def c_mac(out):
    agents = [("Halothane", 0.75), ("Isoflurane", 1.15), ("Sevoflurane", 2.0),
              ("Desflurane", 6.0), ("Nitrous oxide", 104)]
    f, a = fig(short=True)
    ys = np.arange(len(agents))
    a.barh(ys, [m for _, m in agents], height=0.6, color=PRUSSIAN,
           edgecolor=INK)
    for y, (nm, m) in zip(ys, agents):
        a.text(m + 2, y, "%.2g%%" % m, va="center", fontsize=12,
               weight="bold")
    a.set_yticks(ys); a.set_yticklabels([n for n, _ in agents])
    a.set_xlabel("MAC (%)")
    a.set_title("MAC: lower value = more potent vapour (50% unresponsive)")
    save(f, out, "mac-chart")
    DATA["mac-chart"] = {
        "numbers": {"halothane": 0.75, "isoflurane": 1.15, "sevoflurane": 2.0,
                    "desflurane": 6.0, "n2o": 104},
        "authority": "MAC is the alveolar % at which 50% of patients do not "
        "move to incision: halothane 0.75, isoflurane 1.15, sevoflurane 2.0, "
        "desflurane 6.0, nitrous oxide 104. Lower MAC means higher potency."}


def c_spinal(out):
    rows = [["Block height", "Landmark", "Surgery covered"],
            ["T4 (nipple)", "Nipple line", "Caesarean section"],
            ["T6 (xiphoid)", "Xiphisternum", "Upper abdominal"],
            ["T10 (umbilicus)", "Umbilicus", "TURP, hip, lower limb"],
            ["S2-S4 (saddle)", "Perineum", "Perianal, vaginal delivery"]]
    f, a = fig(short=True); a.axis("off")
    a.set_title("Spinal block heights: dermatomes and surgery", pad=18)
    t = a.table(cellText=rows, loc="center",
                colWidths=[0.24, 0.24, 0.42])
    t.auto_set_font_size(False); t.set_fontsize(12.5); t.scale(1, 2.0)
    for (r, c), cell in t.get_celld().items():
        cell.set_edgecolor(INK)
        if r == 0:
            cell.set_facecolor(PRUSSIAN)
            cell.set_text_props(color="#ffffff", weight="bold")
    save(f, out, "spinal-levels")
    DATA["spinal-levels"] = {
        "numbers": {},
        "authority": "T4 (nipple) for Caesarean section, T6 (xiphoid) for "
        "upper abdominal surgery, T10 (umbilicus) for TURP and lower-limb "
        "surgery, S2-S4 saddle block for perianal surgery. A high block above "
        "T4 risks bradycardia and respiratory compromise."}


def c_tof(out):
    f, a = fig()
    x = np.arange(4)
    w = 0.25
    a.bar(x - w, [100, 70, 40, 20], width=w, color=BAD, edgecolor=INK,
          label="Deep block (TOF ratio 0.2)")
    a.bar(x, [100, 95, 90, 82], width=w, color=AMBER_D, edgecolor=INK,
          label="Recovering (TOF ratio 0.82)")
    a.bar(x + w, [100, 98, 97, 95], width=w, color=OK, edgecolor=INK,
          label="Recovered (TOF ratio 0.95)")
    a.axhline(90, color=INK2, ls="--", lw=1.5)
    a.text(3.4, 91, "Extubate at TOF ratio >= 0.9", fontsize=11)
    a.set_xticks(x); a.set_xticklabels(["Twitch 1", "Twitch 2", "Twitch 3", "Twitch 4"])
    a.set_ylim(0, 115); a.set_ylabel("Twitch height (% of control)")
    a.set_title("Train-of-four fade with nondepolarising block")
    a.legend(fontsize=10.5)
    save(f, out, "tof-fade")
    DATA["tof-fade"] = {
        "numbers": {"extubate_ratio": 0.9},
        "authority": "Nondepolarising block shows fade: twitch 4 smaller than "
        "twitch 1. TOF ratio (T4/T1) 0.2 is deep block, 0.82 recovering, and "
        "extubation needs 0.9 or more. Suxamethonium instead depresses all "
        "four twitches equally (no fade)."}


def c_asa(out):
    rows = [["Class", "Definition", "Example"],
            ["ASA I", "Healthy", "Fit hernia repair"],
            ["ASA II", "Mild systemic disease", "Controlled hypertension"],
            ["ASA III", "Severe systemic disease", "Poorly controlled diabetes with complications"],
            ["ASA IV", "Threat to life", "Unstable angina for emergency surgery"],
            ["ASA V", "Moribund", "Ruptured aneurysm"],
            ["ASA VI", "Brain-dead donor", "Organ retrieval"],
            ["E suffix", "Emergency", "ASA IIIE: perforated viscus"]]
    f, a = fig(short=True); a.axis("off")
    a.set_title("ASA physical status classification", pad=18)
    t = a.table(cellText=rows, loc="center",
                colWidths=[0.16, 0.32, 0.44])
    t.auto_set_font_size(False); t.set_fontsize(11.5); t.scale(1, 1.8)
    for (r, c), cell in t.get_celld().items():
        cell.set_edgecolor(INK)
        if r == 0:
            cell.set_facecolor(PRUSSIAN)
            cell.set_text_props(color="#ffffff", weight="bold")
    save(f, out, "asa-table")
    DATA["asa-table"] = {
        "numbers": {},
        "authority": "ASA I healthy through ASA V moribund and ASA VI "
        "brain-dead donor; E marks emergency surgery. Higher class predicts "
        "higher perioperative risk; it grades the patient, not the operation."}


# ---------------- psychiatry ----------------

def c_phq9(out):
    f, a = fig()
    segs = [(0, 4, "#7dd3a0", "Minimal\n0-4"), (5, 9, "#a9d18e", "Mild\n5-9"),
            (10, 14, AMBER, "Moderate\n10-14"), (15, 19, "#e8a87c", "Mod-severe\n15-19"),
            (20, 27, "#e8837a", "Severe\n20-27")]
    for lo, hi, col, lab in segs:
        a.barh(0, hi - lo + 1, left=lo, height=0.55, color=col, edgecolor=INK)
        a.text((lo + hi + 1) / 2, 0, lab, ha="center", va="center",
               fontsize=11, weight="bold")
    a.plot(16, 0, marker="v", ms=22, color=BAD)
    a.text(16, 0.62, "Score 16: moderately severe", ha="center", fontsize=13,
           weight="bold", color=BAD)
    a.axvline(10, color=INK2, ls="--", lw=2)
    a.text(10, -0.62, "Treatment cutoff >= 10", ha="center", fontsize=11)
    a.set_xlim(0, 28); a.set_ylim(-0.9, 1.1); a.set_yticks([])
    a.set_xlabel("PHQ-9 total (9 items x 0-3)")
    a.set_title("PHQ-9 depression severity bands with one plotted patient")
    save(f, out, "phq9-bands")
    DATA["phq9-bands"] = {
        "numbers": {"cutoff": 10, "plotted": 16,
                    "plotted_band": "moderately severe"},
        "authority": "PHQ-9 bands: 0-4 minimal, 5-9 mild, 10-14 moderate, "
        "15-19 moderately severe, 20-27 severe; 10 or more usually triggers "
        "active treatment. The plotted patient scores 16 (moderately severe)."}


def c_hypnogram(out):
    f, (a1, a2) = plt.subplots(2, 1, figsize=(12.7, 8.2), sharex=True)
    f.patch.set_facecolor(PAPER)
    # Depth convention: Wake on top, N3 deepest. W=4 REM=3 N1=2 N2=1 N3=0.
    tn = [0, 0.4, 1.5, 1.9, 3.0, 3.4, 4.6, 5.0, 6.2, 6.6, 7.6, 8.0]
    norm = [2, 0, 3, 1, 0, 3, 1, 3, 1, 3, 2, 2]
    td = [0, 0.4, 0.75, 1.5, 2.8, 3.2, 4.5, 5.0, 5.5, 8.0]
    dep = [2, 1, 3, 1, 3, 1, 3, 2, 4, 4]
    a1.step(tn, norm, where="post", color=PRUSSIAN, lw=2.5)
    a1.set_yticks([4, 3, 2, 1, 0]); a1.set_yticklabels(["W", "REM", "N1", "N2", "N3"])
    a1.set_title("Normal adult: sleep latency ~20 min, first REM ~90 min, deep N3 early")
    a1.set_ylim(-0.5, 4.5)
    a2.step(td, dep, where="post", color=BAD, lw=2.5)
    a2.set_yticks([4, 3, 2, 1, 0]); a2.set_yticklabels(["W", "REM", "N1", "N2", "N3"])
    a2.set_title("Depression: REM at ~45 min, no N3, broken sleep, awake from hour 5.5")
    a2.set_ylim(-0.5, 4.5)
    a2.set_xlabel("Hours of night")
    f.suptitle("Sleep hypnograms: normal vs depression", fontsize=14,
               color=INK, weight="bold")
    save(f, out, "sleep-hypnogram")
    DATA["sleep-hypnogram"] = {
        "numbers": {"normal_rem_latency_min": 90, "depression_rem_latency_min": 45},
        "authority": "Normal sleep enters REM after about 90 minutes with "
        "deep N3 early in the night. Depression shortens REM latency to about "
        "45 minutes, cuts slow-wave sleep, and fragments the second half of "
        "the night with early-morning awakening."}


def c_gad7(out):
    f, a = fig()
    segs = [(0, 4, "#7dd3a0", "Minimal\n0-4"), (5, 9, "#a9d18e", "Mild\n5-9"),
            (10, 14, AMBER, "Moderate\n10-14"), (15, 21, "#e8837a", "Severe\n15-21")]
    for lo, hi, col, lab in segs:
        a.barh(0, hi - lo + 1, left=lo, height=0.55, color=col, edgecolor=INK)
        a.text((lo + hi + 1) / 2, 0, lab, ha="center", va="center",
               fontsize=11, weight="bold")
    a.plot(12, 0, marker="v", ms=22, color=BAD)
    a.text(12, 0.62, "Score 12: moderate", ha="center", fontsize=13,
           weight="bold", color=BAD)
    a.axvline(10, color=INK2, ls="--", lw=2)
    a.text(10, -0.62, "Treatment cutoff >= 10", ha="center", fontsize=11)
    a.set_xlim(0, 22); a.set_ylim(-0.9, 1.1); a.set_yticks([])
    a.set_xlabel("GAD-7 total (7 items x 0-3)")
    a.set_title("GAD-7 anxiety severity bands with one plotted patient")
    save(f, out, "gad7-bands")
    DATA["gad7-bands"] = {
        "numbers": {"cutoff": 10, "plotted": 12, "plotted_band": "moderate"},
        "authority": "GAD-7 bands: 0-4 minimal, 5-9 mild, 10-14 moderate, "
        "15-21 severe; 10 or more usually triggers active treatment. The "
        "plotted patient scores 12 (moderate anxiety)."}


def c_ymrs(out):
    f, a = fig()
    segs = [(0, 12, "#7dd3a0", "Remission\n0-12"), (13, 25, AMBER, "Mild\n13-25"),
            (26, 60, "#e8837a", "Moderate-severe\n26-60")]
    for lo, hi, col, lab in segs:
        a.barh(0, hi - lo + 1, left=lo, height=0.55, color=col, edgecolor=INK)
        a.text((lo + hi + 1) / 2, 0, lab, ha="center", va="center",
               fontsize=11, weight="bold")
    a.plot(31, 0, marker="v", ms=22, color=BAD)
    a.text(31, 0.62, "Score 31: needs admission", ha="center", fontsize=13,
           weight="bold", color=BAD)
    a.set_xlim(0, 61); a.set_ylim(-0.9, 1.1); a.set_yticks([])
    a.set_xlabel("YMRS total (11 items, 0-60)")
    a.set_title("Young Mania Rating Scale bands with one plotted patient")
    save(f, out, "ymrs-bands")
    DATA["ymrs-bands"] = {
        "numbers": {"remission_max": 12, "plotted": 31},
        "authority": "YMRS 12 or less is remission, 13-25 mild mania, 26 and "
        "above moderate-severe mania usually needing admission. The plotted "
        "patient scores 31 with pressured speech and no sleep for 3 nights."}


def c_mmse(out):
    f, a = fig()
    doms = [("Orientation", 10), ("Registration", 3), ("Attention/calc", 5),
            ("Recall", 3), ("Language", 8), ("Copy design", 1)]
    base = 0
    cols = [PRUSSIAN, OK, AMBER_D, BAD, INK2, "#7fb3d5"]
    for (lab, v), c in zip(doms, cols):
        a.barh(0, v, left=base, height=0.5, color=c, edgecolor=INK)
        a.text(base + v / 2, 0, "%s %d" % (lab, v), ha="center", va="center",
               fontsize=10, weight="bold",
               color="#ffffff" if v > 2 else INK)
        base += v
    a.axvline(24, color=BAD, ls="--", lw=2)
    a.text(24, 0.55, "Dementia cutoff < 24", ha="center", fontsize=11,
           color=BAD, weight="bold")
    a.set_xlim(0, 30); a.set_ylim(-0.7, 0.9); a.set_yticks([])
    a.set_xlabel("MMSE points (total 30)")
    a.set_title("Mini-Mental State Examination: point domains")
    save(f, out, "mmse-domains")
    DATA["mmse-domains"] = {
        "numbers": {"total": 30, "cutoff": 24, "orientation": 10,
                    "registration": 3, "attention": 5, "recall": 3,
                    "language": 8, "visuospatial": 1},
        "authority": "MMSE totals 30: orientation 10, registration 3, "
        "attention/calculation 5, recall 3, language 8, copying 1. Below 24 "
        "suggests dementia (adjust for education); orientation and recall "
        "fail first in Alzheimer disease."}


def c_lithium(out):
    f, a = fig()
    segs = [(0, 0.6, "#a9d18e", "Subtherapeutic\n<0.6"),
            (0.6, 1.2, "#7dd3a0", "Therapeutic\n0.6-1.2"),
            (1.2, 1.5, AMBER, "Caution\n1.2-1.5"),
            (1.5, 2.5, "#e8837a", "Toxic\n>1.5")]
    for lo, hi, col, lab in segs:
        a.barh(0, hi - lo, left=lo, height=0.55, color=col, edgecolor=INK)
        a.text((lo + hi) / 2, 0, lab, ha="center", va="center",
               fontsize=11, weight="bold")
    a.plot(1.9, 0, marker="v", ms=22, color=BAD)
    a.text(1.9, 0.62, "Level 1.9: toxic", ha="center", fontsize=13,
           weight="bold", color=BAD)
    a.set_xlim(0, 2.5); a.set_ylim(-0.7, 1.0); a.set_yticks([])
    a.set_xlabel("12-hour serum lithium (mmol/L)")
    a.set_title("Lithium therapeutic window with one toxic patient")
    save(f, out, "lithium-window")
    DATA["lithium-window"] = {
        "numbers": {"therapeutic_lo": 0.6, "therapeutic_hi": 1.2,
                    "toxic": 1.5, "plotted": 1.9},
        "authority": "Twelve-hour lithium target 0.6-1.2 mmol/L (acute mania "
        "0.8-1.0); above 1.5 is toxic (coarse tremor, ataxia, confusion, "
        "seizures) and above 2.5 usually needs dialysis. The plotted patient "
        "at 1.9 with vomiting and ataxia needs urgent fluids and levels."}


def c_ad_lag(out):
    w = np.linspace(0, 8, 300)
    mood = 80 * (1 - np.exp(-w / 2.2))
    se = 60 * np.exp(-w / 1.1) + 8
    f, a = fig()
    a.plot(w, mood, color=OK, lw=3, label="Mood improvement")
    a.plot(w, se, color=BAD, lw=3, label="Side-effect burden")
    a.axvspan(4, 6, color=AMBER, alpha=0.3)
    a.text(5, 68, "Judge response\nat 4-6 weeks", ha="center", fontsize=12,
           weight="bold")
    a.text(1.0, 52, "Side effects first;\nenergy may return\nbefore mood lifts",
           fontsize=11, bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 8); a.set_ylim(0, 90)
    a.set_xlabel("Weeks on antidepressant"); a.set_ylabel("Effect (%)")
    a.set_title("Antidepressant lag: side effects early, mood later")
    a.legend(fontsize=11)
    save(f, out, "antidepressant-lag")
    DATA["antidepressant-lag"] = {
        "numbers": {"judge_weeks": "4-6"},
        "authority": "Side effects peak in weeks 1-2 while mood lifts only "
        "after 4-6 weeks at a therapeutic dose, so response must not be "
        "judged before then. Energy often returns before hopelessness lifts, "
        "which is why early suicide risk needs watching."}


def c_ciwa(out):
    f, a = fig()
    segs = [(0, 9, "#7dd3a0", "Minimal <10\nsupportive care"),
            (10, 19, AMBER, "Mild-moderate 10-19\nbenzodiazepines"),
            (20, 67, "#e8837a", "Severe >=20\nadmit, DT risk")]
    for lo, hi, col, lab in segs:
        a.barh(0, hi - lo + 1, left=lo, height=0.55, color=col, edgecolor=INK)
        a.text((lo + hi + 1) / 2, 0, lab, ha="center", va="center",
               fontsize=11, weight="bold")
    a.plot(24, 0, marker="v", ms=22, color=BAD)
    a.text(24, 0.62, "Score 24: severe withdrawal", ha="center", fontsize=13,
           weight="bold", color=BAD)
    a.set_xlim(0, 68); a.set_ylim(-0.9, 1.1); a.set_yticks([])
    a.set_xlabel("CIWA-Ar total (0-67)")
    a.set_title("Alcohol withdrawal (CIWA-Ar) bands with one plotted patient")
    save(f, out, "ciwa-bands")
    DATA["ciwa-bands"] = {
        "numbers": {"mild_max": 9, "severe_min": 20, "plotted": 24},
        "authority": "CIWA-Ar below 10 needs supportive care only, 10-19 "
        "needs benzodiazepines (symptom-triggered), 20 and above is severe "
        "withdrawal needing admission for seizure and delirium-tremens risk. "
        "The plotted patient scores 24 with tremor, sweats and agitation."}


CHARTS = [("capno-normal", c_capno_normal, "ans-monitoring"),
          ("capno-obstruction", c_capno_obstruction, "ans-monitoring"),
          ("capno-rebreathing", c_capno_rebreathing, "ans-monitoring"),
          ("capno-arrest", c_capno_arrest, "ans-monitoring"),
          ("vent-pv-loop", c_vent_pv, "ans-ventilation"),
          ("vent-flow-volume", c_vent_flowvol, "ans-ventilation"),
          ("mac-chart", c_mac, "ans-inhalational"),
          ("spinal-levels", c_spinal, "ans-neuraxial"),
          ("tof-fade", c_tof, "ans-nmb"),
          ("asa-table", c_asa, "ans-preop"),
          ("phq9-bands", c_phq9, "psy-depression"),
          ("sleep-hypnogram", c_hypnogram, "psy-sleep"),
          ("gad7-bands", c_gad7, "psy-anxiety"),
          ("ymrs-bands", c_ymrs, "psy-bipolar"),
          ("mmse-domains", c_mmse, "psy-dementia"),
          ("lithium-window", c_lithium, "psy-antidepressants-mood-stabilisers"),
          ("antidepressant-lag", c_ad_lag, "psy-antidepressants-mood-stabilisers"),
          ("ciwa-bands", c_ciwa, "psy-alcohol")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name, fn, mod in CHARTS:
        fn(args.out)
        DATA[name]["module"] = mod
        print("drew", name, flush=True)
    with open(os.path.join(args.out, "chart-data.json"), "w") as h:
        json.dump(DATA, h, indent=1)
    print("charts:", len(CHARTS))


if __name__ == "__main__":
    main()
