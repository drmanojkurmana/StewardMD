/* functions/_wardsynq/billing.js - the money reads the chart and never writes to it.
 *
 * `wardsynq/wardsynq-billing.js` has carried a careful claims engine since P0 and NOTHING CALLED IT:
 * the eighth piece of finished, unreachable code found in this session. Its thesis is not that a
 * wrong bill is expensive. It is that the money starts deciding what the chart says, and the shape
 * that takes is always the same - a charge is refused for want of a diagnosis, and the diagnosis
 * appears the following morning.
 *
 * THE STRUCTURAL GUARANTEE IS THE GRANT, NOT THIS COMMENT. A role holding BILLING_CHARGE and no EMR
 * capability may write `Claim` and `PreAuthorisation` and NOTHING ELSE (functions/_wardsynq/actor.js).
 * It cannot write a Condition, so it cannot add the diagnosis that would justify its own charge -
 * not because this file declines to offer the call, but because the record service would refuse it.
 * That is the whole design, and it is the reason billing is wired as its own capability rather than
 * as a clinician doing paperwork.
 *
 * IT READS THE PROBLEM LIST AND NOTHING ELSE. Coding needs to know whether a diagnosis is written
 * down. It does not need the notes, the results, or the drug chart, and a coder granted the whole
 * chart to answer one question is a privacy failure that no policy document prevents. The grant is
 * Condition, Claim, PreAuthorisation.
 *
 * TWO KINDS OF SUPPORT THIS RECORD CANNOT YET GIVE, STATED RATHER THAN FAKED:
 *
 *   - INFERRED support. The module can accept "an observation or a medication is consistent with
 *     this code" via `supportsCodes`, and NOTHING IN THIS BUILD CARRIES ONE: no order, result or
 *     prescription records the indication it was made for. So no code is ever inferred here, and
 *     every code is either on the problem list or refused. That is the strict direction, and
 *     inventing a mapping from a potassium to an ICD code would be inventing clinical data.
 *   - SEVERITY. `Condition` has no severity field, so `severityEvidence` is genuinely empty and
 *     `detectUpcoding` flags every severity-tiered code as unsupported. THAT FLAG IS CORRECT: this
 *     record cannot support a severity claim. It is a gap in the chart, and billing is not allowed
 *     to close it. The finding is attached to the claim and blocks a silent submission.
 *
 * A DIFFERENTIAL IS NOT A DIAGNOSIS. Conditions marked `refuted` or `differential` are withheld from
 * the coder's view of support. "One of the things it might be" is exactly the entry a claim should
 * never be built on, and a refuted one supporting a charge is backwards.
 *
 * IT DOES NOT PRICE ANYTHING. No tariff, no scheme rate card, no payer transport, no ledger. This
 * answers whether the record supports a code, and records what happened to the claim afterwards.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import {
  CLAIM_STATE, PREAUTH_STATE, SUPPORT, BillingError,
  mayProceedClinically, supportFor, codeClaim, detectUpcoding,
  submit, deny, resubmit, recordAdjudication, preAuthorisation, upcodingWatchlist,
  recordAcknowledgement, settle, moveBalanceToPatient, costEstimate,
} from "../../wardsynq/wardsynq-billing.js";
import { submitViaAdapter, adapterForPayer, payerById, publicPayers, payerRuleWarnings } from "../../wardsynq/wardsynq-tpa-adapter.js";
import { resolveParties, partiesRecord } from "./payer-contracts.js";
import { STAY_PAYER_TYPE, stayPayerWithParties } from "./stay-payer.js";
import { FhirClaimAdapter } from "../../wardsynq/wardsynq-fhir-claim-adapter.js";
import { NhcxAdapter } from "../../wardsynq/wardsynq-nhcx-adapter.js";
import { openSecret } from "./webhooks.js";
import { nhcxAdapterDeps, ELIGIBILITY_TYPE } from "./nhcx.js";
import { makeSafeFetch } from "../_connect/onboard/net.js";
import { makeSecrets } from "../_connect/secrets.js";
import { priceWith } from "./charge-capture.js";
import { scrubClaim, claimFacts, checklistOf, recordPayerQuery, answerOpenQueries, markDocuments, classifyDenial } from "./claims-ops.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const CLAIM_TYPE = "Claim";
const PREAUTH_TYPE = "PreAuthorisation";
const ESTIMATE_TYPE = "CostEstimate";

/* ---- P1.5: payer credentials ------------------------------------------------------------------
 * Provider-agnostic and never plaintext. A payer's auth block names a credentialRef of the form
 * "sealed:<ciphertext>", sealed with the deployment's EXISTING Connect envelope key (the same one every
 * connector credential already uses; no new secret or binding). Opened only at send time, only for that
 * payer. No reference, a malformed one, or an unavailable key: no credential, and the adapter records
 * "not_configured: credentials missing" rather than sending unauthenticated. */
