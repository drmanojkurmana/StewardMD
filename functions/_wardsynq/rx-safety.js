/* functions/_wardsynq/rx-safety.js — advisory-only CDSS check for native OPD prescribing.
 *
 * UNAPPROVED CONTENT, PER wardsynq-safety.js'S OWN RULE PACK AND vault/modules/WardSynQ.md's STATUS
 * LINE: "All clinical content (interaction, allergy, dose ceiling and critical threshold packs) is
 * UNAPPROVED seed data and must not gate a real order until pharmacy and the relevant committee
 * sign it off." This file therefore NEVER blocks or refuses a prescription — it only evaluates and
 * reports, exactly like `SafetyEngine.evaluate()` underneath it. The write always proceeds; the
 * doctor decides, informed. Every response carries `unapproved: true` so no caller can present this
 * as a cleared clinical control.
 *
 * ALLERGIES ARE LIVE (updated 2026-09-07). This header used to say no AllergyIntolerance data
 * existed anywhere in WardSynQ and that allergy checks therefore contributed nothing. That stopped
 * being true when allergy capture shipped: the assessment's Known_allergies_details field is parsed
 * into real AllergyIntolerance records, and a documented penicillin allergy now demonstrably drives
 * a contraindicated finding here. Interaction checks run against the patient's actual active
 * MedicationOrder history, as they always did.
 *
 * PURE / TESTABLE: this file never imports the (large) real rule-pack JSON itself — the compiled
 * pack is a dependency, injected by the caller (see rulepack.js, the one file that loads the real
 * StewardMD content and is imported only by the route). Tests build their own small pack.
 *
 * node --test test/wardsynq-rx-safety.test.mjs
 */
import { SafetyEngine, resolveComponents } from "../../wardsynq/wardsynq-safety.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { lookupComposition } from "./drug-lookup.js";

/** PURE. Runs the engine and shapes an advisory-only verdict — never a gate. */
function evaluateRx(candidate, activeMeds, allergies, rulePack) {
  const engine = new SafetyEngine({ rulePack });
  const order = { drug: candidate.drug || candidate.generic || "", drugCode: candidate.generic || candidate.drugCode || candidate.drug || "" };
  const verdict = engine.evaluate({ order, activeMeds: activeMeds || [], allergies: allergies || [] });
  return {
    unapproved: true,   // see file header — this NEVER gates the order, whatever it finds
    rulePackVersion: verdict.rulePackVersion,
    unresolvedDrug: verdict.unresolvedDrug,
    // Which of the patient's OWN medicines could not be interaction-checked. Empty is the normal
    // case; non-empty means this verdict is narrower than it looks. See wardsynq-safety.js.
    unresolvedActiveMeds: verdict.unresolvedActiveMeds || [],
    findings: verdict.findings.map((f) => ({ code: f.code, severity: f.severity, disposition: f.disposition, message: f.message })),
  };
}

/**
 * Reads the patient's real active MedicationOrders + whatever AllergyIntolerance rows exist (best-
 * effort, usually none) from the record and evaluates the candidate drug against them. Never
 * throws: a read failure or an unresolved actor degrades to an empty-context advisory ("nothing
 * checkable right now"), because a prescription must never be blocked by this file being unable to
 * fetch its own decision support.
 *
 * ctx: { candidate: {drug, generic, drugCode}, patientId, tenantId, actorDeps, recordDeps, rulePack }
 */
async function checkPrescriptionSafety(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.tenantId, "record:write", ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    const [orders, allergies] = await Promise.all([
      svc.byPatient("MedicationOrder", ctx.patientId).catch(() => []),
      svc.byPatient("AllergyIntolerance", ctx.patientId).catch(() => []),
    ]);
    const activeMeds = (orders || []).filter((o) => o.status === "active").map((o) => ({ drug: o.drug, drugCode: o.genericName || o.drugCode }));

    /* Last resort, and only that. If the compiled pack cannot resolve this drug at all, ask
     * StewardMD's own drug database what the brand is made of and let the engine resolve THAT the
     * ordinary way. The engine itself still does no I/O (drug-lookup.js's header explains why that
     * matters); a failure here returns null, the drug stays unresolved, and the verdict says NOT
     * CHECKED rather than pretending to be clean. */
    let candidate = ctx.candidate;
    let resolvedVia = null;
    if (!resolveComponents(candidate.drug || candidate.generic || candidate.drugCode, ctx.rulePack).length) {
      const composition = await lookupComposition(candidate.drug || candidate.generic, env, ctx.lookupDeps);
      if (composition && resolveComponents(composition, ctx.rulePack).length) {
        // BOTH, because evaluateRx prefers `generic` and it currently holds the display name.
        candidate = { ...candidate, generic: composition, drugCode: composition };
        resolvedVia = "drug-database";
      }
    }

    const verdict = evaluateRx(candidate, activeMeds, allergies, ctx.rulePack);
    return resolvedVia ? { ...verdict, resolvedVia } : verdict;
  } catch (e) {
    return { unapproved: true, rulePackVersion: null, unresolvedDrug: true, findings: [], degraded: true };
  }
}

export { evaluateRx, checkPrescriptionSafety };
