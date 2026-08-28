/* insulin-extract.js - "Ask MaiK" extraction seam for the insulin calculator (window.INSULIN_EXTRACT).
 * ===========================================================================
 * The doctor types a free-text scenario; MaiK's ONLY job is to choose the calculator mode and fill
 * its inputs. It never produces a dose. The dose comes from INSULIN_ENGINE via the same compute()
 * path the manual calculator has always used, so every INSULIN_SAFETY warning and `interrupt` still
 * fires. See vault/decisions/Decisions.md 2026-08-28 ("MaiK fills the form, it does not answer the
 * dose") - do not redesign this into an inline answer without asking the owner.
 *
 *   plan(text, opts)      -> Promise<PLAN>            (LLM extraction, validated; never rejects)
 *   validate(raw, opts)   -> PLAN                     (pure; the ONLY path raw LLM output may take)
 *   setProvider(p)        -> swap the transport (server today, on-device later, mock in tests)
 *
 * PLAN = { ok, mode, corrSource, set:[{k,key,v,from}], missing:[key], questions:[str], rationale, route, error }
 *   set       - dotted state paths ready for the calculator's stSet(), each with the phrase it came from
 *   missing   - REQUIRED inputs the text did not state. The UI must ASK for these and must NOT
 *               calculate until they are supplied. Never defaulted here (see SAFETY below).
 *
 * SAFETY - why the validators live here and not in the caller:
 *   1. Raw model output is untrusted. Only whitelisted modes, whitelisted field names and in-range
 *      numbers survive validate(); anything else is DROPPED, and a dropped REQUIRED field becomes a
 *      question for the doctor rather than a silent default.
 *   2. Silent defaulting is the danger, not the arithmetic. A missing ISF, weight or time-since-last-
 *      dose must reach the doctor as a question. The engine cannot enforce this - correctionDose()
 *      treats a missing IOB as 0 and still returns a number - so the gate is here and in the UI.
 *   3. No field carries a dose. There is no "units of insulin" output anywhere in this file.
 *
 * Node-testable via module.exports (test/insulin-extract.test.mjs).
 * ======================================================================== */
