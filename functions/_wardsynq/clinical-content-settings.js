/* functions/_wardsynq/clinical-content-settings.js - the hospital's critical limits, note templates, MAR times, delta limits
 * and autoverification rules, edited on Admin > Hospital (R4-4, audit D4).
 *
 * THE ONLY WAY IN. These five settings were read by the ward and the laboratory (router: critical check, templated note,
 * medication round, result release) and written by nothing but a raw POST /org/update with no check, so a limit with its low
 * above its high, or a round time of "8am", was saved as if it were sound, and each consumer then quietly fell back to its
 * default or dropped the rule. /org/update now refuses the keys and points here; GET/POST /org/clinical-settings/<key> is the
 * door, the formulary-settings.js pattern: a dry run item by item, any problem refuses the whole save, a commit writes only the
 * dry run's result (confirmCount, planId), needs a reason and the name of whoever signed the values off, and is audited.
 *
 * EACH CHECK IS THE CONSUMER'S OWN READING, made strict. critical-results.js limitsFor skips a limit with no numeric bound,
 * mar-schedule.js timesFor drops back to the default round on one bad time, lab-delta.js limitFor ignores a rule with no
 * threshold and note-templates.js resolveTemplate refuses default text: each of those silent fallbacks is refused here instead,
 * so what is saved is what the ward and the laboratory will actually apply.
 *
 * WardSynQ ships no values here. Empty is "not configured", read exactly as the consumers read it today: critical limits and
 * MAR times fall back to the built-in defaults in their own files, note templates to the built-in notes, delta checks are not
 * done and nothing is autoverified. Nothing is prefilled from a default as if it were the hospital's value.
 */
import { DEFAULT_CRITICAL_LIMITS, canonUnit } from "./critical-results.js";
import { DEFAULT_MAR_TIMES } from "./mar-schedule.js";
import { resolveTemplate, BUILT_IN_TEMPLATES } from "./note-templates.js";
import { LAB_CODE_SEED } from "../../wardsynq/adapters/wardsynq-ghis-adapter.js";
import { CAPS } from "../_queue_roles.js";

const str = (v) => (v == null ? "" : String(v).trim());
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export const CONTENT_KEYS = Object.freeze(["criticalLimits", "deltaLimits", "autoVerify", "marTimes", "noteTemplates"]);
/* Who may change each, beside staff.admin. No settings capability exists (_queue_roles.js), so each key takes the capability of
 * the people who act on it: laboratory values lab.result, the medication round order.verify (pharmacy verification, the
 * formulary's pairing), note templates emr.treat (writing a clinical note). Today only admin holds staff.admin with any of them. */
export const CAP_FOR = Object.freeze({ criticalLimits: CAPS.LAB_RESULT, deltaLimits: CAPS.LAB_RESULT, autoVerify: CAPS.LAB_RESULT, marTimes: CAPS.ORDER_VERIFY, noteTemplates: CAPS.EMR_TREAT });
export const SIGNOFF_KEY = "clinicalContentSignOff";

/* The laboratory codes a released result can carry (lab-result.js codeForTest maps test names through LAB_CODE_SEED). A limit or
 * rule under any other code would never meet a result, and would look configured while checking nothing. */