function sealedCredentialAuthorizer(env, payers, secretsImpl) {
  return async (request) => {
    const payer = payerById(payers, request && request.payerId);
    const auth = payer && payer.auth && typeof payer.auth === "object" ? payer.auth : null;
    const ref = str(auth && auth.credentialRef);
    let token;
    /* Owner S4: a payer saved as a connector carries its credential sealed under the document key
     * (connectors.js); a wardsynq.payers entry keeps the Connect envelope reference. */
    if (auth && auth.connectorSecret) token = str(await openSecret(env, auth.connectorSecret));
    else if (!ref.startsWith("sealed:")) return null;
    else { try { token = str(await (secretsImpl || makeSecrets(env)).open(ref.slice(7))); } catch { return null; } }
    if (!token) return null;
    if (auth.type === "header" && str(auth.headerName)) return { [str(auth.headerName)]: token };
    return { authorization: `Bearer ${token}` };
  };
}

/* NHCX needs more than a header: several sealed values and the correlation record written before sending
 * (nhcx.js). actorId is who asked, for that record's audit. */
const ADAPTER_KINDS = Object.freeze({ "fhir-claim": FhirClaimAdapter, nhcx: (payer, deps) => NhcxAdapter(payer, deps.nhcx || {}) });

/** The adapter for a payer id, with a hardened transport. ctx.tpaAdapter (a site's own) wins when given. */
function resolveAdapter(env, ctx, payerId, actorId) {
  if (ctx.tpaAdapter) return ctx.tpaAdapter;
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : (typeof fetch === "function" ? fetch : null);
  return adapterForPayer(ctx.payers, payerId, ADAPTER_KINDS, {
    fetch: fetchImpl ? makeSafeFetch(fetchImpl) : null,
    authorize: sealedCredentialAuthorizer(env, ctx.payers, ctx.secretsImpl),
    nhcx: ctx.recordDeps && ctx.migration ? nhcxAdapterDeps(env, ctx, actorId) : {},
  }).adapter;
}

/** Payer figures from an acknowledged response land on the claim as the payer's, with history. */
function applyAcknowledged(record, adapterResult, now) {
  if (!adapterResult || adapterResult.state !== "acknowledged") return;
  if (adapterResult.payerReference) { record.payerReference = adapterResult.payerReference; record.acknowledgedAt = now; }
  const adj = adapterResult.adjudication;
  if (adj && adj.approved != null && record.history) {
    record.approvedAmount = adj.approved;
    record.history.push({ at: now, event: "adjudicated", by: "payer-response", detail: `approved ${adj.approved} (from the payer's ClaimResponse)` });
  }
}

/* Never evidence for a charge. A differential is the list of things it might be, and a refuted
 * condition is the thing it turned out not to be. */
const NOT_EVIDENCE = Object.freeze(["refuted", "differential"]);

/**
 * PURE. The read-only view of the chart the module is allowed to see.
 *
 * `observations` and `medications` are deliberately absent rather than empty-by-accident: see the
 * header. `severityEvidence` is empty because this record has no severity to give.
 */
