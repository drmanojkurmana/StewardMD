/* functions/_wardsynq/maik-cds.js — TASK 8.9: MaiK explains a safety verdict it did not compute.
 *
 * THE ARCHITECTURAL RULE THIS FILE EXISTS TO HOLD: MaiK is never a second clinical rules engine.
 * Every clinical decision here - what interacts with what, which allergy contraindicates which drug,
 * what a dose ceiling is, what renal impairment changes - is computed by wardsynq-safety.js's
 * deterministic SafetyEngine, from the hospital's compiled rule pack, exactly as the prescribing
 * screen and the bedside eMAR compute it. MaiK is handed the FINISHED verdict and asked to put it
 * into a sentence. It cannot re-run a check, cannot add a finding, cannot remove one, and cannot
 * change a severity or a disposition.
 *
 * THE CONTRACT, precisely:
 *
 *   IN   SafetyEngine.evaluate({order, allergies, activeMeds, ...}) -> the verdict, verbatim:
 *        { allowed, blocks[], overridables[], warnings[], findings[], unresolvedDrug,
 *          unresolvedActiveMeds[], rulePackVersion }
 *   OUT  { deterministic, explanation, decision } - three things a reader must never confuse:
 *        DETERMINISTIC   the engine's own findings, unaltered, with its rule-pack version. This is
 *                        the clinical content, and it is authoritative.
 *        EXPLANATION     MaiK's words about those findings. Never authoritative, never a finding.
 *        DECISION        what the clinician did. An explanation being read, or even rejected as
 *                        unhelpful, is NOT an override of anything - overriding a finding is a
 *                        different act, on a different record (SafetyOverride), with its own reason.
 *
 * IT FAILS CLOSED, AND THAT IS THE WHOLE POINT OF ITEM 7. If the rule pack will not load, if the
 * engine throws, or if the drug could not be resolved, MaiK does NOT explain. An explanation
 * generated over a check that did not run is the single most dangerous thing this file could
 * produce, because a clinician reading calm prose about a drug reasonably concludes it was checked.
 * The refusal says which check did not run, and the ward keeps the deterministic screen it already
 * had.
 *
 * AND IT CHECKS THAT MAIK DID NOT CONTRADICT THE VERDICT. A model handed three blocking findings and
 * asked to explain them can still emit "no significant concerns" - it is trained to be reassuring.
 * So the explanation is screened against the verdict it was given: reassurance while findings exist,
 * or a claim to have checked something the engine said it could not, withholds the text whole. This
 * is not a claim to detect every contradiction; it catches the reassuring ones, which are the ones
 * that hurt.
 *
 * NOTHING HERE ALTERS CLINICAL CONTENT. The rule pack is unapproved seed data by this repository's
 * own standing statement (rx-safety.js's header, vault/modules/WardSynQ.md's STATUS line), it does
 * not gate an order, and this file does not change that in either direction: it neither promotes the
 * content to authoritative nor weakens a single threshold. Every response carries `unapproved` so no
 * caller can present a MaiK explanation as a cleared clinical control.
 *
 * STATUS: IMPLEMENTED and TESTED through the real route against the real SafetyEngine and a
 * deterministic model. NOT clinically validated, and the clinical content it explains remains
 * unapproved.
 */

