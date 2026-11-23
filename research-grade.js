/* StewardMD - ResearchMD GRADE module M (window.SMD_RESEARCH_GRADE).
 * Phase 4.3. Pure ES5 IIFE: no DOM, no Date, no Math.random, no I/O.
 * Dual export: browser global SMD_RESEARCH_GRADE and CommonJS module.exports.
 * Contract: docs/research/contracts/phase-4/grade.md.
 *
 * Certainty arithmetic (GRADE): start High for RCTs, Low for observational
 * designs; downgrade one level per serious domain and two per very serious
 * domain across risk of bias, inconsistency, indirectness, imprecision and
 * publication bias; upgrade (observational only, and only when nothing was
 * downgraded) for large effect, dose-response and plausible confounding.
 * Clamp to Very low .. High. Every downgrade and upgrade needs a non-empty
 * human reason and reviewer id, else this throws "research: ...".
 *
 * suggestImprecision / suggestInconsistency are deterministic SUGGESTIONS.
 * They never mutate their input and are never applied automatically; a human
 * accepts them in the screen.
 *
 * Number formatting (fixed rules, used by summaryOfFindings and its text):
 *  - Relative effects and CI bounds: 2 decimals (toFixed(2)).
 *  - Absolute effects per 1000: nearest whole number (Math.round) in text;
 *    numeric fields keep full precision for downstream use.
 *  - I2: 1 decimal. CI bounds are joined with " to ", never an em-dash.
 *  - Participants and study counts: integers; unknown participants -> null.
 *
 * Absolute effects per 1000 (GRADE handbook, assumed control risk ACR =
 * baselineRisk / 1000):
 *  - RR: intervention risk = ACR * RR; difference per 1000 =
 *    baselineRisk * (RR - 1); CI from the pooled RR CI bounds.
 *  - OR: intervention risk = OR * ACR / (1 - ACR + OR * ACR); difference per
 *    1000 = 1000 * (intervention risk - ACR); CI from the pooled OR bounds.
 *  - RD: the pooled risk difference IS the absolute effect; per 1000 =
 *    RD * 1000, no baseline risk needed.
 *  - MD / SMD / HR: no per-1000 conversion; absolute is null.
 */