function clinicalView(conditions) {
  const usable = (conditions || []).filter((c) => c && !NOT_EVIDENCE.includes(str(c.verificationStatus)));
  return {
    conditions: usable.map((c) => ({ code: c.code })),
    severityEvidence: {},
  };
}

/** PURE. What the problem list actually says about a code, so a verdict is never falsely confident. */
function conditionDetail(code, conditions) {
  const target = str(code).toUpperCase();
  const hit = (conditions || []).find((c) => c && str(c.code).toUpperCase() === target);
  if (!hit) return null;
  return {
    verificationStatus: hit.verificationStatus || null,
    clinicalStatus: hit.clinicalStatus || null,
    ...(NOT_EVIDENCE.includes(str(hit.verificationStatus))
      ? { withheld: `This code is on the problem list as "${hit.verificationStatus}", which is not a diagnosis and is not evidence for a charge.` }
      : {}),
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

function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/** The record service stamps its own `meta` and `version`; neither belongs back in the module. */
function stored(record) {
  if (!record) return null;
  const { meta, version, ...rest } = record;
  return { claim: rest, version };
}

/**
 * Codes a claim against the problem list. Unsupported codes are REFUSED, not queried.
 * ctx: { migration, encounterId, patientId, codes, now?, idempotencyKey? }
 */
async function codeClaimForEncounter(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", claim: null };

  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  if (!patientId || !encounterId) return { ...base, ok: false, status: 422, error: "encounter_and_patient_required", claim: null };
  const codes = Array.isArray(ctx.codes) ? ctx.codes.filter((c) => c && (typeof c === "string" ? str(c) : str(c.code))) : [];
  if (!codes.length) return { ...base, ok: false, status: 422, error: "codes_required", claim: null };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, claim: null };

  let conditions;
  try { conditions = await svc.byPatient("Condition", patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), claim: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), claim: null };
  }

  const view = clinicalView(conditions);
  const now = str(ctx.now) || new Date().toISOString();

  let claim;
  try {
    claim = codeClaim({ encounterId, patientId, record: view, codes, codedBy: resolved.actor.id, now, invoiceId: str(ctx.invoiceId) || null });
    // P1.5: which payer, as a reference only. Everything payer-specific stays in wardsynq.payers.
    claim.payerId = str(ctx.payerId) || null;
    if (str(ctx.policyNumber)) claim.policyNumber = str(ctx.policyNumber);
  } catch (e) {
    if (!(e instanceof BillingError)) throw e;
    /* The refusal names every code and what the record says about each, so the coder can see which
     * ones are genuinely missing. `supportFor` is the module's own answer, not a second copy of it. */
    const perCode = codes.map((c) => {
      const code = typeof c === "string" ? c : c.code;
      return { ...supportFor(code, view), condition: conditionDetail(code, conditions) };
    });
    return {
      ...base, ok: false, status: 422, error: "claim_refused", code: e.code, detail: e.message,
      codes: perCode, claim: null,
      note: "A charge cannot create its own justification. If a refused diagnosis is true, a clinician documents it through the clinical path, on clinical grounds, and the claim is coded afterwards. Billing has no write path to the chart and this response is not a request for one.",
    };
  }

  /* Run at coding time, where an over-severe code is still a question. Every finding here today is
   * "the record carries no severity evidence", because it carries none for anything - see header. */
  const upcoding = detectUpcoding(claim, view);

  const record = {
    ...claim, resourceType: CLAIM_TYPE,
    upcoding,
    codes: claim.codes.map((a) => ({ ...a, condition: conditionDetail(a.code, conditions) })),
    source: { system: "wardsynq-native", sourceId: `claim:${claim.id}` },
  };

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, claimId: claim.id, state: claim.state, recordVersion: out.record.version,
      claim: record, upcoding,
      ...(upcoding.clean ? {} : {
        upcodingWarning: "This claim carries codes whose severity the record does not support. Submitting it needs an explicit reason, which is recorded on the claim.",
      }),
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { claimId: claim.id, claim: null, actor: resolved.actor.id }) };
  }
}

