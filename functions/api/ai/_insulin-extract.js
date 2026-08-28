/* functions/api/ai/_insulin-extract.js - "Ask MaiK" insulin extraction prompt + sanitizer (server).
 * ===========================================================================
 * One kind, mirroring _maik-ask.js:
 *   insulin-extract : a doctor's free-text scenario -> WHICH calculator mode and WHICH inputs.
 *
 * SAFETY: the model NEVER produces a dose. It selects the engine call and fills its arguments; the
 * units come from INSULIN_ENGINE on the client, through the same validated path the manual
 * calculator uses, so every INSULIN_SAFETY warning and interrupt still fires. The prompt forbids
 * emitting a dose and forbids inventing an unstated value; the sanitizer whitelists the shape and
 * strips anything dose-shaped (defense in depth, matching the client validator in insulin-extract.js).
 * Decision: vault/decisions/Decisions.md 2026-08-28.
 * ======================================================================== */

const MODE_HELP = [
  "combined   - carbohydrates AND a high glucose to correct in the same bolus (needs carbs, ICR, glucose, ISF, IOB)",
  "meal       - carbohydrate cover only (needs carbs, ICR)",
  "correction - a high glucose only, no meal (needs glucose, IOB, and an ISF route: corrSource)",
  "basal      - starting basal insulin from body weight (needs weightKg)",
  "isf        - derive the correction factor from a total daily dose (needs tdd)",
  "icr        - derive the carbohydrate ratio from a total daily dose (needs tdd)",
  "iob        - active insulin from the app's own confirmed-dose log (needs nothing)",
  "pediatric  - paediatric initiation (needs weightKg)",
  "dka        - DKA insulin infusion rate (needs weightKg)"
].join("\n");

const FIELD_HELP = [
  "glucose (mg/dL), target (mg/dL), isf (mg/dL per unit), icr (g per unit), carbs (g),",
  "iob (units of insulin still active), tdd (units/day), fdTdd (usual units/day), weightKg (kg),",
  "age (years), egfr (mL/min), trimester (1|2|3), pedStage (prepubertal|newlydx|pubertal),",
  "fdPriorUnits (units of the last rapid-acting dose), fdPriorMins (minutes since that dose),",
  "tddFactor / fdFactor (units/kg/day), basalFraction (0.2-0.8), dkaRate (units/kg/h),",
  "isfRule (1800|1500), icrRule (500|450), isfOverride (mg/dL per unit),",
  "booleans (true/false only): pregnancy, renal, hepatic, exercise, steroids, dialysis, fdNaive, dkaPaeds"
].join("\n");

export function insulinExtractPrompt(ctx, transcript) {
  ctx = ctx || {};
  const allowed = Array.isArray(ctx.allowedModes) && ctx.allowedModes.length ? ctx.allowedModes : null;
  return "You are MaiK, filling in a doctor's insulin calculator. You are NOT calculating anything.\n" +
    "You do NOT state a dose, a number of units to give, or what the answer will be. The calculator " +
    "computes the dose from the fields you fill; your entire job is to choose the MODE and fill the INPUTS.\n" +
    "\n" +
    "Return ONLY JSON:\n" +
    '{"mode":"","corrSource":"","route":"","rationale":"","fields":[{"key":"","value":0,"from":""}],"questions":[""]}\n' +
    "\n" +
    "MODE must be exactly one of:\n" + MODE_HELP + "\n" +
    (allowed ? "Only these modes are enabled right now: " + JSON.stringify(allowed) + ". If the scenario needs a mode outside this list, still name that mode so the app can steer the doctor.\n" : "") +
    "\n" +
    "corrSource (mode=correction ONLY) - how the correction factor is obtained:\n" +
    '  "isf"      - the doctor stated an ISF / correction factor\n' +
    '  "tdd"      - the doctor stated the patient\'s usual TOTAL DAILY insulin (put it in fdTdd)\n' +
    '  "estimate" - neither is known, only a body weight (put it in weightKg); also set fdNaive true/false if stated\n' +
    "\n" +
    "route - set to \"dka\" or \"pediatric\" ONLY if the text describes diabetic ketoacidosis / HHS, or a child, " +
    "so the app can steer to the right protocol. Otherwise leave it \"\".\n" +
    "\n" +
    "FIELD KEYS - use these names EXACTLY, nothing else:\n" + FIELD_HELP + "\n" +
    "value must be a plain number (or true/false for the booleans listed). Never a string like \"16 units\", " +
    "never a range, never a units-to-give figure.\n" +
    'from = the exact words in the doctor\'s text that gave you this value (e.g. "sugar 320 now"). ' +
    "If you cannot quote the text for a value, DO NOT emit that field.\n" +
    "\n" +
    "THE MOST IMPORTANT RULE - NEVER INVENT AN INPUT.\n" +
    "Only include a field the doctor ACTUALLY STATED. If a required input is not stated - no ISF, no " +
    "weight, no time since the last dose, no carbohydrate amount - LEAVE IT OUT and add a short plain " +
    "question to \"questions\" asking the doctor for it. A guessed or typical value here can cause a " +
    "dangerous dose. Omitting it is always correct; guessing it never is.\n" +
    "Watch for ambiguity: \"on 16 units regular\" may be a standing regular-insulin dose or a dose just " +
    "given. Do not decide. Ask which, in \"questions\".\n" +
    "IOB (insulin on board) is only 0 if the doctor says there has been no recent rapid-acting dose. " +
    "Silence is NOT zero - ask.\n" +
    "\n" +
    "rationale = ONE short line (max 25 words) saying which calculation you chose and why. It must NOT " +
    "contain a dose, a number of units to give, or a prediction of the result. Do not use an em dash.\n" +
    "questions = short plain questions for anything required but unstated or ambiguous. Empty array if none.\n" +
    "\n" +
    "Glucose values are mg/dL (this app is mg/dL only). No prose outside the JSON.\n" +
    "\n=== DOCTOR'S TEXT ===\n" + String(transcript || "");
}

