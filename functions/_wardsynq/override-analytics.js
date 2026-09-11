/* functions/_wardsynq/override-analytics.js — what clinicians override, and how often.
 *
 * The safety engine has always REQUIRED a reason to override a warning: `evaluate()` will not clear
 * an overridable finding without a reasonCode, a rationale and an actor. And then it threw all of it
 * away. The override happened inside one request and left no trace, so the single most important
 * question about a decision-support system could not be asked at all:
 *
 *   WHICH RULES ARE BEING OVERRIDDEN, AND WHY?
 *
 * That question matters more than any individual alert, because ALERT FATIGUE IS THE CHARACTERISTIC
 * FAILURE OF CDSS. A rule that fires on every third order and is overridden 98% of the time is not
 * protecting anyone - it is training every clinician in the hospital to click through warnings,
 * including the one that mattered. Published override rates for drug-interaction alerts sit around
 * 90%, and a system that cannot see its own rate cannot know it has that problem.
 *
 * A HIGH OVERRIDE RATE IS EVIDENCE ABOUT THE RULE, NOT ABOUT THE CLINICIANS. That framing is the
 * whole point of this file and it is why there is nothing here that scores, ranks or reports a
 * PERSON. The output is per RULE. Counting overrides per clinician would turn a tool for fixing a
 * rule pack into a tool for managing staff, and the immediate effect of that is that people stop
 * writing honest rationales - which destroys the only data that makes the rule fixable.
 *
 * The actor IS recorded on each override, because a clinical decision needs an author and the
 * record is append-only. It is simply never aggregated by person here.
 *
 * IT DOES NOT CHANGE ANY RULE. Nothing in this file edits the rule pack, suppresses an alert or
 * decides a threshold is wrong. It reports. A rule is changed by whoever owns the clinical content,
 * deliberately, with this as evidence.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "SafetyOverride";

function SafetyOverride(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    orderId: i.orderId || null,
    drug: i.drug || null,
    /* WHAT was overridden: the finding's code (allergy / interaction / dose ...) and, where the
     * finding named one, the specific rule or allergy it came from. Both, because "interactions are
     * overridden a lot" is not actionable and "THIS interaction rule is overridden a lot" is. */
    code: i.code,
    targetId: i.targetId || null,
    severity: i.severity || null,
    reasonCode: i.reasonCode || null,
    rationale: i.rationale || null,
    actorId: i.actorId || null,
    witnessId: i.witnessId || null,
    // The pack version, so a rate can be attributed to the rules that were actually in force.
    rulePackVersion: i.rulePackVersion || null,
    at: i.at || null,
    source: { system: "wardsynq-native", sourceId: `override:${i.id}` },
  };
}

/* ---- the denominator ---------------------------------------------------------------------------
 *
 * An override COUNT identifies nothing on its own. "This interaction rule was overridden 40 times"
 * is a fact about how busy the ward was; "it fired 42 times and was overridden 40" is a fact about
 * the rule, and it is the one that says the rule is training people to click through warnings.
 *
 * Until now nothing counted the firings, so `overrideRate` was honestly `null` on every row. This is
 * that count: one record per (order, rule pack version) naming which overridable rules fired. It is
 * kept as its own append-only fact rather than a counter, because a counter incremented from two
 * concurrent orders loses one of them, and a lost firing silently lowers a rule's override rate -
 * which is the direction that hides a bad rule.
 *
 * ONE PER ORDER AND PACK VERSION, deterministically. A retried or idempotent order write is the same
 * evaluation, not a second alert, and counting it twice would deflate the rate. A genuinely different
 * pack version is a different set of rules, so it counts again.
 *
 * ONLY OVERRIDABLE FINDINGS ARE COUNTED. A hard block is not part of an override rate: nobody can
 * override it, so a rate over those would be zero by construction and would drag every real number
 * down with it.
 */
const FIRING_TYPE = "SafetyFiring";

/** PURE. The key a firing and an override are counted under. Identical on both sides by design. */
function ruleKey(code, targetId) { return targetId ? `${code}:${targetId}` : String(code); }

function firingIdFor(orderId, rulePackVersion) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const o = slug(orderId);
  if (!o) return null;
  const v = slug(rulePackVersion);
  return v ? `wsq-fire-${o}-${v}` : `wsq-fire-${o}`;
}

/**
 * PURE. Which overridable rules this verdict fired, as one record. Null when none did - an order that
 * raised nothing is not an evaluation worth storing, and storing it would put an empty row against
 * every prescription in the hospital.
 *
 * Read from the engine's own `findings`, where a cleared finding keeps its original OVERRIDABLE
 * disposition. Reading `overridables` instead would have counted only the ones NOBODY overrode,
 * making the denominator smaller exactly when the numerator was larger.
 */
