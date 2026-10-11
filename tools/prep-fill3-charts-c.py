#!/usr/bin/env python3
"""tools/prep-fill3-charts-c.py - Draw PrepNucleus fill3 slice-C teaching charts.

Biochemistry (8) + ss-biostatistics (6) + ENT audiograms (4). Same
deterministic pattern as the slice-A/B scripts: numbers embedded below and
re-emitted to chart-data.json (exact values + authority strings).

Usage: MPLCONFIGDIR=/tmp/img-fill3/mplcache /tmp/img-fill3/venvs/mpl/bin/python \\
         tools/prep-fill3-charts-c.py --out /tmp/img-fill3/charts/c
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

def c_mm(out):
    s = np.linspace(0, 20, 300)
    v = 100 * s / (2 + s)
    f, a = fig()
    a.plot(s, v, color=PRUSSIAN, lw=3)
    a.axhline(100, color=INK2, ls="--", lw=1.5)
    a.axhline(50, color=INK2, ls=":", lw=1.5)
    a.axvline(2, color=BAD, ls="--", lw=2)
    a.plot(2, 50, marker="o", ms=10, color=BAD)
    a.text(2.3, 56, "Km = 2 mM\n(at Vmax/2)", fontsize=12, weight="bold",
           color=BAD)
    a.text(16, 102, "Vmax = 100", fontsize=11)
    a.set_xlim(0, 20); a.set_ylim(0, 115)
    a.set_xlabel("Substrate [S] (mM)"); a.set_ylabel("Velocity (umol/min)")
    a.set_title("Michaelis-Menten kinetics: Km 2 mM, Vmax 100")
    save(f, out, "michaelis-menten")
    DATA["michaelis-menten"] = {
        "numbers": {"km": 2, "vmax": 100},
        "authority": "Hyperbolic curve with Vmax 100 umol/min; Km 2 mM is the "
        "substrate giving half-maximal velocity. Low Km means high affinity "
        "(half-saturated early); Vmax is reached only at saturating substrate."}


def c_lb(out):
    x = np.linspace(-0.4, 1.0, 200)
    f, a = fig()
    a.plot(x, 0.01 + 0.02 * x, color=PRUSSIAN, lw=3, label="No inhibitor")
    a.plot(x, 0.01 + 0.06 * x, color=BAD, lw=2.5,
           label="Competitive: same y-intercept (Vmax kept)")
    a.plot(x, 0.022 + 0.02 * x, color=OK, lw=2.5,
           label="Noncompetitive: same x-intercept (Km kept)")
    a.plot(x, 0.018 + 0.036 * x, color=AMBER_D, lw=2.5,
           label="Uncompetitive: parallel line")
    a.axhline(0, color=INK, lw=1); a.axvline(0, color=INK, lw=1)
    a.text(0.02, 0.011, "1/Vmax", fontsize=11)
    a.text(-0.38, 0.004, "-1/Km", fontsize=11)
    a.set_xlim(-0.45, 1.0); a.set_ylim(-0.005, 0.075)
    a.set_xlabel("1/[S]"); a.set_ylabel("1/V")
    a.set_title("Lineweaver-Burk plots: inhibitor patterns")
    a.legend(fontsize=10.5)
    save(f, out, "lineweaver-burk")
    DATA["lineweaver-burk"] = {
        "numbers": {},
        "authority": "Competitive inhibitors meet the control on the y-axis "
        "(Vmax unchanged, Km up: statins vs HMG-CoA). Noncompetitive meet on "
        "the x-axis (Km unchanged, Vmax down). Uncompetitive lines run "
        "parallel (both Km and Vmax down)."}


def c_titration(out):
    ph = np.linspace(0, 14, 500)
    # Glycine: cation <-> zwitterion (pKa1 2.34) <-> anion (pKa2 9.6).
    oh = 2 / (1 + 10 ** (2.34 - ph)) + 1 / (1 + 10 ** (9.6 - ph))
    oh = np.clip(oh - 1, 0, 1)
    f, a = fig()
    a.plot(oh, ph, color=PRUSSIAN, lw=3)
    for x, y, lab in [(0.0, 2.34, "pKa1 2.34"), (1.0, 9.6, "pKa2 9.6"),
                      (0.5, 5.97, "pI 5.97")]:
        a.plot(x, y, marker="o", ms=9, color=BAD)
        a.text(x + 0.03, y + 0.25, lab, fontsize=12, weight="bold", color=BAD)
    a.text(0.5, 1.2, "Zwitterion dominates\nbetween the pKas", ha="center",
           fontsize=11, bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(-0.05, 1.05); a.set_ylim(0, 14)
    a.set_xlabel("OH- added (equivalents)"); a.set_ylabel("pH")
    a.set_title("Glycine titration: pKa1 2.34, pI 5.97, pKa2 9.6")
    save(f, out, "amino-titration")
    DATA["amino-titration"] = {
        "numbers": {"pka1": 2.34, "pka2": 9.6, "pi": 5.97},
        "authority": "Glycine buffers at pH 2.34 (carboxyl) and 9.6 (amino); "
        "its isoelectric point pI = (2.34 + 9.6)/2 = 5.97, where it carries no "
        "net charge and barely migrates in electrophoresis."}


def c_melting(out):
    t = np.linspace(50, 105, 400)
    def melt(x, tm):
        return 1 + 0.38 / (1 + np.exp(-(x - tm) / 1.8))
    f, a = fig()
    a.plot(t, melt(t, 85), color=PRUSSIAN, lw=3, label="50% GC: Tm 85 C")
    a.plot(t, melt(t, 92), color=BAD, lw=2.5, label="65% GC: Tm 92 C")
    a.axvline(85, color=INK2, ls="--", lw=1.5)
    a.axvline(92, color=INK2, ls=":", lw=1.5)
    a.text(70, 1.30, "Hyperchromic shift:\nabsorbance jumps ~38%\non strand separation",
           fontsize=11, bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(50, 105); a.set_ylim(0.95, 1.45)
    a.set_xlabel("Temperature (C)"); a.set_ylabel("Relative absorbance 260 nm")
    a.set_title("DNA melting curves: GC-rich DNA melts hotter")
    a.legend(fontsize=11)
    save(f, out, "dna-melting")
    DATA["dna-melting"] = {
        "numbers": {"tm_50gc": 85, "tm_65gc": 92},
        "authority": "Tm is the temperature at which half the DNA is single "
        "stranded: 85 C at 50% GC vs 92 C at 65% GC, because G-C pairs have "
        "three hydrogen bonds vs two for A-T. Melting raises 260 nm "
        "absorbance ~38% (hyperchromicity)."}


def c_pcr(out):
    cyc = np.linspace(0, 40, 400)
    def amp(x, ct):
        return 0.05 + 10 / (1 + np.exp(-(x - ct - 4) / 1.6))
    f, a = fig()
    a.plot(cyc, amp(cyc, 22), color=BAD, lw=3, label="Sample A: Ct 22 (high load)")
    a.plot(cyc, amp(cyc, 28), color=PRUSSIAN, lw=3, label="Sample B: Ct 28 (low load)")
    a.axhline(1.0, color=INK2, ls="--", lw=1.5)
    a.text(32, 1.15, "Threshold", fontsize=11)
    for ct, col in [(22, BAD), (28, PRUSSIAN)]:
        a.axvline(ct, color=col, ls=":", lw=1.5)
    a.text(5, 6, "Exponential phase:\nproduct doubles\nper cycle", fontsize=11,
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(0, 40); a.set_ylim(0, 11)
    a.set_xlabel("Cycle number"); a.set_ylabel("Fluorescence")
    a.set_title("Real-time PCR: lower Ct means more starting template")
    a.legend(fontsize=11)
    save(f, out, "pcr-curve")
    DATA["pcr-curve"] = {
        "numbers": {"ct_A": 22, "ct_B": 28},
        "authority": "Sample A crosses threshold at cycle 22 vs 28 for B, so "
        "A started with roughly 2^6 = 64-fold more template (each ~3.3 cycles "
        "is a 10-fold difference). Ct is inverse to load; the plateau adds "
        "no quantitative information."}


def c_hbgel(out):
    f, a = fig()
    lanes = [("Normal adult", {"A": 97, "A2": 2.5, "F": 0.5}),
             ("Sickle trait", {"A": 60, "S": 38, "A2": 2}),
             ("Sickle disease", {"S": 90, "F": 8, "A2": 2}),
             ("Beta-thal major", {"F": 95, "A2": 5})]
    pos = {"A": 8.0, "F": 6.2, "S": 4.4, "A2": 2.2, "C": 1.2}
    cols = {"A": PRUSSIAN, "F": OK, "S": BAD, "A2": AMBER_D, "C": INK2}
    for i, (name, bands) in enumerate(lanes):
        a.text(i, 9.2, name, ha="center", fontsize=11, weight="bold")
        for hb, pct in bands.items():
            w = 0.15 + 0.5 * pct / 100
            a.add_patch(patches.Rectangle((i - w / 2, pos[hb] - 0.18), w, 0.36,
                                          facecolor=cols[hb], edgecolor=INK))
            if pct >= 5:
                a.text(i, pos[hb], "%s %g%%" % (hb, pct), ha="center",
                       va="center", fontsize=10, weight="bold", color="#ffffff")
            else:
                a.text(i + w / 2 + 0.06, pos[hb], "%s %g%%" % (hb, pct),
                       va="center", fontsize=10)
    a.set_xlim(-0.7, 3.7); a.set_ylim(0.5, 10.0)
    a.set_xticks([]); a.set_ylabel("Migration (alkaline gel, anode at top)")
    a.set_title("Haemoglobin electrophoresis patterns (schematic)")
    save(f, out, "hb-electrophoresis")
    DATA["hb-electrophoresis"] = {
        "numbers": {},
        "authority": "Normal adult: HbA ~97%, A2 ~2.5%, F <1%. Sickle trait "
        "shows A+S bands; sickle disease shows S with no A; beta-thalassaemia "
        "major shows mostly F with raised A2. HbS migrates slower than A on "
        "alkaline gel."}


def c_sanger(out):
    f, a = fig()
    x = np.arange(14)
    seq = ["A", "T", "G", "C", "A", "G", "C", "T", "G", "A", "C", "T", "G", "A"]
    cols = {"A": OK, "T": BAD, "G": INK2, "C": PRUSSIAN}
    for i, b in enumerate(seq):
        h = 8 + (i % 3)
        a.bar(i, h, width=0.7, color=cols[b], edgecolor=INK)
        a.text(i, h + 0.3, b, ha="center", fontsize=11, weight="bold")
    a.bar(7, 5, width=0.7, color=OK, alpha=0.55, edgecolor=INK)
    a.text(7, 11.6, "Position 8:\nA/T double peak\n(heterozygous variant)",
           ha="center", fontsize=11, color=BAD, weight="bold",
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlim(-1, 14); a.set_ylim(0, 14)
    a.set_xticks([]); a.set_ylabel("Signal")
    a.set_title("Sanger chromatogram: one heterozygous variant at position 8")
    save(f, out, "sanger-trace")
    DATA["sanger-trace"] = {
        "numbers": {"variant_position": 8},
        "authority": "Each position shows one tall peak (A green, T red, G "
        "black, C blue). Position 8 shows overlapping A and T peaks at half "
        "height: a heterozygous variant. Homozygous positions show a single "
        "clean peak."}


def c_pedigrees(out):
    f, (a1, a2, a3) = plt.subplots(1, 3, figsize=(12.7, 6.2))
    f.patch.set_facecolor(PAPER)
    for ax in (a1, a2, a3):
        ax.set_xlim(0, 10); ax.set_ylim(0, 10)
        ax.axis("off")

    def person(ax, x, y, male, filled):
        if male:
            ax.add_patch(patches.Rectangle((x - 0.5, y - 0.5), 1, 1,
                                           facecolor=INK if filled else "#ffffff",
                                           edgecolor=INK, lw=2))
        else:
            ax.add_patch(patches.Circle((x, y), 0.55,
                                        facecolor=INK if filled else "#ffffff",
                                        edgecolor=INK, lw=2))

    def mating(ax, x1, x2, y, kids):
        ax.plot([x1, x2], [y, y], color=INK, lw=2)
        mid = (x1 + x2) / 2
        ax.plot([mid, mid], [y, y - 1.2], color=INK, lw=2)
        ax.plot([kids[0][0], kids[-1][0]], [y - 1.2, y - 1.2], color=INK, lw=2)
        for kx, _, _ in kids:
            ax.plot([kx, kx], [y - 1.2, y - 1.7], color=INK, lw=2)

    # AD: affected father -> half the children, both sexes, every generation.
    a1.set_title("Autosomal dominant\n(vertical, 50% risk)", fontsize=12)
    person(a1, 3.5, 8, True, True); person(a1, 6.5, 8, False, False)
    kids = [(1.5, True, True), (3.8, False, False), (6.2, True, False), (8.5, False, True)]
    mating(a1, 3.5, 6.5, 8, kids)
    for kx, m, fl in kids:
        person(a1, kx, 5.8, m, fl)
    a1.text(5, 1.5, "e.g. Huntington,\nMarfan, APKD", ha="center", fontsize=11)
    # AR: carrier parents, 25% affected, horizontal.
    a2.set_title("Autosomal recessive\n(horizontal, 25% risk)", fontsize=12)
    person(a2, 3.5, 8, True, False); person(a2, 6.5, 8, False, False)
    a2.plot([3.5, 6.5], [8, 8], color=INK, lw=2)
    kids2 = [(1.5, True, False), (3.8, False, True), (6.2, True, False), (8.5, False, False)]
    mating(a2, 3.5, 6.5, 8, kids2)
    for kx, m, fl in kids2:
        person(a2, kx, 5.8, m, fl)
    a2.text(5, 1.5, "e.g. thalassaemia,\nCF, SMA", ha="center", fontsize=11)
    # XLR: carrier mother -> half the sons affected, no male-to-male.
    a3.set_title("X-linked recessive\n(males hit, no father-son)", fontsize=12)
    person(a3, 3.5, 8, True, False); person(a3, 6.5, 8, False, False)
    a3.add_patch(patches.Circle((6.5, 8), 0.2, facecolor=INK))
    kids3 = [(2.5, True, True), (5, False, False), (7.5, True, False)]
    mating(a3, 3.5, 6.5, 8, kids3)
    for kx, m, fl in kids3:
        person(a3, kx, 5.8, m, fl)
    a3.add_patch(patches.Circle((5, 5.8), 0.2, facecolor=INK))
    a3.text(5, 1.5, "e.g. haemophilia,\nDMD, G6PD", ha="center", fontsize=11)
    f.suptitle("Pedigree patterns: dominant vs recessive vs X-linked",
               fontsize=14, color=INK, weight="bold")
    save(f, out, "inheritance-pedigrees")
    DATA["inheritance-pedigrees"] = {
        "numbers": {"ad_risk": 50, "ar_risk": 25, "xlr_son_risk": 50},
        "authority": "Dominant: vertical transmission, 50% of children hit, "
        "male-to-male seen. Recessive: horizontal (one sibship), 25% risk, "
        "consanguinity raises risk. X-linked recessive: only males affected, "
        "carrier mothers pass to half their sons, never father to son."}


# ---------------- ss-biostatistics ----------------

def c_sbs_2x2(out):
    tp, fn, fp, tn = 180, 20, 60, 740
    sens = tp / (tp + fn); spec = tn / (tn + fp)
    ppv = tp / (tp + fp); npv = tn / (tn + fn)
    f, a = fig(short=True); a.axis("off")
    a.set_title("GeneXpert vs culture for TB (n=%d)" % (tp + fn + fp + tn), pad=18)
    tab = [["", "TB +", "TB -", "Total"],
           ["Xpert +", str(tp), str(fp), str(tp + fp)],
           ["Xpert -", str(fn), str(tn), str(fn + tn)],
           ["Total", str(tp + fn), str(fp + tn), str(tp + fn + fp + tn)]]
    t = a.table(cellText=tab, loc="center", colWidths=[0.22, 0.22, 0.22, 0.22])
    t.auto_set_font_size(False); t.set_fontsize(14); t.scale(1, 2.2)
    for (r, c), cell in t.get_celld().items():
        cell.set_edgecolor(INK)
        if r == 0 or c == 0:
            cell.set_facecolor(PRUSSIAN)
            cell.set_text_props(color="#ffffff", weight="bold")
        elif (r, c) == (1, 1):
            cell.set_facecolor("#dcebe1")
        elif (r, c) == (2, 2):
            cell.set_facecolor("#dcebe1")
    a.text(0.5, 0.06, "Compute sensitivity, specificity, PPV and NPV.",
           ha="center", fontsize=12, color=INK2, transform=a.transAxes)
    save(f, out, "sbs-2x2")
    DATA["sbs-2x2"] = {"numbers": {"tp": tp, "fn": fn, "fp": fp, "tn": tn,
        "sensitivity": round(sens, 3), "specificity": round(spec, 3),
        "ppv": round(ppv, 3), "npv": round(npv, 3)},
        "authority": "Sensitivity 180/200 = 90.0%%; specificity 740/800 = "
        "92.5%%; PPV 180/240 = 75.0%%; NPV 740/760 = 97.4%%."}


def c_sbs_roc(out):
    fpr = [0.00, 0.04, 0.10, 0.18, 0.30, 0.45, 0.62, 0.80, 1.00]
    tpr = [0.00, 0.38, 0.58, 0.72, 0.82, 0.89, 0.94, 0.97, 1.00]
    auc = float(np.trapezoid(tpr, fpr))
    f, a = fig()
    a.plot(fpr, tpr, color=PRUSSIAN, lw=3, label="qSOFA for sepsis (AUC %.2f)" % auc)
    a.plot([0, 1], [0, 1], color=INK2, ls="--", lw=2, label="Useless test (AUC 0.50)")
    a.plot(0.18, 0.72, marker="o", ms=10, color=BAD)
    a.text(0.20, 0.65, "Operating point:\nFPR 18%, TPR 72%", fontsize=11,
           color=BAD, weight="bold")
    a.set_xlabel("False positive rate (1 - specificity)")
    a.set_ylabel("True positive rate (sensitivity)")
    a.set_title("ROC curve: qSOFA for sepsis prediction")
    a.set_xlim(0, 1); a.set_ylim(0, 1); a.legend(fontsize=11, loc="lower right")
    save(f, out, "sbs-roc")
    DATA["sbs-roc"] = {"numbers": {"fpr": fpr, "tpr": tpr, "auc": round(auc, 2)},
        "authority": "AUC %.2f (good test); the marked operating point gives "
        "sensitivity 72%% at 82%% specificity. A higher cutoff trades "
        "sensitivity for specificity along the same curve." % auc}


def c_sbs_forest(out):
    trials = [("Mehta 2022", 0.66, 0.48, 0.91), ("Rao 2023", 0.79, 0.58, 1.08),
              ("Singh 2023", 0.58, 0.40, 0.84), ("Nair 2024", 0.88, 0.64, 1.21),
              ("Bose 2025", 0.72, 0.55, 0.94)]
    pooled, plo, phi = 0.71, 0.60, 0.84
    f, a = fig()
    ys = list(range(len(trials), 0, -1))
    for (nm, or_, lo, hi), y in zip(trials, ys):
        a.plot([lo, hi], [y, y], color=INK, lw=2)
        a.plot(or_, y, marker="s", ms=10, color=PRUSSIAN)
        a.text(2.15, y, "%.2f (%.2f-%.2f)" % (or_, lo, hi), va="center", fontsize=11)
    a.plot([pooled - 0.12, pooled, pooled + 0.12, pooled, pooled - 0.12],
           [0.35, 0.55, 0.35, 0.15, 0.35], color=BAD, lw=2)
    a.fill([pooled - 0.12, pooled, pooled + 0.12, pooled], [0.35, 0.55, 0.35, 0.15],
           color=BAD, alpha=0.5)
    a.text(2.15, 0.35, "%.2f (%.2f-%.2f) pooled" % (pooled, plo, phi),
           va="center", fontsize=11, weight="bold")
    a.axvline(1.0, color=INK2, ls="--", lw=1.5)
    a.set_xlim(0.3, 2.9); a.set_ylim(0, len(trials) + 1)
    a.set_yticks(ys + [0.35]); a.set_yticklabels([t[0] for t in trials] + ["Pooled"])
    a.set_xlabel("Odds ratio (log scale)")
    a.set_title("Forest plot: ORS + zinc vs ORS alone for diarrhoea recovery (OR < 1 favours zinc)")
    a.text(0.5, len(trials) + 0.55, "Favours zinc", fontsize=11, color=OK, weight="bold")
    a.text(1.7, len(trials) + 0.55, "Favours ORS alone", fontsize=11, color=BAD, weight="bold")
    save(f, out, "sbs-forest")
    DATA["sbs-forest"] = {"numbers": {"trials": [{"name": n, "or": o, "lo": l, "hi": h}
        for n, o, l, h in trials], "pooled": pooled, "pooled_lo": plo, "pooled_hi": phi},
        "authority": "Pooled odds ratio 0.71 (95%% CI 0.60-0.84) favours adding "
        "zinc; Rao 2023 and Nair 2024 cross the null (OR 1.0) so are "
        "individually non-significant."}


def c_sbs_km(out):
    t = [0, 4, 8, 12, 16, 20, 24]
    trt = [100, 97, 94, 91, 88, 85, 82]
    ctl = [100, 93, 86, 79, 73, 68, 64]
    f, a = fig()
    a.step(t, trt, where="post", color=OK, lw=3, label="DOTS-plus (n=310)")
    a.step(t, ctl, where="post", color=BAD, lw=3, label="Standard DOTS (n=305)")
    for x, y in [(8, 94), (16, 88)]:
        a.plot(x, y, marker="|", ms=14, mew=2.5, color=OK)
    for x, y in [(12, 79), (20, 68)]:
        a.plot(x, y, marker="|", ms=14, mew=2.5, color=BAD)
    a.set_xlabel("Months since treatment start"); a.set_ylabel("Cure without relapse (%)")
    a.set_title("Kaplan-Meier: DOTS-plus vs standard DOTS for MDR-TB (+ = censored)")
    a.set_xlim(0, 24); a.set_ylim(55, 102); a.legend(fontsize=11)
    a.annotate("24-mo cure\n82% vs 64%", xy=(24, 73), xytext=(15, 63),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12,
               bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    save(f, out, "sbs-km")
    DATA["sbs-km"] = {"numbers": {"months": t, "treatment": trt, "control": ctl},
        "authority": "Curves separate from month 4 and stay apart: 24-month "
        "cure without relapse 82% (DOTS-plus) vs 64% (standard); ticks mark "
        "censored patients (lost or still in follow-up)."}


def c_sbs_normal(out):
    mu, sd = 13.5, 1.5
    x = np.linspace(8, 19, 400)
    from math import erf, sqrt
    pdf = np.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * sqrt(2 * 3.14159265358979))
    anaem = 0.5 * (1 + erf((12 - mu) / (sd * sqrt(2))))
    f, a = fig()
    a.plot(x, pdf, color=PRUSSIAN, lw=3)
    a.fill_between(x, pdf, where=(x < 12), color=BAD, alpha=0.35,
                   label="Anaemia (<12 g/dL)")
    for k, c in [(-1, AMBER_D), (0, OK), (1, AMBER_D)]:
        a.axvline(mu + k * sd, color=c, ls="--" if k else "-", lw=2)
    a.text(mu, max(pdf) * 0.9, "Mean = Median = Mode\n= 13.5 g/dL", ha="center",
           fontsize=12, bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlabel("Haemoglobin (g/dL)"); a.set_ylabel("Proportion")
    a.set_title("Normal distribution: adult haemoglobin (mean 13.5, SD 1.5)")
    a.legend(loc="upper left", fontsize=11)
    save(f, out, "sbs-normal")
    DATA["sbs-normal"] = {"numbers": {"mean": mu, "sd": sd, "cutoff": 12,
        "below_fraction": round(float(anaem), 3)},
        "authority": "Normal curve: mean = median = mode = 13.5 g/dL; "
        "anaemia (<12 g/dL) is 15.9%% of adults (z = -1.0). About 68%% lie "
        "within 1 SD (12.0-15.0) and 95%% within 2 SD."}


def c_sbs_pvalue(out):
    from math import sqrt
    x = np.linspace(-4, 4, 500)
    pdf = np.exp(-0.5 * x ** 2) / sqrt(2 * 3.14159265358979)
    f, a = fig()
    a.plot(x, pdf, color=PRUSSIAN, lw=3)
    a.fill_between(x, pdf, where=(np.abs(x) > 1.96), color=BAD, alpha=0.35,
                   label="Rejection region (alpha 5%, two-tailed)")
    a.axvline(2.17, color=OK, lw=3)
    a.text(2.2, 0.30, "Observed z = 2.17\np = 0.03: reject H0", fontsize=12,
           color=OK, weight="bold")
    a.set_xlim(-4, 4); a.set_ylim(0, 0.45)
    a.set_xlabel("Test statistic (z)"); a.set_ylabel("Density")
    a.set_title("p-value logic: 5% significance, two-tailed")
    a.legend(fontsize=11)
    save(f, out, "sbs-pvalue")
    DATA["sbs-pvalue"] = {"numbers": {"alpha": 0.05, "z_crit": 1.96,
        "z_obs": 2.17, "p": 0.03},
        "authority": "At alpha 5%% two-tailed, |z| beyond 1.96 rejects the "
        "null. Observed z = 2.17 (p = 0.03) falls in the rejection region, so "
        "the result is statistically significant; p is the chance of data "
        "this extreme if the null were true."}


# ---------------- ENT audiograms ----------------

FREQS = [125, 250, 500, 1000, 2000, 4000, 8000]


def audio_base(title):
    f, a = fig()
    a.set_xscale("log")
    a.set_xticks(FREQS); a.set_xticklabels(["125", "250", "500", "1k", "2k", "4k", "8k"])
    a.set_xlim(100, 10000)
    a.set_ylim(-15, 125); a.invert_yaxis()
    a.axhspan(-15, 25, color=OK, alpha=0.12)
    a.text(9000, 8, "Normal <= 25 dB", ha="right", fontsize=11, color=OK)
    a.grid(True, which="both", color=EDGE, lw=1)
    a.set_xlabel("Frequency (Hz)"); a.set_ylabel("Hearing level (dB HL)")
    a.set_title(title)
    return f, a


def audio_trace(a, air_r, air_l, bone_r, bone_l):
    a.plot(FREQS, air_r, color=BAD, lw=2, marker="o", ms=9, mfc="none",
           mew=2.5, label="Right air (O)")
    a.plot(FREQS, air_l, color=PRUSSIAN, lw=2, marker="x", ms=9, mew=2.5,
           label="Left air (X)")
    a.plot(FREQS, bone_r, color=BAD, lw=1.5, ls="--", marker="<", ms=9,
           label="Right bone (<)")
    a.plot(FREQS, bone_l, color=PRUSSIAN, lw=1.5, ls="--", marker=">", ms=9,
           label="Left bone (>)")


def c_audio_normal(out):
    f, a = audio_base("Normal audiogram: all thresholds 0-20 dB, no air-bone gap")
    air = [10, 10, 5, 10, 5, 10, 15]
    audio_trace(a, air, [x + 5 for x in air], air, [x + 5 for x in air])
    a.legend(fontsize=10, loc="lower right")
    save(f, out, "audio-normal")
    DATA["audio-normal"] = {"numbers": {"thresholds_db": air},
        "authority": "All air and bone thresholds 0-20 dB in both ears with "
        "no air-bone gap: normal hearing. Thresholds at or below 25 dB HL "
        "are normal at every frequency."}


def c_audio_conductive(out):
    f, a = audio_base("Conductive loss (otosclerosis, right ear): 30 dB air-bone gap")
    air_r = [45, 45, 50, 45, 45, 40, 40]
    bone_r = [15, 15, 15, 10, 20, 15, 15]
    air_l = [10, 10, 10, 10, 10, 10, 15]
    bone_l = [10, 10, 10, 10, 10, 10, 15]
    audio_trace(a, air_r, air_l, bone_r, bone_l)
    a.annotate("Air-bone gap ~30 dB", xy=(1000, 30), xytext=(2500, 55),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12,
               color=BAD, weight="bold")
    a.text(2000, 23, "Carhart notch\nat 2 kHz", ha="center", fontsize=10,
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.legend(fontsize=10, loc="lower right")
    save(f, out, "audio-conductive")
    DATA["audio-conductive"] = {"numbers": {"gap_db": 30},
        "authority": "Right ear: air thresholds ~45 dB with bone ~15 dB, an "
        "air-bone gap of 30 dB with a Carhart notch (bone dip at 2 kHz): "
        "conductive loss from otosclerosis (fixed stapes). Rinne negative on "
        "the right, Weber lateralises right."}


def c_audio_snhl(out):
    f, a = audio_base("Sensorineural loss (presbycusis): downsloping, no gap")
    air = [15, 15, 20, 25, 40, 55, 65]
    audio_trace(a, air, [x + 5 for x in air], air, [x + 5 for x in air])
    a.annotate("High frequencies fall;\nair equals bone", xy=(4000, 55),
               xytext=(900, 85),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12,
               color=BAD, weight="bold")
    a.legend(fontsize=10, loc="lower right")
    save(f, out, "audio-snhl")
    DATA["audio-snhl"] = {"numbers": {},
        "authority": "Bilateral downsloping high-frequency loss with air "
        "equal to bone (no gap): sensorineural loss of presbycusis (ageing). "
        "Rinne positive both sides, Weber midline; hearing aid is the "
        "management."}


def c_audio_noise(out):
    f, a = audio_base("Noise-induced loss: 4 kHz notch, recovery at 8 kHz")
    air = [10, 10, 15, 15, 25, 50, 30]
    audio_trace(a, air, [x + 5 for x in air], air, [x + 5 for x in air])
    a.annotate("4 kHz notch", xy=(4000, 50), xytext=(1200, 75),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12,
               color=BAD, weight="bold")
    a.legend(fontsize=10, loc="lower right")
    save(f, out, "audio-noise")
    DATA["audio-noise"] = {"numbers": {"notch_hz": 4000},
        "authority": "Bilateral symmetric dip worst at 4 kHz with recovery at "
        "8 kHz and no air-bone gap: noise-induced sensorineural loss. "
        "Prevention is ear protection; established loss is permanent."}


CHARTS = [("michaelis-menten", c_mm, "bio-enzymes"),
          ("lineweaver-burk", c_lb, "bio-enzymes"),
          ("amino-titration", c_titration, "bio-protein-structure"),
          ("dna-melting", c_melting, "bio-nucleotides"),
          ("pcr-curve", c_pcr, "bio-recombinant-techniques"),
          ("hb-electrophoresis", c_hbgel, "bio-haemoglobin"),
          ("sanger-trace", c_sanger, "bio-recombinant-techniques"),
          ("inheritance-pedigrees", c_pedigrees, "bio-genetics"),
          ("sbs-2x2", c_sbs_2x2, "sbs-diagnostic-tests"),
          ("sbs-roc", c_sbs_roc, "sbs-diagnostic-tests"),
          ("sbs-forest", c_sbs_forest, "sbs-trials-ebm"),
          ("sbs-km", c_sbs_km, "sbs-regression-survival"),
          ("sbs-normal", c_sbs_normal, "sbs-descriptive-probability"),
          ("sbs-pvalue", c_sbs_pvalue, "sbs-hypothesis-tests"),
          ("audio-normal", c_audio_normal, "ent-hearing-tests"),
          ("audio-conductive", c_audio_conductive, "ent-hearing-tests"),
          ("audio-snhl", c_audio_snhl, "ent-snhl-inner-ear"),
          ("audio-noise", c_audio_noise, "ent-snhl-inner-ear")]


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

