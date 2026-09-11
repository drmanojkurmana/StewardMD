/* functions/_wardsynq/twin-copilot.js — TASK 10.17: MaiK over the hospital, not over one chart.
 *
 * NOT A FORK OF maik-interaction.js's askAboutPatient(). That function hard-requires a patientId -
 * "a MaiK request is always about one identified patient" - and that requirement is correct for
 * every existing MaiK caller and is not weakened here. This file calls the SAME maik-gateway.js
 * route()/invoke() pipeline directly (the provider routing, PHI-approval gate and answer-recording
 * machinery every MaiK caller shares), with a context BUILDER for hospital-wide operational state
 * instead of one patient's chart. It is a second CALLER of the gateway, never a second gateway.
 *
 * PHI IS TREATED AS TRUE, ALWAYS, EVEN THOUGH THE CONTEXT CARRIES NO PATIENT NAME. Hospital
 * operational state is DERIVED from the clinical record - a critical-result count, a bed-occupancy
 * figure, a discharge-readiness list all come from real patient data upstream, even summarised to a
 * number. Claiming `phi: false` to reach a faster or unapproved model would be exactly the shortcut
 * maik-gateway.js's looksLikePhi() exists to catch, and this file does not attempt it: `phi: true`
 * unconditionally, routed through the same phiApproved gate as every patient-level MaiK call.
 *
 * MAIK MAY NOT INVENT STATE (plan section 25). The instruction fixed below forbids the model from
 * stating a number, a bed, a patient count or a staffing figure it was not given in the twin
 * snapshot - it may only speak about what buildTwinSnapshot() already computed. It is handed NO
 * safety verdict and no capability to declare one - this file never touches the SafetyEngine, orders,
 * or anything maik-cds.js already governs; a hospital-operations question and a clinical-safety
 * question are different things asked of different files.
 *
 * THE SNAPSHOT ITSELF CARRIES UNTRUSTED TEXT, AND IS SCANNED FOR IT. Most of a twin snapshot is
 * counts, but emergencyStatus and listBlackouts both carry a human-authored free-text `reason` - the
 * exact same kind of content maik-chart-context.js already treats as untrusted and fences for
 * patient-level MaiK calls. Anyone able to declare an emergency or block a period can put arbitrary
 * text into a field this file later hands to a model. scanForInjection() (wardsynq-secops.js) is run
 * over the assembled snapshot text before it becomes a prompt, and a hit is RECORDED on the
 * interaction, never silently dropped and never used to block the question outright - it is
 * evidence for the reviewer, the same discipline wardsynq-secops.js states for itself: "a signal is
 * evidence that something in the record is trying to steer the model... not a filter".
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { screenOutput, requestNonce, scanForInjection } from "../../wardsynq/wardsynq-secops.js";
import { TASK, invoke } from "./maik-gateway.js";
import { makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { buildTwinSnapshot } from "./digital-twin.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "TwinInteraction";

const INSTRUCTION = [
  "You are answering a question about hospital-wide OPERATIONAL state - census, capacity, backlog, staffing signals, active emergencies - not one patient's clinical chart.",
  "You are given a snapshot of what this system currently knows. Use ONLY the numbers and facts in that snapshot. Never state a bed count, patient count, backlog figure, staffing number or any other operational fact that is not written in the snapshot below.",
  "If a section of the snapshot is marked unavailable, say plainly that it is unavailable and why - never fill the gap with a plausible-sounding number.",
  "If a section is marked as NOT BUILT, say plainly that this system does not track that yet - never guess a figure for it.",
  "You explain and summarise. You do not decide anything, you do not declare an emergency, you do not recommend a specific clinical action for a named patient, and you have no authority over the deterministic safety engine or any order.",
].join(" ");

/** The service actor that writes the interaction row - the same pattern maik-interaction.js's own
 *  maikRecordActor() uses, and for the same reason: the asking clinician may hold read-only EMR_VIEW
 *  and nothing wider, and a new record type should not need every asker to also hold its write scope. */
function twinRecordActor() {
  return makeActor({ id: "service:twin-record", kind: KIND.SERVICE, tier: TIER.DRAFT,
    display: "Digital twin interaction record", scope: { read: [TYPE], write: [TYPE] } });
}