export const KNOWN_LAB_CODES = Object.freeze((() => {
  const out = {};
  for (const k of Object.keys(LAB_CODE_SEED)) { const v = LAB_CODE_SEED[k]; if (v && v.code && !out[v.code]) out[v.code] = v.display; }
  return out;
})());
const MAX_TEMPLATES = 50, MAX_SECTIONS = 40, MAX_TEXT = 200;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const MESSAGES = {
  not_an_object: "Send this setting in its saved shape.",
  unknown_code: "No laboratory result carries this code, so the rule would never be applied.",
  unit_required: "Give the unit the limit is written in. A result in another unit is not compared.",
  no_bound: "Give a low limit, a high limit or both.",
  bad_number: "A value is not a number above zero.",
  low_not_below_high: "The low limit must be below the high limit.",
  no_threshold: "Give a largest change as a value, as a percentage, or both.",
  enabled_not_yes_no: "Say whether autoverification is on or off.",
  enabled_without_codes: "Autoverification is on but no test is listed, so nothing would be released unread. Turn it off or list the tests.",
  duplicate: "This is listed twice.",
  unknown_frequency: "This is not a frequency the medication round schedules (OD, BD, TDS, QID, OM, HS).",
  bad_time: "A time must be written as HH:MM on the 24 hour clock, from 00:00 to 23:59.",
  wrong_count: "The number of times must match the frequency (for example three for TDS).",
  times_out_of_order: "Give the times in order through the day. The 1-0-1 notation takes the morning, midday and night times by position.",
  template_incomplete: "A template needs an id and a name.",
  template_empty: "A template needs at least one section.",
  no_key: "A section needs a key or a title.",
  default_text_not_allowed: "A section may carry a question, never default text.",
  too_long: "A value is longer than 200 characters.",
  too_many: "More templates or sections than this setting can hold (50 templates, 40 sections each).",
};
const problem = (item, reason, extra) => ({ item: String(item), reason, message: MESSAGES[reason], ...(extra || {}) });
const posNum = (v) => { if (v === null || v === undefined || v === "") return null; const n = typeof v === "number" ? v : Number(str(v)); return Number.isFinite(n) && n > 0 ? n : NaN; };
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = typeof v === "number" ? v : Number(str(v)); return Number.isFinite(n) ? n : NaN; };
const long = (...xs) => xs.some((x) => str(x).length > MAX_TEXT);

/** PURE. The value as stored, when nothing is saved. Every consumer reads these exactly as it reads an absent setting. */
export function emptyOf(key) { return key === "noteTemplates" ? [] : key === "autoVerify" ? { enabled: false, codes: [] } : {}; }

