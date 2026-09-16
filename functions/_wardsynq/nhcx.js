/* functions/_wardsynq/nhcx.js - owner S4: the NHCX exchange around the adapter (wardsynq/wardsynq-nhcx-adapter.js).
 *
 * WHAT A HOSPITAL CAN DO.
 *   - Check a patient's coverage with an NHCX payer (POST /ward/nhcx-eligibility, billing.charge). The check is a
 *     CoverageEligibilityCheck record, append-only; the payer's answer lands on it as a new version.
 *   - Submit a pre-authorisation (POST /ward/preauth, state requested) or a claim (POST /ward/claim-state submit)
 *     to an NHCX payer: billing.js runs the same adapter boundary, and this file supplies the sealed values and
 *     the correlation record.
 *   - Ask for the status of any of them (POST /ward/hcx-status, billing.charge), recorded on the record.
 *   - Receive the payer's answers at POST /api/queue/nhcx-callback/<orgId>/<resource>/<action>, the address a
 *     hospital registers as its endpoint URL in the participant registry.
 *
 * THE CORRELATION RECORD. Before anything leaves, a tenant-scoped system record `_wardsynq_nhcx_exchange`
 * (id nhcx-<correlation id>) names which record of which type, through which connector, the exchange is for. It
 * holds ids only: no name, no amount, no diagnosis. A callback whose correlation id is not one this hospital
 * sent, through the same connector, for the same kind of request, changes nothing.
 *
 * A CALLBACK IS BELIEVED ONLY WHEN, in order (research: HCX API security and message security pages):
 *   1. the bearer JWT verifies RS256 with the gateway signing certificate on a payer connector whose payer code
 *      is the message's sender, and its exp and iat hold. Otherwise nothing is written, not even an audit row,
 *      so the public door cannot grow the audit trail;
 *   2. the JWE decrypts with this hospital's own private key (the GCM tag authenticates the protected header);
 *   3. x-hcx-recipient_code is this hospital's participant code on that connector;
 *   4. the correlation id is an exchange this hospital sent through that connector for that kind of request.
 * Refusals after step 1 are audited. Only then is the record written, by a service actor that may write only
 * that record's type. A duplicate (same api call id) writes nothing.
 *
 * WHAT AN ANSWER MEANS HERE. A claim: acknowledged (or failed on an error outcome), with the payer's own figures.
 * The claim's lifecycle state is not moved: denying or settling remains a person's act. A pre-authorisation:
 * approved only on outcome complete or partial with an approved amount above zero; refused only on outcome
 * complete with an approved amount of exactly zero; anything else is acknowledged and stays requested.
 * An eligibility check: answered, with inforce, benefits and errors as the payer stated them.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { VersionConflictError } from "./repository.js";
import { makeActor, KIND, TIER, GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { activeConnectors, openConnectorSecrets } from "./connectors.js";
import { payerById } from "../../wardsynq/wardsynq-tpa-adapter.js";
import {
  PATHS, nhcxCall, connectionMissing, buildEligibilityBundle, buildStatusTask, peekJweHeader, decryptJwe,
  importDecryptionKey, verifyJwtRs256, parseNhcxResponse,
} from "../../wardsynq/wardsynq-nhcx-adapter.js";
import { makeSafeFetch } from "../_connect/onboard/net.js";

const EXCHANGE_TYPE = "_wardsynq_nhcx_exchange";
const ELIGIBILITY_TYPE = "CoverageEligibilityCheck";
const TYPE_OF = Object.freeze({ claim: "Claim", preauthorization: "PreAuthorisation", coverageeligibility: ELIGIBILITY_TYPE });
const CALLBACKS = Object.freeze({
  "coverageeligibility/on_check": ["coverageeligibility"], "preauth/on_submit": ["preauthorization"],
  "claim/on_submit": ["claim"], "hcx/on_status": ["claim", "preauthorization", "coverageeligibility"],
});
const MAX_BODY = 512 * 1024;
const BY = "service:nhcx";
const str = (v) => (v == null ? "" : String(v).trim());
const exchangeId = (correlationId) => `nhcx-${str(correlationId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)}`;
const auditEvent = (action, actor, scope, outcome) => ({ ts: new Date().toISOString(), actor, connectorId: "wardsynq-nhcx", action, outcome: outcome || "ok", scope });

/** The connector's sealed values, opened at the moment of use. */
const secretsFor = (env, payer) => openConnectorSecrets(env, { secretsEnc: (payer && payer.connectorSecrets) || {} });
const transport = (ctx) => { const f = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : (typeof fetch === "function" ? fetch : null); return f ? makeSafeFetch(f) : null; };

