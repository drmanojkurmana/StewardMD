#!/usr/bin/env python3
"""tools/prep-img9-charts.py - Draw PrepNucleus maikimg9 top-up teaching charts.

Biochemistry (3) + pharmacology (3) + psychiatry (3) + ss-biostatistics (10).
Same deterministic pattern as the fill3 scripts: numbers embedded below and
re-emitted to chart-data.json (exact values + authority strings for MCQ
generation). All art is StewardMD-original (licence: StewardMD teaching
illustration).

Usage: MPLCONFIGDIR=/tmp/kb-img9/mplcache /tmp/kb-img9/venv/bin/python \\
         tools/prep-img9-charts.py --out /tmp/kb-img9/charts/top
"""
import argparse
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
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


# ---------------- biochemistry ----------------

def c_inhibition(out):
    s = np.linspace(0, 20, 300)
    none = 100 * s / (2 + s)
    comp = 100 * s / (6 + s)
    nonc = 50 * s / (2 + s)
    f, a = fig()
    a.plot(s, none, color=PRUSSIAN, lw=3, label="No inhibitor (Vmax 100, Km 2)")
    a.plot(s, comp, color=BAD, lw=3, ls="--", label="Competitive (Vmax 100, Km 6)")
    a.plot(s, nonc, color=OK, lw=3, ls=":", label="Non-competitive (Vmax 50, Km 2)")
    a.set_xlim(0, 20); a.set_ylim(0, 115)
    a.set_xlabel("Substrate [S] (mM)"); a.set_ylabel("Velocity (umol/min)")
    a.set_title("Enzyme inhibition: velocity vs substrate")
    a.legend(fontsize=11, loc="lower right")
    save(f, out, "bio-inhibition")
    DATA["bio-inhibition"] = {"numbers": {"vmax": 100, "km": 2, "km_comp": 6, "vmax_nonc": 50},
        "authority": "Competitive inhibition raises Km (2 to 6 mM) with Vmax unchanged "
        "(100); non-competitive inhibition lowers Vmax (100 to 50) with Km unchanged "
        "(2 mM). Competitive inhibition is overcome by high substrate."}


def c_spep(out):
    f, a = fig(short=True)
    fracs = [("Albumin", 55, 0.0), ("Alpha-1", 4, 1.0), ("Alpha-2", 9, 2.0),
             ("Beta", 12, 3.0), ("Gamma", 20, 4.0)]
    xs = np.linspace(0, 5, 500)
    y = np.zeros_like(xs)
    for i, (nm, pct, c) in enumerate(fracs):
        w = 0.28 if nm != "Gamma" else 0.42
        h = pct / 8
        y += h * np.exp(-0.5 * ((xs - (c + 0.5)) / w) ** 2)
    spike = 3.4 * np.exp(-0.5 * ((xs - 4.45) / 0.07) ** 2)
    a.fill_between(xs, y, color=PRUSSIAN, alpha=0.55)
    a.plot(xs, y + spike, color=BAD, lw=3)
    a.annotate("M-spike (monoclonal)", xy=(4.45, 5.9), xytext=(2.4, 6.4),
               fontsize=12, weight="bold", color=BAD,
               arrowprops=dict(arrowstyle="->", color=BAD, lw=2))
    a.set_xlim(0, 5); a.set_ylim(0, 7.4)
    a.set_xticks([0.5, 1.5, 2.5, 3.5, 4.5])
    a.set_xticklabels(["Albumin", "Alpha-1", "Alpha-2", "Beta", "Gamma"])
    a.set_ylabel("Protein (g/dL, schematic)")
    a.set_title("Serum protein electrophoresis with M-spike")
    save(f, out, "bio-spep")
    DATA["bio-spep"] = {"numbers": {"m_spike_zone": "gamma"},
        "authority": "A narrow-based tall spike in the gamma zone is an M-spike "
        "(monoclonal gammopathy, classic for multiple myeloma). A broad-based "
        "gamma rise is polyclonal (chronic inflammation, cirrhosis)."}


