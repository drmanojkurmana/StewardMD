/* StewardMD - ResearchMD canonical stats engine (window.SMD_RESEARCH_ENGINE).
 * Pure: no DOM, no Date, no Math.random, no I/O. ES5 only (var/function).
 * Dual export: browser global SMD_RESEARCH_ENGINE and CommonJS module.exports;
 * Pages Functions load it through functions/api/research/_engine.js (ESM wrapper).
 *
 * Univariate inverse-variance meta-analysis. Pinned reference calls (frozen in
 * docs/research/contracts/phase-1/reference-calls.md; any change is a reviewed
 * contract change):
 *  - escalc(measure=..., add=1/2, to="only0", drop00=TRUE) for OR/RR,
 *    drop00=FALSE for RD; SMD is Hedges' g (vtype="LS").
 *  - rma(yi, vi, method="FE" | "DL" | "REML") with
 *    control=list(stepadj=0.5, maxiter=1000); tau2 clamped at 0.
 *  - test="knha" (HKSJ) without truncation by default; the truncated variant
 *    (adhoc per Roever et al.) is also reported when the HKSJ CI is narrower
 *    than the Wald CI.
 *  - predict(rma_fit): t with k-2 df under test="knha", normal otherwise;
 *    not shown when k < 3.
 *
 * Ratio measures (OR, RR, HR) pool on the log scale: pooled.effect is a log
 * OR / log RR / log HR and display code exponentiates it. HR has no raw-count
 * form: it needs a reported effect (effect + CI at its own level, or log-HR
 * yi + se). RD keeps double-zero studies (1/2 correction, finite variance).
 * run() takes createdAt from the caller for the manifest and never calls Date.
 *
 * Phase 4 additions (contract: docs/research/contracts/phase-4/engine-api-4.md):
 *  - subgroup / leaveOneOut / sensitivity / egger / funnel take the same
 *    project shape as run(). Egger is regtest(fit, model="lm", predictor="sei")
 *    (OLS of yi on sei, t test on the intercept, k-2 df) and refuses k < 10.
 *    Subgroup differences use the fixed-effect between-group Q on the subgroup
 *    estimates (metafor rma(..., mods=~factor(g), method="FE") QM).
 *  - splitSharedControl / clusterAdjust / crossoverAdjust / medianToMean /
 *    rangeToMean are study-level helpers (Cochrane Handbook 23.3.4, 23.1.4,
 *    23.2.6; Wan et al. 2014 scenarios S2 and S1).
 */
