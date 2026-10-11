#!/usr/bin/env python3
"""tools/prep-fill3-charts-a.py - Draw PrepNucleus fill3 slice-A teaching charts.

Physiology (10) + pharmacology (8) in the app palette (paper #f3f2ee,
ink #13203d, prussian #0f3460, amber, ok/bad greens/reds). Same pattern as
tools/prep-psm-charts.py: deterministic, no randomness; every number embedded
below and re-emitted to chart-data.json (exact values + authority strings for
MCQ generation).

Usage: MPLCONFIGDIR=/tmp/img-fill3/mplcache /tmp/img-fill3/venvs/mpl/bin/python \\
         tools/prep-fill3-charts-a.py --out /tmp/img-fill3/charts/a
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

DATA = {}  # chart -> {"numbers": {...}, "authority": "..."}


def fig(short=False):
    f, a = plt.subplots(figsize=(12.7, 6.2 if short else 8.2))
    return f, a


def save(f, out, name):
    p = os.path.join(out, name + ".png")
    f.savefig(p, bbox_inches="tight")
    plt.close(f)
    return p


# ---------------- physiology ----------------

def c_action_potential(out):
    # Piecewise neuronal action potential: RMP -70, threshold -55, peak +30,
    # after-hyperpolarisation -80, back to -70 mV.
    t = np.array([0, 0.8, 1.0, 1.2, 1.4, 1.7, 2.0, 2.6, 3.4, 4.2, 5.0])
    v = np.array([-70, -70, -55, 0, 30, 10, -60, -80, -76, -71, -70])
    f, a = fig()
    a.plot(t, v, color=PRUSSIAN, lw=3)
    a.axhline(-70, color=INK2, ls="--", lw=1.5)
    a.axhline(-55, color=AMBER_D, ls=":", lw=2)
    a.text(5.1, -70, "Resting -70 mV", va="center", fontsize=11)
    a.text(5.1, -55, "Threshold -55 mV", va="center", fontsize=11, color=AMBER_D,
           weight="bold")
    a.annotate("Upstroke: Na+ in", xy=(1.2, 5), xytext=(2.2, 45),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12)
    a.annotate("Peak +30 mV", xy=(1.4, 30), xytext=(2.6, 30),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12,
               color=BAD, weight="bold")
    a.annotate("Repolarisation: K+ out", xy=(2.0, -60), xytext=(3.2, -35),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12)
    a.annotate("After-hyperpolarisation -80 mV", xy=(2.6, -80), xytext=(3.4, -95),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12)
    a.set_xlim(0, 6.4); a.set_ylim(-100, 60)
    a.set_xlabel("Time (ms)"); a.set_ylabel("Membrane potential (mV)")
    a.set_title("Neuronal action potential: phases and ion fluxes")
    save(f, out, "action-potential")
    DATA["action-potential"] = {
        "numbers": {"rmp": -70, "threshold": -55, "peak": 30, "ahp": -80},
        "authority": "Resting potential -70 mV; threshold -55 mV; upstroke to "
        "peak +30 mV by fast Na+ influx; repolarisation and "
        "after-hyperpolarisation to -80 mV by K+ efflux; absolute refractory "
        "period runs from upstroke to mid-repolarisation."}


def c_o2hb(out):
    po2 = np.linspace(0, 100, 400)
    def hill(p, p50, n=2.7):
        return 100 * p ** n / (p50 ** n + p ** n)
    f, a = fig()
    a.plot(po2, hill(po2, 26.7), color=PRUSSIAN, lw=3, label="Normal adult (P50 26.7 mmHg)")
    a.plot(po2, hill(po2, 34), color=BAD, lw=2.5, ls="--",
           label="Right shift, P50 34 (acidosis, high CO2, fever, raised 2,3-DPG)")
    a.plot(po2, hill(po2, 19), color=OK, lw=2.5, ls=":",
           label="Left shift, P50 19 (fetal Hb, alkalosis, low CO2, cold)")
    a.axhline(50, color=INK2, ls="--", lw=1.2)
    a.axvline(26.7, color=INK2, ls="--", lw=1.2)
    a.plot(26.7, 50, marker="o", ms=9, color=BAD)
    a.text(28, 42, "P50 = 26.7 mmHg", fontsize=12, weight="bold", color=BAD)
    a.text(97, 97, "Arterial\n~97%", ha="right", fontsize=11,
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.text(40, 72, "Mixed venous\n~75%", ha="center", fontsize=11,
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 100); a.set_ylim(0, 102)
    a.set_xlabel("PO2 (mmHg)"); a.set_ylabel("Hb saturation (%)")
    a.set_title("Oxygen-haemoglobin dissociation curve and its shifts")
    a.legend(fontsize=10.5, loc="lower right")
    save(f, out, "o2hb-curve")
    DATA["o2hb-curve"] = {
        "numbers": {"p50_normal": 26.7, "p50_right": 34, "p50_left": 19,
                    "arterial_sat": 97, "venous_sat": 75},
        "authority": "Sigmoid curve, P50 26.7 mmHg, arterial blood ~97% "
        "saturated and mixed venous ~75%. Right shift (acidosis, raised CO2, "
        "fever, raised 2,3-DPG) unloads O2 to tissues; left shift (fetal Hb, "
        "alkalosis, low CO2, cold, CO poisoning) holds O2 on."}


def c_starling(out):
    lvedp = np.linspace(0, 25, 200)
    f, a = fig()
    a.plot(lvedp, 95 * (1 - np.exp(-lvedp / 7)), color=PRUSSIAN, lw=3,
           label="Normal ventricle")
    a.plot(lvedp, 130 * (1 - np.exp(-lvedp / 8)), color=OK, lw=2.5,
           label="Sympathetic stimulation (up and left)")
    a.plot(lvedp, 55 * (1 - np.exp(-lvedp / 6)), color=BAD, lw=2.5,
           label="Heart failure (down and right)")
    a.set_xlim(0, 25); a.set_ylim(0, 140)
    a.set_xlabel("Left ventricular end-diastolic pressure (mmHg)")
    a.set_ylabel("Stroke volume (mL)")
    a.set_title("Frank-Starling curves: preload vs stroke volume")
    a.legend(fontsize=11)
    save(f, out, "frank-starling")
    DATA["frank-starling"] = {
        "numbers": {"normal_plateau": 95, "failing_plateau": 55},
        "authority": "Raising preload (LVEDP) raises stroke volume up to a "
        "plateau (Frank-Starling). Sympathetic stimulation shifts the curve "
        "up and left (more volume pumped at any preload); heart failure "
        "shifts it down and right (less volume at higher filling pressure)."}


def c_spirometry(out):
    # Static spirogram staircase: RV 1200, ERV 1200, TV 500, IRV 3100 mL.
    f, a = fig()
    vols = [("RV", 1200), ("ERV", 1200), ("TV", 500), ("IRV", 3100)]
    base, cols = 0, [INK2, AMBER_D, PRUSSIAN, OK]
    for (lab, v), c in zip(vols, cols):
        a.barh(0, v, left=base, height=0.4, color=c, edgecolor=INK)
        a.text(base + v / 2, 0, "%s %d mL" % (lab, v), ha="center",
               va="center", fontsize=11, weight="bold", color="#ffffff")
        base += v
    a.set_xlim(0, 6000); a.set_ylim(-1.0, 1.0); a.set_yticks([])
    a.set_xlabel("Volume (mL)")
    a.set_title("Static lung volumes (adult male, mL)")
    a.text(4200, 0.62, "IC = IRV + TV = 3600", fontsize=11, color=OK,
           weight="bold", ha="center")
    a.annotate("", xy=(2400, 0.45), xytext=(6000, 0.45),
               arrowprops={"arrowstyle": "<->", "color": OK, "lw": 2})
    a.text(1200, -0.62, "FRC = ERV + RV = 2400", fontsize=11, color=BAD,
           weight="bold", ha="center")
    a.annotate("", xy=(0, -0.45), xytext=(2400, -0.45),
               arrowprops={"arrowstyle": "<->", "color": BAD, "lw": 2})
    a.text(6000 / 2, -0.92, "TLC = 6000   VC = 4600", fontsize=11, ha="center")
    save(f, out, "spirometry")
    DATA["spirometry"] = {
        "numbers": {"tv": 500, "irv": 3100, "erv": 1200, "rv": 1200,
                    "ic": 3600, "frc": 2400, "vc": 4600, "tlc": 6000},
        "authority": "Tidal volume 500, IRV 3100, ERV 1200, residual volume "
        "1200 mL; inspiratory capacity 3600, functional residual capacity "
        "2400, vital capacity 4600, total lung capacity 6000 mL."}


def c_flow_volume(out):
    f, a = fig()
    ve = np.linspace(0, 1, 200)
    a.plot(ve * 4.6, 9 * np.sin(np.pi * ve) ** 0.8, color=PRUSSIAN, lw=3,
           label="Normal (FEV1/FVC ~80%)")
    a.plot(ve * 5.2, 4.5 * np.sin(np.pi * ve) ** 1.6, color=BAD, lw=2.5,
           label="Obstructive: scooped, low peak flow (FEV1/FVC <70%)")
    a.plot(ve * 3.0, 8 * np.sin(np.pi * ve) ** 0.7, color=AMBER_D, lw=2.5,
           label="Restrictive: small but tall loop (FEV1/FVC normal or high)")
    a.set_xlim(0, 5.5); a.set_ylim(0, 10)
    a.set_xlabel("Volume exhaled (L)"); a.set_ylabel("Expiratory flow (L/s)")
    a.set_title("Expiratory flow-volume loops: normal vs disease")
    a.legend(fontsize=10.5)
    save(f, out, "flow-volume")
    DATA["flow-volume"] = {
        "numbers": {"normal_fev1_fvc": 80, "obstructive_cutoff": 70},
        "authority": "Normal loop with FEV1/FVC about 80%. Obstruction "
        "(asthma, COPD) scoops the descending limb and drops the ratio below "
        "70% with preserved or high TLC; restriction shrinks all volumes "
        "with a normal or high ratio."}


def c_cardiac_cycle(out):
    t = np.linspace(0, 0.8, 400)
    lv = 10 + 110 * np.exp(-((t - 0.25) / 0.13) ** 2)
    ao = 80 + 40 * np.exp(-((t - 0.27) / 0.16) ** 2)
    la = 8 + 4 * np.sin(2 * np.pi * t / 0.8 + 1.2)
    f, a = fig()
    a.plot(t, lv, color=BAD, lw=3, label="Left ventricular pressure")
    a.plot(t, ao, color=PRUSSIAN, lw=3, label="Aortic pressure")
    a.plot(t, la, color=OK, lw=2, label="Left atrial pressure")
    for x, lab in [(0.10, "S1\n(mitral+tricuspid\nclose)"),
                   (0.38, "S2\n(aortic+pulmonary\nclose)")]:
        a.axvline(x, color=INK2, ls="--", lw=1.5)
        a.text(x, 128, lab, ha="center", fontsize=10,
               bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.text(0.24, 45, "Ejection\nEDV 120 -> ESV 50 mL\nSV 70 mL, EF 58%",
           ha="center", fontsize=11, weight="bold",
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 0.8); a.set_ylim(0, 150)
    a.set_xlabel("Time in one beat (s)"); a.set_ylabel("Pressure (mmHg)")
    a.set_title("Cardiac cycle: pressures, volumes and heart sounds")
    a.legend(fontsize=10.5, loc="upper right")
    save(f, out, "cardiac-cycle")
    DATA["cardiac-cycle"] = {
        "numbers": {"edv": 120, "esv": 50, "sv": 70, "ef": 58,
                    "sys": 120, "dia": 80},
        "authority": "S1 marks mitral and tricuspid closure at systole onset; "
        "S2 marks aortic and pulmonary closure at diastole onset. EDV 120 mL "
        "minus ESV 50 mL gives stroke volume 70 mL and ejection fraction "
        "58%; aortic pressure 120/80 mmHg."}


def c_gfr_autoreg(out):
    m = np.linspace(40, 220, 400)
    plat = np.piecewise(m, [m < 80, (m >= 80) & (m <= 180), m > 180],
                        [lambda x: 200 * x / 80, 200,
                         lambda x: 200 + 1.5 * (x - 180)])
    gfr = np.piecewise(m, [m < 80, (m >= 80) & (m <= 180), m > 180],
                       [lambda x: 125 * x / 80, 125,
                        lambda x: 125 + 0.9 * (x - 180)])
    f, a = fig()
    a2 = a.twinx()
    a.plot(m, plat, color=PRUSSIAN, lw=3, label="Renal blood flow")
    a2.plot(m, gfr, color=OK, lw=3, label="GFR")
    a.axvspan(80, 180, color=AMBER, alpha=0.25)
    a.text(130, 60, "Autoregulation\nMAP 80-180 mmHg", ha="center",
           fontsize=12, weight="bold")
    a.set_xlim(40, 220)
    a.set_xlabel("Mean arterial pressure (mmHg)")
    a.set_ylabel("Renal blood flow (mL/min/100 g)")
    a2.set_ylabel("GFR (mL/min)")
    a.set_title("Renal autoregulation: RBF and GFR vs MAP")
    save(f, out, "gfr-autoreg")
    DATA["gfr-autoreg"] = {
        "numbers": {"range_lo": 80, "range_hi": 180, "gfr": 125},
        "authority": "Myogenic response plus tubuloglomerular feedback hold "
        "renal blood flow and GFR (~125 mL/min) constant across MAP 80 to 180 "
        "mmHg; outside that range flow follows pressure passively."}


def c_strength_duration(out):
    d = np.linspace(0.05, 2.0, 300)
    v = 1.0 + 0.9 / (d * 3)
    f, a = fig()
    a.plot(d, v, color=PRUSSIAN, lw=3)
    a.axhline(1.0, color=BAD, ls="--", lw=2)
    a.text(1.7, 1.05, "Rheobase", fontsize=12, color=BAD, weight="bold")
    a.plot(0.3, 2.0, marker="o", ms=9, color=BAD)
    a.annotate("Chronaxie 0.3 ms\n(2x rheobase)", xy=(0.3, 2.0),
               xytext=(0.75, 2.9),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12)
    a.set_xlim(0, 2.0); a.set_ylim(0.5, 4.0)
    a.set_xlabel("Stimulus duration (ms)")
    a.set_ylabel("Threshold stimulus strength (V)")
    a.set_title("Strength-duration curve of a nerve fibre")
    save(f, out, "strength-duration")
    DATA["strength-duration"] = {
        "numbers": {"chronaxie_ms": 0.3},
        "authority": "Rheobase is the weakest current that excites with a "
        "long pulse; chronaxie (0.3 ms here) is the shortest pulse that "
        "excites at twice rheobase. Denervated muscle has a much longer "
        "chronaxie (order of 10 ms)."}


def c_length_tension(out):
    L = np.linspace(1.2, 2.6, 300)
    active = 100 * np.exp(-((L - 2.1) / 0.45) ** 2)
    passive = 8 * np.exp(2.2 * (L - 1.2)) - 8
    f, a = fig()
    a.plot(L, active, color=PRUSSIAN, lw=3, label="Active tension (peaks 2.0-2.2 um)")
    a.plot(L, passive, color=AMBER_D, lw=2.5, label="Passive tension (titin)")
    a.plot(L, active + passive, color=OK, lw=2.5, ls="--", label="Total tension")
    a.axvspan(2.0, 2.2, color=AMBER, alpha=0.3)
    a.text(2.1, 108, "Optimal overlap", ha="center", fontsize=11, weight="bold")
    a.set_xlim(1.2, 2.6); a.set_ylim(0, 125)
    a.set_xlabel("Sarcomere length (um)")
    a.set_ylabel("Tension (% of maximum active)")
    a.set_title("Skeletal muscle length-tension relationship")
    a.legend(fontsize=10.5)
    save(f, out, "length-tension")
    DATA["length-tension"] = {
        "numbers": {"optimal_lo": 2.0, "optimal_hi": 2.2},
        "authority": "Active tension peaks at sarcomere length 2.0 to 2.2 um "
        "where actin-myosin overlap is optimal; overstretch drops crossbridge "
        "numbers while passive titin tension climbs steeply."}


def c_co2_response(out):
    f, (a1, a2) = plt.subplots(1, 2, figsize=(12.7, 6.2))
    f.patch.set_facecolor(PAPER)
    co2 = np.linspace(30, 70, 200)
    a1.plot(co2, 1.5 * (co2 - 33), color=PRUSSIAN, lw=3)
    a1.axvline(40, color=INK2, ls="--", lw=1.5)
    a1.text(41, 44, "Normal PaCO2\n40 mmHg", fontsize=11)
    a1.set_xlim(30, 70); a1.set_ylim(0, 60)
    a1.set_xlabel("PaCO2 (mmHg)"); a1.set_ylabel("Alveolar ventilation (L/min)")
    a1.set_title("CO2 response: steep, linear")
    po2 = np.linspace(30, 110, 300)
    a2.plot(po2, 6 + 60 * np.exp(-(po2 - 30) / 18), color=BAD, lw=3)
    a2.axvline(60, color=INK2, ls="--", lw=1.5)
    a2.text(62, 44, "Flat above ~60 mmHg\nsteep below it", fontsize=11)
    a2.set_xlim(30, 110); a2.set_ylim(0, 60)
    a2.set_xlabel("PaO2 (mmHg)")
    a2.set_title("O2 response: weak until hypoxic")
    f.suptitle("Ventilatory response to CO2 (strong) vs O2 (weak until hypoxic)",
               fontsize=14, color=INK, weight="bold")
    save(f, out, "co2-response")
    DATA["co2-response"] = {
        "numbers": {"normal_paco2": 40, "hypoxic_threshold": 60},
        "authority": "Ventilation rises steeply and linearly with PaCO2 above "
        "40 mmHg (central chemoreceptors, H+). Hypoxia drives breathing only "
        "below PaO2 about 60 mmHg via carotid bodies; above that the O2 "
        "response is nearly flat."}


# ---------------- pharmacology ----------------

def c_graded_dose(out):
    d = np.logspace(-1, 3, 300)
    def resp(x, ec50, emax):
        return emax * x / (ec50 + x)
    f, a = fig()
    a.plot(d, resp(d, 10, 100), color=PRUSSIAN, lw=3,
           label="A: full agonist (EC50 10 mg, Emax 100%)")
    a.plot(d, resp(d, 100, 100), color=OK, lw=2.5,
           label="B: less potent (EC50 100 mg, same Emax)")
    a.plot(d, resp(d, 10, 40), color=BAD, lw=2.5,
           label="C: partial agonist (EC50 10 mg, Emax 40%)")
    a.set_xscale("log")
    a.set_xlim(0.1, 1000); a.set_ylim(0, 110)
    a.set_xlabel("Dose (mg, log scale)"); a.set_ylabel("Response (% of maximum)")
    a.set_title("Graded dose-response: potency (EC50) vs efficacy (Emax)")
    a.legend(fontsize=10.5)
    save(f, out, "graded-dose-response")
    DATA["graded-dose-response"] = {
        "numbers": {"A_ec50": 10, "A_emax": 100, "B_ec50": 100, "B_emax": 100,
                    "C_ec50": 10, "C_emax": 40},
        "authority": "A and C are equipotent (EC50 10 mg) but A has higher "
        "efficacy (Emax 100% vs 40%: C is a partial agonist). B matches A's "
        "efficacy but is 10-fold less potent (EC50 100 mg). Position on the "
        "x-axis reads potency; ceiling reads efficacy."}


def c_quantal_dose(out):
    d = np.logspace(0, 4, 400)
    def cum(x, m, s):
        return 100 / (1 + np.exp(-(np.log10(x) - np.log10(m)) / s))
    f, a = fig()
    a.plot(d, cum(d, 10, 0.18), color=OK, lw=3, label="Therapeutic effect (ED50 10 mg)")
    a.plot(d, cum(d, 100, 0.18), color=AMBER_D, lw=3, label="Toxic effect (TD50 100 mg)")
    a.plot(d, cum(d, 1000, 0.18), color=BAD, lw=3, label="Lethal effect (LD50 1000 mg)")
    a.set_xscale("log")
    a.set_xlim(1, 10000); a.set_ylim(0, 105)
    a.set_xlabel("Dose (mg, log scale)")
    a.set_ylabel("Animals responding (%)")
    a.set_title("Quantal dose-response: ED50, TD50, LD50 and therapeutic index")
    a.text(30, 88, "TI = TD50/ED50 = 10", fontsize=13, weight="bold", color=OK,
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.legend(fontsize=11)
    save(f, out, "quantal-dose-response")
    DATA["quantal-dose-response"] = {
        "numbers": {"ed50": 10, "td50": 100, "ld50": 1000, "ti": 10},
        "authority": "ED50 10 mg, TD50 100 mg, LD50 1000 mg; therapeutic index "
        "TI = TD50/ED50 = 10. Wider separation of the therapeutic and toxic "
        "curves means a safer drug; narrow-TI drugs (lithium, warfarin, "
        "digoxin) need monitoring."}


def c_antagonism(out):
    d = np.logspace(-1, 3, 300)
    def resp(x, ec50, emax):
        return emax * x / (ec50 + x)
    f, (a1, a2) = plt.subplots(1, 2, figsize=(12.7, 6.2))
    f.patch.set_facecolor(PAPER)
    a1.plot(d, resp(d, 10, 100), color=PRUSSIAN, lw=3, label="Agonist alone")
    a1.plot(d, resp(d, 100, 100), color=BAD, lw=2.5, ls="--",
            label="Competitive antagonist: parallel right shift, Emax kept")
    a1.set_xscale("log"); a1.set_xlim(0.1, 1000); a1.set_ylim(0, 110)
    a1.set_xlabel("Agonist dose (log scale)"); a1.set_ylabel("Response (%)")
    a1.set_title("Competitive antagonism"); a1.legend(fontsize=9)
    a2.plot(d, resp(d, 10, 100), color=PRUSSIAN, lw=3, label="Agonist alone")
    a2.plot(d, resp(d, 10, 45), color=BAD, lw=2.5, ls="--",
            label="Noncompetitive: Emax crushed to 45%, EC50 kept")
    a2.set_xscale("log"); a2.set_xlim(0.1, 1000); a2.set_ylim(0, 110)
    a2.set_xlabel("Agonist dose (log scale)")
    a2.set_title("Noncompetitive antagonism"); a2.legend(fontsize=9)
    f.suptitle("Competitive vs noncompetitive antagonism", fontsize=14,
               color=INK, weight="bold")
    save(f, out, "antagonism")
    DATA["antagonism"] = {
        "numbers": {"control_ec50": 10, "control_emax": 100,
                    "competitive_ec50": 100, "competitive_emax": 100,
                    "noncomp_ec50": 10, "noncomp_emax": 45},
        "authority": "Competitive antagonists shift the curve right in "
        "parallel (EC50 10 to 100, Emax 100% kept: surmountable). "
        "Noncompetitive antagonists depress Emax (to 45%) without moving "
        "EC50: insurmountable."}


def c_first_order(out):
    t = np.array([0, 4, 8, 12, 16, 20])
    c = 100 * 0.5 ** (t / 4.0)
    f, a = fig()
    a.plot(t, c, color=PRUSSIAN, lw=3, marker="o", ms=8)
    for x, y in zip(t, c):
        a.text(x, y + 4, "%g" % round(y, 1), ha="center", fontsize=11)
    a.set_yscale("log")
    a.set_xlim(-1, 21); a.set_ylim(1, 200)
    a.set_xlabel("Time (hours)"); a.set_ylabel("Plasma concentration (mg/L, log)")
    a.set_title("First-order elimination: half-life 4 h (log-linear fall)")
    a.text(13, 60, "t1/2 = 0.693 x Vd / Cl = 4 h\n"
           "4 half-lives remove 94%", fontsize=12,
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    save(f, out, "first-order-kinetics")
    DATA["first-order-kinetics"] = {
        "numbers": {"t_half_h": 4, "c0": 100, "removed_4_halflives": 94},
        "authority": "First-order fall: a constant FRACTION per unit time, so "
        "log concentration vs time is straight. Half-life 4 h: 100 -> 50 -> "
        "25 -> 12.5 -> 6.25 mg/L; four half-lives (16 h) remove 94% of drug."}


def c_zero_first(out):
    conc = np.linspace(0, 100, 300)
    f, a = fig()
    a.plot(conc, 0.9 * conc, color=PRUSSIAN, lw=3,
           label="First-order: rate rises with concentration")
    sat = 45 * conc / (15 + conc)
    a.plot(conc, sat, color=BAD, lw=3,
           label="Capacity-limited (phenytoin, ethanol): saturates")
    a.axhline(45, color=INK2, ls="--", lw=1.5)
    a.text(62, 48, "Vmax: saturated enzymes", fontsize=11)
    a.annotate("Small dose rise here\ngives a large level rise", xy=(70, 37),
               xytext=(30, 70),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=11,
               color=BAD, weight="bold")
    a.set_xlim(0, 100); a.set_ylim(0, 100)
    a.set_xlabel("Plasma concentration (mg/L)")
    a.set_ylabel("Rate of elimination (mg/h)")
    a.set_title("First-order vs zero-order (saturation) kinetics")
    a.legend(fontsize=10.5)
    save(f, out, "zero-first-order")
    DATA["zero-first-order"] = {
        "numbers": {},
        "authority": "Most drugs are first-order (elimination rate tracks "
        "concentration). Phenytoin, ethanol and salicylates saturate their "
        "enzymes (zero-order, flat Vmax line): past saturation a small dose "
        "increase causes a disproportionate level jump."}


def c_bioavailability(out):
    t = np.linspace(0, 12, 300)
    iv = 100 * np.exp(-0.55 * t)
    oral = 118 * (np.exp(-0.55 * t) - np.exp(-1.6 * t))
    f, a = fig()
    a.plot(t, iv, color=PRUSSIAN, lw=3, label="IV bolus (F = 1.0 by definition)")
    a.plot(t, oral, color=OK, lw=3, label="Oral (F = 0.7)")
    a.fill_between(t, oral, color=OK, alpha=0.12)
    a.fill_between(t, iv, color=PRUSSIAN, alpha=0.08)
    a.text(6.5, 62, "AUC oral / AUC IV = 0.77\nTmax 1 h, Cmax 44 mg/L",
           fontsize=12, bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 12); a.set_ylim(0, 110)
    a.set_xlabel("Time (hours)"); a.set_ylabel("Plasma concentration (mg/L)")
    a.set_title("Bioavailability: IV vs oral plasma curves (same 500 mg dose)")
    a.legend(fontsize=11)
    save(f, out, "bioavailability-auc")
    DATA["bioavailability-auc"] = {
        "numbers": {"F": 0.77, "tmax_h": 1, "cmax": 44, "dose_mg": 500},
        "authority": "Bioavailability F = AUC oral / AUC IV = 0.77: 77% of the "
        "500 mg oral dose reaches the circulation. Tmax 1 h and Cmax 44 mg/L "
        "read rate and extent of absorption."}


def c_steady_state(out):
    half, tau = 6.0, 6.0
    t = np.linspace(0, 48, 800)
    k = 0.693 / half
    acc = 1 / (1 - np.exp(-k * tau))
    c = 60 * acc * (1 - np.exp(-k * t)) * (0.82 + 0.18 * np.cos(2 * np.pi * t / tau))
    f, a = fig()
    a.plot(t, c, color=PRUSSIAN, lw=2.5)
    a.axvline(4 * half, color=BAD, ls="--", lw=2)
    a.axvline(5 * half, color=BAD, ls=":", lw=2)
    a.text(33, 62, "Plateau at 4-5 half-lives\n(24-30 h)", fontsize=12,
           color=BAD, weight="bold")
    a.set_xlim(0, 48); a.set_ylim(0, 130)
    a.set_xlabel("Time (hours, 60 mg every 6 h, t1/2 6 h)")
    a.set_ylabel("Plasma concentration (mg/L)")
    a.set_title("Steady state: 4-5 half-lives to plateau")
    save(f, out, "steady-state")
    DATA["steady-state"] = {
        "numbers": {"t_half_h": 6, "tau_h": 6, "plateau_h": "24-30"},
        "authority": "With 60 mg every half-life (6 h), levels climb to a "
        "plateau of about 100 to 120 mg/L after 4 to 5 half-lives (24-30 h) "
        "when drug in equals drug out per interval. Only the half-life sets "
        "time to plateau; dose rate sets its height."}


def c_therapeutic_window(out):
    t = np.linspace(0, 12, 400)
    drugA = 14 + 4 * np.sin(2 * np.pi * t / 6)
    drugB = 14 + 11 * np.sin(2 * np.pi * t / 6)
    f, a = fig()
    a.axhspan(8, 20, color=OK, alpha=0.15)
    a.axhline(20, color=BAD, ls="--", lw=2)
    a.axhline(8, color=AMBER_D, ls="--", lw=2)
    a.text(11.5, 21, "MTC (toxic above)", ha="right", fontsize=11, color=BAD)
    a.text(11.5, 6.5, "MEC (useless below)", ha="right", fontsize=11,
           color=AMBER_D)
    a.plot(t, drugA, color=OK, lw=3, label="Drug A: stays in the window")
    a.plot(t, drugB, color=BAD, lw=3, label="Drug B: toxic peaks, subtherapeutic troughs")
    a.set_xlim(0, 12); a.set_ylim(0, 30)
    a.set_xlabel("Time (hours)"); a.set_ylabel("Plasma concentration (mg/L)")
    a.set_title("Therapeutic window: MEC to MTC")
    a.legend(fontsize=10.5)
    save(f, out, "therapeutic-window")
    DATA["therapeutic-window"] = {
        "numbers": {"mec": 8, "mtc": 20},
        "authority": "The window runs from minimum effective concentration "
        "(MEC 8 mg/L) to minimum toxic concentration (MTC 20 mg/L). Drug A "
        "stays inside it; drug B swings from toxic peaks to useless troughs "
        "and needs smaller, more frequent doses or a sustained-release form."}


CHARTS = [("action-potential", c_action_potential, "phy-membrane-potentials"),
          ("o2hb-curve", c_o2hb, "phy-gas-transport"),
          ("frank-starling", c_starling, "phy-haemodynamics"),
          ("spirometry", c_spirometry, "phy-mechanics"),
          ("flow-volume", c_flow_volume, "phy-mechanics"),
          ("cardiac-cycle", c_cardiac_cycle, "phy-cardiac-cycle"),
          ("gfr-autoreg", c_gfr_autoreg, "phy-gfr"),
          ("strength-duration", c_strength_duration, "phy-nerve-fibres"),
          ("length-tension", c_length_tension, "phy-skeletal-muscle"),
          ("co2-response", c_co2_response, "phy-regulation"),
          ("graded-dose-response", c_graded_dose, "phm-pharmacodynamics"),
          ("quantal-dose-response", c_quantal_dose, "phm-pharmacodynamics"),
          ("antagonism", c_antagonism, "phm-pharmacodynamics"),
          ("first-order-kinetics", c_first_order, "phm-pharmacokinetics"),
          ("zero-first-order", c_zero_first, "phm-pharmacokinetics"),
          ("bioavailability-auc", c_bioavailability, "phm-absorption-routes"),
          ("steady-state", c_steady_state, "phm-pharmacokinetics"),
          ("therapeutic-window", c_therapeutic_window, "phm-pharmacokinetics")]


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