/** beforeSend for the adapter: the correlation record exists before the request leaves. Throws when it cannot be written. */
function exchangeRecorder(repo, tenantId, actorId) {
  return async (ex, { record, use, payer }) => {
    const kind = use === "preauthorization" ? "preauthorization" : use === "coverageeligibility" ? "coverageeligibility" : "claim";
    const at = new Date().toISOString();
    const rec = { resourceType: EXCHANGE_TYPE, id: exchangeId(ex.correlationId), version: 1, correlationId: ex.correlationId, kind, recordType: TYPE_OF[kind], recordId: str(record.id),
      connectorId: str(payer.connectorId) || null, payerId: str(payer.id), senderCode: ex.senderCode, recipientCode: ex.recipientCode, calls: [{ apiCallId: ex.apiCallId, path: ex.path, at }],
      answers: [], createdAt: at, writtenBy: { id: actorId, kind: "human", at } };
    await repo.append(tenantId, [rec], { audit: auditEvent("nhcx.exchange.open", actorId, { exchangeId: rec.id, kind, recordType: rec.recordType, recordId: rec.recordId, connectorId: rec.connectorId, path: ex.path }) });
  };
}

/** billing.js: the dependencies the NHCX adapter kind needs for one request. */
function nhcxAdapterDeps(env, ctx, actorId) {
  return { fetch: transport(ctx), openSecrets: (payer) => secretsFor(env, payer), beforeSend: exchangeRecorder(ctx.recordDeps.repository, ctx.migration.tenantId, actorId) };
}

async function openService(request, env, ctx, need) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_a_wardsynq_hospital" } };
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, need, ctx.actorDeps);
    return { svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: r.tenant, actor: r.actor, role: r.role, roleSource: r.source }), actorId: r.actor.id, repo: ctx.recordDeps.repository, tenantId: mig.tenantId };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", message: str(e && e.message) } };
  }
}
const readFailed = (e) => (e instanceof GovernanceError ? { ok: false, status: 403, error: "permission" } : { ok: false, status: 502, error: "record_read_failed", message: "The record could not be read, so nothing was sent." });
const writeFailed = (sent) => ({ ok: false, status: 502, error: "record_write_failed",
  message: sent ? "The request reached the NHCX gateway but could not be recorded here. Use Check status later; do not send it again blindly." : "Nothing was recorded." });

/** A payer that is NHCX, or the refusal that says why not. */
function nhcxPayer(payers, payerId) {
  const payer = payerById(payers, payerId);
  if (!payer) return { refusal: { ok: false, status: 422, error: "payer_not_configured", message: `Payer "${str(payerId)}" is not configured for this hospital.` } };
  if (str(payer.adapter) !== "nhcx") return { refusal: { ok: false, status: 422, error: "not_an_nhcx_payer", message: "This payer is not connected through NHCX." } };
  return { payer };
}

/**
 * ctx: { migration, recordDeps, actorDeps, patientId, payerId, policyNumber, purpose?, payers, fetchImpl? }
 * Not connected: 409 naming what is missing, nothing written and nothing sent.
 */
