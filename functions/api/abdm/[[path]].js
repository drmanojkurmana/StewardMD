// functions/api/abdm/[[path]].js — ABDM M1 (ABHA) routes for the app.
//
// Clinician-facing: the doctor or front desk drives these while the patient is present. Every route is
// signed-in-only, flag-gated, and returns whatever ABDM returned so the client can render ABDM's own
// error text (its messages are what the certification test cases check for).
//
// PHI: Aadhaar / mobile / OTP arrive in the request body, are RSA-encrypted inside abha.js before they
// leave us, and are never logged or persisted. The only durable artefact is the ABHA<->patient binding
// written by /link, which stores an HMAC pseudonym plus the last four digits - never the number itself.

import { jsonResponse } from "../../_connect/testkit.js";
import { abdmConfig, AbdmConfigError } from "../../_connect/abdm/config.js";
import { makeGateway } from "../../_connect/abdm/gateway.js";
import { makeSecrets } from "../../_connect/secrets.js";
import { identify } from "../../_usage.js";
import {
  AbhaError, enrolSendAadhaarOtp, enrolVerifyAadhaarOtp, enrolSendMobileOtp, enrolVerifyMobileOtp,
  abhaAddressSuggestions, createAbhaAddress, loginSendOtp, loginVerifyOtp, addressSearchAuthMethods,
  findAbhaByMobile, findAbhaSendOtp, loginVerifyUser, getProfile, getAbhaCard, getQrCode,
  normalizeProfile, ENROL_CONSENT, SCOPES,
} from "../../_connect/abdm/abha.js";
import { linkAbhaToPatient, findLink, openLinkAddress, AbhaLinkError } from "../../_connect/abdm/abha-link.js";
import { resolveTenant } from "../../_connect/identity.js";
import { PermissionError } from "../../_connect/permission.js";
import {
  enrolmentConsent, recordEnrolConsent, claimEnrolConsent, ConsentRecordError,
} from "../../_connect/abdm/consent-text.js";

// M1 has its own flag: the ABHA surface is useful long before HIP/HIU serving is ready.
const m1On = (env) => String(env && env.ABDM_M1_FLAG) === "1";