function firingFrom(input) {
  const i = input || {};
  const verdict = i.safety || {};
  const findings = Array.isArray(verdict.findings) ? verdict.findings : [];
  const keys = [];
  for (const f of findings) {
    if (!f || f.disposition !== "overridable") continue;
    const k = ruleKey(f.code, f.ruleId || f.allergyId || null);
    if (k && keys.indexOf(k) < 0) keys.push(k);
  }
  if (!keys.length) return null;
  const id = firingIdFor(i.orderId, verdict.rulePackVersion);
  if (!id) return null;
  return {
    resourceType: FIRING_TYPE, id,
    patientId: i.patientId, encounterId: i.encounterId || null, orderId: i.orderId,
    rulePackVersion: verdict.rulePackVersion || null,
    keys,
    at: i.at || new Date().toISOString(),
    source: { system: "wardsynq-native", sourceId: `firing:${id}` },
  };
}

/** PURE. The denominator, from the stored firings. */
function firedCountsFrom(firings) {
  const out = {};
  for (const f of firings || []) {
    for (const k of (f && Array.isArray(f.keys) ? f.keys : [])) out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** PURE. One record per (order, finding). A retried order write is the same override. */
function overrideIdFor(orderId, code, targetId) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const o = slug(orderId), c = slug(code);
  if (!o || !c) return null;
  const t = slug(targetId);
  return t ? `wsq-ovr-${o}-${c}-${t}` : `wsq-ovr-${o}-${c}`;
}

/**
 * PURE. The overrides carried on a safety verdict, as records.
 *
 * Reads the CLEARED findings rather than the raw override list: a caller can send an override for a
 * finding that never fired, and recording that would inflate the rate for a rule nobody actually
 * saw. Only what the engine confirms it cleared is counted.
 */
function overridesFrom(input) {
  const i = input || {};
  const verdict = i.safety || {};
  const cleared = (verdict.warnings || []).filter((w) => w && w.overridden === true);
  const asked = Array.isArray(verdict.overrides) ? verdict.overrides : (Array.isArray(i.overrides) ? i.overrides : []);
  const out = [], rejected = [];

  for (const f of cleared) {
    const match = asked.find((o) => o && o.code === f.code && (!o.targetId || o.targetId === f.ruleId || o.targetId === f.allergyId));
    const targetId = f.ruleId || f.allergyId || (match && match.targetId) || null;
    const id = overrideIdFor(i.orderId, f.code, targetId);
    if (!id) { rejected.push({ code: f.code, reason: "bad_identifiers" }); continue; }
    // The engine will not clear a finding without these, so their absence means the caller handed
    // us a verdict it did not produce. Recorded as rejected rather than stored half-empty.
    if (!match || !str(match.reasonCode) || !str(match.rationale) || !str(match.actorId)) {
      rejected.push({ code: f.code, targetId, reason: "override_not_attributable" });
      continue;
    }
    out.push(SafetyOverride({
      id, patientId: i.patientId, encounterId: i.encounterId || null, orderId: i.orderId, drug: i.drug || null,
      code: f.code, targetId, severity: f.severity || null,
      reasonCode: str(match.reasonCode), rationale: str(match.rationale),
      actorId: str(match.actorId), witnessId: str(match.witnessId) || null,
      rulePackVersion: verdict.rulePackVersion || null,
      at: i.at || new Date().toISOString(),
    }));
  }
  return { overrides: out, rejected };
}

/**
 * PURE. Per RULE, never per person.
 *
 * `fired` is how many times the rule produced an overridable finding; `overridden` how many of those
 * a clinician cleared. The RATE is the number that matters, and it is a statement about the rule.
 */
function summariseOverrides(input) {
  const i = input || {};
  const overrides = i.overrides || [];
  const fired = i.firedCounts || {};      // optional: {key: n} from whatever recorded firings
  const byKey = new Map();

  for (const o of overrides) {
    if (!o) continue;
    // The SAME key function the firings are counted under. Two spellings of "this rule" is how a
    // numerator and a denominator end up describing different things.
    const key = ruleKey(o.code, o.targetId);
    const row = byKey.get(key) || { key, code: o.code, targetId: o.targetId || null, overridden: 0, reasons: {}, severities: {}, rulePackVersions: {} };
    row.overridden += 1;
    if (o.reasonCode) row.reasons[o.reasonCode] = (row.reasons[o.reasonCode] || 0) + 1;
    if (o.severity) row.severities[o.severity] = (row.severities[o.severity] || 0) + 1;
    if (o.rulePackVersion) row.rulePackVersions[o.rulePackVersion] = (row.rulePackVersions[o.rulePackVersion] || 0) + 1;
    byKey.set(key, row);
  }

  const rules = [...byKey.values()].map((r) => {
    const f = Number(fired[r.key]);
    return {
      ...r,
      fired: Number.isFinite(f) ? f : null,
      /* null, not zero, when nobody counted the firings. An override rate computed against an
       * unknown denominator would be a made-up number, and this file's whole value is that its
       * numbers can be trusted enough to change a clinical rule on. */
      overrideRate: Number.isFinite(f) && f > 0 ? Math.round((r.overridden / f) * 100) / 100 : null,
      topReason: Object.entries(r.reasons).sort((a, b) => b[1] - a[1])[0] ? Object.entries(r.reasons).sort((a, b) => b[1] - a[1])[0][0] : null,
    };
  }).sort((a, b) => b.overridden - a.overridden);

  return {
    rules,
    totalOverrides: overrides.length,
    distinctRules: rules.length,
    /* Stated outright rather than left for a reader to infer, because the conclusion people reach
     * from an override table is usually the wrong one. */
    note: "Override counts are evidence about RULES, not about clinicians. A rule overridden most of "
      + "the time is a rule that is training people to click through warnings. No clinician is named "
      + "or counted here.",
  };
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/**
 * Records the overrides a verdict cleared. Called on the ordering path, never on its own.
 * Returns what it wrote; a failure here NEVER fails the order - the order and its safety decision
 * are the clinical act, and losing an analytics row must not cost a patient their medicine.
 */
async function recordOverrides(svc, ctx) {
  const { overrides, rejected } = overridesFrom(ctx);

  /* THE FIRING IS RECORDED WHETHER OR NOT ANYTHING WAS OVERRIDDEN, and it is recorded FIRST. A rule
   * that fires and is respected is the good case, and it is precisely the case that has to reach the
   * denominator - counting only the orders where somebody overrode something would make every rule
   * in the pack look like it is overridden 100% of the time. */
  const firing = firingFrom(ctx);
  let fired = null;
  if (firing) {
    try {
      const res = await svc.put(firing, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:${firing.id}` : null });
      fired = { id: firing.id, keys: firing.keys, version: res.record.version };
    } catch (e) {
      // Losing the denominator is a smaller loss than losing the override itself, so this is reported
      // and the overrides below are still attempted.
      fired = { error: "firing_not_recorded", detail: str(e && e.message) };
    }
  }

  if (!overrides.length) return { written: 0, overrides: [], ...(fired ? { fired } : {}), ...(rejected.length ? { rejected } : {}) };
  const out = [];
  for (const o of overrides) {
    try { const res = await svc.put(o, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:${o.id}` : null }); out.push({ id: o.id, code: o.code, targetId: o.targetId, version: res.record.version }); }
    catch (e) {
      if (e instanceof GovernanceError || e instanceof VersionConflictError) return { written: out.length, overrides: out, ...(fired ? { fired } : {}), error: "override_not_recorded", detail: str(e.message) };
      return { written: out.length, overrides: out, ...(fired ? { fired } : {}), error: "override_not_recorded", detail: str(e && e.message) };
    }
  }
  return { written: out.length, overrides: out, ...(fired ? { fired } : {}), ...(rejected.length ? { rejected } : {}) };
}

/** The report. ctx: { migration, patientId?, firedCounts?, actorDeps, recordDeps } */
async function overrideReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", report: null };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, report: null };

  let rows, firings;
  try {
    const pid = str(ctx.patientId);
    [rows, firings] = await Promise.all([
      pid ? svc.byPatient(TYPE, pid) : svc.list(TYPE, 500),
      pid ? svc.byPatient(FIRING_TYPE, pid) : svc.list(FIRING_TYPE, 500),
    ]);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), report: null }; }

  /* The denominator comes from the record, not from the caller. An earlier signature took
   * `firedCounts` from the request, which would have let whoever reads the report decide what the
   * override rate is. It is still honoured when passed, but only as a fallback for a caller that
   * counted firings some other way; the stored firings win. */
  const counts = { ...(ctx.firedCounts || {}), ...firedCountsFrom(firings) };
  const report = summariseOverrides({ overrides: rows || [], firedCounts: counts });
  return {
    ...base, ok: true,
    report: {
      ...report,
      evaluationsRecorded: (firings || []).length,
      // Said plainly: a rate needs both halves, and a report that has only one should not look complete.
      ...(!(firings || []).length && report.totalOverrides
        ? { note2: "No rule firings are on record for this scope, so no override rate can be computed. The counts below are numerators without a denominator." }
        : {}),
    },
  };
}

export {
  TYPE, FIRING_TYPE, SafetyOverride, overrideIdFor, overridesFrom, summariseOverrides, recordOverrides, overrideReport,
  ruleKey, firingIdFor, firingFrom, firedCountsFrom,
};
