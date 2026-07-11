/* StewardMD Knowledge Base - generic declarative reasoning evaluator (KB P1).
 *
 * Reproduces the legacy reasoning engine's per-disease logic from PURE DATA so
 * that adding a disease is adding a JSON file - the reasoning code never changes
 * (the requirement: scale to 5,000+ diseases without modifying the engine).
 *
 * Legacy mapping (verified against reasoning.js scoreInfectious/scoreNI):
 *   infective  match: e => <bool>     ->  matching.rule   (allOf/anyOf/not/leaf)
 *   infective  baseScore: e => base+Σ ->  matching.score  ({base, modifiers:[{when,add}]})
 *   non-infect find:{key:weight}      ->  matching.find   (weighted sum)
 * The host engine still applies the SHARED post-steps (IDF soft-score, systemMod,
 * clamp) identically for every disease; this module supplies the per-disease,
 * data-driven pieces those steps consume.
 *
 * Pure, dependency-free, ES-module. Also attaches window.KBEVAL when in a browser.
 */

// Boolean rule DSL. Leaf = finding key (truthy in e) or a comparison object.
// Combinators: {allOf:[...]} | {anyOf:[...]} | {not: rule} | bare array == allOf.
export function evalRule(rule, e) {
  if (rule == null) return true;
  if (typeof rule === "string") return !!e[rule];
  if (Array.isArray(rule)) return rule.every((r) => evalRule(r, e));
  if (rule.allOf) return rule.allOf.every((r) => evalRule(r, e));
  if (rule.anyOf) return rule.anyOf.some((r) => evalRule(r, e));
  if (Object.prototype.hasOwnProperty.call(rule, "not")) return !evalRule(rule.not, e);
  if (Object.prototype.hasOwnProperty.call(rule, "key")) {
    const v = e[rule.key];
    if ("gte" in rule) return v >= rule.gte;
    if ("gt" in rule) return v > rule.gt;
    if ("lte" in rule) return v <= rule.lte;
    if ("lt" in rule) return v < rule.lt;
    if ("eq" in rule) return v === rule.eq;
    return !!v;
  }
  return false;
}

// Declarative baseScore: base + Σ(add) for each satisfied modifier. NOT clamped
// (the host engine clamps to 0..100 exactly as it does for the legacy closure).
export function evalScore(scoreModel, e) {
  if (!scoreModel) return 0;
  let i = scoreModel.base || 0;
  const mods = scoreModel.modifiers || [];
  for (let n = 0; n < mods.length; n++) if (evalRule(mods[n].when, e)) i += mods[n].add;
  return i;
}

/* Per-disease primitives the host engine consumes */
export function matches(disease, e) {
  const m = disease && disease.matching;
  return m && m.rule ? evalRule(m.rule, e) : false;
}
export function baseScore(disease, e) {
  const m = disease && disease.matching;
  return m && m.score ? evalScore(m.score, e) : 60;
}
// Non-infective weighted sum (mirrors scoreNI's `sum`, pre-systemMod/clamp).
// Returns null when no finding is present (engine drops the diagnosis).
export function niSum(disease, f) {
  const find = (disease && disease.matching && disease.matching.find) || {};
  let sum = 0, any = false;
  for (const k in find) if (f[k]) { sum += find[k]; any = true; }
  return any ? sum : null;
}
// Findings the soft-score / "missing / would help" logic ranges over.
export function associatedFindings(disease) {
  const m = disease && disease.matching;
  if (m && m.associatedFindings) return m.associatedFindings;
  if (m && m.find) return Object.keys(m.find);
  return [];
}

/* Treatment resolution by precedence; a selected hospital overlay overrides.
 * Default precedence: ICMR ▸ international guideline ▸ Harrison (fallback). */
export function resolveTreatment(treatment, opts) {
  opts = opts || {};
  if (opts.hospitalOverlay) return Object.assign({ tier: "hospital" }, opts.hospitalOverlay);
  const order = (treatment && treatment.precedence) || ["icmr", "guideline", "harrison"];
  const recs = (treatment && treatment.recommendations) || [];
  for (let i = 0; i < order.length; i++) {
    const r = recs.find((x) => x.tier === order[i]);
    if (r) return r;
  }
  return recs[0] || null;
}

try {
  if (typeof window !== "undefined") {
    window.KBEVAL = { evalRule, evalScore, matches, baseScore, niSum, associatedFindings, resolveTreatment };
  }
} catch (e) { /* non-browser */ }
