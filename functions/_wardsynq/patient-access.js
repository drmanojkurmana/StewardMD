/* functions/_wardsynq/patient-access.js - letting a patient read their own record, safely.
 *
 * #940 built the patient's copy and stopped at the honest boundary: there is no patient identity in
 * this build, so it made a clinician-mediated handout and recorded patient authentication as the
 * owner's decision. This is that decision implemented, and it is the most security-sensitive file in
 * WardSynQ, because it is the only one that lets somebody who is not staff read a chart.
 *
 * IT IS OFF UNLESS A HOSPITAL TURNS IT ON. `wardsynq.patientAccess.enabled` defaults to false and
 * every route here refuses while it is. A clinical system does not acquire a new authentication
 * surface because a dependency shipped; a named person at the hospital turns it on.
 *
 * ENROLMENT IS IN PERSON, BY A CLINICIAN. There is NO self-registration and there must never be one:
 * self-service enrolment against a name and a date of birth is how somebody else's chart gets opened,
 * and every detail it asks for is on the discharge letter the patient was given. A clinician with
 * EMR_TREAT enrols a patient they are looking at, and the contact is one they took from that person.
 *
 * THE CODE IS SHOWN TO THE CLINICIAN, NOT SENT. This file has no transport and deliberately does not
 * borrow the prescription one: sending an access code to a number nobody verified is the failure
 * mode, not the feature. The clinician reads it to the patient in front of them. A hospital that
 * wants SMS delivery is choosing to trust the number in the record, and that is a decision with an
 * owner - it is recorded in the vault, not assumed here.
 *
 * THE CODE IS HASHED AT REST AND IS NEVER RETURNED AGAIN. It exists in the response to the enrolling
 * clinician exactly once. A code readable from the record afterwards would let anyone with record
 * access become the patient, silently, and the audit would show the patient reading their own chart.
 *
 * ATTEMPTS ARE CAPPED. A six-digit code that can be tried a million times is not a code. The grant
 * counts failures and burns itself after MAX_ATTEMPTS, because rate limiting that lives only in a
 * gateway is rate limiting the next deployment forgets.
 *
 * THE TOKEN IS READ-ONLY, SINGLE-PATIENT AND SHORT-LIVED. It authorises exactly one thing - the
 * patient's own copy from #940 - and it carries no clinical capability at all. It cannot reach
 * another patient, cannot write anything, and expires. Access is a session, not a status.
 *
 * IT IS REVOCABLE, AND REVOCATION IS APPEND-ONLY. A patient who loses a phone, a relative who should
 * not have been enrolled, a safeguarding concern: all of these need access to stop today, and a
 * revocation somebody could delete afterwards would defeat the point.
 *
 * WHAT THE PATIENT SEES IS #940's DOCUMENT AND NOTHING ELSE. Every withholding rule already argued
 * there applies unchanged: no result with an open critical loop, nothing preliminary, no
 * differential printed as a diagnosis, and the clinician-only warnings are not in the patient's
 * payload at all. This file adds no new view of the chart; it adds a door to an existing one.
 */

import { makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { RecordService } from "./service.js";
import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
/* The SAME assembler the clinician's handout uses. Every withholding rule argued in #940 - no result
 * with an open critical loop, nothing preliminary, no differential printed as a diagnosis - applies
 * here unchanged, because this is one view of the chart with two doors and not two views. */
import { assemble as patientCopyAssemble, statements as patientStatements } from "./patient-record.js";
/* One wording for the channel warning, defined where the messaging rules are. Two copies would
 * drift, and the copy that drifts is the one on the screen the patient actually reads. */
import { NOT_EMERGENCY } from "./portal-requests.js";

const str = (v) => (v == null ? "" : String(v).trim());

const GRANT_TYPE = "PatientAccessGrant";

/** Long enough that guessing is hopeless against the attempt cap, short enough to read aloud. */
const CODE_DIGITS = 8;
/** A code that can be tried a million times is not a code. */
const MAX_ATTEMPTS = 5;
/** How long an unredeemed code lives. Long enough to walk out of the building, not to lose a phone. */
const CODE_TTL_MINUTES = 60;
/** How long a redeemed session lasts. Access is a session, not a status. */
const SESSION_TTL_MINUTES = 30;

/** PURE. Digits only: this is read aloud across a desk, and letters get misheard. */
function makeCode(randomBytes) {
  const bytes = randomBytes || (() => {
    const b = new Uint8Array(CODE_DIGITS);
    crypto.getRandomValues(b);
    return b;
  })();
  let out = "";
  for (let i = 0; i < CODE_DIGITS; i++) out += String(bytes[i] % 10);
  return out;
}

/**
 * PURE-ish. The stored form of a secret.
 *
 * Salted with the grant id so two patients issued the same digits do not share a hash, and so a
 * stolen table cannot be reversed with one precomputed set.
 */
async function hashSecret(secret, salt) {
  const data = new TextEncoder().encode(`wsq-patient-access|${str(salt)}|${str(secret)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * PURE. Constant-time string comparison.
 *
 * `===` on a hash leaks its prefix through timing. The comparison is over hex digests of fixed
 * length, so length is not secret and an early length check is safe.
 */
function sameSecret(a, b) {
  const x = str(a), y = str(b);
  if (x.length !== y.length || !x) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** PURE. Whether the feature is on. Absent config is OFF, never on-by-default. */
function accessEnabled(config) {
  return !!(config && typeof config === "object" && config.enabled === true);
}

/** PURE. Minutes from config, or the safe default. Never zero: Number("") is 0 and 0 is finite. */
function minutesOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * PURE. Whether a grant may still be redeemed, and if not, why.
 *
 * Ordered deliberately: revoked before expired before attempts, so a revoked grant never reports as
 * merely expired - the two mean different things to whoever is reading the audit.
 */
function redeemable(grant, nowIso, ttlMinutes) {
  const g = grant || {};
  if (g.revokedAt) return { ok: false, reason: "revoked", detail: "This access was revoked." };
  if (g.redeemedAt) return { ok: false, reason: "already_redeemed", detail: "This code has already been used. Ask for a new one." };
  if (Number(g.failedAttempts) >= MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts", detail: "Too many incorrect attempts. This code is no longer usable; ask for a new one." };
  }
  const issued = Date.parse(str(g.issuedAt));
  const now = Date.parse(str(nowIso));
  if (!Number.isFinite(issued) || !Number.isFinite(now)) {
    /* Unreadable timestamps fail CLOSED. An access grant whose age cannot be established is not one
     * to honour, and the alternative - treating it as fresh - is the direction that never expires. */
    return { ok: false, reason: "unusable", detail: "This code cannot be checked and will not be honoured." };
  }
  if (now - issued > minutesOr(ttlMinutes, CODE_TTL_MINUTES) * 60000) {
    return { ok: false, reason: "expired", detail: "This code has expired. Ask for a new one." };
  }
  return { ok: true };
}

/** PURE. Whether a redeemed session is still live. */
function sessionLive(grant, nowIso, ttlMinutes) {
  const g = grant || {};
  if (g.revokedAt) return { ok: false, reason: "revoked" };
  const from = Date.parse(str(g.redeemedAt));
  const now = Date.parse(str(nowIso));
  if (!Number.isFinite(from) || !Number.isFinite(now)) return { ok: false, reason: "unusable" };
  if (now - from > minutesOr(ttlMinutes, SESSION_TTL_MINUTES) * 60000) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * PURE. The grant record.
 *
 * Note what is NOT here: the code, the token, and any clinical content. Only their digests, and the
 * patient this is for. A grant readable by staff must not be a way to become the patient.
 */
function AccessGrant(input) {
  const i = input || {};
  return {
    resourceType: GRANT_TYPE,
    id: i.id,
    patientId: i.patientId,
    /* Who was enrolled and how they were identified, in the enroller's words. A grant issued to a
     * relative is a different fact from one issued to the patient, and a record that cannot tell
     * them apart records neither. */
    issuedTo: i.issuedTo || "patient",
    identifiedBy: i.identifiedBy || null,
    issuedBy: i.issuedBy,
    issuedAt: i.issuedAt,
    codeHash: i.codeHash,
    tokenHash: i.tokenHash || null,
    redeemedAt: i.redeemedAt || null,
    failedAttempts: Number(i.failedAttempts) || 0,
    revokedAt: i.revokedAt || null,
    revokedBy: i.revokedBy || null,
    revokedReason: i.revokedReason || null,
    source: { system: "wardsynq-native", sourceId: `patient-access:${i.id}` },
  };
}

/**
 * The actor a patient's own session runs as.
 *
 * KIND.HUMAN with an id that begins `patient:`, so nothing reading the audit can mistake it for a
 * clinician - there is no patient kind in the ladder and inventing one would change the ceiling
 * table every other actor is clamped by. Tier READ and an EMPTY write scope: this actor cannot
 * write anything at all, whatever route it reaches.
 *
 * The read scope is the handout's types and nothing else. It is NOT what stops a patient reading
 * somebody else's chart - scopes are by type, not by person. What stops that is that every route
 * below takes the patient id FROM THE GRANT and never from the request.
 */
function patientActor(patientId) {
  return makeActor({
    id: `patient:${str(patientId)}`,
    kind: KIND.HUMAN,
    tier: TIER.READ,
    scope: {
      /* PatientMessage joins the read list so a patient can see the REPLY to their own question.
       * Without it the portal is a place messages go and never come back, and the patient has no way
       * to tell "nobody has answered" from "the answer is somewhere else". */
      read: ["Patient", "Condition", "AllergyIntolerance", "MedicationOrder", "DiagnosticReport", "CriticalResultLoop", "Appointment", "PatientMessage"],
      write: [],
    },
  });
}

/** The actor the access machinery itself runs as, to read and write grants and nothing else. */
function accessActor() {
  return makeActor({
    id: "service:patient-access",
    kind: KIND.SERVICE,
    tier: TIER.DRAFT,
    scope: { read: [GRANT_TYPE], write: [GRANT_TYPE] },
  });
}

function serviceFor(ctx, actor) {
  return new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: { id: ctx.migration.tenantId }, actor, role: "patient-access", roleSource: "wardsynq-patient-access",
  });
}

const offResponse = (base) => ({
  ...base, ok: false, status: 404, error: "patient_access_disabled",
  detail: "Patient access is not enabled for this hospital. It is off unless wardsynq.patientAccess.enabled is true: a clinical system does not acquire a new authentication surface by default.",
});

/**
 * A clinician enrols the patient in front of them.
 * ctx: { migration, patientId, issuedTo?, identifiedBy?, config, actorDeps, recordDeps }
 */
async function enrolPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  if (!accessEnabled(ctx.config)) return offResponse(base);

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  /* HOW THIS PERSON WAS IDENTIFIED is required and free text. Enrolment is the moment the whole
   * chain of trust is established, and a record that does not say what was checked cannot be
   * reviewed after the wrong person turns out to have been enrolled. */
  const identifiedBy = str(ctx.identifiedBy);
  if (!identifiedBy) {
    return { ...base, ok: false, status: 422, error: "identification_required", written: 0,
      detail: "record how you identified this person. Enrolment is where the chain of trust starts, and it has to be reviewable afterwards." };
  }

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: status === 401 ? "auth" : "permission", detail: str(e && e.message), written: 0 };
  }

  const at = new Date().toISOString();
  const id = `wsq-pacc-${str(patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.replace(/[^0-9]/g, "")}`;
  const code = makeCode();
  const grant = AccessGrant({
    id, patientId, issuedTo: str(ctx.issuedTo) || "patient", identifiedBy,
    issuedBy: resolved.actor.id, issuedAt: at,
    codeHash: await hashSecret(code, id),
  });

  try {
    await serviceFor(ctx, accessActor()).put(grant, { idempotencyKey: ctx.idempotencyKey || null });
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }

  return {
    ...base, ok: true, written: 1, grantId: id, patientId, issuedAt: at,
    /* RETURNED EXACTLY ONCE, to the clinician who is with the patient. Only the digest is stored: a
     * code readable from the record afterwards would let anyone with record access become the
     * patient, and the audit would show the patient reading their own chart. */
    code,
    expiresInMinutes: minutesOr(ctx.config && ctx.config.codeTtlMinutes, CODE_TTL_MINUTES),
    note: "Read this code to the patient now. It is not stored and cannot be shown again, and nothing has sent it anywhere: an access code sent to a number nobody verified is the failure mode, not the feature.",
    actor: resolved.actor.id,
  };
}

/**
 * The patient exchanges the code for a short, read-only session.
 * Deliberately reachable WITHOUT a clinician identity - it is the patient's own door.
 * ctx: { migration, grantId, code, config, recordDeps }
 */
async function redeemCode(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", token: null };
  if (!accessEnabled(ctx.config)) return offResponse(base);

  const grantId = str(ctx.grantId), code = str(ctx.code);
  if (!grantId || !code) return { ...base, ok: false, status: 422, error: "code_required", token: null };

  const svc = serviceFor(ctx, accessActor());
  let grant;
  try { grant = await svc.get(GRANT_TYPE, grantId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", token: null }; }
  /* A missing grant and a wrong code return the SAME thing. Distinguishing them turns this route
   * into an oracle for which grant ids exist. */
  const deny = { ...base, ok: false, status: 401, error: "not_valid", token: null, detail: "That code is not valid." };
  if (!grant) return deny;

  const now = new Date().toISOString();
  const usable = redeemable(grant, now, ctx.config && ctx.config.codeTtlMinutes);
  if (!usable.ok) return { ...base, ok: false, status: 401, error: usable.reason, detail: usable.detail, token: null };

  const supplied = await hashSecret(code, grantId);
  if (!sameSecret(supplied, grant.codeHash)) {
    /* The failure is COUNTED and stored. Rate limiting that lives only in a gateway is rate limiting
     * the next deployment forgets, and a six-digit code that can be tried a million times is not a
     * code. The count is on the grant, so it survives everything. */
    const { meta, version, ...rest } = grant;
    try { await svc.put({ ...rest, failedAttempts: (Number(grant.failedAttempts) || 0) + 1 }, { expectedVersion: version }); }
    catch (_) { /* a racing attempt already counted one; the cap still applies */ }
    return deny;
  }

  const token = makeCode() + makeCode() + makeCode() + makeCode();
  const { meta, version, ...rest } = grant;
  try {
    await svc.put({ ...rest, redeemedAt: now, tokenHash: await hashSecret(token, grantId) }, { expectedVersion: version });
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_write_failed", token: null };
  }

  return {
    ...base, ok: true, grantId, token,
    expiresInMinutes: minutesOr(ctx.config && ctx.config.sessionTtlMinutes, SESSION_TTL_MINUTES),
    /* The patient id is NOT returned here and is never accepted from the caller. It lives on the
     * grant, and the read route takes it from there. */
    note: "This session is read-only, is for one person's record, and expires. It is not a login.",
  };
}

/**
 * The patient reads their own copy.
 * ctx: { migration, grantId, token, config, neverRelease, recordDeps }
 */
async function portalRead(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", document: null };
  if (!accessEnabled(ctx.config)) return offResponse(base);

  const grantId = str(ctx.grantId), token = str(ctx.token);
  if (!grantId || !token) return { ...base, ok: false, status: 401, error: "not_valid", document: null };

  let grant;
  try { grant = await serviceFor(ctx, accessActor()).get(GRANT_TYPE, grantId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", document: null }; }
  const deny = { ...base, ok: false, status: 401, error: "not_valid", document: null, detail: "This session is not valid. Ask your care team for a new code." };
  if (!grant || !grant.tokenHash) return deny;

  const now = new Date().toISOString();
  const live = sessionLive(grant, now, ctx.config && ctx.config.sessionTtlMinutes);
  if (!live.ok) return { ...base, ok: false, status: 401, error: live.reason, document: null, detail: "This session has ended. Ask your care team for a new code." };
  if (!sameSecret(await hashSecret(token, grantId), grant.tokenHash)) return deny;

  /* THE PATIENT ID COMES FROM THE GRANT. This line is the entire containment: a scope is by type and
   * not by person, so if this took a patient id from the request a valid session for one patient
   * would read any chart in the hospital. */
  const patientId = str(grant.patientId);

  const svc = serviceFor(ctx, patientActor(patientId));
  let doc;
  try {
    doc = await patientCopyAssemble(svc, patientId, Array.isArray(ctx.neverRelease) ? ctx.neverRelease : []);
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), document: null };
  }

  /* The patient's own messages and any replies. A portal where messages go and never come back
   * leaves the patient unable to tell "nobody has answered" from "the answer is somewhere else". */
  let messages = [];
  try {
    messages = (await svc.byPatient("PatientMessage", patientId).catch(() => []) || [])
      .filter(Boolean)
      .sort((a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || "")))
      .slice(0, 20)
      .map((m) => ({ sentAt: m.sentAt, body: m.body, reply: m.reply || null, answeredAt: m.answeredAt || null }));
  } catch (_) { messages = []; }

  return {
    ...base, ok: true, patientId,
    document: doc,
    messages,
    /* Carried on the read so the page can show it above the message box rather than under the send
     * button. The person about to type "my chest hurts" is the one who most needs to read it first. */
    notEmergency: NOT_EMERGENCY,
    statements: patientStatements(doc),
    /* The clinician-only warnings from #940 are NOT in this payload at all. On the handout they are
     * marked not-to-print; here the patient is the reader, so they are simply absent. */
    note: "This is your own record, as your care team has released it.",
  };
}

/**
 * Verifies a session and returns the patient it is for.
 *
 * The ONE place a session is checked, so every patient-facing route gets the same answer to the same
 * question. It returns the patient id FROM THE GRANT, which is what makes it safe to hand to a write
 * path: a caller cannot influence which record it names.
 *
 * ctx: { migration, grantId, token, config, recordDeps }
 */
async function sessionPatient(ctx) {
  if (!accessEnabled(ctx.config)) return { ok: false, status: 404, error: "patient_access_disabled" };
  const grantId = str(ctx.grantId), token = str(ctx.token);
  const deny = { ok: false, status: 401, error: "not_valid", detail: "This session is not valid. Ask your care team for a new code." };
  if (!grantId || !token) return deny;

  let grant;
  try { grant = await serviceFor(ctx, accessActor()).get(GRANT_TYPE, grantId); }
  catch (e) { return { ok: false, status: 502, error: "record_read_failed" }; }
  if (!grant || !grant.tokenHash) return deny;

  const live = sessionLive(grant, new Date().toISOString(), ctx.config && ctx.config.sessionTtlMinutes);
  if (!live.ok) return { ok: false, status: 401, error: live.reason, detail: "This session has ended. Ask your care team for a new code." };
  if (!sameSecret(await hashSecret(token, grantId), grant.tokenHash)) return deny;

  return { ok: true, patientId: str(grant.patientId), grantId };
}

/**
 * Ends access. A lost phone, a relative who should not have been enrolled, a safeguarding concern.
 * ctx: { migration, grantId, reason, config, actorDeps, recordDeps }
 */
async function revokeAccess(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  if (!accessEnabled(ctx.config)) return offResponse(base);

  const grantId = str(ctx.grantId), reason = str(ctx.reason);
  if (!grantId) return { ...base, ok: false, status: 422, error: "grant_required", written: 0 };
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "a revocation says why, because it is read later by somebody deciding whether to re-enrol", written: 0 };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: status === 401 ? "auth" : "permission", written: 0 };
  }

  const svc = serviceFor(ctx, accessActor());
  let grant;
  try { grant = await svc.get(GRANT_TYPE, grantId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", written: 0 }; }
  if (!grant) return { ...base, ok: false, status: 404, error: "grant_not_found", written: 0 };

  const { meta, version, ...rest } = grant;
  const now = new Date().toISOString();
  try {
    /* Append-only, like everything else in this store. A revocation somebody could delete afterwards
     * would defeat the point of having one. */
    await svc.put({ ...rest, revokedAt: now, revokedBy: resolved.actor.id, revokedReason: reason }, { expectedVersion: version });
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
  return { ...base, ok: true, written: 1, grantId, revokedAt: now, actor: resolved.actor.id,
    note: "Access has ended immediately. Any live session using this grant stops at its next request." };
}

export {
  GRANT_TYPE, CODE_DIGITS, MAX_ATTEMPTS, CODE_TTL_MINUTES, SESSION_TTL_MINUTES,
  makeCode, hashSecret, sameSecret, accessEnabled, minutesOr, redeemable, sessionLive, AccessGrant,
  patientActor, accessActor, sessionPatient, enrolPatient, redeemCode, portalRead, revokeAccess,
};
