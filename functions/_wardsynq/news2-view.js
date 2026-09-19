/* functions/_wardsynq/news2-view.js — reaching the early warning score from the record.
 *
 * FAILURE TO RESCUE IS THE LARGEST AVOIDABLE CATEGORY OF INPATIENT DEATH: the patient deteriorated,
 * the observations were recorded, and nobody acted in time. `wardsynq/wardsynq-deterioration.js` has
 * held a careful NEWS2 since P0 - a missing parameter is never zero, a stale observation never
 * describes a patient now, Scale 2 is a prescription and never a guess, and the score refuses
 * outright in children and in pregnancy where it is not validated.
 *
 * NOTHING CALLED IT. Like the flowsheet, the infusion integrator and the override report before it,
 * the hard half was finished and unreachable: a ward running WardSynQ got no early warning score at
 * all. This is the adapter, and it computes NOTHING - every judgement below belongs to the module.
 *
 * SCALE 2 IS TAKEN, NEVER INFERRED. A patient in hypercapnic respiratory failure is targeted at 88
 * to 92 percent; using Scale 1 on them escalates somebody who is at their target, and using Scale 2
 * on anyone else hides real hypoxia. So the scale comes from the caller stating it, and a request
 * that does not state one gets Scale 1 - the module's own default and the safe one for everybody
 * without that prescription.
 *
 * THE ESCALATION POLICY IS UNAPPROVED AND SAYS SO ON EVERY RESPONSE. The NEWS2 arithmetic is public
 * and fixed; who to call and how fast is a local decision that no clinical lead at any hospital
 * running this has signed off. A score presented with a confident response time nobody approved is
 * how a system gets trusted for something it has no authority to say.
 *
 * IT WRITES NOTHING AND ESCALATES NOBODY. Computing a score is not the same as running a closed
 * escalation loop - `DeteriorationMonitor` exists for that and is deliberately not wired here,
 * because an escalation nobody has agreed the policy for would page people on an unapproved
 * threshold. This answers "what is this patient's score, from what, and how fresh".
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { news2, ESCALATION } from "../../wardsynq/wardsynq-deterioration.js";
import { pewsFromObservations } from "../../wardsynq/wardsynq-pews.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** PURE. The scale the caller stated, or 1. Never derived from a diagnosis or an oxygen flag. */
function scaleFrom(value) {
  return str(value) === "2" ? 2 : 1;
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

/** ctx: { migration, patientId, scale?, now?, escalation?, actorDeps, recordDeps } */
async function news2ForPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", score: null };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", score: null };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, score: null };

  let observations, patient;
  try {
    [observations, patient] = await Promise.all([
      svc.byPatient("Observation", patientId),
      svc.get("Patient", patientId).catch(() => null),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), score: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), score: null };
  }

  // Only the vital signs. A laboratory result is not a NEWS2 parameter, and handing the scorer a
  // potassium coded like an observation is how a parameter gets matched to the wrong number.
  const vitals = (observations || []).filter((o) => o && o.category === "vital-signs");

  const now = str(ctx.now) || new Date().toISOString();
  let score, tool = "NEWS2";
  try {
    score = news2({ observations: vitals, patient, scale: scaleFrom(ctx.scale), now });
    /* NEWS2 REFUSES CHILDREN, AND A REFUSAL WITH NOTHING BEHIND IT LEAVES THEM LESS PROTECTED than
     * before - it removes even the crude signal they were getting. wardsynq-pews.js exists for
     * exactly this and was, like NEWS2, reachable by nobody. A child's normal is a curve, not a
     * number: 150 is unremarkable at two months and peri-arrest at twelve years, which is why
     * applying the adult chart to them is not slightly wrong but wrong in the reassuring direction. */
    if (!score.scorable && score.code === "NOT_ADULT" && patient) {
      const paed = pewsFromObservations(vitals, patient, { now });
      if (paed) { score = paed; tool = "PEWS"; }
    }
  } catch (e) {
    // A scorer that throws must not take the ward screen down with it.
    return { ...base, ok: false, status: 502, error: "score_failed", detail: str(e && e.message), score: null };
  }

  /* The hospital's escalation policy where it has one, and the module's UNAPPROVED seed otherwise.
   * Which it is, is stated - a response time nobody approved presented as fact is how a system gets
   * trusted for something it has no authority to say. */
  const configured = ctx.escalation && typeof ctx.escalation === "object" ? ctx.escalation : null;
  const policy = score.risk ? ((configured && configured[score.risk]) || ESCALATION[score.risk] || null) : null;

  return {
    ...base, ok: true, patientId,
    /* WHICH TOOL SCORED THIS, always. A PEWS total and a NEWS2 total are different numbers on
     * different scales, and a reader who assumed the wrong one would misread both. */
    tool,
    ...(tool === "PEWS" ? {
      toolNote: "NEWS2 is not validated below 16 years, so this is PEWS. Its age bands are UNAPPROVED "
        + "seed content and vary between every unit that uses one - read the total against your own chart.",
    } : {}),
    score,
    scale: scaleFrom(ctx.scale),
    /* Said every time, and not only when a score comes out: Scale 2 not being asked for is exactly
     * the case where somebody assumed the default was right for their patient. */
    scaleNote: scaleFrom(ctx.scale) === 2
      ? "Scale 2, as stated by the caller. It applies only to a documented target of 88-92%."
      : "Scale 1, the default. Scale 2 is a prescription and is never inferred - state it if this patient has one.",
    escalation: policy,
    escalationApproved: !!configured,
    ...(policy && !configured ? {
      escalationWarning: "This response window and responder tier are UNAPPROVED seed content, not this hospital's policy. Configure wardsynq.criticalEscalation, or treat them as a suggestion only.",
    } : {}),
    /* The module refuses rather than guessing, and the refusal is the answer. An incomplete score is
     * never reassuring however low the partial total. */
    ...(score.scorable ? {} : { note: score.reason || "This score could not be computed from what is on the record." }),
    // It computes; it does not escalate. DeteriorationMonitor is deliberately not wired here.
    monitoring: "This is a score, not an escalation. Nothing has been paged and no loop has been opened.",
  };
}

export { scaleFrom, news2ForPatient };