/* rcm-claims-ops (claims-ops.js): a payer query arriving, documents obtained for the claim, and the hospital's own reason
 * code and root cause on a denial. Each is recorded by a person and sends nothing. */
const ACTIONS = Object.freeze(["submit", "deny", "resubmit", "adjudicate", "acknowledge", "settle", "balance-to-patient", "query", "documents", "classify-denial"]);

/**
 * Moves a claim through its lifecycle.
 * ctx: { migration, claimId, action, reason?, codes?, now?, overrideReason?, text?, receivedAt?, documents?, denialCode?, rootCause?, rcm?, payers? }
 */
async function claimAction(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", claim: null };

  const claimId = str(ctx.claimId), action = str(ctx.action);
  if (!claimId) return { ...base, ok: false, status: 422, error: "claim_required", claim: null };
  if (!ACTIONS.includes(action)) return { ...base, ok: false, status: 400, error: "unknown_action", detail: `action must be one of ${ACTIONS.join(", ")}`, claim: null };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, claim: null };

  let current;
  try { current = await svc.get(CLAIM_TYPE, claimId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), claim: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), claim: null };
  }
  if (!current) return { ...base, ok: false, status: 404, error: "claim_not_found", claim: null };

  const { claim, version } = stored(current);
  const now = str(ctx.now) || new Date().toISOString();
  const by = resolved.actor.id;
  const reason = str(ctx.reason);

  /* A claim whose severity the record does not support is not blocked, because the flag may be a
   * question rather than a finding. It cannot be submitted SILENTLY: the reason is required and is
   * written into the claim's own history, where an auditor reads it beside the flag. */
  if ((action === "submit" || action === "resubmit") && claim.upcoding && !claim.upcoding.clean && !reason) {
    return {
      ...base, ok: false, status: 422, error: "upcoding_reason_required",
      findings: claim.upcoding.findings, claim: null,
      detail: "This claim carries codes whose severity the record does not support. Submitting it requires a reason, which is recorded permanently on the claim.",
    };
  }

  /* THE CHECKLIST BEFORE A CLAIM LEAVES (claims-ops.js scrubClaim). A blocking finding refuses the submission and names
   * itself; a person may still send it with a reason, kept on the claim with who, when and what was overridden. The
   * facts are read through this actor's own grants, and a fact the grant cannot read is said as unchecked. */
  let scrub = null;
  const overrideReason = str(ctx.overrideReason).slice(0, 1000);
  if (action === "submit" || action === "resubmit") {
    const payerId = str(ctx.payerId) || claim.payerId;
    scrub = scrubClaim({ ...claim, payerId }, await claimFacts(svc, claim), { payer: payerById(ctx.payers, payerId), submittedAmount: ctx.submittedAmount, now });
    if (!scrub.clean && !overrideReason) {
      return {
        ...base, ok: false, status: 422, error: "claim_checklist_blocked", findings: scrub.blocking, warnings: scrub.warnings, claim: null,
        detail: `Not sent: ${scrub.blocking.map((f) => f.text).join(" ")} Fix these, or send it anyway with a reason, which is recorded permanently on the claim.`,
      };
    }
  }

  let next;
  try {
    if (action === "submit") next = submit(claim, { by, now, submittedAmount: ctx.submittedAmount });
    else if (action === "deny") {
      if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "a denial carries the payer's reason", claim: null };
      next = deny(claim, { reason, by, now, deniedAmount: ctx.deniedAmount });
      if (str(ctx.denialCode)) classifyDenial(next, { denialCode: ctx.denialCode, rootCause: ctx.rootCause, rcm: ctx.rcm, by, now });
    } else if (action === "resubmit") {
      if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "a resubmission names why", claim: null };
      /* Re-coding on resubmission is re-checked against the CHART AS IT IS NOW, not against the view
       * taken when the claim was first coded. If a diagnosis appeared between the denial and this
       * moment, the module compares fingerprints and flags it - which is the entire point of the
       * check, and reusing the stale view would have hidden exactly the case it exists to catch. */
      let view = null;
      if (ctx.codes) {
        let conditions;
        try { conditions = await svc.byPatient("Condition", claim.patientId); }
        catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), claim: null }; }
        view = clinicalView(conditions);
      }
      next = resubmit(claim, { codes: ctx.codes || null, record: view, by, reason, now, submittedAmount: ctx.submittedAmount });
      // A resubmission after a payer query is the answer to it: the open queries close with its reason and their clocks stop.
      if ((next.payerQueries || []).some((q) => !q.answeredAt)) answerOpenQueries(next, { answer: reason, by, now });
    } else if (action === "acknowledge") {
      next = recordAcknowledgement(claim, { payerReference: str(ctx.payerReference), by, now, note: reason || null });
    } else if (action === "settle") {
      next = settle(claim, { paidAmount: ctx.paidAmount, disallowances: ctx.disallowances, shortPaymentReason: str(ctx.shortPaymentReason) || null, by, now, payerReference: str(ctx.payerReference) || null });
    } else if (action === "balance-to-patient") {
      next = moveBalanceToPatient(claim, { amount: ctx.amount, reason, by, now });
    } else if (action === "query") {
      if (![CLAIM_STATE.SUBMITTED, CLAIM_STATE.QUERIED].includes(claim.state)) throw new BillingError("a payer query is recorded on a submitted claim", "NOT_SUBMITTED");
      recordPayerQuery(claim, { text: ctx.text, receivedAt: ctx.receivedAt, responseDays: checklistOf(payerById(ctx.payers, claim.payerId)).queryResponseDays, by, now });
      claim.state = CLAIM_STATE.QUERIED;
      next = claim;
    } else if (action === "documents") {
      if (!markDocuments(claim, { documents: ctx.documents, by, now })) return { ...base, ok: true, claimId, action, unchanged: true, state: claim.state, claim, actor: by };
      next = claim;
    } else if (action === "classify-denial") {
      classifyDenial(claim, { denialCode: ctx.denialCode, rootCause: ctx.rootCause, rcm: ctx.rcm, by, now });
      next = claim;
    } else {
      // adjudicate: records what the payer said it will pay. Never moves claim.state - that stays
      // submit/deny/resubmit's job alone.
      next = recordAdjudication(claim, { approvedAmount: ctx.approvedAmount, deniedAmount: ctx.deniedAmount, by, now, reason });
    }
    /* Only when there was actually something to explain. A reason recorded against a clean claim
     * would put the words "unsupported severity" into the history of a claim that had none. */
    if (reason && action === "submit" && claim.upcoding && !claim.upcoding.clean) {
      next.history.push({ at: now, event: "submitted-with-unsupported-severity", by, detail: reason });
    }
    if (scrub) {
      next.checklist = { at: now, blocking: scrub.blocking, warnings: scrub.warnings };
      if (!scrub.clean) {
        next.checklistOverrides = (claim.checklistOverrides || []).concat([{ at: now, by, reason: overrideReason, action, findings: scrub.blocking.map((f) => ({ code: f.code, text: f.text })) }]);
        next.history.push({ at: now, event: "sent-over-checklist-findings", by, detail: `${overrideReason} (${scrub.blocking.map((f) => f.code).join(", ")})` });
      }
    }
  } catch (e) {
    if (e instanceof BillingError) return { ...base, ok: false, status: 422, error: "billing_refused", code: e.code, detail: e.message, claim: null };
    throw e;
  }

  /* THE ADAPTER BOUNDARY (master plan section 2.3). submit/resubmit are the only actions that mean
   * "send this to the payer" - deny/adjudicate record a fact ARRIVING, not one going out. No real
   * adapter is configured anywhere in this codebase (ctx.tpaAdapter, if a site ever wires one in),
   * so this defaults to NullAdapter() and the claim is honestly recorded as queued for the
   * hospital's own existing out-of-band process - never claimed as sent to a payer that was never
   * actually contacted. */
  if (action === "submit" || action === "resubmit") {
    if (str(ctx.payerId)) next.payerId = str(ctx.payerId);
    next.adapter = await submitViaAdapter(next, resolveAdapter(env, ctx, next.payerId, by), { use: "claim", now, payerId: next.payerId || null });
    applyAcknowledged(next, next.adapter, now);
    next.history.push({ at: now, event: "payer-channel", by, detail: `${next.adapter.adapterId}: ${next.adapter.state}` });
  }

  try {
    // The version the transition was computed from. Two coders acting on one claim at once is
    // exactly how a claim history stops being a history.
    const out = await svc.put({ ...next, resourceType: CLAIM_TYPE }, { expectedVersion: version });
    return {
      ...base, ok: true, claimId, action, state: next.state, recordVersion: out.record.version,
      claim: next, actor: by,
      ...(next.clinicalContentChangedAfterDenial ? {
        upcodingFlag: next.upcodingFlag,
        flagged: "The clinical coding changed between the denial and this resubmission. This is not blocked, because a genuine correction happens too, and it is recorded permanently.",
      } : {}),
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { claimId, claim: null, actor: by }) };
  }
}