def c_allosteric(out):
    s = np.linspace(0, 10, 300)
    mm = 100 * s / (2 + s)
    sig = 100 * s ** 2.8 / (3 ** 2.8 + s ** 2.8)
    f, a = fig()
    a.plot(s, mm, color=INK2, lw=2, ls="--", label="Michaelis-Menten (hyperbola)")
    a.plot(s, sig, color=PRUSSIAN, lw=3, label="Allosteric enzyme (sigmoid, K0.5 = 3)")
    a.axhline(50, color=INK2, ls=":", lw=1.5)
    a.axvline(3, color=BAD, ls="--", lw=2)
    a.text(3.2, 58, "K0.5 = 3 mM", fontsize=12, weight="bold", color=BAD)
    a.set_xlim(0, 10); a.set_ylim(0, 112)
    a.set_xlabel("Substrate [S] (mM)"); a.set_ylabel("Velocity (% Vmax)")
    a.set_title("Allosteric (sigmoidal) vs Michaelis-Menten kinetics")
    a.legend(fontsize=11, loc="lower right")
    save(f, out, "bio-allosteric")
    DATA["bio-allosteric"] = {"numbers": {"k_half": 3, "hill": 2.8},
        "authority": "Allosteric/cooperative enzymes give a sigmoidal curve with "
        "K0.5 (substrate at half Vmax) instead of Km. Haemoglobin oxygen binding "
        "is the classic in-vivo sigmoid (cooperative subunits)."}


# ---------------- pharmacology ----------------

def c_schild(out):
    logb = np.linspace(-9, -5, 100)
    logdr = logb + 7.0
    f, a = fig()
    a.plot(logb, logdr, color=PRUSSIAN, lw=3)
    a.axhline(0, color=INK2, ls="--", lw=1.5)
    a.axvline(-7, color=BAD, ls="--", lw=2)
    a.plot(-7, 0, marker="o", ms=10, color=BAD)
    a.text(-6.8, 0.25, "pA2 = 7.0\n(slope = 1)", fontsize=12, weight="bold", color=BAD)
    a.set_xlabel("log [antagonist B] (M)"); a.set_ylabel("log (dose ratio - 1)")
    a.set_title("Schild plot: competitive antagonism")
    save(f, out, "phm-schild")
    DATA["phm-schild"] = {"numbers": {"pa2": 7.0, "slope": 1.0},
        "authority": "A Schild slope of 1 confirms simple competitive antagonism; "
        "the x-intercept is pA2 (7.0), the negative log of the antagonist "
        "concentration that doubles the agonist EC50. Higher pA2 means higher "
        "antagonist affinity."}


def c_iontrap(out):
    ph = np.linspace(1, 10, 300)
    acid = 100 / (1 + 10 ** (4.0 - ph))
    base = 100 / (1 + 10 ** (ph - 9.0))
    f, a = fig()
    a.plot(ph, acid, color=PRUSSIAN, lw=3, label="Weak acid, pKa 4 (e.g. aspirin)")
    a.plot(ph, base, color=BAD, lw=3, label="Weak base, pKa 9 (e.g. pethidine)")
    a.axvline(1.5, color=INK2, ls=":", lw=1.5); a.text(1.6, 88, "Stomach pH 1.5", fontsize=11)
    a.axvline(7.4, color=INK2, ls=":", lw=1.5); a.text(7.5, 88, "Plasma pH 7.4", fontsize=11)
    a.set_xlim(1, 10); a.set_ylim(0, 105)
    a.set_xlabel("pH"); a.set_ylabel("% ionised")
    a.set_title("Henderson-Hasselbalch: ionisation vs pH")
    a.legend(fontsize=11, loc="center right")
    save(f, out, "phm-iontrap")
    DATA["phm-iontrap"] = {"numbers": {"pka_acid": 4.0, "pka_base": 9.0},
        "authority": "Weak acids are mostly unionised (absorbable) in acid and "
        "ionised (trapped) in alkali; weak bases are the reverse. Alkalinising "
        "urine traps weak acids (salicylate poisoning); acidifying urine traps "
        "weak bases."}


