/* functions/_wardsynq/consent.js — what the patient agreed to, and what they refused.
 *
 * WardSynQ could record everything a hospital does TO a patient and nothing about what the patient
 * AGREED to. Break-glass answered "who looked at this chart in an emergency"; consent answers the
 * prior question - whether this patient permitted it at all, and for what.
 *
 * A REFUSAL IS A CLINICAL FACT, NOT AN ABSENT CONSENT. This is the rule the whole file turns on.
 * "No consent recorded" and "the patient said no" are completely different states and a system that
 * stores only the yeses cannot tell them apart. A patient who has declined to share their record
 * with a research registry, or refused a blood transfusion, has made a decision that has to survive
 * being asked again by the next person - so a refusal is stored with the same weight as a grant and
 * is reported as loudly.
 *
 * CONSENT EXPIRES; IT DOES NOT LAPSE INTO YES. Where a consent has an end date it stops applying at
 * that date, and the answer becomes "not recorded" rather than "still granted". The one direction
 * this file never drifts is towards permission.
 *
 * IT IS WITHDRAWABLE, ALWAYS, AND WITHDRAWAL IS IMMEDIATE. A consent that could not be withdrawn
 * would not be consent. Withdrawing is a new version; the original grant stays on the record,
 * because "they consented and later withdrew" and "they never consented" are different histories
 * and only one of them is true.
 *
 * IT DOES NOT ENFORCE. Nothing here blocks a clinical action, and that is deliberate rather than
 * unfinished. Consent governs a great many different things - sharing, research, photography,
 * specific procedures - and each has its own rules about capacity, emergency exceptions and
 * next-of-kin. A generic gate that refused writes on the strength of a missing tick-box would be
 * wrong in an emergency and wrong for an unconscious patient, which are exactly the moments it
 * would fire. It RECORDS, and it makes the answer available to the paths that should ask.
 *
 * CAPACITY AND WHO GAVE IT ARE RECORDED, NEVER INFERRED. Consent given by someone other than the
 * patient is a different fact from consent given by the patient, and a system that flattens the two
 * loses the only thing that makes the record defensible afterwards.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "PatientConsent";

/** The three states. `refused` is a decision, not the absence of one. */
const DECISIONS = Object.freeze(["granted", "refused", "withdrawn"]);

/* What consent is being recorded FOR. A closed list, because a free-text scope cannot be queried and
 * "did this patient consent to research use" would then depend on how somebody typed it. `other`
 * exists with a required note so nothing is unrecordable. */
const SCOPES = Object.freeze({
  "treatment": "General treatment",
  "share-external": "Sharing the record outside this hospital",
  "share-registry": "Sharing with a registry or exchange",
  "research": "Use of the record for research",
  "photography": "Clinical photography",
  "blood-products": "Transfusion of blood products",
  "procedure": "A specific procedure",
  "other": "Other",
});

/** Who made the decision. Not the same fact, and never inferred from context. */
const GIVERS = Object.freeze(["patient", "parent", "legal-guardian", "next-of-kin", "power-of-attorney", "clinician-emergency"]);

function PatientConsent(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    scope: SCOPES[str(i.scope)] ? str(i.scope) : "other",
    decision: DECISIONS.includes(i.decision) ? i.decision : "refused",
    /* Free text describing exactly what was agreed, for the scopes where "consented to a procedure"
     * is not enough on its own. Recorded as written. */
    detail: i.detail || null,
    givenBy: GIVERS.includes(i.givenBy) ? i.givenBy : "patient",
    giverName: i.giverName || null,
    /* Recorded, never inferred. "The patient has capacity" is a clinical judgement somebody made,
     * and a system that assumed it because a patient signed something would be asserting a finding
     * nobody recorded. */
    capacity: i.capacity === true ? true : i.capacity === false ? false : null,
    recordedBy: i.recordedBy || null,
    recordedAt: i.recordedAt || null,
    validFrom: i.validFrom || null,
    validUntil: i.validUntil || null,
    withdrawnBy: i.withdrawnBy || null,
    withdrawnAt: i.withdrawnAt || null,
    withdrawalReason: i.withdrawalReason || null,
    source: { system: "wardsynq-native", sourceId: `consent:${i.id}` },
  };
}

