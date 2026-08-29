/* insulin-ask.js - "Ask MaiK" for the insulin module. Pure, no DOM, no network.
 *
 * THE WHOLE POINT: the language model NEVER computes a dose. It is used, at most, to turn a
 * sentence into SLOTS. The arithmetic is INSULIN_ENGINE's and the safety checks are
 * INSULIN_SAFETY's, both already tested. That is what makes this cheap and safe:
 *   - cheap, because slot extraction is a few dozen output tokens, not a chain of reasoning
 *   - safe, because a hallucinated number cannot become a dose: every slot is range-checked
 *     against physiology before it reaches the engine, and anything unread is ASKED for
 *
 * Most questions need no model at all - parse() is deterministic and free. llmPrompt() and
 * applyLlm() exist only for the residue and are provider-agnostic (Vertex, Gemini, whatever
 * SMD_AI is wired to) because they only exchange JSON.
 *
 * parse(question) -> { slots, ctx, mode, dxType, matched[], unresolved[], confidence }
 * Dual export: window.INSULIN_ASK (app) + module.exports (node --test). */
(function () {
  "use strict";

  // Physiological bounds. A slot outside these is treated as NOT FOUND rather than trusted -
  // this is the guard that stops a misread (or hallucinated) number becoming a dose.
  var BOUNDS = {
    glucose: [20, 1500], fasting: [20, 1500], preDinner: [20, 1500], target: [70, 300],
    weightKg: [1, 400], age: [0, 120], hba1c: [3, 20], egfr: [1, 200], creatinine: [0.1, 20],
    tdd: [1, 400], curBasal: [1, 300], isf: [1, 400], icr: [1, 100], carbs: [1, 400],
    steroidMg: [0.5, 2000], ivRate: [0.1, 50], iob: [0, 50], weeks: [1, 45],
    pmMorning: [1, 200], pmEvening: [1, 200], inpBasal: [1, 300], nutCarbs: [1, 1000]
  };
  function inBounds(k, v) { var b = BOUNDS[k]; return !b || (v >= b[0] && v <= b[1]); }

  function norm(q) {
    return String(q || "").toLowerCase().replace(/[,–—]/g, " ").replace(/\s+/g, " ").trim();
  }
  // First numeric capture of the first pattern that hits, bounds-checked.
  function grab(t, key, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var m = t.match(patterns[i]);
      if (m) { var v = parseFloat(m[1]); if (isFinite(v) && inBounds(key, v)) return v; }
    }
    return null;
  }
  function has(t, words) {
    for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) > -1) return true;
    return false;
  }
  /* mg/dL is canonical here (owner decision). A value written as mmol/L - flagged by the unit,
   * or simply implausible as mg/dL - is converted rather than read as a catastrophic low. */
  function toMgdl(v, t) {
    if (v == null) return null;
    if (/mmol/.test(t) && v < 40) return Math.round(v * 18);
    if (v < 25) return Math.round(v * 18);      // nobody charts a glucose of 12 mg/dL
    return v;
  }
  /* Glucose has to be CONVERTED before it is range-checked: "sugar 12 mmol" is a real reading,
   * and bounds-checking the raw 12 against a mg/dL range would silently discard it. */
  function grabGlucose(t, key, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var m = t.match(patterns[i]);
      if (m) {
        var v = toMgdl(parseFloat(m[1]), t);
        if (v != null && isFinite(v) && inBounds(key, v)) return v;
      }
    }
    return null;
  }

  var NUM = "([0-9]+(?:\\.[0-9]+)?)";
  function rx(s) { return new RegExp(s); }

  function parse(question) {
    var t = norm(question);
    var slots = {}, ctx = {}, matched = [], dxType = null;
    if (!t) return { slots: slots, ctx: ctx, mode: null, dxType: null, matched: [], unresolved: [], confidence: 0, empty: true, text: "" };

    function set(k, v, label) {
      if (v == null) return;
      slots[k] = v; matched.push({ key: k, value: v, label: label || k });
    }

    /* ---- numbers ---- */
    set("glucose", grabGlucose(t, "glucose", [
      rx("(?:sugar|glucose|cbg|rbs|bsl|grbs)\\s*(?:is|of|at|=|:)?\\s*" + NUM),
      rx(NUM + "\\s*(?:mg\\s*/?\\s*dl|mgdl)"),
      rx(NUM + "\\s*mmol")
    ]), "glucose");
    set("fasting", grabGlucose(t, "fasting", [
      rx("(?:fasting|fbs|fbg|morning sugar|pre ?breakfast)\\s*(?:is|of|at|=|:)?\\s*" + NUM)
    ]), "fasting glucose");
    set("preDinner", grabGlucose(t, "preDinner", [
      rx("(?:pre ?dinner|before dinner|evening sugar)\\s*(?:is|of|at|=|:)?\\s*" + NUM)
    ]), "pre-dinner glucose");

    set("weightKg", grab(t, "weightKg", [
      rx(NUM + "\\s*(?:kg|kgs|kilo)"), rx("(?:weight|wt|weighs)\\s*(?:is|of|=|:)?\\s*" + NUM)
    ]), "weight");
    set("age", grab(t, "age", [
      rx(NUM + "\\s*(?:y|yr|yrs|year|years)\\s*(?:old|f|m|male|female)?"),
      rx("age\\s*(?:is|of|=|:)?\\s*" + NUM)
    ]), "age");
    set("hba1c", grab(t, "hba1c", [rx("(?:hba1c|a1c|hb a1c)\\s*(?:is|of|=|:)?\\s*" + NUM)]), "HbA1c");
    set("egfr", grab(t, "egfr", [rx("(?:egfr|gfr)\\s*(?:is|of|=|:)?\\s*" + NUM)]), "eGFR");
    set("creatinine", grab(t, "creatinine", [rx("(?:creatinine|creat)\\s*(?:is|of|=|:)?\\s*" + NUM)]), "creatinine");
    set("carbs", grab(t, "carbs", [
      rx(NUM + "\\s*(?:g|gm|grams?)\\s*(?:of\\s*)?carb"), rx("carb(?:s|ohydrates?)?\\s*(?:is|of|=|:)?\\s*" + NUM)
    ]), "carbohydrates");
    set("isf", grab(t, "isf", [rx("(?:isf|sensitivity factor|correction factor)\\s*(?:is|of|=|:)?\\s*" + NUM)]), "ISF");
    set("icr", grab(t, "icr", [rx("(?:icr|carb ratio)\\s*(?:is|of|=|:)?\\s*" + NUM)]), "carb ratio");
    set("iob", grab(t, "iob", [rx("(?:iob|insulin on board|active insulin)\\s*(?:is|of|=|:)?\\s*" + NUM)]), "insulin on board");
    set("ivRate", grab(t, "ivRate", [
      rx(NUM + "\\s*(?:units?|u)\\s*(?:/|per)\\s*(?:hr|hour|h)\\b"),
      rx("(?:drip|infusion)\\s*(?:at|of|=|:)?\\s*" + NUM)
    ]), "infusion rate");

    // A named basal insulin with a number is a BASAL dose; a bare "on 40 units a day" is a total.
    var basal = grab(t, "curBasal", [
      rx("(?:glargine|lantus|basalog|toujeo|degludec|tresiba|detemir|levemir|nph|insulatard|basal)\\s*(?:insulin)?\\s*" + NUM),
      rx(NUM + "\\s*(?:units?|u)\\s*(?:of\\s*)?(?:glargine|lantus|basalog|toujeo|degludec|tresiba|detemir|levemir|nph|insulatard|basal)"),
      rx("basal\\s*(?:dose|is|of|=|:)?\\s*" + NUM)
    ]);
    if (basal != null) set("curBasal", basal, "current basal dose");
    var tdd = grab(t, "tdd", [
      rx("(?:tdd|total daily dose|total insulin)\\s*(?:is|of|=|:)?\\s*" + NUM),
      rx("(?:on|taking|receiving)\\s*" + NUM + "\\s*(?:units?|u)\\s*(?:a|per)?\\s*day")
    ]);
    if (tdd != null) set("tdd", tdd, "total daily dose");

    // Steroid: dose plus which drug, so the engine can convert to prednisolone-equivalent.
    var STEROIDS = ["prednisolone", "prednisone", "methylprednisolone", "dexamethasone", "hydrocortisone"];
    for (var si = 0; si < STEROIDS.length; si++) {
      var name = STEROIDS[si], stem = name.slice(0, 6);
      if (t.indexOf(stem) > -1 || (name === "dexamethasone" && t.indexOf("dexa") > -1)) {
        slots.steroidKind = name;
        matched.push({ key: "steroidKind", value: name, label: "steroid" });
        var mg = grab(t, "steroidMg", [rx(stem + "[a-z]*\\s*" + NUM), rx(NUM + "\\s*mg\\s*(?:of\\s*)?" + stem), rx(NUM + "\\s*mg")]);
        if (mg != null) set("steroidMg", mg, "steroid dose");
        break;
      }
    }

    /* ---- clinical context ---- */
    if (has(t, ["pregnan", "gdm", "gestational", "antenatal", "primigravida", "obstetric"])) {
      ctx.pregnancy = true; matched.push({ key: "pregnancy", value: true, label: "pregnancy" });
      var wk = grab(t, "weeks", [rx(NUM + "\\s*(?:weeks?|wks?)"), rx("(?:pog|ga)\\s*" + NUM)]);
      var tri = grab(t, "weeks", [rx("trimester\\s*([123])"), rx("([123])(?:st|nd|rd)\\s*trimester")]);
      var trimester = (tri != null && tri >= 1 && tri <= 3) ? tri : (wk != null ? (wk < 14 ? 1 : wk < 28 ? 2 : 3) : null);
      if (trimester) { ctx.trimester = trimester; matched.push({ key: "trimester", value: trimester, label: "trimester" }); }
    }
    if (has(t, ["ckd", "renal", "kidney", "dialysis", "aki", "nephropathy"])) {
      ctx.renal = true; matched.push({ key: "renal", value: true, label: "renal impairment" });
      if (has(t, ["dialysis", "hemodialysis", "haemodialysis", "capd"])) ctx.dialysis = true;
      if (slots.egfr != null) ctx.egfr = slots.egfr;
    }
    if (has(t, ["cirrhosis", "liver", "hepatic", "cld"])) {
      ctx.hepatic = true; matched.push({ key: "hepatic", value: true, label: "liver disease" });
    }
    if (slots.steroidMg != null || has(t, ["steroid", "prednis", "dexa", "methylpred", "hydrocort"])) ctx.steroids = true;
    if (has(t, ["exercise", "walking", "gym", "exertion"])) {
      ctx.exercise = true; matched.push({ key: "exercise", value: true, label: "exercise" });
    }
    if (has(t, ["child", "boy", "girl", "paediatric", "pediatric", "infant", "toddler"]) || (slots.age != null && slots.age < 18)) {
      ctx.pediatric = true; matched.push({ key: "pediatric", value: true, label: "paediatric" });
    }

    /* ---- diabetes type ---- */
    if (has(t, ["type 1", "type1", "t1dm", "t1d", "iddm", "juvenile"])) dxType = "t1";
    else if (has(t, ["type 2", "type2", "t2dm", "t2d", "niddm"])) dxType = "t2";
    else if (has(t, ["pancreatitis", "pancreatectomy", "type 3c", "t3c", "post transplant", "post-transplant", "cystic fibrosis", "cfrd"])) dxType = "secondary";
    else if (has(t, ["steroid induced", "steroid-induced"]) || (slots.steroidMg != null && !has(t, ["type 1", "type 2"]))) dxType = "steroid";
    else if (has(t, ["stress hyperglyc", "no known diabetes", "not a known diabetic", "non diabetic", "newly detected"])) dxType = "stress";

    /* ---- which calculator ----
     * Ordered so the most specific, highest-harm situations win. Every branch names a mode that
     * already exists and is already tested; nothing new is invented here. */
    var mode = null;
    if (has(t, ["dka", "ketoacidosis", "ketoacidotic", "hhs", "hyperosmolar"])) mode = "dka";
    else if (has(t, ["tube feed", "ryles", "ryle", "ng feed", "nasogastric", "peg feed", "enteral", "tpn", "parenteral"])) mode = "nutrition";
    else if (has(t, ["surgery", "operation", "theatre", "preop", "pre-op", "pre op", "operative"])) mode = "periop";
    else if (has(t, ["nil by mouth", "nbm", "npo", "not eating", "nothing by mouth"])) mode = "npo";
    else if (has(t, ["discharge", "going home", "sending home", "home regimen"])) mode = "discharge";
    else if (has(t, ["sick day", "unwell at home", "vomiting", "flu"])) mode = "sick";
    else if (slots.ivRate != null && has(t, ["drip", "infusion", "iv insulin", "off the"])) mode = "ivsc";
    else if (has(t, ["premix", "mixtard", "novomix", "ryzodeg", "30/70", "biphasic"]))
      mode = (slots.pmMorning != null || slots.preDinner != null) ? "premixTitr" : "premix";
    else if (slots.steroidMg != null && ctx.steroids && slots.weightKg != null) mode = "steroid";
    else if (has(t, ["sliding scale", "correction scale", "nursing chart", "chart for the nurse"])) mode = "scale";
    else if (has(t, ["start insulin", "starting insulin", "begin insulin", "initiate", "start on insulin", "insulin naive", "never had insulin"]))
      mode = dxType === "t1" ? "inpatient" : "basalT2";
    else if (has(t, ["admit", "admitted", "admission"]) && slots.weightKg != null) mode = "inpatient";
    else if (slots.curBasal != null && (slots.fasting != null || has(t, ["titrate", "adjust", "increase", "change the dose"]))) mode = "titrate";
    else if (slots.carbs != null && slots.glucose != null) mode = "combined";
    else if (slots.carbs != null) mode = "meal";
    else if (slots.glucose != null) mode = "correction";
    else if (slots.tdd != null && has(t, ["isf", "sensitivity"])) mode = "isf";
    else if (slots.tdd != null && has(t, ["icr", "carb ratio"])) mode = "icr";

    var unresolved = missingFor(mode, slots, ctx);
    // Confidence is about the PARSE, not the clinical decision: did we find a calculator and
    // everything it needs? It never gates the dose - the engine's own guards do that.
    var confidence = !mode ? 0 : (unresolved.length ? 0.5 : 0.9);
    return { slots: slots, ctx: ctx, mode: mode, dxType: dxType, matched: matched,
      unresolved: unresolved, confidence: confidence, text: t };
  }

  /* What each calculator needs, in the parser's vocabulary. Mirrors NEEDS in insulin.js; kept
   * here too so this file stays pure and independently testable. */
  var REQUIRES = {
    correction: [["glucose"], ["isf", "tdd", "weightKg"]],
    combined:   [["glucose"], ["carbs"], ["icr"], ["isf"]],
    meal:       [["carbs"], ["icr"]],
    titrate:    [["curBasal"], ["fasting"]],
    scale:      [["tdd", "weightKg"]],
    basalT2:    [["weightKg"]],
    inpatient:  [["weightKg"]],
    premix:     [["tdd", "weightKg"]],
    premixTitr: [["pmMorning"], ["pmEvening"], ["fasting", "preDinner"]],
    npo:        [["curBasal", "tdd"]],
    steroid:    [["weightKg"], ["steroidMg"]],
    ivsc:       [["ivRate"]],
    nutrition:  [["nutCarbs", "carbs", "weightKg"]],
    periop:     [["curBasal", "tdd"]],
    discharge:  [["inpBasal", "curBasal", "tdd"]],
    sick:       [["tdd", "weightKg"]],
    dka:        [["weightKg"]],
    pediatric:  [["weightKg"]],
    isf:        [["tdd"]],
    icr:        [["tdd"]]
  };
  var LABELS = {
    glucose: "current glucose", fasting: "fasting glucose", preDinner: "pre-dinner glucose",
    weightKg: "weight", tdd: "total daily dose", curBasal: "current basal dose", isf: "ISF",
    icr: "carb ratio", carbs: "carbohydrates", steroidMg: "steroid dose", ivRate: "infusion rate",
    pmMorning: "morning premix dose", pmEvening: "evening premix dose",
    inpBasal: "inpatient basal dose", nutCarbs: "carbohydrate in the feed", hba1c: "HbA1c"
  };
  function missingFor(mode, slots) {
    var req = REQUIRES[mode]; if (!req) return [];
    var out = [];
    req.forEach(function (group) {
      if (!group.some(function (k) { return slots[k] != null; }))
        out.push(group.map(function (k) { return LABELS[k] || k; }).join(" or "));
    });
    return out;
  }

  /* ---- optional LLM assist, for the residue only ----
   * Called ONLY when parse() found no calculator or is missing slots. The prompt asks for a
   * flat JSON object of slots and nothing else - no prose, no reasoning, no dose. That keeps
   * the completion to a few dozen tokens, and means a wrong answer is a wrong NUMBER we then
   * range-check, not a wrong DOSE we would display. Provider-agnostic by design. */
  function llmPrompt(question) {
    return "Extract clinical values from the sentence into flat JSON. Output JSON only, no prose.\n" +
      "Keys (omit any not stated): " + Object.keys(LABELS).join(", ") + ", steroidKind, " +
      "pregnancy (true/false), trimester (1-3), renal, hepatic, dialysis, exercise, " +
      "type ('t1'|'t2'|'stress'|'steroid'|'secondary'), " +
      "task ('correction'|'combined'|'meal'|'titrate'|'scale'|'basalT2'|'inpatient'|'premix'|" +
      "'premixTitr'|'npo'|'steroid'|'ivsc'|'nutrition'|'periop'|'discharge'|'sick'|'dka'|'pediatric'|'isf'|'icr').\n" +
      "All glucose values in mg/dL. Do NOT calculate an insulin dose. Do NOT explain.\n" +
      "Sentence: " + String(question || "").slice(0, 400);
  }
  /* Merge an LLM's JSON into a parse result. Everything is validated: unknown keys dropped,
   * numbers range-checked, a `task` accepted only if it names a real calculator. The model can
   * fill a blank, never overrule what the deterministic parser already read. */
  function applyLlm(parsed, json) {
    var out = { slots: {}, ctx: {}, mode: parsed.mode, dxType: parsed.dxType,
      matched: parsed.matched.slice(), unresolved: [], confidence: parsed.confidence, fromLlm: [] };
    var k;
    for (k in parsed.slots) out.slots[k] = parsed.slots[k];
    for (k in parsed.ctx) out.ctx[k] = parsed.ctx[k];
    if (!json || typeof json !== "object") { out.unresolved = missingFor(out.mode, out.slots); return out; }

    Object.keys(LABELS).concat(["iob", "age", "egfr", "creatinine"]).forEach(function (key) {
      if (out.slots[key] != null) return;                 // the local parse always wins
      var v = json[key];
      if (typeof v === "string") v = parseFloat(v);
      if (typeof v === "number" && isFinite(v) && inBounds(key, v)) {
        out.slots[key] = v; out.fromLlm.push(key);
        out.matched.push({ key: key, value: v, label: LABELS[key] || key, llm: true });
      }
    });
    if (!out.slots.steroidKind && typeof json.steroidKind === "string" &&
        ["prednisolone", "prednisone", "methylprednisolone", "dexamethasone", "hydrocortisone"].indexOf(json.steroidKind) > -1)
      out.slots.steroidKind = json.steroidKind;
    ["pregnancy", "renal", "hepatic", "dialysis", "exercise"].forEach(function (f) {
      if (out.ctx[f] == null && json[f] === true) { out.ctx[f] = true; out.fromLlm.push(f); }
    });
    if (out.ctx.trimester == null && [1, 2, 3].indexOf(json.trimester) > -1) out.ctx.trimester = json.trimester;
    if (!out.dxType && ["t1", "t2", "stress", "steroid", "secondary"].indexOf(json.type) > -1) out.dxType = json.type;
    if (!out.mode && REQUIRES[json.task]) { out.mode = json.task; out.fromLlm.push("task"); }

    out.unresolved = missingFor(out.mode, out.slots);
    out.confidence = !out.mode ? 0 : (out.unresolved.length ? 0.5 : 0.8);
    return out;
  }

  /* Turn a parse into the exact argument object the engine function expects, so the UI can show
   * "MaiK is using: Correction" and then run the SAME code path a human would. */
  function toEngineArgs(p, defaults) {
    var d = defaults || {}, s = p.slots, c = p.ctx;
    var ctx = { pregnancy: !!c.pregnancy, renal: !!c.renal, hepatic: !!c.hepatic,
      exercise: !!c.exercise, steroids: !!c.steroids, pediatric: !!c.pediatric,
      dialysis: !!c.dialysis, egfr: c.egfr != null ? c.egfr : null,
      trimester: c.trimester != null ? c.trimester : null,
      age: s.age != null ? s.age : null, weightKg: s.weightKg != null ? s.weightKg : null };
    // Pregnancy tightens the TARGET rather than scaling the dose - the same rule the manual
    // screen follows, so Ask and the calculator can never disagree.
    var target = s.target != null ? s.target : (c.pregnancy ? 100 : (d.target || 120));
    var inc = d.increment || 1;
    switch (p.mode) {
      case "correction": return { glucose: s.glucose, target: target, isf: s.isf, tdd: s.tdd,
        weightKg: s.weightKg, iob: s.iob, increment: inc, ctx: ctx };
      case "combined":   return { carbs: s.carbs, icr: s.icr, glucose: s.glucose, target: target,
        isf: s.isf, iob: s.iob || 0, increment: inc, ctx: ctx };
      case "meal":       return { carbs: s.carbs, icr: s.icr, increment: inc, ctx: ctx };
      case "titrate":    return { currentDose: s.curBasal, fastingGlucose: s.fasting, weightKg: s.weightKg };
      case "scale":      return { tdd: s.tdd, weightKg: s.weightKg, dxType: p.dxType, target: target, maxPerDose: d.maxBolus || 10 };
      case "basalT2":    return { weightKg: s.weightKg };
      case "inpatient":  return { weightKg: s.weightKg, glucose: s.glucose, age: s.age, creatinine: s.creatinine, egfr: c.egfr, increment: inc };
      case "premix":     return { weightKg: s.weightKg, tdd: s.tdd, increment: inc };
      case "premixTitr": return { morning: s.pmMorning, evening: s.pmEvening, fasting: s.fasting, preDinner: s.preDinner };
      case "npo":        return { basalDose: s.curBasal, tdd: s.tdd, dxType: p.dxType, increment: inc };
      case "steroid":    return { weightKg: s.weightKg, steroid: s.steroidKind || "prednisolone", steroidMg: s.steroidMg, increment: inc };
      case "ivsc":       return { avgRatePerHour: s.ivRate, percent: 0.8, increment: inc };
      case "nutrition":  return { carbGramsPerDay: s.nutCarbs != null ? s.nutCarbs : s.carbs, weightKg: s.weightKg, increment: inc };
      case "periop":     return { basalDose: s.curBasal, tdd: s.tdd, dxType: p.dxType, increment: inc };
      case "discharge":  return { inpatientBasal: s.inpBasal != null ? s.inpBasal : s.curBasal, tdd: s.tdd, hba1c: s.hba1c, dxType: p.dxType, increment: inc };
      case "sick":       return { tdd: s.tdd, weightKg: s.weightKg, dxType: p.dxType, increment: inc };
      case "dka":        return { weightKg: s.weightKg, ratePerKg: 0.1, paeds: !!c.pediatric };
      case "pediatric":  return { weightKg: s.weightKg, stage: "prepubertal" };
      case "isf":        return { tdd: s.tdd, rule: 1800 };
      case "icr":        return { tdd: s.tdd, rule: 500 };
      default: return null;
    }
  }
  // Which engine function a mode routes to. Named so the UI can SHOW the calculator being used.
  var ENGINE_FN = {
    correction: "firstDoseCorrection", combined: "combinedDose", meal: "mealBolus",
    titrate: "basalTitration", scale: "correctionScale", basalT2: "basalInitiation",
    inpatient: "inpatientInit", premix: "premixInit", premixTitr: "premixTitration",
    npo: "npoRegimen", steroid: "steroidCover", ivsc: "ivToSubcut", nutrition: "nutritionInsulin",
    periop: "periopRegimen", discharge: "dischargeRegimen", sick: "sickDayRules",
    dka: "dkaInsulin", pediatric: "pediatricInit", isf: "isfFromTdd", icr: "icrFromTdd"
  };

  var API = { parse: parse, missingFor: missingFor, llmPrompt: llmPrompt, applyLlm: applyLlm,
    toEngineArgs: toEngineArgs, ENGINE_FN: ENGINE_FN, LABELS: LABELS, REQUIRES: REQUIRES, BOUNDS: BOUNDS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.INSULIN_ASK = API;
})();