def c_twocomp(out):
    t = np.linspace(0, 24, 300)
    c = 60 * np.exp(-1.2 * t) + 40 * np.exp(-0.15 * t)
    f, a = fig()
    a.semilogy(t, c, color=PRUSSIAN, lw=3)
    a.axvspan(0, 3, color=AMBER, alpha=0.25)
    a.text(0.4, 60, "Alpha phase\n(distribution)", fontsize=11, weight="bold")
    a.text(12, 8, "Beta phase (elimination)\nt1/2 = 4.6 h", fontsize=11, weight="bold")
    a.set_xlabel("Time (h)"); a.set_ylabel("Plasma concentration (log scale)")
    a.set_title("Two-compartment model: biexponential decay")
    save(f, out, "phm-twocomp")
    DATA["phm-twocomp"] = {"numbers": {"beta_half_life_h": 4.6},
        "authority": "Log-linear plasma decay with two straight segments means a "
        "two-compartment model: a fast alpha (distribution) phase then a slow "
        "beta (elimination) phase. The beta half-life (4.6 h) governs dosing "
        "interval and time to steady state."}


# ---------------- psychiatry (scale bands) ----------------

def band_chart(out, name, title, xlabel, xmax, bands, marker, marker_label):
    f, a = fig(short=True)
    cols = [OK, "#7fb069", AMBER, "#e07a3f", BAD]
    for i, (lo, hi, label) in enumerate(bands):
        a.barh(0.5, hi - lo, left=lo, height=0.35, color=cols[i % len(cols)],
               edgecolor="white", lw=2)
        a.text((lo + hi) / 2, 0.5, label, ha="center", va="center", fontsize=11,
               weight="bold", color="white" if i >= 2 else INK)
    a.plot(marker, 0.5, marker="v", ms=16, color=INK)
    a.text(marker, 0.78, marker_label, ha="center", fontsize=11, weight="bold")
    a.set_xlim(0, xmax); a.set_ylim(0, 1.05)
    a.set_yticks([]); a.set_xlabel(xlabel)
    a.set_title(title)
    save(f, out, name)


def c_audit(out):
    bands = [(0, 7, "0-7\nLow risk"), (8, 15, "8-15\nHazardous"),
             (16, 19, "16-19\nHarmful"), (20, 40, "20+ Possible\ndependence")]
    band_chart(out, "psy-audit", "AUDIT score bands (alcohol use)", "AUDIT total (0-40)",
               40, bands, 23, "Score 23: possible dependence")
    DATA["psy-audit"] = {"numbers": {"cutoffs": [8, 16, 20], "score": 23},
        "authority": "AUDIT 8+ means hazardous use, 16+ harmful use, 20+ possible "
        "dependence. A score of 23 falls in possible dependence: refer for "
        "comprehensive assessment, not brief advice alone."}


def c_hamd(out):
    bands = [(0, 7, "0-7\nNormal"), (8, 13, "8-13\nMild"), (14, 18, "14-18\nModerate"),
             (19, 22, "19-22\nSevere"), (23, 30, "23+ Very\nsevere")]
    band_chart(out, "psy-hamd", "HAM-D-17 severity bands (depression)", "HAM-D-17 total",
               30, bands, 21, "Score 21: severe")
    DATA["psy-hamd"] = {"numbers": {"cutoffs": [8, 14, 19, 23], "score": 21},
        "authority": "HAM-D-17: 8-13 mild, 14-18 moderate, 19-22 severe, 23+ very "
        "severe depression. A score of 21 is severe: remission is HAM-D 7 or "
        "less, response is a 50% or greater fall."}