/** PURE. One consent per (patient, scope, detail). Re-asking about the same thing updates it. */
function consentIdFor(patientId, scope, detail) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const p = slug(patientId), s = slug(scope);
  if (!p || !s) return null;
  const d = slug(detail);
  // A "procedure" consent is per procedure; a general one is per scope. Without this a second
  // operation would silently overwrite the consent for the first.
  return d ? `wsq-consent-${p}-${s}-${d}` : `wsq-consent-${p}-${s}`;
}

/**
 * PURE. Does this consent apply right now?
 *
 * Returns "granted" | "refused" | "withdrawn" | "expired" | "not-yet-valid". Never a boolean: a
 * caller that gets `false` cannot tell a refusal from an expiry from a record nobody ever made, and
 * those need different things to happen next.
 */
function statusOf(consent, nowMs) {
  if (!consent) return "not-recorded";
  if (consent.decision === "withdrawn" || consent.withdrawnAt) return "withdrawn";
  if (consent.decision === "refused") return "refused";
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const from = Date.parse(consent.validFrom || "");
  const until = Date.parse(consent.validUntil || "");
  if (Number.isFinite(from) && now < from) return "not-yet-valid";
  /* EXPIRED, NOT GRANTED. The one direction this never drifts is towards permission: a consent that
   * quietly stayed valid past its end date would be the system granting something nobody agreed to. */
  if (Number.isFinite(until) && now >= until) return "expired";
  return "granted";
}