/**
 * A funding decision, recorded as one.
 * ctx: { migration, patientId, treatment, state, scheme?, reason?, decidedAt? }
 */
async function recordPreAuth(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", preAuth: null };

  const patientId = str(ctx.patientId), treatment = str(ctx.treatment), state = str(ctx.state);
  if (!patientId || !treatment) return { ...base, ok: false, status: 422, error: "patient_and_treatment_required", preAuth: null };
  if (!Object.values(PREAUTH_STATE).includes(state)) {
    return { ...base, ok: false, status: 400, error: "unknown_state", detail: `state must be one of ${Object.values(PREAUTH_STATE).join(", ")}`, preAuth: null };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, preAuth: null };

  const decidedAt = str(ctx.decidedAt) || new Date().toISOString();
  let auth;
  try {
    auth = preAuthorisation({
      patientId, treatment, state, decidedAt,
      scheme: str(ctx.scheme) || null, reason: str(ctx.reason) || null, requestedBy: resolved.actor.id,
      invoiceId: str(ctx.invoiceId) || null, authorizedAmount: ctx.authorizedAmount,
    });
    auth.payerId = str(ctx.payerId) || null;
    if (Number.isFinite(Number(ctx.requestedAmount)) && ctx.requestedAmount !== "" && ctx.requestedAmount != null) auth.requestedAmount = Number(ctx.requestedAmount);
    if (str(ctx.policyNumber)) auth.policyNumber = str(ctx.policyNumber);
    /* rcm-claims-ops: the last day the payer's approval letter says it is valid, as the payer wrote it. The claims
     * checklist (claims-ops.js) blocks a claim whose only approval ran out before the admission. */
    if (str(ctx.validUntil)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(ctx.validUntil)) || !Number.isFinite(Date.parse(str(ctx.validUntil)))) throw new BillingError("the validity date is a date (YYYY-MM-DD)", "BAD_VALID_UNTIL");
      if (state !== PREAUTH_STATE.APPROVED) throw new BillingError("a validity date belongs to an approved pre-authorisation", "VALID_UNTIL_NOT_APPROVED");
      auth.validUntil = str(ctx.validUntil);
    }
  } catch (e) {
    if (e instanceof BillingError) return { ...base, ok: false, status: 422, error: "preauth_refused", code: e.code, detail: e.message, preAuth: null };
    throw e;
  }
  /* The diagnoses a payer's pre-authorisation form asks for (NHCX Claim.diagnosis is 1..*). They face the same
   * rule as a claim: a code the problem list does not support is refused, never carried to a payer. */
  const dxCodes = (Array.isArray(ctx.codes) ? ctx.codes : []).map((c) => str(typeof c === "string" ? c : c && c.code)).filter(Boolean);
  if (dxCodes.length) {
    let conditions;
    try { conditions = await svc.byPatient("Condition", patientId); }
    catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", preAuth: null }; }
    const view = clinicalView(conditions);
    const unsupported = dxCodes.map((code) => ({ code, ...supportFor(code, view), condition: conditionDetail(code, conditions) })).filter((x) => x.support !== SUPPORT.DOCUMENTED);
    if (unsupported.length) {
      return { ...base, ok: false, status: 422, error: "preauth_refused", code: "UNSUPPORTED_DIAGNOSIS", codes: unsupported, preAuth: null,
        detail: `Not on the problem list, so not sent to a payer: ${unsupported.map((x) => x.code).join(", ")}. A clinician documents a diagnosis through the clinical path first.` };
    }
    auth.codes = dxCodes.map((code) => ({ code }));
  }

  const id = `wsq-preauth-${slug(patientId)}-${slug(treatment)}-${slug(decidedAt)}`;
  const record = { ...auth, resourceType: PREAUTH_TYPE, id, source: { system: "wardsynq-native", sourceId: `preauth:${id}` } };
  /* P1.5: a REQUESTED pre-authorisation with a payer goes through that payer's adapter as a FHIR Claim
   * with use=preauthorization. A decision (approved/refused/expired) is a fact arriving and sends nothing. */
  if (state === PREAUTH_STATE.REQUESTED && auth.payerId) {
    record.adapter = await submitViaAdapter(record, resolveAdapter(env, ctx, auth.payerId, resolved.actor.id), { use: "preauthorization", now: decidedAt, payerId: auth.payerId });
    if (record.adapter.state === "acknowledged" && record.adapter.payerReference) record.payerReference = record.adapter.payerReference;
  }

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, preAuthId: id, state, recordVersion: out.record.version, preAuth: record,
      /* Said on every refusal, from the one function that answers it, so no caller writes its own
       * `if (refused) return` into a treatment path. */
      clinical: mayProceedClinically(),
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { preAuthId: id, preAuth: null, actor: resolved.actor.id }) };
  }
}