def c_ybocs(out):
    bands = [(0, 7, "0-7\nSubclinical"), (8, 15, "8-15\nMild"),
             (16, 23, "16-23\nModerate"), (24, 31, "24-31\nSevere"), (32, 40, "32-40\nExtreme")]
    band_chart(out, "psy-ybocs", "Y-BOCS severity bands (OCD)", "Y-BOCS total (0-40)",
               40, bands, 27, "Score 27: severe OCD")
    DATA["psy-ybocs"] = {"numbers": {"cutoffs": [8, 16, 24, 32], "score": 27},
        "authority": "Y-BOCS: 8-15 mild, 16-23 moderate, 24-31 severe, 32-40 "
        "extreme OCD (obsessions + compulsions subscales, 0-20 each). A score "
        "of 27 is severe: needs high-dose SSRI and/or exposure-response "
        "prevention, not reassurance."}


# ---------------- ss-biostatistics ----------------

def c_funnel(out):
    rng = np.random.default_rng(9)
    se = np.concatenate([rng.uniform(0.05, 0.15, 14), rng.uniform(0.15, 0.35, 10)])
    eff = np.concatenate([rng.normal(0.7, 0.12, 14), rng.normal(0.45, 0.12, 10)])
    f, a = fig()
    a.scatter(eff, se, s=70, color=PRUSSIAN, edgecolor="white", zorder=3)
    for sd in (-1.96, 1.96):
        a.plot(0.7 + sd * np.linspace(0.05, 0.35, 100) / 3, np.linspace(0.05, 0.35, 100),
               color=INK2, ls="--", lw=1.5)
    a.axvline(0.7, color=BAD, lw=2)
    a.text(0.88, 0.28, "Gap here:\nmissing small\nnegative studies?", fontsize=11, color=BAD,
           weight="bold")
    a.set_xlabel("Effect (odds ratio)"); a.set_ylabel("Standard error")
    a.set_title("Funnel plot: asymmetry suggests publication bias")
    a.invert_yaxis()
    save(f, out, "sbs-funnel")
    DATA["sbs-funnel"] = {"numbers": {"pooled_or": 0.7},
        "authority": "In a funnel plot, small imprecise studies scatter widely at "
        "the bottom. A gap on one side (asymmetry) suggests missing small "
        "negative studies, i.e. publication bias. Egger test assesses it "
        "formally."}


def c_fagan(out):
    f, a = fig(short=True)
    a.set_xlim(0, 10); a.set_ylim(0, 10)
    a.axis("off")
    a.plot([2, 2], [1, 9], color=INK, lw=3)
    a.plot([5, 5], [1, 9], color=INK, lw=3)
    a.plot([8, 8], [1, 9], color=INK, lw=3)
    a.text(2, 9.4, "Pre-test", ha="center", weight="bold")
    a.text(5, 9.4, "LR+", ha="center", weight="bold")
    a.text(8, 9.4, "Post-test", ha="center", weight="bold")
    a.text(1.2, 4.4, "20%", fontsize=12, weight="bold", color=PRUSSIAN)
    a.text(5.7, 6.3, "LR+ 5", fontsize=12, weight="bold", color=PRUSSIAN)
    a.text(7.0, 5.5, "56%", fontsize=14, weight="bold", color=BAD)
    a.plot([2, 5, 8], [4.4, 6.3, 5.5], color=BAD, lw=3)
    a.text(5, 0.4, "Fagan nomogram: 20% pre-test + LR+ 5 gives 56% post-test",
           ha="center", fontsize=11)
    save(f, out, "sbs-fagan")
    DATA["sbs-fagan"] = {"numbers": {"pretest": 20, "lr_pos": 5, "posttest": 56},
        "authority": "Fagan nomogram: pre-test probability 20% with a positive "
        "result of LR+ 5 gives post-test probability 56% "
        "(odds 1:4 become 5:4). Higher LR+ rules in more strongly."}