/** PURE. The answer to "may we", with the reason it is what it is. Never a bare boolean. */
function permits(consents, scope, nowMs) {
  const want = str(scope);
  const rows = (consents || []).filter((c) => c && c.scope === want);
  if (!rows.length) return { scope: want, status: "not-recorded", permitted: false, consent: null };
  // The most recently recorded decision about this scope is the one that stands.
  const latest = rows.slice().sort((a, b) => String(b.recordedAt || "").localeCompare(String(a.recordedAt || "")))[0];
  const status = statusOf(latest, nowMs);
  return {
    scope: want, status, permitted: status === "granted",
    consent: {
      consentId: latest.id, decision: latest.decision, detail: latest.detail || null,
      givenBy: latest.givenBy, giverName: latest.giverName || null, capacity: latest.capacity,
      recordedBy: latest.recordedBy, recordedAt: latest.recordedAt,
      validFrom: latest.validFrom || null, validUntil: latest.validUntil || null,
      withdrawnAt: latest.withdrawnAt || null, withdrawalReason: latest.withdrawalReason || null,
    },
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

/**
 * Records a decision. ctx: { migration, patientId, scope, decision, detail?, givenBy?, giverName?,
 *   capacity?, validFrom?, validUntil?, encounterId?, actorDeps, recordDeps }
 */
async function recordConsent(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  const scope = str(ctx.scope);
  const decision = str(ctx.decision).toLowerCase();
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!SCOPES[scope]) return { ...base, ok: false, status: 400, error: "unknown_scope", detail: `scope must be one of ${Object.keys(SCOPES).join(", ")}`, written: 0 };
  // Only granted or refused are recorded here. Withdrawal has its own path, because withdrawing
  // something that was never granted is a different mistake and should not look like a decision.
  if (decision !== "granted" && decision !== "refused") {
    return { ...base, ok: false, status: 400, error: "unknown_decision", detail: "decision must be granted or refused; withdraw an existing consent instead", written: 0 };
  }
  const detail = str(ctx.detail);
  // "Other" and "a specific procedure" are meaningless without saying which.
  if ((scope === "other" || scope === "procedure") && !detail) {
    return { ...base, ok: false, status: 422, error: "detail_required", detail: `scope "${scope}" needs to say what it is about`, written: 0 };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = consentIdFor(patientId, scope, detail);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  const now = new Date().toISOString();
  const rec = PatientConsent({
    id, patientId, encounterId: str(ctx.encounterId) || null,
    scope, decision, detail: detail || null,
    givenBy: str(ctx.givenBy) || "patient", giverName: str(ctx.giverName) || null,
    capacity: ctx.capacity,
    recordedBy: resolved.actor.id, recordedAt: now,
    validFrom: str(ctx.validFrom) || now, validUntil: str(ctx.validUntil) || null,
  });
  try {
    const out = await svc.put(rec, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, consentId: id, patientId, scope, decision,
      status: statusOf(rec), givenBy: rec.givenBy, capacity: rec.capacity,
      validUntil: rec.validUntil, version: out.record.version, actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { consentId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** Withdraws one. ctx: { migration, patientId, scope, detail?, reason, actorDeps, recordDeps } */
async function withdrawConsent(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const id = consentIdFor(str(ctx.patientId), str(ctx.scope), str(ctx.detail));
  if (!id) return { ...base, ok: false, status: 422, error: "patient_and_scope_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  // Withdrawing something never granted is a different mistake, and saying so is more useful than
  // writing a withdrawal of nothing.
  if (!current) return { ...base, ok: false, status: 404, error: "no_consent_recorded", consentId: id, written: 0 };
  if (current.decision === "withdrawn") return { ...base, ok: true, written: 0, skipped: "already_withdrawn", consentId: id, status: "withdrawn" };

  const now = new Date().toISOString();
  const next = PatientConsent({
    ...current, decision: "withdrawn",
    withdrawnBy: resolved.actor.id, withdrawnAt: now, withdrawalReason: str(ctx.reason) || null,
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    /* The original grant stays on the record as a version. "They consented and later withdrew" and
     * "they never consented" are different histories, and only one of them is true. */
    return { ...base, ok: true, written: 1, consentId: id, status: "withdrawn", withdrawnAt: now, previousDecision: current.decision, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { consentId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * What this patient has agreed to and refused.
 * ctx: { migration, patientId, scope?, actorDeps, recordDeps }
 */
async function consentStatus(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", consents: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", consents: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, consents: [] };

  let rows;
  try { rows = await svc.byPatient(TYPE, patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), consents: [] }; }

  const nowMs = Date.now();
  if (str(ctx.scope)) return { ...base, ok: true, patientId, ...permits(rows, str(ctx.scope), nowMs) };

  const consents = (rows || []).filter(Boolean).map((c) => ({
    consentId: c.id, scope: c.scope, scopeLabel: SCOPES[c.scope] || c.scope,
    decision: c.decision, status: statusOf(c, nowMs), detail: c.detail || null,
    givenBy: c.givenBy, giverName: c.giverName || null, capacity: c.capacity,
    recordedBy: c.recordedBy, recordedAt: c.recordedAt,
    validUntil: c.validUntil || null, withdrawnAt: c.withdrawnAt || null,
    version: c.version,
  }));
  const RANK = { refused: 0, withdrawn: 1, expired: 2, "not-yet-valid": 3, granted: 4 };
  consents.sort((a, b) => (RANK[a.status] - RANK[b.status]) || String(a.scope).localeCompare(String(b.scope)));
  return {
    ...base, ok: true, patientId, consents,
    /* Counted separately and named, because a refusal is a clinical fact and burying it among the
     * grants is how somebody asks a patient to agree to something they have already declined. */
    refused: consents.filter((c) => c.status === "refused").length,
    withdrawn: consents.filter((c) => c.status === "withdrawn").length,
  };
}

export {
  TYPE, DECISIONS, SCOPES, GIVERS, PatientConsent,
  consentIdFor, statusOf, permits,
  recordConsent, withdrawConsent, consentStatus,
};