async function checkEligibility(request, env, ctx) {
  const o = await openService(request, env, ctx, "record:write");
  if (o.error) return o.error;
  const patientId = str(ctx.patientId), policyNumber = str(ctx.policyNumber);
  if (!patientId) return { ok: false, status: 422, error: "patient_required" };
  const { payer, refusal } = nhcxPayer(ctx.payers, ctx.payerId);
  if (refusal) return refusal;
  // Reading this patient's checks first means a caller who may not see them sends nothing on their behalf.
  try { await o.svc.byPatient(ELIGIBILITY_TYPE, patientId); } catch (e) { return readFailed(e); }
  const secrets = await secretsFor(env, payer);
  const missing = connectionMissing(payer, secrets);
  if (missing.length) return { ok: false, status: 409, error: "nhcx_not_connected", message: `NHCX is not connected for this payer, so nothing was sent. Missing: ${missing.join(", ")}.` };
  const now = new Date().toISOString();
  const id = `wsq-elig-${crypto.randomUUID()}`;
  const check = { id, patientId, payerId: payer.id, policyNumber, purpose: str(ctx.purpose) || "validation", entererId: o.actorId };
  const built = buildEligibilityBundle(check, payer, { now });
  if (built.missing) return { ok: false, status: 422, error: "eligibility_incomplete", missing: built.missing, message: `Nothing was sent: the request needs ${built.missing.join(", ")}.` };
  const adapter = await nhcxCall({ payer, secrets, path: PATHS.eligibility, fhir: built.bundle, fetch: transport(ctx),
    beforeSend: (ex) => exchangeRecorder(o.repo, o.tenantId, o.actorId)(ex, { record: check, use: "coverageeligibility", payer }) });
  const record = { resourceType: ELIGIBILITY_TYPE, id, patientId, payerId: payer.id, policyNumber, purpose: check.purpose, requestedBy: o.actorId, at: now,
    state: adapter.state === "sent" ? "sent" : "failed", adapter: { adapterId: `nhcx:${payer.id}`, state: adapter.state, note: adapter.note || null, ...(adapter.exchange ? { exchange: adapter.exchange } : {}), attemptedAt: now },
    response: null, source: { system: "wardsynq-native", sourceId: `eligibility:${id}` } };
  if (!adapter.exchange) return { ok: false, status: 502, error: "nhcx_not_sent", message: adapter.note };
  try {
    const out = await o.svc.put(record, { idempotencyKey: null });
    return { ok: true, eligibilityId: id, state: record.state, recordVersion: out.record.version, check: record };
  } catch { return writeFailed(adapter.state === "sent"); }
}

const STATUS_TYPES = Object.freeze({ claim: "Claim", preauth: "PreAuthorisation", eligibility: ELIGIBILITY_TYPE });
const ENTITY = Object.freeze({ claim: "claim", preauth: "preauthorization", eligibility: "coverageeligibility" });

/** ctx: { migration, recordDeps, actorDeps, recordKind: claim|preauth|eligibility, recordId, payers, fetchImpl? } */
async function requestStatus(request, env, ctx) {
  const o = await openService(request, env, ctx, "record:write");
  if (o.error) return o.error;
  const type = STATUS_TYPES[str(ctx.recordKind)];
  if (!type || !str(ctx.recordId)) return { ok: false, status: 422, error: "record_required", message: "Name the claim, pre-authorisation or eligibility check." };
  let rec;
  try { rec = await o.svc.get(type, str(ctx.recordId)); } catch (e) { return readFailed(e); }
  if (!rec) return { ok: false, status: 404, error: "record_not_found" };
  const exchange = rec.adapter && rec.adapter.exchange;
  if (!exchange || !str(exchange.correlationId)) return { ok: false, status: 409, error: "never_sent_via_nhcx", message: "This was never sent through NHCX, so there is no status to ask for." };
  const { payer, refusal } = nhcxPayer(ctx.payers, rec.payerId);
  if (refusal) return refusal;
  const secrets = await secretsFor(env, payer);
  const missing = connectionMissing(payer, secrets);
  if (missing.length) return { ok: false, status: 409, error: "nhcx_not_connected", message: `NHCX is not connected for this payer, so nothing was sent. Missing: ${missing.join(", ")}.` };
  const task = buildStatusTask({ recordId: rec.id, entityType: ENTITY[str(ctx.recordKind)] });
  const result = await nhcxCall({ payer, secrets, path: PATHS.status, fhir: task, correlationId: exchange.correlationId, workflowId: exchange.workflowId, fetch: transport(ctx),
    beforeSend: async (ex) => {
      const cur = await o.repo.latest(o.tenantId, EXCHANGE_TYPE, exchangeId(ex.correlationId));
      if (!cur) throw new Error("exchange missing");
      const at = new Date().toISOString();
      await o.repo.append(o.tenantId, [{ ...cur, version: cur.version + 1, calls: [...(cur.calls || []), { apiCallId: ex.apiCallId, path: ex.path, at }], writtenBy: { id: o.actorId, kind: "human", at } }],
        { audit: auditEvent("nhcx.status.request", o.actorId, { exchangeId: cur.id, recordType: type, recordId: rec.id }) });
    } });
  const { meta, version, ...body } = rec;
  const at = new Date().toISOString();
  const next = { ...body, resourceType: type, statusChecks: [...(rec.statusChecks || []), { at, by: o.actorId, state: result.state, note: result.note || null, apiCallId: (result.exchange && result.exchange.apiCallId) || null }].slice(-20) };
  try {
    const out = await o.svc.put(next, { expectedVersion: version });
    return { ok: result.state === "sent", ...(result.state === "sent" ? {} : { status: 502, error: "nhcx_status_not_sent" }), statusCheck: next.statusChecks[next.statusChecks.length - 1], recordVersion: out.record.version, message: result.note };
  } catch (e) {
    if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", message: "The record changed at the same moment. Reload; the status request itself was " + (result.state === "sent" ? "sent." : "not sent.") };
    return writeFailed(result.state === "sent");
  }
}