/** PURE-ish (only formats). Turns the twin snapshot into the plain text MaiK is actually shown. */
function snapshotText(twin) {
  const lines = [`Generated: ${twin.generatedAt}${twin.ward ? ` (ward: ${twin.ward})` : ""}`, `Sections answered: ${twin.sectionsOk}/${twin.sectionsTotal}`, ""];
  for (const [key, s] of Object.entries(twin.sections)) {
    if (s.status === "ok") lines.push(`[${key}] freshness=${s.freshness}: ${JSON.stringify(s.data)}`);
    else lines.push(`[${key}] UNAVAILABLE: ${s.error}${s.detail ? ` - ${s.detail}` : ""}`);
  }
  lines.push("", "NOT BUILT (do not answer as if these exist):");
  for (const [key, reason] of Object.entries(twin.notBuilt)) lines.push(`[${key}] ${reason}`);
  return lines.join("\n");
}

/**
 * Answers a question about the hospital's operational state.
 * ctx: { migration, config, question, task?, ward?, escalationPolicy?, includeFinance?, actorDeps,
 *        recordDeps, fetchImpl?, providers?, correlationId?, idempotencyKey? }
 */
async function askAboutHospital(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const question = str(ctx.question);
  if (!question) return { ...base, ok: false, status: 422, error: "question_required", detail: "a Command Copilot question needs a question" };
  const task = [TASK.SUMMARISE, TASK.EXPLAIN, TASK.ANSWER].includes(ctx.task) ? ctx.task : TASK.SUMMARISE;

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) };
  }
  const svc = new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
  });
  const recorder = new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: resolved.tenant, actor: twinRecordActor(), role: "twin-record", roleSource: "wardsynq-twin",
  });

  /* THE SNAPSHOT IS BUILT AS THIS CALLER, through the exact same function the /ward/twin route uses -
   * a Command Copilot question can never see a section the asker's own request would not have seen. */
  const twinResult = await buildTwinSnapshot(request, env, {
    migration: mig, ward: ctx.ward, escalationPolicy: ctx.escalationPolicy, includeFinance: ctx.includeFinance,
    actorDeps: ctx.actorDeps, recordDeps: ctx.recordDeps, thresholds: ctx.thresholds,
  });
  if (!twinResult.ok || !twinResult.twin) return { ...base, ok: false, status: 502, error: "twin_unavailable", detail: "the hospital snapshot could not be built, so there is nothing for MaiK to answer from" };
  const twin = twinResult.twin;

  const nonce = requestNonce(mig.tenantId);
  const snapshotBody = snapshotText(twin);
  /* The scan runs over the SNAPSHOT ONLY, not the user's own question - a clinician typing "ignore
   * previous instructions" while venting about a bad shift is not an attacker, and flagging their
   * own words would train people to distrust the tool for the wrong reason. What is scanned is
   * content a THIRD PARTY (whoever declared the emergency or blocked the period) could have planted. */
  const injectionScan = scanForInjection(snapshotBody, "twin-snapshot");
  const prompt = [INSTRUCTION, "", "--- HOSPITAL SNAPSHOT ---", snapshotBody, "", `The user asks: ${question}`].join("\n");
  const provenance = twin.provenance.map((p) => ({ resourceType: `twin:${p.section}`, id: p.section, version: null, dataSource: p.dataSource, generatedAt: p.generatedAt }));

  const answer = await invoke({
    task, phi: true, context: { provenance }, prompt,
    config: ctx.config, env, providers: ctx.providers, fetchImpl: ctx.fetchImpl,
  });
  if (!answer.ok) {
    /* CONFIGURATION REFUSALS ARE HARD REFUSALS, exactly as maik-interaction.js's own askAboutPatient
     * treats them (maik-interaction.js:252) - no PHI-approved provider, or MaiK switched off, is an
     * administrator's decision that has not been made yet, not a transient fault. Only a genuine
     * runtime failure (the provider unreachable, empty answer) degrades gracefully to "here is the
     * twin anyway" - the same distinction maik-cds.js draws for a SAFETY reason (the deterministic
     * verdict must survive MaiK being down); here the twin snapshot is the equivalent of that verdict. */
    if (answer.code === "no_phi_approved_model" || answer.code === "maik_disabled") {
      return { ...base, ok: false, status: 409, error: answer.code, detail: answer.detail };
    }
    return { ...base, ok: true, answered: false, twin, answer: null,
      note: `MaiK could not answer (${answer.code}). The hospital snapshot above is unaffected and unchanged.` };
  }

  const screen = screenOutput(answer.text, { nonce });
  const at = new Date().toISOString();
  /* The nonce is the entropy, exactly as maik-interaction.js's own idFor() uses it - a millisecond
   * timestamp alone collides when two questions are asked inside the same second. */
  const id = `wsq-twin-${String(mig.tenantId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "").slice(0, 14)}-${String(nonce || "").slice(0, 8)}`;

  const record = {
    resourceType: TYPE, id, version: undefined,
    requestedBy: resolved.actor.id, requestedAt: at,
    correlationId: str(ctx.correlationId) || id,
    aiActor: "ai:maik",
    task, question, instruction: INSTRUCTION,
    model: answer.model, generated: answer.generated, latencyMs: answer.latencyMs, usage: answer.usage,
    twinGeneratedAt: twin.generatedAt, sectionsProvenance: provenance,
    security: {
      outputViolations: screen.violations || [], released: screen.released !== false,
      /* Evidence, never a filter - see the header. A hit here does not stop the question from being
       * answered; it stays on the record for whoever reviews the answer. */
      injectionFindings: injectionScan.suspicious ? [{ id: injectionScan.source, signals: injectionScan.signals }] : [],
    },
    output: screen.released !== false ? answer.text : null,
    withheld: screen.released === false ? { reason: "withheld by output screening", violations: (screen.violations || []).map((v) => v.id) } : null,
    review: { state: "pending", by: null, at: null, reason: null, editedOutput: null },
    meta: { recordedAt: at, effectiveAt: at, amendedAt: null,
      source: { system: "wardsynq-native", sourceId: null, importedAt: at }, derivedFrom: [] },
  };

  try {
    const out = await recorder.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, answered: record.security.released,
      twin, answer: record.output, interaction: { ...record, version: out.record.version } };
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), twin };
  }
}