(function (G) {
  "use strict";

  var VERSION = "rmd1";
  var ENGINE_NAME = "research-engine";
  var MEASURES = { OR: 1, RR: 1, HR: 1, RD: 1, MD: 1, SMD: 1 };
  var RATIO = { OR: 1, RR: 1, HR: 1 };
  var MODELS = { fixed: 1, random_dl: 1, random_reml: 1 };
  var TESTS = { wald: 1, knha: 1 };

  function isFin(n) { return typeof n === "number" && isFinite(n); }

  function sid(s) { return (s && s.id !== undefined && s.id !== null) ? s.id : "?"; }

  /* Horner evaluation of c[0]*x^n + ... + c[n]. */
  function polyHorner(c, x) {
    var s = c[0], i;
    for (i = 1; i < c.length; i++) s = s * x + c[i];
    return s;
  }

  /* Inverse standard-normal CDF (Acklam's approximation; |err| < 1.2e-9). */
  function normalQuantile(p) {
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
      138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
      66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
      3.754408661907416];
    var b1 = [b[0], b[1], b[2], b[3], b[4], 1];
    var d1 = [d[0], d[1], d[2], d[3], 1];
    var plow = 0.02425, phigh = 1 - 0.02425, q, r;
    if (!(p > 0 && p < 1)) throw new Error("research: probability must be between 0 and 1");
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return polyHorner(c, q) / polyHorner(d1, q);
    }
    if (p > phigh) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -polyHorner(c, q) / polyHorner(d1, q);
    }
    q = p - 0.5; r = q * q;
    return polyHorner(a, r) * q / polyHorner(b1, r);
  }

  /* Two-sided normal critical value for a confidence level in (0, 1). */
  function criticalValue(level) {
    if (!(level > 0 && level < 1)) throw new Error("research: level must be between 0 and 1");
    return normalQuantile((1 + level) / 2);
  }

  /* Log-gamma (Lanczos); feeds the regularised gamma functions below. */
  function gammln(x) {
    var cof = [76.18009172947146, -86.50532032961677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5, ser = 1.000000000190015, j;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (j = 0; j < 6; j++) { y += 1; ser += cof[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  /* Lower regularised gamma P(a, x) by series (x < a+1), else via Q. */
  function gammaP(a, x) {
    var ITMAX = 300, EPS = 3e-12, ap, del, sum, n;
    if (!(a > 0)) throw new Error("research: gamma shape must be positive");
    if (x <= 0) return 0;
    if (x >= a + 1) return 1 - gammaQ(a, x);
    ap = a; del = 1 / a; sum = del;
    for (n = 1; n <= ITMAX; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
  }

  /* Upper regularised gamma Q(a, x) by continued fraction (x >= a+1). */
  function gammaQ(a, x) {
    var ITMAX = 300, EPS = 3e-12, FPMIN = 1e-300;
    var gln, b, c, d, h, i, an, del;
    if (!(a > 0)) throw new Error("research: gamma shape must be positive");
    if (x <= 0) return 1;
    if (x < a + 1) return 1 - gammaP(a, x);
    gln = gammln(a); b = x + 1 - a; c = 1 / FPMIN; d = 1 / b; h = d;
    for (i = 1; i <= ITMAX; i++) {
      an = -i * (i - a); b += 2; d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }

  /* Chi-square upper-tail probability P(X > q) for df >= 1. */
  function chiSqUpper(q, df) {
    if (!(q >= 0) || !(df >= 1)) throw new Error("research: bad chi-square inputs");
    if (q === 0) return 1;
    return gammaQ(df / 2, q / 2);
  }

  /* Continued fraction for the incomplete beta function. */
  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d, h, m, m2, aa, del;
    d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; h = d;
    for (m = 1; m <= MAXIT; m++) {
      m2 = 2 * m;
      aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  /* Regularised incomplete beta I_x(a, b). */
  function betai(a, b, x) {
    var bt;
    if (!(a > 0) || !(b > 0)) throw new Error("research: bad beta parameters");
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) +
      a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  /* Inverse of I_x(a, b) by bisection (200 steps, ~1e-14 on x). */
  function invBetai(a, b, p) {
    var lo = 0, hi = 1, mid, i;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    for (i = 0; i < 200; i++) {
      mid = (lo + hi) / 2;
      if (betai(a, b, mid) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-14) break;
    }
    return (lo + hi) / 2;
  }

  /* Inverse Student-t CDF with df >= 1, no dependencies. Exact Cauchy form
   * at df = 1, incomplete-beta inversion otherwise, normal limit past
   * df = 10000. P(T <= t) = 1 - I_x(df/2, 1/2)/2 with x = df/(df+t^2). */
  function tQuantile(p, df) {
    var x;
    if (!(p > 0 && p < 1)) throw new Error("research: probability must be between 0 and 1");
    if (!isFin(df) || !(df >= 1)) throw new Error("research: df must be >= 1");
    if (p === 0.5) return 0;
    if (df === 1) return Math.tan(Math.PI * (p - 0.5));
    if (df > 10000) return normalQuantile(p);
    if (p > 0.5) {
      x = invBetai(df / 2, 0.5, 2 * (1 - p));
      return Math.sqrt(df * (1 - x) / x);
    }
    x = invBetai(df / 2, 0.5, 2 * p);
    return -Math.sqrt(df * (1 - x) / x);
  }

  function checkMeasure(measure) {
    if (!MEASURES[measure]) throw new Error("research: unsupported measure " + measure + " (want OR, RR, HR, RD, MD or SMD)");
  }

  function checkModel(model) {
    if (!MODELS[model]) throw new Error("research: unsupported model " + model + " (want fixed, random_dl or random_reml)");
  }

  function checkTest(test) {
    if (!TESTS[test]) throw new Error("research: unsupported test " + test + " (want wald or knha)");
  }

  function reqCount(study, field) {
    var v = study ? study[field] : undefined;
    if (typeof v === "string" && v !== "") v = Number(v);
    if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v || v < 0) {
      throw new Error("research: study " + sid(study) + " needs an integer " + field + " >= 0");
    }
    return v;
  }

  function reqFinite(study, field) {
    var v = study ? study[field] : undefined;
    if (typeof v === "string" && v !== "") v = Number(v);
    if (typeof v !== "number" || !isFinite(v)) {
      throw new Error("research: study " + sid(study) + " needs a finite " + field);
    }
    return v;
  }

  /* Binary raw counts -> {yi, vi, se} on the analysis scale, or an exclusion.
   * OR/RR: 0.5 is added to all four cells when any cell is zero; a study with
   * zero events in both arms is excluded with reason "double-zero". RD is
   * pooled without a log: the pinned escalc call uses add=1/2, to="only0",
   * drop00=FALSE, so any zero cell gets the 1/2 correction and double-zero
   * studies stay in with finite variance. The only RD exclusion left is a
   * study with no variation at all (for example 100% events in both arms). */
  function rawBinary(study, measure) {
    var e1 = reqCount(study, "events1"), n1 = reqCount(study, "n1");
    var e2 = reqCount(study, "events2"), n2 = reqCount(study, "n2");
    var a, b, c, d, N1, N2, yi, vi, p1, p2, q1, q2;
    if (n1 < 1 || n2 < 1) throw new Error("research: study " + sid(study) + " needs n1 and n2 >= 1");
    if (e1 > n1 || e2 > n2) throw new Error("research: study " + sid(study) + " has events above n");
    if (e1 === 0 && e2 === 0 && measure !== "RD") return { excluded: true, reason: "double-zero" };
    a = e1; b = n1 - e1; c = e2; d = n2 - e2;
    if (measure === "OR" || measure === "RR") {
      if (a === 0 || b === 0 || c === 0 || d === 0) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
      if (measure === "OR") {
        yi = Math.log(a * d / (b * c));
        vi = 1 / a + 1 / b + 1 / c + 1 / d;
      } else {
        p1 = a / (a + b); p2 = c / (c + d);
        yi = Math.log(p1 / p2);
        vi = 1 / a - 1 / (a + b) + 1 / c - 1 / (c + d);
      }
    } else {
      if (a === 0 || b === 0 || c === 0 || d === 0) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
      N1 = a + b; N2 = c + d;
      q1 = a / N1; q2 = c / N2;
      yi = q1 - q2;
      vi = q1 * (1 - q1) / N1 + q2 * (1 - q2) / N2;
      if (!(vi > 0) || !isFin(vi)) return { excluded: true, reason: "zero-variance" };
    }
    if (!isFin(yi) || !isFin(vi) || !(vi > 0)) {
      throw new Error("research: study " + sid(study) + " gave a non-finite effect");
    }
    return { yi: yi, vi: vi, se: Math.sqrt(vi) };
  }

  /* Continuous raw means -> {yi, vi, se} on the analysis (natural) scale. */
  function rawContinuous(study, measure) {
    var m1 = reqFinite(study, "mean1"), s1 = reqFinite(study, "sd1"), n1 = reqCount(study, "n1");
    var m2 = reqFinite(study, "mean2"), s2 = reqFinite(study, "sd2"), n2 = reqCount(study, "n2");
    var df, md, sp2, sp, d, J, g, vd, vg, vi;
    if (n1 < 1 || n2 < 1) throw new Error("research: study " + sid(study) + " needs n1 and n2 >= 1");
    if (!(s1 > 0) || !(s2 > 0)) throw new Error("research: study " + sid(study) + " needs sd1 and sd2 > 0");
    md = m1 - m2;
    if (measure === "MD") {
      vi = s1 * s1 / n1 + s2 * s2 / n2;
      if (!isFin(vi) || !(vi > 0)) throw new Error("research: study " + sid(study) + " gave a non-finite effect");
      return { yi: md, vi: vi, se: Math.sqrt(vi) };
    }
    df = n1 + n2 - 2;
    if (df < 1) throw new Error("research: study " + sid(study) + " needs n1 + n2 >= 3 for SMD");
    sp2 = ((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / df;
    if (!(sp2 > 0) || !isFin(sp2)) throw new Error("research: study " + sid(study) + " has no variation");
    sp = Math.sqrt(sp2);
    d = md / sp;
    J = 1 - 3 / (4 * df - 1);
    g = J * d;
    vd = (n1 + n2) / (n1 * n2) + (d * d) / (2 * df);
    vg = J * J * vd;
    if (!isFin(g) || !isFin(vg) || !(vg > 0)) {
      throw new Error("research: study " + sid(study) + " gave a non-finite effect");
    }
    return { yi: g, vi: vg, se: Math.sqrt(vg) };
  }

  function withDisplay(id, got, measure, level) {
    var z = criticalValue(level);
    var lo = got.yi - z * got.se, hi = got.yi + z * got.se;
    var res = {
      yi: got.yi,
      vi: got.vi,
      se: got.se,
      effect: RATIO[measure] ? Math.exp(got.yi) : got.yi,
      ciLower: RATIO[measure] ? Math.exp(lo) : lo,
      ciUpper: RATIO[measure] ? Math.exp(hi) : hi
    };
    if (id !== undefined) res.id = id;
    return res;
  }

  /* Study 2x2 counts or means -> analysis-scale yi/vi plus display-scale
   * effect with a CI at `level` (default 0.95). A double-zero count study
   * (OR/RR only) returns {excluded: true, reason: "double-zero"} instead of
   * numbers. HR has no raw-count form and throws: pass a reported effect. */
  function effectFromRaw(study, measure, level) {
    var got, id;
    checkMeasure(measure);
    if (measure === "HR") {
      throw new Error("research: HR needs a reported effect (effect with ciLower and ciUpper, or yi with se), not raw counts");
    }
    if (level === undefined || level === null) level = 0.95;
    if (!(level > 0 && level < 1)) throw new Error("research: level must be between 0 and 1");
    if (measure === "OR" || measure === "RR" || measure === "RD") got = rawBinary(study, measure);
    else got = rawContinuous(study, measure);
    id = study && study.id !== undefined && study.id !== null ? study.id : undefined;
    if (got.excluded) {
      if (id !== undefined) got.id = id;
      return got;
    }
    return withDisplay(id, got, measure, level);
  }

  /* Reported effect + CI -> yi/vi. SE comes from the STUDY's own ciLevel
   * (default 0.95); ratio measures (OR, RR, HR) are logged. Rejects
   * non-positive ratios, ciLower >= effect, effect >= ciUpper, and
   * non-finite inputs. */
  function effectFromCI(study, measure) {
    var e, lo, hi, ciLevel, z, te, tlo, thi, se, res, id;
    checkMeasure(measure);
    e = reqFinite(study, "effect");
    lo = reqFinite(study, "ciLower");
    hi = reqFinite(study, "ciUpper");
    ciLevel = (study && study.ciLevel !== undefined && study.ciLevel !== null) ? Number(study.ciLevel) : 0.95;
    if (!isFin(ciLevel) || !(ciLevel > 0 && ciLevel < 1)) {
      throw new Error("research: study " + sid(study) + " needs ciLevel between 0 and 1");
    }
    if (!(lo < e && e < hi)) {
      throw new Error("research: study " + sid(study) + " needs ciLower < effect < ciUpper");
    }
    if (RATIO[measure] && (e <= 0 || lo <= 0 || hi <= 0)) {
      throw new Error("research: study " + sid(study) + " needs a positive effect and CI for " + measure);
    }
    z = criticalValue(ciLevel);
    te = RATIO[measure] ? Math.log(e) : e;
    tlo = RATIO[measure] ? Math.log(lo) : lo;
    thi = RATIO[measure] ? Math.log(hi) : hi;
    se = (thi - tlo) / (2 * z);
    if (!isFin(se) || !(se > 0)) {
      throw new Error("research: study " + sid(study) + " gave a non-finite SE");
    }
    res = { yi: te, vi: se * se, se: se, effect: e, ciLower: lo, ciUpper: hi };
    id = study && study.id !== undefined && study.id !== null ? study.id : undefined;
    if (id !== undefined) res.id = id;
    return res;
  }

  /* Generic inverse-variance input -> {yi, vi, se} plus display values.
   * Two shapes: {yi + se (or sei) or vi} already on the analysis scale
   * (for ratio measures the caller passes the logged yi), or
   * {effect + ciLower + ciUpper} at the study's own ciLevel, which is
   * recovered exactly like effectFromCI. When both shapes are present the
   * effect/CI shape wins, matching run(). */
  function effectFromGeneric(study, measure, level) {
    var yi, se, v, res, id;
    checkMeasure(measure);
    if (level === undefined || level === null) level = 0.95;
    if (!(level > 0 && level < 1)) throw new Error("research: level must be between 0 and 1");
    if (study && study.effect !== undefined && study.effect !== null) {
      return effectFromCI(study, measure);
    }
    if (!study || study.yi === undefined || study.yi === null) {
      throw new Error("research: study " + sid(study) + " needs yi with se or vi, or effect with ciLower and ciUpper");
    }
    yi = Number(study.yi);
    if (!isFin(yi)) throw new Error("research: study " + sid(study) + " needs a finite yi");
    if (study.se !== undefined && study.se !== null) se = Number(study.se);
    else if (study.sei !== undefined && study.sei !== null) se = Number(study.sei);
    else if (study.vi !== undefined && study.vi !== null) {
      v = Number(study.vi);
      if (!isFin(v) || !(v > 0)) {
        throw new Error("research: study " + sid(study) + " needs vi > 0 alongside yi");
      }
      se = Math.sqrt(v);
    } else {
      throw new Error("research: study " + sid(study) + " needs se (or sei) or vi alongside yi");
    }
    if (!isFin(se) || !(se > 0)) {
      throw new Error("research: study " + sid(study) + " needs se > 0 alongside yi");
    }
    id = study.id !== undefined && study.id !== null ? study.id : undefined;
    return withDisplay(id, { yi: yi, vi: se * se, se: se }, measure, level);
  }

  /* Restricted log-likelihood at tau2 (up to an additive constant):
   * -1/2 * (sum log(vi + tau2) + log(sum w) + sum w (yi - mu)^2). */
  function remlLL(rows, tau2) {
    var sumLog = 0, s0 = 0, sx = 0, qw = 0, i, w, mu;
    for (i = 0; i < rows.length; i++) sumLog += Math.log(rows[i].vi + tau2);
    for (i = 0; i < rows.length; i++) { w = 1 / (rows[i].vi + tau2); s0 += w; sx += w * rows[i].yi; }
    mu = sx / s0;
    for (i = 0; i < rows.length; i++) {
      w = 1 / (rows[i].vi + tau2);
      qw += w * (rows[i].yi - mu) * (rows[i].yi - mu);
    }
    return -0.5 * (sumLog + Math.log(s0) + qw);
  }

  /* REML tau2 by Fisher scoring from the DL estimate. The step starts at
   * STEPADJ (0.5, the pinned metafor control default) and halves while the
   * restricted likelihood drops; tau2 is clamped at 0; at most MAXITER (1000)
   * iterations. Converges at the boundary when the score points below 0. */
  function remlTau2(rows, dlTau2) {
    var STEPADJ = 0.5, MAXITER = 1000, TOL = 1e-10, HALVINGS = 50;
    var tau2 = (dlTau2 > 0) ? dlTau2 : 0;
    var ll = remlLL(rows, tau2), iter, i, w, r;
    var s0, sx, s2, s3, mu, u, info, step, delta, cand, llCand, halves;
    for (iter = 0; iter < MAXITER; iter++) {
      s0 = 0; sx = 0; s2 = 0; s3 = 0;
      for (i = 0; i < rows.length; i++) {
        w = 1 / (rows[i].vi + tau2);
        s0 += w; sx += w * rows[i].yi; s2 += w * w; s3 += w * w * w;
      }
      mu = sx / s0;
      u = -0.5 * (s0 - s2 / s0);
      for (i = 0; i < rows.length; i++) {
        w = 1 / (rows[i].vi + tau2); r = rows[i].yi - mu;
        u += 0.5 * w * w * r * r;
      }
      info = 0.5 * (s2 - 2 * s3 / s0 + s2 * s2 / (s0 * s0));
      if (!(info > 0) || !isFin(u) || !isFin(info)) {
        return { tau2: tau2, iterations: iter, converged: false };
      }
      if (tau2 === 0 && u <= 0) return { tau2: 0, iterations: iter, converged: true };
      step = STEPADJ; delta = step * u / info; halves = 0;
      while (halves < HALVINGS) {
        cand = tau2 + delta;
        if (!(cand > 0)) cand = 0;
        llCand = remlLL(rows, cand);
        if (isFin(llCand) && llCand >= ll) break;
        delta *= 0.5; halves++;
      }
      if (halves >= HALVINGS) return { tau2: tau2, iterations: iter, converged: false };
      if (Math.abs(cand - tau2) < TOL) return { tau2: cand, iterations: iter + 1, converged: true };
      tau2 = cand; ll = llCand;
    }
    return { tau2: tau2, iterations: MAXITER, converged: false };
  }

  /* Inverse-variance pool of analysis-scale rows [{id, yi, vi}]. Rows marked
   * {excluded: true, reason} pass through into excluded. opts.model is
   * fixed, random_dl or random_reml; opts.test is wald (normal CI) or knha
   * (Hartung-Knapp-Sidik-Jonkman CI with t on k-1 df, untruncated, plus the
   * truncated adhoc variant when it is narrower than the Wald CI).
   * tau2 is the DL estimate except under random_reml (REML via remlTau2);
   * it is reported (labelled) even for the fixed model. I2 is the
   * Higgins-Thompson I2 = tau2 / (tau2 + s2) from the reported tau2 and the
   * typical within-study variance s2 of the fixed-effect weights.
   * predictionInterval follows predict(rma_fit): t on k-2 df under knha,
   * normal otherwise, and is null when k < 3. pooled.effect is on the
   * analysis scale (log OR / log RR / log HR for ratio measures). */
  function pool(rows, opts) {
    var model, level, test, inc, excluded, i, r, yi, vi, k;
    var w, sumW, sumW2, yFixed, Q, df, C, tau2DL, tau2, tau2rep, tau2Estimator, reml;
    var feSumW, feSumW2, sTyp2, i2, y, sumWm, seWald, crit, p, pcts;
    var waldCI, pooled, hksj, qh, seH, critT, halfW, halfH, trunc;
    var pred, sePI, sdPI, critP;
    var notices;
    opts = opts || {};
    model = opts.model === undefined || opts.model === null ? "random_dl" : opts.model;
    checkModel(model);
    level = opts.level === undefined || opts.level === null ? 0.95 : opts.level;
    if (!(level > 0 && level < 1)) throw new Error("research: level must be between 0 and 1");
    test = opts.test === undefined || opts.test === null ? "wald" : opts.test;
    checkTest(test);
    if (!rows || !(rows.length >= 2)) throw new Error("research: at least two studies are required");
    inc = []; excluded = [];
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (r && r.excluded) {
        excluded.push({ id: (r.id !== undefined && r.id !== null) ? r.id : i, reason: String(r.reason || "excluded") });
        continue;
      }
      yi = Number(r && r.yi); vi = Number(r && r.vi);
      if (!isFin(yi) || !isFin(vi) || !(vi > 0)) {
        throw new Error("research: study " + (r && r.id !== undefined ? r.id : i) + " needs finite yi and vi > 0");
      }
      inc.push({ id: (r && r.id !== undefined && r.id !== null) ? r.id : i, yi: yi, vi: vi });
    }
    if (inc.length < 2) throw new Error("research: at least two studies are required (got " + inc.length + ")");
    k = inc.length;
    w = [];
    sumW = 0; sumW2 = 0;
    for (i = 0; i < k; i++) { w[i] = 1 / inc[i].vi; sumW += w[i]; sumW2 += w[i] * w[i]; }
    yFixed = 0;
    for (i = 0; i < k; i++) yFixed += w[i] * inc[i].yi;
    yFixed /= sumW;
    Q = 0;
    for (i = 0; i < k; i++) Q += w[i] * (inc[i].yi - yFixed) * (inc[i].yi - yFixed);
    df = k - 1;
    C = sumW - sumW2 / sumW;
    tau2DL = (C > 0) ? Math.max(0, (Q - df) / C) : 0;
    reml = null;
    if (model === "random_reml") {
      reml = remlTau2(inc, tau2DL);
      tau2 = reml.tau2; tau2Estimator = "REML";
    } else {
      /* random_dl pools with the DL tau2; fixed pools with tau2 = 0. The
       * DL estimate is still reported (labelled) for both, as before. */
      tau2 = (model === "random_dl") ? tau2DL : 0; tau2Estimator = "DL";
    }
    tau2rep = (model === "random_reml") ? tau2 : tau2DL;
    /* Higgins-Thompson typical within-study variance s2 from the
     * fixed-effect weights (captured before any tau2 reweighting); the
     * reported I2 = tau2 / (tau2 + s2) uses the reported (DL or REML) tau2,
     * 0 when that tau2 is 0. */
    feSumW = sumW; feSumW2 = sumW2;
    if (model !== "fixed") {
      sumWm = 0;
      for (i = 0; i < k; i++) { w[i] = 1 / (inc[i].vi + tau2); sumWm += w[i]; }
      sumW = sumWm;
    }
    y = 0;
    for (i = 0; i < k; i++) y += w[i] * inc[i].yi;
    y /= sumW;
    seWald = Math.sqrt(1 / sumW);
    crit = criticalValue(level);
    p = chiSqUpper(Q, df);
    sTyp2 = (k - 1) * feSumW / (feSumW * feSumW - feSumW2);
    i2 = (tau2rep > 0 && isFin(sTyp2) && sTyp2 > 0) ? 100 * tau2rep / (tau2rep + sTyp2) : 0;
    if (!isFin(i2) || i2 < 0) i2 = 0;
    if (i2 > 100) i2 = 100;
    waldCI = { se: seWald, ciLower: y - crit * seWald, ciUpper: y + crit * seWald };
    pooled = { effect: y, ciLower: waldCI.ciLower, ciUpper: waldCI.ciUpper, se: seWald };
    hksj = null; trunc = null;
    if (test === "knha") {
      qh = 0;
      for (i = 0; i < k; i++) qh += w[i] * (inc[i].yi - y) * (inc[i].yi - y);
      seH = Math.sqrt(qh / (df * sumW));
      critT = tQuantile((1 + level) / 2, df);
      halfW = crit * seWald; halfH = critT * seH;
      pooled = { effect: y, ciLower: y - halfH, ciUpper: y + halfH, se: seH };
      if (halfH < halfW) {
        trunc = { se: seWald, ciLower: y - critT * seWald, ciUpper: y + critT * seWald,
          reason: "hksj-narrower-than-wald" };
      }
      hksj = { se: seH, ciLower: y - halfH, ciUpper: y + halfH, df: df, truncated: trunc };
    }
    pred = null;
    if (k >= 3) {
      sePI = (test === "knha") ? hksj.se : seWald;
      sdPI = Math.sqrt(tau2 + sePI * sePI);
      if (test === "knha") {
        critP = tQuantile((1 + level) / 2, k - 2);
        pred = { lower: y - critP * sdPI, upper: y + critP * sdPI, level: level, df: k - 2 };
      } else {
        pred = { lower: y - crit * sdPI, upper: y + crit * sdPI, level: level, df: null };
      }
    }
    notices = [];
    if (model === "random_dl" && test === "wald") {
      notices.push("DL-only: weights use the DerSimonian-Laird tau2 with a normal CI. " +
        "For a small-sample correction run model random_reml with test knha.");
    }
    if (reml && !reml.converged) {
      notices.push("REML-did-not-converge: tau2 is the last iterate; treat the CI with caution.");
    }
    if (trunc) {
      notices.push("hksj-truncated: the HKSJ CI is narrower than the Wald CI, " +
        "so a truncated variant using the larger standard error is also reported.");
    }
    pcts = [];
    for (i = 0; i < k; i++) pcts[i] = (w[i] / sumW) * 100;
    return {
      model: model,
      test: test,
      pooled: pooled,
      wald: waldCI,
      hksj: hksj,
      predictionInterval: pred,
      heterogeneity: reml ?
        { q: Q, df: df, p: p, i2: i2, tau2: tau2rep, tau2Estimator: tau2Estimator,
          iterations: reml.iterations, converged: reml.converged } :
        { q: Q, df: df, p: p, i2: i2, tau2: tau2rep, tau2Estimator: tau2Estimator },
      weights: pcts,
      excluded: excluded,
      notices: notices
    };
  }

  var RAW_FIELDS = ["label", "events1", "n1", "events2", "n2", "mean1", "sd1",
    "mean2", "sd2", "yi", "se", "sei", "vi", "effect", "ciLower", "ciUpper",
    "ciLevel", "citation", "page", "table", "locator"];

  function rawValues(s) {
    var v = {}, i;
    for (i = 0; i < RAW_FIELDS.length; i++) {
      if (s[RAW_FIELDS[i]] !== undefined) v[RAW_FIELDS[i]] = s[RAW_FIELDS[i]];
    }
    return v;
  }

  /* Shared project validation + row building for run and the Phase 4.1
   * functions. Every study must carry verified === true or this throws
   * listing the unverified ids. Studies with an `effect` field pool via
   * effectFromCI, studies with a `yi` field via effectFromGeneric, the rest
   * via effectFromRaw. Returns rows in study order (one row per study,
   * exclusions included). */
  function prepareProject(project) {
    var measure, model, test, level, studies, bad, rows, i;
    project = project || {};
    measure = project.measure;
    checkMeasure(measure);
    model = project.model === undefined || project.model === null ? "random_dl" : project.model;
    checkModel(model);
    test = project.test === undefined || project.test === null ? "wald" : project.test;
    checkTest(test);
    level = project.level === undefined || project.level === null ? 0.95 : project.level;
    if (!(level > 0 && level < 1)) throw new Error("research: level must be between 0 and 1");
    studies = project.studies;
    if (!studies || !(studies.length >= 2)) throw new Error("research: at least two studies are required");
    bad = [];
    for (i = 0; i < studies.length; i++) {
      if (!studies[i] || studies[i].verified !== true) bad.push(sid(studies[i]));
    }
    if (bad.length) throw new Error("research: unverified studies cannot be pooled: " + bad.join(", "));
    rows = [];
    for (i = 0; i < studies.length; i++) {
      if (studies[i].effect !== undefined && studies[i].effect !== null) {
        rows.push(effectFromCI(studies[i], measure));
      } else if (studies[i].yi !== undefined && studies[i].yi !== null) {
        rows.push(effectFromGeneric(studies[i], measure, level));
      } else {
        rows.push(effectFromRaw(studies[i], measure, level));
      }
    }
    return { measure: measure, model: model, test: test, level: level, studies: studies, rows: rows };
  }

  /* Full project -> pool result plus a manifest. createdAt comes from the
   * caller; the engine never calls Date. */
  function run(project) {
    var prep, res;
    project = project || {};
    prep = prepareProject(project);
    res = pool(prep.rows, { model: prep.model, level: prep.level, test: prep.test });
    res.manifest = {
      engine: ENGINE_NAME,
      engineVersion: VERSION,
      measure: prep.measure,
      model: prep.model,
      test: prep.test,
      level: prep.level,
      inputs: prep.studies.map(function (s) { return { id: s.id, values: rawValues(s) }; }),
      createdAt: project.createdAt !== undefined ? project.createdAt : null
    };
    return res;
  }

  /* ================= Phase 4.1: subgroup, sensitivity, publication bias ==== */

  function includedRows(rows) {
    var out = [], i;
    for (i = 0; i < rows.length; i++) {
      if (!(rows[i] && rows[i].excluded)) out.push(rows[i]);
    }
    return out;
  }

  /* Two-sided Student-t p-value P(|T| >= |t|) on df >= 1, via the regularised
   * incomplete beta: p = I_x(df/2, 1/2) with x = df / (df + t^2). */
  function tTwoSidedP(t, df) {
    if (!isFin(t) || !isFin(df) || !(df >= 1)) throw new Error("research: bad t-test inputs");
    return betai(df / 2, 0.5, df / (df + t * t));
  }

  /* Per-subgroup runs plus the test for subgroup differences. `key` names a
   * study field (for example "alloc"); every study needs a string or number
   * value there. Each subgroup is pooled with run() using the project's own
   * measure/model/test/level, so subgroup results carry manifests too.
   *
   * between is the FIXED-EFFECT between-group Q on the subgroup estimates:
   * Q_between = sum_g w_g (theta_g - theta_bar)^2 with w_g = 1 / se_g^2 from
   * each subgroup's reported pooled SE, df = G - 1, chi-square upper-tail p.
   * With model fixed + test wald this equals metafor
   * rma(yi, vi, mods = ~ factor(g), method = "FE") QM / QMdf / QMp exactly.
   * Under random models the subgroup estimates come from the chosen model
   * but the between-group Q stays this fixed-effect form (a common-tau2
   * random-effects QM is NOT implemented); under knha the reported HKSJ SE
   * feeds w_g. Documented in the phase-4 contract. */
  function subgroup(project, key) {
    var prep, i, s, v, g, order, byGroup, inc, results, sub, res;
    var sumW, sumWY, thetaBar, w, theta, q, df;
    if (typeof key !== "string" || key === "") {
      throw new Error("research: subgroup needs a study field name as key");
    }
    prep = prepareProject(project);
    order = []; byGroup = {};
    for (i = 0; i < prep.studies.length; i++) {
      s = prep.studies[i];
      v = s[key];
      if (v === undefined || v === null || v === "") {
        throw new Error("research: study " + sid(s) + " is missing subgroup field " + key);
      }
      if (typeof v !== "string" && typeof v !== "number") {
        throw new Error("research: study " + sid(s) + " subgroup field " + key + " must be a string or number");
      }
      g = String(v);
      if (!byGroup[g]) { byGroup[g] = { group: v, studies: [], rows: [] }; order.push(g); }
      byGroup[g].studies.push(s);
      byGroup[g].rows.push(prep.rows[i]);
    }
    if (order.length < 2) {
      throw new Error("research: subgroup needs at least two groups (got " + order.length + ")");
    }
    results = [];
    for (i = 0; i < order.length; i++) {
      g = order[i];
      inc = includedRows(byGroup[g].rows).length;
      if (inc < 2) {
        throw new Error("research: subgroup " + g + " needs at least two included studies (got " + inc + ")");
      }
      sub = {
        measure: prep.measure, model: prep.model, test: prep.test, level: prep.level,
        createdAt: project.createdAt, studies: byGroup[g].studies
      };
      res = run(sub);
      results.push({ group: byGroup[g].group, k: inc, result: res });
    }
    sumW = 0; sumWY = 0;
    for (i = 0; i < results.length; i++) {
      w = 1 / (results[i].result.pooled.se * results[i].result.pooled.se);
      sumW += w; sumWY += w * results[i].result.pooled.effect;
    }
    thetaBar = sumWY / sumW;
    q = 0;
    for (i = 0; i < results.length; i++) {
      w = 1 / (results[i].result.pooled.se * results[i].result.pooled.se);
      theta = results[i].result.pooled.effect;
      q += w * (theta - thetaBar) * (theta - thetaBar);
    }
    df = results.length - 1;
    return {
      key: key,
      measure: prep.measure,
      model: prep.model,
      test: prep.test,
      groups: results,
      between: {
        q: q, df: df, p: chiSqUpper(q, df),
        method: "fixed-effect between-group Q on the subgroup estimates"
      }
    };
  }

  /* One refit per omitted study, matching metafor leave1out(rma_fit).
   * Iterates the INCLUDED studies only (double-zero drops are not studies in
   * the fit). Needs at least three included studies so every refit keeps two.
   * Each record: {id, effect, se, ciLower, ciUpper, q, df, p, tau2, i2,
   * tau2Estimator}; effect is on the analysis scale. tau2/i2 follow the
   * engine convention: the reported (DL or REML) heterogeneity estimate,
   * labelled, even under model fixed (which pools with tau2 0). */
  function leaveOneOut(project) {
    var prep, inc, i, rest, res, out;
    prep = prepareProject(project);
    inc = includedRows(prep.rows);
    if (inc.length < 3) {
      throw new Error("research: leave-one-out needs at least three included studies (got " + inc.length + ")");
    }
    out = [];
    for (i = 0; i < inc.length; i++) {
      rest = inc.slice(0, i).concat(inc.slice(i + 1));
      res = pool(rest, { model: prep.model, level: prep.level, test: prep.test });
      out.push({
        id: inc[i].id,
        effect: res.pooled.effect,
        se: res.pooled.se,
        ciLower: res.pooled.ciLower,
        ciUpper: res.pooled.ciUpper,
        q: res.heterogeneity.q,
        df: res.heterogeneity.df,
        p: res.heterogeneity.p,
        tau2: res.heterogeneity.tau2,
        i2: res.heterogeneity.i2,
        tau2Estimator: res.heterogeneity.tau2Estimator
      });
    }
    return out;
  }

  /* Re-run excluding studies. Second argument is either an array of study ids
   * or an EXCLUSION predicate: filterFn(study) === true drops the study.
   * Returns {run: <run result on the kept studies>, excluded: [ids removed]}.
   * Unknown ids are ignored; removing down to fewer than two studies throws. */
  function sensitivity(project, exclude) {
    var prep, pred, ids, i, s, drop, kept, removed, res;
    prep = prepareProject(project);
    if (typeof exclude === "function") {
      pred = exclude; ids = null;
    } else if (Object.prototype.toString.call(exclude) === "[object Array]") {
      pred = null; ids = exclude;
    } else {
      throw new Error("research: sensitivity needs an array of study ids or an exclusion function");
    }
    kept = []; removed = [];
    for (i = 0; i < prep.studies.length; i++) {
      s = prep.studies[i];
      drop = pred ? pred(s) === true : ids.indexOf(s.id) !== -1;
      if (drop) removed.push(s.id); else kept.push(s);
    }
    if (kept.length < 2) {
      throw new Error("research: sensitivity leaves fewer than two studies (got " + kept.length + ")");
    }
    res = run({
      measure: prep.measure, model: prep.model, test: prep.test, level: prep.level,
      createdAt: project.createdAt, studies: kept
    });
    return { run: res, excluded: removed };
  }

  /* Classic Egger regression test, pinned to metafor
   * regtest(fit, model = "lm", predictor = "sei"): unweighted OLS of yi on
   * sei, t test of the intercept against 0 on k - 2 df. Publication bias is
   * only assessed at 10+ studies (plan Phase 4), so k < 10 throws.
   * Returns {intercept, se, t, df, p, k, slope, predictor: "sei", model: "lm"}. */
  function egger(project) {
    var prep, inc, k, i, sx, sy, sxx, sxy, syy, xbar, ybar, sxxC, slope, intercept;
    var rss, r, df, s2, seInt, t;
    prep = prepareProject(project);
    inc = includedRows(prep.rows);
    k = inc.length;
    if (k < 10) {
      throw new Error("research: Egger test needs at least 10 studies (got " + k +
        "); publication bias is only assessed at 10+ studies");
    }
    sx = 0; sy = 0; sxx = 0; sxy = 0; syy = 0;
    for (i = 0; i < k; i++) {
      sx += inc[i].se; sy += inc[i].yi;
      sxx += inc[i].se * inc[i].se; sxy += inc[i].se * inc[i].yi;
      syy += inc[i].yi * inc[i].yi;
    }
    xbar = sx / k; ybar = sy / k;
    sxxC = sxx - sx * sx / k;
    /* Relative guards: with equal se (or exactly collinear yi) the centred
     * sums cancel to floating-point dust, not exact zero. */
    if (!(sxxC > 1e-12 * sxx)) throw new Error("research: Egger test needs variation in the standard errors");
    slope = (sxy - sx * sy / k) / sxxC;
    intercept = ybar - slope * xbar;
    rss = 0;
    for (i = 0; i < k; i++) {
      r = inc[i].yi - intercept - slope * inc[i].se;
      rss += r * r;
    }
    if (!(rss > 1e-24 * Math.max(1, syy))) {
      throw new Error("research: Egger test has zero residual variance (yi is an exact linear function of se)");
    }
    df = k - 2;
    s2 = rss / df;
    seInt = Math.sqrt(s2 * (1 / k + xbar * xbar / sxxC));
    if (!(seInt > 0) || !isFin(seInt)) {
      throw new Error("research: Egger test has zero residual variance (yi is an exact linear function of se)");
    }
    t = intercept / seInt;
    return {
      intercept: intercept, se: seInt, t: t, df: df, p: tTwoSidedP(t, df),
      k: k, slope: slope, predictor: "sei", model: "lm"
    };
  }

  /* Funnel plot DATA (no drawing): included-study points {id, yi, se} on the
   * analysis scale, the fixed-effect reference estimate, and the pseudo 95%
   * limit lines for that FE estimate as two-point segments over se in
   * [0, max(se)]: yi = theta_FE +/- z * se (metafor funnel() default region).
   * Returns {points, fe: {effect, se}, limits: {level, z, seFrom, seTo,
   * lower: [{se, yi}, {se, yi}], upper: [...]}}. */
  function funnel(project) {
    var prep, inc, fe, theta, z, seMax, i, points;
    prep = prepareProject(project);
    inc = includedRows(prep.rows);
    fe = pool(inc, { model: "fixed", level: prep.level, test: "wald" });
    theta = fe.pooled.effect;
    z = criticalValue(prep.level);
    seMax = 0; points = [];
    for (i = 0; i < inc.length; i++) {
      if (inc[i].se > seMax) seMax = inc[i].se;
      points.push({ id: inc[i].id, yi: inc[i].yi, se: inc[i].se });
    }
    return {
      points: points,
      fe: { effect: theta, se: fe.pooled.se },
      limits: {
        level: prep.level, z: z, seFrom: 0, seTo: seMax,
        lower: [{ se: 0, yi: theta }, { se: seMax, yi: theta - z * seMax }],
        upper: [{ se: 0, yi: theta }, { se: seMax, yi: theta + z * seMax }]
      }
    };
  }

  /* ================= Phase 4.2: study-design helpers ====================== */

  function countField(obj, field, label) {
    var v = obj ? obj[field] : undefined;
    if (typeof v === "string" && v !== "") v = Number(v);
    if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v || v < 0) {
      throw new Error("research: " + label + " needs an integer " + field + " >= 0");
    }
    return v;
  }

  function finiteArg(v, label) {
    if (typeof v === "string" && v !== "") v = Number(v);
    if (!isFin(v)) throw new Error("research: " + label + " must be a finite number");
    return v;
  }

  /* Multi-arm trial helper (Cochrane Handbook 23.3.4): divide the shared
   * control group's events and n evenly across the treatment comparisons.
   * arms = {control: {events, n}, treatments: [{id?, events, n}, ...]}.
   * Integer handling: each of events and n is split as evenly as possible;
   * the first (value mod t) comparisons receive one extra unit, so shares
   * sum exactly to the original control totals and events never exceed n
   * in any share. No fractional counts and no rounding of effects.
   * Returns study-shaped comparisons [{id?, events1, n1, events2, n2}] with
   * the treatment arm as arm 1 and the control share as arm 2, ready for
   * effectFromRaw / run. */
  function splitSharedControl(arms) {
    var ctrl, trts, t, ce, cn, i, tr, te, tn, out, baseE, remE, baseN, remN, e2, n2;
    if (!arms || typeof arms !== "object") throw new Error("research: splitSharedControl needs {control, treatments}");
    ctrl = arms.control;
    trts = arms.treatments;
    if (!ctrl || typeof ctrl !== "object") throw new Error("research: splitSharedControl needs a control arm {events, n}");
    if (Object.prototype.toString.call(trts) !== "[object Array]" || trts.length < 1) {
      throw new Error("research: splitSharedControl needs a treatments array with at least one arm");
    }
    t = trts.length;
    ce = countField(ctrl, "events", "control arm");
    cn = countField(ctrl, "n", "control arm");
    if (cn < 1) throw new Error("research: control arm needs n >= 1");
    if (ce > cn) throw new Error("research: control arm has events above n");
    baseE = Math.floor(ce / t); remE = ce % t;
    baseN = Math.floor(cn / t); remN = cn % t;
    out = [];
    for (i = 0; i < t; i++) {
      tr = trts[i];
      te = countField(tr, "events", "treatment arm " + (i + 1));
      tn = countField(tr, "n", "treatment arm " + (i + 1));
      if (tn < 1) throw new Error("research: treatment arm " + (i + 1) + " needs n >= 1");
      if (te > tn) throw new Error("research: treatment arm " + (i + 1) + " has events above n");
      e2 = baseE + (i < remE ? 1 : 0);
      n2 = baseN + (i < remN ? 1 : 0);
      if (e2 > n2) throw new Error("research: splitSharedControl gave a control share with events above n");
      var cmp = { events1: te, n1: tn, events2: e2, n2: n2 };
      if (tr && tr.id !== undefined && tr.id !== null) cmp.id = tr.id;
      out.push(cmp);
    }
    return out;
  }

  /* Cluster-randomised adjustment (Cochrane Handbook 23.1.4): design effect
   * DE = 1 + (m - 1) * ICC with mean cluster size m. Binary studies divide
   * both events and n by DE in each arm; continuous studies divide n only
   * (means and SDs are unchanged). Effective counts are kept FRACTIONAL (no
   * rounding), so feed them to generic inverse-variance input or round
   * explicitly before raw-count pooling. Returns {study, designEffect, icc,
   * meanClusterSize}. */
  function clusterAdjust(study, icc, meanClusterSize) {
    var m, de, out, e1, n1, e2, n2, m1, s1, m2, s2;
    if (!study || typeof study !== "object") throw new Error("research: clusterAdjust needs a study object");
    icc = finiteArg(icc, "icc");
    m = finiteArg(meanClusterSize, "meanClusterSize");
    if (!(icc >= 0 && icc <= 1)) throw new Error("research: icc must be between 0 and 1");
    if (!(m >= 1)) throw new Error("research: meanClusterSize must be >= 1");
    de = 1 + (m - 1) * icc;
    out = {};
    if (study.id !== undefined && study.id !== null) out.id = study.id;
    if (study.events1 !== undefined && study.events1 !== null) {
      e1 = countField(study, "events1", "cluster study");
      n1 = countField(study, "n1", "cluster study");
      e2 = countField(study, "events2", "cluster study");
      n2 = countField(study, "n2", "cluster study");
      if (n1 < 1 || n2 < 1) throw new Error("research: cluster study needs n1 and n2 >= 1");
      if (e1 > n1 || e2 > n2) throw new Error("research: cluster study has events above n");
      out.events1 = e1 / de; out.n1 = n1 / de;
      out.events2 = e2 / de; out.n2 = n2 / de;
    } else if (study.mean1 !== undefined && study.mean1 !== null) {
      m1 = finiteArg(study.mean1, "mean1"); s1 = finiteArg(study.sd1, "sd1");
      m2 = finiteArg(study.mean2, "mean2"); s2 = finiteArg(study.sd2, "sd2");
      n1 = countField(study, "n1", "cluster study");
      n2 = countField(study, "n2", "cluster study");
      if (n1 < 1 || n2 < 1) throw new Error("research: cluster study needs n1 and n2 >= 1");
      if (!(s1 > 0) || !(s2 > 0)) throw new Error("research: cluster study needs sd1 and sd2 > 0");
      out.mean1 = m1; out.sd1 = s1; out.n1 = n1 / de;
      out.mean2 = m2; out.sd2 = s2; out.n2 = n2 / de;
    } else {
      throw new Error("research: clusterAdjust needs a binary (events1/n1/events2/n2) or continuous (mean1/sd1/n1/mean2/sd2/n2) study");
    }
    return { study: out, designEffect: de, icc: icc, meanClusterSize: m };
  }

  /* Crossover trial paired analysis (Cochrane Handbook 23.2.6 approach).
   * Two shapes:
   *  1. {md, se}: the reported paired mean difference and its SE are used
   *     as-is (method "paired-reported").
   *  2. {mean1, sd1, mean2, sd2, n, corr}: arm summaries plus the
   *     within-patient correlation r between periods. The paired-difference
   *     variance is Var(MD) = (s1^2 + s2^2 - 2 * r * s1 * s2) / n, i.e.
   *     SD_diff = sqrt(s1^2 + s2^2 - 2 r s1 s2) and SE = SD_diff / sqrt(n)
   *     (method "paired-imputed-corr"). r = 0 reproduces the unpaired MD
   *     variance; the correlation must be supplied, never assumed.
   * Returns {id?, yi, vi, se, method} on the natural scale. */
  function crossoverAdjust(input) {
    var md, se, m1, s1, m2, s2, n, r, varDiff, vi, res;
    if (!input || typeof input !== "object") throw new Error("research: crossoverAdjust needs a study object");
    if (input.md !== undefined && input.md !== null) {
      md = finiteArg(input.md, "md");
      if (input.se === undefined || input.se === null) {
        throw new Error("research: crossoverAdjust needs se alongside md");
      }
      se = finiteArg(input.se, "se");
      if (!(se > 0)) throw new Error("research: crossoverAdjust needs se > 0 alongside md");
      res = { yi: md, vi: se * se, se: se, method: "paired-reported" };
    } else if (input.mean1 !== undefined && input.mean1 !== null) {
      m1 = finiteArg(input.mean1, "mean1"); s1 = finiteArg(input.sd1, "sd1");
      m2 = finiteArg(input.mean2, "mean2"); s2 = finiteArg(input.sd2, "sd2");
      n = countField(input, "n", "crossover study");
      r = finiteArg(input.corr, "corr");
      if (n < 1) throw new Error("research: crossover study needs n >= 1");
      if (!(s1 > 0) || !(s2 > 0)) throw new Error("research: crossover study needs sd1 and sd2 > 0");
      if (!(r >= -1 && r <= 1)) throw new Error("research: corr must be between -1 and 1");
      md = m1 - m2;
      varDiff = s1 * s1 + s2 * s2 - 2 * r * s1 * s2;
      if (!(varDiff > 0)) {
        throw new Error("research: crossoverAdjust gives a non-positive paired variance (check corr)");
      }
      vi = varDiff / n;
      res = { yi: md, vi: vi, se: Math.sqrt(vi), method: "paired-imputed-corr" };
    } else {
      throw new Error("research: crossoverAdjust needs md with se, or mean1/sd1/mean2/sd2 with n and corr");
    }
    if (input.id !== undefined && input.id !== null) res.id = input.id;
    return res;
  }

  /* Wan et al. 2014 (BMC Med Res Methodol 14:135) scenario S2: median and
   * quartiles. mean = (q1 + median + q3) / 3;
   * SD = (q3 - q1) / (2 * Phi^-1((0.75 n - 0.125) / (n + 0.25))).
   * Returns {mean, sd, method: "wan2014-s2-iqr"} so the UI can show the
   * formula used. Assumes an approximately normal underlying distribution. */
  function medianToMean(q1, median, q3, n) {
    var mean, z, sd;
    q1 = finiteArg(q1, "q1"); median = finiteArg(median, "median"); q3 = finiteArg(q3, "q3");
    n = finiteArg(n, "n");
    if (Math.floor(n) !== n || n < 2) throw new Error("research: medianToMean needs an integer n >= 2");
    if (!(q1 <= median && median <= q3)) throw new Error("research: medianToMean needs q1 <= median <= q3");
    if (!(q3 > q1)) throw new Error("research: medianToMean needs q3 > q1 (no spread)");
    mean = (q1 + median + q3) / 3;
    z = normalQuantile((0.75 * n - 0.125) / (n + 0.25));
    sd = (q3 - q1) / (2 * z);
    return { mean: mean, sd: sd, method: "wan2014-s2-iqr" };
  }

  /* Wan et al. 2014 scenario S1: minimum, median, maximum.
   * mean = (min + 2 * median + max) / 4;
   * SD = (max - min) / (2 * Phi^-1((n - 0.375) / (n + 0.25))).
   * Returns {mean, sd, method: "wan2014-s1-range"}. */
  function rangeToMean(min, median, max, n) {
    var mean, z, sd;
    min = finiteArg(min, "min"); median = finiteArg(median, "median"); max = finiteArg(max, "max");
    n = finiteArg(n, "n");
    if (Math.floor(n) !== n || n < 2) throw new Error("research: rangeToMean needs an integer n >= 2");
    if (!(min <= median && median <= max)) throw new Error("research: rangeToMean needs min <= median <= max");
    if (!(max > min)) throw new Error("research: rangeToMean needs max > min (no spread)");
    mean = (min + 2 * median + max) / 4;
    z = normalQuantile((n - 0.375) / (n + 0.25));
    sd = (max - min) / (2 * z);
    return { mean: mean, sd: sd, method: "wan2014-s1-range" };
  }

  var ENGINE = {
    version: VERSION,
    effectFromRaw: effectFromRaw,
    effectFromCI: effectFromCI,
    effectFromGeneric: effectFromGeneric,
    pool: pool,
    run: run,
    tQuantile: tQuantile,
    normalQuantile: normalQuantile,
    subgroup: subgroup,
    leaveOneOut: leaveOneOut,
    sensitivity: sensitivity,
    egger: egger,
    funnel: funnel,
    splitSharedControl: splitSharedControl,
    clusterAdjust: clusterAdjust,
    crossoverAdjust: crossoverAdjust,
    medianToMean: medianToMean,
    rangeToMean: rangeToMean
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; }
  if (G) { G.SMD_RESEARCH_ENGINE = ENGINE; }

})(typeof window !== "undefined" ? window : undefined);