/* ---- the callback ----------------------------------------------------------------------------------- */

const serviceActor = (type) => makeActor({ id: BY, kind: KIND.SERVICE, tier: TIER.DRAFT, display: "NHCX payer response", scope: { read: [type], write: [type] } });
const header = (headers, name) => str(headers && typeof headers.get === "function" ? headers.get(name) : "");
const num = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** PURE. The target record after the payer's answer. Returns null when the answer does not fit the record. */
function applyAnswer(rec, kind, answer, meta) {
  const { at, apiCallId, errorNote } = meta;
  const { meta: _m, version: _v, ...body } = rec;
  const next = { ...body };
  const failed = !!errorNote || (answer && answer.outcome === "error") || (answer && answer.errors && answer.errors.length && kind !== "coverageeligibility");
  const note = errorNote || (answer && (answer.disposition || (answer.errors || []).join("; "))) || (failed ? "The payer returned an error." : "Answered by the payer through NHCX.");
  next.adapter = { ...(rec.adapter || {}), state: failed ? "failed" : "acknowledged", outcome: (answer && answer.outcome) || null, note: str(note).slice(0, 300), answeredAt: at, answerApiCallId: apiCallId,
    ...(answer && answer.payerReference ? { payerReference: answer.payerReference } : {}),
    ...(!failed && answer && answer.adjudication ? { adjudication: answer.adjudication } : {}),
    ...(!failed && answer && answer.disallowances && answer.disallowances.length ? { disallowances: answer.disallowances } : {}) };
  if (kind === "claim") {
    if (!failed && answer) {
      if (answer.payerReference) { next.payerReference = answer.payerReference; next.acknowledgedAt = at; }
      const approved = answer.adjudication && num(answer.adjudication.approved);
      if (approved != null) next.approvedAmount = approved;
      next.history = [...(rec.history || []), { at, event: "payer-response", by: BY, detail: `NHCX ${answer.outcome || "answer"}${approved != null ? `: approved ${approved} (the payer's figure)` : ""}` }];
    } else next.history = [...(rec.history || []), { at, event: "payer-response", by: BY, detail: `NHCX error: ${str(note).slice(0, 200)}` }];
  } else if (kind === "preauthorization") {
    const approved = answer && answer.adjudication ? num(answer.adjudication.approved) : null;
    if (!failed && answer && (answer.outcome === "complete" || answer.outcome === "partial") && approved != null && approved > 0) {
      next.state = "approved"; next.authorizedAmount = approved; next.decisionAt = at;
      if (answer.preAuthRef || answer.payerReference) next.payerReference = answer.preAuthRef || answer.payerReference;
      next.note = "A funding decision. Clinical indication is decided independently and is not recorded here.";
    } else if (!failed && answer && answer.outcome === "complete" && approved === 0) {
      next.state = "refused"; next.decisionAt = at; next.reason = str(answer.disposition) || "Refused by the payer through NHCX; no reason was given.";
      next.note = "The payer will not fund this. That is a funding decision and NOT a clinical one: it does not mean the treatment is not indicated. If it is indicated it should be provided, and the funding disagreement pursued separately.";
    }
  } else {
    next.state = failed ? "failed" : "answered";
    next.response = answer ? { outcome: answer.outcome || null, disposition: answer.disposition || null, inforce: answer.inforce == null ? null : answer.inforce, benefits: answer.benefits || [], errors: answer.errors || [], at }
      : { outcome: "error", disposition: str(note).slice(0, 300), inforce: null, benefits: [], errors: [], at };
  }
  return next;
}

/**
 * The payer's answer, through the gateway. ctx: { migration, recordDeps, action ("claim/on_submit"...), nowMs? }.
 * Returns { status, body } in the protocol's response shape.
 */
async function receiveNhcxCallback(request, env, ctx) {
  const mig = ctx.migration;
  const nowIso = new Date().toISOString();
  const reply = (status, hdr, error) => ({ status, body: { timestamp: nowIso, api_call_id: str(hdr && hdr["x-hcx-api_call_id"]) || null, correlation_id: str(hdr && hdr["x-hcx-correlation_id"]) || null, ...(error ? { error: { code: error[0], message: error[1] } } : {}) } });
  if (!mig || mig.mode === "off" || !mig.tenantId) return reply(404, null, ["not_found", "Not found."]);
  const kinds = CALLBACKS[str(ctx.action)];
  if (!kinds) return reply(404, null, ["not_found", "Not an NHCX callback this hospital receives."]);
  const repo = ctx.recordDeps.repository, tenantId = mig.tenantId;
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return reply(400, null, ["bad_body", "Empty or too large."]);
  let body; try { body = JSON.parse(raw); } catch { return reply(400, null, ["bad_body", "Not JSON."]); }
  const jwe = body && typeof body.payload === "string" ? body.payload : null;
  const clear = !jwe && body && typeof body === "object" && str(body["x-hcx-status"]) ? body : null;   // a protocol error answer is sent in clear
  const hdr = jwe ? peekJweHeader(jwe) : clear;
  if (!hdr || !str(hdr["x-hcx-sender_code"]) || !str(hdr["x-hcx-correlation_id"])) return reply(400, hdr, ["bad_body", "No protocol headers."]);
  const bearer = /^Bearer\s+(.+)$/i.exec(header(request.headers, "authorization"));
  if (!bearer) return reply(401, hdr, ["unauthorized", "A bearer token is required."]);

  let candidates;
  try { candidates = (await activeConnectors(repo, tenantId, "payer")).filter((c) => c.provider === "nhcx" && str(c.settings && c.settings.recipientCode) === str(hdr["x-hcx-sender_code"])); }
  catch { return reply(503, hdr, ["unavailable", "Try again."]); }
  if (!candidates.length) return reply(404, hdr, ["unknown_sender", "This hospital has no NHCX payer with that participant code."]);
  let conn = null, secrets = null;
  for (const c of candidates) {
    const s = await openConnectorSecrets(env, c);
    if (!s.signingCert) continue;
    if ((await verifyJwtRs256(bearer[1], s.signingCert, ctx.nowMs)).ok) { conn = c; secrets = s; break; }
  }
  if (!conn) return reply(401, hdr, ["unauthorized", "The bearer token did not verify."]);

  const audit = (action, scope, outcome) => auditEvent(action, BY, { connectorId: conn.id, callback: str(ctx.action), apiCallId: str(hdr["x-hcx-api_call_id"]).slice(0, 80), ...scope }, outcome);
  const refused = async (status, code, message, scope) => {
    try { await repo.auditOnly(tenantId, audit("nhcx.callback.refused", { reason: code, ...(scope || {}) }, "refused")); } catch { return reply(503, hdr, ["unavailable", "Try again."]); }
    return reply(status, hdr, [code, message]);
  };

  let protectedHdr = hdr, payload = null;
  if (jwe) {
    try { const d = await decryptJwe(jwe, await importDecryptionKey(secrets.privateKey)); protectedHdr = d.header; payload = d.payload; }
    catch { return refused(400, "decrypt_failed", "The payload could not be decrypted with this hospital's key."); }
  }
  if (str(protectedHdr["x-hcx-sender_code"]) !== str(conn.settings && conn.settings.recipientCode)) return refused(403, "wrong_sender", "The encrypted header names a different sender.");
  if (str(protectedHdr["x-hcx-recipient_code"]) !== str(conn.settings && conn.settings.senderCode)) return refused(403, "wrong_recipient", "This message is not addressed to this hospital.");
  const correlationId = str(protectedHdr["x-hcx-correlation_id"]);
  let ex;
  try { ex = await repo.latest(tenantId, EXCHANGE_TYPE, exchangeId(correlationId)); } catch { return reply(503, protectedHdr, ["unavailable", "Try again."]); }
  if (!ex || ex.correlationId !== correlationId || ex.connectorId !== conn.id || !kinds.includes(ex.kind)) return refused(404, "unknown_correlation", "No request this hospital sent matches this correlation id.");
  const apiCallId = str(protectedHdr["x-hcx-api_call_id"]);
  if ((ex.answers || []).some((a) => a.apiCallId === apiCallId)) return reply(202, protectedHdr);

  const status = str(protectedHdr["x-hcx-status"]);
  let errorNote = null, answer = null;
  if (status === "response.error" || clear) {
    const d = protectedHdr["x-hcx-error_details"];
    errorNote = `The payer or gateway returned an error${d && (d.message || d.code) ? `: ${str(d.message || d.code).slice(0, 200)}` : "."}`;
  } else {
    answer = parseNhcxResponse(payload);
    const want = ex.kind === "coverageeligibility" ? "eligibility" : "claim";
    if (answer.kind !== want) return refused(400, "wrong_resource", "The payload is not the response this request expects.", { exchangeId: ex.id });
  }

  const svc = new RecordService({ repository: repo, pseudonym: ctx.recordDeps.pseudonym, tenant: { id: tenantId }, actor: serviceActor(ex.recordType), role: "nhcx", roleSource: "wardsynq-nhcx" });
  let rec;
  try { rec = await svc.get(ex.recordType, ex.recordId); } catch { return reply(503, protectedHdr, ["unavailable", "Try again."]); }
  if (!rec) return refused(404, "record_missing", "The request this answers is not on record.", { exchangeId: ex.id });
  const at = new Date().toISOString();
  const next = applyAnswer(rec, ex.kind, answer, { at, apiCallId, errorNote });
  try { await svc.put({ ...next, resourceType: ex.recordType }, { expectedVersion: rec.version }); }
  catch (e) { return reply(e instanceof VersionConflictError ? 409 : 503, protectedHdr, ["unavailable", "Try again."]); }
  const answers = [...(ex.answers || []), { apiCallId, callback: str(ctx.action), state: next.adapter.state, outcome: next.adapter.outcome || null, at }].slice(-50);
  try {
    await repo.append(tenantId, [{ ...ex, version: ex.version + 1, answers, writtenBy: { id: BY, kind: "service", at } }],
      { audit: audit("nhcx.callback.recorded", { exchangeId: ex.id, recordType: ex.recordType, recordId: ex.recordId, state: next.adapter.state, outcome: next.adapter.outcome || null }) });
  } catch (e) { if (!(e instanceof VersionConflictError)) return reply(503, protectedHdr, ["unavailable", "Try again."]); }
  return reply(202, protectedHdr);
}

export { EXCHANGE_TYPE, ELIGIBILITY_TYPE, CALLBACKS, exchangeId, nhcxAdapterDeps, checkEligibility, requestStatus, applyAnswer, receiveNhcxCallback };
