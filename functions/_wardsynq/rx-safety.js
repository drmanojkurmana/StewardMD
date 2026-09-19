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
import { readOrNull, unavailable } from "./unreadable.js";

/**
 * PURE. Runs the engine and shapes an advisory-only verdict — never a gate.
 *
 * `notAvailable` ({ notChecked: ["AllergyIntolerance"], reason }, or null) says which of the
 * patient's own records could not be read. It NEVER empties the verdict — an interaction found
 * against the medicines that did load is still worth saying — but it travels on the verdict as
 * `notChecked` so no caller can present this as a completed check. R6-1, 2026-09-18: before this,
 * a failed allergy read reached the engine as `[]` and came back as "nothing found".
 */
function evaluateRx(candidate, activeMeds, allergies, rulePack, notAvailable) {
  const engine = new SafetyEngine({ rulePack });
  const order = { drug: candidate.drug || candidate.generic || "", drugCode: candidate.generic || candidate.drugCode || candidate.drug || "" };
  const verdict = engine.evaluate({ order, activeMeds: activeMeds || [], allergies: allergies || [] });
  return {
    unapproved: true,   // see file header — this NEVER gates the order, whatever it finds
    rulePackVersion: verdict.rulePackVersion,
    unresolvedDrug: verdict.unresolvedDrug,
    ...(notAvailable ? { notChecked: notAvailable.notChecked, notCheckedReason: notAvailable.reason } : {}),
    // Which of the patient's OWN medicines could not be interaction-checked. Empty is the normal
    // case; non-empty means this verdict is narrower than it looks. See wardsynq-safety.js.
    unresolvedActiveMeds: verdict.unresolvedActiveMeds || [],
    findings: verdict.findings.map((f) => ({ code: f.code, severity: f.severity, disposition: f.disposition, message: f.message })),
  };
}

/**
 * Reads the patient's real active MedicationOrders + whatever AllergyIntolerance rows exist from the
 * record and evaluates the candidate drug against them. Never throws, because a prescription must
 * never be blocked by this file being unable to fetch its own decision support - but a read it could
 * not do is NAMED (`notChecked`), never presented as a check that found nothing.
 *
 * ctx: { candidate: {drug, generic, drugCode}, patientId, tenantId, actorDeps, recordDeps, rulePack }
 */
async function checkPrescriptionSafety(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.tenantId, "record:write", ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    /* A READ THAT FAILED IS NOT AN EMPTY LIST (R6-1). These two catches used to be `() => []`, which
     * made a store hiccup at the moment of prescribing indistinguishable from a patient with no
     * allergies and no other medicines - and swallowed the failure before the outer catch below
     * could mark the verdict degraded. Now the type is named and travels on the verdict. */
    const failures = [];
    const [orders, allergies] = await Promise.all([
      readOrNull(svc.byPatient("MedicationOrder", ctx.patientId), "MedicationOrder", failures),
      readOrNull(svc.byPatient("AllergyIntolerance", ctx.patientId), "AllergyIntolerance", failures),
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

    const verdict = evaluateRx(candidate, activeMeds, allergies, ctx.rulePack, unavailable(failures));
    return resolvedVia ? { ...verdict, resolvedVia } : verdict;
  } catch (e) {
    // Nothing at all was read: the whole check is not checked, and says so by name.
    return { unapproved: true, rulePackVersion: null, unresolvedDrug: true, findings: [], degraded: true,
      notChecked: ["MedicationOrder", "AllergyIntolerance"], notCheckedReason: "record_read_failed" };
  }
}

export { evaluateRx, checkPrescriptionSafety };