def c_boxplot(out):
    rng = np.random.default_rng(4)
    g1 = rng.normal(120, 8, 60)
    g2 = rng.normal(142, 10, 60)
    g2 = np.append(g2, [178])
    f, a = fig()
    bp = a.boxplot([g1, g2], tick_labels=["Drug A", "Drug B"], patch_artist=True,
                   medianprops=dict(color=BAD, lw=2.5))
    for box in bp["boxes"]:
        box.set_facecolor("#dbe4f0"); box.set_edgecolor(PRUSSIAN); box.set_lw(2)
    a.annotate("Outlier", xy=(2, 178), xytext=(1.35, 172), fontsize=11,
               arrowprops=dict(arrowstyle="->", color=INK, lw=1.5))
    a.set_ylabel("Systolic BP (mmHg)")
    a.set_title("Box-and-whisker: median, IQR and outliers")
    save(f, out, "sbs-boxplot")
    DATA["sbs-boxplot"] = {"numbers": {"median_a": 120, "median_b": 142},
        "authority": "The box spans the interquartile range (25th-75th centile), "
        "the line is the median, whiskers extend to 1.5x IQR, and points beyond "
        "are plotted outliers. Medians (120 vs 142) resist the 178 outlier; "
        "means would not."}


def c_skew(out):
    rng = np.random.default_rng(7)
    x = rng.exponential(4, 2000) + 1
    f, a = fig()
    a.hist(x, bins=40, color=PRUSSIAN, alpha=0.7, edgecolor="white")
    a.axvline(np.mean(x), color=BAD, lw=3, label="Mean %.1f" % np.mean(x))
    a.axvline(np.median(x), color=OK, lw=3, ls="--",
              label="Median %.1f" % np.median(x))
    a.axvline(1.5, color=AMBER_D, lw=3, ls=":",
              label="Mode (lowest)")
    a.set_xlabel("Hospital stay (days)"); a.set_ylabel("Patients")
    a.set_title("Right (positive) skew: mean > median > mode")
    a.legend(fontsize=11)
    save(f, out, "sbs-skew")
    DATA["sbs-skew"] = {"numbers": {"mean": round(float(np.mean(x)), 1),
        "median": round(float(np.median(x)), 1)},
        "authority": "Right-skewed data (tail to the right, e.g. hospital stay) "
        "have mean above median above mode. Report median and IQR for skewed "
        "data; the mean overstates the typical value."}


def c_scatter(out):
    rng = np.random.default_rng(11)
    x = rng.uniform(100, 220, 80)
    y = 0.55 * x + rng.normal(0, 9, 80) - 30
    r = float(np.corrcoef(x, y)[0, 1])
    m, b = np.polyfit(x, y, 1)
    f, a = fig()
    a.scatter(x, y, s=45, color=PRUSSIAN, alpha=0.7, edgecolor="white")
    a.plot(x, m * x + b, color=BAD, lw=3)
    a.text(105, max(y) - 4, "r = %.2f (r2 = %.2f)" % (r, r ** 2), fontsize=12,
           weight="bold", color=BAD)
    a.set_xlabel("BMI x 10"); a.set_ylabel("Systolic BP (mmHg)")
    a.set_title("Scatter with regression line: strong positive correlation")
    save(f, out, "sbs-scatter")
    DATA["sbs-scatter"] = {"numbers": {"r": round(r, 2), "r2": round(r ** 2, 2)},
        "authority": "Pearson r near +1 is a strong positive linear relation; r2 "
        "is the fraction of variance explained. Correlation is not causation: "
        "confounders (age, salt) can drive both variables."}


