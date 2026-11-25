/* StewardMD - ResearchMD Sample Size module (window.SMD_RESEARCH_SAMPLESIZE).
 * Pure ES5 IIFE: no DOM, no Date, no Math.random, no I/O.
 * Dual export: browser global SMD_RESEARCH_SAMPLESIZE and CommonJS module.exports.
 *
 * Calculations for study planning:
 *  - twoProportions: Fleiss formula without continuity correction, plus continuity-corrected n
 *  - twoMeans: Normal approximation for two independent groups
 *  - singleProportion: Normal approximation with optional finite population correction
 *  - singleMean: Normal approximation for a single group mean
 *  - correlation: Fisher z transformation for correlation coefficient
 *  - caseControl: Fleiss with continuity correction (plan v2), never throws
 *  - logRankEvents: Schoenfeld events for a time-to-event outcome (plan v2), never throws
 *
 * COPY RULE: Scientific term first, plain meaning in brackets, e.g.:
 *   "Power (chance of detecting a real difference) 80%"
 * No em or en dashes anywhere.
 */
(function (G) {
  "use strict";

  var VERSION = "rmd1";
  var NAME = "research-samplesize";

  function isFin(n) { return typeof n === "number" && isFinite(n); }

  function clampProportion(v, name) {
    if (!isFin(v) || v <= 0 || v >= 1) throw new Error("research: " + name + " must be between 0 and 1");
    return v;
  }

  function clampAlpha(v) {
    if (v === undefined || v === null) return 0.05;
    if (!isFin(v) || v <= 0 || v >= 1) throw new Error("research: alpha must be between 0 and 1");
    return v;
  }

  function clampPower(v) {
    if (v === undefined || v === null) return 0.8;
    if (!isFin(v) || v <= 0 || v >= 1) throw new Error("research: power must be between 0 and 1");
    return v;
  }

  function clampRatio(v) {
    if (v === undefined || v === null) return 1;
    if (!isFin(v) || v <= 0) throw new Error("research: ratio must be positive");
    return v;
  }

  function clampDropout(v) {
    if (v === undefined || v === null) return 0;
    if (!isFin(v) || v < 0 || v >= 1) throw new Error("research: dropout must be between 0 and 1");
    return v;
  }

  /* Acklam standard normal inverse CDF (probit) approximation (error < 1.15e-9). */
  function probit(p) {
    if (p <= 0 || p >= 1) return NaN;
    var a1 = -39.69683028665376, a2 = 220.9460984245205, a3 = -275.9285104469687;
    var a4 = 138.3577518672690, a5 = -30.66479806614716, a6 = 2.506628277459239;
    var b1 = -54.47609879822406, b2 = 161.5858368580409, b3 = -155.6989798598866;
    var b4 = 66.80131188771972, b5 = -13.28068155288572;
    var c1 = -0.007784894002430293, c2 = -0.3223964580411365, c3 = -2.400758277161838;
    var c4 = -2.549732539343734, c5 = 4.374664141464968, c6 = 2.938163982698783;
    var d1 = 0.007784695709041462, d2 = 0.3224671290700398, d3 = 2.445134137142996;
    var d4 = 3.754408661907416;
    var q, r;
    if (p < 0.02425) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
             ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
    }
    if (p <= 0.97575) {
      q = p - 0.5;
      r = q * q;
      return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
             (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
            ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }

  function pctStr(val) {
    var p = Math.round(val * 1000) / 10;
    return (p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)) + "%";
  }

  function numStr(val) {
    if (val == null) return "";
    var n = Number(val);
    if (!isFin(n)) return String(val);
    if (Math.abs(n) < 0.001) return n.toExponential(2);
    if (n % 1 === 0) return n.toFixed(0);
    return (Math.round(n * 100) / 100).toString();
  }

  /* 1. twoProportions({ p1, p2, alpha=0.05, power=0.8, ratio=1, twoSided=true, dropout=0 }) */
  function twoProportions(opts) {
    if (!opts || typeof opts !== "object") throw new Error("research: twoProportions needs an options object");
    var p1 = clampProportion(opts.p1, "p1");
    var p2 = clampProportion(opts.p2, "p2");
    if (Math.abs(p1 - p2) < 1e-9) throw new Error("research: proportions must not be equal");
    var alpha = clampAlpha(opts.alpha);
    var power = clampPower(opts.power);
    var ratio = clampRatio(opts.ratio);
    var twoSided = opts.twoSided !== false;
    var dropout = clampDropout(opts.dropout);

    var zAlpha = probit(twoSided ? (1 - alpha / 2) : (1 - alpha));
    var zBeta = probit(power);

    var q1 = 1 - p1;
    var q2 = 1 - p2;
    var diff = Math.abs(p1 - p2);

    /* Fleiss (1981) without continuity correction: pooled variance under the null, unpooled under the alternative.
     * Matches R power.prop.test for ratio 1 (p1 0.30, p2 0.15 -> 120.47 per group). */
    var pBar = (p1 + ratio * p2) / (1 + ratio);
    var n1Raw = Math.pow(zAlpha * Math.sqrt((1 + 1 / ratio) * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * q1 + (p2 * q2) / ratio), 2) / Math.pow(diff, 2);
    var nPerGroup = Math.ceil(n1Raw);
    var n2 = Math.ceil(nPerGroup * ratio);
    var total = nPerGroup + n2;

    var nWithDropout = (dropout > 0 && dropout < 1) ? Math.ceil(n1Raw / (1 - dropout)) : nPerGroup;
    var n2WithDropout = Math.ceil(nWithDropout * ratio);
    var totalWithDropout = nWithDropout + n2WithDropout;

    /* Fleiss continuity-corrected sample size:
     * n_cc = (n1' / 4) * [ 1 + sqrt( 1 + 2*(ratio + 1) / (n1' * ratio * diff) ) ]^2 */
    var ccFactor = (2 * (ratio + 1)) / (n1Raw * ratio * diff);
    var n1CcRaw = (n1Raw / 4) * Math.pow(1 + Math.sqrt(1 + ccFactor), 2);
    var nPerGroupCc = Math.ceil(n1CcRaw);
    var n2Cc = Math.ceil(nPerGroupCc * ratio);
    var totalCc = nPerGroupCc + n2Cc;

    var nWithDropoutCc = (dropout > 0 && dropout < 1) ? Math.ceil(n1CcRaw / (1 - dropout)) : nPerGroupCc;
    var n2WithDropoutCc = Math.ceil(nWithDropoutCc * ratio);
    var totalWithDropoutCc = nWithDropoutCc + n2WithDropoutCc;

    /* Synopsis paragraph */
    var outcomeLabel = opts.outcome || "a complication rate";
    var g1Label = opts.group1 ? "with " + opts.group1 : "in Group 1";
    var g2Label = opts.group2 ? "with " + opts.group2 : "in Group 2";
    if (opts.group1 && !opts.group2) g2Label = "with Control";
    if (!opts.outcome && (opts.group1 || opts.group2)) outcomeLabel = "an event rate";

    var para = "Assuming " + outcomeLabel + " of " + pctStr(p1) + " " + g1Label + " and " + pctStr(p2) + " " + g2Label +
      ", with " + pctStr(alpha) + " significance (alpha) and " + pctStr(power) + " power (chance of detecting a real difference), " +
      nPerGroup + " patients per group are needed";

    if (dropout > 0) {
      para += "; allowing for " + pctStr(dropout) + " loss to follow-up, " + nWithDropout + " per group (" + totalWithDropout + " in total) will be enrolled.";
    } else {
      para += " (" + total + " in total).";
    }

    return {
      n: nPerGroup,
      nPerGroup: nPerGroup,
      total: total,
      withDropout: nWithDropout,
      totalWithDropout: totalWithDropout,
      nContinuityCorrected: nPerGroupCc,
      continuityCorrected: {
        n: nPerGroupCc,
        nPerGroup: nPerGroupCc,
        total: totalCc,
        withDropout: nWithDropoutCc,
        totalWithDropout: totalWithDropoutCc
      },
      formula: "Fleiss formula without continuity correction",
      paragraph: para
    };
  }

  /* 2. twoMeans({ sd, diff, alpha=0.05, power=0.8, ratio=1, twoSided=true, dropout=0 }) */
  function twoMeans(opts) {
    if (!opts || typeof opts !== "object") throw new Error("research: twoMeans needs an options object");
    var sd = opts.sd;
    if (sd === undefined && opts.sd1 !== undefined && opts.sd2 !== undefined) {
      var s1 = opts.sd1, s2 = opts.sd2;
      if (!isFin(s1) || s1 <= 0 || !isFin(s2) || s2 <= 0) throw new Error("research: standard deviation must be positive");
      sd = Math.sqrt((s1 * s1 + s2 * s2) / 2);
    }
    if (!isFin(sd) || sd <= 0) throw new Error("research: standard deviation must be positive");
    var diff = opts.diff;
    if (!isFin(diff) || Math.abs(diff) < 1e-9) throw new Error("research: difference must not be 0");
    diff = Math.abs(diff);

    var alpha = clampAlpha(opts.alpha);
    var power = clampPower(opts.power);
    var ratio = clampRatio(opts.ratio);
    var twoSided = opts.twoSided !== false;
    var dropout = clampDropout(opts.dropout);

    var zAlpha = probit(twoSided ? (1 - alpha / 2) : (1 - alpha));
    var zBeta = probit(power);

    /* Normal approximation:
     * n1 = (1 + 1/ratio) * sd^2 * (zAlpha + zBeta)^2 / diff^2 */
    /* plus Guenther's zAlpha^2/4 small-sample term, so the n matches the t-test answer (R power.t.test, G*Power) */
    var n1Raw = (1 + 1 / ratio) * Math.pow(sd, 2) * Math.pow(zAlpha + zBeta, 2) / Math.pow(diff, 2) + Math.pow(zAlpha, 2) / 4;
    var nPerGroup = Math.ceil(n1Raw);
    var n2 = Math.ceil(nPerGroup * ratio);
    var total = nPerGroup + n2;

    var nWithDropout = (dropout > 0 && dropout < 1) ? Math.ceil(n1Raw / (1 - dropout)) : nPerGroup;
    var n2WithDropout = Math.ceil(nWithDropout * ratio);
    var totalWithDropout = nWithDropout + n2WithDropout;

    var outcomeLabel = opts.outcome ? opts.outcome + " difference" : "a clinically meaningful difference";
    var para = "Assuming a standard deviation (spread of measurements) of " + numStr(sd) +
      " and " + outcomeLabel + " of " + numStr(diff) + ", with " + pctStr(alpha) + " significance (alpha) and " +
      pctStr(power) + " power (chance of detecting a real difference), " + nPerGroup + " patients per group are needed";

    if (dropout > 0) {
      para += "; allowing for " + pctStr(dropout) + " loss to follow-up, " + nWithDropout + " per group (" + totalWithDropout + " in total) will be enrolled.";
    } else {
      para += " (" + total + " in total).";
    }

    return {
      n: nPerGroup,
      nPerGroup: nPerGroup,
      total: total,
      withDropout: nWithDropout,
      totalWithDropout: totalWithDropout,
      formula: "Normal approximation for two means (with Guenther small-sample term)",
      paragraph: para
    };
  }

  /* 3. singleProportion({ p, precision, alpha=0.05, dropout=0, population }) */
  function singleProportion(opts) {
    if (!opts || typeof opts !== "object") throw new Error("research: singleProportion needs an options object");
    var p = clampProportion(opts.p, "p");
    var precision = opts.precision;
    if (!isFin(precision)) throw new Error("research: precision must be a finite number");
    if (precision > 1 && precision <= 100) precision = precision / 100;
    if (precision <= 0 || precision >= 1) throw new Error("research: precision must be between 0 and 1");

    var alpha = clampAlpha(opts.alpha);
    var dropout = clampDropout(opts.dropout);
    var zAlpha = probit(1 - alpha / 2);

    var n0 = (Math.pow(zAlpha, 2) * p * (1 - p)) / Math.pow(precision, 2);
    var nRaw = n0;
    var hasPop = opts.population !== undefined && opts.population !== null && opts.population !== "";
    var pop = null;
    if (hasPop) {
      pop = Number(opts.population);
      if (!isFin(pop) || pop <= 1) throw new Error("research: population must be greater than 1");
      pop = Math.round(pop);
      /* Cochran finite population correction: n = n0 / (1 + (n0 - 1) / N) */
      nRaw = n0 / (1 + (n0 - 1) / pop);
    }

    var n = Math.ceil(nRaw);
    var nWithDropout = (dropout > 0 && dropout < 1) ? Math.ceil(nRaw / (1 - dropout)) : n;

    var para = "Assuming an expected proportion of " + pctStr(p) + " and an absolute precision (margin of error) of " +
      pctStr(precision);
    if (pop) {
      para += " in a finite population of " + pop;
    }
    para += ", with " + pctStr(alpha) + " significance (alpha), " + n + " patients are needed";

    if (dropout > 0) {
      para += "; allowing for " + pctStr(dropout) + " loss to follow-up, " + nWithDropout + " patients in total will be enrolled.";
    } else {
      para += " in total.";
    }

    return {
      n: n,
      total: n,
      withDropout: nWithDropout,
      totalWithDropout: nWithDropout,
      formula: pop ? "Single proportion with finite population correction" : "Single proportion (normal approximation)",
      paragraph: para
    };
  }

  /* 4. singleMean({ sd, precision, alpha=0.05, dropout=0 }) */
  function singleMean(opts) {
    if (!opts || typeof opts !== "object") throw new Error("research: singleMean needs an options object");
    var sd = opts.sd;
    if (!isFin(sd) || sd <= 0) throw new Error("research: standard deviation must be positive");
    var precision = opts.precision;
    if (!isFin(precision) || precision <= 0) throw new Error("research: precision must be positive");

    var alpha = clampAlpha(opts.alpha);
    var dropout = clampDropout(opts.dropout);
    var zAlpha = probit(1 - alpha / 2);

    var nRaw = (Math.pow(zAlpha, 2) * Math.pow(sd, 2)) / Math.pow(precision, 2);
    var n = Math.ceil(nRaw);
    var nWithDropout = (dropout > 0 && dropout < 1) ? Math.ceil(nRaw / (1 - dropout)) : n;

    var para = "Assuming a standard deviation (spread of measurements) of " + numStr(sd) +
      " and an absolute precision (margin of error) of " + numStr(precision) + ", with " +
      pctStr(alpha) + " significance (alpha), " + n + " patients are needed";

    if (dropout > 0) {
      para += "; allowing for " + pctStr(dropout) + " loss to follow-up, " + nWithDropout + " patients in total will be enrolled.";
    } else {
      para += " in total.";
    }

    return {
      n: n,
      total: n,
      withDropout: nWithDropout,
      totalWithDropout: nWithDropout,
      formula: "Single mean (normal approximation)",
      paragraph: para
    };
  }

  /* 5. correlation({ r, alpha=0.05, power=0.8, twoSided=true, dropout=0 }) */
  function correlation(opts) {
    if (!opts || typeof opts !== "object") throw new Error("research: correlation needs an options object");
    var r = opts.r;
    if (!isFin(r) || Math.abs(r) >= 1 || Math.abs(r) < 1e-9) {
      throw new Error("research: correlation r must be between -1 and 1 and non-zero");
    }
    var alpha = clampAlpha(opts.alpha);
    var power = clampPower(opts.power);
    var twoSided = opts.twoSided !== false;
    var dropout = clampDropout(opts.dropout);

    var zAlpha = probit(twoSided ? (1 - alpha / 2) : (1 - alpha));
    var zBeta = probit(power);

    /* Fisher z transformation: z_r = 0.5 * ln((1 + |r|) / (1 - |r|))
     * n = ((zAlpha + zBeta) / z_r)^2 + 3 */
    var zr = 0.5 * Math.log((1 + Math.abs(r)) / (1 - Math.abs(r)));
    var nRaw = Math.pow((zAlpha + zBeta) / zr, 2) + 3;
    var n = Math.ceil(nRaw);
    var nWithDropout = (dropout > 0 && dropout < 1) ? Math.ceil(nRaw / (1 - dropout)) : n;

    var para = "Assuming an expected correlation coefficient (strength of relationship) of " + numStr(r) +
      ", with " + pctStr(alpha) + " significance (alpha) and " + pctStr(power) +
      " power (chance of detecting a real difference), " + n + " patients are needed";

    if (dropout > 0) {
      para += "; allowing for " + pctStr(dropout) + " loss to follow-up, " + nWithDropout + " patients in total will be enrolled.";
    } else {
      para += " in total.";
    }

    return {
      n: n,
      total: n,
      withDropout: nWithDropout,
      totalWithDropout: nWithDropout,
      formula: "Fisher z transformation for correlation",
      paragraph: para
    };
  }

  /* Plan v2 item 6. These two return { ok, warnings, ... } and never throw.
   * caseControl: Fleiss with continuity correction (Fleiss 1981, formulas 3.18
   * and 3.19, as OpenEpi). p0 = proportion of controls exposed, r controls per case.
   * p0 0.40, OR 2, r 1 gives 133 uncorrected and 144 cases, 144 controls (OpenEpi). */
  function numOr(v, dflt) { return v === undefined || v === null || v === "" ? dflt : v; }

  function caseControl(opts) {
    var o = opts || {}, warnings = [];
    var p0 = o.p0, orv = o.or, r = numOr(o.r, 1), alpha = numOr(o.alpha, 0.05), power = numOr(o.power, 0.8), dropout = numOr(o.dropout, 0);
    if (!isFin(p0) || p0 <= 0 || p0 >= 1 || !isFin(orv) || orv <= 0 || Math.abs(orv - 1) < 1e-12) {
      return { ok: false, warnings: ["The odds ratio must differ from 1 and exposure must be between 0% and 100%."] };
    }
    if (!isFin(r) || r <= 0 || !isFin(alpha) || alpha <= 0 || alpha >= 1 || !isFin(power) || power <= 0 || power >= 1 ||
      !isFin(dropout) || dropout < 0 || dropout >= 1) {
      return { ok: false, warnings: ["Controls per case must be above 0; significance, power and dropout must be between 0% and 100%."] };
    }
    var p1 = p0 * orv / (1 + p0 * (orv - 1));
    var pbar = (p1 + r * p0) / (r + 1);
    var za = probit(1 - alpha / 2), zb = probit(power);
    var diff = Math.abs(p1 - p0);
    var n = Math.pow(za * Math.sqrt((r + 1) * pbar * (1 - pbar)) + zb * Math.sqrt(r * p1 * (1 - p1) + p0 * (1 - p0)), 2) / (r * diff * diff);
    var nc = n / 4 * Math.pow(1 + Math.sqrt(1 + 2 * (r + 1) / (n * r * diff)), 2);
    var cases = Math.ceil(nc / (1 - dropout) - 1e-9);
    var controls = Math.ceil(r * cases - 1e-9);
    if (r > 4) warnings.push("More than 4 controls per case adds little power.");
    return {
      ok: true, warnings: warnings, p1: p1, method: "Fleiss with continuity correction",
      casesUncorrected: Math.ceil(n - 1e-9), cases: cases, controls: controls, total: cases + controls,
      paragraph: "Assuming " + pctStr(p0) + " of controls are exposed and an expected odds ratio of " + numStr(orv) +
        " (" + pctStr(p1) + " of cases exposed), with " + pctStr(alpha) + " significance (alpha), " + pctStr(power) +
        " power (chance of detecting a real difference) and " + numStr(r) + " control" + (r === 1 ? "" : "s") + " per case, " +
        cases + " cases and " + controls + " controls are needed (Fleiss method with continuity correction" +
        (dropout > 0 ? ", allowing for " + pctStr(dropout) + " incomplete records" : "") + ")."
    };
  }

  /* logRankEvents: Schoenfeld (1983). events = (z(1 - alpha/2) + z(power))^2 / (a (1 - a) (ln HR)^2),
   * a = proportion allocated to one arm. Patients = events / probEvent / (1 - dropout) when probEvent is given. */
  function logRankEvents(opts) {
    var o = opts || {};
    var hr = o.hr, alpha = numOr(o.alpha, 0.05), power = numOr(o.power, 0.8), a = numOr(o.allocation, 0.5), dropout = numOr(o.dropout, 0), pe = o.probEvent;
    if (!isFin(hr) || hr <= 0) return { ok: false, warnings: ["Enter the hazard ratio you expect, for example 0.7."] };
    if (Math.abs(hr - 1) < 1e-12) return { ok: false, warnings: ["A hazard ratio of 1 means no difference; choose the smallest difference that matters."] };
    if (!isFin(alpha) || alpha <= 0 || alpha >= 1 || !isFin(power) || power <= 0 || power >= 1 || !isFin(a) || a <= 0 || a >= 1 ||
      !isFin(dropout) || dropout < 0 || dropout >= 1 || (pe != null && pe !== "" && (!isFin(pe) || pe <= 0 || pe > 1))) {
      return { ok: false, warnings: ["Significance, power, allocation, dropout and the event proportion must be between 0% and 100%."] };
    }
    var za = probit(1 - alpha / 2), zb = probit(power), lhr = Math.log(hr);
    var events = Math.ceil((za + zb) * (za + zb) / (a * (1 - a) * lhr * lhr) - 1e-9);
    var total = isFin(pe) ? Math.ceil(events / pe / (1 - dropout) - 1e-9) : null;
    return {
      ok: true, warnings: total === null ? ["Add the expected proportion with the event by the end of follow-up to get the number of patients."] : [],
      method: "Schoenfeld", events: events, total: total,
      paragraph: "To detect a hazard ratio of " + numStr(hr) + " with " + pctStr(alpha) + " significance (alpha) and " + pctStr(power) +
        " power (chance of detecting a real difference), " + events + " events are needed (Schoenfeld method)" +
        (total !== null ? "; with " + pctStr(pe) + " of patients expected to have the event" + (dropout > 0 ? " and " + pctStr(dropout) + " lost to follow-up" : "") + ", " + total + " patients will be enrolled." : ".")
    };
  }

  var SAMPLESIZE = {
    name: NAME,
    version: VERSION,
    twoProportions: twoProportions,
    twoMeans: twoMeans,
    singleProportion: singleProportion,
    singleMean: singleMean,
    correlation: correlation,
    caseControl: caseControl,
    logRankEvents: logRankEvents,
    probit: probit
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = SAMPLESIZE; }
  if (G) { G.SMD_RESEARCH_SAMPLESIZE = SAMPLESIZE; }

})(typeof window !== "undefined" ? window : undefined);
