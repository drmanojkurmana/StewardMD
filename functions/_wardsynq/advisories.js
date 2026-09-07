/* functions/_wardsynq/advisories.js — the hospital's own advice, kept apart from the safety engine.
 *
 * `wardsynq-safety.js` is WardSynQ's clinical safety engine: allergies, interactions, dose ceilings.
 * It is fail-closed, it may BLOCK, and its rules are ours. This file is the other thing every real
 * EMR has and this one did not: a way for a HOSPITAL to write its own advisories - "if you are
 * ordering a nephrotoxic drug in someone whose creatinine is above 200, say so", "if you are
 * prescribing an antibiotic, remind the prescriber to send cultures first".
 *
 * THEY CANNOT BLOCK. Not one of them, ever, and this is the whole design.
 *
 *   - A hospital-authored rule is authored by a person who is not a software engineer, in a hospital
 *     with no staging environment. A typo in a threshold that could stop prescribing takes the ward
 *     offline at 3am and there is nobody to roll it back.
 *   - Every advisory that fires is one more thing between a prescriber and a patient. Alert fatigue
 *     is the characteristic failure of CDSS (see override-analytics.js), and a hospital that can
 *     author advisories WILL author too many. Making them un-blocking keeps that a nuisance rather
 *     than a hazard.
 *
 * So the strongest thing an advisory can do is appear, with the hospital's own words, marked as the
 * hospital's. A rule that needs to stop an order belongs in the formulary (a named drug, a named
 * approver) or in the safety engine (a clinical finding), both of which are narrow and reviewed.
 *
 * NOTHING IS INFERRED FROM A RULE THAT DOES NOT PARSE. A malformed advisory is REPORTED and skipped,
 * never partially applied: an advisory whose condition failed to compile and fired anyway would be
 * showing a hospital's clinicians a message about a patient it never actually looked at.
 *
 * IT READS, IT NEVER WRITES. Advisories are computed at order time from records already read. There
 * is no advisory state, no "acknowledged" flag, nothing stored. What IS stored is the override, and
 * that is override-analytics.js's job, unchanged.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const norm = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (v) => {
  if (v === null || v === undefined || (typeof v !== "number" && str(v) === "")) return null;
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) ? n : null;
};

/** What a fired advisory looks like. `info` is the default: a hospital rule is advice, not a finding. */
const LEVELS = Object.freeze(["info", "warn"]);
/** The condition kinds a hospital may write. Deliberately few - each one is a thing we can evaluate
 *  honestly from the record, and an expression language would be a way to write a rule nobody can
 *  review. */
const WHEN = Object.freeze(["drug", "drug-any", "problem", "observation-above", "observation-below", "age-above", "age-below", "always"]);

/**
 * PURE. The hospital's advisories, compiled. An unusable one is REPORTED, never partially applied.
 */
function compileAdvisories(list) {
  const rows = Array.isArray(list) ? list : [];
  const rules = [], problems = [];

  rows.forEach((raw, index) => {
    const r = raw && typeof raw === "object" ? raw : {};
    const id = str(r.id);
    const message = str(r.message);
    if (!id) { problems.push({ index, reason: "no_id" }); return; }
    /* A rule with no message has nothing to say. It would fire, count towards alert fatigue, and
     * show a clinician an empty box. */
    if (!message) { problems.push({ index, id, reason: "no_message" }); return; }

    const conds = Array.isArray(r.when) ? r.when : [];
    if (!conds.length) { problems.push({ index, id, reason: "no_condition" }); return; }

    const compiled = [];
    let bad = null;
    for (const c of conds) {
      const cond = c && typeof c === "object" ? c : {};
      const kind = str(cond.kind);
      if (!WHEN.includes(kind)) { bad = { reason: "unknown_condition", kind: kind || null }; break; }
      if (kind === "always") { compiled.push({ kind }); continue; }
      if (kind === "drug" || kind === "drug-any") {
        const names = (kind === "drug" ? [cond.value] : (Array.isArray(cond.values) ? cond.values : []))
          .map(norm).filter(Boolean);
        if (!names.length) { bad = { reason: "condition_needs_value", kind }; break; }
        compiled.push({ kind, names });
        continue;
      }
      if (kind === "problem") {
        const codes = (Array.isArray(cond.values) ? cond.values : [cond.value]).map(norm).filter(Boolean);
        if (!codes.length) { bad = { reason: "condition_needs_value", kind }; break; }
        compiled.push({ kind, codes });
        continue;
      }
      if (kind === "observation-above" || kind === "observation-below") {
        const code = str(cond.code), value = num(cond.value);
        // A threshold that is not a number cannot be compared. Guessing one would invent the
        // hospital's clinical content for it.
        if (!code || value === null) { bad = { reason: "condition_needs_code_and_number", kind }; break; }
        compiled.push({ kind, code, value, withinHours: num(cond.withinHours) });
        continue;
      }
      const years = num(cond.value);
      if (years === null) { bad = { reason: "condition_needs_number", kind }; break; }
      compiled.push({ kind, years });
    }
    if (bad) { problems.push({ index, id, ...bad }); return; }

    rules.push({
      id, message,
      level: LEVELS.includes(str(r.level)) ? str(r.level) : "info",
      when: compiled,
      action: str(r.action) || null,          // what the hospital suggests doing about it
      reference: str(r.reference) || null,    // the guideline it came from, so it can be argued with
    });
  });

  return { rules, ...(problems.length ? { problems } : {}) };
}

