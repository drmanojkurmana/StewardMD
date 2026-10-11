#!/usr/bin/env python3
"""tools/prep-psm-charts.py - Draw PrepNucleus PSM teaching charts (deterministic matplotlib).

Twelve charts in the app palette (paper #f3f2ee, ink #13203d, prussian #0f3460,
amber, ok/bad greens/reds): epidemic curve, normal + skewed distributions, forest
plot, funnel plot, Kaplan-Meier survival, ROC, screening 2x2, Kuppuswamy scale,
BMI scale, demographic pyramid, cold chain diagram.

Every number is embedded below and re-emitted to chart-data.json (exact values +
authority strings for MCQ generation). Nothing is random: re-running produces
byte-comparable PNGs (modulo matplotlib version).

Usage: MPLCONFIGDIR=/tmp/mplcache python3 tools/prep-psm-charts.py --out /tmp/imgint-psm/charts
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

DATA = {}  # chart -> {"numbers": {...}, "authority": "..."}

def fig(short=False):
    f, a = plt.subplots(figsize=(12.7, 6.2 if short else 8.2))
    return f, a

def save(f, out, name):
    p = os.path.join(out, name + ".png")
    f.savefig(p, bbox_inches="tight")
    plt.close(f)
    return p

def c_epi(out):
    weeks = list(range(1, 13))
    cases = [1, 3, 8, 15, 28, 22, 35, 30, 18, 10, 4, 2]  # successive higher peaks
    total, peak_w, peak_c = sum(cases), 7, 35
    f, a = fig()
    a.bar(weeks, cases, color=PRUSSIAN, edgecolor=INK, width=0.8)
    a.set_xlabel("Week of outbreak"); a.set_ylabel("Cases")
    a.set_title("Epidemic curve: outbreak, Village Rampur (n=%d)" % total)
    a.set_xticks(weeks); a.annotate("Peak: week 7 (%d cases)" % peak_c, xy=(7, 35),
        xytext=(8.6, 30), arrowprops={"arrowstyle": "->", "color": INK},
        fontsize=12, color=BAD, weight="bold")
    save(f, out, "epi-curve")
    DATA["epi-curve"] = {"numbers": {"weeks": weeks, "cases": cases, "total": total,
        "peak_week": peak_w, "peak_cases": peak_c},
        "authority": "Propagated (person-to-person) outbreak: successive peaks rise (28 then 35), "
        "peak week 7 with 35 cases, total 176 cases over 12 weeks."}

def c_normal(out):
    mu, sd = 2800, 450
    x = np.linspace(1200, 4400, 400)
    from math import erf, sqrt
    pdf = np.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * sqrt(2 * 3.14159265358979))
    lbw = 0.5 * (1 + erf((2500 - mu) / (sd * sqrt(2))))  # P(X < 2500)
    f, a = fig()
    a.plot(x, pdf, color=PRUSSIAN, lw=3)
    a.fill_between(x, pdf, where=(x < 2500), color=BAD, alpha=0.35, label="Low birth weight (<2500 g)")
    for k, c in [(-1, AMBER_D), (0, OK), (1, AMBER_D)]:
        a.axvline(mu + k * sd, color=c, ls="--" if k else "-", lw=2)
    a.text(mu, max(pdf) * 0.9, "Mean = Median = Mode\n= 2800 g", ha="center", fontsize=12,
           bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    a.set_xlabel("Birth weight (g)"); a.set_ylabel("Proportion")
    a.set_title("Normal distribution: birth weights (mean 2800 g, SD 450 g)")
    a.legend(loc="upper left", fontsize=11)
    save(f, out, "normal-dist")
    DATA["normal-dist"] = {"numbers": {"mean": mu, "sd": sd, "lbw_cutoff": 2500,
        "lbw_fraction": round(float(lbw), 3)},
        "authority": "Normal curve: mean = median = mode = 2800 g; low birth weight "
        "(<2500 g) is 25.2% of births (z = -0.67)."}

def c_skew(out):
    days = list(range(1, 11))
    cases = [2, 8, 35, 55, 42, 30, 22, 14, 8, 4]  # mean 5.05 > median 5 > mode 4
    total = sum(cases)
    mean = sum(d * c for d, c in zip(days, cases)) / total
    cum, med = 0, None
    for d, c in zip(days, cases):
        cum += c
        if med is None and cum >= (total + 1) / 2: med = d
    mode = days[cases.index(max(cases))]
    f, a = fig()
    a.bar(days, cases, color=PRUSSIAN, edgecolor=INK, width=0.8)
    a.axvline(mean, color=BAD, lw=2.5, label="Mean %.1f days" % mean)
    a.axvline(med, color=OK, lw=2.5, ls="--", label="Median %d days" % med)
    a.axvline(mode, color=AMBER_D, lw=2.5, ls=":", label="Mode %d days" % mode)
    a.set_xlabel("Incubation period (days)"); a.set_ylabel("Cases")
    a.set_title("Right-skewed distribution: incubation periods (n=%d)" % total)
    a.set_xticks(days); a.legend(fontsize=11)
    save(f, out, "skewed-dist")
    DATA["skewed-dist"] = {"numbers": {"days": days, "cases": cases, "total": total,
        "mean": round(mean, 2), "median": med, "mode": mode},
        "authority": "Right (positive) skew with a long right tail: mean (%.2f days) > "
        "median (%d days) > mode (%d days); median is the preferred average." % (mean, med, mode)}

def c_forest(out):
    trials = [("Sharma 2021", 0.72, 0.55, 0.94), ("Verma 2022", 0.81, 0.62, 1.06),
              ("Iyer 2023", 0.65, 0.48, 0.88), ("Khan 2023", 0.93, 0.70, 1.24),
              ("Das 2024", 0.78, 0.60, 1.01)]
    pooled, plo, phi = 0.78, 0.68, 0.89
    f, a = fig()
    ys = list(range(len(trials), 0, -1))
    for (nm, or_, lo, hi), y in zip(trials, ys):
        a.plot([lo, hi], [y, y], color=INK, lw=2)
        a.plot(or_, y, marker="s", ms=10, color=PRUSSIAN)
        a.text(2.15, y, "%.2f (%.2f-%.2f)" % (or_, lo, hi), va="center", fontsize=11)
    a.plot([pooled - 0.11, pooled, pooled + 0.11, pooled, pooled - 0.11],
           [0.35, 0.55, 0.35, 0.15, 0.35], color=BAD, lw=2)
    a.fill([pooled - 0.11, pooled, pooled + 0.11, pooled], [0.35, 0.55, 0.35, 0.15],
           color=BAD, alpha=0.5)
    a.text(2.15, 0.35, "%.2f (%.2f-%.2f) pooled" % (pooled, plo, phi), va="center",
           fontsize=11, weight="bold")
    a.axvline(1.0, color=INK2, ls="--", lw=1.5)
    a.set_xlim(0.35, 2.9); a.set_ylim(0, len(trials) + 1)
    a.set_yticks(ys + [0.35]); a.set_yticklabels([t[0] for t in trials] + ["Pooled"])
    a.set_xlabel("Odds ratio (log scale)")
    a.set_title("Forest plot: zinc vs placebo for diarrhoea duration (OR < 1 favours zinc)")
    a.text(0.55, len(trials) + 0.55, "Favours zinc", fontsize=11, color=OK, weight="bold")
    a.text(1.7, len(trials) + 0.55, "Favours placebo", fontsize=11, color=BAD, weight="bold")
    save(f, out, "forest-plot")
    DATA["forest-plot"] = {"numbers": {"trials": [{"name": n, "or": o, "lo": l, "hi": h}
        for n, o, l, h in trials], "pooled": pooled, "pooled_lo": plo, "pooled_hi": phi},
        "authority": "Pooled odds ratio 0.78 (95% CI 0.68-0.89) favours zinc; Verma 2022 and "
        "Khan 2023 cross the null (OR 1.0) so are individually non-significant."}

def c_funnel(out):
    se = [0.10, 0.12, 0.14, 0.16, 0.18, 0.22, 0.26, 0.30, 0.34, 0.38, 0.44, 0.50]
    logor = [-0.30, -0.26, -0.33, -0.22, -0.28, -0.35, -0.18, -0.40, -0.12, -0.45, -0.20, -0.38]
    f, a = fig()
    a.scatter(logor, se, s=90, color=PRUSSIAN, edgecolor=INK, zorder=3)
    xs = np.linspace(-0.7, 0.2, 100)
    a.plot(xs, 0.10 + 1.2 * np.abs(xs + 0.28), color=INK2, ls="--", lw=1.5)
    a.axvline(-0.28, color=BAD, lw=2)
    a.set_xlabel("log odds ratio (negative = treatment better)")
    a.set_ylabel("Standard error (precision falls downwards)")
    a.set_title("Funnel plot: 12 trials of zinc for diarrhoea")
    a.text(0.02, 0.40, "Gap: small studies with\nnull/negative effects\nare missing", fontsize=12,
           color=BAD, weight="bold", bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    save(f, out, "funnel-plot")
    DATA["funnel-plot"] = {"numbers": {"n_studies": 12, "pooled_logor": -0.28},
        "authority": "Asymmetric funnel with a gap at the bottom right (small imprecise studies "
        "with null or negative effects are missing): publication bias suspected."}

def c_km(out):
    t = [0, 4, 8, 12, 16, 20, 24]
    trt = [100, 96, 92, 88, 84, 80, 76]
    ctl = [100, 90, 82, 74, 66, 58, 50]
    f, a = fig()
    a.step(t, trt, where="post", color=OK, lw=3, label="New regimen (n=210)")
    a.step(t, ctl, where="post", color=BAD, lw=3, label="Standard regimen (n=208)")
    for x, y in [(8, 92), (16, 84)]: a.plot(x, y, marker="|", ms=14, mew=2.5, color=OK)
    for x, y in [(12, 74), (20, 58)]: a.plot(x, y, marker="|", ms=14, mew=2.5, color=BAD)
    a.set_xlabel("Months since randomisation"); a.set_ylabel("Survival (%)")
    a.set_title("Kaplan-Meier survival: new vs standard TB regimen (+ = censored)")
    a.set_xlim(0, 24); a.set_ylim(40, 102); a.legend(fontsize=11)
    a.annotate("24-mo survival\n76% vs 50%", xy=(24, 63), xytext=(15, 52),
               arrowprops={"arrowstyle": "->", "color": INK}, fontsize=12,
               bbox={"facecolor": "#ffffff", "edgecolor": EDGE})
    save(f, out, "km-survival")
    DATA["km-survival"] = {"numbers": {"months": t, "treatment": trt, "control": ctl},
        "authority": "Curves separate after 4 months and stay apart: 24-month survival 76% "
        "(new regimen) vs 50% (standard); ticks mark censored patients."}

def c_roc(out):
    fpr = [0.00, 0.05, 0.12, 0.22, 0.35, 0.50, 0.68, 0.85, 1.00]
    tpr = [0.00, 0.42, 0.63, 0.76, 0.85, 0.91, 0.95, 0.98, 1.00]
    auc = float(np.trapezoid(tpr, fpr))
    f, a = fig()
    a.plot(fpr, tpr, color=PRUSSIAN, lw=3, label="HbA1c >= 6.5%% (AUC %.2f)" % auc)
    a.plot([0, 1], [0, 1], color=INK2, ls="--", lw=2, label="Useless test (AUC 0.50)")
    a.plot(0.12, 0.63, marker="o", ms=10, color=BAD)
    a.text(0.14, 0.57, "Operating point:\nFPR 12%, TPR 63%", fontsize=11, color=BAD, weight="bold")
    a.set_xlabel("False positive rate (1 - specificity)")
    a.set_ylabel("True positive rate (sensitivity)")
    a.set_title("ROC curve: HbA1c for diabetes screening")
    a.set_xlim(0, 1); a.set_ylim(0, 1); a.legend(fontsize=11, loc="lower right")
    save(f, out, "roc-curve")
    DATA["roc-curve"] = {"numbers": {"fpr": fpr, "tpr": tpr, "auc": round(auc, 2)},
        "authority": "AUC %.2f (good test; 1.0 is perfect, 0.5 is useless); the curve bows to "
        "the top-left and the marked operating point gives sensitivity 63%% at 88%% "
        "specificity." % auc}

def c_2x2(out):
    tp, fn, fp, tn = 90, 10, 80, 820
    sens = tp / (tp + fn); spec = tn / (tn + fp)
    ppv = tp / (tp + fp); npv = tn / (tn + fn)
    f, a = fig(short=True); a.axis("off")
    a.set_title("Screening test vs gold standard (n=%d)" % (tp + fn + fp + tn), pad=18)
    tab = [["", "Disease +", "Disease -", "Total"],
           ["Test +", str(tp), str(fp), str(tp + fp)],
           ["Test -", str(fn), str(tn), str(fn + tn)],
           ["Total", str(tp + fn), str(fp + tn), str(tp + fn + fp + tn)]]
    t = a.table(cellText=tab, loc="center", colWidths=[0.22, 0.22, 0.22, 0.22])
    t.auto_set_font_size(False); t.set_fontsize(14); t.scale(1, 2.2)
    for (r, c), cell in t.get_celld().items():
        cell.set_edgecolor(INK)
        if r == 0 or c == 0: cell.set_facecolor(PRUSSIAN); cell.set_text_props(color="#ffffff", weight="bold")
        elif (r, c) == (1, 1): cell.set_facecolor("#dcebe1")
        elif (r, c) == (2, 2): cell.set_facecolor("#dcebe1")
    a.text(0.5, 0.06, "Compute sensitivity, specificity, PPV and NPV from this table.",
           ha="center", fontsize=12, color=INK2, transform=a.transAxes)
    save(f, out, "screen-2x2")
    DATA["screen-2x2"] = {"numbers": {"tp": tp, "fn": fn, "fp": fp, "tn": tn,
        "sensitivity": round(sens, 3), "specificity": round(spec, 3),
        "ppv": round(ppv, 3), "npv": round(npv, 3)},
        "authority": "Sensitivity 90/(90+10) = 90.0%%; specificity 820/(820+80) = 91.1%%; "
        "PPV 90/(90+80) = 52.9%%; NPV 820/(820+10) = 98.8%%."}

def c_kuppu(out):
    rows = [["Education", "Occupation", "Monthly family income (2025)", "Score"],
            ["Profession / Honours", "Legislators, managers", ">= Rs 1,23,321", "7 / 10 / 12"],
            ["Graduate", "Professionals", "Rs 61,661 - 1,23,320", "6 / 9 / 10"],
            ["Higher secondary", "Technicians", "Rs 46,095 - 61,660", "5 / 8 / 6"],
            ["High school", "Clerks", "Rs 30,830 - 46,094", "4 / 7 / 4"],
            ["Middle school", "Skilled workers", "Rs 18,498 - 30,829", "3 / 6 / 3"],
            ["Primary school", "Machine operators", "Rs 6,175 - 18,497", "2 / 5 / 2"],
            ["Illiterate", "Elementary / unemployed", "< Rs 6,175", "1 / 1 / 1"]]
    classes = "Total 26-29 = Upper (I); 16-25 = Upper middle (II); 11-15 = Lower middle (III); 5-10 = Upper lower (IV); <5 = Lower (V)."
    f, a = fig(short=True); a.axis("off")
    a.set_title("Kuppuswamy socioeconomic scale (2025 CPI update)", pad=18)
    t = a.table(cellText=rows, loc="center", colWidths=[0.26, 0.26, 0.32, 0.14])
    t.auto_set_font_size(False); t.set_fontsize(10.5); t.scale(1, 1.9)
    for (r, c), cell in t.get_celld().items():
        cell.set_edgecolor(INK)
        if r == 0: cell.set_facecolor(PRUSSIAN); cell.set_text_props(color="#ffffff", weight="bold")
    a.text(0.5, 0.02, classes, ha="center", fontsize=11, color=INK,
           transform=a.transAxes, wrap=True)
    save(f, out, "kuppuswamy")
    DATA["kuppuswamy"] = {"numbers": {"bands": [r for r in rows[1:]], "classes": classes},
        "authority": "Kuppuswamy score = education (1-7) + occupation (1-10) + income (1-12); "
        "total 26-29 Upper (I), 16-25 Upper middle (II), 11-15 Lower middle (III), "
        "5-10 Upper lower (IV), below 5 Lower (V)."}

def c_bmi(out):
    f, a = fig()
    segs = [(13, 18.5, "#7fb3d5", "Underweight\n<18.5"), (18.5, 25, "#7dd3a0", "Normal\n18.5-24.9"),
            (25, 30, AMBER, "Overweight\n25-29.9"), (30, 42, "#e8837a", "Obese\n>=30")]
    for lo, hi, col, lab in segs:
        a.barh(0, hi - lo, left=lo, height=0.55, color=col, edgecolor=INK)
        a.text((lo + hi) / 2, 0, lab, ha="center", va="center", fontsize=11, weight="bold")
    a.plot(27.3, 0, marker="v", ms=22, color=BAD)
    a.text(27.3, 0.62, "BMI 27.3", ha="center", fontsize=13, weight="bold", color=BAD)
    a.set_xlim(13, 42); a.set_ylim(-0.7, 1.0); a.set_yticks([])
    a.set_xlabel("Body mass index (kg/m2)")
    a.set_title("WHO adult BMI classification with one plotted adult")
    save(f, out, "bmi-scale")
    DATA["bmi-scale"] = {"numbers": {"cutoffs": [18.5, 25, 30], "plotted": 27.3,
        "plotted_class": "Overweight (pre-obese)"},
        "authority": "WHO classes: <18.5 underweight, 18.5-24.9 normal, 25-29.9 overweight "
        "(pre-obese), >=30 obese; the plotted adult at BMI 27.3 is overweight."}

def c_pyramid(out):
    bands = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44",
             "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75+"]
    m = [52, 50, 48, 45, 42, 39, 35, 31, 27, 23, 19, 15, 11, 8, 5, 4]
    fm = [50, 48, 46, 43, 40, 37, 33, 29, 25, 21, 17, 13, 10, 7, 5, 4]
    tot = sum(m) + sum(fm)
    young = sum(m[:3]) + sum(fm[:3])
    old = sum(m[13:]) + sum(fm[13:])
    dep = (young + old) / (tot - young - old) * 100
    f, a = fig()
    y = np.arange(len(bands))
    a.barh(y, [-v for v in m], height=0.9, color=PRUSSIAN, edgecolor=INK, label="Male")
    a.barh(y, fm, height=0.9, color=AMBER, edgecolor=INK, label="Female")
    a.set_yticks(y); a.set_yticklabels(bands)
    a.set_xlabel("Population (thousands)"); a.legend(fontsize=11)
    a.set_title("Age-sex pyramid: District Rampur, 2026 (total %d,000)" % tot)
    save(f, out, "demo-pyramid")
    DATA["demo-pyramid"] = {"numbers": {"bands": bands, "male": m, "female": fm,
        "total_thousands": tot, "dependency_ratio": round(dep, 1)},
        "authority": "Expansive pyramid with a broad base (high birth rate): 0-14 years are "
        "%d,000 of %d,000; young + old dependency ratio %.1f per 100 working-age." % (young, tot, dep)}

def c_cold(out):
    levels = [("State store", "Walk-in cooler/freezer", "Bulk stock"),
              ("District store", "Ice-lined refrigerator", "1 month stock"),
              ("PHC", "Ice-lined refrigerator", "2 weeks stock"),
              ("Subcentre / session", "Cold box + vaccine carrier", "1 day stock")]
    f, a = fig(); a.axis("off"); a.set_xlim(0, 12); a.set_ylim(0, 10)
    a.set_title("Vaccine cold chain: levels, equipment and +2C to +8C", pad=12)
    for i, (lv, eq, st) in enumerate(levels):
        y = 8 - i * 2
        box = patches.FancyBboxPatch((2.5, y - 0.7), 7, 1.4, boxstyle="round,pad=0.1",
                                     facecolor="#ffffff", edgecolor=PRUSSIAN, lw=2)
        a.add_patch(box)
        a.text(6, y + 0.25, lv, ha="center", fontsize=13, weight="bold")
        a.text(6, y - 0.3, "%s - %s" % (eq, st), ha="center", fontsize=11, color=INK2)
        if i < len(levels) - 1:
            a.annotate("", xy=(6, y - 1.15), xytext=(6, y - 0.85),
                       arrowprops={"arrowstyle": "->", "color": BAD, "lw": 2.5})
    a.text(0.6, 4.6, "+2C\nto\n+8C", fontsize=14, weight="bold", color=OK,
           bbox={"facecolor": "#e6f3eb", "edgecolor": OK})
    a.text(11.4, 4.6, "No\nfreezing\nof DPT/\nHepB", fontsize=10, color=BAD,
           bbox={"facecolor": "#fbeceb", "edgecolor": BAD})
    save(f, out, "cold-chain")
    DATA["cold-chain"] = {"numbers": {"levels": [l[0] for l in levels]},
        "authority": "Cold chain keeps vaccines at +2C to +8C from state store (walk-in "
        "cooler) to session site (vaccine carrier); freeze-sensitive DPT/HepB must never freeze."}

CHARTS = [("epi-curve", c_epi, "cm-outbreak-surveillance"),
          ("normal-dist", c_normal, "cm-central-tendency"),
          ("skewed-dist", c_skew, "cm-central-tendency"),
          ("forest-plot", c_forest, "cm-experimental"),
          ("funnel-plot", c_funnel, "cm-bias-causation"),
          ("km-survival", c_km, "cm-experimental"),
          ("roc-curve", c_roc, "cm-screening"),
          ("screen-2x2", c_2x2, "cm-screening"),
          ("kuppuswamy", c_kuppu, "cm-behavioural"),
          ("bmi-scale", c_bmi, "cm-diabetes-obesity"),
          ("demo-pyramid", c_pyramid, "cm-demography"),
          ("cold-chain", c_cold, "cm-vaccines-cold-chain")]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name, fn, mod in CHARTS:
        fn(args.out)
        DATA[name]["module"] = mod
        print("drew", name)
    with open(os.path.join(args.out, "chart-data.json"), "w") as h:
        json.dump(DATA, h, indent=1)
    print("charts:", len(CHARTS))

if __name__ == "__main__":
    main()

