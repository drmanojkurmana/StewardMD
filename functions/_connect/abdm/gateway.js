// functions/_connect/abdm/gateway.js — ABDM gateway adapter (spec §1/§3, ADR-2H). Dependency-injected; Workers+Node.
export class AbdmError extends Error {}

// ── ADR-2H: THE one-file config seam. Every path here is corroborated-not-official (research WAS WAF-blocked);
//    pin to the live Postman/Swagger before real calls. Changing these should be the ONLY code change needed
//    when the real paths are confirmed.
export const ENDPOINTS = {
  sessions:     "/api/hiecm/gateway/v3/sessions",   // VERIFY: live Postman/Swagger
  consentInit:  "/consent-requests/init",            // VERIFY
  consentFetch: "/consents/fetch",                   // VERIFY
  hiRequest:    "/health-information/cm/request",    // VERIFY
  hiNotify:     "/health-information/notify",         // VERIFY
};

export function requestId() { return globalThis.crypto.randomUUID(); }

export function gatewayHeaders({ token, cmId, hiuId, hipId, now }) {
  const h = {
    authorization: "Bearer " + token,
    "X-CM-ID": cmId || "sbx",
    "REQUEST-ID": requestId(),                       // fresh per call — gateway rejects reuse
    TIMESTAMP: (now ? now() : new Date()).toISOString(),
    "content-type": "application/json",
  };
  if (hiuId) h["X-HIU-ID"] = hiuId;
  if (hipId) h["X-HIP-ID"] = hipId;
  return h;
}
