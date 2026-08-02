// functions/_connect/onboard/consent-abdm.js — the ABDM Consent-Manager revoke adapter (Consent Dashboard,
// Increment 1 provider seam). Selected by consents.js#getConsentProvider ONLY when hipFlagOn(env) is true
// (BOTH smd_connect AND smd_connect_hip -- the SAME second flag the HIP serve direction already gates on;
// reused here rather than inventing a THIRD flag for one still-unwired seam). This module has NO read path:
// the Consent Dashboard's listing is always a REAL, direct read of connect_abdm_consent_req through
// consents.js#readTenantConsents / #toConsentRow, regardless of this flag. If a future ABDM-sourced read is
// ever added, it MUST project through that SAME toConsentRow allow-list (see consents.js) -- never a second,
// drifted copy of the projection.
//
// TODAY this is UNWIRED. revokeConsent returns {ok:false, reason:"not-supported"} unconditionally, EVEN when
// hipFlagOn(env) is true -- there is no live external call here, by design (never fabricate an "external
// notified" success the local row can't back up).
// // VERIFY (owner, before wiring): "consentRevoke" is not yet in gateway.js's ENDPOINTS map (ADR-2H
// "corroborated-not-official" -- confirm the real path + request/response field names against ABDM's live
// Postman/Swagger first, same caveat as every other gateway.js endpoint). Once confirmed, the real flow is:
//   1) await deps.gateway.post("consentRevoke", { consentId: row.consent_id });   // 202-accept, fire-and-forget
//   2) ONLY after that call is accepted, run the SAME local monotonic write (`localRevoke`, threaded through
//      below) -- so the row flips to REVOKED after the external call succeeds, never before, and the caller
//      can still distinguish {propagated:"local"} (today) from a future {propagated:"abdm"}.
// Do NOT wire the live gateway.post call in this increment.
import { hipFlagOn } from "../abdm/hip-flags.js";

export async function revokeConsent(deps, env, row, now, localRevoke) {
  if (!hipFlagOn(env)) return { ok: false, reason: "not-supported" };
  // Unwired seam -- see the VERIFY block above. `localRevoke` is accepted here (unused for now) so the future
  // wire-up is a one-line call (gateway.post(...) THEN `return localRevoke(deps, env, row, now)`), not a
  // re-plumbing of this module's signature.
  return { ok: false, reason: "not-supported" };
}