def c_bland(out):
    rng = np.random.default_rng(5)
    mean = rng.uniform(60, 160, 90)
    diff = rng.normal(4.0, 6.0, 90)
    lo, hi = 4.0 - 1.96 * 6.0, 4.0 + 1.96 * 6.0
    f, a = fig()
    a.scatter(mean, diff, s=45, color=PRUSSIAN, alpha=0.7, edgecolor="white")
    a.axhline(4.0, color=BAD, lw=2.5)
    a.text(62, 5.2, "Bias +4.0", fontsize=11, weight="bold", color=BAD)
    a.axhline(hi, color=INK2, ls="--", lw=2)
    a.axhline(lo, color=INK2, ls="--", lw=2)
    a.text(62, hi + 0.8, "Upper limit %.1f" % hi, fontsize=11)
    a.text(62, lo - 1.6, "Lower limit %.1f" % lo, fontsize=11)
    a.set_xlabel("Mean of two BP devices (mmHg)")
    a.set_ylabel("Difference new minus old (mmHg)")
    a.set_title("Bland-Altman plot: agreement of two devices")
    save(f, out, "sbs-bland")
    DATA["sbs-bland"] = {"numbers": {"bias": 4.0, "loa": [round(lo, 1), round(hi, 1)]},
        "authority": "Bland-Altman plots difference against mean: bias +4.0 mmHg "
        "with 95% limits of agreement -7.8 to +15.8. Agreement is judged by "
        "whether the limits are clinically acceptable, not by correlation."}


def c_power(out):
    n = np.linspace(20, 500, 200)
    p1 = 1 - np.exp(-n / 120)
    p2 = 1 - np.exp(-n / 300)
    f, a = fig()
    a.plot(n, 100 * p1, color=PRUSSIAN, lw=3, label="Large effect")
    a.plot(n, 100 * p2, color=BAD, lw=3, label="Small effect")
    a.axhline(80, color=INK2, ls="--", lw=2)
    a.text(420, 82, "80% power", fontsize=11)
    a.set_xlim(20, 500); a.set_ylim(0, 102)
    a.set_xlabel("Sample size per group"); a.set_ylabel("Power (%)")
    a.set_title("Power rises with sample size and effect size")
    a.legend(fontsize=11, loc="lower right")
    save(f, out, "sbs-power")
    DATA["sbs-power"] = {"numbers": {"target_power": 80},
        "authority": "Power is 1 minus the type-II error rate. For a fixed "
        "effect, power rises with sample size; small effects need far larger "
        "samples to reach the conventional 80% power."}


def c_pyramid(out):
    tiers = [("Systematic reviews\n+ meta-analyses", 1.0),
             ("Randomised\ncontrolled trials", 2.2),
             ("Cohort studies", 3.4),
             ("Case-control studies", 4.6),
             ("Case series / reports", 5.8),
             ("Expert opinion", 7.0)]
    f, a = fig()
    a.set_xlim(0, 10); a.set_ylim(0, 8)
    a.axis("off")
    for i, (label, y) in enumerate(tiers):
        w = 2.6 + i * 0.85
        x0 = 5 - w / 2
        rect = patches.Rectangle((x0, 7.3 - y), w, 0.95, facecolor=PRUSSIAN,
                                 alpha=0.85 - i * 0.11, edgecolor="white", lw=2)
        a.add_patch(rect)
        a.text(5, 7.75 - y, label, ha="center", va="center", fontsize=9,
               weight="bold", color="white" if i < 4 else INK)
    a.set_title("Hierarchy of evidence (higher = stronger)")
    save(f, out, "sbs-pyramid")
    DATA["sbs-pyramid"] = {"numbers": {"top": "systematic review and meta-analysis"},
        "authority": "Higher designs resist bias better: systematic reviews and "
        "meta-analyses of RCTs sit above single RCTs, then cohort, case-control, "
        "case series, and expert opinion at the base. Design sets the ceiling; "
        "conduct sets the floor."}


