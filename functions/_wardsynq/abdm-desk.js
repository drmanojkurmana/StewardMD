/* functions/_wardsynq/abdm-desk.js - ABHA at the WardSynQ registration desk (ABDM M1, design S6 phase A5).
 *
 * The check-in sheet (patient-register.js) verifies a patient's existing ABHA or creates one, through the
 * ABHA V3 client that already exists (functions/_connect/abdm/abha.js, consent-text.js, abha-link.js). What
 * this file adds is the WardSynQ door around it:
 *
 *   WHO     the route gates on queue.add (the person who registers patients), and owner A5 on top:
 *           abhaDeskCan(role, "verify" | "create") from _queue_roles.js. The Connect-membership door in
 *           functions/api/abdm is not used here: WardSynQ staff are the org's own staff.
 *   WHICH   the hospital's own ABDM profile (abdm-connect.js). Not connected means refused with the reason,
 *           before anything reaches ABDM, so the desk sees plainly that this hospital is not connected.
 *   PROOF   a verified or newly created ABHA comes back with a short-lived signed proof. /patient/register
 *           binds an ABHA to the new MR number only with that proof, so an ABHA typed by hand is recorded as
 *           typed and never presented to ABDM as verified.
 *
 * PHI: Aadhaar, OTP and mobile arrive in the POST body, are RSA-encrypted inside abha.js before they leave,
 * and are never logged, stored or audited. The durable artefacts are the consent record (consent-text.js), the
 * one-ABHA-per-patient binding (abha-link.js: HMAC pseudonym, last four digits, address sealed) and PHI-free
 * audit rows in connect_audit_event.
 */

import {
  AbhaError, enrolSendAadhaarOtp, enrolVerifyAadhaarOtp, enrolSendMobileOtp, enrolVerifyMobileOtp,
  abhaAddressSuggestions, createAbhaAddress, loginSendOtp, loginVerifyOtp, getProfile, normalizeProfile, SCOPES,
} from "../_connect/abdm/abha.js";
import { enrolmentConsent, recordEnrolConsent, claimEnrolConsent, ConsentRecordError } from "../_connect/abdm/consent-text.js";
import { linkAbhaToPatient, findLink, AbhaLinkError } from "../_connect/abdm/abha-link.js";
import { indexPatient } from "../_connect/abdm/demographic-index.js";
import { makeAuditSink } from "../_connect/audit.js";
import { makeSecrets } from "../_connect/secrets.js";
import { abdmConfigFor } from "../_connect/abdm/config.js";
import { abhaDeskCan } from "../_queue_roles.js";
import { loadConnection, connectionView, gatewayFor } from "./abdm-connect.js";

const str = (v) => (v == null ? "" : String(v).trim());
const digits = (v) => str(v).replace(/\D/g, "");
const iso = () => new Date().toISOString();

const CREATE_STEPS = new Set(["consent-text", "consent", "enrol-otp", "enrol-verify", "mobile-otp", "mobile-verify", "suggestions", "address"]);
const VERIFY_STEPS = new Set(["verify-otp", "verify-confirm"]);
const PROOF_TTL_MS = 30 * 60 * 1000;

