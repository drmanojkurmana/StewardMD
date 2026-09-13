/* wardsynq/wardsynq-forms.js — configuration-driven clinical forms. PURE: no I/O, no eval, unit-tested.
 *
 * A hospital defines a form (triage, nursing assessment, procedure checklist...) as data: sections, fields,
 * validation, conditional visibility, calculated fields, terminology codes, which roles and departments may
 * use it, and when it is in force. A form is DRAFT until published; a published version never changes - a
 * change is a new version - so every saved response names the exact definition it was answered against.
 *
 * MALFORMED CONFIGURATION FAILS SAFELY AND VISIBLY. validateDefinition() returns every problem it finds, and
 * a definition with any problem cannot be published, and cannot be answered. Nothing is guessed: an unknown
 * field type, a condition pointing at a field that does not exist, a calculation that refers to itself, all
 * refuse the whole form rather than rendering part of it.
 *
 * CONDITIONS AND CALCULATIONS ARE A SMALL DECLARED LANGUAGE, NEVER CODE. A condition is
 * { field, op, value } (ops: eq, ne, gt, gte, lt, lte, in, filled, empty) or { all: [...] } / { any: [...] };
 * a calculation is { op: "sum"|"product"|"bmi"|"count_true", fields: [...] }. There is no string that is ever
 * executed, so a form definition cannot run anything.
 */

const FIELD_TYPES = Object.freeze(["text", "textarea", "number", "integer", "date", "datetime", "boolean", "single_choice", "multi_choice", "calculated"]);
const OPS = Object.freeze(["eq", "ne", "gt", "gte", "lt", "lte", "in", "filled", "empty"]);
const CALCS = Object.freeze(["sum", "product", "bmi", "count_true"]);
const KEY = /^[a-z][a-z0-9_]{0,59}$/;

class FormError extends Error { constructor(code, message, problems) { super(message); this.code = code; this.problems = problems || []; } }

function fieldsOf(def) { return (def.sections || []).flatMap((s) => s.fields || []); }

function conditionRefs(cond) {
  if (!cond) return [];
  if (Array.isArray(cond.all)) return cond.all.flatMap(conditionRefs);
  if (Array.isArray(cond.any)) return cond.any.flatMap(conditionRefs);
  return [cond.field];
}

/** Every problem in a definition, as plain sentences. An empty list means it can be published. */
function validateDefinition(def) {
  const p = [];
  if (!def || typeof def !== "object") return ["the form definition is missing"];
  if (!KEY.test(String(def.key || ""))) p.push("form key must be lower-case letters, digits and underscores");
  if (!String(def.title || "").trim()) p.push("form needs a title");
  if (!Array.isArray(def.sections) || !def.sections.length) p.push("form needs at least one section");
  const seen = new Map();
  for (const s of def.sections || []) {
    if (!String(s.title || "").trim()) p.push("every section needs a title");
    if (!Array.isArray(s.fields) || !s.fields.length) p.push(`section "${s.title || "?"}" has no fields`);
    for (const f of s.fields || []) {
      if (!KEY.test(String(f.key || ""))) { p.push(`field key "${f.key}" is not valid`); continue; }
      if (seen.has(f.key)) p.push(`field "${f.key}" appears twice`);
      seen.set(f.key, f);
      if (!FIELD_TYPES.includes(f.type)) p.push(`field "${f.key}" has unknown type "${f.type}"`);
      if (!String(f.label || "").trim()) p.push(`field "${f.key}" needs a label`);
      if ((f.type === "single_choice" || f.type === "multi_choice") && !(Array.isArray(f.options) && f.options.length)) p.push(`field "${f.key}" is a choice with no options`);
      if (f.min != null && f.max != null && Number(f.min) > Number(f.max)) p.push(`field "${f.key}" has min above max`);
      if (f.type === "calculated") {
        if (!f.calc || !CALCS.includes(f.calc.op)) p.push(`calculated field "${f.key}" has no known calculation`);
        else if (!Array.isArray(f.calc.fields) || !f.calc.fields.length) p.push(`calculated field "${f.key}" uses no fields`);
        if (f.required) p.push(`calculated field "${f.key}" cannot be required; it is computed`);
      }
    }
  }
  for (const f of seen.values()) {
    for (const ref of conditionRefs(f.showWhen)) if (!seen.has(ref)) p.push(`field "${f.key}" is shown depending on "${ref}", which does not exist`);
    if (f.showWhen) for (const c of [f.showWhen].flatMap(function flat(x) { return x.all ? x.all.flatMap(flat) : x.any ? x.any.flatMap(flat) : [x]; })) if (!OPS.includes(c.op)) p.push(`field "${f.key}" has an unknown condition "${c.op}"`);
    if (f.showWhen && conditionRefs(f.showWhen).includes(f.key)) p.push(`field "${f.key}" is shown depending on itself`);
    if (f.type === "calculated" && f.calc && Array.isArray(f.calc.fields)) {
      for (const ref of f.calc.fields) {
        if (ref === f.key) p.push(`calculated field "${f.key}" refers to itself`);
        else if (!seen.has(ref)) p.push(`calculated field "${f.key}" uses "${ref}", which does not exist`);
        else if (seen.get(ref).type === "calculated") p.push(`calculated field "${f.key}" uses another calculated field "${ref}"; calculations do not chain`);
      }
      if (f.calc.op === "bmi" && f.calc.fields.length !== 2) p.push(`BMI field "${f.key}" needs exactly weight (kg) and height (cm)`);
    }
    if (f.code && !(f.code.system && f.code.code)) p.push(`field "${f.key}" has a terminology code without system and code`);
  }
  if (def.effectiveFrom && def.effectiveTo && def.effectiveFrom > def.effectiveTo) p.push("effective dates are the wrong way round");
  return p;
}