export async function onRequest(context) {
  const { request, env } = context;
  if (!m1On(env)) return jsonResponse({ error: "not_found" }, { status: 404 });

  const who = await identify(request, env);
  if (who.guest) return jsonResponse({ error: "unauthorized" }, { status: 401 });

  const path = new URL(request.url).pathname.replace(/^\/api\/abdm/, "") || "/";
  let cfg;
  try { cfg = abdmConfig(env); } catch (e) { return jsonResponse({ error: "misconfigured", detail: e.message }, { status: 500 }); }

  // One gateway session, shared by every ABHA call in this request.
  const gw = makeGateway({
    baseUrl: cfg.gatewayBase, cmId: cfg.cmId, fetch, kv: env.MAIK_KV, secrets: makeSecrets(env),
  });

  let token;
  try { token = await gw.session(); }
  catch (e) { return jsonResponse({ error: "abdm_unavailable", detail: e.message }, { status: 503 }); }

  const deps = { fetch, token, kv: env.MAIK_KV, now: () => Date.now() };
  const iso = () => new Date().toISOString();
  const cdeps = { db: env.CONNECT_DB, now: iso };
  // A tenant id on the request body is a CLAIM, never an authority. Every route that reads or writes
  // tenant-scoped data resolves membership first, or one signed-in user could bind an ABHA into another
  // hospital's patient index - or probe whether a given ABHA is registered there.
  const forTenant = async (tenantId) => {
    if (!tenantId) throw new PermissionError("tenant is required");
    const { tenant } = await resolveTenant(env.CONNECT_DB, who.id, tenantId, env);
    return tenant.id;
  };
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const q = new URL(request.url).searchParams;

  try {
    switch (path) {
      // ── creation (cert CRT_ABHA_101..115) ───────────────────────────────────────────────────────
      case "/enrol/otp":
        // "Consent must be explained & collected from the user prior to performing Aadhaar OTP
        // authentication" (Registration via Aadhaar OTP). claimEnrolConsent is single-use, so one
        // patient's agreement can never be spent on another patient's ABHA.
        await claimEnrolConsent(cdeps, { tenantId: await forTenant(body.tenantId), consentId: body.consentId });
        return ok(await enrolSendAadhaarOtp(cfg, deps, { aadhaar: body.aadhaar }));
      case "/enrol/verify":
        return ok(await enrolVerifyAadhaarOtp(cfg, deps, { txnId: body.txnId, otp: body.otp, mobile: body.mobile }));
      case "/enrol/mobile/otp":
        return ok(await enrolSendMobileOtp(cfg, deps, { txnId: body.txnId, mobile: body.mobile }));
      case "/enrol/mobile/verify":
        return ok(await enrolVerifyMobileOtp(cfg, deps, { txnId: body.txnId, otp: body.otp }));
      case "/enrol/suggestions":
        return ok(await abhaAddressSuggestions(cfg, deps, { txnId: q.get("txnId") }));
      case "/enrol/address":
        return ok(await createAbhaAddress(cfg, deps, { txnId: body.txnId, abhaAddress: body.abhaAddress }));

      // ── verification (cert VRFY_ABHA_101..405) ──────────────────────────────────────────────────
      case "/verify/otp":
        return ok(await loginSendOtp(cfg, deps, {
          loginHint: body.loginHint, loginId: body.loginId, otpSystem: body.otpSystem,
          scope: body.scope, txnId: body.txnId, addressFlow: body.addressFlow,
        }));
      case "/verify/confirm":
        return ok(await loginVerifyOtp(cfg, deps, {
          txnId: body.txnId, otp: body.otp, scope: body.scope, addressFlow: body.addressFlow,
        }));
      case "/verify/address/methods":
        return ok(await addressSearchAuthMethods(cfg, deps, { abhaAddress: body.abhaAddress }));
      case "/verify/user":
        return ok(await loginVerifyUser(cfg, deps, { tToken: body.tToken, abhaNumber: body.abhaNumber, txnId: body.txnId }));

      // ── find an existing ABHA by mobile (cert VRFY_ABHA_301..305) ───────────────────────────────
      case "/find":
        return ok(await findAbhaByMobile(cfg, deps, { mobile: body.mobile }));
      case "/find/otp":
        return ok(await findAbhaSendOtp(cfg, deps, { txnId: body.txnId, index: body.index, otpSystem: body.otpSystem }));

      // ── profile + card. addressFlow MUST match how the X-token was obtained (FAQ Q21). ──────────
      case "/profile": {
        const raw = await getProfile(cfg, deps, { xToken: body.xToken || q.get("xToken"), addressFlow: truthy(body.addressFlow ?? q.get("addressFlow")) });
        return ok({ raw, profile: normalizeProfile(raw) });
      }
      case "/card":
        return ok(await getAbhaCard(cfg, deps, { xToken: body.xToken || q.get("xToken"), addressFlow: truthy(body.addressFlow ?? q.get("addressFlow")) }));
      case "/qr":
        return ok(await getQrCode(cfg, deps, { xToken: body.xToken || q.get("xToken") }));

      // ── the mandatory one-ABHA-per-patient binding (cert TAGGING_*) ─────────────────────────────
      case "/link": {
        const tenantId = await forTenant(body.tenantId);
        const linkDeps = { db: env.CONNECT_DB, env, secrets: makeSecrets(env), now: iso };
        const res = await linkAbhaToPatient(linkDeps, {
          tenantId, abhaNumber: body.abhaNumber,
          abhaAddress: body.abhaAddress, patientRef: body.patientRef,
        });
        return ok(res);
      }
      case "/link/lookup": {
        const tenantId = await forTenant(q.get("tenantId"));
        const linkDeps = { db: env.CONNECT_DB, env, secrets: makeSecrets(env) };
        const row = await findLink(linkDeps, { tenantId, abhaNumber: q.get("abhaNumber") });
        if (!row) return ok({ linked: false });
        return ok({ linked: true, patientRef: row.patient_ref, abhaLast4: row.abha_last4, abhaAddress: await openLinkAddress(linkDeps, row) });
      }

      // ── what the UI needs to render the consent screen (cert CRT_ABHA_102) ──────────────────────
      // The PUBLISHED consent language itself, with the patient's and clinician's names filled in and
      // the private-integrator wording applied. The client renders exactly what this returns.
      case "/meta":
        return ok({
          consent: ENROL_CONSENT, scopes: SCOPES, env: cfg.envName, hipId: cfg.hipId,
          consentLanguage: enrolmentConsent({
            flow: q.get("flow") || "aadhaar",
            workerName: q.get("workerName") || who.name || "",
            patientName: q.get("patientName") || "",
          }),
        });

      // Record the beneficiary's agreement BEFORE any Aadhaar OTP is requested, and hand back the id
      // that /enrol/otp requires. An incomplete agreement is refused rather than stored.
      case "/consent": {
        const tenantId = await forTenant(body.tenantId);
        return ok(await recordEnrolConsent(cdeps, {
          tenantId, actor: who.id, patientRef: body.patientRef,
          agreed: body.agreed, flow: body.flow, government: false,
        }));
      }

      default:
        return jsonResponse({ error: "not_found" }, { status: 404 });
    }
  } catch (e) {
    if (e instanceof AbhaError) {
      // Pass ABDM's own code/message/field through - the certification cases check for its wording.
      return jsonResponse({ error: "abdm", code: e.code, field: e.field || null, message: e.message },
        { status: e.status && e.status >= 400 && e.status < 600 ? e.status : 400 });
    }
    if (e instanceof AbhaLinkError) return jsonResponse({ error: e.code, message: e.message }, { status: 409 });
    if (e instanceof PermissionError) return jsonResponse({ error: "forbidden", message: e.message }, { status: 403 });
    if (e instanceof ConsentRecordError) return jsonResponse({ error: "consent_required", message: e.message }, { status: 400 });
    if (e instanceof AbdmConfigError) return jsonResponse({ error: "misconfigured", message: e.message }, { status: 500 });
    return jsonResponse({ error: "failed" }, { status: 500 });
  }
}

const ok = (data) => jsonResponse({ ok: true, data });
const truthy = (v) => v === true || v === "1" || v === "true";
