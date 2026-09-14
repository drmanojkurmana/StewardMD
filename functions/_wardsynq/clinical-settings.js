/* functions/_wardsynq/clinical-settings.js - D11 A (owner, 2026-09-14): the per-hospital clinical settings
 * template. PURE: what the six settings are, what a valid value is, and the templates a hospital starts from.
 *
 * WHY A TEMPLATE AND NOT DEFAULTS. Every one of these is read today by a consumer that says "not configured"
 * when it is absent (surveillance.js for highAlertDrugs and orderVerifyWithinHours, quality.js for
 * antibiotics, migrate-ed.js for edReassessMinutes, patient-access.js for patientAccess.enabled,
 * backup-run.js for rpoMinutes), and that is the safe reading. WardSynQ ships no drug list and no clinical
 * interval of its own here: shipping one would be clinical content nobody at the hospital approved (D10).
 * So the template states every setting explicitly as not configured, and the hospital's pharmacy and
 * clinical governance fill it in on the Admin screen. Another template can be added to TEMPLATES later
 * (a group's, a signed-off starter set); nothing else changes.
 *
 * criticalEscalation is deliberately NOT here: it is being built with the alert path (branch
 * s3-p0-alert-path) and has its own validation there.
 */

export const CLINICAL_SETTING_KEYS = Object.freeze(["highAlertDrugs", "antibiotics", "orderVerifyWithinHours", "edReassessMinutes", "patientAccess", "rpoMinutes"]);
const ACUITIES = ["1", "2", "3", "4", "5"];
const MAX_LIST = 300, MAX_NAME = 80;

export const TEMPLATES = Object.freeze({
  "not-configured": Object.freeze({
    label: "Every setting stated as not configured",
    description: "No drug lists, no clinical intervals, patient access off. Each screen that uses a setting says it is not configured until your hospital fills it in.",
    settings: Object.freeze({ highAlertDrugs: [], antibiotics: [], orderVerifyWithinHours: null, edReassessMinutes: {}, patientAccess: { enabled: false }, rpoMinutes: null }),
  }),
});

const str = (v) => (v == null ? "" : String(v)).trim();

/** PURE. The six settings as a hospital's org config holds them now, shaped for the screen. */
export function readClinicalSettings(wardsynqCfg) {
  const w = wardsynqCfg && typeof wardsynqCfg === "object" ? wardsynqCfg : {};
  const list = (x) => (Array.isArray(x) ? x.map(str).filter(Boolean) : []);
  const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
  const ed = {};
  const src = w.edReassessMinutes && typeof w.edReassessMinutes === "object" && !Array.isArray(w.edReassessMinutes) ? w.edReassessMinutes : {};
  for (const a of ACUITIES) if (num(src[a]) != null) ed[a] = num(src[a]);
  return {
    highAlertDrugs: list(w.highAlertDrugs), antibiotics: list(w.antibiotics),
    orderVerifyWithinHours: num(w.orderVerifyWithinHours), edReassessMinutes: ed,
    patientAccess: { enabled: !!(w.patientAccess && w.patientAccess.enabled === true) },
    rpoMinutes: num(w.rpoMinutes),
  };
}

/** PURE. Validates the settings a caller sent (any subset of the six). Returns { value, errors }: value holds
 * only the keys sent, normalised; errors is keyed by setting and non-empty means nothing may be saved. */
export function validateClinicalSettings(input) {
  const errors = {}, value = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { value, errors: { settings: "Send the settings as an object." } };
  for (const k of Object.keys(input)) if (!CLINICAL_SETTING_KEYS.includes(k)) errors[k] = "This is not one of the clinical settings on this screen.";
  const names = (k, what) => {
    if (input[k] === undefined) return;
    const v = input[k];
    if (!Array.isArray(v)) { errors[k] = `Give ${what} as a list of names.`; return; }
    const seen = new Set(), out = [];
    for (const raw of v) {
      const n = str(raw);
      if (!n) continue;
      if (n.length > MAX_NAME) { errors[k] = `"${n.slice(0, 30)}..." is longer than ${MAX_NAME} characters.`; return; }
      if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n); }
    }
    if (out.length > MAX_LIST) { errors[k] = `At most ${MAX_LIST} names.`; return; }
    value[k] = out;
  };
  const whole = (k, lo, hi, what) => {
    if (input[k] === undefined) return;
    const v = input[k];
    if (v === null || v === "") { value[k] = null; return; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) { errors[k] = `${what} must be a whole number from ${lo} to ${hi}, or blank for not configured.`; return; }
    value[k] = n;
  };
  names("highAlertDrugs", "high-alert drugs");
  names("antibiotics", "antibiotics");
  whole("orderVerifyWithinHours", 1, 168, "Hours to pharmacy verification");
  whole("rpoMinutes", 5, 10080, "Recovery point objective (minutes)");
  if (input.edReassessMinutes !== undefined) {
    const v = input.edReassessMinutes;
    if (!v || typeof v !== "object" || Array.isArray(v)) errors.edReassessMinutes = "Give reassessment minutes per acuity (1 to 5).";
    else {
      const out = {};
      for (const a of Object.keys(v)) {
        if (!ACUITIES.includes(a)) { errors.edReassessMinutes = `Acuity "${a}" is not 1 to 5.`; break; }
        if (v[a] === null || v[a] === "") continue;
        const n = Number(v[a]);
        if (!Number.isInteger(n) || n < 1 || n > 1440) { errors.edReassessMinutes = `Acuity ${a}: minutes must be a whole number from 1 to 1440, or blank for no interval.`; break; }
        out[a] = n;
      }
      if (!errors.edReassessMinutes) value.edReassessMinutes = out;
    }
  }
  if (input.patientAccess !== undefined) {
    const v = input.patientAccess;
    if (!v || typeof v !== "object" || typeof v.enabled !== "boolean") errors.patientAccess = "Say whether patient access is on (true) or off (false).";
    else value.patientAccess = { enabled: v.enabled };
  }
  return { value, errors };
}

/** PURE. Which settings a save actually changes, compared as the screen reads them. */
export function changedClinicalKeys(beforeCfg, value) {
  const before = readClinicalSettings(beforeCfg);
  return Object.keys(value).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(readClinicalSettings({ ...beforeCfg, ...mergeInto(beforeCfg, value) })[k]));
}

/** PURE. The wardsynq config patch to store: patientAccess keeps its other fields (code and session lifetimes). */
export function mergeInto(beforeCfg, value) {
  const patch = { ...value };
  if (value.patientAccess) patch.patientAccess = { ...((beforeCfg && beforeCfg.patientAccess) || {}), enabled: value.patientAccess.enabled };
  return patch;
}