/** ctx: { migration, patientId, payers, gst } - a patient's claims, and the answer about gating care. Each claim and
 *  pre-authorisation, and each stay's payer, carries its parties (payer-contracts.js): patient, payer, insurer, TPA and the
 *  GST recipient, resolved from the payer's contract as it stands now. */
async function claimsForPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", claims: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", claims: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, claims: [] };

  let rows, auths, estimates, eligibility, stayPayers;
  let estimatesUnreadable = false, eligibilityUnreadable = false, stayPayersUnreadable = false;
  try {
    [rows, auths, estimates, eligibility, stayPayers] = await Promise.all([
      svc.byPatient(CLAIM_TYPE, patientId),
      svc.byPatient(PREAUTH_TYPE, patientId).catch(() => []),
      svc.byPatient(ESTIMATE_TYPE, patientId).catch(() => { estimatesUnreadable = true; return []; }),
      // NHCX eligibility checks (nhcx.js). Unreadable is said, never shown as none.
      svc.byPatient(ELIGIBILITY_TYPE, patientId).catch(() => { eligibilityUnreadable = true; return []; }),
      // gst-parties: who settles each stay. Unreadable is said (null), never shown as self-pay.
      svc.byPatient(STAY_PAYER_TYPE, patientId).catch(() => { stayPayersUnreadable = true; return []; }),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), claims: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), claims: [] };
  }

  const partiesOf = (payerId) => partiesRecord(resolveParties({ payerRef: payerId, payers: ctx.payers, gst: ctx.gst || null }), null);
  const claims = (rows || []).filter(Boolean).map((c) => ({ ...c, parties: partiesOf(c.payerId) }));
  const preAuthorisations = (auths || []).filter(Boolean).map((a) => ({ ...a, parties: partiesOf(a.payerId) }));
  const now = str(ctx.now) || new Date().toISOString();
  return {
    ...base, ok: true, patientId,
    claims,
    preAuthorisations,
    estimates: (estimates || []).filter(Boolean),
    ...(estimatesUnreadable ? { estimatesUnreadable: true } : {}),
    eligibilityChecks: eligibilityUnreadable ? null : (eligibility || []).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    stayPayers: stayPayersUnreadable ? null : (stayPayers || []).filter(Boolean).map((r) => stayPayerWithParties(r, ctx)),
    // P1.5: the payer list as a screen may see it, and each claim's payer rules as warnings only.
    payers: publicPayers(ctx.payers),
    payerWarnings: Object.fromEntries(claims.map((c) => [c.id, payerRuleWarnings(c, payerById(ctx.payers, c.payerId), { preAuths: preAuthorisations, now })])),
    /* On the list, not only on a refusal. This is the screen where somebody looking at an unpaid
     * account is most tempted to decide it means something clinically. */
    clinical: mayProceedClinically(),
  };
}