(function (G) {
  "use strict";

  var VERSION = "rmd1";
  var NAME = "research-grade";

  /* Index 0 .. 3, worst to best. */
  var CERTAINTY = ["Very low", "Low", "Moderate", "High"];
  var SYMBOL_FILL = "⊕"; /* circled plus */
  var SYMBOL_EMPTY = "◯"; /* large circle */

  var DOMAINS = [
    { key: "riskOfBias", label: "Risk of bias" },
    { key: "inconsistency", label: "Inconsistency" },
    { key: "indirectness", label: "Indirectness" },
    { key: "imprecision", label: "Imprecision" },
    { key: "publicationBias", label: "Publication bias" }
  ];
  var UPGRADES = [
    { key: "largeEffect", label: "Large effect" },
    { key: "doseResponse", label: "Dose-response gradient" },
    { key: "plausibleConfounding", label: "Plausible confounding" }
  ];
  var LEVELS = { no: 0, serious: 1, very_serious: 2 };
  var RATIO = { OR: 1, RR: 1, HR: 1 };

  function isFin(n) { return typeof n === "number" && isFinite(n); }

  function trimStr(v) {
    return (typeof v === "string") ? v.replace(/^\s+|\s+$/g, "") : "";
  }

  function fmt2(n) { return Number(n).toFixed(2); }

  function symbolsFor(index) {
    var s = "", i;
    for (i = 0; i < 4; i++) s += (i <= index) ? SYMBOL_FILL : SYMBOL_EMPTY;
    return s;
  }

  function levelsWord(n) { return n === 1 ? "one level" : "two levels"; }

  /* Read one downgrade domain. All five are required; level "no" needs no
   * reason, any downgrade needs a non-empty reason and reviewer id. */
  function readDomain(def, entry) {
    if (!entry || typeof entry !== "object") {
      throw new Error("research: GRADE domain " + def.key + " is required ({level, reason, by})");
    }
    var level = entry.level;
    if (!LEVELS.hasOwnProperty(level)) {
      throw new Error("research: GRADE domain " + def.key + " has unknown level " + level + " (want no, serious or very_serious)");
    }
    var reason = trimStr(entry.reason);
    var by = trimStr(entry.by);
    if (LEVELS[level] > 0) {
      if (!reason) throw new Error("research: GRADE domain " + def.key + " needs a reason for a " + level + " downgrade");
      if (!by) throw new Error("research: GRADE domain " + def.key + " needs a reviewer id (by) for a downgrade");
    }
    return { domain: def.key, label: def.label, levels: LEVELS[level], level: level, reason: reason, by: by };
  }

  /* Read one upgrade entry. Accepted shapes: the number 0 (no upgrade) or
   * {levels: 0|1|2, reason, by}. A positive upgrade without a reason throws:
   * upgrades are human judgments, never bare numbers. */
  function readUpgrade(def, entry) {
    var levels, reason, by;
    if (entry === undefined || entry === null) return { domain: def.key, label: def.label, levels: 0, reason: "", by: "" };
    if (typeof entry === "number") {
      if (entry !== 0 && entry !== 1 && entry !== 2) {
        throw new Error("research: GRADE upgrade " + def.key + " levels must be 0, 1 or 2");
      }
      if (entry === 0) return { domain: def.key, label: def.label, levels: 0, reason: "", by: "" };
      throw new Error("research: GRADE upgrade " + def.key + " needs a reason ({levels, reason, by})");
    }
    if (typeof entry !== "object") {
      throw new Error("research: GRADE upgrade " + def.key + " must be 0 or {levels, reason, by}");
    }
    levels = entry.levels;
    if (levels !== 0 && levels !== 1 && levels !== 2) {
      throw new Error("research: GRADE upgrade " + def.key + " levels must be 0, 1 or 2");
    }
    reason = trimStr(entry.reason);
    by = trimStr(entry.by);
    if (levels > 0) {
      if (!reason) throw new Error("research: GRADE upgrade " + def.key + " needs a reason for an upgrade");
      if (!by) throw new Error("research: GRADE upgrade " + def.key + " needs a reviewer id (by) for an upgrade");
    }
    return { domain: def.key, label: def.label, levels: levels, reason: reason, by: by };
  }

  /* assessOutcome(input) -> certainty judgment.
   * input: {outcome, design: "rct"|"observational", run (engine run result,
   * carried for provenance), riskOfBias, inconsistency, indirectness,
   * imprecision, publicationBias (each {level, reason, by}), upgrades
   * ({largeEffect, doseResponse, plausibleConfounding}, observational only)}.
   * Returns {outcome, design, certainty, startedAt, downgrades, upgrades,
   * symbols, footnotes}. Pure: never mutates input. */
  function assessOutcome(input) {
    if (!input || typeof input !== "object") throw new Error("research: assessOutcome needs an input object");
    var outcome = trimStr(input.outcome);
    if (!outcome) throw new Error("research: assessOutcome needs an outcome name");
    var design = input.design;
    if (design !== "rct" && design !== "observational") {
      throw new Error("research: assessOutcome design must be rct or observational");
    }
    if (!input.run || typeof input.run !== "object") {
      throw new Error("research: assessOutcome needs an engine run result");
    }
    var startIndex = (design === "rct") ? 3 : 1;
    var downgrades = [], upgrades = [];
    var downTotal = 0, upTotal = 0, i, d, u, raw, index, footnotes = [];
    for (i = 0; i < DOMAINS.length; i++) {
      d = readDomain(DOMAINS[i], input[DOMAINS[i].key]);
      if (d.levels > 0) {
        downgrades.push({ domain: d.domain, label: d.label, levels: d.levels, reason: d.reason, by: d.by });
        downTotal += d.levels;
        footnotes.push("Downgraded " + levelsWord(d.levels) + " for " + d.label.toLowerCase() + ": " + d.reason);
      }
    }
    var upInput = input.upgrades || {};
    for (i = 0; i < UPGRADES.length; i++) {
      u = readUpgrade(UPGRADES[i], upInput[UPGRADES[i].key]);
      if (u.levels > 0) {
        if (design === "rct") {
          throw new Error("research: GRADE upgrades apply to observational designs only");
        }
        upTotal += u.levels;
        upgrades.push({ domain: u.domain, label: u.label, levels: u.levels, reason: u.reason, by: u.by });
      }
    }
    var appliedUpgrades = upgrades;
    if (design === "observational" && downTotal > 0 && upTotal > 0) {
      appliedUpgrades = [];
      footnotes.push("Upgrades were not applied because at least one domain was downgraded.");
    }
    var appliedUp = 0;
    for (i = 0; i < appliedUpgrades.length; i++) {
      appliedUp += appliedUpgrades[i].levels;
      footnotes.push("Upgraded " + levelsWord(appliedUpgrades[i].levels) + " for " + appliedUpgrades[i].label.toLowerCase() + ": " + appliedUpgrades[i].reason);
    }
    raw = startIndex - downTotal + appliedUp;
    index = raw;
    if (index < 0) { index = 0; footnotes.push("Certainty was clamped at Very low."); }
    if (index > 3) { index = 3; footnotes.push("Certainty was clamped at High."); }
    return {
      outcome: outcome,
      design: design,
      certainty: CERTAINTY[index],
      startedAt: CERTAINTY[startIndex],
      downgrades: downgrades,
      upgrades: appliedUpgrades,
      symbols: symbolsFor(index),
      footnotes: footnotes
    };
  }

  /* Run helpers: measure and analysis-scale null value. */
  function runMeasure(run) {
    var m = run && run.manifest && run.manifest.measure;
    if (!m) throw new Error("research: suggestion needs a run result with manifest.measure");
    return m;
  }
  /* The null is 0 on the analysis scale for every measure (log ratio or
   * natural difference); on the display scale it is 1 for ratios, 0 else. */
  function nullAnalysis() { return 0; }
  function nullDisplay(measure) { return RATIO[measure] ? 1 : 0; }
  function toDisplay(measure, v) { return RATIO[measure] ? Math.exp(v) : v; }
  function ciLevelPct(run) {
    var lvl = (run.manifest && isFin(run.manifest.level)) ? run.manifest.level : 0.95;
    return Math.round(lvl * 100) + "% CI";
  }
  function crosses(lo, hi, t) { return lo <= t && t <= hi; }

  var OIS_NOTE = " Optimal information size was not computed; confirm the pooled sample size against it.";

  /* suggestImprecision(run, mid) -> {suggested, why}. SUGGESTION ONLY.
   * mid is an optional minimal important difference on the DISPLAY scale
   * (a ratio threshold for OR/RR/HR, natural units for RD/MD/SMD).
   * serious when the CI crosses the null or the MID; very serious when it
   * crosses both (a MID equal to the null counts once). Boundaries are
   * inclusive. The optimal information size is never computed here; the
   * suggestion always flags that a human must check it. */
  function suggestImprecision(run, mid) {
    if (!run || typeof run !== "object" || !run.pooled) {
      throw new Error("research: suggestImprecision needs an engine run result");
    }
    var measure = runMeasure(run);
    var p = run.pooled;
    if (!isFin(p.effect) || !isFin(p.ciLower) || !isFin(p.ciUpper)) {
      throw new Error("research: suggestImprecision needs a finite pooled effect and CI");
    }
    var nullA = nullAnalysis();
    var nullD = nullDisplay(measure);
    var hasMid = (mid !== undefined && mid !== null);
    var midA = null, midD = null;
    if (hasMid) {
      if (!isFin(mid)) throw new Error("research: suggestImprecision mid must be a finite number");
      if (RATIO[measure] && !(mid > 0)) throw new Error("research: suggestImprecision mid must be positive for " + measure);
      midD = mid;
      midA = RATIO[measure] ? Math.log(mid) : mid;
    }
    var crossNull = crosses(p.ciLower, p.ciUpper, nullA);
    var crossMid = hasMid && midA !== nullA && crosses(p.ciLower, p.ciUpper, midA);
    var lo = toDisplay(measure, p.ciLower), hi = toDisplay(measure, p.ciUpper);
    var ciText = "(" + fmt2(lo) + " to " + fmt2(hi) + ")";
    var suggested, why;
    if (crossNull && crossMid) {
      suggested = "very_serious";
      why = "The " + ciLevelPct(run) + " " + ciText + " crosses both the null (" + nullD + ") and the minimal important difference (" + fmt2(midD) + ").";
    } else if (crossNull) {
      suggested = "serious";
      why = "The " + ciLevelPct(run) + " " + ciText + " crosses the null (" + nullD + ").";
    } else if (crossMid) {
      suggested = "serious";
      why = "The " + ciLevelPct(run) + " " + ciText + " crosses the minimal important difference (" + fmt2(midD) + ").";
    } else {
      suggested = "no";
      why = "The " + ciLevelPct(run) + " " + ciText + " crosses neither the null (" + nullD + ")" +
        (hasMid && midA !== nullA ? " nor the minimal important difference (" + fmt2(midD) + ")" : "") + ".";
    }
    return { suggested: suggested, why: why + OIS_NOTE };
  }

  /* suggestInconsistency(run) -> {suggested, why}. SUGGESTION ONLY.
   * serious when I2 >= 75 or the prediction interval crosses the null.
   * The prediction interval is null when k < 3; that is noted, not guessed. */
  function suggestInconsistency(run) {
    if (!run || typeof run !== "object" || !run.pooled || !run.heterogeneity) {
      throw new Error("research: suggestInconsistency needs an engine run result");
    }
    var measure = runMeasure(run);
    var i2 = run.heterogeneity.i2;
    if (!isFin(i2)) throw new Error("research: suggestInconsistency needs a finite I2");
    var pi = run.predictionInterval || null;
    var nullA = nullAnalysis();
    var nullD = nullDisplay(measure);
    var highI2 = i2 >= 75;
    var piCross = false, piText = "";
    if (pi && isFin(pi.lower) && isFin(pi.upper)) {
      piCross = crosses(pi.lower, pi.upper, nullA);
      piText = "(" + fmt2(toDisplay(measure, pi.lower)) + " to " + fmt2(toDisplay(measure, pi.upper)) + ")";
    }
    var parts = [];
    if (highI2) parts.push("I2 = " + i2.toFixed(1) + "% is at or above 75%.");
    else parts.push("I2 = " + i2.toFixed(1) + "% is below 75%.");
    if (pi && piText) {
      if (piCross) parts.push("The prediction interval " + piText + " crosses the null (" + nullD + ").");
      else parts.push("The prediction interval " + piText + " excludes the null (" + nullD + ").");
    } else {
      parts.push("Prediction interval not available (fewer than 3 included studies).");
    }
    return { suggested: (highI2 || piCross) ? "serious" : "no", why: parts.join(" ") };
  }

  /* ---- Summary of Findings ---------------------------------------------- */

  function includedInputIds(run) {
    var excluded = {}, i, inputs, out;
    var ex = run.excluded || [];
    for (i = 0; i < ex.length; i++) excluded[String(ex[i].id)] = 1;
    inputs = (run.manifest && run.manifest.inputs) || [];
    out = [];
    for (i = 0; i < inputs.length; i++) {
      if (!excluded[String(inputs[i].id)]) out.push(inputs[i]);
    }
    return out;
  }

  function participantsOf(run) {
    var inc = includedInputIds(run), total = 0, saw = false, i, v, n1, n2;
    for (i = 0; i < inc.length; i++) {
      v = inc[i].values || {};
      n1 = Number(v.n1); n2 = Number(v.n2);
      if (isFin(n1) && isFin(n2)) { total += n1 + n2; saw = true; }
    }
    return saw ? total : null;
  }

  function studiesOf(run) {
    if (run.weights && run.weights.length) return run.weights.length;
    return includedInputIds(run).length;
  }

  function per1000BoundText(v) {
    var r = Math.round(v);
    if (r === 0) return "no difference";
    return Math.abs(r) + " " + (r < 0 ? "fewer" : "more");
  }

  function per1000Text(diff, lo, hi) {
    var r = Math.round(diff);
    var main = (r === 0) ? "no difference per 1000" : Math.abs(r) + " " + (r < 0 ? "fewer" : "more") + " per 1000";
    return main + " (" + per1000BoundText(lo) + " to " + per1000BoundText(hi) + ")";
  }

  /* Absolute effect per 1000 for binary measures. Returns null when not
   * estimable (MD/SMD/HR, or OR/RR without a baseline risk). Numeric fields
   * keep full precision; text rounds per the fixed rules above. */
  function absoluteEffect(run, baselineRisk) {
    var measure = runMeasure(run);
    var p = run.pooled;
    var hasBR = (baselineRisk !== undefined && baselineRisk !== null && baselineRisk !== "");
    var br = hasBR ? Number(baselineRisk) : null;
    if (hasBR && (!isFin(br) || br < 0 || br > 1000)) {
      throw new Error("research: baselineRisk must be between 0 and 1000 (per 1000)");
    }
    var est, lo, hi, acr, risk, diff, dLo, dHi, control, intervention, method;
    if (measure === "RD") {
      est = p.effect; lo = p.ciLower; hi = p.ciUpper;
      diff = est * 1000; dLo = lo * 1000; dHi = hi * 1000;
      control = hasBR ? br : null;
      intervention = hasBR ? br + diff : null;
      method = "pooled risk difference";
    } else if (measure === "RR" || measure === "OR") {
      if (!hasBR) return null;
      est = Math.exp(p.effect); lo = Math.exp(p.ciLower); hi = Math.exp(p.ciUpper);
      acr = br / 1000;
      if (measure === "RR") {
        risk = acr * est;
        diff = br * (est - 1);
        dLo = br * (lo - 1);
        dHi = br * (hi - 1);
        method = "RR times assumed control risk (GRADE handbook)";
      } else {
        risk = est * acr / (1 - acr + est * acr);
        diff = 1000 * (risk - acr);
        dLo = 1000 * (lo * acr / (1 - acr + lo * acr) - acr);
        dHi = 1000 * (hi * acr / (1 - acr + hi * acr) - acr);
        method = "OR converted to risks (GRADE handbook)";
      }
      control = br;
      intervention = risk * 1000;
    } else {
      return null;
    }
    return {
      per1000: diff,
      ciLower: dLo,
      ciUpper: dHi,
      controlPer1000: control,
      interventionPer1000: intervention,
      method: method,
      text: per1000Text(diff, dLo, dHi)
    };
  }

  var SOF_COLUMNS = [
    { key: "outcome", label: "Outcome" },
    { key: "participants", label: "Participants" },
    { key: "studies", label: "Studies" },
    { key: "relative", label: "Relative effect (CI)" },
    { key: "absolute", label: "Absolute effect per 1000 (CI)" },
    { key: "certainty", label: "Certainty" },
    { key: "footnotes", label: "Footnotes" }
  ];

  /* summaryOfFindings(rows) -> {columns, rows}.
   * rows: [{outcome, run, grade (assessOutcome result), baselineRisk?}].
   * Pure: builds new objects, never mutates the inputs. */
  function summaryOfFindings(rows) {
    if (!rows || Object.prototype.toString.call(rows) !== "[object Array]") {
      throw new Error("research: summaryOfFindings needs an array of rows");
    }
    var out = [], i, row, run, grade, measure, p, est, lo, hi, relText;
    var abs, footnotes, participants, studies;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (!row || typeof row !== "object") throw new Error("research: summaryOfFindings row " + (i + 1) + " must be an object");
      if (!trimStr(row.outcome)) throw new Error("research: summaryOfFindings row " + (i + 1) + " needs an outcome name");
      run = row.run;
      if (!run || typeof run !== "object" || !run.pooled) {
        throw new Error("research: summaryOfFindings row " + (i + 1) + " needs an engine run result");
      }
      grade = row.grade;
      if (!grade || CERTAINTY.indexOf(grade.certainty) === -1) {
        throw new Error("research: summaryOfFindings row " + (i + 1) + " needs a grade with a certainty label");
      }
      measure = runMeasure(run);
      p = run.pooled;
      est = toDisplay(measure, p.effect);
      lo = toDisplay(measure, p.ciLower);
      hi = toDisplay(measure, p.ciUpper);
      relText = measure + " " + fmt2(est) + " (" + fmt2(lo) + " to " + fmt2(hi) + ")";
      abs = absoluteEffect(run, row.baselineRisk);
      participants = participantsOf(run);
      studies = studiesOf(run);
      footnotes = (grade.footnotes || []).slice();
      if (abs && (measure === "RR" || measure === "OR")) {
        footnotes.push("Absolute effects assume a control risk of " + row.baselineRisk + " per 1000; " + abs.method + ".");
      }
      out.push({
        outcome: trimStr(row.outcome),
        participants: participants,
        studies: studies,
        relative: { measure: measure, estimate: est, ciLower: lo, ciUpper: hi, text: relText },
        absolute: abs,
        certainty: grade.certainty,
        symbols: grade.symbols || symbolsFor(CERTAINTY.indexOf(grade.certainty)),
        footnotes: footnotes
      });
    }
    return { columns: SOF_COLUMNS.slice(), rows: out };
  }

  /* Plain-text rendering of a summaryOfFindings table for copy/export.
   * Deterministic, no em-dashes. */
  function summaryOfFindingsText(table) {
    if (!table || !table.columns || !table.rows) throw new Error("research: summaryOfFindingsText needs a table model");
    var lines = ["Summary of Findings"], i, j, row, cells, labels = [];
    for (i = 0; i < table.columns.length; i++) labels.push(table.columns[i].label);
    lines.push(labels.join(" | "));
    for (i = 0; i < table.rows.length; i++) {
      row = table.rows[i];
      cells = [
        row.outcome,
        row.participants === null ? "Not reported" : String(row.participants),
        String(row.studies),
        row.relative.text,
        row.absolute ? row.absolute.text : "Not applicable",
        row.symbols + " " + row.certainty,
        row.footnotes.join("; ")
      ];
      lines.push(cells.join(" | "));
    }
    if (table.rows.length === 0) lines.push("No graded outcomes yet.");
    lines.push("");
    lines.push("Certainty: " + SYMBOL_FILL + SYMBOL_FILL + SYMBOL_FILL + SYMBOL_FILL + " High, " +
      SYMBOL_FILL + SYMBOL_FILL + SYMBOL_FILL + SYMBOL_EMPTY + " Moderate, " +
      SYMBOL_FILL + SYMBOL_FILL + SYMBOL_EMPTY + SYMBOL_EMPTY + " Low, " +
      SYMBOL_FILL + SYMBOL_EMPTY + SYMBOL_EMPTY + SYMBOL_EMPTY + " Very low.");
    for (i = 0; i < table.rows.length; i++) {
      row = table.rows[i];
      for (j = 0; j < row.footnotes.length; j++) {
        lines.push(row.outcome + " footnote " + (j + 1) + ": " + row.footnotes[j]);
      }
    }
    return lines.join("\n");
  }

  var GRADE = {
    name: NAME,
    version: VERSION,
    certaintyLabels: CERTAINTY.slice(),
    domains: DOMAINS.slice(),
    upgradeDomains: UPGRADES.slice(),
    assessOutcome: assessOutcome,
    suggestImprecision: suggestImprecision,
    suggestInconsistency: suggestInconsistency,
    summaryOfFindings: summaryOfFindings,
    summaryOfFindingsText: summaryOfFindingsText
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = GRADE; }
  if (G) { G.SMD_RESEARCH_GRADE = GRADE; }

})(typeof window !== "undefined" ? window : undefined);