/** ctx: { migration, interactionId, decision (pending|accepted|rejected|edited), reason?,
 *  editedOutput?, actorDeps, recordDeps }. Mirrors maik-interaction.js's reviewInteraction() exactly:
 *  reviewing a Command Copilot answer NEVER writes a clinical record - there is nothing here for a
 *  reviewer to accept INTO the chart, only a judgement of whether the words were useful. */
async function reviewTwinInteraction(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const id = str(ctx.interactionId);
  const decision = str(ctx.decision);
  if (!id) return { ...base, ok: false, status: 422, error: "interaction_required" };
  if (!["accepted", "edited", "rejected"].includes(decision)) return { ...base, ok: false, status: 422, error: "bad_decision" };
  if (decision === "rejected" && str(ctx.reason).length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this answer was not useful" };

  let resolved;
  try { resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps); }
  catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) };
  }
  const recorder = new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: resolved.tenant, actor: twinRecordActor(), role: "twin-record", roleSource: "wardsynq-twin",
  });

  let current;
  try { current = await recorder.get(TYPE, id); } catch { current = null; }
  if (!current) return { ...base, ok: false, status: 404, error: "interaction_not_found" };
  if (current.review && current.review.state !== "pending") return { ...base, ok: false, status: 409, error: "already_reviewed", interaction: current };

  const next = { ...current, review: { state: decision, by: resolved.actor.id, at: new Date().toISOString(), reason: str(ctx.reason) || null, editedOutput: decision === "edited" ? str(ctx.editedOutput) || null : null } };
  try {
    const { meta, version, writtenBy, ...rest } = next;
    const out = await recorder.put(rest, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, interaction: { ...rest, version: out.record.version } };
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message) }; }
}

export { TYPE, INSTRUCTION, twinRecordActor, snapshotText, askAboutHospital, reviewTwinInteraction };