import { SafetyEngine, SEVERITY } from "../../wardsynq/wardsynq-safety.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, NATIVE_SYSTEM } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { screenOutput, requestNonce } from "../../wardsynq/wardsynq-secops.js";
import { TASK, invoke } from "./maik-gateway.js";
import { MaiKInteraction, REVIEW, TYPE as INTERACTION_TYPE } from "./maik-interaction.js";
import { makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* The instruction, fixed here. A caller cannot write it, because a caller that can write the
 * instruction can tell the model to disagree with the engine. */
const INSTRUCTION = [
  "A deterministic clinical safety engine has ALREADY evaluated this medication order against this hospital's own rule pack. Its findings are given below and they are the clinical decision.",
  "Your only job is to put those findings into plain language for the clinician reading them.",
  "You must NOT re-decide anything. Do not add a finding the engine did not report. Do not remove, soften, downgrade or dispute one it did. Do not say an order is safe, fine, or without concerns - that is not a judgement you are making.",
  "If the engine reported that something could NOT be checked, say so plainly; do not describe it as clear.",
  "Be brief. Name each finding and what it means for this patient.",
].join(" ");

/* Words that would make an explanation contradict a verdict carrying findings. A model asked to
 * explain three interactions and answering "no significant concerns" has not explained them; it has
 * replaced them. Deliberately narrow: these are the REASSURING contradictions, which are the ones a
 * clinician acts on without checking. */
const REASSURANCE = [
  /\bno (?:significant |major |clinically )?(?:concern|issue|problem|interaction|contraindication|risk)s?\b/i,
  /\b(?:is|appears|seems) (?:safe|fine|appropriate|acceptable)\b/i,
  /\bno (?:safety )?(?:findings?|alerts?|warnings?)\b/i,
  /\bnothing (?:of concern|to flag|significant)\b/i,
  /\bsafe to (?:give|administer|prescribe|proceed)\b/i,
  /\bcleared\b/i,
];

/** PURE. Did MaiK contradict the verdict it was handed? Returns the violations, never a verdict. */
function contradictions(text, verdict) {
  const out = [];
  const t = str(text);
  const hasFindings = (verdict.findings || []).length > 0;
  if (hasFindings) {
    for (const re of REASSURANCE) {
      if (re.test(t)) { out.push({ id: "reassurance-over-findings", why: `the engine reported ${verdict.findings.length} finding(s) and the explanation reads as reassurance` }); break; }
    }
  }
  /* A model claiming a check ran when the engine said it could not is the other direction of the
   * same failure: it converts "not checked" into "checked, clean". */
  if (verdict.unresolvedDrug && /\b(?:checked|screened|reviewed) (?:for|against)\b/i.test(t) && !/\bcould not\b|\bnot recognised\b|\bnot checked\b/i.test(t)) {
    out.push({ id: "claims-check-that-did-not-run", why: "the engine could not resolve this drug, so no check ran, and the explanation describes one" });
  }
  return out;
}

/** PURE. The engine's verdict, shaped for a reader and for the record. Nothing is recomputed. */
function deterministicView(verdict) {
  const f = (list) => (list || []).map((x) => ({ code: x.code, severity: x.severity, disposition: x.disposition, message: x.message }));
  return {
    /* `allowed` is the ENGINE'S word and it travels unchanged. This file does not decide what it
     * means for the ward - the prescribing and pharmacy screens already do that, identically. */
    allowed: verdict.allowed === true,
    blocks: f(verdict.blocks), overridables: f(verdict.overridables), warnings: f(verdict.warnings),
    findings: f(verdict.findings),
    unresolvedDrug: !!verdict.unresolvedDrug,
    unresolvedActiveMeds: verdict.unresolvedActiveMeds || [],
    rulePackVersion: verdict.rulePackVersion || null,
    /* The clinical content remains unapproved seed data. Carried on every response so a MaiK
     * explanation can never be presented as a cleared clinical control. */
    unapproved: true,
  };
}

/** PURE. A stable digest of what was explained, so a later reader can tell an explanation apart from
 *  the verdict it was written about, even after the order changes. */
function verdictSignature(view, order) {
  const codes = (view.findings || []).map((x) => `${x.code}:${x.severity}:${x.disposition}`).sort().join("|");
  return `${str(order.id)}@${order.version == null ? "?" : order.version}::${view.rulePackVersion || "no-pack"}::${codes || "none"}::${view.unresolvedDrug ? "unresolved" : "resolved"}`;
}

/** The service actor that writes the interaction row, exactly as maik-interaction.js does. */
function maikRecordActor() {
  return makeActor({ id: "service:maik-record", kind: KIND.SERVICE, tier: TIER.DRAFT,
    display: "MaiK interaction record", scope: { read: [INTERACTION_TYPE], write: [INTERACTION_TYPE] } });
}

async function open(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    const recorder = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: maikRecordActor(), role: "maik-record", roleSource: "wardsynq-maik",
    });
    return { svc, recorder, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/**
 * Explains the deterministic safety verdict for one medication order.
 * ctx: { migration, config, orderId, patientId, rulePack, actorDeps, recordDeps, fetchImpl?, correlationId? }
 */
async function explainOrderSafety(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const orderId = str(ctx.orderId);
  if (!orderId) return { ...base, ok: false, status: 422, error: "order_required", detail: "an explanation is always about one order" };

  const { svc, recorder, resolved, error } = await open(request, env, ctx);
  if (error) return { ...base, ...error };

  /* Read as the CALLER. An order they may not see cannot be explained to them. */
  let order = null;
  try { order = await svc.get("MedicationOrder", orderId); } catch { order = null; }
  if (!order) return { ...base, ok: false, status: 403, error: "order_unreadable", detail: "that order is not readable by this actor; no safety check was run and nothing was explained" };

  /* THE PATIENT BOUNDARY. A caller naming a different patient than the order's own is refused - the
   * right explanation filed against the wrong chart is the wrong-patient error. */
  const claimed = str(ctx.patientId);
  if (claimed && claimed !== str(order.patientId)) {
    return { ...base, ok: false, status: 409, error: "patient_mismatch",
      detail: "that order belongs to a different patient; nothing was evaluated and nothing was explained" };
  }
  const patientId = str(order.patientId);

  /* THE ENCOUNTER BOUNDARY, when one is claimed. */
  const encounterId = str(ctx.encounterId);
  if (encounterId) {
    let enc = null;
    try { enc = await svc.get("Encounter", encounterId); } catch { enc = null; }
    if (!enc || str(enc.patientId) !== patientId) {
      return { ...base, ok: false, status: 409, error: "encounter_mismatch", detail: "that admission belongs to another patient" };
    }
  }

  /* ---- THE DETERMINISTIC PART. This is the clinical decision, and MaiK has no hand in it. ---- */
  let verdict = null, engineError = null;
  try {
    const pack = ctx.rulePack;
    if (!pack) throw new Error("no rule pack is loaded");
    const [orders, allergies] = await Promise.all([
      svc.byPatient("MedicationOrder", patientId).catch(() => { throw new Error("the patient's medication list could not be read"); }),
      svc.byPatient("AllergyIntolerance", patientId).catch(() => { throw new Error("the patient's allergy list could not be read"); }),
    ]);
    const activeMeds = (orders || [])
      .filter((o) => o && o.status === "active" && o.id !== order.id)
      .map((o) => ({ drug: o.drug, drugCode: o.genericName || o.drugCode }));
    const engine = new SafetyEngine({ rulePack: pack });
    verdict = engine.evaluate({
      order: { drug: order.drug, drugCode: order.genericName || order.drugCode || order.drug, dose: order.dose, route: order.route },
      allergies: allergies || [], activeMeds,
    });
  } catch (e) { engineError = str(e && e.message) || "the safety engine could not run"; }

  /* FAIL CLOSED. No verdict, no explanation - and the refusal says which check did not run rather
   * than producing calm prose a clinician would read as "checked". */
  if (!verdict) {
    return { ...base, ok: false, status: 503, error: "safety_engine_unavailable",
      detail: `the deterministic safety check did not run (${engineError}), so MaiK will not explain anything about this order. Nothing here means the order is safe; it means it was not checked.`,
      deterministic: null, explanation: null };
  }

  const view = deterministicView(verdict);

  /* An unresolved drug means NO check ran for it. MaiK does not explain that either: there is
   * nothing to explain except the gap, and the deterministic screens already say so in their own
   * words. Returning the view without an explanation keeps the gap visible and unembellished. */
  if (view.unresolvedDrug) {
    return { ...base, ok: false, status: 409, error: "not_checked",
      detail: `"${str(order.drug)}" is not recognised by this hospital's decision-support content, so no allergy, interaction or dose check ran for it. There is no verdict to explain, and this is not a clean result.`,
      deterministic: view, explanation: null };
  }

  /* ---- THE EXPLANATION. Everything below is MaiK, and none of it is authoritative. ---- */
  const nonce = requestNonce(patientId);
  const findingsText = view.findings.length
    ? view.findings.map((f) => `- [${f.severity}/${f.disposition}] ${f.code}: ${f.message}`).join("\n")
    : "The engine reported no findings against this order.";
  const prompt = [
    INSTRUCTION, "",
    `Order: ${str(order.drug)}${order.dose ? ` ${str(order.dose)}` : ""}${order.route ? ` ${str(order.route)}` : ""}`,
    `Rule pack version: ${view.rulePackVersion || "unknown"}`,
    view.unresolvedActiveMeds.length ? `NOT interaction-checked against: ${view.unresolvedActiveMeds.join(", ")}` : "",
    "", "--- ENGINE FINDINGS (the clinical decision) ---", findingsText,
  ].filter(Boolean).join("\n");

  const answer = await invoke({
    task: TASK.EXPLAIN, phi: true,
    context: { patientId, provenance: [{ resourceType: "MedicationOrder", id: order.id, version: order.version }] },
    prompt, config: ctx.config, env, providers: ctx.providers, fetchImpl: ctx.fetchImpl,
  });
  if (!answer.ok) {
    /* The deterministic verdict is returned ANYWAY. MaiK being unavailable must never take the
     * clinical content away from the ward - the engine ran, and its findings are what matter. */
    return { ...base, ok: true, explained: false, deterministic: view, explanation: null,
      note: `MaiK could not explain this verdict (${answer.code}). The findings above are the deterministic engine's own and are unaffected.` };
  }

  const screen = screenOutput(answer.text, { patientId, nonce });
  const contra = contradictions(answer.text, view);
  const released = screen.released !== false && contra.length === 0;

  const at = new Date().toISOString();
  const id = `wsq-maik-cds-${patientId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "").slice(0, 14)}`;
  const signature = verdictSignature(view, order);

  const record = MaiKInteraction({
    id, patientId, encounterId: encounterId || order.encounterId || null, task: TASK.EXPLAIN,
    requestedBy: resolved.actor.id, requestedAt: at,
    sessionRef: (resolved.identity && resolved.identity.sessionRef) || null,
    correlationId: str(ctx.correlationId) || id,
    aiActor: "ai:maik",
    model: answer.model, generated: answer.generated, latencyMs: answer.latencyMs, usage: answer.usage,
    instruction: INSTRUCTION,
    question: `Explain the safety verdict for ${str(order.drug)}`,
    contextProvenance: [{ resourceType: "MedicationOrder", id: order.id, version: order.version }],
    contextDocuments: [],
    security: {
      documentsIncluded: 0, rejected: [], injectionFindings: [],
      outputViolations: (screen.violations || []).concat(contra), released,
    },
    output: released ? answer.text : null,
    withheld: released ? null : { reason: contra.length ? "the explanation contradicted the deterministic verdict" : "withheld by output screening",
      violations: (screen.violations || []).map((v) => v.id).concat(contra.map((v) => v.id)) },
    review: { state: REVIEW.PENDING, by: null, at: null, reason: null, editedOutput: null },
    /* WHICH SAFETY RESULT THIS EXPLANATION IS ABOUT (item 10). The signature pins the order version,
     * the rule-pack version and the exact finding set, so an explanation can be told apart from the
     * verdict of a LATER evaluation - which is how a stale explanation is detected rather than
     * assumed fresh. */
    safetyVerdict: { ...view, signature, orderId: order.id, orderVersion: order.version, evaluatedAt: at },
    /* An explanation proposes no clinical change, so there is nothing to preview and nothing that
     * accepting could write. Stated rather than left null-by-accident. */
    preview: null,
  });

  try {
    const out = await recorder.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, explained: released,
      deterministic: view,
      explanation: released ? answer.text : null,
      withheld: record.withheld,
      interaction: { ...record, version: out.record.version },
      /* THE THIRD THING, named so a reader cannot merge it with the other two: what the clinician
       * did. Reading or rejecting an explanation overrides nothing. */
      decision: { state: REVIEW.PENDING, overridesNothing: true,
        note: "Reviewing this explanation records what you thought of MaiK's words. It does not override, accept or dismiss any deterministic finding: overriding a finding is a separate act with its own reason, on the SafetyOverride record." } };
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), deterministic: view };
  }
}

/**
 * PURE. Is a stored explanation still about the order as it stands now?
 *
 * An explanation is written about ONE version of an order under ONE rule pack. Both move. A reader
 * shown yesterday's explanation beside today's order has been told something that was true and is
 * not; this is what lets the screen say so instead.
 */
function isStale(interaction, order, rulePackVersion) {
  const v = interaction && interaction.safetyVerdict;
  if (!v) return { stale: false, reasons: [] };
  const reasons = [];
  if (order && String(order.version) !== String(v.orderVersion)) reasons.push("the order has changed since this was written");
  if (rulePackVersion && v.rulePackVersion && String(rulePackVersion) !== String(v.rulePackVersion)) reasons.push("the decision-support content has changed since this was written");
  return { stale: reasons.length > 0, reasons };
}

export { INSTRUCTION, REASSURANCE, contradictions, deterministicView, verdictSignature, isStale, explainOrderSafety };