/** PURE. The patient's most recent numeric value for a code, or null. Age-limited when asked. */
function latestValue(observations, code, nowMs, withinHours) {
  const want = norm(code);
  const rows = (observations || [])
    .filter((o) => o && norm(o.code) === want)
    .map((o) => ({ v: num(o.value), t: Date.parse(str((o.meta && o.meta.effectiveAt) || o.effectiveAt || (o.meta && o.meta.recordedAt))) }))
    .filter((x) => x.v !== null && Number.isFinite(x.t))
    .sort((a, b) => b.t - a.t);
  if (!rows.length) return null;
  if (withinHours !== null && withinHours !== undefined) {
    const cutoff = (Number.isFinite(nowMs) ? nowMs : Date.now()) - withinHours * 3600000;
    if (rows[0].t < cutoff) return null;
  }
  return rows[0].v;
}

/**
 * PURE. Which advisories fire for this order.
 *
 * EVERY condition in a rule must hold: `when` is an AND. A hospital wanting OR writes two rules,
 * which is also two rows in the override report - and knowing WHICH of two situations fired is
 * exactly what makes a noisy rule fixable.
 *
 * A condition that cannot be EVALUATED - no creatinine on file, no date of birth - does not fire.
 * Firing on absent data would show a message about a patient nobody has measured.
 */
function evaluateAdvisories(input) {
  const i = input || {};
  const rules = (i.compiled && i.compiled.rules) || [];
  const drug = norm(i.drug);
  const problems = (i.problems || []).filter((p) => p && p.clinicalStatus !== "resolved");
  const nowMs = Number.isFinite(i.nowMs) ? i.nowMs : Date.now();
  const ageYears = num(i.ageYears);

  const fired = [];
  for (const rule of rules) {
    let all = true;
    for (const c of rule.when) {
      if (c.kind === "always") continue;
      if (c.kind === "drug" || c.kind === "drug-any") {
        // Whole-name matching, exactly as the formulary does and for the same reason: a substring
        // match would apply a rule about one drug to a different drug that contains its name.
        if (!c.names.includes(drug)) { all = false; break; }
        continue;
      }
      if (c.kind === "problem") {
        const has = problems.some((p) => c.codes.includes(norm(p.code)) || c.codes.includes(norm(p.display)));
        if (!has) { all = false; break; }
        continue;
      }
      if (c.kind === "observation-above" || c.kind === "observation-below") {
        const v = latestValue(i.observations, c.code, nowMs, c.withinHours);
        // Not measured is not "below". A rule that fired on absent data would be advising about a
        // patient nobody has measured.
        if (v === null) { all = false; break; }
        if (c.kind === "observation-above" ? !(v > c.value) : !(v < c.value)) { all = false; break; }
        continue;
      }
      if (ageYears === null) { all = false; break; }
      if (c.kind === "age-above" ? !(ageYears > c.years) : !(ageYears < c.years)) { all = false; break; }
    }
    if (!all) continue;
    fired.push({
      id: rule.id, level: rule.level, message: rule.message,
      action: rule.action, reference: rule.reference,
      /* Marked as the hospital's, on every one. A prescriber has to be able to tell "your hospital
       * asked me to tell you this" from "this drug will harm this patient". */
      source: "hospital-advisory",
      // Stated on every advisory, because the whole design rests on it.
      blocking: false,
    });
  }
  return fired;
}

export { LEVELS, WHEN, compileAdvisories, latestValue, evaluateAdvisories };
