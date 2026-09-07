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
  const keyOf = (code, targetId) => (targetId ? `${code}:${targetId}` : code);

  for (const o of overrides) {
    if (!o) continue;
    const key = keyOf(o.code, o.targetId);
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
  if (!overrides.length) return { written: 0, overrides: [], ...(rejected.length ? { rejected } : {}) };
  const out = [];
  for (const o of overrides) {
    try { const res = await svc.put(o, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:${o.id}` : null }); out.push({ id: o.id, code: o.code, targetId: o.targetId, version: res.record.version }); }
    catch (e) {
      if (e instanceof GovernanceError || e instanceof VersionConflictError) return { written: out.length, overrides: out, error: "override_not_recorded", detail: str(e.message) };
      return { written: out.length, overrides: out, error: "override_not_recorded", detail: str(e && e.message) };
    }
  }
  return { written: out.length, overrides: out, ...(rejected.length ? { rejected } : {}) };
}

/** The report. ctx: { migration, patientId?, firedCounts?, actorDeps, recordDeps } */
async function overrideReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", report: null };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, report: null };

  let rows;
  try {
    rows = str(ctx.patientId) ? await svc.byPatient(TYPE, str(ctx.patientId)) : await svc.list(TYPE, 500);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), report: null }; }

  return { ...base, ok: true, report: summariseOverrides({ overrides: rows || [], firedCounts: ctx.firedCounts }) };
}

export { TYPE, SafetyOverride, overrideIdFor, overridesFrom, summariseOverrides, recordOverrides, overrideReport };
