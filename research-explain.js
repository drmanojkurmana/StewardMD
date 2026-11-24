/* StewardMD - ResearchMD "What this means" helper (window.SMD_RESEARCH_EXPLAIN).
 * Pure ES5 IIFE: no DOM, no Date, no Math.random, no I/O.
 * Dual export: browser global SMD_RESEARCH_EXPLAIN and CommonJS module.exports.
 *
 * COPY RULE (mandatory): standard statistic FIRST in reporting format, then
 * the plain meaning in brackets or as a following sentence. Never plain-only.
 * No em or en dashes anywhere in any generated string (use "to" or commas).
 */
(function (G) {
  "use strict";

  var VERSION = "rmd1";
  var NAME = "research-explain";

  function isFin(n) {
    return typeof n === "number" && isFinite(n);
  }

  function fmt2(n) {
    return Number(n).toFixed(2);
  }

  function fmtMD(n) {
    if (Number(n.toFixed(1)) === n) {
      return n.toFixed(1);
    }
    return n.toFixed(2);
  }

  var MEASURE_NAMES = {
    RR: "Risk ratio (RR)",
    OR: "Odds ratio (OR)",
    HR: "Hazard ratio (HR)",
    MD: "Mean difference (MD)",
    SMD: "Standardised mean difference (SMD)"
  };

  var RATIO_NOUNS = {
    RR: "risk",
    OR: "odds",
    HR: "hazard"
  };

  /* effect(opts) -> string
   * opts: {
   *   measure: "RR"|"OR"|"HR"|"MD"|"SMD",
   *   estimate: number,
   *   ciLower: number,
   *   ciUpper: number,
   *   p?: number,
   *   outcome?: string,
   *   group?: string,
   *   harmful?: boolean (default true: outcome is bad event, lower is better),
   *   units?: string
   * }
   */
  function effect(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("research: effect requires an options object");
    }
    var measure = opts.measure;
    if (!MEASURE_NAMES.hasOwnProperty(measure)) {
      throw new Error("research: effect measure must be RR, OR, HR, MD or SMD");
    }
    if (!isFin(opts.estimate)) {
      throw new Error("research: effect estimate must be a finite number");
    }
    if (!isFin(opts.ciLower)) {
      throw new Error("research: effect ciLower must be a finite number");
    }
    if (!isFin(opts.ciUpper)) {
      throw new Error("research: effect ciUpper must be a finite number");
    }
    if (opts.p !== undefined && opts.p !== null && !isFin(opts.p)) {
      throw new Error("research: effect p must be a finite number");
    }

    var harmful = (opts.harmful === undefined) ? true : Boolean(opts.harmful);
    var group = (typeof opts.group === "string" && opts.group.trim()) ? opts.group.trim() : "treatment";
    var whoGot = "people who got " + (group === "treatment" ? "the treatment" : group);
    var units = (typeof opts.units === "string" && opts.units.trim()) ? opts.units.trim() : "";

    var stat = "";
    var pStr = "";
    if (opts.p !== undefined && opts.p !== null) {
      if (opts.p < 0.001) {
        pStr = ", p < .001";
      } else {
        pStr = ", p = " + (opts.p < 0.01 ? opts.p.toFixed(3) : opts.p.toFixed(2));
      }
    }

    if (measure === "MD") {
      var uSuffix = units ? " " + units : "";
      stat = MEASURE_NAMES[measure] + " " + fmtMD(opts.estimate) + uSuffix + ", 95% CI " + fmtMD(opts.ciLower) + " to " + fmtMD(opts.ciUpper) + uSuffix + pStr;
    } else if (measure === "SMD") {
      stat = MEASURE_NAMES[measure] + " " + fmt2(opts.estimate) + ", 95% CI " + fmt2(opts.ciLower) + " to " + fmt2(opts.ciUpper) + pStr;
    } else {
      stat = MEASURE_NAMES[measure] + " " + fmt2(opts.estimate) + ", 95% CI " + fmt2(opts.ciLower) + " to " + fmt2(opts.ciUpper) + pStr;
    }

    /* CI crossing null check */
    var crossesNull = false;
    if (measure === "MD" || measure === "SMD") {
      crossesNull = (opts.ciLower <= 0 && opts.ciUpper >= 0);
    } else {
      crossesNull = (opts.ciLower <= 1 && opts.ciUpper >= 1);
    }

    if (crossesNull) {
      return stat + " (the result could go either way; these studies cannot tell if it helps or harms)";
    }

    /* MD plain meaning */
    if (measure === "MD") {
      var dirMD = (opts.estimate < 0) ? "lower" : "higher";
      var absMD = fmtMD(Math.abs(opts.estimate));
      var unitStr = units ? " " + units : "";
      return stat + " (on average " + absMD + unitStr + " " + dirMD + " in the " + group + " group)";
    }

    /* SMD plain meaning with Cohen size words */
    if (measure === "SMD") {
      var absSMD = Math.abs(opts.estimate);
      var sizeWord;
      if (absSMD < 0.2) {
        sizeWord = "trivial";
      } else if (absSMD < 0.5) {
        sizeWord = "small";
      } else if (absSMD < 0.8) {
        sizeWord = "moderate";
      } else {
        sizeWord = "large";
      }
      var dirSMD = (opts.estimate < 0) ? "lower" : "higher";
      return stat + " (a " + sizeWord + " effect; on average " + absSMD.toFixed(2) + " standard deviations " + dirSMD + " in the " + group + " group)";
    }

    /* Ratio measures (RR, OR, HR) */
    var noun = RATIO_NOUNS[measure];
    var est = opts.estimate;
    var sentence1 = "";
    var sentence2 = "";

    if (!harmful) {
      /* Outcome is beneficial (e.g. cure). Ratio > 1 is the benefit. */
      if (est > 1) {
        var pctHigher = Math.round((est - 1) * 100);
        var phraseGood;
        if (est >= 1.9 && est <= 2.1) {
          phraseGood = "about double the " + noun + " of benefit";
        } else {
          phraseGood = "higher " + noun + " of benefit";
        }
        sentence1 = whoGot + " had " + phraseGood + "; " + pctHigher + "% higher.";
        var pLoGood = Math.round((opts.ciLower - 1) * 100);
        var pHiGood = Math.round((opts.ciUpper - 1) * 100);
        var minG = Math.min(pLoGood, pHiGood);
        var maxG = Math.max(pLoGood, pHiGood);
        sentence2 = "We are fairly sure the real effect is somewhere between " + minG + "% and " + maxG + "% higher.";
      } else {
        /* est < 1 for a good outcome means worse / lower chance */
        var pctLowerWorse = Math.round((1 - est) * 100);
        var phraseWorse;
        if (est >= 0.45 && est <= 0.55) {
          phraseWorse = "about half the " + noun + " of benefit";
        } else {
          phraseWorse = "lower " + noun + " of benefit";
        }
        sentence1 = whoGot + " had " + phraseWorse + "; " + pctLowerWorse + "% lower.";
        var p1W = Math.round((1 - opts.ciUpper) * 100);
        var p2W = Math.round((1 - opts.ciLower) * 100);
        var minW = Math.min(p1W, p2W);
        var maxW = Math.max(p1W, p2W);
        sentence2 = "We are fairly sure the real effect is somewhere between " + minW + "% and " + maxW + "% lower.";
      }
    } else {
      /* Outcome is harmful (bad event). Ratio < 1 is the benefit. */
      if (est < 1) {
        var pctLower = Math.round((1 - est) * 100);
        var phraseBad;
        if (est >= 0.45 && est <= 0.55) {
          phraseBad = "about half the " + noun;
        } else {
          phraseBad = "lower " + noun;
        }
        sentence1 = whoGot + " had " + phraseBad + "; " + pctLower + "% lower.";
        var p1 = Math.round((1 - opts.ciUpper) * 100);
        var p2 = Math.round((1 - opts.ciLower) * 100);
        var minVal = Math.min(p1, p2);
        var maxVal = Math.max(p1, p2);
        sentence2 = "We are fairly sure the real effect is somewhere between " + minVal + "% and " + maxVal + "% lower.";
      } else {
        var pctHigherHarm = Math.round((est - 1) * 100);
        var phraseHarm;
        if (est >= 1.9 && est <= 2.1) {
          phraseHarm = "about double the " + noun;
        } else {
          phraseHarm = "higher " + noun;
        }
        sentence1 = whoGot + " had " + phraseHarm + "; " + pctHigherHarm + "% higher.";
        var pLoH = Math.round((opts.ciLower - 1) * 100);
        var pHiH = Math.round((opts.ciUpper - 1) * 100);
        var minH = Math.min(pLoH, pHiH);
        var maxH = Math.max(pLoH, pHiH);
        sentence2 = "We are fairly sure the real effect is somewhere between " + minH + "% and " + maxH + "% higher.";
      }
    }

    return stat + " (" + sentence1 + " " + sentence2 + ")";
  }

  /* pValue(p) -> string
   * Thresholds:
   *  < 0.001       "p < .001 (very unlikely to be chance)"
   *  0.001..0.01   "(unlikely to be chance)"
   *  0.01..0.05    "(probably not chance, but only just)"
   *  >= 0.05       "(could easily be chance)"
   */
  function pValue(p) {
    if (!isFin(p)) {
      throw new Error("research: pValue requires a finite number");
    }
    if (p < 0 || p > 1) {
      throw new Error("research: pValue requires a probability between 0 and 1");
    }
    if (p < 0.001) {
      return "p < .001 (very unlikely to be chance)";
    }
    if (p < 0.01) {
      return "p = " + p.toFixed(3) + " (unlikely to be chance)";
    }
    if (p < 0.05) {
      var sMed = (Number(p.toFixed(2)) === p) ? p.toFixed(2) : p.toFixed(3);
      return "p = " + sMed + " (probably not chance, but only just)";
    }
    var sHi = (Number(p.toFixed(2)) === p) ? p.toFixed(2) : p.toFixed(3);
    return "p = " + sHi + " (could easily be chance)";
  }

  /* heterogeneity(i2, tau2?) -> string
   * Thresholds:
   *  < 25      low  "(the studies mostly agree)"
   *  25 to <50 some "(the studies show some disagreement)"
   *  50 to <75 a lot "(the studies disagree a lot, so treat the combined answer with care)"
   *  >= 75     very high "(the studies disagree very strongly, so treat the combined answer with great care)"
   */
  function heterogeneity(i2, tau2) {
    if (!isFin(i2)) {
      throw new Error("research: heterogeneity requires a finite number for i2");
    }
    if (i2 < 0) {
      throw new Error("research: heterogeneity i2 must be non-negative");
    }
    if (tau2 !== undefined && tau2 !== null) {
      if (!isFin(tau2)) {
        throw new Error("research: heterogeneity requires a finite number for tau2");
      }
      if (tau2 < 0) {
        throw new Error("research: heterogeneity tau2 must be non-negative");
      }
    }
    var meaning;
    if (i2 < 25) {
      meaning = "the studies mostly agree";
    } else if (i2 < 50) {
      meaning = "the studies show some disagreement";
    } else if (i2 < 75) {
      meaning = "the studies disagree a lot, so treat the combined answer with care";
    } else {
      meaning = "the studies disagree very strongly, so treat the combined answer with great care";
    }
    var stat = "I2 = " + i2.toFixed(1) + "%";
    if (tau2 !== undefined && tau2 !== null) {
      stat += ", tau2 = " + tau2.toFixed(2);
    }
    return stat + " (" + meaning + ")";
  }

  /* nnt(rr, baselineRisk) -> string | null
   * Number needed to treat (NNT) / harm (NNH).
   * Null when baselineRisk missing or rr == 1.
   * Rounding up (Math.ceil).
   */
  function nnt(rr, baselineRisk) {
    if (baselineRisk === undefined || baselineRisk === null || rr === 1) {
      return null;
    }
    if (!isFin(rr)) {
      throw new Error("research: nnt requires a finite risk ratio");
    }
    if (rr <= 0) {
      throw new Error("research: nnt requires a positive risk ratio");
    }
    if (!isFin(baselineRisk)) {
      throw new Error("research: nnt requires a finite baseline risk");
    }
    if (baselineRisk <= 0) {
      throw new Error("research: nnt requires a positive baseline risk");
    }
    var br = (baselineRisk > 1 && baselineRisk <= 1000) ? (baselineRisk / 1000) : baselineRisk;
    if (br > 1) {
      throw new Error("research: nnt baseline risk must be at most 1 (or 1000 if per 1000)");
    }
    var arr = br * (1 - rr);
    if (arr === 0) {
      return null;
    }
    var count = Math.ceil(1 / Math.abs(arr));
    if (rr < 1) {
      return "Number needed to treat (NNT) " + count + " (treat about " + count + " people to prevent one case)";
    }
    return "Number needed to harm (NNH) " + count + " (treat about " + count + " people to cause one additional case)";
  }

  /* grade(level) -> string
   * High, Moderate, Low, Very low
   */
  function grade(level) {
    if (typeof level !== "string") {
      throw new Error("research: grade requires a string level");
    }
    var norm = level.toLowerCase().replace(/[\s_-]+/g, "");
    if (norm === "high") {
      return "GRADE certainty: High (we are very sure)";
    }
    if (norm === "moderate") {
      return "GRADE certainty: Moderate (probably close to the truth)";
    }
    if (norm === "low") {
      return "GRADE certainty: Low (the real effect could be quite different)";
    }
    if (norm === "verylow") {
      return "GRADE certainty: Very low (we are very unsure)";
    }
    throw new Error("research: unknown GRADE certainty level: " + level);
  }

  /* model(kind) -> string
   * "fixed" | "random"
   */
  function model(kind) {
    if (typeof kind !== "string") {
      throw new Error("research: model requires a string kind");
    }
    var k = kind.toLowerCase().replace(/[\s_-]+/g, "");
    if (k === "random" || k === "randomeffects" || k === "randomdl") {
      return "Random-effects model (assumes each study measures a slightly different true effect)";
    }
    if (k === "fixed" || k === "fixedeffect") {
      return "Fixed-effect model (assumes every study measures the same true effect)";
    }
    throw new Error("research: unknown model kind: " + kind);
  }

  /* forestCaption() -> string */
  function forestCaption() {
    return "Forest plot (each line is one study; the diamond is the combined answer; left of the line means fewer events with the treatment)";
  }

  var EXPLAIN = {
    name: NAME,
    version: VERSION,
    effect: effect,
    pValue: pValue,
    heterogeneity: heterogeneity,
    nnt: nnt,
    grade: grade,
    model: model,
    forestCaption: forestCaption
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = EXPLAIN;
  }
  if (G) {
    G.SMD_RESEARCH_EXPLAIN = EXPLAIN;
  }

})(typeof window !== "undefined" ? window : undefined);