/* ---- the proof ------------------------------------------------------------------------------------------ */

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(env, text) {
  const secret = str(env && env.QUEUE_TOKEN_SECRET);
  if (!secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

/** A signed statement that ABDM verified this ABHA for this hospital, valid for 30 minutes. null without a key. */
async function mintAbhaProof(env, { orgId, abhaNumber, abhaAddress, now }) {
  const body = b64u(new TextEncoder().encode(JSON.stringify({ o: str(orgId), n: digits(abhaNumber), a: str(abhaAddress), x: (now || Date.now()) + PROOF_TTL_MS })));
  const sig = await hmac(env, "abha-proof:" + body);
  return sig ? body + "." + sig : null;
}

/** The ABHA a proof vouches for, or null when it is forged, expired, for another hospital or unreadable. */
async function readAbhaProof(env, proof, orgId, now) {
  const [body, sig] = str(proof).split(".");
  if (!body || !sig) return null;
  const want = await hmac(env, "abha-proof:" + body);
  if (!want || want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ want.charCodeAt(i);
  if (diff) return null;
  let p;
  try { p = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
  if (!p || p.o !== str(orgId) || !(Number(p.x) > (now || Date.now()))) return null;
  return { abhaNumber: p.n || "", abhaAddress: p.a || "" };
}

/* ---- the desk ------------------------------------------------------------------------------------------- */

async function connectionFor(env, ctx) {
  try { return { conn: await loadConnection(env, ctx.recordDeps.repository, ctx.migration.tenantId) }; }
  catch { return { error: { ok: false, status: 502, error: "abdm_profile_read_failed", message: "This hospital's ABDM profile could not be read, so nothing was sent to ABDM." } }; }
}

/** GET: what the check-in sheet needs before it offers ABHA. ctx: { migration, recordDeps, role } */
async function abhaDeskStatus(request, env, ctx) {
  const c = await connectionFor(env, ctx);
  if (c.error) return c.error;
  return { ok: true, connection: connectionView(c.conn), canVerify: abhaDeskCan(ctx.role, "verify"), canCreate: abhaDeskCan(ctx.role, "create") };
}

/** PURE. The part of an ABDM profile the desk shows and pre-fills. No photo, no tokens, no Aadhaar. */
function deskProfile(raw) {
  const p = normalizeProfile(raw);
  return { abhaNumber: p.abhaNumber, abhaAddress: p.abhaAddress, name: p.name, gender: p.gender, dob: p.dob,
    yearOfBirth: p.yearOfBirth, mobile: p.mobile, address: p.address, kycVerified: p.kycVerified };
}

/**
 * POST: one step of verifying or creating an ABHA.
 * ctx: { migration, recordDeps, orgId, role, actorId, actorName, step, body, fetchImpl?, kv? }
 */
async function abhaDesk(request, env, ctx) {
  const step = str(ctx.step);
  const kind = CREATE_STEPS.has(step) ? "create" : VERIFY_STEPS.has(step) ? "verify" : null;
  if (!kind) return { ok: false, status: 422, error: "unknown_step", message: "Not a step of verifying or creating an ABHA." };
  if (!abhaDeskCan(ctx.role, kind)) {
    return { ok: false, status: 403, error: "abha_role_refused", message: kind === "create" ? "Your role cannot create an ABHA at this hospital." : "Your role cannot verify an ABHA at this hospital." };
  }
  const c = await connectionFor(env, ctx);
  if (c.error) return c.error;
  if (!c.conn.connected) return { ok: false, status: 409, error: "abdm_not_connected", code: c.conn.code, message: c.conn.reason };

  const tenantId = ctx.migration.tenantId, b = ctx.body || {};
  const audit = env.CONNECT_DB ? makeAuditSink(env, env.CONNECT_DB) : async () => {};
  const note = (action, outcome, scope) => audit({ action, outcome, ts: iso(), tenantId, actor: ctx.actorId, scope: { step, ...(scope || {}) } }).catch(() => null);
  const cdeps = { db: env.CONNECT_DB, now: iso };

  try {
    if (step === "consent-text") {
      return { ok: true, consent: enrolmentConsent({ flow: "aadhaar", workerName: str(ctx.actorName), patientName: str(b.patientName) }) };
    }
    if (step === "consent") {
      const r = await recordEnrolConsent(cdeps, { tenantId, actor: ctx.actorId, patientRef: null, agreed: b.agreed, flow: "aadhaar", government: false });
      await note("abdm.abha.consent", "ok");
      return { ok: true, consentId: r.id };
    }

    const cfg = abdmConfigFor(env, c.conn);
    let token;
    try { token = await gatewayFor(env, c.conn, { fetchImpl: ctx.fetchImpl, kv: ctx.kv }).session(); }
    catch { await note("abdm.abha.session", "failed"); return { ok: false, status: 503, error: "abdm_unavailable", message: "ABDM did not accept a session for this hospital. Nothing was sent; try again shortly." }; }
    const deps = { fetch: ctx.fetchImpl || ((...a) => fetch(...a)), token, kv: ctx.kv || env.MAIK_KV, now: () => Date.now() };

    switch (step) {
      case "enrol-otp": {
        // Consent before the Aadhaar OTP (CRT_ABHA_102), and single use: one patient's agreement never covers another.
        await claimEnrolConsent(cdeps, { tenantId, consentId: b.consentId });
        const r = await enrolSendAadhaarOtp(cfg, deps, { aadhaar: b.aadhaar });
        await note("abdm.abha.otp", "ok", { flow: "create" });
        return { ok: true, txnId: str(r.txnId), message: str(r.message) || null };
      }
      case "enrol-verify": {
        const r = await enrolVerifyAadhaarOtp(cfg, deps, { txnId: b.txnId, otp: b.otp, mobile: b.mobile });
        const profile = deskProfile(r);
        const mobileVerified = !!profile.mobile && digits(profile.mobile).slice(-10) === digits(b.mobile).slice(-10);
        await note("abdm.abha.created", profile.abhaNumber ? "ok" : "failed", { isNew: r.isNew === true });
        if (!profile.abhaNumber) return { ok: false, status: 502, error: "abdm_no_abha", message: "ABDM answered without an ABHA number, so nothing is recorded as created." };
        return { ok: true, txnId: str(r.txnId) || str(b.txnId), isNew: r.isNew !== false, mobileVerified, profile,
          linkedTo: await linkedTo(env, tenantId, profile.abhaNumber),
          proof: await mintAbhaProof(env, { orgId: ctx.orgId, abhaNumber: profile.abhaNumber, abhaAddress: profile.abhaAddress }) };
      }
      case "mobile-otp": {
        const r = await enrolSendMobileOtp(cfg, deps, { txnId: b.txnId, mobile: b.mobile });
        return { ok: true, txnId: str(r.txnId) || str(b.txnId), message: str(r.message) || null };
      }
      case "mobile-verify": {
        const r = await enrolVerifyMobileOtp(cfg, deps, { txnId: b.txnId, otp: b.otp });
        // The collection answers { authResult: "success" | "failed", message }; only "success" is a verified mobile.
        if (str(r.authResult).toLowerCase() !== "success") return { ok: false, status: 400, error: "abdm", message: str(r.message) || "ABDM did not verify the mobile number." };
        return { ok: true, txnId: str(r.txnId) || str(b.txnId) };
      }
      case "suggestions": {
        const r = await abhaAddressSuggestions(cfg, deps, { txnId: b.txnId });
        const list = Array.isArray(r.abhaAddressList) ? r.abhaAddressList.map(str).filter(Boolean) : [];
        return { ok: true, txnId: str(r.txnId) || str(b.txnId), suggestions: list };
      }
      case "address": {
        // The number was vouched for by the enrol-verify proof; the address the patient picked joins it.
        const prior = await readAbhaProof(env, b.proof, ctx.orgId);
        if (!prior || !prior.abhaNumber) return { ok: false, status: 422, error: "abha_proof_invalid", message: "The ABHA being created could not be confirmed. Start again." };
        const r = await createAbhaAddress(cfg, deps, { txnId: b.txnId, abhaAddress: str(b.abhaAddress) });
        const address = str(r.preferredAbhaAddress) || str(b.abhaAddress);
        await note("abdm.abha.address", "ok");
        return { ok: true, abhaNumber: prior.abhaNumber, abhaAddress: address,
          proof: await mintAbhaProof(env, { orgId: ctx.orgId, abhaNumber: prior.abhaNumber, abhaAddress: address }) };
      }
      case "verify-otp": {
        const id = str(b.abhaId);
        const addressFlow = id.indexOf("@") > 0;
        const aadhaarOtp = b.otpSystem === "aadhaar";
        const r = await loginSendOtp(cfg, deps, {
          loginHint: addressFlow ? "abha-address" : "abha-number", loginId: id, otpSystem: aadhaarOtp ? "aadhaar" : "abdm", addressFlow,
          scope: addressFlow ? (aadhaarOtp ? SCOPES.addressLoginAadhaar : SCOPES.addressLoginMobile) : undefined,
        });
        await note("abdm.abha.otp", "ok", { flow: "verify", addressFlow });
        return { ok: true, txnId: str(r.txnId), addressFlow, otpSystem: aadhaarOtp ? "aadhaar" : "abdm", message: str(r.message) || null };
      }
      case "verify-confirm": {
        const addressFlow = b.addressFlow === true;
        const scope = addressFlow ? (b.otpSystem === "aadhaar" ? SCOPES.addressLoginAadhaar : SCOPES.addressLoginMobile) : (b.otpSystem === "aadhaar" ? SCOPES.loginAadhaar : SCOPES.loginMobile);
        const r = await loginVerifyOtp(cfg, deps, { txnId: b.txnId, otp: b.otp, scope, addressFlow });
        // The ABHA-number flow answers { token }; the ABHA-address flow { tokens: { token } } (FAQ Q21: its own profile endpoint too).
        const xToken = str(r.token) || str(r.tokens && r.tokens.token);
        if (!xToken) {
          await note("abdm.abha.verified", "failed", { addressFlow });
          return { ok: false, status: 400, error: "abdm", message: str(r.message) || "ABDM did not verify the OTP." };
        }
        const profile = deskProfile(await getProfile(cfg, deps, { xToken, addressFlow }));
        await note("abdm.abha.verified", "ok", { addressFlow });
        if (!profile.abhaNumber && !profile.abhaAddress) return { ok: false, status: 502, error: "abdm_no_abha", message: "ABDM verified the OTP but returned no ABHA, so nothing is recorded as verified." };
        return { ok: true, profile, linkedTo: await linkedTo(env, tenantId, profile.abhaNumber),
          proof: await mintAbhaProof(env, { orgId: ctx.orgId, abhaNumber: profile.abhaNumber, abhaAddress: profile.abhaAddress }) };
      }
    }
  } catch (e) {
    if (e instanceof AbhaError) {
      await note("abdm.abha." + kind, "failed", { code: e.code || null });
      // ABDM's own words: the certification cases check for them, and the desk can act on them.
      return { ok: false, status: e.status >= 400 && e.status < 500 ? 400 : 502, error: "abdm", field: e.field || null, message: str(e.message) };
    }
    if (e instanceof ConsentRecordError) return { ok: false, status: 422, error: "consent_required", message: str(e.message) };
    return { ok: false, status: 502, error: "abdm_step_failed", message: "The ABHA step could not be completed. Nothing was recorded." };
  }
  return { ok: false, status: 422, error: "unknown_step" };
}

/** The MR number this ABHA is already bound to at this hospital, or null. A failed lookup is null, and the
 *  registration's own check refuses a second binding anyway. */
async function linkedTo(env, tenantId, abhaNumber) {
  if (!digits(abhaNumber) || !env.CONNECT_DB) return null;
  try {
    const row = await findLink({ db: env.CONNECT_DB, env }, { tenantId, abhaNumber });
    return row ? row.patient_ref : null;
  } catch { return null; }
}

/* ---- at registration ------------------------------------------------------------------------------------ */

/**
 * Before a patient is registered with a verified ABHA: the proof must be this hospital's, unexpired, and for
 * the ABHA on the form; and the ABHA must not already belong to another patient here (TAGGING_UNIQUEPATIENTID).
 * Returns { ok, abha } or a refusal with a status. Writes nothing.
 */
async function checkVerifiedAbha(env, { orgId, tenantId, body }) {
  const b = body || {};
  if (!tenantId) return { ok: false, status: 409, error: "abdm_not_connected", message: "This hospital has no ABDM record, so an ABHA cannot be linked here." };
  const proof = await readAbhaProof(env, b.abhaProof, orgId);
  const number = digits(b.abhaNumber), address = str(b.abhaAddress);
  if (!proof || proof.abhaNumber !== number || (proof.abhaAddress && address && proof.abhaAddress.toLowerCase() !== address.toLowerCase())) {
    return { ok: false, status: 422, error: "abha_proof_invalid", message: "The ABHA on this form is not the one ABDM verified, or the verification has expired. Verify it again. Nothing was registered.", errors: { abhaNumber: "Verify the ABHA again." } };
  }
  let existing = null;
  try { existing = await findLink({ db: env.CONNECT_DB, env }, { tenantId, abhaNumber: number }); }
  catch { return { ok: false, status: 502, error: "abha_link_read_failed", message: "Whether this ABHA already belongs to a patient here could not be checked, so nothing was registered." }; }
  if (existing) {
    return { ok: false, status: 409, error: "abha_already_linked", mrn: existing.patient_ref,
      message: `This ABHA already belongs to patient ${existing.patient_ref} at this hospital. Open that record instead of registering a new one. Nothing was registered.`, errors: { abhaNumber: `Already linked to ${existing.patient_ref}.` } };
  }
  return { ok: true, abha: { abhaNumber: number, abhaAddress: address || proof.abhaAddress } };
}

/**
 * After the MR number exists: bind the ABHA to it and index the patient for ABDM discovery, audited.
 * Returns { ok, created, discoverable } or { ok:false, error, message }: the registration has already happened,
 * so a failure here is reported beside it, never as the registration failing.
 */
async function linkVerifiedAbha(env, { tenantId, actorId, mrn, abha, patient }) {
  const p = patient || {};
  const audit = makeAuditSink(env, env.CONNECT_DB);
  let res;
  try {
    res = await linkAbhaToPatient({ db: env.CONNECT_DB, env, secrets: makeSecrets(env), now: iso }, { tenantId, abhaNumber: abha.abhaNumber, abhaAddress: abha.abhaAddress || null, patientRef: mrn });
  } catch (e) {
    await audit({ action: "abdm.abha.linked", outcome: "failed", ts: iso(), tenantId, actor: actorId, scope: { code: e instanceof AbhaLinkError ? e.code : "error" } }).catch(() => null);
    return { ok: false, error: e instanceof AbhaLinkError ? e.code : "abha_link_failed", message: "The patient was registered, but the ABHA could not be linked to the record. Link it again from registration." };
  }
  const year = str(p.dob).slice(0, 4) || (p.ageYears ? String(new Date().getUTCFullYear() - Number(p.ageYears)) : "");
  let discoverable = false;
  if (p.gender && /^\d{4}$/.test(year)) {
    try { await indexPatient(env, { db: env.CONNECT_DB, now: iso }, { tenantId, patientRef: mrn, name: p.name, mobile: p.mobile, gender: p.gender, yearOfBirth: year, mrn }); discoverable = true; }
    catch { discoverable = false; }
  }
  await audit({ action: "abdm.abha.linked", outcome: "ok", ts: iso(), tenantId, actor: actorId, scope: { created: !!res.created, discoverable } }).catch(() => null);
  return { ok: true, created: !!res.created, discoverable };
}

export { CREATE_STEPS, VERIFY_STEPS, mintAbhaProof, readAbhaProof, deskProfile, abhaDeskStatus, abhaDesk, checkVerifiedAbha, linkVerifiedAbha };