/**
 * P1.5: a pre-admission cost estimate from tariff lines. ctx: { migration, patientId, lines:[{code, quantity}], payerId?, tariff }
 * No tariff means no estimate: a number invented without one would be read as a quote.
 */
async function raiseEstimate(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", estimate: null };
  const patientId = str(ctx.patientId);
  const lines = (Array.isArray(ctx.lines) ? ctx.lines : []).filter((l) => l && str(l.code)).map((l) => ({ code: str(l.code), quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1 }));
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", estimate: null };
  if (!lines.length) return { ...base, ok: false, status: 422, error: "lines_required", detail: "an estimate is built from tariff lines", estimate: null };
  if (!ctx.tariff || typeof ctx.tariff !== "object" || !Object.keys(ctx.tariff).length) {
    return { ...base, ok: false, status: 422, error: "tariff_not_configured", detail: "This hospital has no tariff configured (wardsynq.tariff), so no estimate can be priced.", estimate: null };
  }
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, estimate: null };
  const now = str(ctx.now) || new Date().toISOString();
  let est;
  try { est = costEstimate({ patientId, payerId: str(ctx.payerId) || null, lines, priced: priceWith(lines, ctx.tariff), by: resolved.actor.id, now }); }
  catch (e) { if (e instanceof BillingError) return { ...base, ok: false, status: 422, error: "estimate_refused", code: e.code, detail: e.message, estimate: null }; throw e; }
  const id = `wsq-estimate-${slug(patientId)}-${slug(now)}`;
  const record = { ...est, resourceType: ESTIMATE_TYPE, id, source: { system: "wardsynq-native", sourceId: `estimate:${id}` } };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, estimateId: id, recordVersion: out.record.version, estimate: record, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { estimateId: id, estimate: null, actor: resolved.actor.id }) };
  }
}

/** ctx: { migration, patientId? } - claims whose coding changed after a denial. */
async function watchlist(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", count: 0, claims: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) {
    /* No tenant-wide sweep. The repository is queried by patient, and a route that walked every
     * claim in the hospital to build a list would be a different thing from a safety check. */
    return { ...base, ok: false, status: 422, error: "patient_required", count: 0, claims: [],
      detail: "The watchlist is read per patient. A hospital-wide sweep is a compliance report and needs its own owner and its own retention decision." };
  }

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, count: 0, claims: [] };

  let rows;
  try { rows = await svc.byPatient(CLAIM_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), count: 0, claims: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), count: 0, claims: [] };
  }

  return { ...base, ok: true, patientId, ...upcodingWatchlist((rows || []).filter(Boolean)) };
}

export {
  CLAIM_TYPE, PREAUTH_TYPE, ESTIMATE_TYPE, CLAIM_STATE, PREAUTH_STATE, SUPPORT,
  clinicalView, conditionDetail, sealedCredentialAuthorizer,
  codeClaimForEncounter, claimAction, recordPreAuth, claimsForPatient, watchlist, raiseEstimate,
};