function checkCritical(v, problems) {
  const out = {};
  for (const code of Object.keys(v)) {
    const r = v[code], c = str(code);
    if (!isObj(r)) { problems.push(problem(c, "not_an_object")); continue; }
    const before = problems.length;
    if (!KNOWN_LAB_CODES[c]) problems.push(problem(c, "unknown_code"));
    if (!str(r.unit)) problems.push(problem(c, "unit_required"));
    const low = num(r.low), high = num(r.high);
    if (Number.isNaN(low) || Number.isNaN(high)) problems.push(problem(c, "bad_number"));
    else if (low === null && high === null) problems.push(problem(c, "no_bound"));
    else if (low !== null && high !== null && low >= high) problems.push(problem(c, "low_not_below_high"));
    if (long(r.display, r.unit)) problems.push(problem(c, "too_long"));
    if (problems.length === before) out[c] = { display: str(r.display) || KNOWN_LAB_CODES[c], unit: canonUnit(r.unit), low, high };
  }
  return out;
}
function checkDelta(v, problems) {
  const out = {};
  for (const code of Object.keys(v)) {
    const r = v[code], c = str(code);
    if (!isObj(r)) { problems.push(problem(c, "not_an_object")); continue; }
    const before = problems.length;
    if (!KNOWN_LAB_CODES[c]) problems.push(problem(c, "unknown_code"));
    const a = posNum(r.maxAbsolute), p = posNum(r.maxPercent), w = posNum(r.withinHours);
    if ([a, p, w].some(Number.isNaN)) problems.push(problem(c, "bad_number"));
    else if (a === null && p === null) problems.push(problem(c, "no_threshold"));
    if (problems.length === before) {
      out[c] = {};
      if (a !== null) out[c].maxAbsolute = a;
      if (p !== null) out[c].maxPercent = p;
      if (w !== null) out[c].withinHours = w;
    }
  }
  return out;
}
function checkAuto(v, problems) {
  if (typeof v.enabled !== "boolean") problems.push(problem("enabled", "enabled_not_yes_no"));
  if (v.codes != null && !Array.isArray(v.codes)) { problems.push(problem("codes", "not_an_object")); return null; }
  const codes = [];
  for (const raw of v.codes || []) {
    const c = str(raw);
    if (!c) continue;
    if (codes.includes(c)) { problems.push(problem(c, "duplicate")); continue; }
    if (!KNOWN_LAB_CODES[c]) problems.push(problem(c, "unknown_code"));
    codes.push(c);
  }
  if (v.enabled === true && !codes.length) problems.push(problem("enabled", "enabled_without_codes"));
  return { enabled: v.enabled === true, codes };
}
function checkMar(v, problems) {
  const out = {};
  for (const k of Object.keys(v)) {
    const key = str(k).toUpperCase(), times = v[k];
    if (!DEFAULT_MAR_TIMES[key]) { problems.push(problem(k, "unknown_frequency")); continue; }
    if (out[key]) { problems.push(problem(key, "duplicate")); continue; }
    if (!Array.isArray(times)) { problems.push(problem(key, "not_an_object")); continue; }
    const list = times.map(str);
    const before = problems.length;
    if (list.some((t) => !TIME.test(t))) problems.push(problem(key, "bad_time"));
    else if (list.length !== DEFAULT_MAR_TIMES[key].length) problems.push(problem(key, "wrong_count", { expected: DEFAULT_MAR_TIMES[key].length }));
    else if (list.some((t, i) => i && t <= list[i - 1])) problems.push(problem(key, "times_out_of_order"));
    if (problems.length === before) out[key] = list;
  }
  return out;
}
function checkTemplates(v, problems) {
  if (v.length > MAX_TEMPLATES) problems.push(problem("templates", "too_many"));
  const out = [], ids = new Set();
  v.forEach((d, i) => {
    const label = isObj(d) && str(d.id) ? str(d.id) : "#" + (i + 1);
    if (!isObj(d)) { problems.push(problem(label, "not_an_object")); return; }
    const before = problems.length;
    const r = resolveTemplate(d);
    if (!r.ok) problems.push(problem(label, r.error));
    for (const p of r.problems || []) problems.push(problem(label, p.reason, p.key ? { section: p.key } : undefined));
    if (ids.has(str(d.id).toLowerCase())) problems.push(problem(label, "duplicate"));
    ids.add(str(d.id).toLowerCase());
    if (Array.isArray(d.sections) && d.sections.length > MAX_SECTIONS) problems.push(problem(label, "too_many"));
    if (long(d.id, d.name, d.version, d.noteType) || (d.sections || []).some((s) => isObj(s) && long(s.key, s.title, s.prompt))) problems.push(problem(label, "too_long"));
    if (problems.length !== before) return;
    const t = { id: r.id, name: r.name };
    if (str(d.version)) t.version = r.version;
    if (str(d.noteType)) t.noteType = r.noteType;
    t.sections = r.sections.map((s) => ({ key: s.key, title: s.title, ...(s.prompt ? { prompt: s.prompt } : {}), ...(s.required ? { required: true } : {}) }));
    out.push(t);
  });
  return out;
}

/**
 * PURE. One setting checked as a whole. -> { value (the stored shape, only when there is no problem), problems[{item, reason, message}] }
 * null or undefined is "not configured" and checks clean to the empty shape.
 */
export function checkContent(key, raw) {
  const problems = [];
  if (!CONTENT_KEYS.includes(key)) return { value: null, problems: [problem(key, "not_an_object")] };
  if (raw == null) return { value: emptyOf(key), problems };
  const wantArray = key === "noteTemplates";
  if (wantArray ? !Array.isArray(raw) : !isObj(raw)) return { value: null, problems: [problem(key, "not_an_object")] };
  const value = key === "criticalLimits" ? checkCritical(raw, problems) : key === "deltaLimits" ? checkDelta(raw, problems)
    : key === "autoVerify" ? checkAuto(raw, problems) : key === "marTimes" ? checkMar(raw, problems) : checkTemplates(raw, problems);
  return { value: problems.length ? null : value, problems };
}