def c_cibar(out):
    f, a = fig(short=True)
    a.errorbar([1, 2], [12, 9], yerr=[2.5, 2.0], fmt="o", ms=10, capsize=8,
               capthick=2.5, elinewidth=2.5, color=PRUSSIAN)
    a.set_xlim(0.4, 2.6); a.set_xticks([1, 2])
    a.set_xticklabels(["Drug A\n12 (95% CI 9.5-14.5)", "Drug B\n9 (95% CI 7-11)"])
    a.set_ylabel("Fall in HbA1c (mmol/mol)")
    a.set_title("Overlapping 95% CIs: no clear difference")
    save(f, out, "sbs-cibar")
    DATA["sbs-cibar"] = {"numbers": {"mean_a": 12, "ci_a": [9.5, 14.5],
        "mean_b": 9, "ci_b": [7.0, 11.0]},
        "authority": "The two 95% confidence intervals (9.5-14.5 and 7-11) "
        "overlap substantially, so no clear difference is shown. Non-overlap "
        "of 95% CIs roughly implies p < 0.05, but overlap does not prove "
        "equivalence."}


def c_i2(out):
    f, a = fig(short=True)
    a.barh(0.5, 25, left=0, height=0.35, color=OK, edgecolor="white", lw=2)
    a.barh(0.5, 25, left=25, height=0.35, color=AMBER, edgecolor="white", lw=2)
    a.barh(0.5, 50, left=50, height=0.35, color=BAD, edgecolor="white", lw=2)
    a.text(12.5, 0.5, "Low\n<25%", ha="center", va="center", fontsize=11, weight="bold")
    a.text(37.5, 0.5, "Moderate\n25-50%", ha="center", va="center", fontsize=11, weight="bold")
    a.text(75, 0.5, "Substantial >50%", ha="center", va="center", fontsize=11,
           weight="bold", color="white")
    a.plot(68, 0.5, marker="v", ms=16, color=INK)
    a.text(68, 0.78, "I2 = 68%: substantial", ha="center", fontsize=11, weight="bold")
    a.set_xlim(0, 100); a.set_ylim(0, 1.05); a.set_yticks([])
    a.set_xlabel("I-squared (%)")
    a.set_title("Heterogeneity gauge: I-squared")
    save(f, out, "sbs-i2")
    DATA["sbs-i2"] = {"numbers": {"i2": 68, "cutoffs": [25, 50]},
        "authority": "I-squared is the fraction of variation across studies due "
        "to heterogeneity rather than chance: under 25% low, 25-50% moderate, "
        "over 50% substantial. I2 of 68% is substantial: use random effects and "
        "explore subgroups."}


CHARTS = [("bio-inhibition", c_inhibition, "bio-enzymes"),
          ("bio-spep", c_spep, "bio-protein-structure"),
          ("bio-allosteric", c_allosteric, "bio-enzymes"),
          ("phm-schild", c_schild, "phm-pharmacodynamics"),
          ("phm-iontrap", c_iontrap, "phm-pharmacokinetics"),
          ("phm-twocomp", c_twocomp, "phm-pharmacokinetics"),
          ("psy-audit", c_audit, "psy-alcohol"),
          ("psy-hamd", c_hamd, "psy-depression"),
          ("psy-ybocs", c_ybocs, "psy-ocd"),
          ("sbs-funnel", c_funnel, "sbs-trials-ebm"),
          ("sbs-fagan", c_fagan, "sbs-diagnostic-tests"),
          ("sbs-boxplot", c_boxplot, "sbs-descriptive-probability"),
          ("sbs-skew", c_skew, "sbs-descriptive-probability"),
          ("sbs-scatter", c_scatter, "sbs-regression-survival"),
          ("sbs-bland", c_bland, "sbs-diagnostic-tests"),
          ("sbs-power", c_power, "sbs-hypothesis-tests"),
          ("sbs-pyramid", c_pyramid, "sbs-study-design"),
          ("sbs-cibar", c_cibar, "sbs-hypothesis-tests"),
          ("sbs-i2", c_i2, "sbs-trials-ebm")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name, fn, _mod in CHARTS:
        fn(args.out)
        print("drew", name)
    with open(os.path.join(args.out, "chart-data.json"), "w") as fh:
        json.dump(DATA, fh, indent=1, sort_keys=True)
    print("charts:", len(CHARTS))


if __name__ == "__main__":
    main()