const filled = (v) => !(v == null || v === "" || (Array.isArray(v) && !v.length));
function test(cond, answers) {
  if (!cond) return true;
  if (Array.isArray(cond.all)) return cond.all.every((c) => test(c, answers));
  if (Array.isArray(cond.any)) return cond.any.some((c) => test(c, answers));
  const v = answers[cond.field];
  switch (cond.op) {
    case "filled": return filled(v);
    case "empty": return !filled(v);
    case "eq": return v === cond.value;
    case "ne": return v !== cond.value;
    case "in": return Array.isArray(cond.value) && cond.value.includes(v);
    case "gt": return Number(v) > Number(cond.value);
    case "gte": return Number(v) >= Number(cond.value);
    case "lt": return Number(v) < Number(cond.value);
    case "lte": return Number(v) <= Number(cond.value);
    default: return false;
  }
}

function calculate(calc, answers) {
  const nums = calc.fields.map((k) => answers[k]);
  if (calc.op === "count_true") return nums.filter((x) => x === true).length;
  if (nums.some((x) => typeof x !== "number" || !Number.isFinite(x))) return null;   // not all inputs present: no value, never a guess
  if (calc.op === "sum") return nums.reduce((a, b) => a + b, 0);
  if (calc.op === "product") return nums.reduce((a, b) => a * b, 1);
  if (calc.op === "bmi") { const [kg, cm] = nums; return cm > 0 ? Math.round((kg / (cm / 100) ** 2) * 10) / 10 : null; }
  return null;
}

/**
 * Checks a response against a published definition. Returns { answers, errors }: answers holds only visible
 * fields (a hidden field's stale value is dropped, not stored), with calculated fields computed here - a
 * value sent for a calculated field is ignored. errors maps field key -> sentence.
 */
function evaluateResponse(def, raw) {
  const problems = validateDefinition(def);
  if (problems.length) throw new FormError("definition_invalid", "this form's definition has problems and cannot be answered", problems);
  const input = { ...(raw || {}) };
  const fields = fieldsOf(def);
  const answers = {}, errors = {};
  // Visibility is decided on the raw input so that a controlling field's value decides what shows.
  for (const f of fields) {
    if (f.type === "calculated") continue;
    if (!test(f.showWhen, input)) continue;
    let v = input[f.key];
    if (!filled(v)) { if (f.required) errors[f.key] = `${f.label} is required`; continue; }
    switch (f.type) {
      case "number": case "integer":
        if (typeof v === "string" && v.trim() !== "") v = Number(v);
        if (typeof v !== "number" || !Number.isFinite(v)) { errors[f.key] = `${f.label} must be a number`; continue; }
        if (f.type === "integer" && !Number.isInteger(v)) { errors[f.key] = `${f.label} must be a whole number`; continue; }
        if (f.min != null && v < Number(f.min)) { errors[f.key] = `${f.label} must be at least ${f.min}`; continue; }
        if (f.max != null && v > Number(f.max)) { errors[f.key] = `${f.label} must be at most ${f.max}`; continue; }
        break;
      case "boolean": if (typeof v !== "boolean") { errors[f.key] = `${f.label} must be yes or no`; continue; } break;
      case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) { errors[f.key] = `${f.label} must be a date`; continue; } break;
      case "datetime": if (isNaN(Date.parse(v))) { errors[f.key] = `${f.label} must be a date and time`; continue; } break;
      case "single_choice": if (!f.options.some((o) => o.value === v)) { errors[f.key] = `${f.label}: choose one of the listed options`; continue; } break;
      case "multi_choice": if (!Array.isArray(v) || v.some((x) => !f.options.some((o) => o.value === x))) { errors[f.key] = `${f.label}: choose from the listed options`; continue; } break;
      default: v = String(v).slice(0, f.type === "textarea" ? 8000 : 500);
    }
    answers[f.key] = v;
  }
  for (const f of fields) if (f.type === "calculated" && test(f.showWhen, input)) { const c = calculate(f.calc, answers); if (c != null) answers[f.key] = c; }
  return { answers, errors, valid: !Object.keys(errors).length };
}

/** Is this definition usable by this role/department today? Returns null or the reason it is not. */
function applicabilityProblem(def, { role, department, date }) {
  if (def.status !== "published") return "this form is not published";
  if (def.effectiveFrom && date < def.effectiveFrom) return `this form is in force from ${def.effectiveFrom}`;
  if (def.effectiveTo && date > def.effectiveTo) return `this form was retired on ${def.effectiveTo}`;
  if (Array.isArray(def.roles) && def.roles.length && !def.roles.includes(role)) return "this form is not for your role";
  if (Array.isArray(def.departments) && def.departments.length && department && !def.departments.includes(department)) return "this form is not used in this department";
  return null;
}

/** Publishing: refused while any problem remains. Returns the published definition. */
function publish(def, version, at) {
  const problems = validateDefinition(def);
  if (problems.length) throw new FormError("definition_invalid", "fix these problems before publishing", problems);
  return { ...def, status: "published", version, publishedAt: at };
}

export { FIELD_TYPES, OPS, CALCS, FormError, validateDefinition, evaluateResponse, applicabilityProblem, publish, fieldsOf };