const MODES = { combined: 1, meal: 1, correction: 1, basal: 1, isf: 1, icr: 1, iob: 1, pediatric: 1, dka: 1 };
const CORR_SOURCES = { isf: 1, tdd: 1, estimate: 1 };
const ROUTES = { dka: 1, pediatric: 1 };
const FIELD_KEYS = new Set(["glucose", "target", "isf", "icr", "carbs", "iob", "tdd", "isfRule", "icrRule",
  "tddFactor", "basalFraction", "fdTdd", "fdFactor", "fdPriorUnits", "fdPriorMins", "fdNaive", "isfOverride",
  "dkaRate", "dkaPaeds", "pedStage", "weightKg", "age", "egfr", "trimester",
  "pregnancy", "renal", "hepatic", "exercise", "steroids", "dialysis"]);

// The rationale must never smuggle the answer back in as prose ("give 6 units"). It is deliberately
// narrow: a rationale legitimately quotes an INPUT ("usual TDD 16 units stated"), and a clarifying
// question legitimately quotes one too ("was the 16 units just given?") - the owner's own example
// depends on that question surviving. So only a RECOMMENDATION is stripped, i.e. a giving verb
// followed closely by a number of units. Questions are not filtered at all: they are rendered under
// "answer these first" and can never be mistaken for, or unblock, a result.
const DOSE_ADVICE = /\b(give|giving|administer|inject|start with|recommend\w*|suggest\w*|dose of|bolus of)\b[^.]{0,30}?\d+(\.\d+)?\s*(u|iu|units?)\b/i;
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").replace(/[—–]/g, "-").trim().slice(0, n);

export function sanitizeInsulinExtract(parsed) {
  const out = { mode: "", corrSource: "", route: "", rationale: "", fields: [], questions: [] };
  if (!parsed || typeof parsed !== "object") return out;

  const mode = clean(parsed.mode, 20).toLowerCase();
  if (!MODES[mode]) return out;                                   // unknown mode -> empty; client reports "could not tell"
  out.mode = mode;
  if (CORR_SOURCES[parsed.corrSource]) out.corrSource = parsed.corrSource;
  if (ROUTES[parsed.route]) out.route = parsed.route;

  // Strip a rationale that states a dose - the model must never answer the question.
  const rat = clean(parsed.rationale, 200);
  out.rationale = DOSE_ADVICE.test(rat) ? "" : rat;

  if (Array.isArray(parsed.fields)) {
    parsed.fields.forEach((f) => {
      if (!f || typeof f !== "object" || out.fields.length >= 24) return;
      const key = clean(f.key, 30).split(".").pop();
      if (!FIELD_KEYS.has(key)) return;                           // whitelist only
      let value = f.value;
      if (typeof value === "boolean") { /* keep as-is */ }
      else if (key === "pedStage") { value = clean(value, 20); if (!value) return; }
      else {
        const n = Number(value);
        if (value === null || value === "" || !Number.isFinite(n)) return;
        value = n;
      }
      out.fields.push({ key, value, from: clean(f.from, 120) });
    });
  }

  if (Array.isArray(parsed.questions)) {
    parsed.questions.forEach((q) => {
      if (out.questions.length >= 6) return;
      const t = clean(q, 160);
      if (t) out.questions.push(t);
    });
  }
  return out;
}