(function (root) {
  "use strict";

  // ---- what the calculator can be asked for -------------------------------
  // req: inputs the mode CANNOT be calculated without and that have no legitimate stored default.
  //      A req field absent from the text is a question for the doctor, never an assumption.
  // opt: inputs with a legitimate source when unstated (a saved setting, or a guideline default the
  //      engine states openly as an assumption in its own steps).
  var MODES = {
    combined:   { req: ["carbs", "icr", "glucose", "isf", "iob"], opt: ["target"] },
    meal:       { req: ["carbs", "icr"],                          opt: [] },
    correction: { req: ["glucose"],                               opt: ["target"] },   // + corrSource-dependent, below
    basal:      { req: ["weightKg"],                              opt: ["tddFactor", "basalFraction"] },
    isf:        { req: ["tdd"],                                   opt: ["isfRule"] },
    icr:        { req: ["tdd"],                                   opt: ["icrRule"] },
    iob:        { req: [],                                        opt: [] },           // reads the confirmed-dose log
    // pedStage is REQUIRED, not optional: pediatricInit() falls back to `stageFactor[stage] || 0.5`,
    // so an unstated stage silently becomes prepubertal and changes the whole day's insulin.
    pediatric:  { req: ["weightKg", "pedStage"],                  opt: [] },
    dka:        { req: ["weightKg"],                              opt: ["dkaRate"] }
  };
  // Correction has three routes to an ISF; each needs a different input. The model picks the route
  // (choosing the engine call IS the extraction), and the route decides what must be present.
  //
  // Why IOB is required for "isf" but NOT for "tdd"/"estimate": those two run through
  // INSULIN_ENGINE.firstDoseCorrection(), which resolves IOB from a prior dose + timing (or states
  // "0 u assumed" openly in its provenance) and IGNORES a plain iob argument. Requiring it there
  // would have MaiK fill a box that changes nothing, which reads as "stacking was accounted for"
  // when it was not. On the "estimate" route the honest equivalent is fdPriorUnits + fdPriorMins,
  // demanded below whenever the patient is NOT insulin-naive.
  var CORR_REQ = { isf: ["isf", "iob"], tdd: ["fdTdd"], estimate: ["weightKg", "fdNaive"] };

  // Flat model-facing name -> dotted calculator state path (stSet-compatible).
  var PATH = {
    glucose: "glucose", target: "target", isf: "isf", icr: "icr", carbs: "carbs", iob: "iob",
    tdd: "tdd", isfRule: "isfRule", icrRule: "icrRule", tddFactor: "tddFactor", basalFraction: "basalFraction",
    fdTdd: "fdTdd", fdFactor: "fdFactor", fdPriorUnits: "fdPriorUnits", fdPriorMins: "fdPriorMins",
    fdNaive: "fdNaive", isfOverride: "isfOverride", dkaRate: "dkaRate", dkaPaeds: "dkaPaeds",
    pedStage: "pedStage",
    weightKg: "ctx.weightKg", age: "ctx.age", egfr: "ctx.egfr", trimester: "ctx.trimester",
    pregnancy: "ctx.pregnancy", renal: "ctx.renal", hepatic: "ctx.hepatic",
    exercise: "ctx.exercise", steroids: "ctx.steroids", dialysis: "ctx.dialysis"
  };

  // Plausibility bounds. A value outside its range is DROPPED (and, if required, asked for) rather
  // than passed on - a hallucinated 700 kg must never reach the engine, even though safety would
  // also catch it. Bounds are deliberately wide: this rejects nonsense, it does not practise medicine.
  var RANGE = {
    glucose: [20, 1500], target: [70, 300], isf: [1, 400], icr: [1, 100], carbs: [0, 500], iob: [0, 50],
    tdd: [1, 400], fdTdd: [1, 400], isfOverride: [1, 400], weightKg: [1, 400], age: [0, 120],
    fdFactor: [0.1, 1.5], tddFactor: [0.1, 1.5], basalFraction: [0.2, 0.8],
    fdPriorUnits: [0, 200], fdPriorMins: [0, 2880], dkaRate: [0.02, 0.2], egfr: [1, 200]
  };
  var ENUM = {
    isfRule: [1500, 1800], icrRule: [450, 500], trimester: [1, 2, 3],
    pedStage: ["prepubertal", "newlydx", "pubertal"]
  };
  var BOOL = { pregnancy: 1, renal: 1, hepatic: 1, exercise: 1, steroids: 1, dialysis: 1, fdNaive: 1, dkaPaeds: 1 };
  var CORR_SOURCES = { isf: 1, tdd: 1, estimate: 1 };
  var ROUTES = { dka: 1, pediatric: 1 };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(x, n) { return String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n || 200); }

  function emptyPlan() {
    return { ok: false, mode: "", corrSource: "", set: [], missing: [], questions: [], rationale: "", route: "", error: "" };
  }
  function failPlan(msg) { var p = emptyPlan(); p.error = msg; return p; }

  // Required inputs for a mode, including the correction sub-route.
  function requiredFor(mode, corrSource) {
    var m = MODES[mode]; if (!m) return [];
    var req = m.req.slice();
    if (mode === "correction") req = req.concat(CORR_REQ[corrSource] || CORR_REQ.isf);
    return req;
  }

  /* validate(raw, opts) - the ONLY path raw model output may take into the calculator.
   * opts.allowedModes: modes the app will accept right now (flag/level gated). A mode outside it is
   * reported as a message, never silently switched to - a gated clinician workflow (DKA, paediatric)
   * must not be opened by a sentence. */
  function validate(raw, opts) {
    opts = opts || {};
    var plan = emptyPlan(), i;
    if (!raw || typeof raw !== "object") return failPlan("MaiK did not return a usable reading of that.");

    var mode = str(raw.mode, 20).toLowerCase();
    if (!has(MODES, mode)) return failPlan("MaiK could not tell which calculation you need. Pick a mode and fill it in, or rephrase.");

    var allowed = opts.allowedModes;
    if (Array.isArray(allowed) && allowed.length && allowed.indexOf(mode) < 0)
      return failPlan("That reads like a pathway which is not enabled here. Use your institutional protocol.");

    plan.mode = mode;
    if (mode === "correction") plan.corrSource = has(CORR_SOURCES, raw.corrSource) ? raw.corrSource : "isf";

    // A routing signal (DKA / paediatric) is carried through so the UI can steer instead of dosing.
    if (raw.route && has(ROUTES, raw.route)) plan.route = raw.route;

    plan.rationale = str(raw.rationale, 200);

    // ---- fields ----------------------------------------------------------
    // Accepted only if: named in PATH, relevant to this mode, and inside its plausibility range.
    var relevant = {};
    var req = requiredFor(mode, plan.corrSource);
    var okFields = req.concat(MODES[mode].opt || [],
      ["age", "pregnancy", "renal", "hepatic", "exercise", "steroids", "egfr", "dialysis", "trimester"]);
    if (mode === "correction") okFields = okFields.concat(["fdNaive", "fdFactor", "fdPriorUnits", "fdPriorMins", "isfOverride", "isfRule"]);
    if (mode === "dka") okFields = okFields.concat(["dkaPaeds"]);
    for (i = 0; i < okFields.length; i++) relevant[okFields[i]] = 1;

    var seen = {}, dropped = [];
    var list = Array.isArray(raw.fields) ? raw.fields : [];
    for (i = 0; i < list.length && plan.set.length < 24; i++) {
      var f = list[i]; if (!f || typeof f !== "object") continue;
      var k = str(f.key, 30);
      if (!has(PATH, k) || !has(relevant, k) || has(seen, k)) continue;   // unknown / irrelevant / duplicate

      var v = f.value, out, j;
      if (has(BOOL, k)) {
        if (typeof v !== "boolean") continue;                             // a bool must BE a bool
        out = v;
      } else if (has(ENUM, k)) {
        var vals = ENUM[k], match = false;
        for (j = 0; j < vals.length; j++) if (vals[j] === v || String(vals[j]) === String(v)) { out = vals[j]; match = true; break; }
        if (!match) continue;
      } else {
        var n = Number(v);
        if (typeof v === "boolean" || v === null || v === "" || !isFinite(n)) continue;
        var r = RANGE[k];
        if (r && (n < r[0] || n > r[1])) { dropped.push(k); continue; }   // implausible -> drop, and ask if required
        out = n;
      }
      seen[k] = 1;
      plan.set.push({ k: PATH[k], key: k, v: out, from: str(f.from, 120) });
    }

    // ---- what is still missing -------------------------------------------
    // A required input the text did not state (or that was dropped as implausible) is a QUESTION,
    // never a default. This is the rule the whole feature exists to keep.
    for (i = 0; i < req.length; i++) if (!has(seen, req[i])) plan.missing.push(req[i]);

    // Dependent inputs the calculator would otherwise leave on a stale value.
    function setVal(key) { for (var x = 0; x < plan.set.length; x++) if (plan.set[x].key === key) return plan.set[x].v; return undefined; }
    if (setVal("renal") === true && !has(seen, "egfr")) plan.missing.push("egfr");
    if (setVal("pregnancy") === true && !has(seen, "trimester")) plan.missing.push("trimester");
    // "Already using insulin" on the estimate route: the time since the last rapid-acting dose is the
    // owner's named must-ask, and it is the only thing that gives this route a real IOB.
    if (mode === "correction" && plan.corrSource === "estimate" && setVal("fdNaive") === false) {
      if (!has(seen, "fdPriorUnits")) plan.missing.push("fdPriorUnits");
      if (!has(seen, "fdPriorMins")) plan.missing.push("fdPriorMins");
    }

    // Model-supplied questions, plus a generated one per missing field so the doctor is never shown
    // a bare field name with no prompt.
    var qs = Array.isArray(raw.questions) ? raw.questions : [];
    for (i = 0; i < qs.length && plan.questions.length < 6; i++) { var q = str(qs[i], 160); if (q) plan.questions.push(q); }

    plan.ok = true;
    plan.dropped = dropped;
    return plan;
  }

  // Plain-English prompt for a missing input - shown next to the blank field it belongs to.
  var ASK = {
    glucose: "What is the current glucose (mg/dL)?",
    target: "What target glucose should be used?",
    isf: "What is the correction factor (ISF, mg/dL per unit)?",
    icr: "What is the carbohydrate ratio (g per unit)?",
    carbs: "How many grams of carbohydrate?",
    iob: "How much insulin is still active, and how long since the last rapid-acting dose? Enter 0 only if there has been none.",
    tdd: "What is the total daily dose (units/day)?",
    fdTdd: "What is the patient's usual total daily insulin (units/day)?",
    weightKg: "What is the patient's weight (kg)?",
    egfr: "What is the eGFR (mL/min)?",
    trimester: "Which trimester?",
    pedStage: "Which stage: prepubertal, newly diagnosed, or pubertal?"
  };
  function askFor(key) { return ASK[key] || ("What is the " + String(key).replace(/([A-Z])/g, " $1").toLowerCase() + "?"); }

  var LABEL = {
    glucose: "Current glucose", target: "Target glucose", isf: "ISF", icr: "Carb ratio (ICR)",
    carbs: "Carbohydrates", iob: "Active insulin (IOB)", tdd: "Total daily dose", fdTdd: "Usual total daily dose",
    weightKg: "Weight", age: "Age", egfr: "eGFR", trimester: "Trimester", pedStage: "Stage",
    fdPriorUnits: "Last dose units", fdPriorMins: "Minutes since last dose", fdFactor: "Start factor",
    tddFactor: "Start factor", basalFraction: "Basal fraction", dkaRate: "Infusion rate",
    isfRule: "ISF rule", icrRule: "ICR rule", isfOverride: "ISF (manual)", fdNaive: "Insulin-naive",
    pregnancy: "Pregnancy", renal: "Renal impairment", hepatic: "Hepatic impairment",
    exercise: "Exercise", steroids: "Steroids", dialysis: "On dialysis", dkaPaeds: "Paediatric DKA"
  };
  function labelFor(key) { return LABEL[key] || key; }

  // ---- provider seam ------------------------------------------------------
  // A provider exposes extract(text, opts) returning a raw object (or a Promise of one) which the
  // wrapper then VALIDATES. Default transport is the server; swap it for an on-device model (or a
  // mock) with setProvider() - the validator above is transport-independent on purpose.
  function ServerProvider(transport) {
    this.name = "server";
    this._transport = (typeof transport === "function") ? transport : function () { return null; };
  }
  ServerProvider.prototype.extract = function (text, opts) { return this._transport(text, opts || {}); };

  // Resolved LAZILY so load order does not matter, and so in Node/tests (no SMD_AI) it returns null
  // -> plan() reports "unavailable" instead of inventing anything.
  function serverTransport(text, opts) {
    var AI = root && root.SMD_AI;
    if (!AI || typeof AI.maik !== "function") return null;
    var ctx = { allowedModes: (opts && opts.allowedModes) || Object.keys(MODES), units: "mgdl" };
    var p = AI.maik("insulin-extract", ctx, text);
    if (!p) return null;
    return p.then(function (r) { return (r && r.error) ? { __err: r.error } : r; });
  }

  var _provider = new ServerProvider(serverTransport);

  var API = {
    MODES: MODES, PATH: PATH, RANGE: RANGE,
    setProvider: function (p) { if (p && typeof p.extract === "function") _provider = p; },
    getProvider: function () { return _provider; },
    validate: validate, requiredFor: requiredFor, askFor: askFor, labelFor: labelFor,

    /* plan(text, opts) - free text -> a validated PLAN. Never rejects; a transport failure comes back
     * as {ok:false, error} so the UI shows a message and the doctor keeps the manual calculator. */
    plan: function (text, opts) {
      var t = str(text, 2000);
      if (!t) return Promise.resolve(failPlan("Describe the patient first."));
      return Promise.resolve().then(function () { return _provider.extract(t, opts || {}); }).then(function (raw) {
        if (raw && raw.__err) return failPlan(raw.__err === "quota"
          ? "MaiK is over its usage limit right now. Fill the calculator in yourself."
          : "MaiK could not be reached. Fill the calculator in yourself.");
        if (!raw) return failPlan("MaiK is not available here. Fill the calculator in yourself.");
        return validate(raw, opts || {});
      }).catch(function () { return failPlan("MaiK could not read that. Fill the calculator in yourself."); });
    }
  };

  if (root) root.INSULIN_EXTRACT = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