/* The items a change is counted in: a code, a frequency, a template id, or autoverification's switch and each listed test. */
function itemsOf(key, value) {
  const m = new Map();
  if (!value) return m;
  if (key === "noteTemplates") value.forEach((t) => m.set(t.id, JSON.stringify(t)));
  else if (key === "autoVerify") { m.set("enabled", String(value.enabled)); value.codes.forEach((c) => m.set(c, "listed")); }
  else Object.keys(value).forEach((k) => m.set(k, JSON.stringify(value[k])));
  return m;
}
async function sha16(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The plan for replacing the saved value with `after`. The saved value is read through the same check, so one saved before this
 * route (possibly with problems) is compared as the consumers would read it. changeCount is what a commit's confirmCount must equal.
 * -> { ok, value, rows[{item, status, problems?}], counts, changeCount, planId, problems }
 */
export async function planContent(key, before, after) {
  const prev = checkContent(key, before);
  const next = checkContent(key, after);
  const was = itemsOf(key, prev.value), now = itemsOf(key, next.value);
  const rows = [];
  const bad = new Map();
  next.problems.forEach((p) => bad.set(p.item, [...(bad.get(p.item) || []), { reason: p.reason, message: p.message, ...(p.section ? { section: p.section } : {}), ...(p.expected ? { expected: p.expected } : {}) }]));
  for (const [item, list] of bad) rows.push({ item, status: "invalid", problems: list });
  if (next.value) for (const [item, v] of now) {
    // autoVerify's switch is always an item; "off" against nothing saved is not a change.
    const old = was.has(item) ? was.get(item) : item === "enabled" ? "false" : undefined;
    rows.push({ item, status: old === undefined ? "add" : old === v ? "unchanged" : "change" });
  }
  const removed = next.value ? [...was.keys()].filter((k) => !now.has(k)) : [];
  removed.forEach((item) => rows.push({ item, status: "remove" }));
  const count = (s) => rows.filter((r) => r.status === s).length;
  const counts = { add: count("add"), change: count("change"), unchanged: count("unchanged"), remove: count("remove"), invalid: count("invalid") };
  const changeCount = counts.add + counts.change + counts.remove;
  const planId = await sha16(JSON.stringify([key, prev.value, next.value]));
  return { ok: next.problems.length === 0, value: next.value, rows, counts, changeCount, planId, problems: next.problems, savedProblems: prev.problems };
}

/** PURE. The audit row's meta, within the org audit chain's 200 characters (_opd_org_store.js updateOrg). */
export function auditMeta(key, plan, reason, signedOffBy) {
  const names = plan.rows.filter((r) => r.status !== "unchanged" && r.status !== "invalid").map((r) => ({ add: "+", change: "~", remove: "-" })[r.status] + r.item);
  let out = `${key} add ${plan.counts.add} change ${plan.counts.change} remove ${plan.counts.remove} plan ${plan.planId} signed ${str(signedOffBy).slice(0, 40)} why ${str(reason).slice(0, 50)} :`;
  let shown = 0;
  for (const n of names) {
    const rest = names.length - shown - 1;
    if ((out + " " + n + (rest > 0 ? ` +${rest} more` : "")).length > 200) break;
    out += " " + n; shown++;
  }
  return shown < names.length ? out + ` +${names.length - shown} more` : out;
}

/** PURE. What the screen needs beside the saved value: what applies when nothing is saved, and the codes or frequencies it may use. */
export function referenceFor(key) {
  if (key === "criticalLimits") return { knownCodes: KNOWN_LAB_CODES, whenEmpty: "built_in_defaults", defaults: DEFAULT_CRITICAL_LIMITS };
  if (key === "deltaLimits") return { knownCodes: KNOWN_LAB_CODES, whenEmpty: "not_checked", defaultWithinHours: 72 };
  if (key === "autoVerify") return { knownCodes: KNOWN_LAB_CODES, whenEmpty: "off" };
  if (key === "marTimes") return { frequencies: Object.fromEntries(Object.keys(DEFAULT_MAR_TIMES).map((k) => [k, DEFAULT_MAR_TIMES[k].length])), whenEmpty: "built_in_defaults", defaults: DEFAULT_MAR_TIMES };
  return { whenEmpty: "built_in_templates", builtIn: BUILT_IN_TEMPLATES.map((t) => ({ id: t.id, name: t.name })) };
}
